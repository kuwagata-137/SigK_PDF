(function (root) {
  'use strict';

  // フラット化で焼き込む書き込みの選び方（spec-2-5 確定事項E5。決定80 ㉞）。DOM に触れない。
  //
  // ワーカーの数え（flatten-preview）はページごと・まとまりごとの件数（pages）を返す。ここはチェックした種類と選んだページの分を
  // 足し合わせる（チェックや範囲を変えるたびにファイルを読み直さない）。まとまりは worker/flatten-selection.js の GROUPS と同じ。

  // 並び・名前・アイコン。吹き出しは FreeText なので「テキスト・吹き出し」（spec-4-5 確定事項8 の改訂）。
  const GROUPS = Object.freeze([
    { key: 'markup', label: 'ハイライト・下線・取り消し線', icon: 'highlight' },
    { key: 'text', label: 'テキスト・吹き出し', icon: 'text' },
    { key: 'shape', label: '図形・ペン', icon: 'shape' },
    { key: 'note', label: 'ノート', icon: 'note' },
    { key: 'other', label: 'スタンプなど', icon: 'modeAnnot' },
  ]);
  const KEYS = Object.freeze(GROUPS.map((group) => group.key));
  const KEEP = Object.freeze(['functional', 'noAppearance', 'hidden']);

  // 焼き込むページ（0 始まり）。［すべて］なら pages は null。範囲の誤りは { error }。範囲の欄が空なら全部（pageRange と同じ）。
  function pagesOf({ mode, range }, pageCount) {
    if (mode !== 'range')
      return { pages: null };
    const parsed = root.SigK.pageRange.parsePageRange(String(range ?? ''), pageCount);
    return parsed.error !== undefined ? { error: parsed.error } : { pages: parsed.pages };
  }

  const zeros = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));

  // result は flatten-preview の戻り値、kinds はチェックした種類の集まり、pages は選んだページ（null は全部）。
  //   present … ファイルのどこかに 1 件でもあるまとまり（行に出す）
  //   counts  … まとまりごとの、選んだページの中の件数
  //   baked・notes・keep … チェックした種類・選んだページの分（焼く件数・焼くノート・焼き込まずに残すもの）
  //   unchosen … ファイルにある焼ける書き込みのうち、選び方で焼かない件数（書き込みのまま残す）
  function tally(result, { kinds, pages }) {
    const perPage = Array.isArray(result?.pages) ? result.pages : [result];
    const chosenPages = pages === null ? null : new Set(pages);
    const counts = zeros(KEYS);
    const keep = zeros(KEEP);
    const whole = zeros(KEYS);
    perPage.forEach((page, index) => {
      const inRange = chosenPages === null || chosenPages.has(index);
      for (const key of KEYS) {
        whole[key] += page?.bake?.[key] ?? 0;
        if (inRange)
          counts[key] += page?.bake?.[key] ?? 0;
      }
      if (inRange)
        KEEP.forEach((reason) => { keep[reason] += page?.keep?.[reason] ?? 0; });
    });
    const baked = KEYS.filter((key) => kinds.has(key)).reduce((sum, key) => sum + counts[key], 0);
    const total = KEYS.reduce((sum, key) => sum + whole[key], 0);
    return {
      present: KEYS.filter((key) => whole[key] > 0),
      counts, baked, keep, total,
      notes: kinds.has('note') ? counts.note : 0,
      unchosen: total - baked,
    };
  }

  // 選び方の控え（チェックした種類・［すべて］［範囲］・範囲の欄の文字）。既定は全部チェック・［すべて］。
  // reset の kinds は戻す先の種類（覚えた種類。spec-6-1 確定事項E-7）。知らない種類は捨てる。
  function createChoices() {
    const state = { kinds: new Set(KEYS), mode: 'all', range: '' };
    return {
      state,
      reset(kinds = KEYS) {
        state.kinds = new Set(KEYS.filter((key) => kinds.includes(key)));
        state.mode = 'all';
        state.range = '';
      },
      setKind(key, on) {
        if (!KEYS.includes(key))
          return false;
        if (on)
          state.kinds.add(key);
        else
          state.kinds.delete(key);
        return true;
      },
      setPageMode(mode) {
        if (mode !== 'all' && mode !== 'range')
          return false;
        state.mode = mode;
        return true;
      },
      setRange(text) {
        state.range = String(text ?? '');
        return true;
      },
      current: () => ({ kinds: [...state.kinds], mode: state.mode, range: state.range }),
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.flattenChoice = { GROUPS, KEYS, pagesOf, tally, createChoices };
})(typeof window !== 'undefined' ? window : globalThis);
