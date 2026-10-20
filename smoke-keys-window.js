'use strict';

// 起動確認 SIGK_SMOKE_KEYS の、アプリの窓のフォーカスを外す・戻す操作。smoke-keys.js が OPS に足す。
// Alt+Tab でアプリに戻ったときに説明の吹き出しが出ないか（spec-2-5 J12 の改訂）を、窓を出した起動確認で確かめるために足した
// （docs/07 決定81 ③）。本物の Alt+Tab のキーは送らない（ユーザーのほかの窓を切り替えてしまうため）。
//
//   blur-window  … ページへ focusin の控えを仕掛けてから、窓のフォーカスを外す（BrowserWindow.blur()。外れなければ止める）
//   focus-window … 窓のフォーカスを戻す（最小化していれば restore()、でなければ focus()。戻らなければ minimize() → restore()）。
//                  戻ったあとに出た focusin の相手・活性の要素・document.hasFocus() を控える
//
// Windows は、後ろにいるアプリが窓の活性を切り替えることを制限している。2026-10-20 の実測では、blur() が 2 回目から効かず、
// 最小化（minimize()）でも外れないことがあり、外れたと報告されてもページに blur が届かないこともあった（spec-6-1 タスク A）。
// 黙って次へ進まないよう、外れない・戻らないときは止めて problems に書く。控えの結果は、ページに blur が届いたか（説明の吹き出しが
// 消えたか）とあわせて読む。
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
      if (ctx.win.isFocused())
        throw new Error('アプリの窓のフォーカスが外れない（blur()）');
      ctx.states.push({ at: step.index, window: { op: 'blur', focused: false } });
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
