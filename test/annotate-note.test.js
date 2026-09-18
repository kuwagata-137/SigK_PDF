'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// ノート注釈の指揮と右パネルの「本文」「作成者」「不透明度」（spec-4-4 確定事項1〜7・10〜16・18・21・39）。
//
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま
// .pdf-page 基準の CSS px になる。付箋の幾何そのものは note-graphics.test.js が見る。

const A = 'C:\\work\\a.pdf';

// 読み込むもの: /AP 付きのノート・/AP の無いノート（pdf.js が 22×22 に直したもの）・その Popup・他のツールの直線（表示のみ）。
const IMPORTED = {
  0: [
    { id: '12R', subtype: 'Text', rect: [60, 760, 80, 780], color: new Uint8ClampedArray([255, 227, 89]), contentsObj: { str: 'ノート1', dir: 'ltr' }, titleObj: { str: 'SigK 太郎', dir: 'ltr' }, hasAppearance: true, popupRef: '13R', name: 'NoIcon' },
    { id: '13R', subtype: 'Popup', rect: [90, 680, 270, 780], parentRect: [60, 760, 80, 780], open: false, contentsObj: { str: 'ノート1' }, titleObj: { str: 'SigK 太郎' } },
    { id: '14R', subtype: 'Text', rect: [60, 698, 82, 720], color: null, contentsObj: { str: 'AP なし' }, titleObj: { str: 'other' }, hasAppearance: false, name: 'Comment' },
    { id: '17R', subtype: 'Line', rect: [298, 698, 502, 762], color: new Uint8ClampedArray([255, 0, 0]), contentsObj: { str: 'other line' }, titleObj: { str: '' }, lineCoordinates: [300, 700, 500, 760], lineEndings: ['None', 'None'] },
  ],
};

async function withShell(t, options = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED, ...(options.stub ?? {}) }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

async function withTool(t, tool, options = {}) {
  const shell = await withShell(t, options);
  shell.SigK.annotate.setTool(tool);
  return shell;
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function viewportOf(shell, index = 0) {
  return shell.SigK.viewer.getTextLayer(index).viewport;
}

function mouse(shell, type, target, x, y, extra = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra });
  target.dispatchEvent(event);
  return event;
}

function clickAt(shell, x, y, index = 0) {
  const page = pageNode(shell, index);
  const [cx, cy] = viewportOf(shell, index).convertToViewportPoint(x, y);
  mouse(shell, 'mousedown', page, cx, cy);
  mouse(shell, 'mouseup', page, cx, cy);
}

function key(shell, target, options) {
  const event = new shell.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

const plain = (value) => structuredClone(value);
const near = (actual, expected, eps = 0.05) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);

function contentsField(shell) {
  return shell.document.getElementById('props-contents');
}

// ---- 置く（確定事項2・10） ----

test('ノートの道具で紙を押すと、押した点を中心に付箋が置かれ、選ばれて「本文」欄にフォーカスが移る', async (t) => {
  const shell = await withTool(t, 'note');
  const { SigK, document } = shell;
  assert.equal(document.documentElement.getAttribute('data-tool'), 'note');
  clickAt(shell, 200, 600);
  const { added } = SigK.viewer.getAnnotations();
  assert.equal(added.length, 1);
  const entry = added[0];
  assert.equal(entry.kind, 'note');
  assert.equal(entry.color, '#ffe45a');
  assert.equal(entry.opacity, 1);
  assert.equal(entry.text, '');
  assert.equal(entry.author, '');
  assert.equal(entry.src, 0);
  // 押した点 (200, 600) を中心に 20pt 相当（倍率 1 なので 20pt）の箱。左上が基準。
  const size = SigK.noteGraphics.ICON_PX / viewportOf(shell).scale;
  near(entry.rect[0], 200 - size / 2);
  near(entry.rect[3], 600 + size / 2);
  near(entry.rect[2] - entry.rect[0], 20);
  near(entry.rect[3] - entry.rect[1], 20);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  assert.equal(SigK.pageEdit.canUndo(), true);
  assert.equal(SigK.viewer.isDirty(), true);
  // 層に付箋と枠が描かれ、右パネルの「本文」欄が出てフォーカスされる。
  const group = pageNode(shell).querySelector(`.annot-layer g[data-annot="${entry.id}"]`);
  assert.equal(group.getAttribute('data-kind'), 'note');
  assert.ok(group.querySelector('g.note path') !== null);
  assert.ok(pageNode(shell).querySelector('.annot-frame') !== null);
  assert.equal(document.getElementById('props-contents-row').hidden, false);
  assert.equal(document.activeElement, contentsField(shell));
  assert.equal(document.getElementById('props-kind').textContent, 'ノート');
  assert.equal(document.getElementById('props-author-row').hidden, false);
  assert.equal(document.getElementById('props-author').readOnly, true);
});

