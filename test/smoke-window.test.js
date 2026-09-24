'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PERF_CONFLICT, smokeWindowMode } = require('../smoke-window.js');

test('起動確認でなければ何もしない（常用の起動）', () => {
  assert.deepEqual(smokeWindowMode({}), { smoke: false, hidden: false, display: null, warning: null });
  assert.deepEqual(smokeWindowMode({ SIGK_SMOKE_HIDDEN: '1', SIGK_SMOKE_DISPLAY: 'secondary' }),
    { smoke: false, hidden: false, display: null, warning: null });
});

test('SIGK_SMOKE=1 だけなら窓を出す', () => {
  assert.deepEqual(smokeWindowMode({ SIGK_SMOKE: '1' }), { smoke: true, hidden: false, display: null, warning: null });
});

test('SIGK_SMOKE_HIDDEN=1 で窓を出さず、SIGK_SMOKE_DISPLAY は無視する', () => {
  assert.deepEqual(smokeWindowMode({ SIGK_SMOKE: '1', SIGK_SMOKE_HIDDEN: '1' }),
    { smoke: true, hidden: true, display: null, warning: null });
  assert.deepEqual(smokeWindowMode({ SIGK_SMOKE: '1', SIGK_SMOKE_HIDDEN: '1', SIGK_SMOKE_DISPLAY: 'secondary' }),
    { smoke: true, hidden: true, display: null, warning: null });
});

test('SIGK_SMOKE_HIDDEN は 1 のときだけ効く', () => {
  assert.equal(smokeWindowMode({ SIGK_SMOKE: '1', SIGK_SMOKE_HIDDEN: 'true' }).hidden, false);
  assert.equal(smokeWindowMode({ SIGK_SMOKE: '1', SIGK_SMOKE_HIDDEN: '0' }).hidden, false);
});

test('窓を出すときは SIGK_SMOKE_DISPLAY の寄せ先を返す（決定19）', () => {
  assert.equal(smokeWindowMode({ SIGK_SMOKE: '1', SIGK_SMOKE_DISPLAY: 'secondary' }).display, 'secondary');
  assert.equal(smokeWindowMode({ SIGK_SMOKE: '1', SIGK_SMOKE_DISPLAY: '' }).display, null);
});

test('SIGK_SMOKE_PERF と一緒なら窓を出して警告を返す（表示までの時間を測るため）', () => {
  assert.deepEqual(smokeWindowMode({ SIGK_SMOKE: '1', SIGK_SMOKE_HIDDEN: '1', SIGK_SMOKE_PERF: 'perf.json', SIGK_SMOKE_DISPLAY: 'secondary' }),
    { smoke: true, hidden: false, display: 'secondary', warning: PERF_CONFLICT });
  assert.equal(smokeWindowMode({ SIGK_SMOKE: '1', SIGK_SMOKE_PERF: 'perf.json' }).warning, null);
});
