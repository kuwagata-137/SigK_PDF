'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/imported-values.js');
require('../renderer/free-text-wrap.js');
require('../renderer/free-text-layout.js');
require('../renderer/imported-text-details.js');

// 読み込んだ自前のテキストに口の答えを当てる（spec-4b-4a 確定事項J2〜J4）。

const textDetails = globalThis.SigK.importedTextDetails;
// 送り幅（em）の見積もり。太字でも同じ。
const advanceOf = (unit) => (unit.charCodeAt(0) < 128 ? 0.5 : 1);
const STYLE = { bold: false, italic: false, color: '#112233' };
const FIFTEEN = 'あいうえおかきくけこさしすせそ';

// 表示の左上 (100, 700)・表示の幅 width の、自前のテキスト（pdf.js から組んだ今までの形）。
function own(width, extra = {}) {
  const rect = [100, 650, 100 + width, 700];
  return { ref: '50R', src: 0, kind: 'text', color: '#d92c2c', opacity: 1, rect, quads: [], text: FIFTEEN, fontSize: 10, rotation: 0, ...extra };
}

test('口が答えなかった・その注釈の答えが無い・/DS を読めないときは null（表示のみ）', () => {
  assert.equal(textDetails.withTextDetails(own(124), { defaultStyle: STYLE }, { answered: false, advanceOf }), null);
  assert.equal(textDetails.withTextDetails(own(124), undefined, { advanceOf }), null);
  assert.equal(textDetails.withTextDetails(own(124), { defaultStyle: 'unreadable' }, { advanceOf }), null);
  assert.equal(textDetails.withTextDetails(own(124), { defaultStyle: STYLE }), null, '字を測れなければ幅を見分けられない');
});

test('/DS が無ければ今までの形のまま', () => {
  const entry = own(124);
  assert.equal(textDetails.withTextDetails(entry, { defaultStyle: null }, { advanceOf }), entry);
  assert.equal(textDetails.withTextDetails(entry, { ca: 0.5 }, { advanceOf }), entry, '欄の無い答え（古い口）も今までの形');
});

test('/DS があれば新しい形にし、文字の色・太字・斜体は /DS から取る', () => {
  const plain = textDetails.withTextDetails(own(124), { defaultStyle: STYLE }, { advanceOf });
  assert.equal(plain.width, 'auto');
  assert.equal(plain.color, '#112233');
  assert.equal('bold' in plain || 'italic' in plain, false);
  assert.deepEqual(plain.rect, [100, 650, 224, 700], '箱は /Rect のまま');
  // 斜体は箱に左右の分（0.8＋2.5）が入っている。
  const styled = textDetails.withTextDetails(own(127.3), { defaultStyle: { bold: true, italic: true, color: null } }, { advanceOf });
  assert.equal(styled.bold, true);
  assert.equal(styled.italic, true);
  assert.equal(styled.color, '#d92c2c', '/DS に色が無ければ pdf.js の色');
  assert.equal(styled.width, 'auto');
});

test('幅の形: 箱の中身が自動の幅で折った最長行なら自動、違えば固定の幅（0.01pt に丸める）', () => {
  const widthOf = (width, extra) => textDetails.widthOf(own(width, extra), { advanceOf });
  assert.equal(widthOf(124), 'auto');
  assert.equal(widthOf(124.01), 'auto', '保存の丸めは許す');
  assert.equal(widthOf(104), 100, '10 字で折った固定');
  assert.equal(widthOf(150.004), 146, '最長行より広い固定');
  // 中身の幅がちょうど最長行で、行も同じなら自動とみなす（起草者の判断。J3）。
  assert.equal(widthOf(34, { text: 'あいう' }), 'auto');
  assert.equal(widthOf(54, { text: 'あいう' }), 50);
  assert.equal(widthOf(3), null, '中身の幅が正でない');
});

test('自動の箱は最長行を 0.01pt に丸めて保存するので、中身の幅が最長行よりわずかに狭くても自動とみなす', () => {
  // 1 字 3.337pt の 40 字。自動の幅 120 に 35 字（116.795pt）が入り、箱は 116.795＋4 を丸めた 120.79。
  const narrow = (unit) => (unit === 'a' ? 0.3337 : 1);
  const entry = own(120.79, { text: 'a'.repeat(40) });
  assert.equal(textDetails.widthOf(entry, { advanceOf: narrow }), 'auto');
});

test('幅の形は紙の長さで抑えた自動の幅で見分け、回した表示では表示の向きの幅を見る', () => {
  const big = { fontSize: 100, text: 'あいうえおかきくけこさし' };
  // 紙の長さ 595 なら自動の幅は 591 で、5 字ずつ折れて最長行は 500。
  const entry = own(504, big);
  assert.equal(textDetails.widthOf(entry, { advanceOf, pageLength: 595 }), 'auto');
  assert.equal(textDetails.widthOf(entry, { advanceOf }), 500, '紙の長さが分からなければ 12 字で見るので固定');
  const lengths = [];
  const turned = { ...own(124), rotation: 90, rect: [100, 700, 150, 824] };
  const result = textDetails.withTextDetails(turned, { defaultStyle: STYLE }, { advanceOf, pageLengthOf: (src, rotation) => { lengths.push([src, rotation]); return 842; } });
  assert.equal(result.width, 'auto');
  assert.deepEqual(lengths, [[0, 90]]);
});