test('紙の端を押しても付箋は紙の中に収まる', async (t) => {
  const shell = await withTool(t, 'note');
  const { SigK } = shell;
  const viewport = viewportOf(shell);
  mouse(shell, 'mousedown', pageNode(shell), 2, 2);
  mouse(shell, 'mouseup', pageNode(shell), 2, 2);
  const entry = SigK.viewer.getAnnotations().added[0];
  const box = SigK.noteGraphics.boxOf(entry, viewport);
  near(box.x, 0);
  near(box.y, 0);
});

test('文字が選ばれていれば置かない。道具を持っていなければ置かない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  clickAt(shell, 200, 600);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  SigK.annotate.setTool('note');
  shell.window.getSelection = () => ({ isCollapsed: false });
  clickAt(shell, 200, 600);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
});

// ---- 本文（確定事項4） ----

test('「本文」欄は欄の外を押す（blur）と確定して 1 世代積み、変わっていなければ積まない', async (t) => {
  const shell = await withTool(t, 'note');
  const { SigK, document } = shell;
  clickAt(shell, 200, 600);
  const id = SigK.annotate.getSelected();
  const field = contentsField(shell);
  field.value = '検収の期間は要確認\r\n2 行目';
  field.blur();
  const entry = SigK.viewer.getAnnotations().added[0];
  assert.equal(entry.text, '検収の期間は要確認\n2 行目');
  assert.equal(SigK.annotate.getSelected(), id, '選択はそのまま');
  // 置く・本文で 2 世代。
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added[0].text, '');
  SigK.pageEdit.redo();
  assert.equal(SigK.viewer.getAnnotations().added[0].text, '検収の期間は要確認\n2 行目');
  // 同じ本文で blur しても積まない。
  const before = SigK.viewer.getAnnotations();
  field.focus();
  field.blur();
  assert.equal(SigK.annotationState.sameAnnots(before, SigK.viewer.getAnnotations()), true);
  assert.equal(SigK.annotate.setContents('検収の期間は要確認\n2 行目'), false);
  // Ctrl+Enter と Esc は欄を離れる（＝確定）。Enter は改行のまま。
  field.focus();
  field.value = '三つ目';
  key(shell, field, { key: 'Enter' });
  assert.equal(document.activeElement, field);
  key(shell, field, { key: 'Enter', ctrlKey: true });
  assert.equal(SigK.viewer.getAnnotations().added[0].text, '三つ目');
  field.focus();
  field.value = '';
  key(shell, field, { key: 'Escape' });
  assert.equal(SigK.viewer.getAnnotations().added[0].text, '', '空でも残る');
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
});

test('「本文」欄にフォーカスがある間、Delete・Ctrl+Z・Esc は注釈モードのキーにならない', async (t) => {
  const shell = await withTool(t, 'note');
  const { SigK } = shell;
  clickAt(shell, 200, 600);
  const field = contentsField(shell);
  field.focus();
  const del = key(shell, field, { key: 'Delete' });
  assert.equal(del.defaultPrevented, false);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  const undo = key(shell, field, { key: 'z', ctrlKey: true });
  assert.equal(undo.defaultPrevented, false);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  assert.equal(SigK.annotate.getSelected() !== null, true);
  // 「作成者」欄も同じ。
  SigK.annotate.select(null);
  const author = shell.document.getElementById('props-author');
  author.focus();
  assert.equal(key(shell, author, { key: 'Escape' }).defaultPrevented, false);
  assert.equal(SigK.annotate.getTool(), 'note', 'Esc で道具を離さない');
});

