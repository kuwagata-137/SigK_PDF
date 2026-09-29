'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/markup-quads.js');
require('../renderer/free-text-geometry.js');
require('../renderer/note-graphics.js');
require('../renderer/imported-values.js');
require('../renderer/imported-shape.js');
require('../renderer/imported-entry.js');

// ファイルにある注釈 1 件を自前の形にする層（spec-4-1 確定事項17、spec-4-3 確定事項13、spec-4-4 確定事項20）。
// annotation-import.test.js から移した（spec-4b-1a 確定事項36）。

const imp = globalThis.SigK.importedEntry;

test('importedEntry はテキストマークアップだけを自前の形にする', () => {
  const entry = imp.importedEntry({ id: '86R', subtype: 'Underline', rect: [40, 600, 200, 612], quadPoints: [40, 612, 200, 612, 40, 600, 200, 600], color: [217, 44, 44] }, 3);
  assert.deepEqual(entry, {
    ref: '86R', src: 3, kind: 'underline', color: '#d92c2c', opacity: 1,
    quads: [[40, 612, 200, 612, 40, 600, 200, 600]], rect: [40, 600, 200, 612],
  });
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Highlight', quadPoints: [1, 2, 3, 4, 5, 6, 7, 8], color: [0, 0, 0], opacity: 0.6 }, 0).opacity, 0.6);
  // rect が無ければ四角の外接。
  assert.deepEqual(imp.importedEntry({ id: '1R', subtype: 'StrikeOut', quadPoints: [1, 8, 9, 8, 1, 2, 9, 2], color: [0, 0, 0] }, 0).rect, [1, 2, 9, 8]);
  assert.equal(imp.importedEntry({ id: '2R', subtype: 'Link', rect: [0, 0, 1, 1] }, 0), null);
  // 四角の無いハイライトは直せないが、箱があれば表示のみで一覧に出る（spec-4-4 確定事項20）。
  assert.equal(imp.importedEntry({ id: '3R', subtype: 'Highlight', quadPoints: [] }, 0), null);
  assert.equal(imp.importedEntry({ id: '3R', subtype: 'Highlight', rect: [0, 0, 10, 10], quadPoints: [] }, 0).readonly, true);
  assert.equal(imp.importedEntry({ subtype: 'Highlight', quadPoints: [1, 2, 3, 4, 5, 6, 7, 8] }, 0), null);
});

// 文書の代わり。getAnnotations の結果を仕込む。

const BORDER = { width: 3, rawWidth: 3, style: 1, dashArray: [3] };

test('importedEntry は Square・Circle を箱と線幅で拾う', () => {
  const square = imp.importedEntry({ id: '12R', subtype: 'Square', rect: [100, 650, 300, 780], color: new Uint8ClampedArray([41, 112, 217]), borderStyle: { ...BORDER, width: 2, rawWidth: 2 } }, 0);
  assert.deepEqual(square, {
    ref: '12R', src: 0, kind: 'square', color: '#2970d9', opacity: 1, lineWidth: 2,
    rect: [100, 650, 300, 780], quads: [[100, 780, 300, 780, 100, 650, 300, 650]],
  });
  const circle = imp.importedEntry({ id: '14R', subtype: 'Circle', rect: [330.004, 650, 500, 780], color: [217, 43, 43], borderStyle: BORDER, opacity: 0.5 }, 2);
  assert.equal(circle.kind, 'circle');
  assert.equal(circle.src, 2);
  assert.equal(circle.lineWidth, 3);
  assert.equal(circle.opacity, 0.5);
  assert.deepEqual(circle.rect, [330, 650, 500, 780]);
  // 線幅が無ければ 1、/C が無ければ直せない（表示のみ）
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Square', rect: [0, 0, 10, 10], color: [0, 0, 0] }, 0).lineWidth, 1);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Square', rect: [0, 0, 10, 10], color: null, borderStyle: BORDER }, 0).readonly, true);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Square', rect: [0, 0, 10], color: [0, 0, 0] }, 0), null);
});

