'use strict';

// 起動確認 SIGK_SMOKE_KEYS の、開いたファイルの見せ方の作り直し（spec-2-5）の PR-1 を本物のマウスで確かめる操作。smoke-keys.js が OPS に足す。
//
//   click:<id>   … その id の要素の真ん中を押して離す（ツールバーの［選択］［ハンド］［上書き保存］、確認の窓のボタンなど）
//   tab-x:<n>    … n 番目（0 始まり）のタブにマウスを載せてから、その × を押して離す
//   chord        … ページの表示の真ん中で、左を押し、右を押し、右・左の順に離す（左＋右の同時押し。spec-2-5 確定事項K4）

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// selector に当たる index 番目の要素の真ん中の画面の座標。無い・大きさが 0 なら null。
function centerScript(selector, index = 0) {
  return `(() => {
  const node = document.querySelectorAll(${JSON.stringify(String(selector))})[${Number(index)}];
  if (node === undefined)
    return null;
  const box = node.getBoundingClientRect();
  if (box.width === 0 || box.height === 0)
    return null;
  return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)];
})()`;
}

function create({ numberOf }) {
  async function mouse(ctx, type, [x, y], { button = 'left', buttons = 0 } = {}) {
    await ctx.dbg.sendCommand('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
    ctx.last = [x, y];
    await wait(60);
  }

  async function centerOf(ctx, selector, index, label) {
    const point = await ctx.js(centerScript(selector, index));
    if (point === null)
      throw new Error(`${label}が無い`);
    return point;
  }

  async function click(ctx, point) {
    await mouse(ctx, 'mouseMoved', point);
    await mouse(ctx, 'mousePressed', point, { buttons: 1 });
    await mouse(ctx, 'mouseReleased', point);
  }

  return {
    click: async (ctx, [id]) => click(ctx, await centerOf(ctx, `[id=${JSON.stringify(String(id ?? ''))}]`, 0, `要素 ${id} `)),
    'tab-x': async (ctx, [n]) => {
      const index = numberOf(n, 'タブ');
      await mouse(ctx, 'mouseMoved', await centerOf(ctx, '#tabbar .tab', index, `${index} 番目のタブ`));
      await click(ctx, await centerOf(ctx, '#tabbar .tab .x', index, `${index} 番目のタブの × `));
    },
    chord: async (ctx) => {
      const at = await centerOf(ctx, '#view', 0, 'ページの表示');
      await mouse(ctx, 'mouseMoved', at);
      await mouse(ctx, 'mousePressed', at, { buttons: 1 });
      await mouse(ctx, 'mousePressed', at, { button: 'right', buttons: 3 });
      await mouse(ctx, 'mouseReleased', at, { button: 'right', buttons: 1 });
      await mouse(ctx, 'mouseReleased', at);
    },
  };
}

module.exports = { centerScript, create };
