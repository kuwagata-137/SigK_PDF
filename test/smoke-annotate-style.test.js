'use strict';

// 起動確認の見た目の操作と、保存先の書き込みの見た目を読む口（smoke-annotate-style.js。spec-4b-1b の起動確認）。
// スクリプトは実機でしか回せないので、ここは「見た目の操作を入れた式が文法として正しいこと」と「保存先の欄を正しく読むこと」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { annotateScript } = require('../smoke-annotate.js');
const { STYLE_STEPS, inspectAnnotations } = require('../smoke-annotate-style.js');
const { fixturePath } = require('./fixtures/build.js');

test('見た目の操作を入れた操作列も式として読め、分岐は 1 度だけ埋まる', () => {
  const script = annotateScript('x.pdf', 'bar:square,palette:fill:3x8,stroke:none,style:cloudy,chip:color,other:#123456,slide:width:6;12;17,slide:opacity:80;50,fill:none,save');
  assert.doesNotThrow(() => new vm.Script(script));
  assert.equal(script.split(STYLE_STEPS).length, 2);
  assert.ok(script.includes('historyDelta'), '操作ごとに履歴の進みを控える');
  assert.equal(STYLE_STEPS.includes('`'), false);
  assert.equal(STYLE_STEPS.includes('${'), false);
});

test('inspectAnnotations は保存先の図形の /C・/IC・/CA・/BS・/BE・/RD と透明グループを読む', async () => {
  const written = await inspectAnnotations(fixturePath('styled.pdf'));
  const page2 = written.filter((entry) => entry.page === 2);
  assert.deepEqual(page2.map((entry) => entry.subtype), ['Square', 'Square', 'PolyLine', 'Circle']);
  const [cloud, cmyk, dashed, grey] = page2;
  assert.deepEqual(cloud.BE, { S: 'C', I: 2 });
  assert.equal(cloud.RD.length, 4);
  assert.equal(new Set(cloud.RD).size, 1, '/RD は 4 つとも同じ余白');
  assert.deepEqual(cmyk.IC, [0, 0, 1, 0]);
  assert.deepEqual(dashed.BS, { W: 2, S: 'D', D: [4, 2] });
  assert.deepEqual([grey.C, grey.IC, grey.BS.W], [null, [0.8], 0]);
  assert.equal(written.find((entry) => entry.page === 1).CA, 0.5);
  assert.equal(written.some((entry) => entry.group), false, '他のアプリの外観は透明グループで包んでいない');
  // ノート（/Text）は数えない。3 ページ目の 2 件（参照の世代 1 と、/Annots に直に置いた辞書）も読む。
  assert.deepEqual(written.filter((entry) => entry.page === 3).map((entry) => entry.CA), [0.6, 0.4]);
});

test('inspectAnnotations は SigK PDF の半透明の図形の外観が透明グループで包まれていると読む', async () => {
  const written = await inspectAnnotations(fixturePath('sigk-annotated.pdf'));
  const square = written.find((entry) => entry.subtype === 'Square');
  assert.equal(square.CA, 0.5);
  assert.equal(square.group, true);
  assert.equal(written.find((entry) => entry.subtype === 'Circle').group, false, '不透明なら包まない');
});
