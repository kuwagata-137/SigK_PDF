'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// 使い方の窓の中身から DOM を組む部品（spec-4b-7b 確定事項B1・D3）。

function makeWorld() {
  const dom = new JSDOM('<!doctype html><div id="out"></div>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.SigK = {};
  for (const name of ['help-content-edit', 'help-content', 'help-render'])
    win.eval(fs.readFileSync(path.join(__dirname, '..', 'renderer', `${name}.js`), 'utf8'));
  return { doc: win.document, render: win.SigK.helpRender, content: win.SigK.helpContent };
}

function inline(world, text) {
  return world.render.appendInline(world.doc, world.doc.createElement('span'), text);
}

test('[Ctrl]+[Z] は 2 つの <kbd> を「+」でつなぐ', () => {
  const span = inline(makeWorld(), '[Ctrl]+[Z] で元に戻します。');
  assert.deepEqual([...span.querySelectorAll('kbd')].map((kbd) => kbd.textContent), ['Ctrl', 'Z']);
  assert.equal(span.textContent, 'Ctrl+Z で元に戻します。');
  assert.equal(span.childNodes[1].nodeType, 3);
  assert.equal(span.childNodes[1].textContent, '+');
});

test('[ ] の無い文はそのまま。全角の［］はキーにしない', () => {
  const span = inline(makeWorld(), '右パネルの［適用］で切ります。');
  assert.equal(span.querySelectorAll('kbd').length, 0);
  assert.equal(span.textContent, '右パネルの［適用］で切ります。');
});

test('< や & を含む文も、要素にならず文字のまま出る', () => {
  const span = inline(makeWorld(), '<b>太字</b> & [Esc]');
  assert.equal(span.querySelector('b'), null);
  assert.equal(span.textContent, '<b>太字</b> & Esc');
});

test('節の本文は、題・導入・見出し・箇条書き・表の順に組む', () => {
  const world = makeWorld();
  const shapes = world.content.SECTIONS.find((section) => section.id === 'shapes');
  const nodes = world.render.section(world.doc, shapes);
  assert.equal(nodes[0].tagName, 'H3');
  assert.equal(nodes[0].textContent, shapes.title);
  assert.equal(nodes[1].className, 'help-lead');
  assert.deepEqual(nodes.slice(2).map((node) => node.tagName), shapes.blocks.flatMap(() => ['H4', 'UL']));
  // 見出しの中のキーも <kbd> にする。
  const shiftHead = nodes.find((node) => node.tagName === 'H4' && node.textContent.startsWith('Shift'));
  assert.equal(shiftHead.querySelector('kbd').textContent, 'Shift');
  assert.equal(nodes[3].querySelectorAll('li').length, shapes.blocks[0].items.length);
});

test('表は先頭の行を見出し（th）にし、残りを td にする', () => {
  const world = makeWorld();
  const keys = world.content.SECTIONS.find((section) => section.id === 'keys');
  const tables = world.render.section(world.doc, keys).filter((node) => node.tagName === 'TABLE');
  assert.equal(tables.length, 2);
  const [first] = tables;
  assert.deepEqual([...first.querySelectorAll('thead th')].map((th) => th.textContent), ['キー', 'すること', '効く所']);
  assert.equal(first.querySelectorAll('tbody tr').length, keys.blocks[0].table.length - 1);
  assert.equal(first.querySelector('tbody td kbd').textContent, 'F1');
});

test('目次は、グループの見出しと節のボタンを、グループの順に並べる', () => {
  const world = makeWorld();
  const nodes = world.render.nav(world.doc, world.content);
  assert.equal(nodes.filter((node) => node.className === 'help-grp').length, 5);
  const buttons = nodes.filter((node) => node.tagName === 'BUTTON');
  assert.equal(buttons.length, 13);
  assert.ok(buttons.every((button) => button.type === 'button' && button.className === 'help-item'));
  assert.deepEqual(buttons.map((button) => button.dataset.section), world.content.SECTIONS.map((section) => section.id));
  assert.equal(nodes[0].textContent, 'はじめに');
  assert.equal(nodes[1].textContent, '画面とモード');
});
