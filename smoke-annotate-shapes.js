'use strict';

// 起動確認の図形の追加（×印・多角形・塗った三角の矢印・線の始点合わせ）の操作と結果の欄（spec-4b-5a の起動確認）。
// smoke-annotate.js が annotateScript に埋める。
//
// SHAPE_STATE は操作の前に置く変数、SHAPE_STEPS は smoke-annotate-steps.js の分岐の続き（else if の並び）で、埋め込む先のスクリプトにある
// SigK・name・arg・wait・round・pageNode・viewportOf・screenPoint・mouse を使う。操作は次のもの。
//   polygon:0:100x700;200x700;180x600:close  多角形の道具で頂点を順に押して離し、close なら始点を押して閉じ、open ならダブルクリックで
//                                            開いたまま確定する（draft なら確定せず、描いている途中のまま。画面写真用）
//   snap:0:400x380-500x450                   直線・矢印の道具を持ったまま、(400,380) をダブルクリックして始点合わせを始め、(500,450) で
//                                            押して離す（snap-draft なら始めて動かすだけ。画面写真用）
//   reshape                                  いまのタブを閉じて開き直し、図形（×印・多角形・直線・矢印・四角）を控える（往復）
//   compare-shapes:2                         1 ページ目を、pdf.js が外観ごと描いた絵と、外観を描かずに SigK の印刷の描き手で図形を重ねた絵とで、
//                                            倍率 2 で比べる（差が 32 を超える画素の割合。完了判定7）
// SHAPE_REPORT は結果の shapes の欄を組む文。文字列の中には ` と ${ を書かない（テンプレートの中に埋めるため）。

const SHAPE_STATE = `
  const shapeRounds = [];
  let shapeCompare = null;
  const SHAPE_KINDS = ['cross', 'polygon', 'arrow', 'line', 'square'];
  const shapeOf = (entry) => (entry.readonly === true ? { kind: 'other', subtype: entry.subtype, readonly: true } : {
    kind: entry.kind, src: entry.src, rect: entry.rect.map(round), angle: entry.angle ?? 0, closed: entry.closed ?? null, head: entry.head ?? null,
    color: entry.color, fill: entry.fill ?? null, lineWidth: entry.lineWidth, lineStyle: entry.lineStyle ?? 'solid', opacity: entry.opacity,
    paths: entry.paths ? entry.paths.map((path) => path.map((point) => point.map(round))) : null,
  });
  const ownShapes = () => [...SigK.viewer.getAnnotations().added, ...Object.values(SigK.viewer.getImported()).flat()]
    .filter((entry) => SHAPE_KINDS.includes(entry.kind) || (entry.readonly === true && ['Polygon', 'PolyLine', 'Ink'].includes(entry.subtype))).map(shapeOf);
  const pressAt = (index, x, y) => {
    mouse('mousedown', pageNode(index), x, y);
    mouse('mouseup', pageNode(index), x, y);
  };
  const doubleAt = (index, x, y) => {
    pressAt(index, x, y);
    pressAt(index, x, y);
    pageNode(index).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  };
`;