test('ダブルクリックと Enter で「本文」欄にフォーカスが移る', async (t) => {
  const shell = await withTool(t, 'note');
  const { SigK, document } = shell;
  clickAt(shell, 200, 600);
  const entry = SigK.viewer.getAnnotations().added[0];
  document.body.focus();
  SigK.annotate.select(null);
  const [cx, cy] = viewportOf(shell).convertToViewportPoint(200, 600);
  const dbl = mouse(shell, 'dblclick', pageNode(shell), cx, cy);
  assert.equal(dbl.defaultPrevented, true);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  assert.equal(document.activeElement, contentsField(shell));
  document.body.focus();
  assert.equal(SigK.annotate.editSelected(), true);
  assert.equal(document.activeElement, contentsField(shell));
});

// ---- 選ぶ・動かす・消す（確定事項7・13・14） ----

test('付箋を押すと選ばれ、掴んで動かすと基準の点が動いて 1 世代積まれる', async (t) => {
  const shell = await withTool(t, 'note');
  const { SigK } = shell;
  clickAt(shell, 200, 600);
  const entry = SigK.viewer.getAnnotations().added[0];
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  // 箱の中を押すと選ばれる（表示の点で当たる）。
  const viewport = viewportOf(shell);
  const box = SigK.noteGraphics.boxOf(entry, viewport);
  mouse(shell, 'mousedown', pageNode(shell), box.x + 5, box.y + 5);
  mouse(shell, 'mouseup', pageNode(shell), box.x + 5, box.y + 5);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  // 箱の外は当たらない。
  mouse(shell, 'mousedown', pageNode(shell), box.x + box.width + 10, box.y + 5);
  mouse(shell, 'mouseup', pageNode(shell), box.x + box.width + 10, box.y + 5);
  assert.equal(SigK.annotate.getSelected(), null);
  // 選んで掴んで動かす。
  SigK.annotate.select(entry.id);
  const generations = SigK.pageEdit.canUndo();
  mouse(shell, 'mousedown', pageNode(shell), box.x + 5, box.y + 5);
  mouse(shell, 'mousemove', shell.document.body, box.x + 45, box.y + 25);
  mouse(shell, 'mouseup', pageNode(shell), box.x + 45, box.y + 25);
  const moved = SigK.viewer.getAnnotations().added[0];
  near(moved.rect[0], entry.rect[0] + 40 / viewport.scale);
  near(moved.rect[3], entry.rect[3] - 20 / viewport.scale);
  near(moved.rect[2] - moved.rect[0], 20);
  assert.equal(generations, true);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  // Delete で消える。
  assert.equal(SigK.annotate.remove(), true);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
});

test('move は差分が読めなければ何もしない', async (t) => {
  const shell = await withTool(t, 'note');
  const { SigK } = shell;
  clickAt(shell, 200, 600);
  const entry = SigK.viewer.getAnnotations().added[0];
  assert.equal(SigK.annotateNote.move(entry.id, [1]), false);
  assert.equal(SigK.annotateNote.move('12R', 'x'), false);
  assert.equal(SigK.annotateNote.move('17R', [1, 1]), false, '表示のみは動かない');
});

// ---- 読み込み（確定事項20） ----

test('開くと /AP の有無を問わずノートを読み込み、自前の付箋で描き、直せる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const imported = SigK.viewer.getImported();
  assert.deepEqual(plain(imported[0].map((entry) => [entry.ref, entry.kind, entry.readonly === true])), [['12R', 'note', false], ['14R', 'note', false], ['17R', 'other', true]]);
  const storage = shell.pdfjs.documents.at(-1).annotationStorage;
  assert.deepEqual(storage.get('12R'), { noView: true });
  assert.deepEqual(storage.get('14R'), { noView: true });
  assert.equal(storage.get('13R'), undefined);
  assert.equal(storage.get('17R'), undefined);
  const svg = pageNode(shell).querySelector('.annot-layer');
  assert.ok(svg.querySelector('g[data-annot="12R"] g.note') !== null);
  assert.ok(svg.querySelector('g[data-annot="14R"] g.note') !== null);
  assert.equal(svg.querySelector('g[data-annot="17R"]'), null);
  // 選ぶと本文・作成者・ページが出る。
  SigK.annotate.select('12R');
  assert.equal(document.getElementById('props-kind').textContent, 'ノート');
  assert.equal(contentsField(shell).value, 'ノート1');
  assert.equal(document.getElementById('props-author').value, 'SigK 太郎');
  assert.equal(document.getElementById('props-page').textContent, '1');
  assert.equal(document.getElementById('props-opacity-row').hidden, false);
  // 本文を直すと写しが added に来て、元は removed に入る（欄に入ってから離れる）。
  contentsField(shell).focus();
  contentsField(shell).value = '直した';
  contentsField(shell).blur();
  const annots = SigK.viewer.getAnnotations();
  assert.deepEqual(plain(annots.removed), ['12R']);
  assert.equal(annots.added.length, 1);
  assert.equal(annots.added[0].text, '直した');
  assert.equal(annots.added[0].author, 'SigK 太郎');
  assert.equal(SigK.annotate.getSelected(), annots.added[0].id);
  // 色を変えると覚える。
  document.querySelector('#props-colors .swatch[data-color="#8ce99a"]').dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(SigK.viewer.getAnnotations().added[0].color, '#8ce99a');
  assert.equal(SigK.annotate.colorOf('note'), '#8ce99a');
});