test('importedEntry は 2 点の PolyLine を直線か矢印として向きのまま拾う', () => {
  const line = imp.importedEntry({ id: '24R', subtype: 'PolyLine', rect: [99, 299, 481, 331], color: [41, 153, 76], borderStyle: { ...BORDER, width: 2, rawWidth: 2 }, vertices: new Float32Array([100, 330, 480, 300]), lineEndings: ['None', 'None'] }, 0);
  assert.deepEqual(line, {
    ref: '24R', src: 0, kind: 'line', color: '#29994c', opacity: 1, lineWidth: 2,
    rect: [99, 299, 481, 331], quads: [[99, 331, 481, 331, 99, 299, 481, 299]], paths: [[[100, 330], [480, 300]]],
  });
  const arrow = imp.importedEntry({ id: '22R', subtype: 'PolyLine', rect: [80.5, 280.5, 499.5, 349.5], color: [217, 43, 43], borderStyle: BORDER, vertices: new Float32Array([480, 330, 100.4000015, 300]), lineEndings: ['None', 'OpenArrow'] }, 1);
  assert.equal(arrow.kind, 'arrow');
  assert.deepEqual(arrow.paths, [[[480, 330], [100.4, 300]]]);
  // 3 点以上、矢じりが始点、両端の矢じり、閉じた矢じりは直せない（表示のみ。spec-4-4 確定事項20）
  const readonly = (annotation) => imp.importedEntry(annotation, 0)?.readonly === true;
  assert.equal(readonly({ id: '1R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: [0, 0, 5, 5, 10, 0], lineEndings: ['None', 'None'] }), true);
  assert.equal(readonly({ id: '1R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: [0, 0, 10, 10], lineEndings: ['OpenArrow', 'None'] }), true);
  assert.equal(readonly({ id: '1R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: [0, 0, 10, 10], lineEndings: ['None', 'ClosedArrow'] }), true);
  assert.equal(readonly({ id: '1R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: null, lineEndings: ['None', 'None'] }), true);
  // Line（pdf.js が向きを落とす）と Polygon も表示のみ
  assert.equal(readonly({ id: '1R', subtype: 'Line', rect: [0, 0, 10, 10], color: [0, 0, 0], lineCoordinates: [0, 0, 10, 10], lineEndings: ['None', 'None'] }), true);
  assert.equal(readonly({ id: '1R', subtype: 'Polygon', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: [0, 0, 10, 0, 10, 10] }), true);
});

test('importedEntry は Ink を path ごとの点列で拾い、2 点未満の path は捨てる', () => {
  const ink = imp.importedEntry({ id: '20R', subtype: 'Ink', rect: [97.5, 347.5, 302.5, 412.5], color: [41, 112, 217], borderStyle: { ...BORDER, width: 5, rawWidth: 5 }, inkLists: [new Float32Array([100, 380, 130, 410, 170, 360]), new Float32Array([1, 1]), new Float32Array([200.004, 400, 210, 390])], opacity: 1 }, 0);
  assert.deepEqual(ink, {
    ref: '20R', src: 0, kind: 'ink', color: '#2970d9', opacity: 1, lineWidth: 5,
    rect: [97.5, 347.5, 302.5, 412.5], quads: [[97.5, 412.5, 302.5, 412.5, 97.5, 347.5, 302.5, 347.5]],
    paths: [[[100, 380], [130, 410], [170, 360]], [[200, 400], [210, 390]]],
  });
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Ink', rect: [0, 0, 10, 10], color: [0, 0, 0], inkLists: [[1, 1]] }, 0).readonly, true);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Ink', rect: [0, 0, 10, 10], color: [0, 0, 0], inkLists: [] }, 0).readonly, true);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Ink', rect: [0, 0, 10, 10], color: [0, 0, 0] }, 0).readonly, true);
});

// ---- ノートと表示のみ（spec-4-4 確定事項16・20） ----

test('importedEntry は Text（ノート）を /AP の有無を問わず拾い、左上から 20×20 の箱を作り直す', () => {
  const full = imp.importedEntry({ id: '12R', subtype: 'Text', rect: [60, 760, 80, 780], color: new Uint8ClampedArray([255, 227, 89]), contentsObj: { str: 'ノート1 本文\n2行目', dir: 'ltr' }, titleObj: { str: 'SigK 太郎', dir: 'ltr' }, hasAppearance: true, popupRef: '13R', name: 'NoIcon' }, 0);
  assert.deepEqual(full, {
    ref: '12R', src: 0, kind: 'note', color: '#ffe359', opacity: 1,
    quads: [[60, 780, 80, 780, 60, 760, 80, 760]], rect: [60, 760, 80, 780], text: 'ノート1 本文\n2行目', author: 'SigK 太郎',
  });
  // /AP の無いものは pdf.js が 22×22 に直して返す。左上 (60, 720) を基準に 20×20 へ。色が無ければ黄。改行は LF に揃える。
  const bare = imp.importedEntry({ id: '14R', subtype: 'Text', rect: [60, 698, 82, 720], color: null, contentsObj: { str: 'a\r\nb\rc' }, titleObj: { str: '' }, hasAppearance: false, name: 'Comment' }, 1);
  assert.deepEqual(bare.rect, [60, 700, 80, 720]);
  assert.equal(bare.color, '#ffd966', 'ノートの既定の黄（spec-4b-1b 確定事項14）');
  assert.equal(bare.text, 'a\nb\nc');
  assert.equal(bare.author, '');
  assert.equal(bare.readonly, undefined);
  // 本文が無くても拾う。箱が無ければ拾わない。
  assert.equal(imp.importedEntry({ id: '15R', subtype: 'Text', rect: [0, 0, 20, 20], color: [0, 0, 255] }, 0).text, '');
  assert.equal(imp.importedEntry({ id: '16R', subtype: 'Text', color: [0, 0, 255] }, 0), null);
});

test('importedEntry は Popup・Link・Widget を拾わない', () => {
  assert.equal(imp.importedEntry({ id: '13R', subtype: 'Popup', rect: [90, 680, 270, 780], parentRect: [60, 760, 80, 780], open: false, contentsObj: { str: 'x' } }, 0), null);
  assert.equal(imp.importedEntry({ id: '23R', subtype: 'Link', rect: [300, 300, 420, 320], url: 'https://example.invalid/' }, 0), null);
  assert.equal(imp.importedEntry({ id: '40R', subtype: 'Widget', rect: [0, 0, 10, 10] }, 0), null);
  assert.equal(imp.importedEntry({ id: '41R', subtype: 'Screen', rect: [0, 0, 10, 10] }, 0), null);
});

test('importedEntry は他のツールの markup 注釈を表示のみの entry にする', () => {
  const line = imp.importedEntry({ id: '17R', subtype: 'Line', rect: [298, 698, 502, 762], color: [255, 0, 0], contentsObj: { str: 'other line' }, titleObj: { str: 'other' }, lineCoordinates: [300, 700, 500, 760] }, 2);
  assert.deepEqual(line, {
    ref: '17R', src: 2, kind: 'other', subtype: 'Line', color: '#ff0000', opacity: 1,
    quads: [[298, 762, 502, 762, 298, 698, 502, 698]], rect: [298, 698, 502, 762], text: 'other line', author: 'other', readonly: true,
  });
  const stamp = imp.importedEntry({ id: '22R', subtype: 'Stamp', rect: [300, 340, 420, 380], color: null, hasAppearance: true }, 0);
  assert.equal(stamp.subtype, 'Stamp');
  assert.equal(stamp.color, '#8b93a1');
  assert.equal(stamp.text, '');
  // 他のツールの FreeText（/DA が SigKJP でない）も表示のみ。
  const free = imp.importedEntry({ id: '18R', subtype: 'FreeText', rect: [300, 640, 500, 670], color: [255, 255, 204], contentsObj: { str: 'Other tool 文字' }, defaultAppearanceData: { fontName: 'Helv', fontSize: 12, fontColor: [0, 0, 255] } }, 0);
  assert.equal(free.readonly, true);
  assert.equal(free.subtype, 'FreeText');
  assert.equal(free.text, 'Other tool 文字');
  // id が無ければ拾わない。
  assert.equal(imp.importedEntry({ subtype: 'Line', rect: [0, 0, 10, 10] }, 0), null);
  assert.deepEqual(imp.MARKUP_SUBTYPES.slice(0, 3), ['Text', 'FreeText', 'Line']);
});

// ---- 読み込まないものと、表示のみにするもの（spec-4b-1a 確定事項24） ----

test('importedEntry は参照の形でない id（/Annots に直に置いた辞書）を読み込まない', () => {
  const square = { subtype: 'Square', rect: [10, 10, 60, 40], color: [255, 0, 0], borderStyle: BORDER };
  // pdf.js は直に置いた辞書を annot_<ページ>_<番号> と名付ける。消す指定をワーカーが読めず、保存ごと断られていた。
  assert.equal(imp.importedEntry({ ...square, id: 'annot_p2_1' }, 0), null);
  assert.equal(imp.importedEntry({ id: 'annot_p1_3', subtype: 'Stamp', rect: [0, 0, 10, 10] }, 0), null, '表示のみにもしない');
  // 世代 1 の参照（12R1）は読み込む。
  assert.equal(imp.importedEntry({ ...square, id: '52R1' }, 0).ref, '52R1');
  assert.equal(imp.isRefId('12R'), true);
  assert.equal(imp.isRefId('12R3'), true);
  assert.equal(imp.isRefId('annot_p1_1'), false);
  assert.equal(imp.isRefId('R12'), false);
  assert.equal(imp.isRefId(12), false);
});

test('importedEntry は線幅 0 と実線でない線の図形・ペンを表示のみにする（まだ同じ見た目に描けないため）', () => {
  const base = { id: '60R', subtype: 'Square', rect: [10, 10, 60, 40], color: [255, 0, 0] };
  const noStroke = imp.importedEntry({ ...base, borderStyle: { width: 0, rawWidth: 1, style: 1, dashArray: [3] } }, 0);
  assert.equal(noStroke.readonly, true);
  assert.equal(noStroke.subtype, 'Square');
  const dashed = imp.importedEntry({ ...base, borderStyle: { width: 2, rawWidth: 2, style: 2, dashArray: [3, 2] } }, 0);
  assert.equal(dashed.readonly, true);
  const ink = imp.importedEntry({ id: '61R', subtype: 'Ink', rect: [0, 0, 50, 50], color: [0, 0, 0], borderStyle: { width: 2, rawWidth: 2, style: 2, dashArray: [3] }, inkLists: [[1, 2, 3, 4]] }, 0);
  assert.equal(ink.readonly, true);
  // 実線で線幅のあるものは今までどおり直せる。
  assert.equal(imp.importedEntry({ ...base, borderStyle: BORDER }, 0).readonly, undefined);
});
