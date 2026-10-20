'use strict';

// 起動確認 SIGK_SMOKE_KEYS の、アプリの窓のフォーカスを外す・戻す操作。smoke-keys.js が OPS に足す。
// Alt+Tab でアプリに戻ったときに説明の吹き出しが出ないか（spec-2-5 J12 の改訂）を、窓を出した起動確認で確かめるために足した
// （docs/07 決定81 ③）。本物の Alt+Tab のキーは送らない（ユーザーのほかの窓を切り替えてしまうため）。
//
//   blur-window  … ページへ focusin の控えを仕掛けてから、窓のフォーカスを外す（BrowserWindow.blur()）
//   focus-window … 窓のフォーカスを戻す（focus()。Windows が前に出すのを止めて戻らなければ minimize() → restore()）。
//                  戻ったあとに出た focusin の相手・活性の要素・document.hasFocus() を控える
//
// どちらも控えを ctx.states に { at, window: {...} } で足す。窓を隠した起動確認（SIGK_SMOKE_HIDDEN）では、活性になる・ならないが
// 本物と違うので使わない。

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 窓の活性が変わってから、Chromium が blur・focus・focusin を流し終えるまで待つ時間。
const SETTLE_MS = 400;

// ページに focusin の控えを仕掛ける（前の控えは捨てる）。控えるのは、相手の id（無ければ要素の名前）。
const ARM_SCRIPT = `(() => {
  window.__sigkSmokeFocusIns = [];
  if (window.__sigkSmokeFocusInHook !== true) {
    window.__sigkSmokeFocusInHook = true;
    document.addEventListener('focusin', (event) => {
      window.__sigkSmokeFocusIns?.push(event.target?.id || event.target?.tagName || null);
    }, true);
  }
  return true;
})()`;

const READ_SCRIPT = `(() => ({
  hasFocus: document.hasFocus(),
  active: document.activeElement?.id || document.activeElement?.tagName || null,
  focusIns: [...(window.__sigkSmokeFocusIns ?? [])],
}))()`;

function create() {
  return {
    'blur-window': async (ctx, args, step) => {
      await ctx.js(ARM_SCRIPT);
      ctx.win.blur();
      await wait(SETTLE_MS);
      ctx.states.push({ at: step.index, window: { op: 'blur', focused: ctx.win.isFocused() } });
    },
    'focus-window': async (ctx, args, step) => {
      let via = 'focus';
      ctx.win.focus();
      await wait(SETTLE_MS);
      if (!ctx.win.isFocused()) {
        via = 'restore';
        ctx.win.minimize();
        await wait(SETTLE_MS);
        ctx.win.restore();
        await wait(SETTLE_MS);
      }
      if (!ctx.win.isFocused())
        throw new Error('アプリの窓が活性に戻らない（focus() でも minimize() → restore() でも）');
      const page = await ctx.js(READ_SCRIPT);
      ctx.states.push({ at: step.index, window: { op: 'focus', via, focused: true, ...page } });
    },
  };
}

module.exports = { create, SETTLE_MS };
