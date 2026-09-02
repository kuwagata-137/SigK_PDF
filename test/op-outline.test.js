'use strict';

// しおりと名前付き宛先の整合を取る層のテスト（spec-1-6 確定事項81〜84）。
//
// pdf-lib にしおりの API は無いので、catalog へ直に置いた種を作って試す。
// 並べ替えだけなら飛び先はページを追いかけるので、削除したときだけが対象である。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFName, PDFString, PDFHexString } = require('pdf-lib');
const { livePageKeys, destinationIndex, pruneDestinations } = require('../worker/op-outline.js');
const { applyPlan } = require('../worker/op-pages.js');

const TOOLS = { PDFName };

async function makeDoc(pageCount) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1)
    doc.addPage([200, 200]);
  return doc;
}

// items は [見出し, 指すページ index] の並び。子を持たせたいときは children を渡す。
function addOutline(doc, items) {
  const context = doc.context;
  const pages = doc.getPages();
  const refs = items.map(([title, pageIndex]) => {
    const entry = { Title: PDFHexString.fromText(title) };
    if (pageIndex !== null)
      entry.Dest = [pages[pageIndex].ref, PDFName.of('Fit')];
    return context.register(context.obj(entry));
  });
  for (let index = 0; index < refs.length; index += 1) {
    const item = context.lookup(refs[index]);
    if (index > 0) item.set(PDFName.of('Prev'), refs[index - 1]);
    if (index + 1 < refs.length) item.set(PDFName.of('Next'), refs[index + 1]);
  }
  const outlines = context.obj({
    Type: PDFName.of('Outlines'),
    First: refs[0],
    Last: refs[refs.length - 1],
    Count: refs.length,
  });
  doc.catalog.set(PDFName.of('Outlines'), context.register(outlines));
  return refs;
}

function addNamedDests(doc, entries) {
  const context = doc.context;
  const pages = doc.getPages();
  const names = [];
  for (const [label, pageIndex] of entries) {
    names.push(PDFString.of(label));
    names.push(context.obj([pages[pageIndex].ref, PDFName.of('Fit')]));
  }
  doc.catalog.set(PDFName.of('Names'), context.obj({ Dests: context.register(context.obj({ Names: names })) }));
}

function outlineItems(doc) {
  const context = doc.context;
  const out = [];
  let cursor = context.lookup(doc.catalog.get(PDFName.of('Outlines')))?.get(PDFName.of('First'));
  while (cursor !== undefined) {
    const item = context.lookup(cursor);
    if (item === undefined || item === null)
      break;
    out.push({
      title: item.get(PDFName.of('Title'))?.decodeText(),
      hasDest: item.get(PDFName.of('Dest')) !== undefined,
      hasAction: item.get(PDFName.of('A')) !== undefined,
    });
    cursor = item.get(PDFName.of('Next'));
  }
  return out;
}

test('ページ木にあるページの参照を集められる', async () => {
  const doc = await makeDoc(3);
  const keys = livePageKeys(doc);
  assert.equal(keys.size, 3);
  assert.equal(keys.has(String(doc.getPage(1).ref)), true);
});

test('しおりを持たない文書では何もしない', async () => {
  const doc = await makeDoc(3);
  assert.deepEqual(pruneDestinations(doc, TOOLS), { outlines: 0, names: 0 });
});

test('並べ替えただけなら、しおりの飛び先はそのまま残る', async () => {
  const doc = await makeDoc(4);
  addOutline(doc, [['1ページ目へ', 0], ['3ページ目へ', 2]]);
  assert.equal(applyPlan(doc, [{ src: 3 }, { src: 2 }, { src: 1 }, { src: 0 }]).ok, true);

  const result = pruneDestinations(doc, TOOLS);
  assert.deepEqual(result, { outlines: 0, names: 0 }, '削っていない');
  assert.deepEqual(outlineItems(doc).map((item) => item.hasDest), [true, true]);
});

test('削除したページを指すしおりは飛び先だけ落ちる', async () => {
  const doc = await makeDoc(4);
  addOutline(doc, [['1ページ目へ', 0], ['3ページ目へ', 2]]);
  // 3ページ目（index 2）を落とす。
  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }, { src: 3 }]).ok, true);

  const result = pruneDestinations(doc, TOOLS);
  assert.equal(result.outlines, 1);
  const items = outlineItems(doc);
  assert.deepEqual(items.map((item) => item.title), ['1ページ目へ', '3ページ目へ'], '見出しは残す');
  assert.deepEqual(items.map((item) => item.hasDest), [true, false]);
});

