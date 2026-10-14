(function (root) {
  'use strict';

  // フラット化の書き込みを数える（spec-4-5 確定事項32・38、spec-2-5 確定事項E5-6）。ワーカー（kind: flatten-preview）がページごと・
  // まとまりごとに数え、画面（tools-flatten.js）がチェックと範囲に合わせて足し合わせる。
  //
  // 数えはほかの処理と同時に走らせない（走らせる枠〔save.js の runTask〕は 1 つで、同時に走らせると走っている処理の記録を上書きし、
  // まだ走っているのに「走っていない」ことになるため。計画外の直し）。ほかの処理が走っていれば後回しにし（waiting）、画面が census() で
  // 件数を読みに来たときに始める。数えた結果は帯（タブ）ごとに覚え、帯を行き来しても同じ文書なら数え直さない。

  const COUNT_LABEL = '書き込みを確認';

  const banner = () => root.SigK.viewBanner;

  // onDone は数え終えたとき（画面を描き直す）。
  function create({ onDone = () => {} } = {}) {
    // current は { path, tabId, doc, pending, waiting, error, result, done }。result は flatten-preview の { baked, ..., pages }。
    let current = null;
    // タブの id → { path, doc, result }。保存して読み直すと doc が替わるので、数え直す。
    const counted = new Map();

    // 数える相手を決める。src は strip-target の対象（null・使えない帯なら数えない）。描いている最中に呼ばれるので、印だけ立てる。
    function setTarget(src) {
      if (src === null || src.blocked !== null) {
        current = null;
        return;
      }
      const doc = root.SigK.tabs.peek(src.tabId)?.doc ?? null;
      const known = counted.get(src.tabId);
      const base = { path: src.path, tabId: src.tabId, doc, error: null, done: null };
      current = known !== undefined && known.path === src.path && known.doc === doc
        ? { ...base, pending: false, waiting: false, result: known.result }
        : { ...base, pending: true, waiting: true, result: null };
    }

    // 後回しにした数えを始める。ほかの処理が走っている間は始めない。
    function resume() {
      const next = current;
      if (next?.waiting !== true || root.SigK.save?.isBusy() === true)
        return;
      next.waiting = false;
      next.done = count(next);
    }

    async function count(next) {
      const result = await root.SigK.save.runTask({ kind: 'flatten-preview', label: COUNT_LABEL, source: next.path });
      if (current !== next) {
        resume();   // 数えている間に差し替えられた。差し替えた先が待っていれば、ここで数え始める
        return;
      }
      next.pending = false;
      if (result?.ok === true) {
        next.result = result;
        counted.set(next.tabId, { path: next.path, doc: next.doc, result });
      } else {
        next.error = result?.canceled === true ? '書き込みを数えるのを中止しました。' : (result?.error ?? '書き込みを数えられませんでした。');
      }
      // 数え終えたら「書き込みを確認しています」の帯を下げる（結果は右の欄に出る）。
      if (banner().text().startsWith(`${COUNT_LABEL}しています`))
        banner().hide();
      onDone();
    }

    // 画面が件数を読みに来たら、後回しにした数えを始める。描いている最中には走らせず、今の処理を終えてから始める。
    // 返す写しには文書（doc）と待ちの Promise（done）を入れない（起動確認が executeJavaScript の戻り値として写すと、pdf.js の文書の
    // 巨大なつながりを写し続けて終わらなかった）。
    function census() {
      if (current?.waiting === true)
        Promise.resolve().then(resume);
      if (current === null)
        return null;
      const { path, tabId, pending, waiting, error, result } = current;
      return { path, tabId, pending, waiting, error, result };
    }

    return { setTarget, census, resume, current: () => current, done: () => current?.done ?? null };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.flattenCensus = { COUNT_LABEL, create };
})(typeof window !== 'undefined' ? window : globalThis);
