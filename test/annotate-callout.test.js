'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, clickAt, editorNode, typeText, plain } = require('./text-helpers.js');

// 吹き出しの道具・描画・次に付ける値（spec-4b-4b 確定事項C4・C7・D2・D3・G）。保存と読み戻しは free-text-callout.test.js。

// 吹き出しの道具で (x, y) に置いて text を打ち、確定する。確定後に選ばれている書き込みを返す。
function placeCallout(shell, x, y, text) {
  shell.SigK.annotate.setTool('callout');
  clickAt(shell, x, y);
  typeText(shell, text);
  shell.SigK.freeTextEditor.finish();
  return shell.SigK.annotate.selectedEntry();
}

test('道具の段の「吹き出し」を押すと吹き出しの道具を持ち、ヒントと右パネルの見出しが吹き出しになる（確定事項G1・G3・G6）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  document.querySelector('#edit-bar .edit-tool[data-tool="callout"]').click();
  assert.equal(SigK.annotate.drawingTool(), 'callout');
  assert.equal(document.getElementById('props-kind').textContent, '吹き出し（次に付ける）');
  assert.match(document.getElementById('props-hint').textContent, /^紙の上を押すと吹き出しを置きます。/);
  // 右パネルの行はテキストと同じ（文字の大きさ・書式・塗り・枠線）で、値は吹き出しの既定。
  assert.equal(document.getElementById('props-size').value, '12');
  for (const id of ['props-size-row', 'props-format-row', 'props-fill-row', 'props-border-row', 'props-opacity-row'])
    assert.equal(document.getElementById(id).hidden, false, id);
  assert.equal(SigK.annotate.getTextStyle('callout').fill, '#ffffff');
});

test('押した点に入力欄を出し、入力欄の下に吹き出しの輪郭を描いて、打つと本体の下にしっぽが付いてくる（確定事項D2・D3）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('callout');
  clickAt(shell, 100, 700);
  const node = editorNode(shell);
  assert.notEqual(node, null);
  assert.equal(node.style.background, '', '入力欄の地は透明');
  const outline = document.querySelector('svg.callout-editor-outline');
  assert.notEqual(outline, null);
  assert.equal(outline.nextElementSibling, node, '輪郭は入力欄のすぐ前（下）');
  const before = outline.querySelector('path').getAttribute('d');
  typeText(shell, 'あいうえお\nかきく');
  const after = outline.querySelector('path').getAttribute('d');
  assert.notEqual(after, before, '箱が伸びると描き直す');
  const path = outline.querySelector('path');
  assert.deepEqual(['fill', 'stroke'].map((name) => path.getAttribute(name)), ['#ffffff', '#c00000']);
  SigK.freeTextEditor.finish();
});

test('確定すると、既定の色・塗り・枠線 2pt・大きさ 12 で、先を本体の下に置いた吹き出しが 1 つ増える（決定57 ⑪・決定59 ④）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  const entry = placeCallout(shell, 100, 700, 'あいう');
  assert.equal(entry.kind, 'text');
  assert.deepEqual(
    [entry.color, entry.fill, entry.borderColor, entry.borderWidth, entry.fontSize, entry.opacity],
    ['#222a35', '#ffffff', '#c00000', 2, 12, 1],
  );
  // 先は表示の左上から右へ min(幅×0.25, 30)、下へ 高さ＋大きさ×1.6（確定事項D3）。
  const [x1, y1, x2, y2] = entry.rect;
  const width = x2 - x1;
  const height = y2 - y1;
  assert.deepEqual(plain(entry.tip), [x1 + Math.min(width * 0.25, 30), y2 - height - 12 * 1.6].map((value) => Math.round(value * 100) / 100));
  assert.equal(document.querySelector('svg.callout-editor-outline'), null, '確定すると輪郭は外す');
  // 画面は塗りと枠線を 1 本の path で描き、テキストの四角の塗りと枠線は描かない（確定事項C7）。
  const group = document.querySelector(`[data-annot="${entry.id}"]`);
  assert.equal(group.querySelectorAll('path.free-text-callout').length, 1);
  assert.equal(group.querySelectorAll('rect.free-text-fill, rect.free-text-border').length, 0);
  assert.equal(document.getElementById('props-kind').textContent, '吹き出し');
  assert.match(document.getElementById('props-hint').textContent, /しっぽの先の白いつまみで先の位置を/);
});

test('空のまま確定すると置かず、輪郭も外す（確定事項G2）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('callout');
  clickAt(shell, 100, 700);
  SigK.freeTextEditor.finish();
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(document.querySelector('svg.callout-editor-outline'), null);
});

test('しっぽの三角を押しても吹き出しを選ぶ（確定事項C4）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeCallout(shell, 100, 700, 'あいう');
  SigK.annotate.select(null);
  SigK.annotate.setTool('select');
  // 先の少し手前（根元寄り）。箱の外。
  const [tx, ty] = entry.tip;
  const point = [tx, ty + 3];
  assert.ok(point[1] < entry.rect[1], '箱の外');
  clickAt(shell, ...point);
  assert.equal(SigK.annotate.selectedEntry()?.id, entry.id);
});

