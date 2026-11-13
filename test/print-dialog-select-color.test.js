'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 印刷画面の選択欄（.pd-select）を開いたとき、一覧の項目の文字が見えること（2026-11-13 のユーザーの指摘「プリンタ選択画面のドロップダウンの
// 文字が真っ白で見えません」）。.pd-select:focus は選んだ項目を青で塗るために文字を白にするので、一覧の項目（option）の文字色と背景色を
// 別に決めておかないと、白い文字が項目に引き継がれ、白い背景の上で見えなくなる。jsdom は外部の CSS を当てないので、CSS の文を読んで確かめる
// （Chromium で :focus を当てたときの計算後の色は、起動確認で rgb(0, 0, 0) / rgb(255, 255, 255) になることを確かめた）。

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'print-dialog.css'), 'utf8');

function declarationsOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match === null ? null : match[1];
}

test('選択欄にフォーカスがある間は文字を白にし、一覧の項目は黒い文字・白い背景にする', () => {
  assert.match(declarationsOf('.pd-select:focus') ?? '', /color:#fff/, '前提: フォーカスのある間は白い文字');
  const option = declarationsOf('.pd-select option');
  assert.notEqual(option, null, '.pd-select option の指定が無い');
  assert.match(option, /(^|;)\s*color:#000/);
  assert.match(option, /background-color:#fff/);
});
