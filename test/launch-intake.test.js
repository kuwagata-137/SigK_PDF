'use strict';

// 右クリックの束を一覧へ入れるときの決まり（spec-5-1 確定事項15〜18）。
//
// DOM に触れない純関数である。結合・画像→PDF の画面が実際に使う形は、
// test/tools-merge.test.js・test/tools-convert.test.js・test/launch.test.js が見ている。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/launch-intake.js');

const intake = globalThis.SigK.launchIntake;
const DIR = 'C:\\work';
const at = (name) => `${DIR}\\${name}`;

test('注記の文言は論点2 のとおり', () => {
  assert.equal(intake.NOTE_NAME_ORDER,
    'ファイル名の順に並べました。エクスプローラーの並びと違うときは、ドラッグで入れ替えてください。');
});

test('名前は数字を数の大きさで比べる（2 は 10 より前）', () => {
  const names = ['p10.pdf', 'p2.pdf', 'p1.pdf', 'p20.pdf'].map(at);
  assert.deepEqual([...names].sort(intake.compareNames), ['p1.pdf', 'p2.pdf', 'p10.pdf', 'p20.pdf'].map(at));
});

test('大文字と小文字、全角と半角は区別せずに並べる', () => {
  assert.equal(intake.compareNames(at('B.pdf'), at('a.pdf')) > 0, true);
  assert.equal(intake.compareNames(at('ｂ.pdf'), at('A.pdf')) > 0, true);
  assert.deepEqual(['見積 2.pdf', '見積 10.pdf', '契約.pdf'].map(at).sort(intake.compareNames).map((p) => p.split('\\').pop()),
    ['契約.pdf', '見積 2.pdf', '見積 10.pdf']);
});

test('比べるのはファイル名で、同じ名前ならフォルダーを含めたパスで決める', () => {
  const b = 'C:\\a\\b.pdf';
  const a = 'C:\\z\\a.pdf';
  assert.equal(intake.compareNames(a, b) < 0, true, 'フォルダーより名前が先');
  assert.equal(intake.compareNames('C:\\z\\a.pdf', 'C:\\y\\a.pdf') > 0, true);
  assert.equal(intake.compareNames(at('a.pdf'), at('a.pdf')), 0);
});

test('束の行は、同じ束の行の中で名前の順の位置へ入る', () => {
  const rows = [
    { path: at('old.pdf'), batch: null },
    { path: at('b.pdf'), batch: 7 },
    { path: at('d.pdf'), batch: 7 },
  ];
  assert.equal(intake.insertAt(rows, 7, at('a.pdf')), 1, '束の先頭の前');
  assert.equal(intake.insertAt(rows, 7, at('c.pdf')), 2, '束の間');
  assert.equal(intake.insertAt(rows, 7, at('e.pdf')), 3, '束の最後の後ろ');
});

test('束の行が無ければ一覧の末尾へ入る。ほかの束の行は見ない', () => {
  const rows = [
    { path: at('z.pdf'), batch: 3 },
    { path: at('y.pdf'), batch: null },
  ];
  assert.equal(intake.insertAt(rows, 8, at('a.pdf')), 2);
  assert.equal(intake.insertAt([], 8, at('a.pdf')), 0);
});

test('ユーザーが束の中を並べ替えていても、今の並びの中で入る位置が決まる', () => {
  // d・b の順に入れ替えられた束へ c が届いた。名前が後ろになる最初の行（d）の前。
  const rows = [{ path: at('d.pdf'), batch: 1 }, { path: at('b.pdf'), batch: 1 }];
  assert.equal(intake.insertAt(rows, 1, at('c.pdf')), 0);
});

test('実行済みの一覧は置き換え、そうでなければ後ろに足す（論点3）', () => {
  assert.equal(intake.planIntake({ count: 0, executed: false }), 'append');
  assert.equal(intake.planIntake({ count: 0, executed: true }), 'append', '空なら足すだけ');
  assert.equal(intake.planIntake({ count: 3, executed: false }), 'append');
  assert.equal(intake.planIntake({ count: 3, executed: true }), 'replace');
});

test('束の控え: 最初の要求で始まり、帯は束につき 1 回', () => {
  const tracker = intake.createBatchTracker();

  assert.deepEqual({ ...tracker.enter({ id: 1, first: true }) }, { id: 1, starts: true });
  assert.equal(tracker.once('note'), true);
  assert.equal(tracker.once('note'), false, '同じ束では 2 回目を出さない');
  assert.deepEqual({ ...tracker.enter({ id: 1, first: false }) }, { id: 1, starts: false });
  assert.equal(tracker.once('note'), false);
  assert.equal(tracker.once('limit'), true, '帯の種類ごとに 1 回');

  assert.deepEqual({ ...tracker.enter({ id: 2, first: true }) }, { id: 2, starts: true });
  assert.equal(tracker.once('note'), true, '次の束ではまた出す');
});

test('束の控え: 印の無い呼び出しは 1 件だけの新しい束、知らない束の途中は始まりとみなす', () => {
  const tracker = intake.createBatchTracker();

  const solo = tracker.enter(undefined);
  assert.equal(solo.starts, true);
  const again = tracker.enter(null);
  assert.equal(again.starts, true);
  assert.notEqual(again.id, solo.id, '印の無い呼び出しどうしは同じ束にならない');

  assert.deepEqual({ ...tracker.enter({ id: 5, first: false }) }, { id: 5, starts: true });
});
