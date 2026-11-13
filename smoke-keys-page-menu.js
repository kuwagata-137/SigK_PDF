'use strict';

// 起動確認 SIGK_SMOKE_KEYS の、ページの右クリックメニューと削除確認画面（spec-7-5）を本物のマウスで確かめる操作。smoke-keys.js が OPS に追加する。
//
//   thumb-click:<i>[:shift|ctrl]       … 左パネルの i 番目（0 始まり）のサムネイルをクリックする（Shift・Ctrl を押しながら）
//   thumb-rclick:<i|blank>             … 左パネルの i 番目のサムネイルを右クリックする。blank はサムネイルの下の空き
//   strip-rclick:<n>:<p|blank>         … n 番目の帯の p 番目のページを右クリックする。blank は帯のページの右の空き
//   menu-pick:<copy|cut|paste|delete>  … 右クリックメニューの項目をクリックする
//   page-state                         … ページ一覧の様子を控える（モード・メニューの項目・開いている確認画面・ページ数・選択・コピーの有無）
//
// 削除確認画面のボタンは、smoke-keys-strips.js の click:<id>（confirm-page-delete-ok・confirm-page-delete-cancel）で押す。

const { centerScript } = require('./smoke-keys-strips.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Input.dispatchMouseEvent の modifiers（Ctrl=2・Shift=8）。
const MODIFIERS = { shift: 8, ctrl: 2 };

// サムネイルの下の空き（kind が 'thumbs'）か、n 番目の帯のページの右の空き（'strip'）の画面の座標。空きが無ければ null。
function blankScript(kind, n = 0) {
  const thumbs = kind === 'thumbs';
  return `(() => {
  const list = ${thumbs} ? document.getElementById('side-scroll') : document.querySelectorAll('#strips .strip .strip-pages')[${Number(n)}];
  if (list === undefined || list === null)
    return null;
  const cells = list.querySelectorAll(${JSON.stringify(thumbs ? '.thumb' : '.strip-page')});
  const area = list.getBoundingClientRect();
  const last = cells[cells.length - 1]?.getBoundingClientRect() ?? null;
  if (${thumbs}) {
    const y = Math.round((last?.bottom ?? area.top) + 16);
    return y < area.bottom ? [Math.round(area.left + area.width / 2), y] : null;
  }
  const x = Math.round((last?.right ?? area.left) + 16);
  return x < area.right ? [x, Math.round(area.top + area.height / 2)] : null;
})()`;
}

// ページ一覧の様子（spec-7-5 の起動確認で見るもの）。
const stateScript = `(() => {
  const SigK = window.SigK;
  const menu = document.getElementById('page-menu');
  const tabId = SigK.tabs.activeId();
  return {
    mode: document.documentElement.getAttribute('data-mode'),
    menu: menu === null || menu.hidden ? null : [...menu.querySelectorAll('[data-action]')].map((item) => item.dataset.action + (item.getAttribute('aria-disabled') === 'true' ? ':off' : ':on')),
    dialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.id),
    deleteText: document.getElementById('confirm-page-delete-text')?.textContent ?? null,
    focus: document.activeElement?.id || document.activeElement?.tagName || null,
    pageCount: SigK.viewer.getState().pageCount,
    gridSelection: [...SigK.pageGrid.getSelection()],
    stripSelection: tabId === null ? null : [...SigK.stripSelection.get(tabId)],
    clipboard: SigK.pageClipboard.count(),
    banner: document.getElementById('view-banner')?.hidden === false ? document.getElementById('view-banner').textContent : null,
  };
})()`;

function create({ numberOf }) {
  async function mouse(ctx, type, [x, y], { button = 'left', buttons = 0, modifiers = 0 } = {}) {
    await ctx.dbg.sendCommand('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1, modifiers });
    ctx.last = [x, y];
    await wait(60);
  }

  async function click(ctx, point, { modifiers = 0 } = {}) {
    await mouse(ctx, 'mouseMoved', point, { modifiers });
    await mouse(ctx, 'mousePressed', point, { buttons: 1, modifiers });
    await mouse(ctx, 'mouseReleased', point, { modifiers });
  }

  // 右クリック（押して離す。Windows では離したときに contextmenu が届く）。
  async function rightClick(ctx, point) {
    await mouse(ctx, 'mouseMoved', point, { button: 'none' });
    await mouse(ctx, 'mousePressed', point, { button: 'right', buttons: 2 });
    await mouse(ctx, 'mouseReleased', point, { button: 'right' });
  }

  async function pointOf(ctx, script, label) {
    const point = await ctx.js(script);
    if (point === null)
      throw new Error(`${label}が無い`);
    return point;
  }

  const thumbPoint = (ctx, i) => (i === 'blank'
    ? pointOf(ctx, blankScript('thumbs'), 'サムネイルの下の空き')
    : pointOf(ctx, centerScript('#thumbs .thumb', numberOf(i, 'サムネイル')), `${i} 番目のサムネイル`));

  const stripPoint = (ctx, n, p) => (p === 'blank'
    ? pointOf(ctx, blankScript('strip', numberOf(n, '帯')), `${n} 番目の帯のページの右の空き`)
    : pointOf(ctx, centerScript('#strips .strip', numberOf(n, '帯'), '.strip-page', numberOf(p, 'ページ')), `${n} 番目の帯の ${p} 番目のページ`));

  return {
    'thumb-click': async (ctx, [i, mod]) => click(ctx, await thumbPoint(ctx, i), { modifiers: MODIFIERS[mod] ?? 0 }),
    'thumb-rclick': async (ctx, [i]) => rightClick(ctx, await thumbPoint(ctx, i)),
    'strip-rclick': async (ctx, [n, p]) => rightClick(ctx, await stripPoint(ctx, n, p)),
    'menu-pick': async (ctx, [action]) => click(ctx, await pointOf(ctx, centerScript(`#page-menu [data-action="${String(action ?? '')}"]`), `メニューの ${action} `)),
    'page-state': async (ctx, args, step) => {
      ctx.states.push({ at: step.index, ...(await ctx.js(stateScript)) });
    },
  };
}

module.exports = { blankScript, stateScript, create };
