'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 注釈モードの指揮（spec-4-1 確定事項1〜10・15〜20）。
//
// jsdom は配置しないので、選択範囲の矩形は span に残した pt の位置から作る
// （annotate.setRectsOf）。四角の計算そのものは markup-quads.test.js が見る。

const ITEMS = [
  { str: 'あいうえお', transform: [12, 0, 0, 12, 50, 700], width: 60, fontName: 'f1' },
  { str: 'かきくけこ', transform: [12, 0, 0, 12, 50, 680], width: 60, fontName: 'f1' },
];
const STYLES = { f1: { ascent: 0.9, descent: -0.2 } };
const QUAD_FIRST = [50, 710.8, 110, 710.8, 50, 697.6, 110, 697.6];
const IMPORTED = {
  1: [{ id: '86R', subtype: 'Highlight', rect: [40, 600, 200, 612], quadPoints: [40, 612, 200, 612, 40, 600, 200, 600], color: new Uint8ClampedArray([255, 230, 51]), opacity: 1 }],
};

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

async function withShell(t, options = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ textItems: ITEMS, textStyles: STYLES, ...(options.stub ?? {}) }),
    files: {
      [A]: makeSource({ path: A, name: 'a.pdf' }),
      [B]: makeSource({ path: B, name: 'b.pdf' }),
    },
    ...options,
  });
  t.after(() => shell.cleanup());
  // 矩形は span の pt の位置から作る。部分選択は文字数で按分する。
  shell.SigK.annotate.setRectsOf((range, div) => {
    const page = div.closest('.pdf-page');
    const handle = shell.SigK.viewer.getTextLayer(Number(page.dataset.page) - 1);
    const length = div.textContent.length || 1;
    const from = range.startContainer === div.firstChild ? range.startOffset : 0;
    const to = range.endContainer === div.firstChild ? range.endOffset : length;
    const x = Number(div.dataset.x);
    const y = Number(div.dataset.y);
    const w = Number(div.dataset.w);
    const h = Number(div.dataset.h);
    const [left, bottom] = handle.viewport.convertToViewportPoint(x + w * (from / length), y - h * 0.3);
    const [right, top] = handle.viewport.convertToViewportPoint(x + w * (to / length), y + h * 1.1);
    return [{ left, top, right, bottom, width: right - left, height: bottom - top }];
  });
  return shell;
}

async function withOpenDocument(t, options = {}) {
  const shell = await withShell(t, options);
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function spansOf(shell, index) {
  return [...shell.document.querySelectorAll(`.pdf-page[data-page="${index + 1}"] .textLayer span`)];
}

function selectText(shell, index, from, to, { charFrom = 0, charTo } = {}) {
  const spans = spansOf(shell, index);
  const range = shell.document.createRange();
  range.setStart(spans[from].firstChild, charFrom);
  range.setEnd(spans[to].firstChild, charTo ?? spans[to].textContent.length);
  const selection = shell.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function mouse(shell, type, target, x, y) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}

// pt の点でページを押して離す（動かさない）。
function clickAt(shell, index, x, y) {
  const page = shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
  const [cx, cy] = shell.SigK.viewer.getTextLayer(index).viewport.convertToViewportPoint(x, y);
  mouse(shell, 'mousedown', page, cx, cy);
  mouse(shell, 'mouseup', page, cx, cy);
}

function layerOf(shell, index) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"] .annot-layer`);
}

const plain = (value) => structuredClone(value);

// ---- 画面（確定事項1〜4） ----

test('注釈モードに入るとレールに道具が並び、プロパティは「次に付ける注釈」を待つ', async (t) => {
  const shell = await withOpenDocument(t);
  const { document, SigK } = shell;
  assert.equal(document.documentElement.getAttribute('data-mode'), 'annot');
  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(document.getElementById('props-kind').textContent, '–');
  assert.equal(document.getElementById('props-delete').getAttribute('aria-disabled'), 'true');
  // 注釈の層はページごとに 1 つ、canvas のあと・テキストレイヤーの前。
  const page = document.querySelector('.pdf-page[data-page="1"]');
  const layer = page.querySelector('.annot-layer');
  assert.notEqual(layer, null);
  assert.equal(layer.nextElementSibling.classList.contains('textLayer'), true);
});

