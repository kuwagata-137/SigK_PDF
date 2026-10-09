'use strict';

// 起動確認 SIGK_SMOKE_KEYS の、分割の盤を本物のマウスで押す操作（spec-2-2b 確定事項K3）。smoke-keys.js が OPS に足す。
//
//   split-press:<ページ>[:shift]  … 盤のページを押して離す（click。shift なら Shift を押したまま）
//   split-drag:<a>-<b>            … a のページを押したまま b のページまでなぞって離す
//   split-dblclick:<ページ>       … ダブルクリック（大きく見る窓が開く）
// ページは 0 始まり。盤の準備（分割の画面に切り替えて、映しているタブの PDF を対象にする）は smoke-keys-page.js の split。

const SHIFT = 8;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 盤のページの真ん中の画面の座標。reveal なら見えるところまでスクロールしてから測る（なぞる終わりの点は、始めの点を
// 測ったあとに盤を動かすとずれるので、スクロールせずに測る）。
function pageScript(index, { reveal = true } = {}) {
  return `(() => {
  if (${reveal === true})
    window.SigK.splitBoardView.revealPage(${Number(index)});
  const node = document.querySelector('.sb-page[data-page="${Number(index)}"]');
  if (node === null)
    return null;
  const box = node.getBoundingClientRect();
  return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)];
})()`;
}

function create({ numberOf, spanOf }) {
  async function mouse(ctx, type, [x, y], { buttons = 0, clickCount = 1, modifiers = 0 } = {}) {
    await ctx.dbg.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount, modifiers });
    ctx.last = [x, y];
    await wait(60);
  }

  async function pointOf(ctx, text, options) {
    const point = await ctx.js(pageScript(numberOf(text, 'ページ'), options));
    if (point === null)
      throw new Error(`盤にページが無い: ${text}`);
    return point;
  }

  async function click(ctx, point, { modifiers = 0, clickCount = 1 } = {}) {
    await mouse(ctx, 'mouseMoved', point, { modifiers });
    await mouse(ctx, 'mousePressed', point, { buttons: 1, clickCount, modifiers });
    await mouse(ctx, 'mouseReleased', point, { clickCount, modifiers });
  }

  return {
    'split-press': async (ctx, [index, mod]) => click(ctx, await pointOf(ctx, index), { modifiers: mod === 'shift' ? SHIFT : 0 }),
    'split-drag': async (ctx, [span]) => {
      const [from, to] = spanOf(span);
      const start = await pointOf(ctx, from);
      const end = await pointOf(ctx, to, { reveal: false });
      await mouse(ctx, 'mouseMoved', start);
      await mouse(ctx, 'mousePressed', start, { buttons: 1 });
      for (const ratio of [0.34, 0.67, 1])
        await mouse(ctx, 'mouseMoved', [Math.round(start[0] + (end[0] - start[0]) * ratio), Math.round(start[1] + (end[1] - start[1]) * ratio)], { buttons: 1 });
      await mouse(ctx, 'mouseReleased', end);
    },
    'split-dblclick': async (ctx, [index]) => {
      const point = await pointOf(ctx, index);
      await click(ctx, point, { clickCount: 1 });
      await click(ctx, point, { clickCount: 2 });
    },
  };
}

module.exports = { create, pageScript };
