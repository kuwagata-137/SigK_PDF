(function (root) {
  'use strict';

  // 透かしの設定の検査と、ワーカーへ渡す spec の組み立て（spec-4-5 確定事項3〜6・25・40）。
  // DOM に触れない純関数。状態は tools-watermark.js が持つ。
  //
  // 色・不透明度のプリセットと既定値は論点6（覚えない。既定は「社外秘」・灰・30%・斜め・中央・中）。
  // 色と並びは自前で決めたもので、他社製品の意匠を写していない（docs/06）。文字の整え方と上限は
  // ワーカー（worker/op-watermark.js の normalizeText・MAX_TEXT_LENGTH）と同じで、一致はテストで見張る。

  const COLORS = Object.freeze(['#808080', '#d92c2c', '#2c5cd9', '#1c2430']);
  const COLOR_NAMES = Object.freeze({ '#808080': '灰', '#d92c2c': '赤', '#2c5cd9': '青', '#1c2430': '黒' });
  const OPACITIES = Object.freeze([0.15, 0.3, 0.5, 1]);
  const MAX_TEXT_LENGTH = 50;
  const DEFAULTS = Object.freeze({
    type: 'text', text: '社外秘', color: '#808080', opacity: 0.3, angle: 45, size: 'medium', position: 'center', pageMode: 'all', range: '',
  });
  const POSITION_LABELS = Object.freeze({
    'top-left': '左上', top: '上', 'top-right': '右上',
    left: '左', center: '中央', right: '右',
    'bottom-left': '左下', bottom: '下', 'bottom-right': '右下',
  });
  // 帯の文言「<label>しています」の頭（save.js の runTask）。
  const LABEL = '透かしを追加';

  function normalizeText(text) {
    return typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
  }

  // 元と同じフォルダーの <元の名前>_透かし.pdf（確定事項40。結合の既定名と同じ作り方）。
  function defaultTarget(sourcePath) {
    if (typeof sourcePath !== 'string' || sourcePath === '')
      return undefined;
    return `${sourcePath.replace(/\.pdf$/i, '')}_透かし.pdf`;
  }

  // 透かしを入れるページ（0 始まり）。「入れる集合」なので重複は畳み、昇順に並べ直す（確定事項4・25）。
  function targetPages({ pageMode, range }, pageCount) {
    const parsed = root.SigK.pageRange.parsePageRange(pageMode === 'range' ? range : '', pageCount);
    if (parsed.error !== undefined)
      return { error: parsed.error };
    return { pages: [...new Set(parsed.pages)].sort((a, b) => a - b) };
  }

  function sourceProblem(source) {
    if (source === null || source === undefined)
      return '透かしを入れる PDF を決めてください。';
    if (source.pending)
      return '対象の PDF を読んでいます…';
    if (source.blocked !== null || source.pageCount === null)
      return '対象の PDF を選び直してください。';
    return null;
  }

  // 透かしそのもの（文字か画像）。戻り値は { mark } か { error }。
  function markOf(settings, image) {
    const common = { opacity: settings.opacity, angle: settings.angle, size: settings.size, position: settings.position };
    if (settings.type === 'image') {
      if (image === null || image === undefined)
        return { error: '透かしにする画像を選んでください。' };
      if (image.pending)
        return { error: '画像を読んでいます…' };
      if (image.error !== null && image.error !== undefined)
        return { error: image.error };
      return { mark: { type: 'image', image: image.path, ...common } };
    }
    const text = normalizeText(settings.text);
    if (text === '')
      return { error: '透かしの文字を入れてください。' };
    if (text.length > MAX_TEXT_LENGTH)
      return { error: `透かしの文字は ${MAX_TEXT_LENGTH} 文字までです。` };
    return { mark: { type: 'text', text, color: settings.color, ...common } };
  }

  // いまの対象・画像・設定から計画を組む。戻り値は
  //   { ready: true, error: null, pages, spec（target を除く）, summary } か
  //   { ready: false, error, errorKind? }（errorKind: 'range' は範囲の欄の下に出す）
  function planOf({ source, image, settings }) {
    const problem = sourceProblem(source);
    if (problem !== null)
      return { ready: false, error: problem };
    const marked = markOf(settings, image);
    if (marked.error !== undefined)
      return { ready: false, error: marked.error };
    const resolved = targetPages(settings, source.pageCount);
    if (resolved.error !== undefined)
      return { ready: false, error: resolved.error, errorKind: 'range' };
    const kindName = marked.mark.type === 'text' ? '文字' : '画像';
    return {
      ready: true,
      error: null,
      pages: resolved.pages,
      spec: { kind: 'watermark', label: LABEL, source: source.path, pages: resolved.pages, mark: marked.mark },
      summary: `${resolved.pages.length} ページに${kindName}の透かしを入れます`,
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.watermarkPlan = {
    COLORS, COLOR_NAMES, OPACITIES, MAX_TEXT_LENGTH, DEFAULTS, POSITION_LABELS, LABEL,
    normalizeText, defaultTarget, targetPages, planOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
