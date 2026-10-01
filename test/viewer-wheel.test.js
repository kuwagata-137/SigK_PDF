'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// ホイールの拡大・縮小（spec-4b-3b 確定事項C。決定53 ⑧⑪⑫・決定55）。ハンドのときは素のホイールで、閲覧・編集モードではどの道具でも
// Ctrl＋ホイールで、「＋」「－」と同じ刻みを 1 段ずつ。マウスの下の紙の点は動かさない。
// jsdom はレイアウトしないので、#view の左上が (0,0) で、#view-pages の中の点は「client の点＋スクロール量」になる。紙の枠の位置は
// viewer が style に書く。

const A = 'C:\\work\\a.pdf';

async function withShell(t, mode = 'annot') {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  return shell;
}

function view(shell) {
  return shell.document.getElementById('view');
}

function wheel(shell, { deltaY = -100, deltaX = 0, ctrl = false, x = 300, y = 300 } = {}) {
  const event = new shell.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaX, deltaMode: 0, ctrlKey: ctrl, clientX: x, clientY: y });
  view(shell).dispatchEvent(event);
  return event;
}

const zoomOf = (shell) => shell.SigK.viewer.getState().zoom;

// client の点が乗っているページと、その中の割合（ページの枠の style から測る）。
function paperPoint(shell, [x, y]) {
  const cx = x + view(shell).scrollLeft;
  const cy = y + view(shell).scrollTop;
  for (const node of shell.document.querySelectorAll('.pdf-page')) {
    const left = parseFloat(node.style.left);
    const top = parseFloat(node.style.top);
    const width = parseFloat(node.style.width);
    const height = parseFloat(node.style.height);
    if (cy >= top && cy <= top + height)
      return { page: node.dataset.page, fx: (cx - left) / width, fy: (cy - top) / height };
  }
  return null;
}

test('ハンドのとき、素のホイールを上へ回すと「＋」と同じ 1 段だけ拡大し、下へ回すと 1 段縮小する（確定事項C1・C2）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('hand');
  const start = zoomOf(shell);
  const up = wheel(shell, { deltaY: -100 });
  assert.equal(up.defaultPrevented, true);
  assert.equal(zoomOf(shell), SigK.viewerLayout.nextZoom(start));
  wheel(shell, { deltaY: 100 });
  assert.equal(zoomOf(shell), SigK.viewerLayout.prevZoom(SigK.viewerLayout.nextZoom(start)));
  wheel(shell, { deltaY: 100 });
  assert.equal(zoomOf(shell), SigK.viewerLayout.prevZoom(SigK.viewerLayout.prevZoom(SigK.viewerLayout.nextZoom(start))));
  assert.equal(SigK.viewer.getState().fit, null, '「幅」の追従は外れる');
});

test('ハンドでない編集モードの素のホイールは拡大・縮小せず、今までどおりスクロールに任せる（確定事項C1・C5）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const start = zoomOf(shell);
  for (const tool of [null, 'select', 'pen']) {
    SigK.annotate.setTool(tool);
    const event = wheel(shell, { deltaY: -100 });
    assert.equal(event.defaultPrevented, false, String(tool));
  }
  assert.equal(zoomOf(shell), start);
});

test('閲覧モードと編集モードでは、どの道具でも Ctrl＋ホイールで拡大・縮小する（確定事項C1。決定53 ⑪）', async (t) => {
  const shell = await withShell(t, 'view');
  const { SigK } = shell;
  const start = zoomOf(shell);
  assert.equal(wheel(shell, { deltaY: 100, ctrl: true }).defaultPrevented, true);
  assert.equal(zoomOf(shell), SigK.viewerLayout.prevZoom(start));
  SigK.shell.setMode(shell.document, 'annot');
  SigK.annotate.setTool('pen');
  wheel(shell, { deltaY: -100, ctrl: true });
  assert.equal(zoomOf(shell), SigK.viewerLayout.nextZoom(SigK.viewerLayout.prevZoom(start)));
});

test('ページ編集モードとツールモードの Ctrl＋ホイールは何もしない（確定事項C1）', async (t) => {
  const shell = await withShell(t, 'pages');
  const { SigK } = shell;
  const start = zoomOf(shell);
  assert.equal(wheel(shell, { deltaY: -100, ctrl: true }).defaultPrevented, false);
  SigK.shell.setMode(shell.document, 'tools');
  assert.equal(wheel(shell, { deltaY: -100, ctrl: true }).defaultPrevented, false);
  assert.equal(zoomOf(shell), start);
});

test('縦の量が 0 のホイール（横だけ）は、ハンドのときも拡大・縮小しない（確定事項C5）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('hand');
  const start = zoomOf(shell);
  assert.equal(wheel(shell, { deltaY: 0, deltaX: 100 }).defaultPrevented, false);
  assert.equal(zoomOf(shell), start);
});

test('タッチパッドの 2 本指（細かい Ctrl＋ホイール）は、溜まってから 1 段（確定事項C3。決定55）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const start = zoomOf(shell);
  for (let i = 0; i < 6; i += 1)
    assert.equal(wheel(shell, { deltaY: -8, ctrl: true }).defaultPrevented, true);
  assert.equal(zoomOf(shell), start, '48 ではまだ');
  wheel(shell, { deltaY: -8, ctrl: true });
  assert.equal(zoomOf(shell), SigK.viewerLayout.nextZoom(start));
});

test('拡大・縮小しても、マウスの下の紙の点（ページとその中の割合）は動かない（確定事項C4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('hand');
  view(shell).scrollTop = 900;
  view(shell).scrollLeft = 30;
  const at = [250, 420];
  const start = zoomOf(shell);
  const before = paperPoint(shell, at);
  assert.notEqual(before, null);
  wheel(shell, { deltaY: -100, x: at[0], y: at[1] });
  wheel(shell, { deltaY: -100, x: at[0], y: at[1] });
  assert.equal(zoomOf(shell), SigK.viewerLayout.nextZoom(SigK.viewerLayout.nextZoom(start)));
  const after = paperPoint(shell, at);
  assert.equal(after.page, before.page);
  assert.ok(Math.abs(after.fx - before.fx) < 1e-6, `${after.fx} ${before.fx}`);
  assert.ok(Math.abs(after.fy - before.fy) < 1e-6, `${after.fy} ${before.fy}`);
  wheel(shell, { deltaY: 100, x: at[0], y: at[1] });
  const back = paperPoint(shell, at);
  assert.ok(Math.abs(back.fy - before.fy) < 1e-6);
});

test('最大・最小に達したら、それ以上は変えず表示も動かさない（確定事項C2）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.viewer.setZoom(4);
  view(shell).scrollTop = 500;
  wheel(shell, { deltaY: -100, ctrl: true });
  assert.equal(zoomOf(shell), 4);
  assert.equal(view(shell).scrollTop, 500);
  SigK.viewer.setZoom(0.25);
  wheel(shell, { deltaY: 100, ctrl: true });
  assert.equal(zoomOf(shell), 0.25);
});

test('文書が開いていなければ何もしない（確定事項C1）', async (t) => {
  const shell = await createShell({});
  t.after(() => shell.cleanup());
  shell.SigK.shell.setMode(shell.document, 'view');
  assert.equal(wheel(shell, { deltaY: -100, ctrl: true }).defaultPrevented, false);
});
