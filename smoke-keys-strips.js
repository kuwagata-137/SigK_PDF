'use strict';

// 起動確認 SIGK_SMOKE_KEYS の、開いたファイルの見せ方の作り直し（spec-2-5）を本物のマウスで確かめる操作。smoke-keys.js が OPS に足す。
//
// PR-1:
//   click:<id>   … その id の要素の真ん中を押して離す（ツールバーの［選択］［ハンド］［上書き保存］、確認の窓のボタンなど）
//   tab-x:<n>    … n 番目（0 始まり）のタブにマウスを載せてから、その × を押して離す
//   chord        … ページの表示の真ん中で、左を押し、右を押し、右・左の順に離す（左＋右の同時押し。spec-2-5 確定事項K4）
// PR-2（帯の画面。spec-2-5 第 D〜F 章）:
//   strip-click:<n>              … n 番目の帯の名前を押す（その帯を選ぶ）
//   strip-btn:<n>:<up|down|save|close> … n 番目の帯の見出しのボタンを押す
//   strip-page:<n>:<p>[:shift|ctrl]   … n 番目の帯の p 番目（0 始まり）の紙を押す（Shift・Ctrl を押しながら）
//   strip-dbl:<n>:<p>            … n 番目の帯の p 番目の紙をダブルクリックする
//   merge-check:<n>              … 右の欄の結合の n 番目の行のチェックボックスを押す

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Input.dispatchMouseEvent の modifiers（Alt=1・Ctrl=2・Meta=4・Shift=8）。
const MODIFIERS = { shift: 8, ctrl: 2 };

// selector に当たる index 番目の要素（inner を渡せば、その中の innerIndex 番目の inner）の真ん中の画面の座標。無い・大きさが 0 なら null。
function centerScript(selector, index = 0, inner = null, innerIndex = 0) {
  return `(() => {
  const outer = document.querySelectorAll(${JSON.stringify(String(selector))})[${Number(index)}];
  const node = outer === undefined ? undefined : (${JSON.stringify(inner)} === null ? outer : outer.querySelectorAll(${JSON.stringify(String(inner ?? ''))})[${Number(innerIndex)}]);
  if (node === undefined)
    return null;
  node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const box = node.getBoundingClientRect();
  if (box.width === 0 || box.height === 0)
    return null;
  return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)];
})()`;
}

function create({ numberOf }) {
  async function mouse(ctx, type, [x, y], { button = 'left', buttons = 0, clickCount = 1, modifiers = 0 } = {}) {
    await ctx.dbg.sendCommand('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount, modifiers });
    ctx.last = [x, y];
    await wait(60);
  }

  async function centerOf(ctx, label, ...where) {
    const point = await ctx.js(centerScript(...where));
    if (point === null)
      throw new Error(`${label}が無い`);
    return point;
  }

  async function click(ctx, point, { modifiers = 0, clickCount = 1 } = {}) {
    await mouse(ctx, 'mouseMoved', point, { modifiers });
    await mouse(ctx, 'mousePressed', point, { buttons: 1, clickCount, modifiers });
    await mouse(ctx, 'mouseReleased', point, { clickCount, modifiers });
  }

  const stripPart = (ctx, n, inner, innerIndex, label) => centerOf(ctx, label, '#strips .strip', numberOf(n, '帯'), inner, innerIndex);

  return {
    click: async (ctx, [id]) => click(ctx, await centerOf(ctx, `要素 ${id} `, `[id=${JSON.stringify(String(id ?? ''))}]`, 0)),
    'tab-x': async (ctx, [n]) => {
      const index = numberOf(n, 'タブ');
      await mouse(ctx, 'mouseMoved', await centerOf(ctx, `${index} 番目のタブ`, '#tabbar .tab', index));
      await click(ctx, await centerOf(ctx, `${index} 番目のタブの × `, '#tabbar .tab .x', index));
    },
    chord: async (ctx) => {
      const at = await centerOf(ctx, 'ページの表示', '#view', 0);
      await mouse(ctx, 'mouseMoved', at);
      await mouse(ctx, 'mousePressed', at, { buttons: 1 });
      await mouse(ctx, 'mousePressed', at, { button: 'right', buttons: 3 });
      await mouse(ctx, 'mouseReleased', at, { button: 'right', buttons: 1 });
      await mouse(ctx, 'mouseReleased', at);
    },
    'strip-click': async (ctx, [n]) => click(ctx, await stripPart(ctx, n, '.fname', 0, `${n} 番目の帯`)),
    'strip-btn': async (ctx, [n, act]) => click(ctx, await stripPart(ctx, n, `.strip-btn[data-act="${String(act ?? '')}"]`, 0, `${n} 番目の帯の ${act} `)),
    'strip-page': async (ctx, [n, p, mod]) => {
      const point = await stripPart(ctx, n, '.strip-page', numberOf(p, '紙'), `${n} 番目の帯の ${p} 番目の紙`);
      await click(ctx, point, { modifiers: MODIFIERS[mod] ?? 0 });
    },
    'strip-dbl': async (ctx, [n, p]) => {
      const point = await stripPart(ctx, n, '.strip-page', numberOf(p, '紙'), `${n} 番目の帯の ${p} 番目の紙`);
      await click(ctx, point);
      await click(ctx, point, { clickCount: 2 });
    },
    'merge-check': async (ctx, [n]) => click(ctx, await centerOf(ctx, `結合の ${n} 番目の行`, '#merge-list .merge-pick', numberOf(n, '行'), '.cbox', 0)),
  };
}

module.exports = { centerScript, create };
