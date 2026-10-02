'use strict';

// テキストの書き込みのテストで使う道具（spec-4b-4a）。画面の土台（harness.js の createShell）にテキストの道具を持たせ、
// 紙を押して入力欄に打ち、確定するまでを短く書く。jsdom には canvas が無いので、幅は free-text-shape の見積もり
// （全角 1em・半角 0.5em）で決まる。

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

async function withTextShell(t, options = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub(options.stub ?? {}),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

// pt の点でページを押して離す（動かさない）。
function clickAt(shell, x, y, index = 0) {
  const page = pageNode(shell, index);
  const [cx, cy] = shell.SigK.viewer.getTextLayer(index).viewport.convertToViewportPoint(x, y);
  page.dispatchEvent(new shell.window.MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy, button: 0, buttons: 1 }));
  page.dispatchEvent(new shell.window.MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy, button: 0, buttons: 0 }));
}

function editorNode(shell) {
  return shell.document.querySelector('textarea.free-text-editor');
}

function typeText(shell, text) {
  const node = editorNode(shell);
  node.value = text;
  node.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
}

// テキストの道具で (x, y) に置いて text を打ち、確定する。確定後に選ばれている書き込みを返す。
function placeText(shell, x, y, text) {
  shell.SigK.annotate.setTool('text');
  clickAt(shell, x, y);
  typeText(shell, text);
  shell.SigK.freeTextEditor.finish();
  return shell.SigK.annotate.selectedEntry();
}

// jsdom の窓の中で作った値は Node の値と別の世界のものなので、値だけを比べる。
const plain = (value) => JSON.parse(JSON.stringify(value));

module.exports = { A, withTextShell, pageNode, clickAt, editorNode, typeText, placeText, plain };
