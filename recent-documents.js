'use strict';

// 最近使ったファイルの履歴。純粋なリスト操作だけを持つ（spec-1-2 確定事項8）。
// Electron も fs も require しない。依存なしで回るテスト層に置くためで
// （docs/07 第4章）、file-io.js・security-policy.js と同じ作法である。
//
// 時刻はここで採らない。呼び出し側が openedAt を渡す。テストを決定的にするため。

const MAX_RECENT = 10;

// Windows のパスは大文字小文字を区別しない。区切りも円記号とスラッシュが
// 混ざり得る（ダイアログは円記号、コマンドライン引数はスラッシュで届くことがある）。
// 同じファイルが2件並ばないよう、比較用の鍵に揃える。
function pathKey(filePath) {
  return filePath.replace(/\//g, '\\').toLowerCase();
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function normalizeEntry(raw) {
  if (typeof raw !== 'object' || raw === null)
    return null;
  if (!isNonEmptyString(raw.path))
    return null;
  return {
    path: raw.path,
    // 名前が欠けていてもパスは残っている。パスの末尾から作り直す。
    name: isNonEmptyString(raw.name) ? raw.name : raw.path.split(/[\\/]/).pop(),
    openedAt: isNonEmptyString(raw.openedAt) ? raw.openedAt : null,
  };
}

// 壊れた settings.json から読んでもここで必ず配列になる。
function normalizeList(raw) {
  if (!Array.isArray(raw))
    return [];

  const seen = new Set();
  const list = [];
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (entry === null)
      continue;
    const key = pathKey(entry.path);
    if (seen.has(key))
      continue;
    seen.add(key);
    list.push(entry);
    if (list.length >= MAX_RECENT)
      break;
  }
  return list;
}

// 新しいものを先頭へ。同じパスが既にあれば、そちらを消してから足す。
function addRecent(list, raw) {
  const entry = normalizeEntry(raw);
  if (entry === null)
    return normalizeList(list);
  return normalizeList([entry, ...(Array.isArray(list) ? list : [])]);
}

function removeRecent(list, filePath) {
  if (!isNonEmptyString(filePath))
    return normalizeList(list);
  const key = pathKey(filePath);
  return normalizeList(list).filter((entry) => pathKey(entry.path) !== key);
}

module.exports = { MAX_RECENT, pathKey, normalizeEntry, normalizeList, addRecent, removeRecent };
