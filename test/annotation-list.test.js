'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// サイドパネルの注釈一覧（spec-4-4 確定事項9・28〜32）。行の描画・選択の同期・行を押したときのジャンプ。
// 編集モードの左は既定でサムネイルなので（spec-4b-1a 確定事項17）、見出しの切り替えで一覧を出してから見る。

const A = 'C:\\work\\a.pdf';

// 読み込むもの: 1 ページ目にハイライトと他のツールの直線（表示のみ）、3 ページ目にノート。
const IMPORTED = {
  0: [
    { id: '12R', subtype: 'Highlight', rect: [48, 743, 232, 753], quadPoints: [48, 753, 232, 753, 48, 743, 232, 743], color: new Uint8ClampedArray([255, 228, 90]), opacity: 1 },
    { id: '17R', subtype: 'Line', rect: [298, 698, 502, 762], color: new Uint8ClampedArray([255, 0, 0]), contentsObj: { str: 'other line' }, titleObj: { str: '' }, lineCoordinates: [300, 700, 500, 760], lineEndings: ['None', 'None'] },
  ],
  2: [
    { id: '30R', subtype: 'Text', rect: [100, 100, 120, 120], color: new Uint8ClampedArray([140, 233, 154]), contentsObj: { str: 'p3 のノート\n2 行目' }, titleObj: { str: 'SigK' }, hasAppearance: true },
  ],
};

async function withShell(t, options = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED, ...(options.stub ?? {}) }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  return shell;
}

async function withOpenDocument(t, options = {}) {
  const shell = await withShell(t, options);
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.shell.setEditSide(shell.document, 'list');
  return shell;
}

function rows(shell) {
  return [...shell.document.querySelectorAll('#annot-rows .annot-row')];
}

function rowInfo(row) {
  return [row.dataset.key, row.querySelector('.pg').textContent, row.querySelector('.tx').textContent, row.classList.contains('readonly'), row.classList.contains('on')];
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

const plain = (value) => structuredClone(value);

test('文書が無ければ案内、編集モードで注釈一覧を選んでいるときだけ出る', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const list = document.getElementById('annot-list');
  assert.equal(list.hidden, true);
  SigK.shell.setMode(document, 'annot');
  assert.equal(list.hidden, true, '編集モードの既定はサムネイル');
  assert.equal(document.getElementById('thumbs-empty').hidden, false, 'サムネイルの案内が出る');
  document.querySelector('#side-switch button[data-side="list"]').click();
  assert.equal(list.hidden, false);
  assert.equal(document.getElementById('annot-list-empty').hidden, false);
  assert.equal(document.getElementById('annot-list-empty').textContent, '文書を開くと書き込みの一覧が出ます');
  assert.equal(document.getElementById('thumbs-empty').hidden, true);
  assert.equal(rows(shell).length, 0);
  SigK.shell.setMode(document, 'view');
  assert.equal(list.hidden, true);
  assert.equal(document.getElementById('thumbs-empty').hidden, false, '閲覧モードではサムネイルの案内に戻る');
});

