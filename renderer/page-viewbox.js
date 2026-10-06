(function (root) {
  'use strict';

  // 描く範囲（箱）を差し替えた viewport を作る口（spec-4b-6a 確定事項5・6。事前調査 B）。
  //
  // pdf.js の page.getViewport() は、ファイルの見える範囲（page.view。CropBox と MediaBox の重なり）しか描かない。PageViewport は export
  // されていないが、getViewport の戻り値の constructor に { viewBox, userUnit, scale, rotation } を渡せば、別の箱の viewport を作れる。
  // canvas の絵・pdf.js が描く注釈の外観・文字の層（TextLayer）・座標の往復は、どれもこの viewport の transform と viewBox に従うので、
  // ファイルに CropBox を書いたときと同じ見え方になる（画素と span の位置まで一致した）。pdf.js は CropBox で絵を切らないので、
  // 紙全体（MediaBox）を描くのにも使える。
  //
  // 表示（page-render.js）・サムネイル（thumbnails.js）・印刷（page-image.js）は、どれもここを通して plan の crop を渡す。

  function pageCrop() {
    return root.SigK.pageCrop;
  }

  // box が無いか、ファイルの見える範囲と同じなら、pdf.js の getViewport をそのまま使う。rotation を渡さなければページ自身の /Rotate。
  function viewportFor(page, { scale, rotation, box = null } = {}) {
    const base = rotation === undefined ? page.getViewport({ scale }) : page.getViewport({ scale, rotation });
    const target = pageCrop().normalizeBox(box);
    if (target === null || pageCrop().sameBox(target, pageCrop().normalizeBox(page.view)))
      return base;
    const Viewport = base?.constructor;
    // 素のオブジェクト（作れない viewport）なら、元の範囲のまま描く。
    if (typeof Viewport !== 'function' || Viewport === Object)
      return base;
    return new Viewport({ viewBox: target, userUnit: base.userUnit ?? 1, scale, rotation: base.rotation });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageViewbox = { viewportFor };
})(typeof window !== 'undefined' ? window : globalThis);
