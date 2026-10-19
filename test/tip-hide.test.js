'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 説明の吹き出しを消す（spec-2-5 J1・J6・J10・J11・J13。tip.js・tip-rules.js・tip-view.js）。出す方は tip.test.js。
// index.html の要素はもう data-tip を持つ（鍵は tip-coverage.test.js が照らす）。ここでは、どの鍵の文を見ているかをテストの中で読めるように、
// 対象の要素に data-tip を付け直してから流す（タブとサムネイルの上のボタンは、JS が付けた data-tip のまま使う）。
// 待ち時間は小さくし（DELAY_MS 30・GRACE_MS 200）、待つのは window.setTimeout の実時間。

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

function pointer(shell, type, node, init = {}) {
  node.dispatchEvent(new shell.window.PointerEvent(type, { bubbles: true, buttons: 0, pointerType: 'mouse', ...init }));
}
const over = (shell, node, init) => pointer(shell, 'pointerover', node, init);
const out = (shell, node, to = shell.document.body) => pointer(shell, 'pointerout', node, { relatedTarget: to });
const sleep = (shell, ms) => new Promise((resolve) => shell.window.setTimeout(resolve, ms));

// ツールバーの［上書き保存］に data-tip を付けて、説明の吹き出しを出したところで返す。
async function shownOnSave(shell) {
  const save = shell.document.getElementById('btn-save');
  save.dataset.tip = 'bar.save';
  over(shell, save);
  await sleep(shell, 60);
  assert.equal(shell.SigK.tip.isShown(), true, '前提: 出ている');
  return save;
}

test('押すと消え、同じ対象の上にいる間は出し直さない。出て入り直すと、また出す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  document.getElementById('btn-save').setAttribute('aria-describedby', 'save-note');
  const save = await shownOnSave(shell);
  assert.equal(save.getAttribute('aria-describedby'), 'tip');
  pointer(shell, 'pointerdown', save, { buttons: 1 });
  assert.equal(SigK.tip.isShown(), false);
  assert.equal(document.getElementById('tip').hidden, true);
  assert.equal(save.getAttribute('aria-describedby'), 'save-note', '消すと元の aria-describedby に戻す');
  pointer(shell, 'pointerup', save);
  over(shell, save.firstElementChild);
  over(shell, save);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false, '押した対象の上にいる間は出し直さない');
  out(shell, save);
  over(shell, save);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true, '出て入り直すと、また出す');
});

// ---- PR-5 の点検の直し: 押すと描き直される要素でも、J11（押したあと同じ要素の上にいる間は出し直さない）を効かせる ----
// タブ（映していないタブを押すとタブを全部作り直す）・サムネイルの上のボタン（押すとサムネイルを作り直す）では、カーソルがそのままでも
// 新しいノードに pointerover が来る。押した要素が文書から外れていて、説明の吹き出しの属性が同じなら、同じ要素とみなす。

const B = 'C:\\work\\b.pdf';

async function withTwoTabs(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }), [B]: makeSource({ path: B, name: 'b.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.SigK.tabs.openPath(B);
  await shell.flush();
  shell.SigK.tip.DELAY_MS = 30;
  shell.SigK.tip.GRACE_MS = 200;
  return shell;
}

const tabOf = (shell, name) => [...shell.document.querySelectorAll('#tabbar .tab')].find((node) => node.dataset.tipName === name);

// node を押して離し、click を流して、描き直しを待つ。
async function pressAndClick(shell, node) {
  pointer(shell, 'pointerdown', node, { buttons: 1 });
  pointer(shell, 'pointerup', node);
  node.click();
  await shell.flush();
  await shell.flush();
}

test('映していないタブを押してタブが描き直されても、同じタブの上にいる間は出し直さない。出て入り直すと出す（J11）', async (t) => {
  const shell = await withTwoTabs(t);
  const { SigK, document } = shell;
  const before = tabOf(shell, 'a.pdf');
  assert.equal(before.classList.contains('active'), false, '前提: 映していないタブ');
  await pressAndClick(shell, before);
  const after = tabOf(shell, 'a.pdf');
  assert.equal(before.isConnected, false, '前提: 押すとタブが描き直される');
  assert.equal(after.classList.contains('active'), true);
  over(shell, after.querySelector('.name'));
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false, '描き直された同じタブの上では出し直さない');
  out(shell, after);
  over(shell, after);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true, '出て入り直すと出す');
  assert.equal(document.querySelector('#tip .tip-name').textContent, 'a.pdf');
});

