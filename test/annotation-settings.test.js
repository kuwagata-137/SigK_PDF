'use strict';

// 注釈の設定の既定と検証（annotation-settings.js）。settings.js から移した（spec-4b-1a 確定事項36）。
// settings.js を通した振る舞い（mergeDefaults・pickUi・mergeUi）は test/settings.test.js が見ており、
// ここは関数そのものと、settings.js が同じ既定を使っていることを見る。spec-4b-1b 確定事項14・15・22〜28。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ANNOT_PALETTE_VERSION, ANNOT_DEFAULTS, LEGACY_COLOR_MAP, ANNOT_LINE_WIDTH_MIN, ANNOT_LINE_WIDTH_MAX, ANNOT_OPACITY_MIN,
  ANNOT_LINE_STYLES, ANNOT_AUTHOR_MAX, pickAnnotAuthor, pickAnnotSettings, mergeAnnotUi,
} = require('../annotation-settings.js');
const settings = require('../settings.js');

const KEYS = ['annotColors', 'annotFills', 'annotStrokeNone', 'annotLineStyles', 'annotFontSize', 'annotTextStyle', 'annotCalloutStyle', 'annotLineWidth', 'annotShapeKind',
  'annotOpacity', 'annotAuthor', 'annotPaletteVersion'];
const UI_KEYS = KEYS.filter((key) => key !== 'annotPaletteVersion');

test('settings.js の既定は、注釈のキーを annotation-settings.js の既定のまま同じ位置に持つ', () => {
  for (const key of KEYS)
    assert.deepEqual(settings.DEFAULTS[key], ANNOT_DEFAULTS[key]);
  // settings.json に書くキーの並び（画面の見た目の後ろ、recent の前）。
  assert.deepEqual(Object.keys(settings.DEFAULTS), ['version', 'window', 'sidePanel', 'mode', 'pageLayout', 'editSide', ...KEYS, 'recent']);
  // 既定を複製して持つので、settings.js 側を書き換えても annotation-settings.js の既定は変わらない。
  assert.notEqual(settings.DEFAULTS.annotColors, ANNOT_DEFAULTS.annotColors);
  // 範囲と線種は settings.js からも同じものが引ける（プリセットとの一致の見張りが使う）。
  assert.equal(settings.ANNOT_LINE_WIDTH_MIN, ANNOT_LINE_WIDTH_MIN);
  assert.equal(settings.ANNOT_LINE_WIDTH_MAX, ANNOT_LINE_WIDTH_MAX);
  assert.equal(settings.ANNOT_OPACITY_MIN, ANNOT_OPACITY_MIN);
  assert.equal(settings.ANNOT_LINE_STYLES, ANNOT_LINE_STYLES);
});

test('既定の色はパレットの色で、塗りは無し・線あり・実線、移し替えの印は 1', () => {
  assert.deepEqual(ANNOT_DEFAULTS.annotColors, {
    highlight: '#ffd966', underline: '#c00000', strikeout: '#c00000', text: '#222a35', callout: '#222a35', shape: '#c00000', pen: '#c00000', note: '#ffd966',
  });
  assert.deepEqual(ANNOT_DEFAULTS.annotFills, { shape: null });
  assert.deepEqual(ANNOT_DEFAULTS.annotStrokeNone, { shape: false });
  assert.deepEqual(ANNOT_DEFAULTS.annotLineStyles, { shape: 'solid' });
  assert.equal(ANNOT_DEFAULTS.annotLineWidth, 2);
  assert.equal(ANNOT_DEFAULTS.annotPaletteVersion, ANNOT_PALETTE_VERSION);
  assert.equal(ANNOT_PALETTE_VERSION, 1);
  assert.deepEqual(ANNOT_LINE_STYLES, ['solid', 'dashed', 'cloudy']);
});

