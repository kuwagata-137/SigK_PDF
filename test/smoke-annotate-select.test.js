'use strict';

// 起動確認の選択と複数選択の操作と結果の欄（smoke-annotate-select.js。spec-4b-3a の起動確認）。
// スクリプトは実機でしか回せないので、ここは「選択の操作を入れた式が文法として正しいこと」と、埋め込みの決まりを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { annotateScript } = require('../smoke-annotate.js');
const { SELECT_STEPS, SELECT_REPORT } = require('../smoke-annotate-select.js');

test('選択の操作を入れた操作列も式として読め、分岐と結果の欄は 1 度だけ埋まる', () => {
  const script = annotateScript('x.pdf', 'shape:square:0:100x700-200x600,bar:select,marquee:0:80x720-420x580:add,ctrl-click:0:150x700,move:20x0:shift,move:0x-30:ctrl-late,list-ctrl:1,list-shift:2,key:Backspace,save');
  assert.doesNotThrow(() => new vm.Script(script));
  assert.equal(script.split(SELECT_STEPS).length, 2);
  assert.equal(script.split(SELECT_REPORT).length, 2);
  assert.ok(script.includes('selection: selectReport'), '結果に selection の欄がある');
  assert.ok(script.includes('count: SigK.annotate.getSelection().length'), '操作ごとに選んでいる件数を控える');
});

test('埋め込む文字列にバッククォートと ${ を書かない', () => {
  for (const text of [SELECT_STEPS, SELECT_REPORT]) {
    assert.equal(text.includes('`'), false);
    assert.equal(text.includes('${'), false);
  }
});

test('操作の分岐は else if で始まり、前の分岐の続きになる', () => {
  assert.match(SELECT_STEPS.trimStart(), /^else if \(name === 'ctrl-click'\)/);
});