test('塗りは /C、枠線は /BS /W が正なら /DA の色と太さで読み、箱の余白に入れて幅を見分ける（確定事項J2）', () => {
  // 塗りと枠線 1.5 の余白は max(2, 3)＋1.5＝4.5。12 字（120）の自動の箱は 120＋9＝129。
  const detail = { defaultStyle: STYLE, stroke: [1, 1, 0], borderWidth: 1.5, daColor: '#c00000' };
  const read = textDetails.withTextDetails(own(129), detail, { advanceOf });
  assert.deepEqual([read.fill, read.borderColor, read.borderWidth, read.width], ['#ffff00', '#c00000', 1.5, 'auto']);
  const gray = textDetails.withTextDetails(own(124), { defaultStyle: STYLE, stroke: [0.5], borderWidth: 0 }, { advanceOf });
  assert.equal(gray.fill, '#808080');
  assert.equal('borderColor' in gray, false);
  // /DA の色が読めなければ文字の色を枠線の色にする。
  assert.equal(textDetails.withTextDetails(own(129), { ...detail, daColor: null }, { advanceOf }).borderColor, '#d92c2c');
});

// ---- 回したテキスト（spec-4b-4b 確定事項H2・H4・H5） ----

test('回したテキストは、口の箱（回す前の箱）と角度を当て、四角を回した 4 隅にしてから幅を見分ける', () => {
  require('../renderer/shape-rotation.js');
  const rotation = globalThis.SigK.shapeRotation;
  // pdf.js の /Rect は回した外接なので、口の箱で置き換える。中身の幅は自動（最長行 12 字 = 120pt）。
  const box = [100, 671, 224, 700];
  const read = textDetails.withTextDetails(own(300, { rect: [60, 620, 270, 760] }), { defaultStyle: STYLE, rotation: { box, angle: 30 } }, { advanceOf });
  assert.deepEqual(read.rect, box);
  assert.equal(read.angle, 30);
  assert.deepEqual(read.quads, [rotation.quadOf(box, 30)]);
  assert.equal(read.width, 'auto');
});

test('回転を読めない（skewed）自前のテキストと、角度を持てない今までの形の回ったテキストは表示のみ（null）', () => {
  assert.equal(textDetails.withTextDetails(own(124), { defaultStyle: STYLE, rotation: 'skewed' }, { advanceOf }), null);
  assert.equal(textDetails.withTextDetails(own(124), { defaultStyle: null, rotation: { box: [100, 671, 224, 700], angle: 30 } }, { advanceOf }), null);
  assert.equal(textDetails.withTextDetails(own(124), { defaultStyle: null, rotation: 'skewed' }, { advanceOf }), null);
  assert.equal(textDetails.withTextDetails(own(124), { defaultStyle: null, rotation: null }, { advanceOf }).kind, 'text');
});

// ---- 吹き出し（spec-4b-4b 確定事項H3・H5） ----

test('吹き出しは /CL の最初の点をしっぽの先にし、回していなければ /Rect を /RD で縮めた箱を回す前の箱にする', () => {
  const box = [100, 671, 224, 700];
  const outer = [78.25, 538.25, 225.75, 701.75];
  const rd = [21.75, 132.75, 1.75, 1.75];
  const detail = { defaultStyle: STYLE, intent: 'FreeTextCallout', calloutLine: [80, 540, 120.75, 671.75], rectDifference: rd, rotation: null };
  const read = textDetails.withTextDetails(own(0, { rect: outer }), detail, { advanceOf });
  assert.deepEqual(read.rect, box);
  assert.deepEqual(read.callout, { tip: [80, 540] });
  assert.equal(read.width, 'auto');
  // 回した吹き出しは、口の箱（/BBox を /RD で縮めたもの）をそのまま使う。
  const turned = textDetails.withTextDetails(own(0, { rect: [10, 10, 300, 800] }), { ...detail, rotation: { box, angle: 30 } }, { advanceOf });
  assert.deepEqual(turned.rect, box);
  assert.equal(turned.angle, 30);
  assert.deepEqual(turned.callout, { tip: [80, 540] });
});

test('/RD が無い・崩れている・箱が残らない吹き出しと、/DS の無い吹き出しは表示のみ（null）', () => {
  const base = { defaultStyle: STYLE, intent: 'FreeTextCallout', calloutLine: [80, 540, 120, 600], rotation: null };
  const rect = [78.25, 538.25, 225.75, 701.75];
  assert.equal(textDetails.withTextDetails(own(0, { rect }), { ...base, rectDifference: null }, { advanceOf }), null);
  assert.equal(textDetails.withTextDetails(own(0, { rect }), { ...base, rectDifference: [100, 100, 100, 100] }, { advanceOf }), null);
  assert.equal(textDetails.withTextDetails(own(0, { rect }), { ...base, calloutLine: null, rectDifference: [1, 1, 1, 1] }, { advanceOf }), null);
  assert.equal(textDetails.withTextDetails(own(0, { rect }), { ...base, defaultStyle: null, rectDifference: [1, 1, 1, 1] }, { advanceOf }), null);
});
