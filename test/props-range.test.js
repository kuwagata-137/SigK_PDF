'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/props-range.js');

// 右パネルのスライダーと数値欄の組（spec-4b-1b 確定事項7・8）。

const range = globalThis.SigK.propsRange;

function makePair(options = {}) {
  const { window } = new JSDOM('<!doctype html><input type="range" id="r" min="1" max="40" step="1" value="2"><input type="number" id="n" value="2">');
  const calls = [];
  const [slider, number] = ['r', 'n'].map((id) => window.document.getElementById(id));
  range.bind(slider, number, {
    min: 1, max: 40,
    onPreview: (value) => calls.push(['preview', value]),
    onCommit: (value) => calls.push(['commit', value]),
    ...options,
  });
  return { window, slider, number, calls };
}

test('clampOf は数値欄の値を範囲の端へ寄せ、小数を四捨五入し、読めなければ null', () => {
  assert.equal(range.clampOf('0', 1, 40), 1);
  assert.equal(range.clampOf('41', 1, 40), 40);
  assert.equal(range.clampOf('35.4', 10, 100), 35);
  assert.equal(range.clampOf(' 12 ', 1, 40), 12);
  assert.equal(range.clampOf('', 1, 40), null);
  assert.equal(range.clampOf('abc', 1, 40), null);
});

test('スライダーを動かしている間は数値欄を追わせて下見し、離すと確定する', () => {
  const { window, slider, number, calls } = makePair();
  slider.value = '7';
  slider.dispatchEvent(new window.Event('input'));
  slider.value = '9';
  slider.dispatchEvent(new window.Event('input'));
  assert.equal(number.value, '9');
  slider.dispatchEvent(new window.Event('change'));
  assert.deepEqual(calls, [['preview', 7], ['preview', 9], ['commit', 9]]);
});

test('数値欄は Enter か欄の外で確定し、範囲の外は端へ、読めなければ元の値へ戻す', () => {
  const { window, slider, number, calls } = makePair();
  number.value = '41';
  number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.deepEqual([number.value, slider.value], ['40', '40']);
  number.value = '3.4';
  number.dispatchEvent(new window.Event('change'));
  assert.equal(number.value, '3');
  number.value = '';
  number.dispatchEvent(new window.Event('change'));
  assert.equal(number.value, '3', '空は元の値へ戻し、確定しない');
  number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }));
  assert.deepEqual(calls, [['commit', 40], ['commit', 3]]);
});

test('show は値を見せるが、打っている途中の数値欄は上書きしない', () => {
  const { window, slider, number } = makePair();
  range.show(slider, number, 1.5);
  assert.equal(number.value, '1.5', '読み込んだ小数はそのまま');
  number.focus();
  number.value = '1';
  range.show(slider, number, 8);
  assert.deepEqual([slider.value, number.value], ['8', '1']);
  window.close();
});

test('show の 4 つめは数値欄に出す文字（そろっていない値の空）。打っている途中なら出さない', () => {
  const { window, slider, number } = makePair();
  range.show(slider, number, 4, '');
  assert.deepEqual([slider.value, number.value], ['4', '']);
  number.focus();
  number.value = '9';
  range.show(slider, number, 6, '');
  assert.equal(number.value, '9');
  window.close();
});

test('targetOf を渡すと、打ちかけのまま相手が替われば show が欄を新しい相手の値に替え、打ちかけの値は当てない', () => {
  let target = 'A';
  const { window, slider, number, calls } = makePair({ targetOf: () => target });
  range.show(slider, number, 2);
  number.focus();
  number.value = '20';
  range.show(slider, number, 2);
  assert.equal(number.value, '20', '相手が同じなら打ちかけを残す');
  target = 'B';
  range.show(slider, number, 6);
  assert.equal(number.value, '6', '相手が替われば、その相手の値');
  // 替えたあとに打った値は新しい相手に当たる。
  number.value = '8';
  number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.deepEqual(calls, [['commit', 8]]);
  // 欄を出し直さないまま相手が替わったら、確定しても当てずに今の値へ戻す。
  number.value = '30';
  target = 'C';
  number.dispatchEvent(new window.Event('change'));
  assert.equal(number.value, '8');
  assert.deepEqual(calls, [['commit', 8]]);
  window.close();
});

test('targetOf を渡しても、当てたあとに相手の鍵が変われば（読み込んだ書き込みが写しに替わる）続けて打てる', () => {
  let target = '17R';
  const { window, slider, number, calls } = makePair({
    targetOf: () => target,
    onCommit: (value) => {
      calls.push(['commit', value]);
      target = 'copy-1';
    },
  });
  range.show(slider, number, 2);
  number.focus();
  number.value = '5';
  number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  number.value = '7';
  number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.deepEqual(calls, [['commit', 5], ['commit', 7]]);
  window.close();
});