test('開くと文書内の注釈がページ順に並び、行はアイコン・p.N・本文か種類名・表示のみの印', async (t) => {
  const shell = await withOpenDocument(t);
  const { document, SigK } = shell;
  assert.equal(document.querySelector('#side-switch button[data-side="list"]').getAttribute('aria-pressed'), 'true');
  // 表示のみは本文（/Contents）があればそれ、無ければ種類名。
  assert.deepEqual(rows(shell).map(rowInfo), [
    ['17R', 'p.1', 'other line', true, false],
    ['12R', 'p.1', 'ハイライト', false, false],
    ['30R', 'p.3', 'p3 のノート', false, false],
  ]);
  const line = rows(shell)[0];
  assert.equal(line.querySelector('.ro').textContent, '表示のみ');
  assert.equal(line.querySelector('.tx').classList.contains('kind'), false);
  assert.equal(line.title, '直線（p.1）: other line');
  assert.equal(rows(shell)[1].querySelector('.tx').classList.contains('kind'), true, '本文が無ければ種類名を灰色で');
  assert.ok(line.querySelector('.ic svg') !== null);
  assert.equal(rows(shell)[2].querySelector('.ic').style.color, 'rgb(140, 233, 154)');
  assert.equal(rows(shell)[2].querySelector('.ro'), null);
  assert.equal(document.getElementById('annot-list-empty').hidden, true);
  // 付けると行が増え、消すと減る。
  SigK.annotate.setTool('note');
  const page = pageNode(shell);
  const [cx, cy] = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(200, 600);
  page.dispatchEvent(new shell.window.MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
  page.dispatchEvent(new shell.window.MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
  const own = SigK.viewer.getAnnotations().added[0];
  assert.deepEqual(rows(shell).map((row) => [row.dataset.key, row.classList.contains('on')]), [['17R', false], ['12R', false], [own.id, true], ['30R', false]]);
  assert.equal(rows(shell)[2].querySelector('.tx').textContent, 'ノート');
  SigK.annotate.remove();
  assert.equal(rows(shell).length, 3);
  // 消した読み込みも消える。
  SigK.annotate.select('17R');
  SigK.annotate.remove();
  assert.deepEqual(rows(shell).map((row) => row.dataset.key), ['12R', '30R']);
  SigK.pageEdit.undo();
  assert.deepEqual(rows(shell).map((row) => row.dataset.key), ['17R', '12R', '30R']);
});

test('注釈が無い文書では「注釈はありません」', async (t) => {
  const shell = await withOpenDocument(t, { stub: { annotations: {} } });
  assert.equal(rows(shell).length, 0);
  assert.equal(shell.document.getElementById('annot-list-empty').hidden, false);
  assert.equal(shell.document.getElementById('annot-list-empty').textContent, '書き込みはありません');
});

test('紙の上で選ぶと行が光り、解除で消える', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  SigK.annotate.select('12R');
  assert.deepEqual(rows(shell).map((row) => row.classList.contains('on')), [false, true, false]);
  SigK.annotate.select(null);
  assert.deepEqual(rows(shell).map((row) => row.classList.contains('on')), [false, false, false]);
});

test('行を押すと選ばれ、描かれているページなら注釈へ寄せる', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;
  const calls = [];
  shell.window.Element.prototype.scrollIntoView = function scrollIntoView(options) { calls.push([this.tagName.toLowerCase(), this.getAttribute('data-annot') ?? this.getAttribute('class'), options]); };
  rows(shell)[1].dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.equal(SigK.annotate.getSelected(), '12R');
  assert.equal(document.getElementById('props-kind').textContent, 'ハイライト');
  assert.ok(calls.some(([tag, key, options]) => tag === 'g' && key === '12R' && options.block === 'center'), '注釈の <g> を中央に寄せる');
  assert.ok(calls.some(([tag, key, options]) => tag === 'button' && options.block === 'nearest'), '一覧の行も見えるところへ');
  assert.equal(SigK.annotationList.isPendingReveal(), false);
  // 表示のみは枠へ寄せる。
  calls.length = 0;
  rows(shell)[0].dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.equal(SigK.annotate.getSelected(), '17R');
  assert.ok(calls.some(([tag, key]) => tag === 'rect' && key === 'annot-frame'));
});

