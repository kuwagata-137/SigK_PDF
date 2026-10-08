'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/help-content-edit.js');
require('../renderer/help-content.js');
const content = globalThis.SigK.helpContent;

// 使い方の窓の中身（spec-4b-7b 確定事項D・付録）。編集モードの 7 節は help-content-edit.test.js が見る。

// 中身の文を全部集める（題・導入・見出し・箇条書き・表のセル）。
function textsOf(section) {
  const texts = [section.title, section.lead ?? ''];
  for (const block of section.blocks)
    texts.push(block.h ?? '', ...(block.items ?? []), ...(block.table ?? []).flat());
  return texts;
}

function sectionOf(id) {
  return content.SECTIONS.find((section) => section.id === id);
}

function joined(id) {
  return textsOf(sectionOf(id)).join('\n');
}

const KEY_NAMES = new Set(['Ctrl', 'Shift', 'Esc', 'Enter', 'Delete', 'Backspace', 'Tab', 'PageUp', 'PageDown', 'Home', 'End',
  'F1', 'F3', 'A', 'C', 'F', 'I', 'O', 'P', 'S', 'W', 'Y', 'Z', '0', '+', '-']);

test('目次は 5 つのグループと 13 の節で、グループの順に並ぶ', () => {
  assert.equal(content.TITLE, 'SigK PDF の使い方');
  assert.deepEqual(content.GROUPS.map((group) => group.label), ['はじめに', '閲覧・ページ編集', '編集（書き込み）', 'ツール', '一覧']);
  assert.deepEqual(content.SECTIONS.map((section) => section.id), [
    'basics', 'view', 'pages', 'select', 'markup', 'text', 'shapes', 'pen', 'note', 'mosaic-trim', 'tools', 'keys', 'escape',
  ]);
  const groupIds = content.GROUPS.map((group) => group.id);
  const order = content.SECTIONS.map((section) => groupIds.indexOf(section.group));
  assert.ok(order.every((index) => index >= 0), 'どのグループにも入らない節がある');
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('どの節にも題と中身があり、表の行は列の数がそろう', () => {
  for (const section of content.SECTIONS) {
    assert.ok(section.title.length > 0, section.id);
    assert.ok(section.blocks.length > 0, section.id);
    for (const block of section.blocks) {
      assert.ok(block.items !== undefined || block.table !== undefined, `${section.id} に中身の無い見出しがある`);
      for (const row of block.table ?? [])
        assert.equal(row.length, block.table[0].length, `${section.id} の表の行: ${row[0]}`);
    }
  }
});

test('キーの書き方 [キー] は閉じていて、決めた名前だけを使う', () => {
  for (const section of content.SECTIONS) {
    for (const text of textsOf(section)) {
      const rest = text.replace(/\[([^[\]]+)\]/g, (_whole, name) => {
        assert.ok(KEY_NAMES.has(name), `${section.id} に知らないキーがある: ${name}`);
        return '';
      });
      assert.ok(!/[[\]]/.test(rest), `${section.id} の [ ] が閉じていない: ${text}`);
      // 要素にしたい文字を混ぜない（help-render.js は textContent で組むので、混ぜてもそのまま文字で出る）。
      assert.ok(!/[<>]/.test(text), `${section.id} に < > がある: ${text}`);
    }
  }
});

test('計画外の直しのあとの動きで書いてある', () => {
  // ① Ctrl＋クリック・Shift＋クリックで複数のページを選べる。
  assert.match(joined('pages'), /\[Ctrl\] を押しながらクリックすると 1 枚ずつ足す・外す/);
  // ② 閉じた左のパネルは「＞」で開く。⑥ ツールモードで開くと閲覧モードへ移る。
  assert.match(joined('basics'), /「＞」で開きます/);
  assert.match(joined('basics'), /ツールモードで開くと、閲覧モードへ移ります/);
  // ④⑤ Ctrl+Shift+Z はやり直し。文字を打つ欄の中では欄の文字を戻す。
  const keys = content.SECTIONS.find((section) => section.id === 'keys').blocks[0].table;
  const redo = keys.find((row) => row[0].includes('[Ctrl]+[Shift]+[Z]'));
  assert.equal(redo[1], 'やり直し');
  assert.match(keys.find((row) => row[0] === '[Ctrl]+[Z]')[2], /文字を打つ欄の中では、欄の文字を戻す/);
});

test('キー操作の表に F1 があり、Esc の順は 10 段で窓が先頭', () => {
  const keys = sectionOf('keys').blocks[0].table;
  assert.deepEqual(keys.find((row) => row[0] === '[F1]'), ['[F1]', 'この使い方を開く', 'いつでも']);
  const order = sectionOf('escape').blocks[0].table.slice(1);
  assert.deepEqual(order.map((row) => row[0]), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.match(order[0][1], /^窓/);
  assert.match(order[9][1], /^道具を外す/);
});

test('倍率の段は、表示の倍率の段（viewer-layout.js の ZOOM_STEPS）と同じ', () => {
  require('../renderer/viewer-layout.js');
  const steps = globalThis.SigK.viewerLayout.ZOOM_STEPS.map((zoom) => Math.round(zoom * 100)).join('・');
  assert.ok(joined('view').includes(`段は ${steps}% です`), steps);
});