test('道具はトグルで、持つとプロパティに種類と色が出る', async (t) => {
  const shell = await withOpenDocument(t);
  const { document, SigK } = shell;
  const button = document.querySelector('.rail-item.tool[data-tool="highlight"]');
  button.dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(SigK.annotate.getTool(), 'highlight');
  assert.equal(button.classList.contains('active'), true);
  assert.equal(document.getElementById('props-kind').textContent, 'ハイライト（次に付ける）');
  const swatches = [...document.querySelectorAll('#props-colors .swatch')];
  assert.deepEqual(swatches.map((s) => s.dataset.color), ['#ffe45a', '#8ce99a', '#8fbfff', '#ffa8c8']);
  assert.equal(swatches[0].classList.contains('on'), true);

  button.dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(SigK.annotate.getTool(), null);
  // 塊④でレールの 7 つが全部押せる（灰色の位置取りは無い）。
  assert.equal(document.querySelector('.rail-item.tool[aria-disabled="true"]'), null);
  document.querySelector('.rail-item.tool[data-tool="note"]').dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(SigK.annotate.getTool(), 'note');
  assert.equal(document.getElementById('props-kind').textContent, 'ノート（次に付ける）');
  SigK.annotate.setTool(null);
});

// ---- 作る（確定事項10〜14） ----

test('道具を持って文字をなぞると、離した瞬間に付いて選択が解除される', async (t) => {
  const shell = await withOpenDocument(t);
  const { document, SigK } = shell;
  SigK.annotate.setTool('highlight');
  selectText(shell, 0, 0, 0);
  mouse(shell, 'mouseup', document.querySelector('.pdf-page[data-page="1"]'), 10, 10);

  const annots = SigK.viewer.getAnnotations();
  assert.equal(annots.added.length, 1);
  const entry = annots.added[0];
  assert.equal(entry.kind, 'highlight');
  assert.equal(entry.color, '#ffe45a');
  assert.equal(entry.src, 0);
  assert.equal(entry.text, 'あいうえお');
  assert.deepEqual(plain(entry.quads), [QUAD_FIRST]);
  assert.deepEqual(plain(entry.rect), [50, 697.6, 110, 710.8]);
  assert.equal(shell.window.getSelection().isCollapsed, true);
  // 付いたものが選ばれ、dirty になり、履歴に 1 世代積まれる。
  assert.equal(SigK.annotate.getSelected(), entry.id);
  assert.equal(SigK.viewer.isDirty(), true);
  assert.equal(SigK.pageEdit.canUndo(), true);
  // 層に多角形が乗り、選択の枠が出る。
  const layer = layerOf(shell, 0);
  assert.equal(layer.querySelectorAll('polygon').length, 1);
  assert.equal(layer.querySelectorAll('.annot-frame').length, 1);
  assert.equal(document.getElementById('props-text').textContent, '「あいうえお」');
  assert.equal(document.getElementById('props-page').textContent, '1');
});

test('先に文字を選んでから道具を押しても付き、道具は持ったままになる', async (t) => {
  const shell = await withOpenDocument(t);
  const { document, SigK } = shell;
  selectText(shell, 0, 1, 1, { charFrom: 1, charTo: 3 });
  document.querySelector('.rail-item.tool[data-tool="underline"]').dispatchEvent(new shell.window.MouseEvent('click'));

  const entry = SigK.viewer.getAnnotations().added[0];
  assert.equal(entry.kind, 'underline');
  assert.equal(entry.color, '#d92c2c');
  assert.equal(entry.text, 'きく');
  // 2 文字目から 3 文字目まで: x は 50 + 60 × 1/5 〜 50 + 60 × 3/5。
  assert.deepEqual(plain(entry.quads[0]).slice(0, 4), [62, 690.8, 86, 690.8]);
  assert.equal(SigK.annotate.getTool(), 'underline');
  assert.equal(layerOf(shell, 0).querySelectorAll('line').length, 1);
});

