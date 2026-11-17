'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT } = require('./harness.js');

// ボタンのカーソル（docs/07 決定97 ①）。押せるボタンは指差し、押せない時と画面の枠の文字は矢印、入力欄は I 型のまま。
// jsdom は CSS ファイルを読まないので、規則は文字で見張る。実際のカーソルは、起動確認で getComputedStyle(要素).cursor を読む。

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 行頭から始まる selector{...} の中身。
function ruleBody(css, selector) {
  return new RegExp(`(?:^|\\n)${escapeRe(selector)}\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

test('button の基本の規則は、カーソルを指定しない（:where() の規則より詳細度が高く、指差しを打ち消すため）', () => {
  const body = ruleBody(read('renderer', 'shell.css'), 'button');
  assert.notEqual(body, null, 'button の規則');
  assert.ok(!body.includes('cursor'), body);
});

test('押せるボタンは指差し、押せない時と画面の枠の文字は矢印、入力欄は I 型のまま（shell.css）', () => {
  const css = read('renderer', 'shell.css');
  // 詳細度がどれも 0 なので、後に書いた規則が勝つ。矢印 → 指差し → 押せない時の矢印 → 入力欄、の順番を守る。
  const rules = [
    ':where(#toolbar, #edit-bar, #rail, #tabbar, #status, .side-head, .thumb, dialog.pd, label){cursor:default}',
    ':where(button, [role="button"], .tb-btn, .rail-item, .pager .step, .zoom .step, .tab-add, #side-collapse){cursor:pointer}',
    ':where(button:disabled, [aria-disabled="true"], [aria-disabled="true"] *){cursor:default}',
    ':where(input, textarea, select){cursor:auto}',
  ];
  let previous = -1;
  for (const rule of rules) {
    const at = css.indexOf(rule);
    assert.ok(at >= 0, rule);
    assert.ok(at > previous, `順番: ${rule}`);
    previous = at;
  }
});

test('規則が指す要素が index.html にある（名前を変更した時に、規則だけが残らないように）', () => {
  const html = read('index.html');
  for (const id of ['toolbar', 'edit-bar', 'rail', 'tabbar', 'status', 'side-collapse'])
    assert.ok(html.includes(`id="${id}"`), id);
  for (const name of ['tb-btn', 'rail-item', 'step', 'tab-add', 'side-head'])
    assert.ok(new RegExp(`class="(?:[^"]* )?${escapeRe(name)}(?: [^"]*)?"`).test(html), name);
  assert.ok(/<dialog [^>]*class="pd"/.test(html), 'dialog.pd（印刷画面）');
});

test('印刷画面のボタンは、押せる時は指差し・押せない時は矢印。ⓘ も指差し（print-dialog.css）', () => {
  const css = read('renderer', 'print-dialog.css');
  assert.match(ruleBody(css, '.pd-btn') ?? '', /cursor:pointer/);
  assert.match(ruleBody(css, '.pd-btn:disabled') ?? '', /cursor:default/);
  assert.match(ruleBody(css, '.pd-info') ?? '', /cursor:pointer/);
});