test('吹き出しの次に付ける値はテキストと別に覚え、settings.json の annotCalloutStyle・annotColors.callout に書く（確定事項G4・G5）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('callout');
  assert.equal(SigK.annotateTextStyle.setTextFill('#FFF2CC'), true);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotCalloutStyle: { fill: '#fff2cc' } });
  assert.equal(SigK.annotateTextStyle.setFontSize(18), true);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotCalloutStyle: { fontSize: 18 } });
  SigK.annotate.setColor('#4472c4');
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotColors: { callout: '#4472c4' } });
  assert.equal(SigK.annotate.getTextStyle('text').fill, null, 'テキストの次に付ける塗りは変えない');
  assert.equal(SigK.annotate.getFontSize(), 12, 'テキストの次に付ける大きさは変えない');
  assert.equal(SigK.annotate.getColors().text, '#222a35');
  const entry = placeCallout(shell, 100, 700, 'あ');
  assert.deepEqual([entry.fill, entry.fontSize, entry.color], ['#fff2cc', 18, '#4472c4']);
  // テキストの道具は今までの値。
  SigK.annotate.setTool('text');
  clickAt(shell, 300, 500);
  typeText(shell, 'い');
  SigK.freeTextEditor.finish();
  const text = SigK.annotate.selectedEntry();
  assert.deepEqual([text.fill, text.fontSize, text.color, text.tip], [undefined, 12, '#222a35', undefined]);
});

test('選んだ吹き出しを直した値は吹き出しの次に付ける値になり、塗りと枠線を両方なしにはできない（確定事項A5・G5）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  placeCallout(shell, 100, 700, 'あいう');
  SigK.annotate.setTool('select');
  assert.equal(SigK.annotateTextStyle.setBorder(null), true);
  assert.equal(SigK.annotate.selectedEntry().borderColor ?? null, null);
  assert.equal(SigK.annotate.getTextStyle('callout').border, null);
  assert.equal(SigK.annotate.getTextStyle('text').border, null);
  // 枠線がないので、塗りは外せない（書き込みも次に付ける値も変わらない）。
  const at = SigK.pageEdit.getHistoryState().at;
  SigK.annotateTextStyle.setTextFill(null);
  assert.equal(SigK.annotate.selectedEntry().fill, '#ffffff');
  assert.equal(SigK.annotate.getTextStyle('callout').fill, '#ffffff');
  assert.equal(SigK.pageEdit.getHistoryState().at, at);
});

test('起動時に annotCalloutStyle・annotColors.callout・annotOpacity.callout を戻す', async (t) => {
  const ui = {
    mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 },
    annotCalloutStyle: { fontSize: 24, bold: true, italic: false, fill: null, border: '#4472c4', borderWidth: 3 },
    annotColors: { callout: '#c00000' }, annotOpacity: { callout: 0.5 },
  };
  const shell = await withTextShell(t, { ui });
  await shell.flush();
  const entry = placeCallout(shell, 100, 700, 'あ');
  assert.deepEqual(
    [entry.fontSize, entry.bold, entry.fill, entry.borderColor, entry.borderWidth, entry.color, entry.opacity],
    [24, true, undefined, '#4472c4', 3, '#c00000', 0.5],
  );
});

test('吹き出しを動かすと先も同じだけ動く（確定事項B4）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeCallout(shell, 100, 700, 'あいう');
  const patch = SigK.annotationMoves.movedPatch(entry, [10, -20]);
  assert.deepEqual(plain(patch.tip), [entry.tip[0] + 10, entry.tip[1] - 20]);
});

test('注釈一覧の行は「吹き出し」の名前とアイコン', async (t) => {
  const shell = await withTextShell(t);
  const entry = placeCallout(shell, 100, 700, 'あいう');
  assert.equal(shell.SigK.annotationIndex.labelOf(entry), '吹き出し');
  assert.equal(shell.SigK.annotationIndex.iconOf(entry), 'callout');
});

test('置いた吹き出しを直すときは輪郭の先が紙の上で動かず、打って伸びても確定後の先は元のまま（確定事項B3・D2）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  const entry = placeCallout(shell, 100, 700, 'あいう');
  assert.equal(SigK.annotateText.editSelected(), true);
  const path = () => document.querySelector('svg.callout-editor-outline path').getAttribute('d');
  const scale = SigK.viewer.getTextLayer(0).viewport.scale;
  const [right, down] = [entry.tip[0] - entry.rect[0], entry.rect[3] - entry.tip[1]];
  const tipText = `L ${Math.round(right * scale * 100) / 100} ${Math.round(down * scale * 100) / 100}`;
  assert.ok(path().includes(tipText), `${path()} に ${tipText}`);
  typeText(shell, 'あいうえおかきくけこ\nさしすせそ');
  assert.ok(path().includes(tipText), '伸びても先は同じ');
  SigK.freeTextEditor.finish();
  assert.deepEqual(plain(SigK.annotate.selectedEntry().tip), plain(entry.tip));
});

test('選んだ吹き出しが断った「なし」は、次に付ける値にも覚えない（確定事項A5・G5）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  placeCallout(shell, 100, 700, 'あいう');
  assert.equal(SigK.annotateTextStyle.setBorder(null), true);
  // 道具の次に付ける枠線を青にしてから、枠線なしの吹き出しを選び直して塗りなしを押す。
  SigK.annotate.select(null);
  SigK.annotate.setTool('callout');
  assert.equal(SigK.annotateTextStyle.setBorder('#4472c4'), true);
  SigK.annotate.setTool('select');
  SigK.annotate.select(SigK.viewer.getAnnotations().added[0].id);
  assert.equal(SigK.annotateTextStyle.setTextFill(null), false, '断る');
  assert.equal(SigK.annotate.selectedEntry().fill, '#ffffff');
  assert.equal(SigK.annotate.getTextStyle('callout').fill, '#ffffff', '次に付ける塗りも変えない');
});
