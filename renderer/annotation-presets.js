(function (root) {
  'use strict';

  // 注釈のプリセット（spec-4-1 確定事項33、spec-4-2 確定事項34・35、spec-4-3 確定事項27〜30、spec-4-4 確定事項36〜38、
  // spec-4b-1b 確定事項14・19・20）。DOM に触れない。
  //
  // 既定の色・文字の大きさ・線の太さと不透明度の範囲・図形の種類は annotation-settings.js と同じであること（プロセスが違うので
  // import はできない。test/settings.test.js が一致を見張る）。色はパレット（annotation-palette.js）から選び、既定の色は
  // パレットの色（決定47 ⑧）。文字の大きさの並びは自前で決めたもので、他社製品の意匠を写していない（docs/06）。

  const MARKUP_TOOLS = Object.freeze(['highlight', 'underline', 'strikeout']);
  // 吹き出し（callout）はテキストの書き込み（kind: 'text' に callout の欄）を置く道具（spec-4b-4b 確定事項A2・F1）。
  // マーカー（marker）は乗算のペン（kind: 'ink' に blend: 'multiply'）を描く道具（spec-4b-5b 確定事項1・2）。
  const TOOLS = Object.freeze([...MARKUP_TOOLS, 'text', 'callout', 'shape', 'pen', 'marker', 'note']);
  // 道具と、注釈の種類（kind）の表示名。図形の道具（shape）は 4 種の kind を描き分ける。
  const TOOL_LABELS = Object.freeze({
    highlight: 'ハイライト', underline: '下線', strikeout: '取り消し線', text: 'テキスト', callout: '吹き出し', shape: '図形', pen: 'ペン', marker: 'マーカー', note: 'ノート',
    square: '四角', circle: '丸', line: '直線', arrow: '矢印', cross: '×印', polygon: '多角形', ink: 'ペン',
  });
  // 「表示のみ」の注釈（他のツールが付け、読み込んで直せないもの）の種類名。pdf.js の subtype で引く
  // （spec-4-4 確定事項36）。無ければ subtype をそのまま見せる。
  const READONLY_LABELS = Object.freeze({
    Text: 'ノート', FreeText: 'テキスト', Line: '直線', Square: '四角', Circle: '丸', Polygon: '多角形', PolyLine: '折れ線',
    Highlight: 'ハイライト', Underline: '下線', Squiggly: '波線', StrikeOut: '取り消し線', Stamp: 'スタンプ', Caret: '挿入記号',
    Ink: 'ペン', FileAttachment: '添付ファイル', Sound: '音声', Redact: '墨消し',
  });

  // 「図形」の道具で描ける種類（spec-4-3 確定事項27。×印・多角形は spec-4b-5a 確定事項27）。
  const SHAPE_KINDS = Object.freeze(['square', 'circle', 'line', 'arrow', 'cross', 'polygon']);
  const DEFAULT_SHAPE_KIND = 'square';

  // 道具ごとの既定の色。今までの既定の色を、いちばん近いパレットの色へ置き換えた（spec-4b-1b 確定事項14）。色は右パネルの
  // チップからパレット（annotation-palette.js）か「その他の色…」で選び、#rrggbb なら何でも受ける。
  const DEFAULT_COLORS = Object.freeze({
    highlight: '#ffd966', underline: '#c00000', strikeout: '#c00000', text: '#222a35', callout: '#222a35', shape: '#c00000', pen: '#c00000', marker: '#ffff00',
    note: '#ffd966',
  });
  // 吹き出しの道具の、次に付ける書式の既定（決定57 ⑪。文字の色は DEFAULT_COLORS.callout）。枠線の太さ 1.5 は、右パネルの太さの行（1〜40 の
  // 整数）では選べない既定の値として受ける（spec-4b-4b 確定事項F2・F3）。
  const DEFAULT_CALLOUT_STYLE = Object.freeze({ fontSize: 12, bold: false, italic: false, fill: '#ffffff', border: '#c00000', borderWidth: 1.5 });
  // 図形の道具の、次に付ける塗り・線なし・線種の既定（spec-4b-1b 確定事項23〜25）。塗りなし・線あり・実線。
  const DEFAULT_FILLS = Object.freeze({ shape: null });
  const DEFAULT_STROKE_NONE = Object.freeze({ shape: false });
  const DEFAULT_LINE_STYLES = Object.freeze({ shape: 'solid' });

  // テキストの文字の大きさ（pt）。8〜200 の 0.5 刻み（spec-4b-4a 確定事項A3）。FONT_SIZES は右パネルの「よく使う大きさ」の一覧。
  const FONT_SIZE_MIN = 8;
  const FONT_SIZE_MAX = 200;
  const FONT_SIZE_STEP = 0.5;
  const FONT_SIZES = Object.freeze([8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72, 96, 144, 200]);
  const DEFAULT_FONT_SIZE = 12;

  // 図形・ペンの線の太さ（pt）。画面から選べるのは 1〜40 の整数（spec-4b-1b 確定事項19。右パネルのスライダーと数値欄）。
  const LINE_WIDTH_MIN = 1;
  const LINE_WIDTH_MAX = 40;
  const DEFAULT_LINE_WIDTH = 2;
  // マーカーの太さはマーカーだけ別に覚える（spec-4b-5b 確定事項3）。
  const DEFAULT_MARKER_WIDTH = 12;

  // 不透明度（spec-4-4 確定事項38、spec-4b-1b 確定事項20）。対象はテキスト・図形・ペン・ノートで、道具ごとに最後の値を覚える。
  // 画面から選べるのは 0.1〜1（右パネルでは 10〜100%）。ハイライトは multiply で既に文字が透けるので対象にしない。
  const OPACITY_MIN = 0.1;
  const DEFAULT_OPACITY = 1;
  const OPACITY_TOOLS = Object.freeze(['text', 'callout', 'shape', 'pen', 'marker', 'note']);
  const DEFAULT_OPACITIES = Object.freeze(Object.fromEntries(OPACITY_TOOLS.map((tool) => [tool, DEFAULT_OPACITY])));

  // 道具ごとの値（色・不透明度）を引く鍵。図形 4 種は 'shape' を共有し、ペン（ink）は 'pen'（spec-4-3 確定事項28）。
  function paletteOf(kind) {
    if (SHAPE_KINDS.includes(kind))
      return 'shape';
    return kind === 'ink' ? 'pen' : kind;
  }

  // 書き込みの種類の鍵（道具ごとの値・名前・アイコンを引く）。吹き出しのテキストは callout、ほかは kind（spec-4b-4b 確定事項A5）。
  function kindOf(entry) {
    if (entry === null || entry === undefined)
      return null;
    // 乗算のペンはマーカー（spec-4b-5b 確定事項2）。
    if (entry.kind === 'ink' && entry.blend === 'multiply')
      return 'marker';
    return entry.kind === 'text' && entry.callout !== undefined ? 'callout' : entry.kind;
  }

  // 画面から選べる大きさか（8〜200 の 0.5 刻み）。読み込んだ大きさはここを通さない。
  function isFontSize(size) {
    return Number.isFinite(size) && size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX && Number.isInteger(size / FONT_SIZE_STEP);
  }

  // 打たれた数を、近い 0.5 刻みに丸めて 8〜200 に収める。数でなければ null（spec-4b-4a 確定事項G2）。
  function fontSizeOf(value) {
    if (!Number.isFinite(value))
      return null;
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value / FONT_SIZE_STEP) * FONT_SIZE_STEP));
  }

  // 画面から選べる線の太さか（1〜40 の整数）。読み込んだ小数の太さはここを通さない。
  function isLineWidth(width) {
    return Number.isInteger(width) && width >= LINE_WIDTH_MIN && width <= LINE_WIDTH_MAX;
  }

  function isShapeKind(kind) {
    return SHAPE_KINDS.includes(kind);
  }

  // 画面から選べる不透明度か（0.1〜1）。
  function isOpacity(value) {
    return Number.isFinite(value) && value >= OPACITY_MIN && value <= 1;
  }

  // 不透明度を持てる種類か（引き出しが OPACITY_TOOLS のどれかになるもの）。
  function isOpacityKind(kind) {
    return OPACITY_TOOLS.includes(paletteOf(kind));
  }

  function readonlyLabelOf(subtype) {
    if (typeof subtype !== 'string' || subtype === '')
      return '書き込み';
    return READONLY_LABELS[subtype] ?? subtype;
  }

  root.SigK = root.SigK || {};
  root.SigK.annotationPresets = {
    TOOLS,
    MARKUP_TOOLS,
    TOOL_LABELS,
    READONLY_LABELS,
    SHAPE_KINDS,
    DEFAULT_SHAPE_KIND,
    DEFAULT_COLORS,
    DEFAULT_CALLOUT_STYLE,
    DEFAULT_FILLS,
    DEFAULT_STROKE_NONE,
    DEFAULT_LINE_STYLES,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
    FONT_SIZE_STEP,
    FONT_SIZES,
    DEFAULT_FONT_SIZE,
    LINE_WIDTH_MIN,
    LINE_WIDTH_MAX,
    DEFAULT_LINE_WIDTH,
    DEFAULT_MARKER_WIDTH,
    OPACITY_MIN,
    DEFAULT_OPACITY,
    OPACITY_TOOLS,
    DEFAULT_OPACITIES,
    paletteOf,
    kindOf,
    isFontSize,
    fontSizeOf,
    isLineWidth,
    isShapeKind,
    isOpacity,
    isOpacityKind,
    readonlyLabelOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
