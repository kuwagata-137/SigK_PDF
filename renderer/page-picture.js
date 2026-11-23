(function (root) {
  'use strict';

  // 前の絵を表示し続けるための構成要素（docs/07 決定99 ②）。ページの表示域（page-render.js）とサムネイル（thumbnails.js）が共有する。
  //
  // 回転・削除・並べ替え・挿入・トリミングなどで並びを変えると、ページ枠とサムネイル枠を作り直す。前は、pdf.js が新しい絵を描き終えるまで
  // 枠の白い背景が見えていた。今は、変更前の絵を同じページの新しい枠に置き、新しい絵を描き終えたら入れ替える。ここに置くのは次の 4 つである。
  //
  //   変換         … 絵を描いた時の viewport から、今の枠の viewport への CSS の transform（回転・トリミングで向きと範囲が変わったページ）
  //   絵を置く要素 … 前の絵（canvas と書き込みの層）を入れて枠に置く div.pdf-held（shell.css）
  //   控え         … 枠に置いていない前の絵。並びから外れたページの絵などを、次の 1 回の並びの変更まで残す（画素数の合計に上限を付ける）
  //   優先順位     … 持ち越した絵と控えのうち、どの絵を枠に置くか（choose）
  //
  // 絵の記録は { canvas, page, source, plan, pixels, box? } の形で持つ。page は描いた pdf.js のページ、source は { doc, number }（どの文書の
  // 何ページ目か。pagePlan.sourceOf と同じ形）、plan は描いた時の並びの要素の写し（回転・トリミング・モザイクを見る）。

  // ---- 変換 ----

  // 2 次元の変換（pdf.js の viewport.transform と同じ [a, b, c, d, e, f]）。multiply(m, n) は、n を適用した後に m を適用する変換。
  function multiply(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }

  function invert(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  }

  // 絵を描いた時の viewport（from）の CSS px を、今の枠の viewport（to）の CSS px へ移す変換。from と to は同じ倍率で作る。
  // viewport.transform は紙の座標から CSS px への変換なので、移す変換は to.transform × from.transform⁻¹ になる。
  function transformBetween(from, to) {
    return multiply(to.transform, invert(from.transform)).map((value) => Math.round(value * 10000) / 10000 || 0);
  }

  // ---- 絵を置く要素 ----

  // 前の絵を入れて枠に置く要素（div.pdf-held）を作る。書き込みの層（svg）は、描いた時の大きさの座標のまま、viewBox で要素いっぱいに伸ばす。
  function wrap(doc, canvas, layer = null) {
    const box = doc.createElement('div');
    box.className = 'pdf-held';
    if (layer !== null && !layer.hasAttribute('viewBox')) {
      layer.setAttribute('viewBox', `0 0 ${layer.getAttribute('width')} ${layer.getAttribute('height')}`);
      layer.setAttribute('width', '100%');
      layer.setAttribute('height', '100%');
      layer.setAttribute('preserveAspectRatio', 'none');
    }
    box.append(...[canvas, layer].filter((part) => part !== null && part !== undefined));
    return box;
  }

  // 絵を置く要素を枠に合わせる。要素を from の大きさにして、from から to への変換を適用する。frame（枠の幅と高さ。CSS px）を渡すと、to の大きさを
  // 枠の大きさに合わせる（枠の寸法は整数に丸めてあるので、合わせないと枠の右端と下端に 1px 未満の白い線が見えることがある）。
  // from と to が無ければ（向きと範囲が同じ絵・開き直した時）、枠いっぱいに伸ばす。
  function fit(box, from = null, to = null, frame = null) {
    if (from === null || to === null) {
      box.style.cssText = 'width:100%;height:100%';
      return;
    }
    const fitted = frame === null || !(to.width > 0) || !(to.height > 0)
      ? transformBetween(from, to)
      : multiply([frame.width / to.width, 0, 0, frame.height / to.height, 0, 0], transformBetween(from, to)).map((value) => Math.round(value * 10000) / 10000 || 0);
    box.style.cssText = `width:${from.width}px;height:${from.height}px;transform:matrix(${fitted.join(',')})`;
  }

  // ---- 絵の記録の比較 ----

  // 同じ文書の同じページを描いた絵か。
  function sameSource(a, b) {
    return a !== null && a !== undefined && b !== null && b !== undefined && a.doc === b.doc && a.number === b.number;
  }

  // 並びの要素の欄のうち、絵の見た目を決める欄（回転・トリミング・モザイク）が同じか。どのページかは比べない（sameSource で比べる）。
  function sameLook(a, b) {
    const look = (page) => {
      const copy = { src: 0, rotate: page?.rotate ?? 0 };
      if (Array.isArray(page?.crop))
        copy.crop = page.crop;
      if (Array.isArray(page?.mosaic))
        copy.mosaic = page.mosaic;
      return copy;
    };
    return root.SigK.pagePlan.samePlan([look(a)], [look(b)]);
  }

  function pixelsOf(canvas) {
    return Math.max(0, (canvas?.width ?? 0) * (canvas?.height ?? 0));
  }

  // canvas を複製する（サムネイルの絵を、ページの表示域の代わりの絵にする時）。2D コンテキストを作れなければ null。
  function copyCanvas(doc, canvas) {
    const copy = doc.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d');
    if (context === null || context === undefined)
      return null;
    context.drawImage?.(canvas, 0, 0);
    return copy;
  }

  // 絵の記録を、画素数が limit 以下の縮めた絵の記録にする（控えの上限を 1 枚で超える大きな絵。高い倍率の写真など）。縮めた絵はぼやけるが、
  // 枠の大きさに伸ばして表示するので、新しい絵を描き終えるまでの間は白い背景より見やすい。絵を置く要素に入っていれば、要素の中の絵を入れ替える。
  // 2D コンテキストを作れなければ null。
  function shrink(record, limit) {
    const canvas = record.canvas;
    const doc = canvas?.ownerDocument;
    if (doc === undefined || doc === null)
      return null;
    const ratio = Math.sqrt(limit / record.pixels);
    const copy = doc.createElement('canvas');
    copy.width = Math.max(1, Math.floor(canvas.width * ratio));
    copy.height = Math.max(1, Math.floor(canvas.height * ratio));
    const context = copy.getContext('2d');
    if (typeof context?.drawImage !== 'function')
      return null;
    context.drawImage(canvas, 0, 0, copy.width, copy.height);
    if (record.box !== undefined && canvas.parentNode === record.box)
      record.box.replaceChild(copy, canvas);
    return { ...record, canvas: copy, pixels: pixelsOf(copy) };
  }

  // ---- 控え ----

  // 控えを作る。追加した順番に絵の記録を持ち、画素数の合計が budget を超えたら、古い記録から破棄する。budget を 1 枚で超える絵は、
  // 画素数を budget の半分に縮めて持つ（縮められなければ持たない）。
  function createKeeper({ budget }) {
    let records = [];
    let total = 0;

    function add(record) {
      if (record === null || record === undefined || !(record.pixels >= 0))
        return false;
      const kept = record.pixels <= budget ? record : shrink(record, budget / 2);
      if (kept === null)
        return false;
      records.push(kept);
      total += kept.pixels;
      while (total > budget)
        total -= records.shift().pixels;
      return true;
    }

    // source のページの絵を探す。見た目（look は並びの要素）が同じ絵を優先し、無ければ最後に追加した絵を返す。無ければ null。
    function find(source, look) {
      const found = records.filter((record) => sameSource(record.source, source));
      return found.find((record) => sameLook(record.plan, look)) ?? found.at(-1) ?? null;
    }

    function remove(record) {
      const before = records.length;
      records = records.filter((item) => item !== record);
      if (records.length !== before)
        total -= record.pixels;
    }

    function clear() {
      records = [];
      total = 0;
    }

    // 次の世代に入れ替える。並びを変えるたびに、前の世代の控えを破棄して、今回の変更で枠に置かなかった絵を入れる（次の 1 回の変更まで残す）。
    function renew(next) {
      clear();
      for (const record of next)
        add(record);
    }

    return { add, find, remove, clear, renew, size: () => records.length, pixels: () => total };
  }

  // 並びを変えた後の枠に置く絵を選ぶ。carried は同じページの前の位置から持ち越した絵（無ければ null）、look は今の並びの要素。
  // 優先順位は、① 持ち越した絵（見た目が同じ）、② 控え（見た目が同じ。トリミングの取り消しで戻った時の切る前の絵など）、
  // ③ 持ち越した絵（変換して表示）、④ 控え（変換して表示）。① ② が無ければ、変換して表示する絵は余白を覆わないことがある。
  // 戻り値は { record（置く絵。無ければ null）, replaced（② を選んだので置かなかった持ち越した絵。控えに入れる。無ければ null） }。
  function choose({ carried = null, keeper, source, look }) {
    if (carried !== null && sameLook(carried.plan, look))
      return { record: carried, replaced: null };
    const kept = source === null || source === undefined ? null : keeper.find(source, look);
    if (kept !== null && (carried === null || sameLook(kept.plan, look))) {
      keeper.remove(kept);
      return { record: kept, replaced: carried };
    }
    return { record: carried, replaced: null };
  }

  // ---- タブごとの絵（決定100 ①） ----

  // 表示していないタブの絵（ページの表示域で見えていたページの絵と、サムネイルの絵）を、タブに戻った時に新しい絵を描き終えるまで表示する
  // ために残す。owner（タブの pdf.js の文書）ごとに 1 組を持ち、画素数の合計が budget を超えたら、古く残した組から破棄する。
  function createTabStore({ budget }) {
    let entries = [];
    let total = 0;

    // owner の組を取り出す（残さない）。無ければ null。
    function take(owner) {
      const found = entries.find((entry) => entry.owner === owner);
      if (found === undefined)
        return null;
      entries = entries.filter((entry) => entry !== found);
      total -= found.pixels;
      return found.pictures;
    }

    function put(owner, pictures, pixels) {
      take(owner);
      if (owner === null || owner === undefined || !(pixels > 0) || pixels > budget)
        return false;
      entries.push({ owner, pictures, pixels });
      total += pixels;
      while (total > budget)
        total -= entries.shift().pixels;
      return true;
    }

    function clear() {
      entries = [];
      total = 0;
    }

    return { put, take, remove: take, clear, stats: () => ({ tabs: entries.length, pixels: total }) };
  }

  // 表示していないタブの絵の画素数の上限（決定100 ①）。1,600 万画素（RGBA で約 64 MB。ページの表示域の控えと同じ）。
  const TAB_PIXELS = 16_000_000;

  const SigK = (root.SigK = root.SigK || {});
  SigK.pagePicture = { multiply, invert, transformBetween, wrap, fit, sameSource, sameLook, pixelsOf, copyCanvas, shrink, createKeeper, choose, createTabStore, TAB_PIXELS };
  SigK.tabPictures = createTabStore({ budget: TAB_PIXELS });
})(typeof window !== 'undefined' ? window : globalThis);
