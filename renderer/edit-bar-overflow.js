(function (root) {
  'use strict';

  // 道具の段の幅を測り、入りきらない道具を隠して「その他」を出し入れする（spec-4b-5b 確定事項25）。
  //
  // どこから隠すかは edit-bar-fit.js、「その他」の一覧は edit-bar-more.js が持つ。段の大きさが変わるたび（窓の大きさ・編集モードに
  // 入って段が出たとき）に ResizeObserver で測り直す（無ければ窓の resize）。段が出ていないとき（幅 0）は何も隠さない。隠した子には
  // OVERFLOW の印（CSS で display:none）を付ける。

  const OVERFLOW = 'edit-overflow';

  let el = null;

  function fitter() {
    return root.SigK.editBarFit;
  }

  function more() {
    return root.SigK.editBarMore;
  }

  // 段の子のうち、道具と区切り線（「その他」と一覧は除く）。
  function childrenOf(bar) {
    return [...bar.children].filter((node) => node.classList.contains('edit-sep') || (node.classList.contains('edit-item') && !node.classList.contains('edit-more')));
  }

  function px(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : 0;
  }

  // 左右の余白を含む幅。
  function outerWidth(node) {
    const style = el.win.getComputedStyle(node);
    return node.getBoundingClientRect().width + px(style.marginLeft) + px(style.marginRight);
  }

  // 全部を見せた状態で幅を測る。段が出ていなければ null。
  function measure() {
    const { bar, item } = el;
    const children = childrenOf(bar);
    children.forEach((node) => node.classList.remove(OVERFLOW));
    item.hidden = false;
    const available = bar.clientWidth;
    if (!(available > 0))
      return null;
    const style = el.win.getComputedStyle(bar);
    return {
      children: children.map((node) => ({ width: outerWidth(node), sep: node.classList.contains('edit-sep') })),
      available,
      gap: px(style.columnGap),
      padding: [px(style.paddingLeft), px(style.paddingRight)],
      moreWidth: outerWidth(item),
    };
  }

  // 測り直して隠す。measured はテストが渡す測った値（無ければ DOM から測る）。「その他」を出したら true。
  function fit(measured = undefined) {
    if (el === null)
      return false;
    const input = measured === undefined ? measure() : measured;
    const children = childrenOf(el.bar);
    const result = input === null ? { count: children.length, more: false } : fitter().fitOf(input);
    children.forEach((node, index) => node.classList.toggle(OVERFLOW, index >= result.count));
    el.item.hidden = !result.more;
    // 大きさが変われば開いている一覧は閉じ、「その他」の押している印を揃える。
    more()?.close();
    more()?.syncPressed();
    return result.more;
  }

  // 隠している道具のボタン（段の並び）。
  function hiddenButtons() {
    if (el === null)
      return [];
    return [...el.bar.querySelectorAll(`.${OVERFLOW} .edit-tool[data-tool]`)];
  }

  function init(doc, win) {
    if (win.__sigkEditBarOverflowReady === true)
      return false;
    const bar = doc.getElementById('edit-bar');
    const item = bar?.querySelector('.edit-more') ?? null;
    if (item === null)
      return false;
    win.__sigkEditBarOverflowReady = true;
    el = { doc, win, bar, item };
    if (typeof win.ResizeObserver === 'function')
      new win.ResizeObserver(() => fit()).observe(bar);
    else
      win.addEventListener('resize', () => fit());
    // 書体を読み終えると名前の幅が変わる。
    doc.fonts?.ready?.then(() => fit());
    fit();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.editBarOverflow = { OVERFLOW, init, fit, hiddenButtons };
})(typeof window !== 'undefined' ? window : globalThis);