test('表示のみの注釈は一覧から選べて枠だけ出て消せるが、色・不透明度は変えられず紙の上では選べない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  assert.equal(SigK.annotate.select('17R'), '17R');
  assert.equal(document.getElementById('props-kind').textContent, '直線（表示のみ）');
  assert.equal(document.querySelectorAll('#props-colors .swatch').length, 0);
  assert.equal(document.getElementById('props-opacity-row').hidden, true);
  assert.equal(document.getElementById('props-contents-row').hidden, true);
  assert.equal(document.getElementById('props-text').textContent, '「other line」');
  assert.equal(document.getElementById('props-hint').textContent, SigK.annotationProps.HINTS.readonly);
  assert.equal(document.getElementById('props-delete').getAttribute('aria-disabled'), null);
  const frame = pageNode(shell).querySelector('.annot-frame');
  assert.ok(frame !== null);
  assert.equal(SigK.annotate.setColor('#d92c2c'), false);
  assert.equal(SigK.annotate.setOpacity(0.5), false);
  assert.equal(SigK.viewer.getAnnotations().removed.length, 0);
  // 紙の上で箱の中を押しても当たらない。
  const [cx, cy] = viewportOf(shell).convertToViewportPoint(400, 730);
  assert.equal(SigK.annotate.hitTest(0, [cx, cy]), null);
  // Delete で removed に入る。
  assert.equal(SigK.annotate.remove(), true);
  assert.deepEqual(plain(SigK.viewer.getAnnotations().removed), ['17R']);
  assert.deepEqual(plain(SigK.annotationState.toSaveSpec(SigK.viewer.getAnnotations())), { add: [], remove: ['17R'] });
});

// ---- 作成者（確定事項39） ----

test('作成者は起動時の設定から戻り、「作成者」欄で変えると覚え、置くノートに付く', async (t) => {
  const shell = await withTool(t, 'note', { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotAuthor: '総務' } });
  const { SigK, document } = shell;
  assert.equal(SigK.annotate.getAuthor(), '総務');
  const author = document.getElementById('props-author');
  assert.equal(document.getElementById('props-author-row').hidden, false);
  assert.equal(author.readOnly, false);
  assert.equal(author.value, '総務');
  author.value = '  経理 ';
  author.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  assert.equal(SigK.annotate.getAuthor(), '経理');
  await shell.flush();
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotAuthor: '経理' });
  clickAt(shell, 200, 600);
  assert.equal(SigK.viewer.getAnnotations().added[0].author, '経理');
  assert.deepEqual(plain(SigK.annotationState.toSaveSpec(SigK.viewer.getAnnotations()).add[0]).author, '経理');
  // 文字列でなければ断る。長すぎれば切る。
  assert.equal(SigK.annotate.setAuthor(5), false);
  assert.equal(SigK.annotate.setAuthor('a'.repeat(120)), true);
  assert.equal(SigK.annotate.getAuthor().length, 100);
});

// ---- 不透明度（確定事項5・21） ----

