(function (root) {
  'use strict';

  // エクスプローラーからの起動要求の受け口（spec-1-6 確定事項77・78・docs/03 3-3）。
  //
  // **購読を始めてから ready() を送る。**順番を逆にすると取りこぼす。実測では
  // `did-finish-load` を合図に送った分まで消えた（7通中5通）。理由は「読み込みが
  // 終わる前だから」ではなく、`contextBridge` 経由の `onLaunch` を呼ぶまで購読が
  // 始まらないからである。メイン側は ready を受けるまで要求を溜めている。
  //
  // 塊⑤ で扱うのは `open` だけである（確定事項78）。パスが届くたびにタブを1枚
  // 足せば済むので、集約もしない。merge・split・toPdf は Phase 2 以降で足す。

  async function handle(request) {
    if (request === null || request === undefined || request.intent !== 'open')
      return 0;

    const paths = Array.isArray(request.paths) ? request.paths : [];
    let opened = 0;
    // 1本ずつ順に開く。まとめて投げると、同じファイルが2枚のタブになる経路
    // （tabs.js の重複判定は開き終わってから効く）を作ってしまう。
    for (const filePath of paths) {
      if (await root.SigK.tabs.openPath(filePath))
        opened += 1;
    }
    return opened;
  }

  function init(_doc, win) {
    if (win.__sigkLaunchReady === true)
      return false;
    win.__sigkLaunchReady = true;

    const api = root.shellAPI;
    if (api?.available !== true)
      return false;

    api.onLaunch?.((request) => handle(request));
    api.ready?.();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.launch = { init, handle };
})(typeof window !== 'undefined' ? window : globalThis);
