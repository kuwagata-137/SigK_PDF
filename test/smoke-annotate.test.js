'use strict';

// 起動確認の注釈の経路（smoke-annotate.js・smoke-annotate-steps.js・smoke-annotate-report.js）。
// main.js から移したもの（spec-4b-1a 確定事項36）。スクリプトは実機でしか回せないので、ここは
// 「組み立てた式が文法として正しいこと」と「保存先のフォントを数える関数が正しく数えること」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { annotateScript, countEmbeddedFonts } = require('../smoke-annotate.js');
const { STEPS } = require('../smoke-annotate-steps.js');
const { REPORT } = require('../smoke-annotate-report.js');
const { fixturePath } = require('./fixtures/build.js');

function parses(script) {
  // executeJavaScript に渡す式（async の即時関数）として読めること。コンパイルだけで実行はしない。
  assert.doesNotThrow(() => new vm.Script(script));
}

test('スクリプトはどの操作列でも式として読める', () => {
  parses(annotateScript('x.pdf', 'save'));
  parses(annotateScript('x.pdf', 'select:0:2-3,highlight,color:#8ce99a,undo,redo,save'));
  parses(annotateScript('x.pdf', 'tool:note,author:総務,note:0:100x700:確認|2行目,opacity:50,list:1,save'));
});

test('操作ごとの分岐と結果の組み立ては、スクリプトの中に 1 度ずつ埋まる', () => {
  const script = annotateScript('x.pdf', 'save');
  assert.equal(script.split(STEPS).length, 2);
  assert.equal(script.split(REPORT).length, 2);
  // 文書のパスと操作列は JSON の文字列として埋まる（引用符や改行で式が壊れない）。
  assert.ok(annotateScript('a"b.pdf', 'text:0:1x2:"q"').includes(JSON.stringify('a"b.pdf')));
});

test('countEmbeddedFonts は保存先に埋まった /Type0 のフォントを数える', async () => {
  // sigk-annotated.pdf はテキスト注釈を 1 つ持ち、同梱フォントのサブセットが 1 組埋まっている。
  assert.equal(await countEmbeddedFonts(fixturePath('sigk-annotated.pdf')), 1);
  assert.equal(await countEmbeddedFonts(fixturePath('three-pages.pdf')), 0);
});
