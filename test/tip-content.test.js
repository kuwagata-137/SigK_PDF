'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 説明の吹き出しの文の表（spec-2-5 J1・J2・J5・J14。tip-content*.js）。DOM に触れないデータだけなので、require だけで試す。
// 読み込み順は 入れ物 → 閲覧 → 編集 → ツール。node は要素の代わりの { dataset } だけの小さな物。
require('../renderer/tip-content.js');
require('../renderer/tip-content-view.js');
require('../renderer/tip-content-edit.js');
require('../renderer/tip-content-tools.js');

const { tipContent } = globalThis.SigK;
const node = (key, extra = {}) => ({ dataset: { tip: key, ...extra } });
// 文の表の鍵。組み込みの text と、テストの中で足した鍵（test. で始める）は除く（テストの順が変わっても、鍵の集合が揺れないため）。
const tableKeys = () => tipContent.keyList().filter((k) => k !== 'text' && !k.startsWith('test.'));
// SigK.viewer を getState だけの物に差し替えて、ツールバーの［上書き保存］の文を引く（終わったら外す）。
const barSaveWith = (state) => {
  globalThis.SigK.viewer = { getState: () => state };
  try { return tipContent.resolve(node('bar.save')); } finally { delete globalThis.SigK.viewer; }
};

const EXPECTED_KEYS = [
  'bar.open', 'bar.save', 'bar.saveAs', 'bar.undo', 'bar.redo', 'bar.pointerSelect', 'bar.pointerHand', 'bar.pagePrev', 'bar.pageNext',
  'bar.zoomOut', 'bar.zoomIn', 'bar.fitWidth', 'bar.fitPage', 'bar.facing', 'bar.find', 'bar.print', 'bar.settings', 'bar.help',
  'mode.view', 'mode.pages', 'mode.annot', 'mode.tools', 'tab.add', 'tab.close', 'tab.dirty', 'side.collapse', 'side.expand',
  'find.case', 'find.prev', 'find.next', 'find.close', 'status.file', 'dialog.close', 'zoom.close', 'zoom.prev', 'zoom.next',
  'edit.select', 'edit.hand', 'edit.highlight', 'edit.underline', 'edit.strikeout', 'edit.text', 'edit.callout',
  'edit.arrow', 'edit.line', 'edit.square', 'edit.circle', 'edit.cross', 'edit.polygon', 'edit.pen', 'edit.marker', 'edit.eraser',
  'edit.note', 'edit.mosaic', 'edit.trim', 'edit.more', 'format.bold', 'format.italic', 'style.solid', 'style.dashed', 'style.cloudy',
  'tools.merge', 'tools.split', 'tools.convert', 'tools.toImage', 'tools.watermark', 'tools.flatten',
  'strip.up', 'strip.down', 'strip.save', 'strip.saveAs', 'strip.close', 'image.clear', 'image.remove',
  'split.cut', 'split.undo', 'split.redo', 'pages.rotateLeft', 'pages.rotateRight', 'pages.extract', 'pages.insert', 'pages.delete',
  'thumb.rotateLeft', 'thumb.rotateRight', 'thumb.delete',
];

