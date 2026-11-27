'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeText, placeCallout } = require('./text-helpers.js');

// テキスト・吹き出しの行「枠線」のラジオボタン「あり」「なし」（docs/spec-7-10-shape-tools.md。決定102 ④・質問 SH8 案B「テキストと吹き出しの
// 行「枠線」にも「あり」「なし」を表示し、色の一覧の［枠線なし］を削除する。「なし」の時の色のボタンの表示は、SH5 の答えに合わせる。」）。

function radios(document) {
  const group = document.getElementById('props-border-on');
  return { group, on: group.querySelector('input[value="on"]'), off: group.querySelector('input[value="off"]') };
}

function choose(shell, input) {
  input.checked = true;
  input.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

function chips(document) {
  return document.querySelector('#props-border-row .chip-row');
}

function byId(shell, id) {
  return shell.SigK.viewer.getAnnotations().added.find((entry) => entry.id === id);
}

test('テキストの行「枠線」の名前の下に「あり」「なし」を表示し、色の一覧に［枠線なし］を表示しない', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('text');
  const { group, on, off } = radios(document);
  assert.equal(document.getElementById('props-border-row').hidden, false);
  assert.equal(document.getElementById('props-border-label').nextElementSibling, group);
  assert.deepEqual([...group.querySelectorAll('label')].map((label) => label.textContent), ['あり', 'なし']);
  assert.deepEqual([on.checked, off.checked], [false, true], 'テキストの既定は枠線なし');
  assert.equal(chips(document).hidden, true, '「なし」の時は色のボタンを非表示にする');
  choose(shell, on);
  assert.equal(chips(document).hidden, false);
  document.getElementById('props-border').click();
  assert.equal(document.querySelector('#color-pop .items .none'), null, '［枠線なし］は削除した');
});

test('「なし」で枠線を消して色のボタンと枠線の太さの行を非表示にし、「あり」でなしにする前の色に戻して同じ世代に畳む', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  // 枠線の色は置く前に決める（置いた後に変えると、続けて「なし」にした時に同じ世代に畳まれるため）。
  SigK.annotate.setTool('text');
  SigK.annotate.setBorder('#0070c0');
  placeText(shell, 100, 700, 'あいう');
  const id = SigK.annotate.getSelected();
  assert.equal(SigK.annotate.selectedEntry().borderColor, '#0070c0');
  const at = SigK.pageEdit.getHistoryState().at;
  // 枠線の行の左側のボタンの色（直前の色）を、なしにする前の色と違う色にしておく。
  SigK.colorMemory.setLast('line', '#00b050');
  choose(shell, radios(document).off);
  const after = SigK.annotate.getSelected();
  assert.equal(byId(shell, after).borderColor ?? null, null);
  assert.equal(chips(document).hidden, true);
  assert.equal(document.getElementById('props-width-row').hidden, true);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  choose(shell, radios(document).on);
  assert.equal(byId(shell, SigK.annotate.getSelected()).borderColor, '#0070c0', '直前の色ではなく、なしにする前の色');
  assert.equal(chips(document).hidden, false);
  assert.equal(document.getElementById('props-width-row').hidden, false);
  assert.equal(SigK.pageEdit.getHistoryState().at, at, 'なしにする前と同じ状態に戻ったので、世代は残らない');
  assert.equal(id, after, '自前のテキストは同じ id のまま');
});

test('枠線を付けたことの無いテキストで「あり」を選ぶと、行「枠線」の左側のボタンの色を当て、次に置くテキストの枠線として記憶する', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  placeText(shell, 100, 700, 'あいう');
  SigK.colorMemory.setLast('line', '#00b050');
  choose(shell, radios(document).on);
  assert.equal(SigK.annotate.selectedEntry().borderColor, '#00b050');
  assert.equal(SigK.annotateTextStyle.getNextStyle('text').border, '#00b050');
  assert.equal(SigK.pageEdit.getHistoryState().at, 2);
});

test('複数選択で枠線のあるものとないものが混ざる時は、どちらも選択しない。「なし」「あり」でそれぞれの色に戻す', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  // c は枠線なし（テキストの既定）。a に枠線を付けると次に置くテキストも枠線ありになるので、c を先に置く。
  placeText(shell, 100, 400, 'う');
  const c = SigK.annotate.getSelected();
  placeText(shell, 100, 700, 'あ');
  SigK.annotate.setBorder('#0070c0');
  const a = SigK.annotate.getSelected();
  placeCallout(shell, 300, 600, 'い');
  SigK.annotate.setBorder('#c00000');
  const b = SigK.annotate.getSelected();
  SigK.annotate.setTool(null);
  SigK.annotate.selectKeys([a, b, c]);
  const { on, off } = radios(document);
  assert.deepEqual([on.checked, off.checked], [false, false]);
  assert.equal(chips(document).hidden, false);
  choose(shell, off);
  assert.deepEqual([a, b, c].map((key) => byId(shell, key).borderColor ?? null), [null, null, null]);
  assert.equal(chips(document).hidden, true);
  SigK.colorMemory.setLast('line', '#00b050');
  choose(shell, on);
  assert.deepEqual([a, b, c].map((key) => byId(shell, key).borderColor), ['#0070c0', '#c00000', '#00b050'], 'c はなしにする前も枠線が無いので、左側のボタンの色');
});
