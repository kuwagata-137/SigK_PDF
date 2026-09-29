(function (root) {
  'use strict';

  // 雲形の幾何の純粋層（spec-4b-1b 確定事項33・41〜43。事前調査 H）。DOM にも pdf.js にも触れない。
  //
  // 紙の座標（pt・上が +y）で点列を作り、画面（shape-graphics.js の <path>）と印刷（canvas の path）が同じ点列を描く。
  // 保存の外観は worker/cloud-appearance.js が同じ式で作り、同じ入力で同じ点列になることをテストで見張る
  // （プロセスが違うので読み込み合わない。矢じりと同じ扱い）。
  //
  // 雲は箱の内側に収める。弧の中心は、箱を余白 m（弧の半径 r ＋ 描く線幅の半分）だけ内へ寄せた輪郭（四角は辺、丸は内接する
  // 楕円）に並べ、隣り合う円の外側の交点から交点までを外へふくらむ弧で結ぶ。弧の頭は前の弧の内側へ 22° 延ばしてから戻る
  // （しっぽ。決定47 ⑮）。弧の半径は 強さ × 4（丸は 4.75）＋ 描く線幅 / 2 で、中心どうしの間隔は 2r·cos 34° 以下。
  // この式は他のツール（PDFBox）の雲形と同じ慣習の値で、コードは写していない（docs/06）。

  const DEG = Math.PI / 180;
  const OVERLAP = 34 * DEG;
  const TAIL = 22 * DEG;
  const PIECE = 90 * DEG;
  // 弧の半径がこれより小さい箱では雲形をやめる（弧が細かくなりすぎる。事前調査 H）。
  const MIN_RADIUS = 1;
  const ELLIPSE_SAMPLES = 1440;

  function radiusOf(kind, intensity, width) {
    return (kind === 'circle' ? 4.75 : 4) * intensity + width / 2;
  }

  // 四角: 左下の角から反時計回り。角には必ず中心を置き、各辺を等しい間隔に割る。
  function rectCenters([x1, y1, x2, y2], step) {
    const corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    const centers = [];
    corners.forEach((from, index) => {
      const to = corners[(index + 1) % 4];
      const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
      for (let j = 0; j < n; j += 1)
        centers.push([from[0] + ((to[0] - from[0]) * j) / n, from[1] + ((to[1] - from[1]) * j) / n]);
    });
    return centers;
  }

  // 丸: 楕円の右端から反時計回りに、周の長さで等しく割る。数は偶数で 4 以上（上下左右に対称）。
  function ellipseCenters([x1, y1, x2, y2], step) {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const a = (x2 - x1) / 2;
    const b = (y2 - y1) / 2;
    const at = (t) => [cx + a * Math.cos(t), cy + b * Math.sin(t)];
    const lengths = [0];
    let previous = at(0);
    for (let i = 1; i <= ELLIPSE_SAMPLES; i += 1) {
      const next = at((2 * Math.PI * i) / ELLIPSE_SAMPLES);
      lengths.push(lengths[i - 1] + Math.hypot(next[0] - previous[0], next[1] - previous[1]));
      previous = next;
    }
    const total = lengths[ELLIPSE_SAMPLES];
    const n = Math.max(4, 2 * Math.ceil(total / (2 * step)));
    const centers = [];
    let k = 0;
    for (let j = 0; j < n; j += 1) {
      const s = (total * j) / n;
      while (k < ELLIPSE_SAMPLES - 1 && lengths[k + 1] < s)
        k += 1;
      const f = (s - lengths[k]) / (lengths[k + 1] - lengths[k] || 1);
      centers.push(at(((k + f) * 2 * Math.PI) / ELLIPSE_SAMPLES));
    }
    return centers;
  }

  // 隣と重なる点を除く（つぶれた辺で同じ角が並ぶとき）。
  function distinct(points) {
    return points.filter((point, index) => {
      const next = points[(index + 1) % points.length];
      return Math.hypot(next[0] - point[0], next[1] - point[1]) > 1e-6;
    });
  }

  // p → q の右（外）側で、半径 r の 2 円が交わる点。
  function crossing(p, q, r) {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const d = Math.hypot(dx, dy);
    const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
    return [(p[0] + q[0]) / 2 + (h * dy) / d, (p[1] + q[1]) / 2 - (h * dx) / d];
  }

  // 中心 c・半径 r の円の、角 from から to までの弧（向きは符号のまま）を 90° 以下に割ったベジェにして out へ足す。
  // 制御点は半径 × 4/3 × tan(角 / 4)。
  function arc(out, c, r, from, to) {
    const pieces = Math.max(1, Math.ceil(Math.abs(to - from) / PIECE - 1e-9));
    const delta = (to - from) / pieces;
    const k = (4 / 3) * Math.tan(delta / 4);
    for (let i = 0; i < pieces; i += 1) {
      const a0 = from + delta * i;
      const a1 = a0 + delta;
      const p0 = [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)];
      const p3 = [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)];
      out.push({ op: 'C', points: [
        [p0[0] - k * r * Math.sin(a0), p0[1] + k * r * Math.cos(a0)],
        [p3[0] + k * r * Math.sin(a1), p3[1] - k * r * Math.cos(a1)],
        p3,
      ] });
    }
  }

  // 中心の並びから、しっぽ付きの弧の並び（{ op: 'M' | 'C' | 'Z', points }）を作る。
  function curlsOf(centers, r) {
    const n = centers.length;
    const segments = [];
    for (let i = 0; i < n; i += 1) {
      const c = centers[i];
      const before = crossing(centers[(i - 1 + n) % n], c, r);
      const after = crossing(c, centers[(i + 1) % n], r);
      const start = Math.atan2(before[1] - c[1], before[0] - c[0]);
      let end = Math.atan2(after[1] - c[1], after[0] - c[0]);
      while (end <= start)
        end += 2 * Math.PI;
      if (i === 0)
        segments.push({ op: 'M', points: [before] });
      arc(segments, c, r, start, start - TAIL);
      arc(segments, c, r, start - TAIL, end);
    }
    segments.push({ op: 'Z', points: [] });
    return segments;
  }

  // 雲形の点列。戻り値は { segments, radius, margin, drawWidth }。弧が小さくなりすぎる箱は null（普通の四角・丸で描く）。
  // 描く線幅は短い辺の半分で頭打ちにし（四角・丸と同じ。確定事項30）、弧の半径は (短い辺 − 描く線幅) / 4 を超えない
  // （中心の輪郭がつぶれないように）。線なしでも lineWidth には書き込みの太さを渡す（線を戻しても雲の並びが変わらない）。
  function cloudOf({ kind, box, intensity, lineWidth }) {
    const [x1, y1, x2, y2] = box;
    const minSide = Math.min(x2 - x1, y2 - y1);
    const drawWidth = Math.min(lineWidth, minSide / 2);
    const radius = Math.min(radiusOf(kind, intensity, drawWidth), (minSide - drawWidth) / 4);
    if (!(radius >= MIN_RADIUS))
      return null;
    const margin = radius + drawWidth / 2;
    const inner = [x1 + margin, y1 + margin, x2 - margin, y2 - margin];
    const step = 2 * radius * Math.cos(OVERLAP);
    const centers = distinct(kind === 'circle' ? ellipseCenters(inner, step) : rectCenters(inner, step));
    return { segments: curlsOf(centers, radius), radius, margin, drawWidth };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.cloudGeometry = { OVERLAP, TAIL, MIN_RADIUS, radiusOf, cloudOf };
})(typeof window !== 'undefined' ? window : globalThis);
