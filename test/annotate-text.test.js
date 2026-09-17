'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// テキスト注釈の指揮と入力欄（spec-4-2 確定事項1〜9・15〜21）。
//
// jsdom には canvas が無いので、幅は free-text-shape の見積もり（全角 1em・半角 0.5em）で
// 決まる。座標の計算そのものは free-text-geometry.test.js が見る。

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

// 自分で付けた FreeText（/DA が SigKJP）と、他のツールの FreeText（Helv）。
const OWN_TEXT = {
  id: '120R', subtype: 'FreeText', rect: [100, 700, 165, 720.5], rotation: 0,
  contentsObj: { str: 'よみこみ\nテキスト', dir: 'ltr' },
  defaultAppearanceData: { fontName: 'SigKJP', fontSize: 12, fontColor: new Uint8ClampedArray([217, 44, 44]) },
};
const OTHER_TEXT = {
  id: '121R', subtype: 'FreeText', rect: [100, 600, 300, 640], rotation: 0,
  contentsObj: { str: 'other', dir: 'ltr' },
  defaultAppearanceData: { fontName: 'Helv', fontSize: 12, fontColor: new Uint8ClampedArray([0, 0, 0]) },
};

async function withShell(t, options = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub(options.stub ?? {}),
    files: {
      [A]: makeSource({ path: A, name: 'a.pdf' }),
      [B]: makeSource({ path: B, name: 'b.pdf' }),
    },
    ...options,
  });
  t.after(() => shell.cleanup());
  return shell;
}

async function withTextTool(t, options = {}) {
  const shell = await withShell(t, options);
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool('text');
  return shell;
}

function pageNode(shell, index) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function mouse(shell, type, target, x, y) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}

// pt の点でページを押して離す（動かさない）。
function clickAt(shell, index, x, y) {
  const page = pageNode(shell, index);
  const [cx, cy] = shell.SigK.viewer.getTextLayer(index).viewport.convertToViewportPoint(x, y);
  mouse(shell, 'mousedown', page, cx, cy);
  mouse(shell, 'mouseup', page, cx, cy);
}

function editorNode(shell) {
  return shell.document.querySelector('textarea.free-text-editor');
}

function typeText(shell, text) {
  const node = editorNode(shell);
  node.value = text;
  node.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
}

function key(shell, target, options) {
  const event = new shell.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

// 置いて打って、枠の外を押して確定する。
function placeAndCommit(shell, { x = 100, y = 700, text = 'こんにちは' } = {}) {
  clickAt(shell, 0, x, y);
  typeText(shell, text);
  mouse(shell, 'mousedown', shell.document.getElementById('view'), 5, 5);
  mouse(shell, 'mouseup', shell.document.getElementById('view'), 5, 5);
  return shell.SigK.viewer.getAnnotations().added.at(-1);
}

const plain = (value) => structuredClone(value);

// ---- 置く・確定（確定事項3・4） ----

test('テキストの道具で紙を押すと入力欄が開き、枠の外を押すと注釈になる', async (t) => {
  const shell = await withTextTool(t);
  const { SigK, document } = shell;
  assert.equal(document.documentElement.getAttribute('data-tool'), 'text');
  clickAt(shell, 0, 100, 700);
  const node = editorNode(shell);
  assert.ok(node !== null);
  assert.equal(SigK.freeTextEditor.isEditing(), true);
  assert.equal(document.activeElement, node);
  // 倍率（zoom × CSS_UNITS）を掛けた px で置く
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const scale = viewport.scale;
  assert.equal(parseFloat(node.style.fontSize), 12 * scale);
  assert.equal(node.style.color, 'rgb(28, 36, 48)');
  // 左上は押した点から枠線ぶんだけ外側
  const [px, py] = viewport.convertToViewportPoint(100, 700);
  assert.equal(parseFloat(node.style.left), px - SigK.freeTextEditor.BORDER);
  assert.equal(parseFloat(node.style.top), py - SigK.freeTextEditor.BORDER);

  typeText(shell, 'こんにちは\n世界');
  // 幅は最長行（5 文字 × 12pt）、高さは 2 行 × 15pt（余白は padding で持つ）
  assert.equal(parseFloat(node.style.width), 60 * scale);
  assert.equal(parseFloat(node.style.height), 30 * scale);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);

  mouse(shell, 'mousedown', document.getElementById('view'), 5, 5);
  mouse(shell, 'mouseup', document.getElementById('view'), 5, 5);
  assert.equal(editorNode(shell), null);
  const annots = SigK.viewer.getAnnotations();
  assert.equal(annots.added.length, 1);
  const entry = annots.added[0];
  assert.equal(entry.kind, 'text');
  assert.equal(entry.text, 'こんにちは\n世界');
  assert.equal(entry.fontSize, 12);
  assert.equal(entry.color, '#1c2430');
  assert.equal(entry.rotation, 0);
  assert.equal(entry.src, 0);
  assert.deepEqual(plain(entry.rect), [100, 700 - 34, 164, 700]);
  assert.deepEqual(plain(entry.quads), [[100, 700, 164, 700, 100, 666, 164, 666]]);
  // 確定した注釈が選ばれ、履歴に 1 世代積まれ、未保存になる
  assert.equal(SigK.annotate.getSelected(), entry.id);
  assert.equal(SigK.pageEdit.canUndo(), true);
  assert.equal(SigK.viewer.isDirty(), true);
  // 紙の上に <text> が描かれる
  const texts = [...pageNode(shell, 0).querySelectorAll('.annot-layer g[data-kind="text"] text')];
  assert.deepEqual(texts.map((el) => el.textContent), ['こんにちは', '世界']);
  // 確定に使った押し離しは、新しい入力欄を開かない
  assert.equal(editorNode(shell), null);
});

