'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('jsdom');

// 説明の吹き出し（spec-2-5 J2・J3・J5・J16・J17）の対象が、index.html の要素と文の表（tip-content*.js）の鍵で結ばれていることを照らす。
// 画面の要素に今までの小さな説明（title）が 1 つも残らないこと（決定80 ㊷）も、ここで見る。
// JS が作る要素（帯・タブ・サムネイルの上のボタンなど）は、別のテストが見る。
require('../renderer/tip-content.js');
require('../renderer/tip-content-view.js');
require('../renderer/tip-content-edit.js');
require('../renderer/tip-content-tools.js');

const { tipContent } = globalThis.SigK;
const INDEX_PATH = path.resolve(__dirname, '..', 'index.html');
const loadDocument = () => new JSDOM(fs.readFileSync(INDEX_PATH, 'utf8')).window.document;

// 文の表の「付ける要素」の列のうち、index.html に最初から書いてある要素。[選ぶ式, 鍵]。
const MODES = [['view', 'mode.view'], ['pages', 'mode.pages'], ['annot', 'mode.annot'], ['tools', 'mode.tools']];
const TOOLS = ['select', 'hand', 'highlight', 'underline', 'strikeout', 'text', 'callout', 'pen', 'marker', 'eraser', 'note', 'mosaic', 'trim'];
const SHAPES = ['arrow', 'line', 'square', 'circle', 'cross', 'polygon'];
const STATIC_TARGETS = [
  ['#btn-open', 'bar.open'], ['#btn-save', 'bar.save'], ['#btn-save-as', 'bar.saveAs'], ['#btn-undo', 'bar.undo'], ['#btn-redo', 'bar.redo'],
  ['#btn-pointer-select', 'bar.pointerSelect'], ['#btn-pointer-hand', 'bar.pointerHand'], ['#page-prev', 'bar.pagePrev'], ['#page-next', 'bar.pageNext'],
  ['#zoom-out', 'bar.zoomOut'], ['#zoom-in', 'bar.zoomIn'], ['#btn-fit-width', 'bar.fitWidth'], ['#btn-fit-page', 'bar.fitPage'],
  ['#btn-facing', 'bar.facing'], ['#btn-find', 'bar.find'], ['#btn-print', 'bar.print'], ['#btn-help', 'bar.help'],
  ...MODES.map(([mode, key]) => [`.rail-item[data-mode="${mode}"]`, key]),
  ['.tab-add', 'tab.add'], ['#side-collapse', 'side.collapse'], ['#side-expand', 'side.expand'],
  ['#find-case', 'find.case'], ['#find-prev', 'find.prev'], ['#find-next', 'find.next'], ['#find-close', 'find.close'],
  ['#status-file', 'status.file'], ['#doc-info-close', 'dialog.close'], ['#help-close', 'dialog.close'], ['#print-close', 'dialog.close'],
  ['#split-zoom-close', 'zoom.close'], ['#split-zoom-prev', 'zoom.prev'], ['#split-zoom-next', 'zoom.next'],
  ...TOOLS.map((tool) => [`.edit-tool[data-tool="${tool}"]`, `edit.${tool}`]),
  ...SHAPES.map((shape) => [`.edit-tool[data-shape="${shape}"]`, `edit.${shape}`]),
  ['#edit-more', 'edit.more'], ['#props-format [data-format="bold"]', 'format.bold'], ['#props-format [data-format="italic"]', 'format.italic'],
  ['#image-strip-clear', 'image.clear'], ['#split-undo', 'split.undo'], ['#split-redo', 'split.redo'],
  ['#act-rotate-left', 'pages.rotateLeft'], ['#act-rotate-right', 'pages.rotateRight'], ['#act-extract', 'pages.extract'],
  ['#act-insert', 'pages.insert'], ['#act-delete', 'pages.delete'],
];

// 今まで aria-label が無かった、アイコンだけの要素に足す名前（spec-2-5 J3）。
const ADDED_LABELS = [
  ['#btn-undo', '元に戻す'], ['#btn-redo', 'やり直し'], ['#btn-find', '検索'], ['#btn-print', '印刷'], ['#page-prev', '前のページ'], ['#page-next', '次のページ'],
  ['#zoom-out', '縮小'], ['#zoom-in', '拡大'], ['.tab-add', 'タブを追加'], ['#side-collapse', 'パネルを閉じる'], ['#find-case', '大文字と小文字を区別'],
  ['#find-prev', '前へ'], ['#find-next', '次へ'], ['#find-close', '閉じる'], ['#doc-info-close', '閉じる'], ['#help-close', '閉じる'], ['#print-close', '閉じる'],
];

test('index.html の画面の要素に title が 1 つも無い（決定80 ㊷）', () => {
  const doc = loadDocument();
  assert.deepEqual([...doc.body.querySelectorAll('[title]')].map((node) => node.id || node.className), []);
});

test('index.html に最初から書いてある要素は、文の表のとおりの鍵の data-tip を持つ', () => {
  const doc = loadDocument();
  for (const [selector, key] of STATIC_TARGETS) {
    const nodes = [...doc.querySelectorAll(selector)];
    assert.ok(nodes.length > 0, `${selector} が見つからない`);
    assert.deepEqual(nodes.map((node) => node.dataset.tip), nodes.map(() => key), selector);
  }
});

test('index.html の data-tip は、上の表の要素だけに付き、どれも文の表の鍵で名前を引ける', () => {
  const doc = loadDocument();
  const known = new Set(STATIC_TARGETS.flatMap(([selector]) => [...doc.querySelectorAll(selector)]));
  const tipped = [...doc.querySelectorAll('[data-tip]')];
  assert.deepEqual(tipped.filter((node) => !known.has(node)).map((node) => node.id || node.className), []);
  for (const node of tipped) {
    assert.ok(tipContent.keyList().includes(node.dataset.tip), `${node.id || node.className}: 知らない鍵 ${node.dataset.tip}`);
    assert.ok(tipContent.resolve(node)?.name, node.id || node.className);
  }
});

test('アイコンだけで aria-label が無かった 17 個に、名前の aria-label を足した', () => {
  const doc = loadDocument();
  for (const [selector, label] of ADDED_LABELS)
    assert.equal(doc.querySelector(selector).getAttribute('aria-label'), label, selector);
});

test('今の aria-label は変えない（読み上げの名前と使い方の窓の文がずれるため）', () => {
  const doc = loadDocument();
  assert.equal(doc.getElementById('side-expand').getAttribute('aria-label'), 'サイドパネルを開く');
  assert.equal(doc.getElementById('btn-help').getAttribute('aria-label'), '使い方');
  assert.equal(doc.getElementById('btn-fit-width').getAttribute('aria-label'), '幅に合わせる');
  assert.equal(doc.getElementById('btn-facing').getAttribute('aria-label'), '見開き表示');
  assert.equal(doc.getElementById('image-strip-clear').getAttribute('aria-label'), 'すべて外す');
});

test('文字の無い data-tip の要素（アイコンだけ）は、どれも aria-label を持つ', () => {
  const doc = loadDocument();
  const iconOnly = [...doc.querySelectorAll('[data-tip]')].filter((node) => node.textContent.trim() === '');
  assert.ok(iconOnly.length >= 40, 'アイコンだけの要素が少なすぎる');
  assert.deepEqual(iconOnly.filter((node) => !node.getAttribute('aria-label')).map((node) => node.id || node.className), []);
});
