(function (root) {
  'use strict';

  // トリミングの道具の操作（spec-4b-6a 確定事項10・14・17〜19。決定64 ②③）。当てるページ・Enter と［適用］・［トリミングを外す］。
  //
  // 枠と押し離しは annotate-trim.js、plan の作り替えは trim-commit.js、右パネルは trim-props.js。ここは枠を受け取って切り、切ったページへ
  // 表示を寄せ、すべてのページなら帯で数を知らせる。外すときは紙全体（page-boxes.js）を読み終えるのを待つ。

  const state = {
    // 当てるページ（'page'＝このページ、'all'＝すべてのページ）。道具を持つたびに 'page' へ戻す（起草者の判断）。
    scope: 'page',
    // 紙全体を読み終えるのを待って外している間は true（［トリミングを外す］を押せなくする）。
    removing: false,
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function refresh() {
    root.SigK.trimProps?.refresh();
  }

  // 枠の札と右パネルの「残す大きさ」の文字（表示の向きの幅と高さ。確定事項12・17）。frame は { index, box }。
  function labelOf(frame) {
    const entry = viewer().getPlan()[frame.index];
    const base = Number.isInteger(entry?.src) ? viewer().getBasePage(entry.src) : null;
    return root.SigK.pageCrop.sizeLabel(frame.box, (base?.rotate ?? 0) + (entry?.rotate ?? 0));
  }

  // 帯（青）「○ ページを切りました。」。そのままにしたページがあれば数を添える（確定事項18）。
  function announce({ count, small, inserted }) {
    const kept = [small > 0 ? `小さすぎる ${small} ページ` : null, inserted > 0 ? `差し込んだ ${inserted} ページ` : null].filter(Boolean);
    const rest = kept.length === 0 ? '' : `${kept.join('と')}はそのままです。`;
    root.SigK.viewBanner?.show(`${count} ページを切りました。${rest}`, { tone: 'info' });
  }

  // Enter・［適用］: 枠で切る（確定事項14・18）。1 世代にまとめ、枠を消し、切ったページの上端へ表示を寄せる。枠が無ければ false。
  function apply() {
    const frame = root.SigK.annotateTrim?.takeFrame() ?? null;
    if (frame === null)
      return false;
    const result = root.SigK.trimCommit.apply(frame.index, frame.box, state.scope);
    if (result.count > 0)
      viewer().goToPage(frame.index);
    if (state.scope === 'all')
      announce(result);
    refresh();
    return true;
  }

  // ［トリミングを外す］（確定事項19）: 紙全体を読み終えるのを待ってから、今のページ（すべてなら元のページ全部）を戻す。戻したら true。
  async function remove() {
    if (state.removing || viewer()?.getState().open !== true)
      return false;
    const { file, current } = viewer().getState();
    state.removing = true;
    refresh();
    try {
      await root.SigK.pageBoxes.load(file);
    } finally {
      state.removing = false;
    }
    // 待っている間にタブを替えた・開き直したら当てない。
    const done = viewer().getState().file === file && root.SigK.trimCommit.remove(current, state.scope) > 0;
    refresh();
    return done;
  }

  // 今の文書の紙全体をまだ読んでいなければ裏で読み、読み終えたら右パネルを描き直す（確定事項10。道具を持った・保存して開き直した・
  // タブを替えたとき。右パネルが描くたびに呼ぶ）。
  function ensureBoxes() {
    const file = viewer()?.getState().file ?? null;
    if (typeof file?.path === 'string' && root.SigK.pageBoxes?.statusOf(file) === 'none')
      root.SigK.pageBoxes.load(file).then(refresh);
  }

  // 道具を持った（annotate-tools.js）。当てるページを［このページ］へ戻し、選択を外し、紙全体を裏で読む（確定事項10・17）。
  function onPicked() {
    state.scope = 'page';
    root.SigK.annotate?.select(null);
    ensureBoxes();
  }

  function setScope(scope) {
    state.scope = scope === 'all' ? 'all' : 'page';
    refresh();
    return state.scope;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.trimTool = { apply, remove, onPicked, ensureBoxes, setScope, labelOf, getScope: () => state.scope, isRemoving: () => state.removing };
})(typeof window !== 'undefined' ? window : globalThis);
