(function (root) {
  'use strict';

  // 選んだ多角形の枠とつまみ（spec-4b-5a 確定事項22。見本 screenshots/phase4b-5a-shapes.png）。DOM に触れない純粋層。
  //
  // 枠と回転のつまみは四角と同じ（shape-handles.js の turnedFrameOf。回した箱の破線、上の辺の外の丸いつまみ）。つまみは頂点ごとの
  // 白い丸（種類 vertex、id は v0・v1…）で、8 つのつまみは出さない（CheckListMaker と同じ）。位置は表示の座標。

  function handlesOf(entry, viewport, room = null) {
    const turned = root.SigK.shapeHandles.turnedFrameOf(entry, viewport, room);
    const vertices = root.SigK.polygonGeometry.worldVertices(entry).map((point) => viewport.convertToViewportPoint(point[0], point[1]));
    const handles = vertices.map((at, index) => ({ id: `v${index}`, kind: 'vertex', at, cursor: 'move' }));
    handles.push(turned.rotate);
    return { frame: turned.frame, stem: turned.stem, handles };
  }

  // つまみの id（v0・v1…）から頂点の番号。違えば null。
  function vertexIndexOf(id) {
    const match = /^v(\d+)$/.exec(id ?? '');
    return match === null ? null : Number(match[1]);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.polygonHandles = { handlesOf, vertexIndexOf };
})(typeof window !== 'undefined' ? window : globalThis);