test('Esc と Ctrl+Enter でも確定し、空なら注釈を作らない', async (t) => {
  const shell = await withTextTool(t);
  const { SigK } = shell;
  clickAt(shell, 0, 100, 700);
  typeText(shell, 'A');
  key(shell, editorNode(shell), { key: 'Escape' });
  assert.equal(editorNode(shell), null);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);

  clickAt(shell, 0, 100, 500);
  typeText(shell, 'B');
  key(shell, editorNode(shell), { key: 'Enter', ctrlKey: true });
  assert.equal(SigK.viewer.getAnnotations().added.length, 2);

  clickAt(shell, 0, 100, 300);
  typeText(shell, '  \n ');
  key(shell, editorNode(shell), { key: 'Escape' });
  assert.equal(SigK.viewer.getAnnotations().added.length, 2);
  assert.equal(SigK.freeTextEditor.isEditing(), false);
});

test('IME の変換中の Enter と Esc は入力欄に任せる', async (t) => {
  const shell = await withTextTool(t);
  clickAt(shell, 0, 100, 700);
  typeText(shell, 'にほんご');
  const node = editorNode(shell);
  const esc = key(shell, node, { key: 'Escape', isComposing: true });
  assert.equal(esc.defaultPrevented, false);
  assert.equal(shell.SigK.freeTextEditor.isEditing(), true);
  key(shell, node, { key: 'Enter', ctrlKey: true, keyCode: 229 });
  assert.equal(shell.SigK.freeTextEditor.isEditing(), true);
  // 素の Enter は改行（奪わない）
  const enter = key(shell, node, { key: 'Enter' });
  assert.equal(enter.defaultPrevented, false);
  assert.equal(shell.SigK.freeTextEditor.isEditing(), true);
});

test('入力欄の中のキーはビューアが奪わない（Ctrl+Z・Delete・Esc・PageDown）', async (t) => {
  const shell = await withTextTool(t);
  const { SigK } = shell;
  placeAndCommit(shell, { text: '一つ目' });
  clickAt(shell, 0, 100, 500);
  typeText(shell, '二つ目');
  const node = editorNode(shell);
  const undo = key(shell, node, { key: 'z', ctrlKey: true });
  assert.equal(undo.defaultPrevented, false);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  const del = key(shell, node, { key: 'Delete' });
  assert.equal(del.defaultPrevented, false);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  const pageDown = key(shell, node, { key: 'PageDown' });
  assert.equal(pageDown.defaultPrevented, false);
  assert.equal(SigK.freeTextEditor.isEditing(), true);
});

