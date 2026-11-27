(function (root) {
  'use strict';

  // フルスクリーンモード（版 1.5.0 の①。質問 FS1「案A」。docs/spec-7-11-view-font.md）。
  //
  // 入ると、<html> に data-fullscreen="on" を付け（ツールバー・編集ツールバー・モード切り替えバー・左パネル・タブバー・ステータスバー・
  // プロパティパネルを隠すのは shell.css）、ウインドウを画面全体に広げる（メインの windowAPI.setFullScreen）。ページだけを表示する。
  // 入るのはツールバーの［フルスクリーン］ボタン（［見開き］の右）か F11 キー、戻るのは Esc キー（escape-order.js の最後の段。今の Esc の
  // 働きを先に行う）か F11 キー。閲覧・ページ編集・編集モードで、文書を開いている時だけ入れる（ボタンの押せる・押せないは viewer-controls.js）。
  // マウスカーソルは隠さない。左＋右の同時押し（［選択］と［ハンド］の切り替え）とホイール（［選択］はページ送り、［ハンド］は拡大・縮小）は、
  // 今の仕組みのまま効く。入った状態は覚えない（次の起動はふつうの画面）。

  const HINT_TEXT = 'Esc キーか F11 キーを押すと、フルスクリーンモードを終了します';
  const HINT_MS = 3000;

  const state = { doc: null, on: false, hint: null, timer: null };

  function modeOf() {
    return state.doc?.documentElement.getAttribute('data-mode') ?? null;
  }

  function canEnter() {
    return state.doc !== null && modeOf() !== 'tools' && root.SigK.viewer?.getState().open === true;
  }

  function windowApi() {
    const api = root.windowAPI;
    return api?.available === true ? api : null;
  }

  function hideHint() {
    if (state.timer !== null)
      root.clearTimeout(state.timer);
    state.timer = null;
    state.hint?.remove();
    state.hint = null;
  }

  function showHint() {
    hideHint();
    const node = state.doc.createElement('div');
    node.className = 'fullscreen-hint';
    node.setAttribute('role', 'status');
    node.textContent = HINT_TEXT;
    state.doc.body.append(node);
    state.hint = node;
    state.timer = root.setTimeout(hideHint, HINT_MS);
  }

  // 表示域の大きさが変わるので、表示倍率（［幅］［全体］の時）とページの位置を計算し直す。
  function refit() {
    root.SigK.viewer?.refit();
  }

  function enter() {
    if (state.on || !canEnter())
      return false;
    state.on = true;
    state.doc.documentElement.setAttribute('data-fullscreen', 'on');
    windowApi()?.setFullScreen(true);
    refit();
    showHint();
    return true;
  }

  // fromWindow は、ウインドウのフルスクリーンが先に解除された時（メインからの通知）。メインへは送り返さない。
  function exit({ fromWindow = false } = {}) {
    if (!state.on)
      return false;
    state.on = false;
    state.doc.documentElement.removeAttribute('data-fullscreen');
    hideHint();
    if (!fromWindow)
      windowApi()?.setFullScreen(false);
    refit();
    return true;
  }

  function toggle() {
    return state.on ? exit() : enter();
  }

  // Esc の順の最後の段（escape-order.js）。フルスクリーンモードなら終了して true。
  function escape() {
    return exit();
  }

  // モードを切り替えた（shell.js の setMode）。ツールモードではフルスクリーンモードを終了する。
  function onModeChanged(mode) {
    if (mode === 'tools')
      exit();
  }

  function init(doc) {
    state.doc = doc;
    windowApi()?.onFullScreenChanged?.((on) => {
      if (on !== true)
        exit({ fromWindow: true });
    });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.fullscreenMode = { HINT_TEXT, init, enter, exit, toggle, escape, onModeChanged, isOn: () => state.on };
})(typeof window !== 'undefined' ? window : globalThis);