const SHAPE_STEPS = `
    else if (name === 'polygon') {
      const [page, points, how] = arg.split(':');
      const index = Number(page);
      const screen = points.split(';').map((point) => point.split('x').map(Number)).map(([x, y]) => screenPoint(index, x, y));
      SigK.annotate.setTool('shape');
      SigK.annotate.setShapeKind('polygon');
      for (const [x, y] of screen) {
        pressAt(index, x, y);
        mouse('mousemove', pageNode(index), x + 12, y + 18);
        await wait(40);
      }
      if (how === 'close')
        pressAt(index, screen[0][0], screen[0][1]);
      else if (how === 'open')
        doubleAt(index, screen.at(-1)[0], screen.at(-1)[1]);
    } else if (name === 'snap' || name === 'snap-draft') {
      const [page, span] = arg.split(':');
      const index = Number(page);
      const [from, to] = span.split('-').map((point) => point.split('x').map(Number));
      const [sx, sy] = screenPoint(index, from[0], from[1]);
      const [ex, ey] = screenPoint(index, to[0], to[1]);
      doubleAt(index, sx, sy);
      await wait(60);
      mouse('mousemove', pageNode(index), ex, ey);
      if (name === 'snap')
        pressAt(index, ex, ey);
    } else if (name === 'reshape') {
      const file = SigK.tabs.list().find((tab) => tab.active)?.path ?? null;
      const tab = SigK.tabs.list().find((item) => item.active);
      await SigK.tabs.forceCloseTab(tab.id);
      await wait(300);
      await SigK.tabs.openPath(file);
      await wait(700);
      await SigK.annotationImport.settled();
      await wait(300);
      SigK.shell.setMode(document, 'annot');
      await wait(200);
      shapeRounds.push(ownShapes());
    } else if (name === 'compare-shapes') {
      const scale = Number(arg) || 2;
      const file = SigK.tabs.list().find((tab) => tab.active)?.path ?? null;
      const read = await window.pdfAPI.read(file);
      const task = SigK.pdfjs.getDocument({ data: read.bytes });
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale });
      const canvasOf = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        return canvas;
      };
      const modes = SigK.pdfjs.lib.AnnotationMode;
      const byPdfjs = canvasOf();
      await page.render({ canvasContext: byPdfjs.getContext('2d'), viewport, annotationMode: modes.ENABLE }).promise;
      const bySigk = canvasOf();
      await page.render({ canvasContext: bySigk.getContext('2d'), viewport, annotationMode: modes.DISABLE }).promise;
      const entries = Object.values(SigK.viewer.getImported()).flat().filter((entry) => SHAPE_KINDS.includes(entry.kind) && entry.readonly !== true && entry.src === 0);
      SigK.annotationLayer.paint(bySigk.getContext('2d'), entries, viewport);
      const width = byPdfjs.width;
      const a = byPdfjs.getContext('2d').getImageData(0, 0, width, byPdfjs.height).data;
      const b = bySigk.getContext('2d').getImageData(0, 0, width, byPdfjs.height).data;
      const count = (box) => {
        let ink = 0;
        let over = 0;
        for (let y = Math.max(0, box[1]); y < Math.min(byPdfjs.height, box[3]); y += 1) {
          for (let x = Math.max(0, box[0]); x < Math.min(width, box[2]); x += 1) {
            const at = (y * width + x) * 4;
            if (Math.min(a[at], a[at + 1], a[at + 2], b[at], b[at + 1], b[at + 2]) >= 240)
              continue;
            ink += 1;
            if (Math.max(Math.abs(a[at] - b[at]), Math.abs(a[at + 1] - b[at + 1]), Math.abs(a[at + 2] - b[at + 2])) > 32)
              over += 1;
          }
        }
        return { ink, over, ratio: ink === 0 ? 0 : Math.round((over / ink) * 10000) / 10000 };
      };
      // 回した箱の 4 隅に、線幅の半分と 3px を足した範囲。
      const boxOf = (entry) => {
        const quad = entry.quads[0];
        const view = [[quad[0], quad[1]], [quad[2], quad[3]], [quad[4], quad[5]], [quad[6], quad[7]]].map((point) => viewport.convertToViewportPoint(point[0], point[1]));
        const pad = (entry.lineWidth * scale) / 2 + 3;
        const xs = view.map((point) => point[0]);
        const ys = view.map((point) => point[1]);
        return [Math.floor(Math.min(...xs) - pad), Math.floor(Math.min(...ys) - pad), Math.ceil(Math.max(...xs) + pad), Math.ceil(Math.max(...ys) + pad)];
      };
      shapeCompare = { scale, page: count([0, 0, width, byPdfjs.height]), shapes: entries.map((entry) => ({ kind: entry.kind, angle: entry.angle ?? 0, ...count(boxOf(entry)) })) };
      await task.destroy();
    }
`;

const SHAPE_REPORT = `
  const shapeReport = {
    shapes: ownShapes(),
    rounds: shapeRounds,
    roundsSame: shapeRounds.every((round) => JSON.stringify(round) === JSON.stringify(shapeRounds[0])),
    compare: shapeCompare,
    drawing: SigK.annotatePolygon.isDrawing(),
    anchored: SigK.annotateLineAnchor.isActive(),
    marks: document.querySelectorAll('.annot-draft-marks').length,
    hint: document.getElementById('props-hint').textContent,
  };
`;

module.exports = { SHAPE_STATE, SHAPE_STEPS, SHAPE_REPORT };
