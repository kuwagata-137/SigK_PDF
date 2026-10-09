(function (root) {
  'use strict';

  // 分割の対象を、分割の画面が見えている間だけ開いておく（spec-2-2b 確定事項D5〜D7）。
  //
  // tools.js が、分割の画面が見えるか見えなくなるかを setShown で知らせる。見えなくなったら描く層（split-thumbs.js）を畳み、
  // 見えたら読み直して、書き換わっていれば知らせる（決定77 ③）。ページ数が変わっていたら対象を読み直して盤を作り直す
  // （tools-split.js の syncBoard）。［実行…］の前に書き換わりが分かったとき（split-run.js）も、ここで読み直す。

  const state = { shown: false };

  const banner = () => root.SigK.viewBanner;
  const split = () => root.SigK.toolsSplit;
  const thumbs = () => root.SigK.splitThumbs;
  const render = () => root.SigK.toolsSplitView?.render();

  // 読み直した結果を画面へ。announce なら帯で知らせる。
  async function apply(result, { announce }) {
    const src = split().source();
    if (src === null || result.reason === 'stale')
      return;
    const dirty = src.note === split().NOTE_UNSAVED;
    if (result.reason !== undefined) {
      await split().setSource(src.path, { dirty });   // 読めなくなった。対象の行に印を付ける
      return;
    }
    if (!result.changed)
      return;
    if (result.pageCount !== result.previousPageCount) {
      await split().setSource(src.path, { dirty });
      if (announce)
        banner().show(`「${src.name}」のページ数が変わっていたので、読み直して分け目を消しました。`, { tone: 'warn' });
      return;
    }
    if (announce)
      banner().show(`「${src.name}」が書き換えられていたので、読み直しました。`, { tone: 'warn' });
  }

  async function setShown(shown) {
    if (shown === state.shown)
      return false;
    state.shown = shown;
    if (!shown) {
      await thumbs().fold();
      return true;
    }
    const result = await thumbs().unfold();
    if (state.shown)
      await apply(result, { announce: true });
    render();
    return true;
  }

  // ［実行…］の前に書き換わりが分かったとき。読み直して、ページ数が変われば盤を作り直す（知らせるのは split-run.js）。
  async function reloadAfterChange() {
    await thumbs().fold();
    await apply(await thumbs().unfold(), { announce: false });
    render();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitReload = { setShown, reloadAfterChange, isShown: () => state.shown };
})(typeof window !== 'undefined' ? window : globalThis);