test('ページをまたぐ選択はページごとに 1 つになる', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  const first = spansOf(shell, 0);
  const second = spansOf(shell, 1);
  const range = shell.document.createRange();
  range.setStart(first[1].firstChild, 0);
  range.setEnd(second[0].firstChild, 5);
  shell.window.getSelection().addRange(range);
  SigK.annotate.toggleTool('strikeout');

  const added = SigK.viewer.getAnnotations().added;
  assert.deepEqual(plain(added.map((entry) => entry.src)), [0, 1]);
  assert.equal(SigK.pageEdit.getHistoryState().depth, 2, '1 回の操作で 1 世代');
});

test('文字を選んでいなければ何も付かない', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  SigK.annotate.setTool('highlight');
  mouse(shell, 'mouseup', shell.document.querySelector('.pdf-page[data-page="1"]'), 10, 10);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.viewer.isDirty(), false);
});

test('閲覧モードでは道具があっても付かない', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  SigK.annotate.setTool('highlight');
  SigK.shell.setMode(shell.document, 'view');
  selectText(shell, 0, 0, 0);
  mouse(shell, 'mouseup', shell.document.querySelector('.pdf-page[data-page="1"]'), 10, 10);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  // 道具は持ち越す（確定事項8）。
  assert.equal(SigK.annotate.getTool(), 'highlight');
});

// ---- 選ぶ・消す・色（確定事項6・7・33・34） ----

async function withOneHighlight(t) {
  const shell = await withOpenDocument(t);
  shell.SigK.annotate.setTool('highlight');
  selectText(shell, 0, 0, 0);
  mouse(shell, 'mouseup', shell.document.querySelector('.pdf-page[data-page="1"]'), 10, 10);
  shell.SigK.annotate.setTool(null);
  shell.SigK.annotate.select(null);
  return shell;
}

test('押して離すと当たった注釈が選ばれ、外を押すと解除される', async (t) => {
  const shell = await withOneHighlight(t);
  const { SigK } = shell;
  const id = SigK.viewer.getAnnotations().added[0].id;
  assert.equal(SigK.annotate.getSelected(), null);

  clickAt(shell, 0, 80, 705);
  assert.equal(SigK.annotate.getSelected(), id);
  assert.equal(layerOf(shell, 0).querySelectorAll('.annot-frame').length, 1);
  assert.equal(shell.document.getElementById('props-delete').getAttribute('aria-disabled'), null);

  clickAt(shell, 0, 300, 300);
  assert.equal(SigK.annotate.getSelected(), null);
  assert.equal(layerOf(shell, 0).querySelectorAll('.annot-frame').length, 0);
});

test('Delete で消え、Ctrl+Z で戻り、戻った注釈が選ばれる', async (t) => {
  const shell = await withOneHighlight(t);
  const { document, SigK } = shell;
  const id = SigK.viewer.getAnnotations().added[0].id;
  clickAt(shell, 0, 80, 705);

  document.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.annotate.getSelected(), null);
  assert.equal(SigK.viewer.isDirty(), false, '付けて消したら元どおり');

  document.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  assert.equal(SigK.annotate.getSelected(), id);
  assert.equal(SigK.viewer.isDirty(), true);

  document.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
});

test('「この注釈を削除」でも消える', async (t) => {
  const shell = await withOneHighlight(t);
  clickAt(shell, 0, 80, 705);
  shell.document.getElementById('props-delete').dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(shell.SigK.viewer.getAnnotations().added.length, 0);
});

test('Esc は選択を解除し、次に道具を離す', async (t) => {
  const shell = await withOneHighlight(t);
  const { document, SigK } = shell;
  SigK.annotate.setTool('highlight');
  clickAt(shell, 0, 80, 705);
  const esc = () => document.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  esc();
  assert.equal(SigK.annotate.getSelected(), null);
  assert.equal(SigK.annotate.getTool(), 'highlight');
  esc();
  assert.equal(SigK.annotate.getTool(), null);
});

test('色の丸で選んだ注釈の色が変わり、その色を覚える', async (t) => {
  const shell = await withOneHighlight(t);
  const { document, SigK } = shell;
  clickAt(shell, 0, 80, 705);
  document.querySelector('#props-colors .swatch[data-color="#8ce99a"]').dispatchEvent(new shell.window.MouseEvent('click'));

  assert.equal(SigK.viewer.getAnnotations().added[0].color, '#8ce99a');
  assert.equal(layerOf(shell, 0).querySelector('polygon').getAttribute('fill'), '#8ce99a');
  assert.deepEqual(plain(SigK.annotate.getColors()).highlight, '#8ce99a');
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotColors: { highlight: '#8ce99a' } });
  // 1 世代積まれ、戻せる。
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added[0].color, '#ffe45a');
});

