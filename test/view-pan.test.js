'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, createShell, makeSource, DEFAULT_VIEWPORT } = require('./harness.js');

// 閲覧・ページ編集のハンド（spec-2-5 確定事項K1・K6・K12・K13・K15。見本 screenshots/strips1-view-hand.png）。ハンドのときは
// 紙のどこを左で押して引いても表示が動く（編集モードのハンド〔spec-4b-3b 確定事項A〕と同じ動き。annotate-hand.js を使う）。
// jsdom はスクロール量を丸めないので、引いた差がそのまま出る。#view の左上が (0,0) で、clientWidth（900）より右はスクロールバーの上。

const A = 'C:\\work\\a.pdf';

async function withShell(t, { mode = 'view', open = true } = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  if (open) {
    await shell.SigK.tabs.openPath(A);
    await shell.flush();
  }
  shell.SigK.shell.setMode(shell.document, mode);
  return shell;
}

function view(shell) {
  return shell.document.getElementById('view');
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]') ?? view(shell);
}

function scrollOf(shell) {
  return [view(shell).scrollLeft, view(shell).scrollTop];
}

function mouse(shell, type, target, [x, y], { button = 0, buttons } = {}) {
  const held = buttons ?? (type === 'mouseup' ? 0 : [1, 4, 2][button]);
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons: held });
  target.dispatchEvent(event);
  return event;
}

function esc(shell) {
  const event = new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  shell.document.body.dispatchEvent(event);
  return event;
}

function wheel(shell, { deltaY = -100, ctrl = false } = {}) {
  const event = new shell.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaMode: 0, ctrlKey: ctrl, clientX: 300, clientY: 300 });
  view(shell).dispatchEvent(event);
  return event;
}

const zoomOf = (shell) => shell.SigK.viewer.getState().zoom;
const panning = (shell) => shell.document.documentElement.hasAttribute('data-panning');

for (const mode of ['view', 'pages']) {
  test(`${mode === 'view' ? '閲覧' : 'ページ編集'}でハンドのとき、紙を左で押して引くと逆向きに表示が動き、引いている間だけ data-panning が付く（K1）`, async (t) => {
    const shell = await withShell(t, { mode });
    const { SigK, document } = shell;
    SigK.pointerMode.press('hand');
    view(shell).scrollLeft = 50;
    view(shell).scrollTop = 400;

    const down = mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
    assert.equal(down.defaultPrevented, true, '文字を選ばせない');
    assert.equal(panning(shell), true);
    mouse(shell, 'mousemove', document.body, [290, 260]);
    assert.deepEqual(scrollOf(shell), [60, 440]);
    mouse(shell, 'mouseup', document.body, [290, 260]);
    assert.equal(panning(shell), false);
    mouse(shell, 'mousemove', document.body, [0, 0]);
    assert.deepEqual(scrollOf(shell), [60, 440], '離したら動かない');
  });
}

// ハンドの押しは既定の動きを止めるので、フォーカスがページ番号の欄・検索の欄に残り、続く Ctrl+Z が欄の文字の取り消しになっていた
// （PR-1 の残りの点検の直し。編集モードの紙の押しと同じく欄からフォーカスを外す。spec-4b-7b 点検の直し）。
for (const mode of ['view', 'pages']) {
  test(`${mode === 'view' ? '閲覧' : 'ページ編集'}のハンドで紙を押すと、ページ番号の欄からフォーカスが外れ、Ctrl+Z が文書に効く`, async (t) => {
    const shell = await withShell(t, { mode });
    const { SigK, document } = shell;
    SigK.pointerMode.press('hand');
    if (mode === 'pages')
      SigK.pageEdit.rotate(90, [0]);
    const at = SigK.pageEdit.getHistoryState().at;
    const input = document.getElementById('page-current');
    input.focus();
    assert.equal(document.activeElement, input);

    mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
    mouse(shell, 'mousemove', document.body, [300, 250]);
    mouse(shell, 'mouseup', document.body, [300, 250]);
    assert.notEqual(document.activeElement, input);

    const event = new shell.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    if (mode === 'pages')
      assert.equal(SigK.pageEdit.getHistoryState().at, at - 1, '回したページが戻る');
  });
}

test('選択のときは引かず、押しの既定の動き（文字の選択）も止めない', async (t) => {
  const shell = await withShell(t);
  const down = mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  assert.equal(down.defaultPrevented, false);
  assert.equal(panning(shell), false);
  mouse(shell, 'mousemove', shell.document.body, [300, 200]);
  mouse(shell, 'mouseup', shell.document.body, [300, 200]);
  assert.deepEqual(scrollOf(shell), [0, 0]);
});

