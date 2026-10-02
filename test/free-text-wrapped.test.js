'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ITALIC_SKEW, isWrapped, matchesText, isWrappedEntry, wrappedBlockOps, wrappedAppearanceOf,
} = require('../worker/free-text-wrapped.js');

// 新しい形（折り返す形）のテキストの外観（spec-4b-4a 確定事項I1・I2・I4・I5）。

// 字を 1 字 4 桁の hex にする口（字の番号をそのまま使う）。
function measureNamed(name) {
  return { name, encode: (line) => [...line].map((ch) => ch.codePointAt(0).toString(16).padStart(4, '0')).join(''), width: () => 0 };
}
const REGULAR = measureNamed('SigKJP');
const BOLD = measureNamed('SigKJPB');

function wrapped(overrides = {}) {
  return {
    src: 0, kind: 'text', color: '#1c2430', opacity: 1, rect: [100, 674.5, 224, 720.5], text: 'あいうえおかきくけこさしすせそ\nab',
    fontSize: 10, rotation: 0, width: 'auto', lines: ['あいうえおかきくけこさし', 'すせそ', 'ab'], inset: [2, 2], ...overrides,
  };
}

test('matchesText は行が本文を改行の位置で割り、その中をさらに割ったものかを見る', () => {
  assert.equal(matchesText(['あい', 'う', 'え'], 'あいう\nえ'), true);
  assert.equal(matchesText(['あいう', '', 'え'], 'あいう\n\nえ'), true);
  assert.equal(matchesText(['あいう', ''], 'あいう\n'), true);
  assert.equal(matchesText(['あいうえ'], 'あいう\nえ'), false, '改行を落とした');
  assert.equal(matchesText(['あい', 'うえ'], 'あい\nう\nえ'), false);
  assert.equal(matchesText(['あいう', 'え', 'お'], 'あいう\nえ'), false, '行が余る');
  assert.equal(matchesText(['あいx'], 'あいう'), false);
});

test('isWrappedEntry は幅・行・中身の位置・太字・斜体の形を見て、今までの形は対象にしない', () => {
  assert.equal(isWrapped(wrapped()), true);
  assert.equal(isWrapped({ kind: 'text' }), false);
  assert.equal(isWrappedEntry(wrapped()), true);
  assert.equal(isWrappedEntry(wrapped({ width: 80, bold: true, italic: true })), true);
  for (const broken of [
    { width: 0 }, { width: 'fixed' }, { lines: undefined }, { lines: ['あいう'] }, { lines: [1] }, { inset: [2] }, { inset: [2, -1] },
    { bold: false }, { italic: 'yes' }, { text: '' }, { color: 'red' },
  ])
    assert.equal(isWrappedEntry(wrapped(broken)), false, JSON.stringify(broken));
  assert.equal(isWrappedEntry({ ...wrapped(), width: undefined }), false);
});

test('wrappedBlockOps は行ごとに Tm で置き、斜体は傾き 0.25、空の行は描かずに行送りだけ数える', () => {
  const ops = wrappedBlockOps({ lines: ['あ', '', 'b'], fontSize: 10, rgb: [1, 0, 0], origin: [102, 718.5], italic: false }, REGULAR);
  assert.deepEqual(ops, [
    'BT', '1 0 0 rg', '/SigKJP 10 Tf',
    '1 0 0 1 102 707.89 Tm', '<3042> Tj',
    '1 0 0 1 102 682.89 Tm', '<0062> Tj',
    'ET',
  ]);
  assert.equal(ITALIC_SKEW, 0.25);
  const italic = wrappedBlockOps({ lines: ['あ'], fontSize: 20, rgb: [0, 0, 0], origin: [0, 100], italic: true }, BOLD);
  assert.deepEqual(italic.slice(2, 4), ['/SigKJPB 20 Tf', '1 0 0.25 1 0 78.78 Tm']);
});