test('注釈を選んでいなければ、色の丸は道具の色（次に付ける色）を変える', async (t) => {
  const shell = await withOpenDocument(t);
  const { document, SigK } = shell;
  SigK.annotate.setTool('underline');
  document.querySelector('#props-colors .swatch[data-color="#2c5cd9"]').dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(SigK.annotate.colorOf('underline'), '#2c5cd9');
  assert.equal(SigK.pageEdit.canUndo(), false, '編集ではない');
  selectText(shell, 0, 0, 0);
  mouse(shell, 'mouseup', document.querySelector('.pdf-page[data-page="1"]'), 10, 10);
  assert.equal(SigK.viewer.getAnnotations().added[0].color, '#2c5cd9');
});

test('覚えた色は起動時に戻る', async (t) => {
  const shell = await withShell(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotColors: { highlight: '#ffa8c8', underline: '#1c2430', strikeout: '#d92c2c', text: '#2c5cd9', shape: '#2f9e5a', pen: '#1c2430' } } });
  await shell.flush();
  // 覚えていない種類（ノート）は既定の色。
  assert.deepEqual(plain(shell.SigK.annotate.getColors()), { highlight: '#ffa8c8', underline: '#1c2430', strikeout: '#d92c2c', text: '#2c5cd9', shape: '#2f9e5a', pen: '#1c2430', note: '#ffe45a' });
});

// ---- 履歴・dirty・タブ（確定事項15・19） ----

test('ページの回転と注釈は 1 本の履歴に並び、順に戻る', async (t) => {
  const shell = await withOneHighlight(t);
  const { SigK } = shell;
  SigK.pageEdit.rotate(90, [0]);
  assert.equal(SigK.viewer.getPlan()[0].rotate, 90);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);

  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getPlan()[0].rotate, 0);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.viewer.isDirty(), false);
  SigK.pageEdit.redo();
  SigK.pageEdit.redo();
  assert.equal(SigK.viewer.getPlan()[0].rotate, 90);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
});

test('注釈の編集はタブごとに残り、タブの点も連動する', async (t) => {
  const shell = await withOneHighlight(t);
  const { SigK } = shell;
  const first = SigK.tabs.list()[0].id;
  assert.equal(SigK.tabs.isDirty(first), true);

  await SigK.tabs.openPath(B);
  await shell.flush();
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.viewer.isDirty(), false);
  assert.equal(SigK.tabs.isDirty(first), true, '映していないタブの注釈も dirty に数える');

  SigK.tabs.activate(first);
  await shell.flush();
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  assert.equal(SigK.viewer.isDirty(), true);
  assert.equal(layerOf(shell, 0).querySelectorAll('polygon').length, 1);
});

test('モードを離れると選択は解除される', async (t) => {
  const shell = await withOneHighlight(t);
  const { SigK } = shell;
  clickAt(shell, 0, 80, 705);
  SigK.shell.setMode(shell.document, 'view');
  assert.equal(SigK.annotate.getSelected(), null);
});

// ---- 読み込んだ注釈（確定事項17・18） ----

test('開くとファイルのテキストマークアップを集め、pdf.js には描かせず自前の層で描く', async (t) => {
  const shell = await withOpenDocument(t, { stub: { annotations: IMPORTED } });
  const { SigK } = shell;
  await shell.flush();
  const imported = SigK.viewer.getImported();
  assert.deepEqual(Object.keys(imported), ['1']);
  assert.deepEqual(plain(imported[1][0]), {
    ref: '86R', src: 1, kind: 'highlight', color: '#ffe633', opacity: 1,
    quads: [[40, 612, 200, 612, 40, 600, 200, 600]], rect: [40, 600, 200, 612],
  });
  // pdf.js には描かせない印。
  assert.deepEqual(shell.pdfjs.document.annotationStorage.get('86R'), { noView: true });
  assert.equal(shell.pdfjs.renderCalls.every((call) => call.annotationMode === 3), true, 'ENABLE_STORAGE');
  // 自前の層に乗る。編集ではないので dirty でも履歴でもない。
  assert.equal(layerOf(shell, 1).querySelectorAll('polygon').length, 1);
  assert.equal(SigK.viewer.isDirty(), false);
  assert.equal(SigK.pageEdit.canUndo(), false);
});

