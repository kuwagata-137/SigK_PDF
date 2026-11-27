'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 色の一覧の窓（spec-4b-1b 確定事項6・10〜13、spec-7-2 確定事項B・C。見本 screenshots/office-color-mock-02.png〜07.png）。

const A = 'C:\\work\\a.pdf';

async function withSquareTool(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({}),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool('shape');
  shell.SigK.annotate.setShapeKind('square');
  return shell;
}

function click(shell, node) {
  node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
}

test('▼ を押すと、見出し・テーマの色・濃淡 5 段・標準の色・項目の一覧が右パネルの左に開き、今の色に印が付く', async (t) => {
  const shell = await withSquareTool(t);
  const { document, SigK } = shell;
  const pop = document.getElementById('color-pop');
  const chip = document.getElementById('props-color');
  assert.equal(pop.hidden, true);
  click(shell, chip);
  assert.equal(pop.hidden, false);
  assert.equal(SigK.colorPopover.isOpen(), true);
  assert.equal(pop.querySelector('.ttl').textContent, '線の色');
  // 最近使用した色はまだ無いので、見出しごと出さない（spec-7-2 確定事項B2）。
  assert.deepEqual([...pop.querySelectorAll('.sub')].filter((node) => !node.hidden).map((node) => node.textContent), ['テーマの色', '標準の色']);
  const grids = [...pop.querySelectorAll('.grid')].filter((grid) => !grid.hidden);
  assert.deepEqual(grids.map((grid) => grid.querySelectorAll('.cell').length), [10, 50, 10]);
  // 項目は［その他の色…］［太さ ▶］［線種 ▶］（spec-7-2 確定事項B3）。［線なし］は見出し「枠線」のラジオボタン「なし」にしたので削除した（決定102 ④）。
  assert.deepEqual([...pop.querySelectorAll('.items .item')].map((item) => item.querySelector('.label').textContent), ['その他の色…', '太さ', '線種']);
  assert.deepEqual(plain(SigK.annotationPalette.PALETTE_ROWS.flat()), [...pop.querySelectorAll('.cell')].map((cell) => cell.dataset.color));
  const on = [...pop.querySelectorAll('.cell.on')];
  assert.deepEqual(on.map((cell) => [cell.dataset.color, cell.getAttribute('aria-pressed'), SigK.tipContent.resolve(cell).name]), [['#ff0000', 'true', '#FF0000']]);
  assert.equal(document.activeElement, on[0], '今の色へフォーカスを移す');
  assert.equal(chip.classList.contains('open'), true);
  assert.equal(chip.getAttribute('aria-expanded'), 'true');
  assert.equal(pop.querySelector('.items .none'), null);
  // 右パネルの左端から 276px 左、行の上端の 40px 上（jsdom は寸法が 0 なので下限の 8px・90px）。
  assert.deepEqual([pop.style.left, pop.style.top], ['8px', '90px']);
  // 色を選ぶと当てて閉じ、チップへフォーカスを戻す。
  click(shell, pop.querySelector('.cell[data-color="#4472c4"]'));
  assert.equal(pop.hidden, true);
  assert.equal(chip.classList.contains('open'), false);
  assert.equal(chip.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, chip);
  assert.equal(SigK.annotate.colorOf('square'), '#4472c4');
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('Esc・外を押す・同じチップをもう 1 度押す、のどれでも閉じ、中を押しても閉じない', async (t) => {
  const shell = await withSquareTool(t);
  const { document, SigK } = shell;
  const pop = document.getElementById('color-pop');
  const chip = document.getElementById('props-color');
  click(shell, chip);
  pop.querySelector('.cell').dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(pop.hidden, true);
  assert.equal(document.activeElement, chip);
  assert.equal(SigK.annotate.getTool(), 'shape', 'Esc は窓を閉じるだけで、道具は離さない');

  click(shell, chip);
  pop.dispatchEvent(new shell.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(pop.hidden, false);
  document.querySelector('.pdf-page[data-page="1"]').dispatchEvent(new shell.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(pop.hidden, true);
  // 押したままだと四角の描きかけが残り、次の Esc はそちらを先に取りやめる（spec-4b-7a 確定事項A1）。離して終える。
  document.querySelector('.pdf-page[data-page="1"]').dispatchEvent(new shell.window.MouseEvent('mouseup', { bubbles: true }));

  click(shell, chip);
  click(shell, chip);
  assert.equal(pop.hidden, true);
  // 窓の外で Esc を押しても、まず窓を閉じる（annotate.escape）。
  click(shell, chip);
  chip.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(pop.hidden, true);
  assert.equal(SigK.annotate.getTool(), 'shape');
});

test('塗りの［塗りなし］は線があるときだけ押せ、「その他の色…」は色の設定の画面で選んだ色を当てて最近使用した色に足す', async (t) => {
  const shell = await withSquareTool(t);
  const { document, SigK } = shell;
  const pop = document.getElementById('color-pop');
  shell.pickColor('props-fill', '#ffd966');
  assert.equal(SigK.annotate.fillOf('square'), '#ffd966');
  click(shell, document.getElementById('props-fill'));
  assert.equal(pop.querySelector('.ttl').textContent, '塗りつぶし');
  const none = pop.querySelector('.items .none');
  assert.deepEqual([none.textContent, none.getAttribute('aria-disabled')], ['塗りなし', null]);
  assert.equal(pop.querySelector('.cell.on').dataset.color, '#ffd966');
  // 「その他の色…」: 一覧を閉じて色の設定の画面を開く。今の色から選び始め、［OK］で当てる（spec-7-2 確定事項C）。
  click(shell, pop.querySelector('.items .other'));
  assert.equal(pop.hidden, true);
  assert.equal(SigK.colorDialog.isOpen(), true);
  assert.equal(SigK.colorDialog.color(), '#ffd966', '今の色から選び始める');
  const hex = document.getElementById('color-dialog-hexcode');
  hex.value = '123456';
  hex.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  click(shell, document.getElementById('color-dialog-ok'));
  assert.equal(SigK.colorDialog.isOpen(), false);
  assert.equal(SigK.annotate.fillOf('square'), '#123456');
  assert.deepEqual([...SigK.colorMemory.recent()], ['#123456'], '色の設定の画面で選んだ色は最近使用した色に足す');
  assert.equal(SigK.colorMemory.lastOf('fill'), '#123456', '塗りの直前の色になる');
  // 見出し「枠線」で「なし」を選ぶと、塗りの［塗りなし］は押せない（決定102 ④）。
  const off = document.querySelector('#props-stroke-on-row input[value="off"]');
  off.checked = true;
  off.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  assert.equal(SigK.annotate.nextStyleOf('square').color, null);
  click(shell, document.getElementById('props-fill'));
  assert.equal(pop.querySelector('.items .none').getAttribute('aria-disabled'), 'true');
  assert.deepEqual([...pop.querySelectorAll('.grid.recent .cell')].map((cell) => cell.dataset.color), ['#123456']);
  assert.equal(pop.querySelector('.colors .cell.on'), null, 'パレットに無い色には、テーマの色・標準の色の並びで印を付けない');
  assert.deepEqual([...pop.querySelectorAll('.cell.on')].map((cell) => cell.dataset.color), ['#123456'], '最近使用した色の今の色に印を付ける');
});

// 質問 SH6 案B「塗りなしを選んだ後は、カラーバーも黒枠に中身は白にする。バケツのボタンをクリックすると、塗りつぶしなしを当てる。
// 赤で塗りたい時は、▼ の一覧で赤を選ぶ。」
test('［塗りなし］を選んだ後は、塗りつぶしのカラーバーを「なし」の表示にし、左側のボタンで塗りつぶしなしを当てる', async (t) => {
  const shell = await withSquareTool(t);
  const { document, SigK } = shell;
  const pop = document.getElementById('color-pop');
  const main = document.getElementById('props-fill-apply');
  const bar = main.querySelector('.bar');
  shell.pickColor('props-fill', '#ff0000');
  assert.equal(bar.classList.contains('none'), false);
  assert.equal(bar.style.background, 'rgb(255, 0, 0)');
  click(shell, document.getElementById('props-fill'));
  click(shell, pop.querySelector('.items .none'));
  assert.equal(SigK.annotate.fillOf('square'), null);
  assert.equal(SigK.colorMemory.lastOf('fill'), null);
  assert.equal(bar.classList.contains('none'), true, 'カラーバーは黒枠に中身は白');
  assert.equal(bar.style.background, '');
  assert.equal(main.getAttribute('aria-label'), '塗りつぶしをなしに変更');
  assert.equal(shell.uiCalls.some((patch) => patch.annotLastColors?.fill === null), true, 'settings.json に書く');
  // 塗りつぶしのある四角を描き、左側のボタンをクリックすると、塗りつぶしなしを当てる。
  shell.pickColor('props-fill', '#ffd966');
  const node = document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  const mouse = (type, target, [x, y]) => target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  mouse('mousedown', node, px([100, 700]));
  mouse('mousemove', document.body, px([200, 600]));
  mouse('mouseup', node, px([200, 600]));
  const id = SigK.viewer.getAnnotations().added.at(-1).id;
  const fillOf = () => SigK.viewer.getAnnotations().added.find((entry) => entry.id === id).fill;
  assert.equal(fillOf(), '#ffd966');
  assert.equal(bar.classList.contains('none'), false, '色を選ぶとカラーバーはその色');
  click(shell, document.getElementById('props-fill'));
  click(shell, pop.querySelector('.items .none'));
  assert.equal(fillOf(), null);
  // 元に戻すと塗りつぶしは #ffd966 に戻り、直前の色は塗りなしのまま。左側のボタンで塗りつぶしなしを当てる。
  SigK.pageEdit.undo();
  assert.equal(fillOf(), '#ffd966');
  assert.equal(bar.classList.contains('none'), true);
  click(shell, main);
  assert.equal(fillOf(), null, '左側のボタンで塗りつぶしなしを当てる');
});

test('テキストの色のパレットには［なし］を出さず、窓の中のキーは紙の上の操作に取られない', async (t) => {
  const shell = await withSquareTool(t);
  const { document, SigK } = shell;
  const page = document.querySelector('.pdf-page[data-page="1"]');
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const fire = (type, target, point) => {
    const [x, y] = viewport.convertToViewportPoint(point[0], point[1]);
    target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  };
  fire('mousedown', page, [100, 700]);
  fire('mousemove', document.body, [300, 600]);
  fire('mouseup', page, [300, 600]);
  const selected = SigK.annotate.getSelected();
  click(shell, document.getElementById('props-color'));
  const pop = document.getElementById('color-pop');
  pop.querySelector('.cell').dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  assert.equal(SigK.annotate.getSelected(), selected, 'Delete で書き込みを消さない');
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  SigK.colorPopover.close();
  SigK.annotate.select(null);
  SigK.annotate.setTool('text');
  click(shell, document.getElementById('props-color'));
  assert.equal(pop.querySelector('.ttl').textContent, '文字の色');
  assert.equal(pop.querySelector('.items .none'), null);
});

test('一覧に同じ値の色が 2 つあっても、印は上にある方の 1 つだけに付ける（#808080・#ffc000。spec-7-2 確定事項B6）', async (t) => {
  const shell = await withSquareTool(t);
  const { document, SigK } = shell;
  const pop = document.getElementById('color-pop');
  const cells = () => [...pop.querySelectorAll('.cell')];
  // 一覧の何番目か（0 起点。テーマの色 10・濃淡 50・標準の色 10 の順）。
  const marked = () => cells().flatMap((cell, index) => (cell.classList.contains('on') ? [index] : []));
  const pressed = () => cells().filter((cell) => cell.getAttribute('aria-pressed') === 'true').length;
  for (const [color, top, other] of [['#ffc000', 7, 62], ['#808080', 11, 50]]) {
    assert.deepEqual(cells().flatMap((cell, index) => (cell.dataset.color === color ? [index] : [])), [top, other], `${color} は一覧に 2 つある`);
    SigK.annotate.setColor(color);
    click(shell, document.getElementById('props-color'));
    assert.deepEqual(marked(), [top], `${color} の印は上の 1 つだけ`);
    assert.equal(pressed(), 1);
    assert.equal(document.activeElement, cells()[top], '開いたときは印の付いた見本へ移る');
    // 下の方を押しても、当たる色は同じ。
    click(shell, cells()[other]);
    assert.equal(SigK.annotate.nextStyleOf('square').color, color);
  }
});