test('右端をはみ出す箱は紙の中へ寄せる', async (t) => {
  const shell = await withTextTool(t);
  const entry = placeAndCommit(shell, { x: 580, y: 700, text: 'ながいながいテキスト' });
  // 幅 10 文字 × 12 ＋ 4 = 124pt。右端 595.28 に収まる位置まで左へ
  assert.equal(entry.rect[2], Math.round(595.28 * 100) / 100);
  assert.equal(entry.rect[0], Math.round((595.28 - 124) * 100) / 100);
});

// ---- 直す（確定事項5） ----

test('ダブルクリックで入力欄が開き、直して確定すると 1 世代、変えなければ積まない', async (t) => {
  const shell = await withTextTool(t);
  const { SigK, document } = shell;
  const entry = placeAndCommit(shell);
  SigK.annotate.setTool(null);
  const page = pageNode(shell, 0);
  const [cx, cy] = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(110, 690);
  mouse(shell, 'dblclick', page, cx, cy);
  const node = editorNode(shell);
  assert.ok(node !== null);
  assert.equal(node.value, 'こんにちは');
  assert.equal(SigK.freeTextEditor.editingKey(), entry.id);
  // 編集中は SVG に描かない
  assert.equal(page.querySelector('.annot-layer g[data-kind="text"]'), null);

  key(shell, node, { key: 'Escape' });
  assert.equal(SigK.pageEdit.getHistoryState().at, 1);
  assert.equal(SigK.viewer.getAnnotations().added[0].text, 'こんにちは');
  assert.ok(page.querySelector('.annot-layer g[data-kind="text"]') !== null);

  mouse(shell, 'dblclick', page, cx, cy);
  typeText(shell, 'さようなら！');
  key(shell, editorNode(shell), { key: 'Escape' });
  const updated = SigK.viewer.getAnnotations().added[0];
  assert.equal(updated.id, entry.id);
  assert.equal(updated.text, 'さようなら！');
  assert.equal(updated.rect[2], 100 + 6 * 12 + 4);
  assert.equal(SigK.pageEdit.getHistoryState().at, 2);
  assert.equal(SigK.annotate.getSelected(), entry.id);

  // Enter でも開く（選んでいるとき）
  key(shell, document.body, { key: 'Enter' });
  assert.ok(editorNode(shell) !== null);
  // 空にして確定すると消える
  typeText(shell, '');
  key(shell, editorNode(shell), { key: 'Escape' });
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.annotate.getSelected(), null);
  assert.equal(SigK.pageEdit.getHistoryState().at, 3);
});

// ---- 動かす（確定事項6） ----

test('選んだテキストを掴んで動かすと 1 世代で位置が変わる', async (t) => {
  const shell = await withTextTool(t);
  const { SigK } = shell;
  const entry = placeAndCommit(shell);
  const page = pageNode(shell, 0);
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const [sx, sy] = viewport.convertToViewportPoint(110, 690);
  const down = new shell.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy });
  page.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(SigK.annotatePointer.isDragging(), true);
  // 紙の座標で右へ 30pt・下へ 20pt（画面では倍率を掛けた px）
  const dx = 30 * viewport.scale;
  const dy = 20 * viewport.scale;
  mouse(shell, 'mousemove', page, sx + dx, sy + dy);
  const preview = /^translate\(([-\d.]+)px, ([-\d.]+)px\)$/.exec(page.querySelector(`.annot-layer g[data-annot="${entry.id}"]`).style.transform);
  assert.ok(preview !== null);
  assert.ok(Math.abs(Number(preview[1]) - dx) < 0.01 && Math.abs(Number(preview[2]) - dy) < 0.01);
  mouse(shell, 'mouseup', page, sx + dx, sy + dy);
  const moved = SigK.viewer.getAnnotations().added[0];
  assert.deepEqual(plain(moved.rect), [130, 700 - 20 - 19, 194, 700 - 20]);
  assert.equal(SigK.pageEdit.getHistoryState().at, 2);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  // 動かさずに離せば何も積まない
  mouse(shell, 'mousedown', page, sx + dx, sy + dy);
  mouse(shell, 'mouseup', page, sx + dx + 1, sy + dy);
  assert.equal(SigK.pageEdit.getHistoryState().at, 2);
});