// 歯車のボタン（bar.settings）は spec-6-1 タスク E で足した。
test('文の表の鍵が、計画の表の 84 個と歯車のボタンの 1 個と過不足なく一致する（組み込みの text を除く）', () => {
  assert.deepEqual([...tableKeys()].sort(), [...EXPECTED_KEYS].sort());
  assert.equal(EXPECTED_KEYS.length, 85);
});
test('どの鍵にも名前と説明があり、説明は「。」で終わる 100 字以内の文', () => {
  for (const key of tableKeys()) {
    const entry = tipContent.resolve(node(key, { tipFile: 'a.pdf' }));
    assert.ok(entry.name.length > 0 && entry.name.length <= 20, key);
    assert.match(entry.desc, /。$/, key);
    assert.ok(entry.desc.length <= 100, key);
    assert.ok((entry.keys ?? []).every((k) => typeof k === 'string' && k.length > 0), key);
  }
});
test('キーの書き方: 「／」は配列、（）は keysNote、「—」は keys を持たない', () => {
  assert.deepEqual(tipContent.resolve(node('bar.open')), {
    name: '開く', desc: 'PDF を選んで、タブで開きます。窓へ PDF を落としても開けます。', keys: ['Ctrl+O'],
  });
  assert.deepEqual(tipContent.resolve(node('bar.redo')).keys, ['Ctrl+Y', 'Ctrl+Shift+Z']);
  assert.deepEqual(tipContent.resolve(node('find.prev')).keys, ['Shift+F3', 'Shift+Enter']);
  assert.deepEqual(tipContent.resolve(node('find.next')).keys, ['F3', 'Enter']);
  const close = tipContent.resolve(node('tab.close'));
  assert.deepEqual([close.keys, close.keysNote], [['Ctrl+W'], '選んでいるタブ']);
  assert.equal('keys' in tipContent.resolve(node('mode.view')), false);
  assert.equal('keys' in tipContent.resolve(node('edit.pen')), false);
  assert.equal('keysNote' in tipContent.resolve(node('bar.open')), false);
});
test('［元に戻す］と［拡大］の説明の文は、直した文のまま（「ツールモード」を続けない・2 文に収める）', () => {
  assert.equal(tipContent.resolve(node('bar.undo')).desc,
    '直前の変更を取り消して、1 つ前の状態に戻します。ツールモードでは、ページを引いて動かす・写す・分割の ✂ を、した順に戻します。');
  assert.equal(tipContent.resolve(node('bar.zoomIn')).desc,
    '表示を 1 段大きくします。いちばん大きいのは 400% で、Ctrl+0 で 100% に戻ります。');
});
test('左のパネルの「＜」の説明は、開き直す「＞」の場所を「閉じたパネルの細い欄」と呼ぶ（docs/04 第3章の呼び名。PR-5 の点検の直し）', () => {
  assert.equal(tipContent.resolve(node('side.collapse')).desc,
    '左のパネルを閉じて、ページの表示を広げます。閉じている間は、閉じたパネルの細い欄の「＞」で開きます。');
});
test('帯のフロッピーの文は、帯のファイル名を入れた見本の文', () => {
  assert.deepEqual(tipContent.resolve(node('strip.save', { tipFile: '会議資料.pdf' })), { name: '上書き保存',
    desc: 'この帯のファイル（会議資料.pdf）に、今の変更を書き込みます。元の中身は「会議資料.pdf.bak」として残ります。', keys: ['Ctrl+S'], keysNote: '選んでいる帯' });
});
test('帯のフロッピーは、ファイル名が空・無いときは「（）」を出さず、ファイル名を抜いた文にする', () => {
  const noName = { name: '上書き保存', desc: 'この帯のファイルに、今の変更を書き込みます。元の中身は「名前.pdf.bak」として残ります。',
    keys: ['Ctrl+S'], keysNote: '選んでいる帯' };
  assert.deepEqual(tipContent.resolve(node('strip.save')), noName);
  assert.deepEqual(tipContent.resolve(node('strip.save', { tipFile: '' })), noName);
});
test('名前の無い帯のフロッピーは、見本の文のまま', () => {
  assert.deepEqual(tipContent.resolve(node('strip.saveAs')), { name: '名前を付けて保存',
    desc: 'この帯はまだファイルになっていません。保存先と名前を決めて、PDF のファイルにします。', keys: ['Ctrl+Shift+S'], keysNote: '選んでいる帯' });
});
test('ツールバーの［上書き保存］は、名前の無い帯（新しい帯）を映しているときだけ文を替える', () => {
  const named = { name: '上書き保存', desc: '開いているファイルに、今の変更を書き込みます。元の中身は「名前.pdf.bak」として残ります。', keys: ['Ctrl+S'] };
  const untitled = { name: '上書き保存', desc: 'このファイルはまだ保存先が決まっていないので、保存先と名前を聞いてから PDF のファイルにします。', keys: ['Ctrl+S'] };
  assert.deepEqual(tipContent.resolve(node('bar.save')), named); // SigK.viewer が無いときは名前のある方
  assert.deepEqual(barSaveWith({ file: { untitled: true } }), untitled);
  assert.deepEqual(barSaveWith({ file: { untitled: false } }), named);
  assert.deepEqual(barSaveWith({ file: null }), named);
  assert.deepEqual(barSaveWith({}), named);
});
// 点検の直し I-4。設定の窓で「上書き保存の前に、元のファイルの控えのファイルを作る」を外していたら、.bak が残るとは言わない。
test('設定の窓で控えのファイルを外していたら、ツールバーの［上書き保存］と帯のフロッピーは「作りません」の文にする', () => {
  globalThis.SigK.preferences = { current: () => ({ makeBackup: false }) };
  try {
    assert.equal(tipContent.resolve(node('bar.save')).desc,
      '開いているファイルに、今の変更を書き込みます。設定の窓で外しているので、控えのファイル（名前.pdf.bak）は作りません。');
    assert.equal(tipContent.resolve(node('strip.save', { tipFile: '会議資料.pdf' })).desc,
      'この帯のファイル（会議資料.pdf）に、今の変更を書き込みます。設定の窓で外しているので、控えのファイル（会議資料.pdf.bak）は作りません。');
    assert.equal(barSaveWith({ file: { untitled: true } }).desc, 'このファイルはまだ保存先が決まっていないので、保存先と名前を聞いてから PDF のファイルにします。');
  } finally {
    delete globalThis.SigK.preferences;
  }
});

