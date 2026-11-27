'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeText, plain } = require('./text-helpers.js');

// プロパティパネルの「フォント」の行と、次に置くテキストのフォント（版 1.5.0 の③。質問 FT1「案B」・FT2「案A」・FT3「案B 擬似太字」）。

const SYSTEM_FONTS = [{ id: 'yu-gothic', bold: true }, { id: 'ms-gothic', bold: false }];

async function withFonts(t, options = {}) {
  const shell = await withTextShell(t, { systemFonts: SYSTEM_FONTS, ...options });
  await shell.flush();
  return shell;
}

const row = (shell) => shell.document.getElementById('props-font-row');
const select = (shell) => shell.document.getElementById('props-font');
const boldButton = (shell) => shell.document.querySelector('#props-format [data-format="bold"]');
function choose(shell, id) {
  select(shell).value = id;
  select(shell).dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

test('テキストの書き込みツールを選択すると、「文字の色」の下に「フォント」の行を表示し、使えるフォントを並べる。初めは Noto Sans JP（質問 FT2 の推奨案A）', async (t) => {
  const shell = await withFonts(t);
  shell.SigK.annotate.setTool('text');
  await shell.flush();
  assert.equal(row(shell).hidden, false);
  assert.equal(row(shell).previousElementSibling.id, 'props-color-row');
  assert.deepEqual([...select(shell).options].filter((option) => !option.hidden).map((option) => option.textContent), ['Noto Sans JP', '游ゴシック', 'MS ゴシック']);
  assert.equal(select(shell).value, 'noto-sans-jp');
  shell.SigK.annotate.setTool('pen');
  await shell.flush();
  assert.equal(row(shell).hidden, true, 'テキスト以外では表示しない');
});

test('一覧でフォントを選ぶと、次に置くテキストのフォントとして覚え、設定に保存する。置いたテキストはそのフォント', async (t) => {
  const shell = await withFonts(t);
  const { SigK } = shell;
  SigK.annotate.setTool('text');
  await shell.flush();
  choose(shell, 'yu-gothic');
  assert.equal(SigK.annotate.getTextStyle('text').font, 'yu-gothic');
  assert.deepEqual(shell.uiCalls.filter((patch) => patch.annotTextStyle?.font !== undefined).map((patch) => patch.annotTextStyle.font), ['yu-gothic']);
  const entry = placeText(shell, 100, 700, 'あいう');
  assert.equal(entry.font, 'yu-gothic');
  assert.equal(select(shell).value, 'yu-gothic');
});

test('選択中のテキストのフォントを変える（1 世代）。Noto Sans JP に戻すと font の欄を持たない', async (t) => {
  const shell = await withFonts(t);
  const { SigK } = shell;
  const entry = placeText(shell, 100, 700, 'あいう');
  assert.equal(entry.font, undefined);
  const at = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotate.setTextFont('yu-gothic'), true);
  assert.equal(SigK.annotate.selectedEntry().font, 'yu-gothic');
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  assert.equal(SigK.annotate.setTextFont('noto-sans-jp'), true);
  assert.equal('font' in SigK.annotate.selectedEntry(), false);
  assert.equal(SigK.annotate.setTextFont('meiryo'), false, 'このパソコンで使えないフォントは選べない');
});

test('太字の書体が無いフォント（MS ゴシック）でも［B］を押せ、太字はそのまま（擬似太字で描く。質問 FT3「案B」）', async (t) => {
  const shell = await withFonts(t);
  const { SigK } = shell;
  placeText(shell, 100, 700, 'あいう');
  SigK.annotate.setTextFlag('bold', true);
  assert.equal(SigK.annotate.selectedEntry().bold, true);
  assert.equal(SigK.annotate.setTextFont('ms-gothic'), true);
  await shell.flush();
  assert.equal(SigK.annotate.selectedEntry().bold, true, 'フォントを変えても太字は外さない');
  assert.equal(SigK.annotate.getTextStyle('text').bold, true);
  assert.equal(boldButton(shell).disabled, false);
  assert.equal(SigK.annotate.setTextFlag('bold', false), true);
  assert.equal(SigK.annotate.selectedEntry().bold, undefined);
  assert.equal(SigK.annotate.setTextFlag('bold', true), true);
  assert.equal(SigK.annotate.selectedEntry().bold, true);
  const text = shell.document.querySelector('.annot-layer g.free-text text');
  assert.equal(text?.getAttribute('stroke-width'), String(Math.round((12 / 30) * shell.SigK.viewer.getTextLayer(0).viewport.scale * 100) / 100), '注釈の層は擬似太字の線で描く');
});

test('覚えたフォントは起動時に戻る。使えないフォントを覚えていても、置くテキストは Noto Sans JP', async (t) => {
  const ui = { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotTextStyle: { bold: false, font: 'meiryo' } };
  const shell = await withFonts(t, { ui });
  assert.equal(plain(shell.SigK.annotate.getTextStyle()).font, 'meiryo');
  const entry = placeText(shell, 100, 700, 'あいう');
  assert.equal(entry.font, undefined);
});
