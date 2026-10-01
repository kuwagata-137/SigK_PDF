'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-marquee.js');

// 範囲選択の箱と、箱に完全に収まる書き込み（spec-4b-3a 確定事項D3・D4）。

const marquee = globalThis.SigK.annotationMarquee;

test('boxOf は逆向きに引いた 2 点も箱にし、紙の中へ収める', () => {
  assert.deepEqual(marquee.boxOf([50, 80], [10, 20]), { x: 10, y: 20, width: 40, height: 60 });
  assert.deepEqual(marquee.boxOf([-30, 10], [700, 900], { width: 600, height: 800 }), { x: 0, y: 10, width: 600, height: 790 });
});

test('enclosedKeys は箱に完全に収まる書き込みを描く順に返し、はみ出すものと表示のみは選ばない（確定事項D4）', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const entries = [
    { id: 'in', bounds: { x: 10, y: 10, width: 20, height: 20 } },
    { id: 'edge', bounds: { x: 0, y: 0, width: 100, height: 100 } },
    { id: 'over', bounds: { x: 90, y: 10, width: 20, height: 20 } },
    { ref: '12R', id: 'ignored', bounds: { x: 40, y: 40, width: 10, height: 10 } },
    { ref: '17R', readonly: true, bounds: { x: 40, y: 40, width: 10, height: 10 } },
  ];
  assert.deepEqual(marquee.enclosedKeys(entries, box, (entry) => entry.bounds), ['in', 'edge', '12R']);
});