test('/A の GoTo で飛ぶしおりも同じ扱いになる', async () => {
  const doc = await makeDoc(3);
  const context = doc.context;
  const pages = doc.getPages();
  const item = context.register(context.obj({
    Title: PDFHexString.fromText('3ページ目へ'),
    A: context.obj({ S: PDFName.of('GoTo'), D: context.obj([pages[2].ref, PDFName.of('Fit')]) }),
  }));
  doc.catalog.set(PDFName.of('Outlines'), context.register(context.obj({
    Type: PDFName.of('Outlines'), First: item, Last: item, Count: 1,
  })));

  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);
  assert.equal(pruneDestinations(doc, TOOLS).outlines, 1);
  assert.equal(outlineItems(doc)[0].hasAction, false);
  assert.equal(outlineItems(doc)[0].title, '3ページ目へ');
});

test('名前で飛ぶしおりも、名前付き宛先を引いて判定する', async () => {
  const doc = await makeDoc(4);
  addNamedDests(doc, [['chapter3', 2], ['chapter1', 0]]);
  const context = doc.context;
  const refs = [
    context.register(context.obj({ Title: PDFHexString.fromText('第3章'), Dest: PDFString.of('chapter3') })),
    context.register(context.obj({ Title: PDFHexString.fromText('第1章'), Dest: PDFString.of('chapter1') })),
  ];
  context.lookup(refs[0]).set(PDFName.of('Next'), refs[1]);
  doc.catalog.set(PDFName.of('Outlines'), context.register(context.obj({
    Type: PDFName.of('Outlines'), First: refs[0], Last: refs[1], Count: 2,
  })));

  // 索引が引けていることを先に確かめる。
  assert.equal(destinationIndex(doc).size, 2);

  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);   // 3ページ目を落とす
  const result = pruneDestinations(doc, TOOLS);
  assert.equal(result.outlines, 1, '第3章のしおりだけ飛び先を失う');
  assert.equal(result.names, 1, '名前付き宛先も1件外れる');
  assert.deepEqual(outlineItems(doc).map((item) => item.hasDest), [false, true]);
});

test('生きている名前付き宛先は残る', async () => {
  const doc = await makeDoc(3);
  addNamedDests(doc, [['a', 0], ['b', 1], ['c', 2]]);
  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);

  assert.equal(pruneDestinations(doc, TOOLS).names, 1);
  const index = destinationIndex(doc);
  assert.deepEqual([...index.keys()].sort(), ['a', 'b']);
});

test('子を持つしおりも辿る', async () => {
  const doc = await makeDoc(3);
  const context = doc.context;
  const pages = doc.getPages();
  const child = context.register(context.obj({
    Title: PDFHexString.fromText('子'), Dest: [pages[2].ref, PDFName.of('Fit')],
  }));
  const parent = context.register(context.obj({
    Title: PDFHexString.fromText('親'), Dest: [pages[0].ref, PDFName.of('Fit')], First: child, Last: child, Count: 1,
  }));
  context.lookup(child).set(PDFName.of('Parent'), parent);
  doc.catalog.set(PDFName.of('Outlines'), context.register(context.obj({
    Type: PDFName.of('Outlines'), First: parent, Last: parent, Count: 1,
  })));

  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);
  assert.equal(pruneDestinations(doc, TOOLS).outlines, 1, '子の飛び先だけ落ちる');
  assert.equal(context.lookup(child).get(PDFName.of('Dest')), undefined);
  assert.notEqual(context.lookup(parent).get(PDFName.of('Dest')), undefined);
});

test('保存して読み直しても、落とした飛び先は戻らない', async () => {
  const doc = await makeDoc(3);
  addOutline(doc, [['3ページ目へ', 2]]);
  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);
  pruneDestinations(doc, TOOLS);

  const bytes = await doc.save({ addDefaultPage: false });
  const reopened = await PDFDocument.load(bytes, { updateMetadata: false });
  const items = outlineItems(reopened);
  assert.equal(items.length, 1);
  assert.equal(items[0].hasDest, false);
  assert.equal(items[0].title, '3ページ目へ');
});

