(function (root) {
  'use strict';

  // 注釈の辞書の読み戻しを、読み込んだ注釈に当てる層（spec-4b-1a 確定事項25〜27）。
  //
  // needsDetails・refsOf・applyDetails・readonlyOf は純関数。requestDetails は annotationAPI.readDetails
  // （ワーカーが辞書を直に読む口）を 1 本ずつ順番に呼ぶ。答えの欄は worker/annotation-dict-reader.js の detailsOf。
  // 当てるのは不透明度（/CA）と、四角・丸の塗り（/IC）・雲形（/BE の強さ）・/RD（spec-4b-1b 確定事項36〜38）、自前のテキストの
  // /DS（spec-4b-4a 確定事項J。imported-text-details.js）。破線と線なしは pdf.js の値で imported-shape.js が読む。描けないもの
  // （雲形の破線・崩れた /RD）と、線も塗りも無いものは表示のみにする。

  // 口が要る種類。pdf.js が不透明度（/CA）を返さないもの（事前調査 A）。ハイライト・下線・取り消し線・ペンは
  // pdf.js が返すので要らない。
  // 多角形は塗り・不透明度・回転を口で読む（spec-4b-5a 確定事項40）。
  const DETAIL_KINDS = Object.freeze(['square', 'circle', 'line', 'arrow', 'polygon', 'text', 'note']);
  // 口を呼ぶ上限（確定事項25）。100MB を超えるファイルは、開くたびにワーカーが同じ大きさを読み直すのを避ける。
  const SIZE_MAX = 100 * 1024 * 1024;
  const REFS_MAX = 10000;
  // 表示のみにするときの種類名（pdf.js の subtype）。一覧とヒントの呼び名はこれで引く。
  const SUBTYPE_OF = Object.freeze({ square: 'Square', circle: 'Circle', line: 'PolyLine', arrow: 'PolyLine', cross: 'Ink', ink: 'Ink', text: 'FreeText', note: 'Text' });

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
      subtype: entry.kind === 'polygon' ? (entry.closed === true ? 'Polygon' : 'PolyLine') : (SUBTYPE_OF[entry.kind] ?? 'Square'),
      color: entry.color,
      opacity: 1,
      quads: entry.quads,
      rect: entry.rect,
      text: typeof entry.text === 'string' ? entry.text : '',
      author: typeof entry.author === 'string' ? entry.author : '',
      readonly: true,
    };
  }

  // 塗った三角の矢印は、/IC が /C と同じ色のときだけ直せる（spec-4b-5a 確定事項38。違う色や塗りの無い三角を、線の色で塗った
  // 三角に描き直さないため）。
  function closedArrowReadable(entry, detail) {
    if (!root.SigK.arrowHead?.isClosed(entry))
      return true;
    const fill = root.SigK.importedValues.hexOfComponents(detail?.interior ?? null);
    return fill !== null && typeof entry.color === 'string' && fill.toLowerCase() === entry.color.toLowerCase();
  }

  function withDetails(entry, detail) {
    const next = entry.kind === 'square' || entry.kind === 'circle' ? root.SigK.annotationBoxDetails.withBoxDetails(entry, detail) : entry;
    if (next === null || !Number.isFinite(detail.ca))
      return next;
    // 不透明度 0（見えない）は直す形にしない。pdf.js が描くまま（見えないまま）にする。
    return detail.ca <= 0 ? null : { ...next, opacity: Math.min(1, detail.ca) };
  }

  // 種類ごとの組み直し。自前のテキストは新しい形、多角形は塗り・回転（答えが無ければ回っていないとして頂点を丸める）。
  function baseOf(entry, detail, answered, text) {
    if (entry.kind === 'text')
      return root.SigK.importedTextDetails.withTextDetails(entry, detail, { answered, ...text });
    if (entry.kind === 'polygon')
      return root.SigK.importedPolygon.withPolygonDetails(entry, detail ?? null);
    return entry;
  }

  // 答えを 1 件に当てる（spec-4b-1a 確定事項26、spec-4b-1b 確定事項36〜38）。その注釈の答えが無ければ pdf.js の値のまま
  // （①-a 確定事項27）。口がまるごと答えなかった（answered が false）ときの四角・丸は表示のみにする（回っているかと塗りが分からない
  // まま直すと、開いた時点で見た目が変わるため。spec-4b-2 確定事項36）。どちらでも、線も塗りも無いもの（線の見えない四角・丸で
  // 塗りが分からないもの）は表示のみにする。自前のテキストは imported-text-details.js が新しい形を組み、口の答えが無ければ
  // 表示のみにする（spec-4b-4a 確定事項J2〜J4）。text はその口に渡す字の送り幅と紙の長さ（{ advanceOf, pageLengthOf }）。
  function applyDetails(entry, detail, { answered = true, text = {} } = {}) {
    if (entry.readonly === true)
      return entry;
    if (!answered && (entry.kind === 'square' || entry.kind === 'circle' || entry.kind === 'polygon'))
      return readonlyOf(entry);
    if (!closedArrowReadable(entry, detail))
      return readonlyOf(entry);
    const base = baseOf(entry, detail, answered, text);
    if (base === null)
      return readonlyOf(entry);
    const next = detail === undefined || detail === null ? base : withDetails(base, detail);
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
