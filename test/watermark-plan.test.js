'use strict';

// 透かしの設定の検査と、ワーカーへ渡す spec の組み立て（spec-4-5 確定事項3〜6・25・40）。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-range.js');
require('../renderer/watermark-geometry.js');
require('../renderer/watermark-plan.js');
const { MAX_TEXT_LENGTH } = require('../worker/op-watermark.js');
const { normalizeText: workerNormalize } = require('../worker/op-watermark.js');

const plan = globalThis.SigK.watermarkPlan;
const A = 'C:\\work\\見積書.pdf';
const READY_SOURCE = { path: A, name: '見積書.pdf', pageCount: 5, blocked: null, note: null, pending: false };
const PNG = { path: 'C:\\work\\logo.png', name: 'logo.png', kind: 'png', width: 400, height: 200, pending: false, error: null };

test('プリセットと既定値は仕様どおり（灰・赤・青・黒／15・30・50・100%／「社外秘」・灰・30%・斜め・中央・中）', () => {
  assert.deepEqual([...plan.COLORS], ['#808080', '#d92c2c', '#2c5cd9', '#1c2430']);
  assert.deepEqual({ ...plan.COLOR_NAMES }, { '#808080': '灰', '#d92c2c': '赤', '#2c5cd9': '青', '#1c2430': '黒' });
  assert.deepEqual([...plan.OPACITIES], [0.15, 0.3, 0.5, 1]);
  assert.deepEqual({ ...plan.DEFAULTS }, {
    type: 'text', text: '社外秘', color: '#808080', opacity: 0.3, angle: 45, size: 'medium', position: 'center', pageMode: 'all', range: '',
  });
  assert.equal(plan.MAX_TEXT_LENGTH, MAX_TEXT_LENGTH);
  assert.equal(plan.POSITION_LABELS.center, '中央');
  assert.equal(Object.keys(plan.POSITION_LABELS).length, 9);
});

test('normalizeText はワーカーと同じく 1 行に整える（制御文字は空白、前後の空白は落とす）', () => {
  for (const text of ['  社外秘 ', '社外\t秘', '社外\n秘\r\n', '', undefined, 5])
    assert.equal(plan.normalizeText(text), workerNormalize(text), JSON.stringify(text));
});

test('defaultTarget は元と同じフォルダーの <元の名前>_透かし.pdf', () => {
  assert.equal(plan.defaultTarget(A), 'C:\\work\\見積書_透かし.pdf');
  assert.equal(plan.defaultTarget('C:\\work\\a.PDF'), 'C:\\work\\a_透かし.pdf');
  assert.equal(plan.defaultTarget(''), undefined);
});

test('文字の透かしの spec と要約を組む（ページはすべて）', () => {
  const planned = plan.planOf({ source: READY_SOURCE, image: null, settings: { ...plan.DEFAULTS } });
  assert.equal(planned.ready, true);
  assert.equal(planned.error, null);
  assert.deepEqual(structuredClone(planned.pages), [0, 1, 2, 3, 4]);
  assert.deepEqual(structuredClone(planned.spec), {
    kind: 'watermark', label: '透かしを追加', source: A, pages: [0, 1, 2, 3, 4],
    mark: { type: 'text', text: '社外秘', color: '#808080', opacity: 0.3, angle: 45, size: 'medium', position: 'center' },
  });
  assert.equal(planned.summary, '5 ページに文字の透かしを入れます');
});

test('範囲は重複を畳んで昇順の集合にする（書いた順・重複は結果に効かない）', () => {
  const planned = plan.planOf({ source: READY_SOURCE, image: null, settings: { ...plan.DEFAULTS, pageMode: 'range', range: '4, 1-2, 2' } });
  assert.deepEqual(structuredClone(planned.pages), [0, 1, 3]);
  assert.equal(planned.summary, '3 ページに文字の透かしを入れます');
  // 範囲の空欄はすべて（PDF→画像と同じ）。
  assert.equal(plan.planOf({ source: READY_SOURCE, image: null, settings: { ...plan.DEFAULTS, pageMode: 'range', range: '' } }).pages.length, 5);
});

test('範囲の誤りは errorKind: range で返す', () => {
  const planned = plan.planOf({ source: READY_SOURCE, image: null, settings: { ...plan.DEFAULTS, pageMode: 'range', range: '9' } });
  assert.equal(planned.ready, false);
  assert.equal(planned.errorKind, 'range');
  // 文言は page-range.js のまま（分割・PDF→画像と同じ）。
  assert.equal(planned.error, globalThis.SigK.pageRange.parsePageRange('9', 5).error);
});

test('画像の透かしの spec は画像のパスを渡し、色は持たない', () => {
  const planned = plan.planOf({ source: READY_SOURCE, image: PNG, settings: { ...plan.DEFAULTS, type: 'image', angle: 0, size: 'small', position: 'top-right', opacity: 0.5 } });
  assert.equal(planned.ready, true);
  assert.deepEqual(structuredClone(planned.spec.mark), { type: 'image', image: 'C:\\work\\logo.png', opacity: 0.5, angle: 0, size: 'small', position: 'top-right' });
  assert.equal(planned.summary, '5 ページに画像の透かしを入れます');
});

test('実行できない理由を返す（対象・文字・画像）', () => {
  const settings = { ...plan.DEFAULTS };
  const reason = (args) => plan.planOf({ source: READY_SOURCE, image: null, settings, ...args }).error;
  assert.equal(reason({ source: null }), '透かしを入れる PDF を決めてください。');
  assert.equal(reason({ source: { ...READY_SOURCE, pending: true } }), '対象の PDF を読んでいます…');
  assert.equal(reason({ source: { ...READY_SOURCE, blocked: 'x。選び直してください' } }), '対象の PDF を選び直してください。');
  assert.equal(reason({ settings: { ...settings, text: '  ' } }), '透かしの文字を入れてください。');
  assert.equal(reason({ settings: { ...settings, text: 'あ'.repeat(51) } }), `透かしの文字は ${MAX_TEXT_LENGTH} 文字までです。`);
  const imageSettings = { ...settings, type: 'image' };
  assert.equal(reason({ settings: imageSettings }), '透かしにする画像を選んでください。');
  assert.equal(reason({ settings: imageSettings, image: { ...PNG, pending: true } }), '画像を読んでいます…');
  assert.equal(reason({ settings: imageSettings, image: { ...PNG, error: 'PNG か JPEG の画像を選んでください。' } }), 'PNG か JPEG の画像を選んでください。');
});

test('文字の透かしでは画像の誤りを問わず、画像の透かしでは文字の誤りを問わない', () => {
  const brokenImage = { ...PNG, error: 'x' };
  assert.equal(plan.planOf({ source: READY_SOURCE, image: brokenImage, settings: { ...plan.DEFAULTS } }).ready, true);
  assert.equal(plan.planOf({ source: READY_SOURCE, image: PNG, settings: { ...plan.DEFAULTS, type: 'image', text: '' } }).ready, true);
});
