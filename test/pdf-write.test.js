'use strict';

// 元ファイルを壊さずに置き換える層のテスト（spec-1-6 確定事項15〜21）。
//
// 実際のディスクに書く。一時フォルダーを毎回作って捨てるので、ユーザーの
// ファイルには一切触れない（.claude/CLAUDE.md 付則C）。
// 失敗の経路だけは、その場では起こせないので fs を差し替えて作る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  tempPathFor,
  backupPathFor,
  signaturesMatch,
  readSignature,
  describeWriteFailure,
  writeDocument,
} = require('../pdf-write.js');

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-write-'));
  return {
    dir,
    file: (name) => path.join(dir, name),
    seed: (name, text) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, text);
      return p;
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// 指定した操作だけを失敗させる fs。ほかは本物へ通す。
function failingFs(operation, code) {
  const error = Object.assign(new Error(`injected ${code}`), { code });
  return {
    promises: new Proxy(fs.promises, {
      get(target, name) {
        if (name === operation)
          return () => Promise.reject(error);
        return target[name].bind(target);
      },
    }),
  };
}

const bytes = (text) => Buffer.from(text, 'utf8');

test('一時ファイルと .bak の名前は元の名前に足す形になる', () => {
  assert.equal(tempPathFor('C:\work\a.pdf'), 'C:\work\a.pdf.sigk-tmp');
  assert.equal(backupPathFor('C:\work\a.pdf'), 'C:\work\a.pdf.bak');
});

test('片方の署名を知らないときは食い違いと見なさない', () => {
  const sig = { size: 10, mtimeMs: 1 };
  assert.equal(signaturesMatch(null, sig), true);
  assert.equal(signaturesMatch(sig, null), true);
  assert.equal(signaturesMatch(sig, { size: 10, mtimeMs: 1 }), true);
  assert.equal(signaturesMatch(sig, { size: 11, mtimeMs: 1 }), false);
  assert.equal(signaturesMatch(sig, { size: 10, mtimeMs: 2 }), false);
});

test('新しいファイルへ書ける。.bak は作らない', async () => {
  const ws = workspace();
  try {
    const target = ws.file('new.pdf');
    const result = await writeDocument(target, bytes('NEW'), { makeBackup: true });
    assert.equal(result.ok, true);
    assert.equal(result.backup, null, '元が無いので退避するものが無い');
    assert.equal(fs.readFileSync(target, 'utf8'), 'NEW');
    assert.equal(fs.existsSync(backupPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('上書きすると .bak に元の内容が残る', async () => {
  const ws = workspace();
  try {
    const target = ws.seed('a.pdf', 'OLD');
    const result = await writeDocument(target, bytes('NEW'), { makeBackup: true });
    assert.equal(result.ok, true);
    assert.equal(result.backup, backupPathFor(target));
    assert.equal(fs.readFileSync(target, 'utf8'), 'NEW');
    assert.equal(fs.readFileSync(backupPathFor(target), 'utf8'), 'OLD');
  } finally { ws.cleanup(); }
});

test('名前を付けて保存（makeBackup なし）では .bak を作らない', async () => {
  const ws = workspace();
  try {
    const target = ws.seed('a.pdf', 'OLD');
    const result = await writeDocument(target, bytes('NEW'), { makeBackup: false });
    assert.equal(result.ok, true);
    assert.equal(result.backup, null);
    assert.equal(fs.existsSync(backupPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('.bak は世代を持たず、前のものを上書きする', async () => {
  const ws = workspace();
  try {
    const target = ws.seed('a.pdf', 'ONE');
    await writeDocument(target, bytes('TWO'), { makeBackup: true });
    await writeDocument(target, bytes('THREE'), { makeBackup: true });
    assert.equal(fs.readFileSync(backupPathFor(target), 'utf8'), 'TWO');
    assert.equal(fs.readdirSync(ws.dir).length, 2, 'a.pdf と a.pdf.bak の2つだけ');
  } finally { ws.cleanup(); }
});

test('成功しても一時ファイルは残らない', async () => {
  const ws = workspace();
  try {
    const target = ws.seed('a.pdf', 'OLD');
    await writeDocument(target, bytes('NEW'), { makeBackup: true });
    assert.equal(fs.existsSync(tempPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('開いたあとで外から書き換えられていたら、書かずに知らせる', async () => {
  const ws = workspace();
  try {
    const target = ws.seed('a.pdf', 'OLD');
    const opened = await readSignature(target);
    fs.writeFileSync(target, 'CHANGED BY SOMEONE ELSE');

    const result = await writeDocument(target, bytes('NEW'), { makeBackup: true, expect: opened });
    assert.equal(result.changed, true);
    assert.equal(result.ok, undefined);
    assert.equal(fs.readFileSync(target, 'utf8'), 'CHANGED BY SOMEONE ELSE', '書いていない');
    assert.equal(fs.existsSync(backupPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('署名が一致していれば、そのまま書く', async () => {
  const ws = workspace();
  try {
    const target = ws.seed('a.pdf', 'OLD');
    const opened = await readSignature(target);
    const result = await writeDocument(target, bytes('NEW'), { makeBackup: true, expect: opened });
    assert.equal(result.ok, true);
  } finally { ws.cleanup(); }
});

test('置き換えに失敗しても元ファイルは無傷で、一時ファイルも残らない', async () => {
  const ws = workspace();
  try {
    const target = ws.seed('a.pdf', 'OLD');
    const result = await writeDocument(target, bytes('NEW'), {
      makeBackup: false,
      fsLike: failingFs('rename', 'EPERM'),
    });
    assert.equal(result.error, 'ファイルが他のプログラムで使われています。閉じてからもう一度お試しください。');
    assert.equal(result.phase, 'replace');
    assert.equal(fs.readFileSync(target, 'utf8'), 'OLD');
    assert.equal(fs.existsSync(tempPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('.bak を作れなかったら保存そのものを中止する', async () => {
  const ws = workspace();
  try {
    const target = ws.seed('a.pdf', 'OLD');
    const result = await writeDocument(target, bytes('NEW'), {
      makeBackup: true,
      fsLike: failingFs('copyFile', 'EACCES'),
    });
    assert.equal(result.phase, 'backup');
    assert.match(result.error, /バックアップ/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'OLD', '元ファイルを触っていない');
    assert.equal(fs.existsSync(tempPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('空き容量が足りないときは、そう言う', async () => {
  const ws = workspace();
  try {
    const target = ws.file('a.pdf');
    const result = await writeDocument(target, bytes('NEW'), { fsLike: failingFs('writeFile', 'ENOSPC') });
    assert.equal(result.error, 'ディスクの空き容量が足りません。');
    assert.equal(result.phase, 'temp');
  } finally { ws.cleanup(); }
});

test('段によって文言を変える', () => {
  const busy = { code: 'EPERM' };
  assert.match(describeWriteFailure(busy, 'replace'), /他のプログラムで使われています/);
  assert.match(describeWriteFailure(busy, 'temp'), /書き込む権限がありません/);
  assert.match(describeWriteFailure({ code: 'EROFS' }, 'temp'), /書き込みできない場所/);
  assert.match(describeWriteFailure({}, 'temp'), /保存できませんでした/);
});

test('無いファイルの署名は null になる', async () => {
  const ws = workspace();
  try {
    assert.equal(await readSignature(ws.file('nope.pdf')), null);
  } finally { ws.cleanup(); }
});
