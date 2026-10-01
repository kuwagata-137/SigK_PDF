'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

require('../renderer/tool-switch.js');

// 道具の行き来（spec-4b-3b 確定事項B。モック screenshots/phase4b-3-tools.png）。N＝道具なし（null）、S＝選択、H＝ハンド、
// D＝描く道具。道具を切り替えるのは左＋右・道具のボタン・Esc だけで、戻り先（base）は最後に持っていた N か S。

const { next, remember } = globalThis.SigK.toolSwitch;
const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

test('左＋右: N・S・D からはハンドへ、ハンドからは戻り先へ（確定事項B の表・B4）', () => {
  assert.deepEqual(next({ tool: null, base: null }, 'chord'), { tool: 'hand', base: null });
  assert.deepEqual(next({ tool: 'select', base: 'select' }, 'chord'), { tool: 'hand', base: 'select' });
  assert.deepEqual(next({ tool: 'pen', base: 'select' }, 'chord'), { tool: 'hand', base: 'select' });
  assert.deepEqual(next({ tool: 'hand', base: 'select' }, 'chord'), { tool: 'select', base: 'select' });
  assert.deepEqual(next({ tool: 'hand', base: null }, 'chord'), { tool: null, base: null });
});

test('道具のボタン: 同じボタンなら道具なし、別のボタンならその道具。Esc は道具なし（確定事項B の表・B3）', () => {
  assert.deepEqual(next({ tool: 'hand', base: 'select' }, 'button', 'hand'), { tool: null, base: null });
  assert.deepEqual(next({ tool: 'select', base: 'select' }, 'button', 'select'), { tool: null, base: null });
  assert.deepEqual(next({ tool: 'pen', base: null }, 'button', 'pen'), { tool: null, base: null });
  assert.deepEqual(next({ tool: null, base: null }, 'button', 'select'), { tool: 'select', base: 'select' });
  assert.deepEqual(next({ tool: 'select', base: 'select' }, 'button', 'hand'), { tool: 'hand', base: 'select' });
  assert.deepEqual(next({ tool: 'hand', base: 'select' }, 'escape'), { tool: null, base: null });
});

test('戻り先は、道具が N か S になるたびに覚え直し、H・D になっても変えない（確定事項B1）', () => {
  assert.equal(remember(null, 'select'), 'select');
  assert.equal(remember('select', null), null);
  assert.equal(remember('select', 'hand'), 'select');
  assert.equal(remember('select', 'pen'), 'select');
  assert.equal(remember(null, 'shape'), null);
});

test('annotate-tools は戻り先を持ち、左＋右（chord）で表のとおりに切り替える。段の印も揃う（確定事項B2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const tools = SigK.annotateTools;
  const pressed = (tool) => document.querySelector(`#edit-bar .edit-tool[data-tool="${tool}"]`).getAttribute('aria-pressed');
  assert.equal(tools.getBase(), null);
  SigK.annotate.setTool('select');
  SigK.annotate.setTool('pen');
  assert.equal(tools.getBase(), 'select', 'D になっても戻り先は S のまま');
  assert.equal(tools.chord(), 'hand');
  assert.equal(pressed('hand'), 'true');
  assert.equal(tools.chord(), 'select', 'ハンドからは戻り先へ');
  assert.equal(pressed('select'), 'true');
  SigK.annotate.toggleTool('select');
  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(tools.getBase(), null);
  assert.equal(tools.chord(), 'hand');
  assert.equal(tools.chord(), null);
  assert.equal(pressed('hand'), 'false');
});
