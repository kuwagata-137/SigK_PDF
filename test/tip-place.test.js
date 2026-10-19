'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/tip-place.js');

// 説明の吹き出しの置き場所（spec-2-5 J4・J9。tip-place.js）。DOM に触れない純関数なので、矩形の数だけで確かめる。
// 対象の下 8px・左端は対象の中心から 24px 左・画面の端から 8px 離す・下に入らなければ上・どちらも入らなければ下に出して窓の中へ押し込む。

const { place } = globalThis.SigK.tipPlace;
const VP = { width: 1440, height: 900 };

test('ふつうの所では、対象の下 8px に出し、左端は対象の中心から 24px 左', () => {
  assert.deepEqual(place({ anchor: { left: 100, top: 10, right: 200, bottom: 40 }, size: { width: 240, height: 80 }, viewport: VP }),
    { left: 126, top: 48, side: 'below', arrowX: 24 });
});
test('右端のボタンでは、窓の右から 8px の所まで内側へ寄せ、矢印は対象の中心を指す', () => {
  assert.deepEqual(place({ anchor: { left: 1400, top: 8, right: 1430, bottom: 36 }, size: { width: 280, height: 90 }, viewport: VP }),
    { left: 1152, top: 44, side: 'below', arrowX: 263 });
});
test('左端のボタンでは、左から 8px に置き、矢印は端から 14px より内側に収める', () => {
  assert.deepEqual(place({ anchor: { left: 0, top: 50, right: 30, bottom: 80 }, size: { width: 200, height: 60 }, viewport: VP }),
    { left: 8, top: 88, side: 'below', arrowX: 14 });
});
test('下に入らなければ、対象の上 8px に出す（下のファイル名）', () => {
  assert.deepEqual(place({ anchor: { left: 10, top: 860, right: 90, bottom: 890 }, size: { width: 200, height: 70 }, viewport: VP }),
    { left: 26, top: 782, side: 'above', arrowX: 24 });
});
test('上にも下にも入らなければ、下に出して窓の中へ押し込む', () => {
  assert.deepEqual(place({ anchor: { left: 100, top: 40, right: 140, bottom: 60 }, size: { width: 100, height: 80 }, viewport: { width: 400, height: 100 } }),
    { left: 96, top: 12, side: 'below', arrowX: 24 });
});
test('窓より広いときは、左から 8px に置く', () => {
  assert.equal(place({ anchor: { left: 50, top: 0, right: 70, bottom: 20 }, size: { width: 300, height: 40 }, viewport: { width: 200, height: 400 } }).left, 8);
});