test('呼び手が表の文を書き換えられない（Entry と keys の配列が凍っている。bar.save の 2 つの文・関数の値・text も）', () => {
  const textNode = { dataset: {} };
  tipContent.text(textNode, 'a.pdf', 'C:\\x\\a.pdf');
  const entries = tableKeys().map((key) => tipContent.resolve(node(key, { tipFile: 'a.pdf' })));
  entries.push(barSaveWith({ file: { untitled: true } }), barSaveWith({ file: { untitled: false } }),
    tipContent.resolve(node('strip.save')), tipContent.resolve(textNode));
  for (const entry of entries) {
    assert.ok(Object.isFrozen(entry), entry.name);
    assert.ok(entry.keys === undefined || Object.isFrozen(entry.keys), entry.name);
  }
  const open = tipContent.resolve(node('bar.open'));
  assert.throws(() => { open.name = '書き換え'; }, TypeError);
  assert.throws(() => { open.keys.push('Ctrl+Q'); }, TypeError);
  assert.deepEqual(tipContent.resolve(node('bar.open')).keys, ['Ctrl+O']); // 書き換えは通らなかった
});
test('text() は鍵と名前と説明を付け、説明が空なら説明の欄を消す。resolve はそれを出す', () => {
  const n = { dataset: {} };
  assert.equal(tipContent.text(n, 'a.pdf', 'C:\\x\\a.pdf'), n);
  assert.equal(n.dataset.tip, 'text');
  assert.deepEqual(tipContent.resolve(n), { name: 'a.pdf', desc: 'C:\\x\\a.pdf' });
  tipContent.text(n, 'b.pdf');
  assert.equal('tipDesc' in n.dataset, false);
  assert.deepEqual(tipContent.resolve(n), { name: 'b.pdf', desc: '' });
});

test('clear() は鍵と名前と説明をまとめて消し、node を返す。消したあとは resolve が null', () => {
  const n = { dataset: { other: 'x' } };
  tipContent.text(n, 'a.pdf', 'C:\\x\\a.pdf');
  assert.equal(tipContent.clear(n), n);
  assert.deepEqual(n.dataset, { other: 'x' }, '説明の吹き出しのものだけを消す');
  assert.equal(tipContent.resolve(n), null);
  assert.equal(tipContent.clear(n), n, '付いていなくても投げない');
  n.dataset.tip = 'bar.open';
  tipContent.clear(n);
  assert.equal('tip' in n.dataset, false, '文の表の鍵も消す');
});
test('知らない鍵・鍵の無い要素は null。同じ鍵を 2 度足すと投げる', () => {
  assert.equal(tipContent.resolve(node('nope')), null);
  assert.equal(tipContent.resolve({ dataset: {} }), null);
  assert.equal(tipContent.resolve(null), null);
  assert.throws(() => tipContent.add({ 'bar.open': { name: 'x' } }), Error);
  assert.throws(() => tipContent.add({ 'text': { name: 'x' } }), Error);
  assert.equal(tipContent.resolve(node('bar.open')).name, '開く'); // 投げても、元の文は変わらない
});
test('add は重なる鍵を見つけたら 1 つも足さない（新しい鍵が先にあっても引けない）', () => {
  assert.throws(() => tipContent.add({ 'test.atomic': { name: '新しい', desc: '足さない。' }, 'bar.open': { name: '重なり' } }), /bar\.open/);
  assert.equal(tipContent.resolve(node('test.atomic')), null);
  assert.equal(tipContent.keyList().includes('test.atomic'), false);
  assert.equal(tipContent.resolve(node('bar.open')).name, '開く');
});
test('文に「注釈」（「注釈一覧」を除く）と「ツールチップ」を使わない', () => {
  const all = tableKeys().map((key) => {
    const e = tipContent.resolve(node(key, { tipFile: 'a.pdf' }));
    return `${e.name}\n${e.desc}\n${e.keysNote ?? ''}`;
  }).join('\n');
  assert.equal(all.replaceAll('注釈一覧', '').includes('注釈'), false);
  assert.equal(all.includes('ツールチップ'), false);
});
test('足した鍵は引ける。関数の値は、出す瞬間に要素を渡して呼ぶ', () => {
  tipContent.add({ 'test.fn': (n) => ({ name: n.dataset.tipFile, desc: '試し。' }) });
  assert.deepEqual(tipContent.resolve(node('test.fn', { tipFile: 'z.pdf' })), { name: 'z.pdf', desc: '試し。' });
  assert.ok(tipContent.keyList().includes('test.fn'));
});
