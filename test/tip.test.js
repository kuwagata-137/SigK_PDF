'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 説明の吹き出しを出す（spec-2-5 J1・J7〜J9・J11・J12。tip.js・tip-view.js）。消す方は tip-hide.test.js。
// この時点の index.html の要素はまだ title を持つので、テストの中で対象の要素に data-tip を付けてから流す。
// 待ち時間は小さくし（DELAY_MS 30・GRACE_MS 200）、待つのは window.setTimeout の実時間（view-banner.test.js と同じ）。

const A = 'C:\\work\\a.pdf';

async function withShell(t, mode = 'view') {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  shell.SigK.tip.DELAY_MS = 30;
  shell.SigK.tip.GRACE_MS = 200;
  return shell;
}

// selector の要素に鍵 key の data-tip を付けて返す。
function tipped(shell, selector, key) {
  const node = shell.document.querySelector(selector);
  node.dataset.tip = key;
  return node;
}

function pointer(shell, type, node, init = {}) {
  node.dispatchEvent(new shell.window.PointerEvent(type, { bubbles: true, buttons: 0, pointerType: 'mouse', ...init }));
}
const over = (shell, node, init) => pointer(shell, 'pointerover', node, init);
const out = (shell, node, to = shell.document.body) => pointer(shell, 'pointerout', node, { relatedTarget: to });
const key = (shell, name) => shell.document.body.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
const sleep = (shell, ms) => new Promise((resolve) => shell.window.setTimeout(resolve, ms));
const tipText = (shell, selector) => shell.document.querySelector(`#tip ${selector}`)?.textContent ?? null;
const kbds = (shell) => [...shell.document.querySelectorAll('#tip kbd')].map((node) => node.textContent);

test('対象の上に止めると、待ち時間のあとで名前・説明・キーの説明の吹き出しを出す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const save = tipped(shell, '#btn-save', 'bar.save');
  over(shell, save);
  assert.equal(SigK.tip.isShown(), false, '待つ間は出さない');
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true);
  assert.deepEqual({ ...SigK.tip.getState() }, { shown: true, key: 'bar.save' });
  const tip = document.getElementById('tip');
  assert.equal(tip.hidden, false);
  assert.equal(tip.getAttribute('role'), 'tooltip');
  assert.equal(tip.parentElement, document.body);
  assert.equal(tipText(shell, '.tip-name'), '上書き保存');
  assert.equal(tipText(shell, '.tip-desc'), '開いているファイルに、今の変更を書き込みます。元の中身は「名前.pdf.bak」として残ります。');
  assert.deepEqual(kbds(shell), ['Ctrl+S']);
  assert.equal(tipText(shell, '.tip-keys'), 'キー: Ctrl+S');
  assert.equal(save.getAttribute('aria-describedby'), 'tip');
});

test('待つ間に対象から出ると、出さない', async (t) => {
  const shell = await withShell(t);
  const save = tipped(shell, '#btn-save', 'bar.save');
  over(shell, save);
  out(shell, save);
  await sleep(shell, 60);
  assert.equal(shell.SigK.tip.isShown(), false);
  assert.deepEqual({ ...shell.SigK.tip.getState() }, { shown: false, key: null });
});

test('出ていた説明の吹き出しから 0.2 秒以内に隣のボタンへ移ると、待たずに出す', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const save = tipped(shell, '#btn-save', 'bar.save');
  const saveAs = tipped(shell, '#btn-save-as', 'bar.saveAs');
  over(shell, save);
  await sleep(shell, 60);
  out(shell, save, saveAs);
  assert.equal(SigK.tip.isShown(), false, '出ると消える');
  over(shell, saveAs);
  assert.equal(SigK.tip.isShown(), true, '待たずに出す');
  assert.equal(tipText(shell, '.tip-name'), '名前を付けて保存');
  assert.equal(save.hasAttribute('aria-describedby'), false);
  assert.equal(saveAs.getAttribute('aria-describedby'), 'tip');
  // 0.2 秒を過ぎてから入ったときは、待つ。
  out(shell, saveAs);
  await sleep(shell, 250);
  over(shell, save);
  assert.equal(SigK.tip.isShown(), false, '0.2 秒を過ぎたら待つ');
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true);
  // 押して消したあと（「出た」理由でない）は、隣へ移っても待つ。
  pointer(shell, 'pointerdown', save, { buttons: 1 });
  out(shell, save, saveAs);
  over(shell, saveAs);
  assert.equal(SigK.tip.isShown(), false, '押して消したあとは待つ');
});