// ---- 文字の大きさと色（確定事項2・21） ----

test('文字の大きさは選んだ注釈を変え、次に置く大きさとして覚える', async (t) => {
  const shell = await withTextTool(t);
  const { SigK, document } = shell;
  const select = document.getElementById('props-size');
  assert.equal(document.getElementById('props-size-row').hidden, false);
  assert.equal(select.value, '12');
  assert.deepEqual([...select.options].map((o) => Number(o.value)), [...SigK.annotationPresets.FONT_SIZES]);

  const entry = placeAndCommit(shell);
  select.value = '18';
  select.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  const bigger = SigK.viewer.getAnnotations().added[0];
  assert.equal(bigger.fontSize, 18);
  assert.equal(bigger.rect[2], 100 + 5 * 18 + 4);
  assert.equal(SigK.pageEdit.getHistoryState().at, 2);
  assert.equal(SigK.annotate.getFontSize(), 18);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotFontSize: 18 });

  SigK.annotate.select(null);
  const next = placeAndCommit(shell, { y: 400, text: 'x' });
  assert.equal(next.fontSize, 18);
  assert.equal(entry.id !== next.id, true);
  assert.equal(SigK.annotate.setFontSize(13), false);
});

test('覚えた文字の大きさは起動時に戻り、色の丸はテキストの色を変える', async (t) => {
  const shell = await withTextTool(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotColors: { text: '#2c5cd9' }, annotFontSize: 24 } });
  const { SigK, document } = shell;
  await shell.flush();
  assert.equal(SigK.annotate.getFontSize(), 24);
  assert.equal(SigK.annotate.colorOf('text'), '#2c5cd9');
  const entry = placeAndCommit(shell);
  assert.equal(entry.fontSize, 24);
  assert.equal(entry.color, '#2c5cd9');
  const swatches = [...document.querySelectorAll('#props-colors .swatch')];
  assert.deepEqual(swatches.map((s) => s.dataset.color), ['#1c2430', '#d92c2c', '#2c5cd9']);
  swatches[1].click();
  assert.equal(SigK.viewer.getAnnotations().added[0].color, '#d92c2c');
  assert.equal(document.getElementById('props-text-label').textContent, '本文');
  assert.equal(document.getElementById('props-text').textContent, '「こんにちは」');
  assert.match(document.getElementById('props-hint').textContent, /ダブルクリック/);
});

// ---- 生き残り・履歴・モード（確定事項8・9・20） ----

test('倍率を変えて枠が捨てられても下書きは残り、枠が戻ると入力欄が戻る', async (t) => {
  const shell = await withTextTool(t);
  const { SigK } = shell;
  clickAt(shell, 0, 100, 700);
  typeText(shell, '途中');
  SigK.viewer.zoomIn();
  await shell.flush();
  assert.equal(SigK.freeTextEditor.isEditing(), true);
  const node = editorNode(shell);
  assert.ok(node !== null);
  assert.equal(node.value, '途中');
  assert.notEqual(shell.document.activeElement, node);
  assert.notEqual(node.style.fontSize, '12px');
  key(shell, node, { key: 'Escape' });
  assert.equal(SigK.viewer.getAnnotations().added[0].text, '途中');
});

