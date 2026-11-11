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
  // 項目は［線なし］［その他の色…］［太さ ▶］［線種 ▶］（spec-7-2 確定事項B3）。
  assert.deepEqual([...pop.querySelectorAll('.items .item')].map((item) => item.querySelector('.label').textContent), ['線なし', 'その他の色…', '太さ', '線種']);
  assert.deepEqual(plain(SigK.annotationPalette.PALETTE_ROWS.flat()), [...pop.querySelectorAll('.cell')].map((cell) => cell.dataset.color));
  const on = [...pop.querySelectorAll('.cell.on')];
  assert.deepEqual(on.map((cell) => [cell.dataset.color, cell.getAttribute('aria-pressed'), SigK.tipContent.resolve(cell).name]), [['#ff0000', 'true', '#FF0000']]);
  assert.equal(document.activeElement, on[0], '今の色へフォーカスを移す');
  assert.equal(chip.classList.contains('open'), true);
  assert.equal(chip.getAttribute('aria-expanded'), 'true');
  // 線の色の［なし］は「線なし」。塗りが無いので押せない（線と塗りを両方なしにはできない）。
  const none = pop.querySelector('.items .none');
  assert.deepEqual([none.textContent, none.getAttribute('aria-disabled')], ['線なし', 'true']);
  click(shell, none);
  assert.equal(pop.hidden, false, '押せない［なし］では閉じない');
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
  assert.equal(pop.querySelector('.ttl').textContent, '塗り');
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
  // 線なしにすると、塗りの［塗りなし］は押せない。
  shell.pickColor('props-color', null);
  assert.equal(SigK.annotate.nextStyleOf('square').color, null);
  click(shell, document.getElementById('props-fill'));
  assert.equal(pop.querySelector('.items .none').getAttribute('aria-disabled'), 'true');
  assert.deepEqual([...pop.querySelectorAll('.grid.recent .cell')].map((cell) => cell.dataset.color), ['#123456']);
  assert.equal(pop.querySelector('.colors .cell.on'), null, 'パレットに無い色には、テーマの色・標準の色の並びで印を付けない');
  assert.deepEqual([...pop.querySelectorAll('.cell.on')].map((cell) => cell.dataset.color), ['#123456'], '最近使用した色の今の色に印を付ける');
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
