(function (root) {
  'use strict';

  // ペン・マーカーの線を、消しゴムでなぞった跡で切る純粋層（spec-4b-5b 確定事項19・20）。DOM に触れない。
  //
  // なぞった跡は点の並び trail（紙の座標）で、跡に沿った両端の丸い太い線分（半径 reach のカプセル）の和が消える範囲になる。
  // reach は消しゴムの半径に線の太さの半分を足したもの（線の中心がここに入る所を切り取ると、丸い端の線がちょうど輪の縁で止まる）。
  // 線（paths の各折れ線）の線分ごとに、カプセルに入る範囲を線分の上の t（0〜1）の区間で求め、残りをつないで新しい折れ線にする。
  // 長さが MIN_PIECE に満たない切れ端は捨てる。切った点は小数 2 桁に丸める（描いた点と同じ）。

  // 捨てる切れ端の長さ（pt）。
  const MIN_PIECE = 0.5;
  // 区間の端を 0・1 とみなす幅。
  const T_EPSILON = 1e-9;

  function round(value) {
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1]];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1];
  }

  // 線分 a→b の上で、中心 c・半径 r の円に入る t の区間。入らなければ null。
  function diskInterval(a, b, c, r) {
    const d = sub(b, a);
    const f = sub(a, c);
    const qa = dot(d, d);
    const qc = dot(f, f) - r * r;
    if (qa === 0)
      return qc <= 0 ? [-Infinity, Infinity] : null;
    const qb = 2 * dot(f, d);
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0)
      return null;
    const s = Math.sqrt(disc);
    return [(-qb - s) / (2 * qa), (-qb + s) / (2 * qa)];
  }

  // lo ≤ p + q t ≤ hi を満たす t の区間（Liang–Barsky の 1 本ぶん）。
  function linearInterval(p, q, lo, hi) {
    if (q === 0)
      return p >= lo && p <= hi ? [-Infinity, Infinity] : null;
    const t1 = (lo - p) / q;
    const t2 = (hi - p) / q;
    return t1 < t2 ? [t1, t2] : [t2, t1];
  }

  // 線分 a→b の上で、c→d を軸とする幅 2r の帯（両端の円を除く長方形）に入る t の区間。
  function slabInterval(a, b, c, d, r) {
    const axis = sub(d, c);
    const length = Math.hypot(axis[0], axis[1]);
    if (length === 0)
      return null;
    const u = [axis[0] / length, axis[1] / length];
    const n = [-u[1], u[0]];
    const f = sub(a, c);
    const g = sub(b, a);
    const along = linearInterval(dot(f, u), dot(g, u), 0, length);
    const across = linearInterval(dot(f, n), dot(g, n), -r, r);
    if (along === null || across === null)
      return null;
    const lo = Math.max(along[0], across[0]);
    const hi = Math.min(along[1], across[1]);
    return lo <= hi ? [lo, hi] : null;
  }

  // 線分 a→b の上で、c→d のカプセル（半径 r）に入る t の区間（0〜1 に切る）。カプセルは凸なので、2 つの円と帯の区間の和は
  // 1 つながりになる。入らなければ null。
  function capsuleInterval(a, b, c, d, r) {
    const parts = [diskInterval(a, b, c, r), diskInterval(a, b, d, r), slabInterval(a, b, c, d, r)].filter((part) => part !== null);
    if (parts.length === 0)
      return null;
    const lo = Math.max(0, Math.min(...parts.map((part) => part[0])));
    const hi = Math.min(1, Math.max(...parts.map((part) => part[1])));
    return lo <= hi ? [lo, hi] : null;
  }

  // なぞった跡の線分（1 点なら同じ点の 2 つ）。
  function trailSegments(trail) {
    if (trail.length === 1)
      return [[trail[0], trail[0]]];
    const segments = [];
    for (let index = 1; index < trail.length; index += 1)
      segments.push([trail[index - 1], trail[index]]);
    return segments;
  }

  // 区間の並びを、重なりをまとめて左から並べる。
  function merged(intervals) {
    const sorted = [...intervals].sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [lo, hi] of sorted) {
      const last = out.at(-1);
      if (last !== undefined && lo <= last[1] + T_EPSILON)
        last[1] = Math.max(last[1], hi);
      else
        out.push([lo, hi]);
    }
    return out;
  }

  // 0〜1 のうち、removed に入らない区間。
  function keptOf(removed) {
    const kept = [];
    let from = 0;
    for (const [lo, hi] of removed) {
      if (lo > from + T_EPSILON)
        kept.push([from, lo]);
      from = Math.max(from, hi);
    }
    if (from < 1 - T_EPSILON)
      kept.push([from, 1]);
    return kept;
  }

  function pointAt(a, b, t) {
    if (t <= T_EPSILON)
      return a;
    if (t >= 1 - T_EPSILON)
      return b;
    return [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t)];
  }

  function lengthOf(path) {
    let length = 0;
    for (let index = 1; index < path.length; index += 1)
      length += Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1]);
    return length;
  }

  // 1 本の折れ線を切る。戻り値は { pieces, cut }（cut は切り取った所があったか）。
  function cutPath(path, segments, reach) {
    const pieces = [];
    let current = null;
    let cut = false;
    for (let index = 1; index < path.length; index += 1) {
      const [a, b] = [path[index - 1], path[index]];
      const removed = merged(segments.map(([c, d]) => capsuleInterval(a, b, c, d, reach)).filter((part) => part !== null && part[1] - part[0] > T_EPSILON));
      if (removed.length > 0)
        cut = true;
      const kept = keptOf(removed);
      // 線分の始まりが切り取られていれば、前の線分から続く折れ線はここで終わる。
      if (kept.length === 0 || kept[0][0] > T_EPSILON)
        current = null;
      for (const [t0, t1] of kept) {
        if (current === null) {
          current = [pointAt(a, b, t0)];
          pieces.push(current);
        }
        current.push(pointAt(a, b, t1));
        if (t1 < 1 - T_EPSILON)
          current = null;
      }
    }
    return { pieces: pieces.filter((piece) => piece.length >= 2 && lengthOf(piece) >= MIN_PIECE), cut };
  }

  // paths（[[[x, y], …], …]）を、なぞった跡 trail で切る。戻り値は { paths, changed }。切る所が無ければ paths はそのまま
  // （同じ配列）で changed は false。全部切れたら paths は空。
  function cutPaths(paths, trail, reach) {
    if (!Array.isArray(trail) || trail.length === 0 || !(reach > 0))
      return { paths, changed: false };
    const segments = trailSegments(trail);
    const next = [];
    let changed = false;
    for (const path of paths) {
      const { pieces, cut } = cutPath(path, segments, reach);
      if (!cut) {
        next.push(path);
        continue;
      }
      changed = true;
      next.push(...pieces);
    }
    return changed ? { paths: next, changed } : { paths, changed };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.inkCut = { MIN_PIECE, capsuleInterval, cutPaths };
})(typeof window !== 'undefined' ? window : globalThis);