test('モードを離れる・タブを切り替える・保存するときは先に確定する', async (t) => {
  const shell = await withTextTool(t);
  const { SigK, document } = shell;
  clickAt(shell, 0, 100, 700);
  typeText(shell, 'モード');
  SigK.shell.setMode(document, 'view');
  assert.equal(SigK.freeTextEditor.isEditing(), false);
  assert.equal(SigK.viewer.getAnnotations().added[0].text, 'モード');

  SigK.shell.setMode(document, 'annot');
  SigK.annotate.setTool('text');
  clickAt(shell, 0, 100, 500);
  typeText(shell, 'タブ');
  await SigK.tabs.openPath(B);
  await shell.flush();
  await SigK.tabs.activate(SigK.tabs.list()[0].id);
  await shell.flush();
  assert.equal(SigK.viewer.getAnnotations().added.map((e) => e.text).includes('タブ'), true);

  SigK.shell.setMode(document, 'annot');
  SigK.annotate.setTool('text');
  clickAt(shell, 0, 100, 300);
  typeText(shell, '保存');
  const specs = [];
  shell.window.taskAPI.run = async (_id, spec) => { specs.push(structuredClone(spec)); return { ok: true, path: A, signature: { size: 1, mtimeMs: 1 } }; };
  const result = await SigK.save.saveActive();
  assert.equal(result.ok, true);
  const texts = specs[0].annotations.add.filter((e) => e.kind === 'text');
  assert.deepEqual(texts.map((e) => e.text), ['モード', 'タブ', '保存']);
  assert.deepEqual(Object.keys(texts[0]).sort(), ['color', 'fontSize', 'kind', 'opacity', 'rect', 'rotation', 'src', 'text']);
});

test('Ctrl+Z でテキストの世代が戻り、削除も戻せる', async (t) => {
  const shell = await withTextTool(t);
  const { SigK, document } = shell;
  const entry = placeAndCommit(shell);
  assert.equal(SigK.annotate.remove(), true);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  key(shell, document.body, { key: 'z', ctrlKey: true });
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  key(shell, document.body, { key: 'z', ctrlKey: true });
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.viewer.isDirty(), false);
});

// ---- 読み込み（確定事項13） ----

test('自分で付けた FreeText だけを読み込んで pdf.js に描かせず、直せる', async (t) => {
  const shell = await withTextTool(t, { stub: { annotations: { 0: [OWN_TEXT, OTHER_TEXT] } } });
  const { SigK } = shell;
  await shell.flush();
  const imported = SigK.viewer.getImported();
  assert.equal(imported[0].length, 1);
  const loaded = imported[0][0];
  assert.equal(loaded.ref, '120R');
  assert.equal(loaded.kind, 'text');
  assert.equal(loaded.text, 'よみこみ\nテキスト');
  assert.equal(loaded.fontSize, 12);
  assert.equal(loaded.color, '#d92c2c');
  assert.equal(loaded.rotation, 0);
  assert.deepEqual(plain(loaded.rect), [100, 700, 165, 720.5]);
  assert.deepEqual(plain(loaded.quads), [[100, 720.5, 165, 720.5, 100, 700, 165, 700]]);
  const storage = shell.pdfjs.documents.at(-1).annotationStorage;
  assert.deepEqual(storage.get('120R'), { noView: true });
  assert.equal(storage.get('121R'), undefined);
  // 紙の上に描かれる
  const texts = [...pageNode(shell, 0).querySelectorAll('.annot-layer g[data-annot="120R"] text')];
  assert.deepEqual(texts.map((el) => el.textContent), ['よみこみ', 'テキスト']);

  // 直すと写しが added に来て、元は removed に入る
  assert.equal(SigK.annotateText.beginEdit('120R'), true);
  typeText(shell, '直した');
  key(shell, editorNode(shell), { key: 'Escape' });
  const annots = SigK.viewer.getAnnotations();
  assert.deepEqual(plain(annots.removed), ['120R']);
  assert.equal(annots.added[0].text, '直した');
  assert.equal(annots.added[0].fontSize, 12);
  assert.equal(SigK.annotate.getSelected(), annots.added[0].id);
});

test('painterFor はテキストを fillText で描く', async (t) => {
  const shell = await withTextTool(t);
  const { SigK } = shell;
  placeAndCommit(shell);
  const painter = SigK.annotate.painterFor(0);
  const calls = [];
  const ctx = new Proxy({}, { get: (_target, name) => (...args) => { calls.push([name, ...args]); return undefined; }, set: (target, name, value) => { calls.push(['set', name, value]); return true; } });
  painter(ctx, SigK.viewer.getTextLayer(0).viewport);
  assert.deepEqual(calls.filter((call) => call[0] === 'fillText').map((call) => call[1]), ['こんにちは']);
});
