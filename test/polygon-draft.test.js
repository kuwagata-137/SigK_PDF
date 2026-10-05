'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/polygon-draft.js');

// 描いている途中の多角形（spec-4b-5a 確定事項13〜15）。頂点は紙の座標、近さとずらしは表示の px で見る。

const draft = globalThis.SigK.polygonDraft;

// 倍率 2、紙の高さ 800 の表示（y は下向き）。
const VIEW = {
  scale: 2,
  convertToViewportPoint: (x, y) => [x * 2, (800 - y) * 2],
  convertToPdfPoint: (x, y) => [x / 2, 800 - y / 2],
};

function begin(point = [100, 100]) {
  draft.cancel();
  draft.begin({ index: 0, src: 0, viewport: VIEW, point });
}

const place = (point, extra = {}) => draft.place({ index: 0, viewport: VIEW, point, ...extra });

test('begin で 1 つ目の頂点を紙の座標に置き、place で頂点を足す', () => {
  begin();
  assert.equal(draft.isActive(), true);
  assert.equal(draft.indexOf(), 0);
  assert.equal(place([200, 100]), 'added');
  assert.deepEqual(draft.previewOf(0).vertices, [[50, 750], [100, 750]]);
  assert.equal(draft.previewOf(1), null);
});

test('直前の頂点から 2px 以内は重なり、ほかのページは無視する', () => {
  begin();
  assert.equal(place([101, 101]), 'duplicate');
  assert.equal(draft.place({ index: 1, viewport: VIEW, point: [300, 300] }), 'ignored');
  assert.equal(draft.previewOf(0).vertices.length, 1);
});

test('3 つ以上置いたあとで始点から 12px 以内なら close。2 つまでは閉じずに足す', () => {
  begin();
  place([200, 100]);
  assert.equal(place([105, 105]), 'added', '2 つのときは始点の近くでも足す');
  begin();
  place([200, 100]);
  place([200, 200]);
  assert.equal(place([108, 106]), 'close');
  assert.equal(draft.previewOf(0).vertices.length, 3);
});

test('Shift で直前の頂点から 45° 刻みにそろえ、hover の下見も同じ', () => {
  begin([100, 100]);
  place([200, 105], { shift: true });
  assert.deepEqual(draft.previewOf(0).vertices[1].map((value) => Math.round(value)), [100, 750]);
  const last = draft.previewOf(0).vertices[1];
  draft.hover({ index: 0, viewport: VIEW, point: [300, 195], shift: true });
  const cursor = draft.previewOf(0).cursor;
  assert.ok(Math.abs((cursor[0] - last[0]) + (cursor[1] - last[1])) < 0.02, '右下 45°');
  assert.ok(cursor[0] - last[0] > 40);
  draft.hover({ index: 2, viewport: VIEW, point: [0, 0] });
  assert.equal(draft.previewOf(0).cursor, null);
});

test('finish は閉じるなら 3 つ以上、開いたままなら 2 つ以上を返し、小さすぎれば null。どれでも描きかけは終わる', () => {
  begin();
  place([200, 100]);
  assert.equal(draft.finish(true), null);
  assert.equal(draft.isActive(), false);
  begin();
  place([200, 100]);
  const open = draft.finish(false);
  assert.deepEqual(open, { index: 0, src: 0, closed: false, vertices: [[50, 750], [100, 750]] });
  begin();
  place([102.5, 100]);
  assert.equal(draft.finish(false), null, '外接が 3px 未満');
  assert.equal(draft.finish(false), null, '描いていなければ null');
});

test('svgOf は次の辺の点線・頂点の白い丸（始点は大きめ）・3 つ以上なら始点の輪を組む', () => {
  const { document } = new JSDOM('<svg></svg>').window;
  begin();
  place([200, 100]);
  place([200, 200]);
  draft.hover({ index: 0, viewport: VIEW, point: [150, 250] });
  const g = draft.svgOf(document, draft.previewOf(0), VIEW, { color: '#c00000', lineWidth: 2 });
  assert.equal(g.getAttribute('class'), 'annot-draft-marks');
  const next = g.querySelector('line.next');
  assert.equal(next.getAttribute('stroke'), '#c00000');
  assert.equal(next.getAttribute('stroke-dasharray'), '6 5');
  assert.equal(next.getAttribute('stroke-width'), '2');
  const vertices = [...g.querySelectorAll('circle.vertex')];
  assert.deepEqual(vertices.map((node) => node.getAttribute('r')), ['6.5', '4.5', '4.5']);
  assert.equal(g.querySelectorAll('circle.ring').length, 1);
  draft.cancel();
});
