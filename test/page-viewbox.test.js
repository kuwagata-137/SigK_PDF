'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-crop.js');
require('../renderer/page-viewbox.js');
const { viewportFor } = globalThis.SigK.pageViewbox;

// 描く範囲を差し替えた viewport（spec-4b-6a 確定事項5。事前調査 B）。getViewport の戻り値の constructor で作る。

class Viewport {
  constructor(options) {
    this.options = options;
    this.viewBox = options.viewBox;
    this.userUnit = options.userUnit;
    this.scale = options.scale;
    this.rotation = options.rotation;
  }
}

function pageOf({ view = [0, 0, 600, 800], rotate = 90, plain = false } = {}) {
  const calls = [];
  return {
    calls,
    view,
    rotate,
    getViewport(options) {
      calls.push(options);
      const rotation = options.rotation ?? rotate;
      return plain
        ? { viewBox: view, userUnit: 1, scale: options.scale, rotation }
        : new Viewport({ viewBox: view, userUnit: 2, scale: options.scale, rotation });
    },
  };
}

test('箱が無いか、ファイルの見える範囲と同じなら getViewport のまま', () => {
  const page = pageOf();
  assert.deepEqual(viewportFor(page, { scale: 1.5, rotation: 0 }).viewBox, [0, 0, 600, 800]);
  assert.deepEqual(viewportFor(page, { scale: 1.5, rotation: 0, box: [0, 0, 600, 800.004] }).viewBox, [0, 0, 600, 800]);
  assert.deepEqual(page.calls, [{ scale: 1.5, rotation: 0 }, { scale: 1.5, rotation: 0 }]);
});

test('箱が違えば同じ constructor で作り、userUnit・倍率・角度を引き継ぐ', () => {
  const viewport = viewportFor(pageOf(), { scale: 2, rotation: 270, box: [400, 600, 100, 200] });
  assert.ok(viewport instanceof Viewport);
  assert.deepEqual(viewport.options, { viewBox: [100, 200, 400, 600], userUnit: 2, scale: 2, rotation: 270 });
});

test('rotation を渡さなければページ自身の角度（getViewport の既定）を使う', () => {
  const page = pageOf({ rotate: 90 });
  const viewport = viewportFor(page, { scale: 1, box: [100, 200, 400, 600] });
  assert.deepEqual(page.calls, [{ scale: 1 }]);
  assert.equal(viewport.rotation, 90);
});

test('作れない viewport（素のオブジェクト）なら元の範囲のまま', () => {
  const viewport = viewportFor(pageOf({ plain: true }), { scale: 1, rotation: 0, box: [100, 200, 400, 600] });
  assert.deepEqual(viewport.viewBox, [0, 0, 600, 800]);
});