test('「不透明度」の行は対象の道具と注釈で出て、道具ごとに次の値を覚える', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const row = document.getElementById('props-opacity-row');
  const select = document.getElementById('props-opacity');
  assert.equal(row.hidden, true);
  SigK.annotate.setTool('highlight');
  assert.equal(row.hidden, true);
  SigK.annotate.setTool('shape');
  assert.equal(row.hidden, false);
  assert.deepEqual([...select.options].map((option) => [option.value, option.textContent]), [['1', '100%'], ['0.75', '75%'], ['0.5', '50%'], ['0.25', '25%']]);
  select.value = '0.5';
  select.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  assert.equal(SigK.annotate.getOpacity('shape'), 0.5);
  assert.equal(SigK.annotate.getOpacity('square'), 0.5);
  assert.equal(SigK.annotate.getOpacity('pen'), 1);
  assert.equal(SigK.annotate.getOpacity('highlight'), 1);
  await shell.flush();
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotOpacity: { shape: 0.5 } });
  assert.equal(SigK.pageEdit.canUndo(), false, '編集ではない');
  // 道具を持っていなければ断る。プリセット外も断る。
  SigK.annotate.setTool(null);
  assert.equal(SigK.annotate.setOpacity(0.25), false);
  SigK.annotate.setTool('note');
  assert.equal(SigK.annotate.setOpacity(0.6), false);
  assert.equal(SigK.annotate.setOpacity(0.25), true);
  assert.equal(select.value, '0.25');
  // 次に置く付箋に付く。
  clickAt(shell, 200, 600);
  assert.equal(SigK.viewer.getAnnotations().added[0].opacity, 0.25);
});

test('選んでいる注釈の不透明度を変えると 1 世代積み、層とプレビューに映る', async (t) => {
  const shell = await withTool(t, 'note');
  const { SigK, document } = shell;
  clickAt(shell, 200, 600);
  const entry = SigK.viewer.getAnnotations().added[0];
  const select = document.getElementById('props-opacity');
  assert.equal(select.value, '1');
  select.value = '0.5';
  select.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  assert.equal(SigK.viewer.getAnnotations().added[0].opacity, 0.5);
  assert.equal(pageNode(shell).querySelector(`.annot-layer g[data-annot="${entry.id}"]`).getAttribute('opacity'), '0.5');
  assert.equal(SigK.annotate.getOpacity('note'), 0.5, '変えた値は次の値にもなる');
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added[0].opacity, 1);
  // 読み込んだノートは写しになる。
  SigK.annotate.select('12R');
  assert.equal(SigK.annotate.setOpacity(0.75), true);
  const annots = SigK.viewer.getAnnotations();
  assert.deepEqual(plain(annots.removed), ['12R']);
  assert.equal(annots.added.at(-1).opacity, 0.75);
  assert.equal(SigK.annotate.getSelected(), annots.added.at(-1).id);
  // 同じ値なら積まない。
  const generation = annots;
  assert.equal(SigK.annotate.setOpacity(0.75), true);
  assert.equal(SigK.annotationState.sameAnnots(generation, SigK.viewer.getAnnotations()), true);
});

test('覚えた不透明度と作成者は起動時に戻り、プリセット外は捨てる', async (t) => {
  const shell = await withShell(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotOpacity: { text: 0.5, shape: 0.9, pen: 0.25 }, annotAuthor: 'h.user' } });
  await shell.flush();
  assert.deepEqual(plain(shell.SigK.annotateOpacity.getOpacities()), { text: 0.5, shape: 1, pen: 0.25, note: 1 });
  assert.equal(shell.SigK.annotate.getAuthor(), 'h.user');
});

test('読み込んだ注釈のプリセットに無い不透明度は選択肢の末尾に出る', async (t) => {
  const shell = await withShell(t, { stub: { annotations: { 0: [{ id: '31R', subtype: 'Ink', rect: [58, 298, 222, 362], color: new Uint8ClampedArray([43, 92, 217]), borderStyle: { width: 3 }, inkLists: [new Float32Array([60, 300, 100, 360, 140, 300])], opacity: 0.6 }] } } });
  const { SigK, document } = shell;
  SigK.annotate.select('31R');
  const select = document.getElementById('props-opacity');
  assert.equal(select.value, '0.6');
  assert.equal(select.querySelector('option[data-extra]').textContent, '60%');
  SigK.annotate.select(null);
  SigK.annotate.setTool('pen');
  assert.equal(select.querySelector('option[data-extra]'), null);
});