test('ハンドでも、スクロールバーの上の押し・右や中のボタン・文書が開いていないときは引かない（K1）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.pointerMode.press('hand');
  mouse(shell, 'mousedown', view(shell), [DEFAULT_VIEWPORT.width + 4, 300]);
  assert.equal(panning(shell), false, 'スクロールバーの上');
  mouse(shell, 'mouseup', view(shell), [DEFAULT_VIEWPORT.width + 4, 300]);
  for (const button of [1, 2]) {
    mouse(shell, 'mousedown', pageNode(shell), [300, 300], { button });
    assert.equal(panning(shell), false, `ボタン ${button}`);
    mouse(shell, 'mousemove', document.body, [300, 200], { button });
    mouse(shell, 'mouseup', pageNode(shell), [300, 200], { button });
  }
  assert.deepEqual(scrollOf(shell), [0, 0]);

  const empty = await withShell(t, { open: false });
  empty.SigK.pointerMode.press('hand');
  mouse(empty, 'mousedown', view(empty), [300, 300]);
  assert.equal(panning(empty), false, '文書が開いていない');
});

test('引いている途中の Esc は引くのを終えるだけで、次の Esc でハンドを選択へ戻して覚える（K12）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.pointerMode.press('hand');
  mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  mouse(shell, 'mousemove', document.body, [300, 250]);

  assert.equal(esc(shell).defaultPrevented, true);
  assert.equal(panning(shell), false);
  assert.equal(SigK.pointerMode.get(), 'hand', '最初の Esc は引くのを終えるだけ');
  mouse(shell, 'mousemove', document.body, [300, 100], { buttons: 1 });
  assert.deepEqual(scrollOf(shell), [0, 50], 'Esc の後は、離すまで動かない');
  mouse(shell, 'mouseup', document.body, [300, 100]);

  const before = shell.uiCalls.length;
  assert.equal(esc(shell).defaultPrevented, true);
  assert.equal(SigK.pointerMode.get(), 'select');
  assert.deepEqual(shell.uiCalls.slice(before), [{ viewPointer: 'select' }]);
  assert.equal(esc(shell).defaultPrevented, false, '選択なら Esc は何もしない');
});

test('ページ編集の Esc は、ページの選択を外してから、ハンドを選択へ戻す（K12）', async (t) => {
  const shell = await withShell(t, { mode: 'pages' });
  const { SigK } = shell;
  SigK.pointerMode.press('hand');
  SigK.pageGrid.setSelection([0, 1]);
  esc(shell);
  assert.equal(SigK.pageGrid.getSelection().length, 0);
  assert.equal(SigK.pointerMode.get(), 'hand');
  esc(shell);
  assert.equal(SigK.pointerMode.get(), 'select');
});

test('引いている途中にモードを替えると、引くのを終える', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.pointerMode.press('hand');
  mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  assert.equal(panning(shell), true);
  SigK.shell.setMode(document, 'pages');
  assert.equal(panning(shell), false);
});

test('ホイール: 閲覧のハンドは Ctrl の有無を問わず拡大・縮小し、ページ編集のハンドは Ctrl なしだけ（K13）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const start = zoomOf(shell);
  assert.equal(wheel(shell).defaultPrevented, false, '閲覧の選択は素のホイールで送る');
  assert.equal(zoomOf(shell), start);

  const { nextZoom, prevZoom } = SigK.viewerLayout;
  SigK.pointerMode.press('hand');
  assert.equal(wheel(shell, { deltaY: -100 }).defaultPrevented, true);
  assert.equal(zoomOf(shell), nextZoom(start));
  assert.equal(wheel(shell, { deltaY: 100, ctrl: true }).defaultPrevented, true);
  assert.equal(zoomOf(shell), prevZoom(nextZoom(start)));

  SigK.shell.setMode(document, 'pages');
  const inPages = zoomOf(shell);
  assert.equal(wheel(shell, { deltaY: -100 }).defaultPrevented, true);
  assert.equal(zoomOf(shell), nextZoom(inPages));
  assert.equal(wheel(shell, { deltaY: 100, ctrl: true }).defaultPrevented, false, 'ページ編集の Ctrl＋ホイールは今のまま');
  assert.equal(zoomOf(shell), nextZoom(inPages));

  SigK.pointerMode.press('select');
  assert.equal(wheel(shell, { deltaY: -100 }).defaultPrevented, false);
});

// jsdom は shell.css を読まないので、カーソルと文字を選ばせない規則は文字で見張る（K15）。
test('閲覧・ページ編集のハンドでは、#view のカーソルを手の形にし、紙の文字を選ばせない（shell.css）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'renderer', 'shell.css'), 'utf8');
  const scope = 'html[data-pointer="hand"]:is([data-mode="view"],[data-mode="pages"])';
  assert.ok(css.includes(`${scope} #view, ${scope} #view *{cursor:grab}`), 'grab のカーソル');
  assert.ok(css.includes(`${scope} .textLayer, ${scope} .textLayer span{user-select:none}`), '文字を選ばせない');
  // 引いている間の grabbing は、編集モードのハンドと同じ規則（モードを問わない）を使う。
  assert.ok(css.includes('html[data-panning] #view, html[data-panning] #view *{cursor:grabbing !important}'));
});