test('pickAnnotSettings は注釈のキーだけを検証して取り出し、ほかのキーは持ち込まない', () => {
  assert.deepEqual(pickAnnotSettings({}), ANNOT_DEFAULTS);
  assert.deepEqual(pickAnnotSettings(null), ANNOT_DEFAULTS);
  const picked = pickAnnotSettings({
    mode: 'annot',
    annotColors: { highlight: '#A9CE91', underline: 'red', text: '#123456' },
    annotFills: { shape: '#FFD966' },
    annotStrokeNone: { shape: true },
    annotLineStyles: { shape: 'cloudy' },
    annotFontSize: 13.3,
    annotLineWidth: 17,
    annotShapeKind: 'arrow',
    annotOpacity: { shape: 0.35, note: 0.05, pen: 0.333 },
    annotAuthor: '  総務 ',
    annotPaletteVersion: 1,
  });
  assert.deepEqual(Object.keys(picked), KEYS);
  assert.equal(picked.annotColors.highlight, '#a9ce91', '#rrggbb は小文字にして受け取る');
  assert.equal(picked.annotColors.text, '#123456', 'パレットに無い色も受け取る');
  assert.equal(picked.annotColors.underline, ANNOT_DEFAULTS.annotColors.underline, '色でなければ既定へ落ちる');
  assert.deepEqual(picked.annotFills, { shape: '#ffd966' });
  assert.deepEqual(picked.annotStrokeNone, { shape: true });
  assert.deepEqual(picked.annotLineStyles, { shape: 'cloudy' });
  assert.equal(picked.annotFontSize, 12, '0.5 刻みでない大きさは既定へ落ちる');
  assert.equal(picked.annotLineWidth, 17);
  assert.equal(picked.annotShapeKind, 'arrow');
  assert.deepEqual(picked.annotOpacity, { text: 1, callout: 1, shape: 0.35, pen: 0.33, note: 1 }, '0.1 未満は既定、小数は 2 桁');
  assert.equal(picked.annotAuthor, '総務');
  assert.equal(picked.annotPaletteVersion, 1);
});

test('線の太さは 1〜40 の整数、線種は実線・破線・雲形、塗りは色か null だけを受け取る', () => {
  for (const width of [1, 40])
    assert.equal(pickAnnotSettings({ annotLineWidth: width }).annotLineWidth, width);
  for (const width of [0, 41, 2.5, '5'])
    assert.equal(pickAnnotSettings({ annotLineWidth: width }).annotLineWidth, 2, String(width));
  assert.deepEqual(pickAnnotSettings({ annotLineStyles: { shape: 'dotted' } }).annotLineStyles, { shape: 'solid' });
  assert.deepEqual(pickAnnotSettings({ annotLineStyles: 'dashed' }).annotLineStyles, { shape: 'solid' });
  assert.deepEqual(pickAnnotSettings({ annotFills: { shape: null } }).annotFills, { shape: null });
  assert.deepEqual(pickAnnotSettings({ annotFills: { shape: 'yellow' } }).annotFills, { shape: null });
});

// 線と塗りを両方なしにはできない（確定事項4・24）。
test('塗りが無ければ線なしは false にする', () => {
  assert.deepEqual(pickAnnotSettings({ annotStrokeNone: { shape: true } }).annotStrokeNone, { shape: false });
  assert.deepEqual(pickAnnotSettings({ annotFills: { shape: null }, annotStrokeNone: { shape: true } }).annotStrokeNone, { shape: false });
  assert.deepEqual(pickAnnotSettings({ annotFills: { shape: '#ffffff' }, annotStrokeNone: { shape: true } }).annotStrokeNone, { shape: true });
  assert.deepEqual(pickAnnotSettings({ annotFills: { shape: '#ffffff' }, annotStrokeNone: { shape: 'yes' } }).annotStrokeNone, { shape: false });
});

// 今までの候補の色とちょうど同じ値だけを、いちばん近いパレットの色へ 1 回だけ移す（確定事項15）。
test('移し替えの印が無い設定は、今までの候補の色をパレットの色へ移し、印を付ける', () => {
  const old = {
    annotColors: { highlight: '#ffe45a', underline: '#D92C2C', strikeout: '#2c5cd9', text: '#1c2430', shape: '#2f9e5a', pen: '#123456', note: '#ffa8c8' },
  };
  const picked = pickAnnotSettings(old);
  assert.deepEqual(picked.annotColors, {
    highlight: '#ffd966', underline: '#c00000', strikeout: '#4472c4', text: '#222a35', callout: '#222a35', shape: '#00b050', pen: '#123456', note: '#ffa8c8',
  });
  assert.equal(picked.annotPaletteVersion, 1);
  assert.deepEqual(pickAnnotSettings({ annotColors: { highlight: '#8ce99a', note: '#8fbfff' } }).annotColors.highlight, '#a9ce91');
  assert.deepEqual(pickAnnotSettings({ annotColors: { highlight: '#8ce99a', note: '#8fbfff' } }).annotColors.note, '#8faadc');
  // 印の付いた設定では、今までの候補と同じ値でも移さない（自分で選び直した色）。
  const current = pickAnnotSettings({ ...old, annotPaletteVersion: 1 });
  assert.equal(current.annotColors.underline, '#d92c2c');
  assert.equal(current.annotColors.highlight, '#ffe45a');
});