test('描かれていないページの行を押すとそのページへ飛び、描かれたときに寄せる', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  const calls = [];
  shell.window.Element.prototype.scrollIntoView = function scrollIntoView(options) { calls.push([this.getAttribute('data-annot'), options]); };
  // 3 ページ目の層をいったん捨てて「まだ描かれていない」状態にし、goToPage では描き直さないことにする
  // （実機では描画が非同期に届く）。
  const page3 = pageNode(shell, 2);
  page3.replaceChildren();
  const goto = [];
  const original = SigK.viewer.goToPage;
  SigK.viewer.goToPage = (index) => { goto.push(index); return index; };
  try {
    rows(shell)[2].dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
    assert.equal(SigK.annotate.getSelected(), '30R');
    assert.deepEqual(goto, [2]);
    assert.equal(SigK.annotationList.isPendingReveal(), true);
    assert.equal(calls.some(([key]) => key === '30R'), false);
    // 描き直されると寄せる（layer の <g> を作って合図を送る）。
    await shell.flush();
    const svg = shell.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'annot-layer');
    const g = shell.document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-annot', '30R');
    svg.append(g);
    page3.append(svg);
    assert.equal(SigK.annotationList.onPageRendered(2), true);
    assert.equal(SigK.annotationList.isPendingReveal(), false);
    assert.ok(calls.some(([key, options]) => key === '30R' && options.block === 'center'));
    // 用が済んでいれば何もしない。
    assert.equal(SigK.annotationList.onPageRendered(2), false);
  } finally {
    SigK.viewer.goToPage = original;
  }
});

test('ページを並べ替えると p.N が追従する', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  SigK.pageEdit.commit(SigK.pagePlan.movePages(SigK.viewer.getPlan(), [2], 0).plan, { before: [2], after: [0] });
  assert.deepEqual(rows(shell).map((row) => [row.dataset.key, row.querySelector('.pg').textContent]), [['30R', 'p.1'], ['17R', 'p.2'], ['12R', 'p.2']]);
});

test('文書を閉じると案内に戻る', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;
  assert.equal(rows(shell).length, 3);
  await SigK.tabs.closeCurrent?.() ?? SigK.viewer.close();
  await shell.flush();
  assert.equal(rows(shell).length, 0);
  assert.equal(document.getElementById('annot-list-empty').textContent, '文書を開くと書き込みの一覧が出ます');
});

// ---- Ctrl＋クリック・Shift＋クリック（spec-4b-3a 確定事項K。決定39 ⑧の改め） ----

// 1 ページ目に、読み込んだハイライト（12R）の写しを 2 つ足す（上から 12R・写し 1・写し 2 の順に並ぶ高さ）。鍵を返す。
function addHighlights(shell) {
  const { SigK } = shell;
  const base = SigK.annotationState.findAnnot(SigK.viewer.getAnnotations(), SigK.viewer.getImported(), '12R');
  const copy = (top) => ({ ...base, ref: undefined, readonly: undefined, id: undefined, rect: [48, top - 10, 232, top], quads: [[48, top, 232, top, 48, top - 10, 232, top - 10]] });
  let annots = SigK.annotationState.addAnnot(SigK.viewer.getAnnotations(), copy(600));
  annots = SigK.annotationState.addAnnot(annots, copy(500));
  SigK.pageEdit.commitAnnots(annots);
  return SigK.viewer.getAnnotations().added.map((entry) => entry.id);
}

function click(shell, row, { ctrl = false, shift = false } = {}) {
  row.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, ctrlKey: ctrl, shiftKey: shift }));
}

const rowOf = (shell, key) => rows(shell).find((row) => row.dataset.key === key);
const onKeys = (shell) => rows(shell).filter((row) => row.classList.contains('on')).map((row) => row.dataset.key);

test('一覧の Ctrl＋クリックで同じページの行を足し引きし、選んだ行が全部光る（確定事項K1・K4）', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  const [h1, h2] = addHighlights(shell);
  click(shell, rowOf(shell, '12R'));
  click(shell, rowOf(shell, h2), { ctrl: true });
  assert.deepEqual([...SigK.annotate.getSelection()], ['12R', h2]);
  assert.deepEqual(onKeys(shell).sort(), ['12R', h2].sort());
  click(shell, rowOf(shell, h1), { ctrl: true });
  click(shell, rowOf(shell, '12R'), { ctrl: true });
  assert.deepEqual([...SigK.annotate.getSelection()], [h2, h1]);
});

