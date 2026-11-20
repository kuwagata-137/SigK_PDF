'use strict';

// モザイクを置いたとき、新しい絵ができるまで前の絵を残す（2026-11-17 のユーザーの報告「画像編集時に、モザイクを配置するたびに画面が
// ホワイトアウトする」）。前は viewer.applyPlan が、モザイクだけが変わったときも全部のページ枠を作り直し（buildPages）、左パネルの
// サムネイル枠も作り直していたので、pdf.js が描き終えるまで、ページとサムネイルの白い背景だけが見えていた。今は、モザイク欄だけが
// 変わったときは枠を作り直さず、モザイクが変わったページだけを、前の絵を残したまま描き直す。
// jsdom には 2D コンテキストが無いので、試験の中だけ「描ける」ことにして canvas を貼らせる（zoom-keep-picture.test.js と同じ作法）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const BOX = [100, 200, 400, 600];
// pdf.js の annotationMode の ENABLE_STORAGE。ページ表示（page-render.js）だけが、この値で描く（サムネイルは指定しない）。
const ENABLE_STORAGE = 3;

async function withMosaicTool(t) {
  const pdfjs = createPdfjsStub();
  const shell = await createShell({ pdfjs, files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) } });
  t.after(() => shell.cleanup());
  shell.window.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  shell.window.HTMLCanvasElement.prototype.getContext = () => ({});
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool('mosaic');
  await settle(shell);
  return { shell, pdfjs };
}

// 描き直しは requestAnimationFrame の後で、pdf.js の待ちを何段か挟む。
async function settle(shell) {
  await shell.flush();
  await shell.flush();
}

function pageNode(shell, index) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

// 枠に表示している絵。描き終えた絵は枠の直下、前の絵は箱（.pdf-held。renderer/page-picture.js）の中にある。
function pictureOf(node) {
  return node.querySelector(':scope > canvas, :scope > .pdf-held > canvas');
}

function thumbSheet(shell, index) {
  return shell.document.querySelector(`#thumbs .thumb[data-page="${index + 1}"] > .sheet`);
}

function px(shell, index, point) {
  return shell.SigK.viewer.getTextLayer(index).viewport.convertToViewportPoint(point[0], point[1]);
}

function fire(shell, type, target, [x, y], { buttons = 0 } = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
}

// index のページで、範囲 box の左上（x1・y2）から右下（x2・y1）までドラッグして、モザイクを置く。
function place(shell, box = BOX, index = 0) {
  fire(shell, 'mousedown', pageNode(shell, index), px(shell, index, [box[0], box[3]]), { buttons: 1 });
  fire(shell, 'mousemove', shell.document.body, px(shell, index, [box[2], box[1]]), { buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell, index), px(shell, index, [box[2], box[1]]));
}

function mosaicCount(shell, index = 0) {
  return shell.SigK.viewer.getPlan()[index].mosaic?.length ?? 0;
}

test('モザイクを置いた直後も、そのページ枠と前の絵を残し、描き終えたら新しい絵と入れ替える', async (t) => {
  const { shell } = await withMosaicTool(t);
  const node = pageNode(shell, 0);
  const picture = pictureOf(node);
  assert.ok(picture !== null, '置く前に絵が無い（試験の前提が崩れた）');

  place(shell);

  assert.equal(mosaicCount(shell), 1, 'モザイクを置けていない');
  assert.equal(pageNode(shell, 0), node, 'ページ枠を作り直した（描き終えるまで白い背景が見える）');
  assert.equal(pictureOf(node), picture, '置いた直後に前の絵が消えた（描き終えるまで白い背景が見える）');

  await settle(shell);
  assert.notEqual(pictureOf(node), picture, '新しい絵に入れ替わっていない');
  assert.equal(node.querySelectorAll(':scope > canvas').length, 1);
  assert.equal(node.querySelector('.pdf-held'), null, '前の絵の箱が残っている');
  assert.equal(node.querySelectorAll(':scope > svg.annot-layer').length, 1);
  assert.ok(node.querySelector('.textLayer') !== null, '文字の層を付け直していない');
});

test('モザイクを置いても、モザイクが変わらないページは描き直さない', async (t) => {
  const { shell, pdfjs } = await withMosaicTool(t);
  const others = [1, 2].filter((index) => pictureOf(pageNode(shell, index)) !== null);
  assert.ok(others.length > 0, '2 ページ目以降を描いていない（試験の前提が崩れた）');
  const pictures = others.map((index) => pictureOf(pageNode(shell, index)));
  const draws = (index) => pdfjs.renderCalls.filter((call) => call.page === index + 1 && call.annotationMode === ENABLE_STORAGE).length;
  const before = others.map(draws);

  place(shell);
  await settle(shell);

  others.forEach((index, at) => assert.equal(pictureOf(pageNode(shell, index)), pictures[at], `${index + 1} ページ目の絵を作り直した`));
  assert.deepEqual(others.map(draws), before, 'モザイクが変わらないページを描き直した');
});

test('左パネルのサムネイルも、新しい絵ができるまで前の絵を残す', async (t) => {
  const { shell } = await withMosaicTool(t);
  const sheet = thumbSheet(shell, 0);
  const picture = sheet?.querySelector('canvas') ?? null;
  assert.ok(picture !== null, 'サムネイルを描いていない（試験の前提が崩れた）');

  place(shell);

  assert.equal(thumbSheet(shell, 0), sheet, 'サムネイル枠を作り直した（描き終えるまで白い背景が見える）');
  assert.equal(sheet.querySelector('canvas'), picture, '置いた直後にサムネイルの前の絵が消えた');
  await settle(shell);
  assert.notEqual(sheet.querySelector('canvas'), picture, 'サムネイルを描き直していない');
  assert.equal(sheet.querySelectorAll('canvas').length, 1);
});

test('取り消し・やり直し・［このページのモザイクを削除］でも、前の絵を残して描き直す', async (t) => {
  const { shell } = await withMosaicTool(t);
  const { SigK } = shell;
  place(shell);
  await settle(shell);
  const steps = [
    ['取り消し', () => SigK.pageEdit.undo(), 0],
    ['やり直し', () => SigK.pageEdit.redo(), 1],
    ['このページのモザイクを削除', () => SigK.annotateMosaic.removeOnPage(0), 0],
  ];
  for (const [label, act, count] of steps) {
    const node = pageNode(shell, 0);
    const picture = pictureOf(node);
    assert.equal(act(), true, label);
    assert.equal(mosaicCount(shell), count, label);
    assert.equal(pageNode(shell, 0), node, `${label}: ページ枠を作り直した`);
    assert.equal(pictureOf(node), picture, `${label}: 前の絵が消えた`);
    await settle(shell);
    assert.notEqual(pictureOf(node), picture, `${label}: 描き直していない`);
  }
});

test('モザイク以外の欄（回転）が変わったときは、ページ枠を作り直し、前の絵を回転して新しい枠に表示する', async (t) => {
  const { shell } = await withMosaicTool(t);
  const { SigK } = shell;
  const node = pageNode(shell, 0);
  const picture = pictureOf(node);
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  assert.notEqual(pageNode(shell, 0), node);
  // 前は、新しい絵を描き終えるまで白い背景だけが見えていた（docs/07 決定99 ②。plan-keep-picture.test.js）。
  assert.equal(pictureOf(pageNode(shell, 0)), picture, '回転の直後に前の絵が消えた');
  assert.match(picture.parentElement.style.transform, /^matrix\(/);
  await settle(shell);
  assert.notEqual(pictureOf(pageNode(shell, 0)), picture, '回したページを描き直していない');
});
