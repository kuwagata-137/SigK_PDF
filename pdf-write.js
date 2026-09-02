'use strict';

// 元ファイルを壊さずに置き換える層（spec-1-6 確定事項15〜21）。
//
// file-io.js（読む側）と対になる。分けてあるのは、**この層をワーカーからも
// 使うため**である。ワーカーは utilityProcess の中で動き、Electron の dialog を
// 持たない。file-io.js は dialog を引数で受ける作りだが、読む経路と書く経路を
// 1つのファイルに詰めると 200 行を超えて見通しが落ちる。
//
// 設計の要点は3つ。
//
//   1. 保存先と**同じフォルダー**に一時ファイルを作り、rename で置き換える。
//      os.tmpdir() を使わないのは、ユーザーのファイルが別ドライブにあると
//      rename がドライブを跨げないためである（実測C）。
//   2. rename が EPERM で失敗しても、**直接上書きへ切り替えない**（確定事項17）。
//      直接書き込みは成功してしまうが、途中で落ちると元ファイルが失われる。
//      保存の失敗はやり直せるが、ファイルの消失はやり直せない。
//   3. .bak を作れなかったら**保存そのものを中止する**（確定事項19）。
//      退避できないまま上書きするのは、.bak を作る意味を失わせる。
//
// 戻り値の形は docs/02 第5章に揃える。成功 { ok: true, ... }／失敗 { error }。

const fs = require('node:fs');

const TEMP_SUFFIX = '.sigk-tmp';
const BACKUP_SUFFIX = '.bak';

function tempPathFor(target) {
  return `${target}${TEMP_SUFFIX}`;
}

function backupPathFor(target) {
  return `${target}${BACKUP_SUFFIX}`;
}

// 開いたときと保存する直前で、元ファイルが外から書き換えられていないかを見る。
// 内容のハッシュまでは取らない。200MB を保存のたびに読み直すことになるうえ、
// 「気づかず上書きする」を防ぐ目的にはサイズと更新時刻で足りる。
function signatureOf(stat) {
  return { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
}

function signaturesMatch(a, b) {
  if (a === null || a === undefined || b === null || b === undefined)
    return true;   // 片方を知らないなら、食い違いとは言えない。止めない。
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

async function readSignature(filePath, { fsLike = fs } = {}) {
  try {
    return signatureOf(await fsLike.promises.stat(filePath));
  } catch {
    return null;
  }
}

// 段ごとに文言を変える。どの段で転んだかで、ユーザーが取れる手が違うためである。
function describeWriteFailure(error, phase) {
  const code = error?.code;
  // 読み取り専用の属性と「他のプログラムが開いている」は、どちらも EPERM である。
  // rename の失敗だけでは区別できないので、書き込めるかを先に見て段を分けてある。
  if (phase === 'permission')
    return 'ファイルに書き込めません。読み取り専用になっていないか確認してください。';
  if (phase === 'replace' && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'))
    return 'ファイルが他のプログラムで使われています。閉じてからもう一度お試しください。';
  if (phase === 'backup')
    return 'バックアップ（.bak）を作れなかったため、保存を中止しました。';
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return 'ファイルに書き込む権限がありません。';
    case 'EROFS':
      return '書き込みできない場所です。';
    case 'ENOSPC':
      return 'ディスクの空き容量が足りません。';
    case 'ENOENT':
      return '保存先のフォルダーが見つかりません。';
    default:
      return 'ファイルを保存できませんでした。';
  }
}

// 書き込める先かどうか。読み取り専用の属性を、一時ファイルを作る前に見分ける。
async function isWritable(filePath, fsLike) {
  try {
    await fsLike.promises.access(filePath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeQuietly(filePath, fsLike) {
  try {
    await fsLike.promises.rm(filePath, { force: true });
  } catch {
    // 後始末に失敗しても、保存の成否は変えない。
  }
}

// bytes を target へ書く。
//
//   makeBackup … 上書きのときだけ true。名前を付けて保存では元ファイルを
//                触らないので false（確定事項18）。
//   expect     … 開いたときの signature。渡すと、書く前に照合する。
async function writeDocument(target, bytes, { makeBackup = false, expect = null, fsLike = fs } = {}) {
  const temp = tempPathFor(target);
  const current = await readSignature(target, { fsLike });
  const replacing = current !== null;

  if (replacing && !signaturesMatch(expect, current))
    return { changed: true, current };

  // 読み取り専用は一時ファイルを作る前に断る。ここで止めれば書きかけも .bak も
  // 残らず、文言も「他のプログラムが開いている」にならずに済む。
  if (replacing && !(await isWritable(target, fsLike)))
    return { error: describeWriteFailure({ code: 'EPERM' }, 'permission'), code: 'EPERM', phase: 'permission' };

  const backup = replacing && makeBackup ? backupPathFor(target) : null;
  // 前回の保存で作られた .bak は、今回の保存が転んでも消してはいけない。
  const backupExisted = backup === null ? false : (await readSignature(backup, { fsLike })) !== null;

  let phase = 'temp';
  try {
    await fsLike.promises.writeFile(temp, bytes);

    if (backup !== null) {
      phase = 'backup';
      await fsLike.promises.copyFile(target, backup);
    }

    phase = 'replace';
    await fsLike.promises.rename(temp, target);

    const saved = await readSignature(target, { fsLike });
    return { ok: true, path: target, backup, bytes: bytes.length, signature: saved };
  } catch (error) {
    // 転んだら、こちらが作ったものは残さない。元からあった .bak には触れない。
    if (backup !== null && !backupExisted)
      await removeQuietly(backup, fsLike);
    return { error: describeWriteFailure(error, phase), code: error?.code ?? null, phase };
  } finally {
    // 成否にかかわらず消す。rename が通っていれば temp はもう無い（確定事項16）。
    await removeQuietly(temp, fsLike);
  }
}

module.exports = {
  TEMP_SUFFIX,
  BACKUP_SUFFIX,
  tempPathFor,
  backupPathFor,
  signatureOf,
  signaturesMatch,
  readSignature,
  describeWriteFailure,
  writeDocument,
};