test('灰色で押せないボタンにも、同じ中身で出す（決定80 ㊹）', async (t) => {
  const shell = await withShell(t);
  const redo = tipped(shell, '#btn-redo', 'bar.redo');
  assert.equal(redo.getAttribute('aria-disabled'), 'true');
  over(shell, redo);
  await sleep(shell, 60);
  assert.equal(shell.SigK.tip.isShown(), true);
  assert.equal(tipText(shell, '.tip-name'), 'やり直し');
  assert.equal(tipText(shell, '.tip-desc'), '元に戻した変更を、もう一度当てます。');
  assert.deepEqual(kbds(shell), ['Ctrl+Y', 'Ctrl+Shift+Z']);
  assert.equal(tipText(shell, '.tip-keys'), 'キー: Ctrl+Y／Ctrl+Shift+Z');
});

test('マウスのボタンを押したまま対象に入っても出さない', async (t) => {
  const shell = await withShell(t);
  over(shell, tipped(shell, '#btn-save', 'bar.save'), { buttons: 1 });
  await sleep(shell, 60);
  assert.equal(shell.SigK.tip.isShown(), false);
});

test('タッチでは出さない', async (t) => {
  const shell = await withShell(t);
  over(shell, tipped(shell, '#btn-save', 'bar.save'), { pointerType: 'touch' });
  await sleep(shell, 60);
  assert.equal(shell.SigK.tip.isShown(), false);
});

test('キーで移ったフォーカスでは出し、マウスで押して当たったフォーカスでは出さない', async (t) => {
  const shell = await withShell(t, 'annot');
  const { SigK } = shell;
  const pen = tipped(shell, '.edit-tool[data-tool="pen"]', 'edit.pen');
  key(shell, 'Tab');
  pen.focus();
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true);
  assert.equal(tipText(shell, '.tip-name'), 'ペン');
  pen.blur();
  assert.equal(SigK.tip.isShown(), false, 'フォーカスが外れると消える');
  pointer(shell, 'pointerdown', pen, { buttons: 1 });
  pen.focus();
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false);
});

test('キーの無い要素は、キーの行を作らない', async (t) => {
  const shell = await withShell(t);
  over(shell, tipped(shell, '#btn-fit-width', 'bar.fitWidth'));
  await sleep(shell, 60);
  assert.equal(shell.SigK.tip.isShown(), true);
  assert.equal(tipText(shell, '.tip-name'), '幅に合わせる');
  assert.equal(shell.document.querySelector('#tip .tip-keys'), null);
});

// ---- 指示書の題に足したもの（controller の補足: 位置を丸める・文が引けないときは出さない） ----

test('位置は data-tip-anchor の要素を基準に、left・top・矢印を丸めた px で付ける', async (t) => {
  const shell = await withShell(t);
  const { document } = shell;
  const save = tipped(shell, '#btn-save', 'bar.save');
  const icon = save.firstElementChild;
  icon.setAttribute('data-tip-anchor', '');
  save.getBoundingClientRect = () => ({ left: 500, top: 500, right: 600, bottom: 530, width: 100, height: 30 });
  icon.getBoundingClientRect = () => ({ left: 100.4, top: 10, right: 180.4, bottom: 40.6, width: 80, height: 30.6 });
  document.getElementById('tip').getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 60, width: 200, height: 60 });
  over(shell, save);
  await sleep(shell, 60);
  const tip = document.getElementById('tip');
  // 中心 140.4 から 24px 左 → 116.4、下 8px → 48.6、矢印は中心 − 左端 → 24（tip-place.js）。
  assert.equal(tip.style.left, '116px');
  assert.equal(tip.style.top, '49px');
  assert.equal(tip.style.getPropertyValue('--arrow'), '24px');
  assert.equal(tip.dataset.side, 'below');
});

test('文が引けない（知らない鍵・文の関数が投げる）ときは出さず、投げ返さない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const save = tipped(shell, '#btn-save', 'no.such.key');
  over(shell, save);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false, '知らない鍵');
  SigK.tipContent.add({ 'test.throws': () => { throw new Error('文の関数が壊れた'); } });
  const saveAs = tipped(shell, '#btn-save-as', 'test.throws');
  over(shell, saveAs);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false, '文の関数が投げる');
  assert.ok(shell.logs.some((entry) => entry.context?.source === 'tip' && /文の関数が壊れた/.test(entry.message)), 'ログに残す');
});