test('タブを押して描き直されたあと、別のタブへ入ったら出し、押したタブへ戻ったときも出す（J11）', async (t) => {
  const shell = await withTwoTabs(t);
  const { SigK, document } = shell;
  await pressAndClick(shell, tabOf(shell, 'a.pdf'));
  over(shell, tabOf(shell, 'b.pdf'));
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true, '別のタブでは出す');
  assert.equal(document.querySelector('#tip .tip-name').textContent, 'b.pdf');
  out(shell, tabOf(shell, 'b.pdf'), tabOf(shell, 'a.pdf'));
  SigK.tip.GRACE_MS = 0;
  over(shell, tabOf(shell, 'a.pdf'));
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true, '押したタブから一度出たので、戻ったら出す');
  assert.equal(document.querySelector('#tip .tip-name').textContent, 'a.pdf');
});

test('サムネイルの上の［左に回す］を押してサムネイルが描き直されても、同じボタンの上にいる間は出し直さない。出て入り直すと出す（J11）', async (t) => {
  const shell = await withShell(t, 'pages');
  const { SigK, document } = shell;
  await shell.flush();
  const toolOf = () => document.querySelector('#thumbs .thumb[data-page="1"] .thumb-tool[data-tool="rotateLeft"]');
  const before = toolOf();
  assert.ok(before !== null, '前提: サムネイルの上のボタンが出ている');
  await pressAndClick(shell, before);
  assert.equal(SigK.viewer.getPlan()[0].rotate, 270, '前提: 回った');
  const after = toolOf();
  assert.equal(before.isConnected, false, '前提: 押すとサムネイルが描き直される');
  over(shell, after.firstElementChild ?? after);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false, '描き直された同じボタンの上では出し直さない');
  out(shell, after);
  over(shell, after);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true, '出て入り直すと出す');
  assert.equal(document.querySelector('#tip .tip-name').textContent, '左に回す');
});

test('samePressed は、同じノードか、押した要素が文書から外れていて説明の吹き出しの属性が同じときだけ真（J11）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const { samePressed } = SigK.tipRules;
  const node = (fields) => {
    const el = document.createElement('button');
    Object.assign(el.dataset, fields);
    return el;
  };
  const fields = { tip: 'text', tipName: 'a.pdf', tipDesc: 'C:\\work\\a.pdf' };
  const pressed = node(fields);
  const fresh = node(fields);
  document.body.append(fresh);
  assert.equal(samePressed(pressed, fresh), true, '外れた要素と同じ属性');
  assert.equal(samePressed(fresh, fresh), true, '同じノード');
  assert.equal(samePressed(null, fresh), false);
  assert.equal(samePressed(pressed, null), false);
  assert.equal(samePressed(pressed, node({ ...fields, tipName: 'b.pdf' })), false, '名前が違う');
  assert.equal(samePressed(pressed, node({ ...fields, tipDesc: 'C:\\work\\b.pdf' })), false, '説明が違う');
  assert.equal(samePressed(node({ tip: 'strip.save', tipFile: 'a.pdf' }), node({ tip: 'strip.save', tipFile: 'b.pdf' })), false, 'ファイルが違う');
  assert.equal(samePressed(node({ tip: 'thumb.rotateLeft' }), node({ tip: 'thumb.rotateRight' })), false, '鍵が違う');
  const connected = node(fields);
  document.body.append(connected);
  assert.equal(samePressed(connected, fresh), false, '押した要素が文書にあるなら、属性が同じでも別の要素');
});

test('Esc を押すと説明の吹き出しが消え、同じ 1 回で道具も外れる（決定80 ㊸）', async (t) => {
  const shell = await withShell(t, 'annot');
  const { SigK, document, window } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  await shownOnSave(shell);
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  assert.equal(SigK.tip.isShown(), false);
  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(event.defaultPrevented, true, 'Esc の取りやめは止めない');
});

