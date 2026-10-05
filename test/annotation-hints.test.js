'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-presets.js');
require('../renderer/shape-style.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/annotation-hints.js');

// 右パネルのヒントの文言と選び方（spec-4b-1b 確定事項4 ほか）。

const hints = globalThis.SigK.annotationHints;
const { HINTS } = hints;

test('選んでいる書き込みの種類でヒントを選び、四角・丸には両方なしの注意と塗りの注意を添える', () => {
  assert.equal(hints.forSelected({ kind: 'other', readonly: true }), HINTS.readonly);
  assert.equal(hints.forSelected({ kind: 'text' }), HINTS.textSelected);
  assert.equal(hints.forSelected({ kind: 'note' }), HINTS.noteSelected);
  assert.equal(hints.forSelected({ kind: 'highlight' }), HINTS.selected);
  // 四角・丸と直線・矢印は「掴んで動かせます。」のあとにつまみの説明を挟む（spec-4b-2 確定事項28）。ペンは挟まない。
  const withTransform = (transform) => HINTS.shapeSelected.replace(HINTS.move, `${HINTS.move}${transform}`);
  assert.equal(hints.forSelected({ kind: 'ink' }), HINTS.shapeSelected);
  assert.equal(hints.forSelected({ kind: 'arrow' }), withTransform(HINTS.lineTransform));
  assert.equal(hints.forSelected({ kind: 'line' }), withTransform(HINTS.lineTransform));
  assert.equal(hints.forSelected({ kind: 'square' }), `${withTransform(HINTS.boxTransform)}${HINTS.box}`);
  assert.equal(hints.forSelected({ kind: 'circle', fill: '#ffff00' }), `${withTransform(HINTS.boxTransform)}${HINTS.box}${HINTS.fill}`);
  assert.ok(withTransform(HINTS.boxTransform).startsWith('掴んで動かせます。四隅と辺の白いつまみで'));
});

test('道具のヒントは道具で選び、四角・丸の道具には同じ注意を添える', () => {
  assert.equal(hints.forTool(null, null, null), HINTS.none);
  assert.equal(hints.forTool('highlight', 'highlight', null), HINTS.tool);
  assert.equal(hints.forTool('pen', 'ink', null), HINTS.pen);
  // 直線・矢印の道具には始点合わせの説明を添える（spec-4b-5a 確定事項31）
  assert.equal(hints.forTool('shape', 'line', null), `${HINTS.shape}${HINTS.lineSnap}`);
  assert.equal(hints.forTool('shape', 'square', null), `${HINTS.shape}${HINTS.box}`);
  assert.equal(hints.forTool('shape', 'circle', '#ffd966'), `${HINTS.shape}${HINTS.box}${HINTS.fill}`);
  assert.ok(Object.isFrozen(HINTS));
});