test('一覧で別のページの行を Ctrl＋クリックすると、その 1 件だけに替わり、そのページへ寄せる（確定事項K1・K4）', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  const [h1] = addHighlights(shell);
  const jumps = [];
  const original = SigK.viewer.goToPage;
  SigK.viewer.goToPage = (index) => { jumps.push(index); };
  try {
    click(shell, rowOf(shell, '12R'));
    click(shell, rowOf(shell, h1), { ctrl: true });
    jumps.length = 0;
    click(shell, rowOf(shell, '30R'), { ctrl: true });
    assert.deepEqual([...SigK.annotate.getSelection()], ['30R']);
    assert.deepEqual(jumps, [2]);
  } finally {
    SigK.viewer.goToPage = original;
  }
});

test('2 件以上を選んでいる間は、一覧を押しても紙は寄せない（確定事項K4）', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  const [h1] = addHighlights(shell);
  click(shell, rowOf(shell, '12R'));
  const calls = [];
  shell.window.Element.prototype.scrollIntoView = function scrollIntoView(options) { calls.push([this.tagName.toLowerCase(), options.block]); };
  click(shell, rowOf(shell, h1), { ctrl: true });
  assert.equal(SigK.annotate.getSelection().length, 2);
  assert.equal(calls.some(([, block]) => block === 'center'), false);
  assert.equal(SigK.annotationList.isPendingReveal(), false);
});

test('一覧の Shift＋クリックは、起点の行から押した行までの同じページの行を選ぶ。起点は動かない（確定事項K2）', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  const [h1, h2] = addHighlights(shell);
  const pageRows = rows(shell).filter((row) => row.querySelector('.pg').textContent === 'p.1').map((row) => row.dataset.key);
  const from = pageRows.indexOf('12R');
  click(shell, rowOf(shell, '12R'));
  click(shell, rowOf(shell, h2), { shift: true });
  const expected = pageRows.slice(Math.min(from, pageRows.indexOf(h2)), Math.max(from, pageRows.indexOf(h2)) + 1);
  assert.deepEqual([...SigK.annotate.getSelection()].sort(), expected.sort());
  assert.equal(SigK.annotate.primaryKey(), h2);
  // 起点は 12R のまま。h1 までに縮む。
  click(shell, rowOf(shell, h1), { shift: true });
  assert.equal(SigK.annotate.isSelected('12R'), true);
  assert.equal(SigK.annotate.primaryKey(), h1);
});

test('一覧で別のページの行を Shift＋クリックすると、その 1 件だけ（確定事項K2）', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  addHighlights(shell);
  click(shell, rowOf(shell, '12R'));
  click(shell, rowOf(shell, '30R'), { shift: true });
  assert.deepEqual([...SigK.annotate.getSelection()], ['30R']);
});

test('一覧の Ctrl＋Shift＋クリックは、範囲を今の選択に足す（確定事項K2）', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;
  const [h1, h2] = addHighlights(shell);
  click(shell, rowOf(shell, h2));
  click(shell, rowOf(shell, '17R'), { ctrl: true });
  click(shell, rowOf(shell, h1), { ctrl: true, shift: true });
  assert.equal(SigK.annotate.isSelected(h2), true);
  assert.equal(SigK.annotate.isSelected('17R'), true);
  assert.equal(SigK.annotate.isSelected(h1), true);
});

test('表示のみの書き込みも一覧から複数選択に入り、その枠は鍵の組で引ける（確定事項K5）', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;
  click(shell, rowOf(shell, '12R'));
  click(shell, rowOf(shell, '17R'), { ctrl: true });
  assert.deepEqual([...SigK.annotate.getSelection()], ['12R', '17R']);
  assert.notEqual(document.querySelector('.annot-frame-layer [data-frame-key="17R"] .annot-frame'), null);
  const calls = [];
  shell.window.Element.prototype.scrollIntoView = function scrollIntoView(options) { calls.push([this.getAttribute('class'), this.parentNode?.getAttribute?.('data-frame-key'), options.block]); };
  click(shell, rowOf(shell, '17R'));
  assert.ok(calls.some(([cls, key, block]) => cls === 'annot-frame' && key === '17R' && block === 'center'));
});