const HIDE_CASES = [
  ['ホイール', (shell) => shell.document.getElementById('view').dispatchEvent(new shell.window.WheelEvent('wheel', { bubbles: true, deltaY: 100 }))],
  ['スクロール', (shell) => shell.document.getElementById('view').dispatchEvent(new shell.window.Event('scroll'))],
  ['窓の大きさが変わる', (shell) => shell.window.dispatchEvent(new shell.window.Event('resize'))],
  ['アプリが非活性になる', (shell) => shell.window.dispatchEvent(new shell.window.Event('blur'))],
];

for (const [label, fire] of HIDE_CASES) {
  test(`ホイール・スクロール・窓の大きさが変わる・アプリが非活性になると消える（${label}）`, async (t) => {
    const shell = await withShell(t);
    await shownOnSave(shell);
    fire(shell);
    assert.equal(shell.SigK.tip.isShown(), false);
  });
}

// ---- 点検の直し（1 回目） ----

test('Esc 以外のキーでも消え、キーの働きは止めない（defaultPrevented は偽のまま）', async (t) => {
  const shell = await withShell(t);
  await shownOnSave(shell);
  const event = new shell.window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
  shell.document.body.dispatchEvent(event);
  assert.equal(shell.SigK.tip.isShown(), false);
  assert.equal(event.defaultPrevented, false);
});

// フォーカスを当てると、Chromium は要素を見える所へ動かすスクロールを次の描画で起こす。それで待ちを止めると、キーでは出なくなる（J1）。
test('キーで移ったフォーカスで始めた待ちは、スクロールで止めない。出ているものとマウスで始めた待ちは止める', async (t) => {
  const shell = await withShell(t, 'annot');
  const { SigK, document, window } = shell;
  const scroll = () => document.getElementById('view').dispatchEvent(new window.Event('scroll'));
  const pen = document.querySelector('.edit-tool[data-tool="pen"]');
  pen.dataset.tip = 'edit.pen';
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  pen.focus();
  scroll();
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true, 'キーのフォーカスの待ちは止めない');
  scroll();
  assert.equal(SigK.tip.isShown(), false, '出ているものは消す');
  const save = document.getElementById('btn-save');
  save.dataset.tip = 'bar.save';
  over(shell, save);
  scroll();
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false, 'マウスで始めた待ちは止める');
});

test('窓が開くと消える', async (t) => {
  const shell = await withShell(t);
  await shownOnSave(shell);
  shell.document.getElementById('help-dialog').setAttribute('open', '');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(shell.SigK.tip.isShown(), false);
});

test('モードが変わると消える', async (t) => {
  const shell = await withShell(t);
  await shownOnSave(shell);
  shell.SigK.shell.setMode(shell.document, 'tools');
  assert.equal(shell.SigK.tip.isShown(), false);
});

test('待っている間に対象が画面から消えたら出さない', async (t) => {
  const shell = await withShell(t, 'tools');
  const { SigK, document } = shell;
  SigK.strips.setShown(true);
  await shell.flush();
  const strip = document.querySelector('#strips .strip');
  const close = strip.querySelector('[data-act="close"]');
  close.dataset.tip = 'strip.close';
  over(shell, close);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true, '比べるため: 消えなければ出る');
  assert.equal(document.querySelector('#tip .tip-keys').textContent, 'キー: Ctrl+W（選んでいる帯）');
  SigK.tip.hide();
  over(shell, close);
  strip.remove();
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false);
});

test('popover が使えるときは showPopover で出し、hidePopover で消す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const tip = document.getElementById('tip');
  const calls = [];
  tip.showPopover = () => calls.push('show');
  tip.hidePopover = () => calls.push('hide');
  await shownOnSave(shell);
  assert.deepEqual(calls, ['hide', 'show'], 'いったん外してから出す（あとから開いた窓より前に出すため）');
  assert.equal(tip.hidden, false);
  SigK.tip.hide();
  assert.deepEqual(calls, ['hide', 'show', 'hide']);
  assert.equal(tip.hidden, true);
});