test('読み込んだ注釈は選んで消せ、色も変えられ、保存の差分に載る', async (t) => {
  const shell = await withOpenDocument(t, { stub: { annotations: IMPORTED } });
  const { document, SigK } = shell;
  // 集め終えると、読み込んだ注釈のあるページは canvas ごと描き直される。それを待つ。
  await shell.flush();
  await shell.flush();
  clickAt(shell, 1, 100, 606);
  assert.equal(SigK.annotate.getSelected(), '86R');
  assert.equal(document.getElementById('props-kind').textContent, 'ハイライト');
  assert.equal(document.getElementById('props-text-row').hidden, true, '読み込んだものに文字は無い');

  document.querySelector('#props-colors .swatch[data-color="#8fbfff"]').dispatchEvent(new shell.window.MouseEvent('click'));
  let annots = SigK.viewer.getAnnotations();
  assert.deepEqual(plain(annots.removed), ['86R']);
  assert.equal(annots.added.length, 1);
  assert.equal(annots.added[0].color, '#8fbfff');
  assert.equal(SigK.annotate.getSelected(), annots.added[0].id, '選択は写しへ移る');
  assert.equal(layerOf(shell, 1).querySelectorAll('polygon').length, 1, '元は消え、写しだけが描かれる');

  SigK.pageEdit.undo();
  annots = SigK.viewer.getAnnotations();
  assert.deepEqual(plain(annots.removed), []);
  assert.equal(annots.added.length, 0);

  clickAt(shell, 1, 100, 606);
  document.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  assert.deepEqual(plain(SigK.viewer.getAnnotations().removed), ['86R']);
  assert.equal(layerOf(shell, 1).querySelectorAll('polygon').length, 0);
  assert.equal(SigK.viewer.isDirty(), true);
  assert.deepEqual(plain(SigK.annotationState.toSaveSpec(SigK.viewer.getAnnotations())), { add: [], remove: ['86R'] });
});

// ---- 保存・印刷（確定事項20・28） ----

test('保存は注釈の差分を渡し、開き直したあとは注釈が空で読み込みから始まる', async (t) => {
  const shell = await withOneHighlight(t);
  const { SigK } = shell;
  shell.window.taskAPI.run = async () => ({ ok: true, path: A, signature: { size: 1, mtimeMs: 1 } });
  const before = SigK.viewer.getAnnotations().added[0];
  shell.pdfjs.documents.at(-1);
  const result = await SigK.save.saveActive();
  assert.equal(result.ok, true);
  await shell.flush();
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.viewer.isDirty(), false);
  assert.equal(SigK.pageEdit.canUndo(), false);
  assert.equal(before.kind, 'highlight');
});

test('painterFor はページの注釈を canvas に描く口を返す', async (t) => {
  const shell = await withOneHighlight(t);
  const { SigK } = shell;
  const painter = SigK.annotate.painterFor(0);
  assert.equal(typeof painter, 'function');
  assert.equal(SigK.annotate.painterFor(1), null);
  const calls = [];
  const ctx = new Proxy({}, { get: (_target, name) => (...args) => { calls.push([name, ...args]); return undefined; }, set: (target, name, value) => { calls.push(['set', name, value]); return true; } });
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  painter(ctx, viewport);
  assert.equal(calls.some((call) => call[0] === 'set' && call[1] === 'globalCompositeOperation' && call[2] === 'multiply'), true);
  assert.equal(calls.some((call) => call[0] === 'fill'), true);
});

test('パスワード付きの文書では注釈モードに入ると帯が出る', async (t) => {
  const shell = await withShell(t, { stub: { password: 'user1' } });
  const opening = shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.document.getElementById('password-prompt-input').value = 'user1';
  shell.document.getElementById('password-prompt-ok').click();
  await opening;
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  assert.match(shell.SigK.viewBanner.text(), /パスワードで保護された PDF は保存できません/);
});
