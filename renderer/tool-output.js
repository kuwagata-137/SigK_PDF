(function (root) {
  'use strict';

  // ツールで書き出した PDF の後始末（決定80）。結合・画像→PDF の「1 つにまとめる」・透かし・フラット化が使う。
  //
  // 書けた PDF は新しいタブで開く。**モードは変えない**（ツールモードのまま）。今までは開いたら閲覧モードへ移って
  // いたが、ファイルはどのモードで開いてもその画面に出し、別のモードへ移っても開いたままにする、と改めた
  // （spec-2-1 確定事項35・spec-4-5 確定事項43 の「閲覧モードへ移る」を改めた。spec-3-1 確定事項19 は結合と同型）。
  // タブが上限なら開かず、「最近使ったファイル」へ載せる。
  // 画像→PDF の「画像ごとに 1 つ」と、分割・PDF→画像の出力は、本数が多いので今までどおり開かない。

  const banner = () => root.SigK.viewBanner;
  const tabs = () => root.SigK.tabs;

  function baseName(filePath) {
    return String(filePath ?? '').split(/[\\/]/).pop();
  }

  // messages は { done, crowded }（通知バーの文言。crowded はタブが上限で開かなかったとき）。開いたかを返す。
  // ここから先は書けている。タブを開けなかったときも含め、知らせは赤く塗らない（決定48）。
  async function openWritten(target, { done, crowded }) {
    if (tabs().count() >= tabs().MAX_TABS) {
      await root.recentAPI?.add?.({ path: target, name: baseName(target), openedAt: new Date().toISOString() });
      banner().show(crowded, { tone: 'info' });
      return false;
    }
    const opened = await tabs().openPath(target);
    banner().show(done, { autoHideMs: 2500, tone: 'info' });
    return opened;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolOutput = { openWritten };
})(typeof window !== 'undefined' ? window : globalThis);
