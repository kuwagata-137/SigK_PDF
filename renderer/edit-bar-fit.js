(function (root) {
  'use strict';

  // 道具の段に入りきらない道具を決める純粋層（spec-4b-5b 確定事項25。決定61 ④）。DOM に触れない。
  //
  // 段の子（道具と区切り線）の幅を左から並べ、段の幅に入りきるなら全部見せる。入りきらなければ、右端に「その他」を置いて入るだけ
  // 左から見せ、残りを右から隠す。見せる子の末尾に残る区切り線も隠す（区切り線のすぐ右に「その他」が来ないように）。
  //
  //   children  … [{ width, sep }]。width は左右の余白を含む幅（px）、sep は区切り線か
  //   available … 段の幅（内側の余白を含む clientWidth）
  //   gap       … 子と子の間（CSS の gap）
  //   padding   … 段の左右の内側の余白 [左, 右]
  //   moreWidth … 「その他」の幅（左右の余白を含む）
  // 戻り値は { count: 左から見せる子の数, more: 「その他」を出すか }。

  // 小数の幅の丸めのぶん（px）。
  const EPSILON = 0.5;

  function spanOf(children, count, gap) {
    let width = 0;
    for (let index = 0; index < count; index += 1)
      width += children[index].width + (index > 0 ? gap : 0);
    return width;
  }

  // 末尾の区切り線を落とした数。
  function withoutTrailingSeps(children, count) {
    let shown = count;
    while (shown > 0 && children[shown - 1].sep === true)
      shown -= 1;
    return shown;
  }

  function fitOf({ children, available, gap = 0, padding = [0, 0], moreWidth = 0 }) {
    const inner = available - padding[0] - padding[1];
    if (spanOf(children, children.length, gap) <= inner + EPSILON)
      return { count: children.length, more: false };
    for (let count = children.length - 1; count > 0; count -= 1) {
      const shown = withoutTrailingSeps(children, count);
      if (shown > 0 && spanOf(children, shown, gap) + gap + moreWidth <= inner + EPSILON)
        return { count: shown, more: true };
    }
    return { count: 0, more: true };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.editBarFit = { EPSILON, fitOf };
})(typeof window !== 'undefined' ? window : globalThis);