test('置き換えの対応は今までの候補の 7 色で、行き先はどれもパレットの色', () => {
  require('../renderer/annotation-palette.js');
  const palette = globalThis.SigK.annotationPalette;
  assert.deepEqual(Object.keys(LEGACY_COLOR_MAP), ['#d92c2c', '#1c2430', '#ffe45a', '#2c5cd9', '#2f9e5a', '#8ce99a', '#8fbfff']);
  for (const [from, to] of Object.entries(LEGACY_COLOR_MAP)) {
    assert.equal(palette.isPaletteColor(to), true, `${from} → ${to}`);
    assert.equal(palette.isPaletteColor(from), false, from);
  }
  assert.equal(LEGACY_COLOR_MAP['#ffa8c8'], undefined, '桃は近い色が無いのでそのまま');
  assert.ok(Object.isFrozen(LEGACY_COLOR_MAP));
});

test('mergeAnnotUi は色・塗り・線なし・線種・不透明度を種類ごとに重ね、送られなかったキーは今の値のままにする', () => {
  const current = { ...ANNOT_DEFAULTS, annotColors: { ...ANNOT_DEFAULTS.annotColors, pen: '#4472c4' }, annotFills: { shape: '#ffd966' }, annotLineWidth: 3, annotAuthor: '総務' };
  const merged = mergeAnnotUi(current, { annotColors: { shape: '#00b050' }, annotOpacity: { note: 0.25 }, annotStrokeNone: { shape: true }, annotLineStyles: { shape: 'dashed' } });
  assert.deepEqual(Object.keys(merged), UI_KEYS, '移し替えの印は返さない');
  assert.equal(merged.annotColors.shape, '#00b050');
  assert.equal(merged.annotColors.pen, '#4472c4');
  assert.deepEqual(merged.annotFills, { shape: '#ffd966' });
  assert.deepEqual(merged.annotStrokeNone, { shape: true });
  assert.deepEqual(merged.annotLineStyles, { shape: 'dashed' });
  assert.deepEqual(merged.annotOpacity, { text: 1, callout: 1, shape: 1, pen: 1, note: 0.25 });
  assert.equal(merged.annotLineWidth, 3);
  assert.equal(merged.annotAuthor, '総務');
  // 受け取れない値は今の値のまま。塗りを無くせば線なしも外れる。
  const invalid = mergeAnnotUi(current, { annotColors: { pen: 'blue' }, annotLineWidth: 50, annotOpacity: { shape: 2 } });
  assert.equal(invalid.annotColors.pen, '#4472c4');
  assert.equal(invalid.annotLineWidth, 3);
  assert.equal(invalid.annotOpacity.shape, 1);
  const noFill = mergeAnnotUi({ ...current, annotStrokeNone: { shape: true } }, { annotFills: { shape: null } });
  assert.deepEqual(noFill.annotFills, { shape: null });
  assert.deepEqual(noFill.annotStrokeNone, { shape: false });
  // 古い settings.json から来た current（注釈のキーが無い）でも既定へ落ちる。
  const { annotPaletteVersion, ...uiDefaults } = ANNOT_DEFAULTS;
  assert.equal(annotPaletteVersion, 1);
  assert.deepEqual(mergeAnnotUi({}, {}), uiDefaults);
});

test('pickAnnotAuthor は文字列の前後の空白を落として上限で切り、文字列でなければ fallback', () => {
  assert.equal(pickAnnotAuthor('  山田 ', ''), '山田');
  assert.equal(pickAnnotAuthor('a'.repeat(ANNOT_AUTHOR_MAX + 5), ''), 'a'.repeat(ANNOT_AUTHOR_MAX));
  assert.equal(pickAnnotAuthor(7, '経理'), '経理');
  assert.equal(pickAnnotAuthor(undefined, 3), '');
});
