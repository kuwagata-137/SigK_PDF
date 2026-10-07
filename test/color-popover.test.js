'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 色のパレットの窓（spec-4b-1b 確定事項6・10〜13。モック screenshots/phase4b-style-palette.png）。

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

test('チップを押すと、見出し・テーマの色・濃淡 5 段・標準の色・下の段のパレットが右パネルの左に開き、今の色に印が付く', async (t) => {
  const shell = await withSquareTool(t);
  const { document, SigK } = shell;
  const pop = document.getElementById('color-pop');
  const chip = document.getElementById('props-color');
  assert.equal(pop.hidden, true);
  click(shell, chip);
  assert.equal(pop.hidden, false);
  assert.equal(SigK.colorPopover.isOpen(), true);
  assert.equal(pop.querySelector('.ttl').textContent, '線の色');
  assert.deepEqual([...pop.querySelectorAll('.sub')].map((node) => node.textContent), ['テーマの色', '標準の色']);
  const grids = [...pop.querySelectorAll('.grid')];
  assert.deepEqual(grids.map((grid) => grid.querySelectorAll('.cell').length), [10, 50, 10]);
  assert.deepEqual(plain(SigK.annotationPalette.PALETTE_ROWS.flat()), [...pop.querySelectorAll('.cell')].map((cell) => cell.dataset.color));
  const on = [...pop.querySelectorAll('.cell.on')];
  assert.deepEqual(on.map((cell) => [cell.dataset.color, cell.getAttribute('aria-pressed'), cell.title]), [['#c00000', 'true', '#C00000']]);
  assert.equal(document.activeElement, on[0], '今の色へフォーカスを移す');
  assert.equal(chip.classList.contains('open'), true);
  assert.equal(chip.getAttribute('aria-expanded'), 'true');
  // 線の色の［なし］は「線なし」。塗りが無いので押せない（線と塗りを両方なしにはできない）。
  const none = pop.querySelector('.foot .none');
  assert.deepEqual([none.hidden, none.textContent, none.getAttribute('aria-disabled')], [false, '線なし', 'true']);
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

test('塗りの［塗りなし］は線があるときだけ押せ、「その他の色…」は OS の色の選択で選んだ色を当てる', async (t) => {
  const shell = await withSquareTool(t);
  const { document, SigK } = shell;
  const pop = document.getElementById('color-pop');
  shell.pickColor('props-fill', '#ffd966');
  assert.equal(SigK.annotate.fillOf('square'), '#ffd966');
  click(shell, document.getElementById('props-fill'));
  assert.equal(pop.querySelector('.ttl').textContent, '塗り');
  const none = pop.querySelector('.foot .none');
  assert.deepEqual([none.textContent, none.getAttribute('aria-disabled')], ['塗りなし', null]);
  assert.equal(pop.querySelector('.cell.on').dataset.color, '#ffd966');
  // 「その他の色…」: 隠した <input type="color"> の値が決まったら当てて閉じる。
  const input = pop.querySelector('input.other-input');
  assert.equal(input.value, '#ffd966', '今の色から選び始める');
  click(shell, pop.querySelector('.foot .other'));
  input.value = '#123456';
  input.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  assert.equal(pop.hidden, true);
  assert.equal(SigK.annotate.fillOf('square'), '#123456');
  // 線なしにすると、塗りの［塗りなし］は押せない。
  shell.pickColor('props-color', null);
  assert.equal(SigK.annotate.nextStyleOf('square').color, null);
  click(shell, document.getElementById('props-fill'));
  assert.equal(pop.querySelector('.foot .none').getAttribute('aria-disabled'), 'true');
  assert.equal(pop.querySelector('.cell.on'), null, 'パレットに無い色には印を付けない');
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
  assert.equal(pop.querySelector('.foot .none').hidden, true);
});
