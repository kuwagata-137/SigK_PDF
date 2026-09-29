(function (root) {
  'use strict';

  // 注釈の辞書の読み戻しを、読み込んだ注釈に当てる層（spec-4b-1a 確定事項25〜27）。
  //
  // needsDetails・refsOf・applyDetails・readonlyOf は純関数。requestDetails は annotationAPI.readDetails
  // （ワーカーが辞書を直に読む口）を 1 本ずつ順番に呼ぶ。答えの欄は worker/annotation-dict-reader.js の detailsOf。
  // 当てるのは不透明度（/CA）と、四角・丸の塗り（/IC）・雲形（/BE の強さ）・/RD（spec-4b-1b 確定事項36〜38）。破線と線なしは
  // pdf.js の値で imported-shape.js が読む。描けないもの（雲形の破線・崩れた /RD）と、線も塗りも無いものは表示のみにする。

  // 口が要る種類。pdf.js が不透明度（/CA）を返さないもの（事前調査 A）。ハイライト・下線・取り消し線・ペンは
  // pdf.js が返すので要らない。
  const DETAIL_KINDS = Object.freeze(['square', 'circle', 'line', 'arrow', 'text', 'note']);
  // 口を呼ぶ上限（確定事項25）。100MB を超えるファイルは、開くたびにワーカーが同じ大きさを読み直すのを避ける。
  const SIZE_MAX = 100 * 1024 * 1024;
  const REFS_MAX = 10000;
  // 表示のみにするときの種類名（pdf.js の subtype）。一覧とヒントの呼び名はこれで引く。
  const SUBTYPE_OF = Object.freeze({ square: 'Square', circle: 'Circle', line: 'PolyLine', arrow: 'PolyLine', ink: 'Ink', text: 'FreeText', note: 'Text' });

  // 次の呼び出しは前の呼び出しが終わるまで待つ（確定事項25）。
  let queue = Promise.resolve();
  // 起動確認が見る、最後の呼び出しの様子。
  let last = null;

  function api() {
    return root.annotationAPI;
  }

  function needsDetails(entry) {
    return entry?.readonly !== true && DETAIL_KINDS.includes(entry?.kind) && typeof entry.ref === 'string';
  }

  // 口に頼む参照の並び（imported はページ番号 → entry の並び）。
  function refsOf(imported) {
    const refs = [];
    for (const entries of Object.values(imported ?? {})) {
      for (const entry of entries) {
        if (needsDetails(entry))
          refs.push(entry.ref);
      }
    }
    return refs;
  }

  // 表示のみの entry（imported-entry.js の表示のみと同じ形）。pdf.js が描き続け、一覧に出て消せる。
  function readonlyOf(entry) {
    return {
      ref: entry.ref,
      src: entry.src,
      kind: 'other',
      subtype: SUBTYPE_OF[entry.kind] ?? 'Square',
      color: entry.color,
      opacity: 1,
      quads: entry.quads,
      rect: entry.rect,
      text: typeof entry.text === 'string' ? entry.text : '',
      author: typeof entry.author === 'string' ? entry.author : '',
      readonly: true,
    };
  }

  function hasNonZero(values) {
    return Array.isArray(values) && values.some((value) => value !== 0);
  }

  // /RD（規格の順で 左・上・右・下）の形。どれも 0 以上で、左右の和が幅より、上下の和が高さより小さい（確定事項38）。
  function validDifference(difference, [x1, y1, x2, y2]) {
    return Array.isArray(difference) && difference.length === 4 && difference.every((value) => Number.isFinite(value) && value >= 0)
      && difference[0] + difference[2] < x2 - x1 && difference[1] + difference[3] < y2 - y1;
  }

  function insideOf([x1, y1, x2, y2], [left, top, right, bottom]) {
    return [x1 + left, y1 + bottom, x2 - right, y2 - top].map((value) => Math.round(value * 100) / 100);
  }

  // 四角・丸の塗り・雲形・/RD（確定事項36・38）。描けないもの（雲形の破線・崩れた /RD）は null。雲形の箱は /Rect のまま
  // （他のアプリの外観も /Rect の中に描かれる）で、弧は SigK PDF の描き方で描き直す（決定47 ⑯）。
  function withBoxDetails(entry, detail) {
    const next = { ...entry };
    const fill = root.SigK.importedValues.hexOfComponents(detail.interior);
    if (fill !== null)
      next.fill = fill;
    const difference = detail.rectDifference;
    if (difference !== null && difference !== undefined && !validDifference(difference, entry.rect))
      return null;
    if (detail.cloudy === true && Number.isFinite(detail.cloudIntensity) && detail.cloudIntensity > 0) {
      if (entry.lineStyle === 'dashed')
        return null;
      next.lineStyle = 'cloudy';
      next.cloudIntensity = Math.min(2, detail.cloudIntensity);
      return next;
    }
    if (hasNonZero(difference)) {
      next.rect = insideOf(entry.rect, difference);
      next.quads = [root.SigK.freeTextGeometry.quadOfRect(next.rect)];
    }
    return next;
  }

  function withDetails(entry, detail) {
    const next = entry.kind === 'square' || entry.kind === 'circle' ? withBoxDetails(entry, detail) : entry;
    if (next === null || !Number.isFinite(detail.ca))
      return next;
    // 不透明度 0（見えない）は直す形にしない。pdf.js が描くまま（見えないまま）にする。
    return detail.ca <= 0 ? null : { ...next, opacity: Math.min(1, detail.ca) };
  }

  // 答えを 1 件に当てる（spec-4b-1a 確定事項26、spec-4b-1b 確定事項36〜38）。答えが無ければ pdf.js の値のまま（①-a 確定事項27）。
  // どちらでも、線も塗りも無いもの（線の見えない四角・丸で塗りが分からないもの）は表示のみにする。
  function applyDetails(entry, detail) {
    if (entry.readonly === true)
      return entry;
    const next = detail === undefined || detail === null ? entry : withDetails(entry, detail);
    if (next === null || (next.color === null && (next.fill ?? null) === null))
      return readonlyOf(entry);
    return next;
  }

  // 口を呼べない理由。呼べるなら null。
  function unavailableReason(file, refs) {
    if (api()?.available !== true)
      return 'unavailable';
    if (typeof file?.path !== 'string' || !Number.isFinite(file.size) || !Number.isFinite(file.mtimeMs))
      return 'no-file';
    if (file.size > SIZE_MAX)
      return 'too-large';
    if (refs.length === 0)
      return 'none';
    return refs.length > REFS_MAX ? 'too-many' : null;
  }

  // 口を 1 本ずつ順番に呼ぶ。答えは { ok: true, details } か { ok: false, reason }（called は口を呼んだか）。
  function requestDetails(file, refs) {
    const reason = unavailableReason(file, refs);
    if (reason !== null) {
      last = { called: false, refs: refs.length, answered: 0, ms: 0, reason };
      return Promise.resolve({ ok: false, reason, called: false });
    }
    const spec = { source: file.path, expect: { size: file.size, mtimeMs: file.mtimeMs }, refs };
    const run = queue.then(async () => {
      const started = Date.now();
      let answer;
      try {
        answer = await api().readDetails(spec);
      } catch {
        answer = { ok: false, reason: 'unreadable' };
      }
      const result = answer?.ok === true
        ? { ok: true, details: answer.details ?? {}, called: true }
        : { ok: false, reason: answer?.reason ?? 'unreadable', called: true };
      last = { called: true, refs: refs.length, answered: result.ok ? Object.keys(result.details).length : 0, ms: Date.now() - started, reason: result.ok ? null : result.reason };
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationDetails = {
    DETAIL_KINDS,
    SIZE_MAX,
    REFS_MAX,
    needsDetails,
    refsOf,
    readonlyOf,
    applyDetails,
    requestDetails,
    lastRequest: () => (last === null ? null : { ...last }),
  };
})(typeof window !== 'undefined' ? window : globalThis);