test('wrappedAppearanceOf は箱を伸ばさず、/DA・/DS と使う書体の名前を返す', () => {
  const appearance = wrappedAppearanceOf(wrapped(), REGULAR);
  assert.deepEqual(appearance.rect, [100, 674.5, 224, 720.5]);
  assert.deepEqual(appearance.bbox, [100, 674.5, 224, 720.5]);
  assert.equal(appearance.da, '/SigKJP 10 Tf 0.11 0.141 0.188 rg');
  assert.equal(appearance.ds, 'font: 10pt "Noto Sans JP"; color: #1C2430');
  assert.equal(appearance.fontName, 'SigKJP');
  assert.equal(appearance.subtype, 'FreeText');
  assert.deepEqual(appearance.lines, ['あいうえおかきくけこさし', 'すせそ', 'ab']);
  assert.match(appearance.content, /^q\n\/GS gs\n1 0 0 1 0 0 cm\n100 674.5 124 46 re W n\nBT\n0.11 0.141 0.188 rg\n\/SigKJP 10 Tf\n1 0 0 1 102 707.89 Tm\n/);
  assert.match(appearance.content, /\n1 0 0 1 102 682.89 Tm\n<00610062> Tj\nET\nQ$/);
});

test('wrappedAppearanceOf は太字なら太字の書体の名前で描き、/DA の書体名は自分の印のまま。斜体は中身の位置を inset で受ける', () => {
  const appearance = wrappedAppearanceOf(wrapped({ bold: true, italic: true, inset: [2.8, 2] }), BOLD);
  assert.equal(appearance.fontName, 'SigKJPB');
  assert.match(appearance.da, /^\/SigKJP 10 Tf /);
  assert.equal(appearance.ds, 'font: 10pt "Noto Sans JP"; color: #1C2430; font-weight: bold; font-style: italic');
  assert.match(appearance.content, /\n\/SigKJPB 10 Tf\n1 0 0.25 1 102.8 707.89 Tm\n/);
});

test('wrappedAppearanceOf は回した表示でも cm で回し、中身の左上は回した座標で置く', () => {
  const appearance = wrappedAppearanceOf(wrapped({ rotation: 90, rect: [100, 600, 146, 724] }), REGULAR);
  assert.match(appearance.content, /\n0 1 -1 0 0 0 cm\n600 -146 124 46 re W n\n/);
  assert.match(appearance.content, /\n1 0 0 1 602 -112.61 Tm\n/);
  assert.equal(wrappedAppearanceOf(wrapped({ lines: ['x'] }), REGULAR), null);
});

// ---- 塗りと枠線と半透明（spec-4b-4a 確定事項I2・I3・I5） ----

test('塗りと枠線は文字より先に描き、/DA の色は枠線の色、/C と /BS の値を返す', () => {
  const appearance = wrappedAppearanceOf(wrapped({ fill: '#ffff00', borderColor: '#c00000', borderWidth: 2, inset: [7, 7], rect: [100, 664.5, 234, 720.5] }), REGULAR);
  assert.match(appearance.content, /re W n\n1 1 0 rg\n100 664.5 134 56 re f\n0.753 0 0 RG\n2 w\n0 j\n101 665.5 132 54 re S\nBT\n/);
  assert.equal(appearance.da, '/SigKJP 10 Tf 0.753 0 0 rg');
  assert.deepEqual(appearance.fillRgb, [1, 1, 0]);
  assert.equal(appearance.borderWidth, 2);
  assert.equal(appearance.group, undefined);
  assert.match(appearance.content, /^q\n\/GS gs\n/);
});

test('半透明なら /GS gs を外した中身を透明グループにし、外側の先頭に何も描かない文字の命令を置く', () => {
  const appearance = wrappedAppearanceOf(wrapped({ opacity: 0.5, fill: '#ffff00', bold: true }), BOLD);
  assert.equal(appearance.group, true);
  assert.equal(appearance.prefix, 'BT /SigKJPB 10 Tf 0.11 0.141 0.188 rg ET');
  assert.doesNotMatch(appearance.content, /\/GS gs/);
  assert.equal(appearance.opacity, 0.5);
});

test('塗り・枠線の形が違えば断る', () => {
  for (const broken of [{ fill: 'yellow' }, { borderColor: '#c00000' }, { borderWidth: 2 }, { borderColor: '#c00000', borderWidth: 0 }])
    assert.equal(isWrappedEntry(wrapped(broken)), false, JSON.stringify(broken));
});
