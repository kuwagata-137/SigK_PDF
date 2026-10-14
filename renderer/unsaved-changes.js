(function (root) {
  'use strict';

  // 保存していない変更の数え方と、ツールを実行する前の確認の文（spec-2-5 確定事項F1・F4）。DOM に触れない。
  //
  // view は tabs.peek の中身（plan・savedPlan・annots・savedAnnots・imported）。ページは src（元のファイルのページ）か
  // insert（差し込んだページ）で見分け、保存したときの並び（savedPlan）と今の並び（plan）を比べる。

  // 文に出す順（F4）。
  const KINDS = Object.freeze([
    { key: 'reorder', label: 'ページの並べ替え' },
    { key: 'remove', label: 'ページの削除' },
    { key: 'rotate', label: 'ページの回転' },
    { key: 'insert', label: 'ページの差し込み' },
    { key: 'crop', label: '切り取り' },
    { key: 'mosaic', label: 'モザイク' },
    { key: 'annot', label: '書き込み' },
  ]);
  const FALLBACK = '保存していない変更';
  // 2 本以上のときに名前を並べる数（F4）。
  const LIST_LIMIT = 5;
  const TAIL = 'ツールはファイルに保存してある中身を使うので、このまま実行すると、その変更は結果に入りません。';

  const keyOf = (page) => (Number.isInteger(page?.insert) ? `i${page.insert}` : `s${page?.src}`);

  function byKey(plan) {
    const map = new Map();
    (plan ?? []).forEach((page, index) => {
      const key = keyOf(page);
      if (!map.has(key))
        map.set(key, { page, index });
    });
    return map;
  }

  // 最長増加部分列の長さ。動かさずに済むページの数（並べ替えの件数は、両方にあるページの数からこれを引く）。
  function longestRising(values) {
    const tails = [];
    for (const value of values) {
      let low = 0;
      let high = tails.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (tails[middle] < value)
          low = middle + 1;
        else
          high = middle;
      }
      tails[low] = value;
    }
    return tails.length;
  }

  const sameNumbers = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const sameCrop = (a, b) => (a === undefined || b === undefined ? a === b : sameNumbers(a, b));
  const mosaicKeys = (list) => (list ?? []).map((item) => `${item.block}|${item.box.join(',')}`);

  // モザイクの範囲の対称差（足した数＋消した数）。
  function mosaicDiff(a, b) {
    const left = mosaicKeys(a);
    const right = mosaicKeys(b);
    return left.filter((key) => !right.includes(key)).length + right.filter((key) => !left.includes(key)).length;
  }

  function countPlan(plan, savedPlan) {
    const now = byKey(plan);
    const saved = byKey(savedPlan);
    const counts = { reorder: 0, remove: 0, rotate: 0, insert: 0, crop: 0, mosaic: 0 };
    const kept = [];
    for (const [key, { page, index }] of now) {
      const before = saved.get(key);
      if (before === undefined) {
        if (Number.isInteger(page.insert))
          counts.insert += 1;
        continue;
      }
      kept.push({ index, savedIndex: before.index });
      if (page.rotate !== before.page.rotate)
        counts.rotate += 1;
      if (!sameCrop(page.crop, before.page.crop))
        counts.crop += 1;
      counts.mosaic += mosaicDiff(page.mosaic, before.page.mosaic);
    }
    counts.remove = [...saved.keys()].filter((key) => !now.has(key)).length;
    kept.sort((a, b) => a.index - b.index);
    counts.reorder = kept.length - longestRising(kept.map((item) => item.savedIndex));
    return counts;
  }

  function pageOfRef(imported, ref) {
    for (const [src, list] of Object.entries(imported ?? {})) {
      if ((list ?? []).some((entry) => entry.ref === ref))
        return src;
    }
    return '?';
  }

  // 書き込みは、ページごとに「新しく足した数」と「新しく消した数」の多い方を足す（読み込んだ書き込みを直すと、
  // 元を消して写しを足すので 1 件になる。同じページで元を消して別のものを足しても 1 件と数える〔既知の限界〕）。
  function countAnnots(view) {
    const sameEntry = root.SigK.annotationEntry?.sameEntry ?? ((a, b) => a === b);
    const savedAdded = view.savedAnnots?.added ?? [];
    const savedRemoved = new Set(view.savedAnnots?.removed ?? []);
    const pages = new Map();
    const bump = (page, field) => {
      const entry = pages.get(page) ?? { added: 0, removed: 0 };
      entry[field] += 1;
      pages.set(page, entry);
    };
    for (const entry of view.annots?.added ?? []) {
      const before = savedAdded.find((saved) => saved.id === entry.id);
      if (before === undefined || !sameEntry(before, entry))
        bump(String(entry.src), 'added');
    }
    for (const ref of view.annots?.removed ?? []) {
      if (!savedRemoved.has(ref))
        bump(pageOfRef(view.imported, ref), 'removed');
    }
    return [...pages.values()].reduce((sum, entry) => sum + Math.max(entry.added, entry.removed), 0);
  }

  // { reorder, remove, rotate, insert, crop, mosaic, annot }。中身が無ければ null。
  function count(view) {
    if (view === null || view === undefined || !Array.isArray(view.plan))
      return null;
    const savedPlan = view.savedPlan ?? root.SigK.pagePlan.createPlan(view.basePages?.length ?? 0);
    return { ...countPlan(view.plan, savedPlan), annot: countAnnots(view) };
  }

  // 「ページの削除 1 件・書き込み 3 件」。どれも 0 なら「保存していない変更」。
  function describe(counts) {
    const parts = KINDS.filter((kind) => (counts?.[kind.key] ?? 0) > 0).map((kind) => `${kind.label} ${counts[kind.key]} 件`);
    return parts.length === 0 ? FALLBACK : parts.join('・');
  }

  function itemOf({ name, counts }) {
    const text = describe(counts);
    return text === FALLBACK ? `「${name}」` : `「${name}」（${text}）`;
  }

  // 確認の窓の文。entries は [{ name, counts }]。{ lead, items, more } を返す（items は 2 本以上のときだけ並べる）。
  function messageFor(entries) {
    if (entries.length === 1) {
      const text = describe(entries[0].counts);
      const what = text === FALLBACK ? FALLBACK : `${FALLBACK}（${text}）`;
      return { lead: `「${entries[0].name}」には、${what}があります。${TAIL}`, items: [], more: 0 };
    }
    return {
      lead: `次の ${entries.length} 個のファイルには、${FALLBACK}があります。${TAIL}`,
      items: entries.slice(0, LIST_LIMIT).map(itemOf),
      more: Math.max(0, entries.length - LIST_LIMIT),
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.unsavedChanges = { KINDS, LIST_LIMIT, count, describe, messageFor };
})(typeof window !== 'undefined' ? window : globalThis);
