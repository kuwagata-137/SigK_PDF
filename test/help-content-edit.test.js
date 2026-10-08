'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/help-content-edit.js');
const { SECTIONS } = globalThis.SigK.helpContentEdit;

// 使い方の窓の中身のうち、編集モードの 7 節（spec-4b-7b 確定事項D・付録）。目次の並び・キーの書き方は help-content.test.js が全部の節で見る。

function joined(id) {
  const section = SECTIONS.find((each) => each.id === id);
  const texts = [section.title, section.lead ?? ''];
  for (const block of section.blocks)
    texts.push(block.h ?? '', ...(block.items ?? []), ...(block.table ?? []).flat());
  return texts.join('\n');
}

test('編集モードの 7 節は、どれも「編集（書き込み）」のグループ', () => {
  assert.deepEqual(SECTIONS.map((section) => section.id), ['select', 'markup', 'text', 'shapes', 'pen', 'note', 'mosaic-trim']);
  assert.ok(SECTIONS.every((section) => section.group === 'annot'));
});

test('図形の節は、描くときと、あとで端を動かすときの Shift を書き分ける（決定50 ④・確定事項D4）', () => {
  const text = joined('shapes');
  assert.match(text, /四角・丸・×印は、正方形・正円になります/);
  assert.match(text, /直線・矢印と、多角形の次の辺は、45° 刻みの向きになります/);
  assert.match(text, /端が押した所から横か縦にだけ動きます（描くときの 45° 刻みとは違います）/);
  // 線そのものが水平・垂直にそろう、とは書かない。
  assert.doesNotMatch(text, /水平・垂直になります/);
});

test('右パネルのヒントの直し（確定事項F）と同じ言い方で書く', () => {
  // 消しゴムで消えないもの。
  assert.match(joined('pen'), /テキスト・吹き出し・ノート・ハイライト・下線・取り消し線と、他のアプリで付けた書き込みは消えません/);
  // 吹き出しのしっぽの Shift は、本体の向きにそろう。
  assert.match(joined('text'), /\[Shift\] で本体の向きに水平か垂直/);
  // 右クリックはメニューを出す（すぐには消えない）。
  assert.match(joined('select'), /右クリックすると出るメニューの「削除」でも消せます/);
});

test('Ctrl＋クリックが効かない道具を書く（spec-4b-3a B3 の直し）', () => {
  assert.match(joined('select'), /ハンド・消しゴム・モザイク・トリミングを持っているときは効きません/);
});

test('トリミングは段から持っても Enter で切れる（計画外の直し③）と、Esc の 2 段を書く', () => {
  const text = joined('mosaic-trim');
  assert.match(text, /\[Enter\] か右パネルの［適用］で切ります/);
  assert.match(text, /引いている途中なら引く前の枠に戻り、次の \[Esc\] で枠を消します/);
});