// --- ここから下は「触ってはいけないもの」の回帰テスト ---
//
// 実装当初、飛び先を解決できなかったしおりを一律で削っていた。その結果、
// ページの削除とは何の関係もない「URL を開くしおり」「別ファイルへ飛ぶしおり」
// までが壊れていた（2026-09-01 の見直しで発見）。
// 鉄則は「消えたページを指していると**確かめられたもの**だけを消す」である。

function setSingleOutline(doc, entry) {
  const context = doc.context;
  const ref = context.register(context.obj(entry));
  doc.catalog.set(PDFName.of('Outlines'), context.register(context.obj({
    Type: PDFName.of('Outlines'), First: ref, Last: ref, Count: 1,
  })));
  return ref;
}

test('URL を開くしおりには触らない', async () => {
  const doc = await makeDoc(3);
  const context = doc.context;
  const ref = setSingleOutline(doc, {
    Title: PDFHexString.fromText('ウェブサイトへ'),
    A: context.obj({ S: PDFName.of('URI'), URI: PDFString.of('https://example.com') }),
  });
  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);

  assert.equal(pruneDestinations(doc, TOOLS).outlines, 0);
  assert.notEqual(context.lookup(ref).get(PDFName.of('A')), undefined);
});

test('別のファイルへ飛ぶしおり（GoToR）には触らない', async () => {
  const doc = await makeDoc(3);
  const context = doc.context;
  const ref = setSingleOutline(doc, {
    Title: PDFHexString.fromText('別の PDF へ'),
    A: context.obj({
      S: PDFName.of('GoToR'),
      F: PDFString.of('other.pdf'),
      D: context.obj([0, PDFName.of('Fit')]),
    }),
  });
  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);

  assert.equal(pruneDestinations(doc, TOOLS).outlines, 0);
  assert.notEqual(context.lookup(ref).get(PDFName.of('A')), undefined);
});

test('解決できない名前を指すしおりには触らない', async () => {
  const doc = await makeDoc(3);
  const context = doc.context;
  const ref = setSingleOutline(doc, {
    Title: PDFHexString.fromText('謎の宛先'),
    Dest: PDFString.of('unknown-name'),
  });
  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);

  assert.equal(pruneDestinations(doc, TOOLS).outlines, 0);
  assert.notEqual(context.lookup(ref).get(PDFName.of('Dest')), undefined);
});

test('ページ番号で指す宛先には触らない', async () => {
  // 参照ではなく番号で指す形。生きているかどうかを判定できないので放っておく。
  const doc = await makeDoc(3);
  const context = doc.context;
  const ref = setSingleOutline(doc, {
    Title: PDFHexString.fromText('番号で指す'),
    Dest: context.obj([1, PDFName.of('Fit')]),
  });
  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);

  assert.equal(pruneDestinations(doc, TOOLS).outlines, 0);
  assert.notEqual(context.lookup(ref).get(PDFName.of('Dest')), undefined);
});

test('解決できない名前付き宛先は残す', async () => {
  const doc = await makeDoc(3);
  const context = doc.context;
  // 値がページ参照でない（番号で指す）名前付き宛先。
  doc.catalog.set(PDFName.of('Names'), context.obj({
    Dests: context.register(context.obj({
      Names: [PDFString.of('numeric'), context.obj([2, PDFName.of('Fit')])],
    })),
  }));
  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);

  assert.equal(pruneDestinations(doc, TOOLS).names, 0, '判定できないものは外さない');
});

test('GoTo で飛ぶが宛先が生きていればそのまま', async () => {
  const doc = await makeDoc(3);
  const context = doc.context;
  const ref = setSingleOutline(doc, {
    Title: PDFHexString.fromText('1ページ目へ'),
    A: context.obj({ S: PDFName.of('GoTo'), D: context.obj([doc.getPage(0).ref, PDFName.of('Fit')]) }),
  });
  assert.equal(applyPlan(doc, [{ src: 0 }, { src: 1 }]).ok, true);

  assert.equal(pruneDestinations(doc, TOOLS).outlines, 0);
  assert.notEqual(context.lookup(ref).get(PDFName.of('A')), undefined);
});
