'use strict';

// 注釈の辞書の欄を組む層（spec-4-1 確定事項22〜27、spec-4-2 確定事項25、spec-4-3 確定事項21、spec-4-4 確定事項23・24）。
// op-annotate.js から移した（spec-4b-1a 確定事項36）。書いた結果を読み直す確かめは op-annotate.test.js にあり、
// ここは移した関数が返す欄そのものを見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef, PDFNumber } = require('pdf-lib');
const { timestamp, shapeFields, noteFields, kindFields, popupDict } = require('../worker/annotation-fields.js');

const TOOLS = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
const NOW = new Date(2026, 8, 15, 12, 0, 0);

// /M の時差は実行環境の時間帯で変わる（手元は +09'00'、CI は UTC で +00'00'）ので、期待値は NOW から組む。
function zoneOf(date) {
  const offset = -date.getTimezoneOffset();
  const pad = (value) => String(Math.abs(value)).padStart(2, '0');
  return `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}'${pad(Math.abs(offset) % 60)}'`;
}

test('timestamp は PDF の日付の形（D:年月日時分秒と時差）にする', () => {
  assert.equal(timestamp(NOW), `D:20260915120000${zoneOf(NOW)}`);
  assert.match(timestamp(new Date(2026, 0, 2, 3, 4, 5)), /^D:20260102030405[+-]\d\d'\d\d'$/);
});

test('shapeFields は線の色・線幅・/Border を書き、直線と矢印には /Vertices、矢印には /LE、ペンには /InkList を足す', () => {
  const square = shapeFields({ rgb: [1, 0, 0], lineWidth: 3 }, TOOLS);
  assert.deepEqual(square.C, [1, 0, 0]);
  assert.deepEqual(square.BS, { W: 3, S: 'S' });
  assert.deepEqual(square.Border, [0, 0, 3]);
  assert.equal(square.Contents.asString(), '');
  assert.equal(square.Vertices, undefined);
  assert.equal(square.IC, undefined, '塗りは書かない（spec-4-3 確定事項21）');

  const line = shapeFields({ rgb: [0, 0, 1], lineWidth: 2, vertices: [1, 2, 3, 4], lineEndings: ['None', 'None'] }, TOOLS);
  assert.deepEqual(line.Vertices, [1, 2, 3, 4]);
  assert.equal(line.LE, undefined, '矢じりの無い直線は /LE を書かない');

  const arrow = shapeFields({ rgb: [0, 0, 1], lineWidth: 2, vertices: [1, 2, 3, 4], lineEndings: ['None', 'OpenArrow'] }, TOOLS);
  assert.deepEqual(arrow.LE.map(String), ['/None', '/OpenArrow']);

  const ink = shapeFields({ rgb: [0, 0, 0], lineWidth: 1, inkList: [[1, 2, 3, 4, 5, 6]] }, TOOLS);
  assert.deepEqual(ink.InkList, [[1, 2, 3, 4, 5, 6]]);
});

test('noteFields は本文・塗りの色・アイコン名・閉じたポップアップ・作成日時を書き、作成者は空なら書かない', () => {
  const withAuthor = noteFields({ text: 'メモ', author: '総務' }, { rgb: [1, 0.9, 0.4] }, TOOLS, NOW);
  assert.equal(withAuthor.Contents.decodeText(), 'メモ');
  assert.equal(withAuthor.T.decodeText(), '総務');
  assert.deepEqual(withAuthor.C, [1, 0.9, 0.4]);
  assert.equal(withAuthor.Name, 'Comment');
  assert.equal(withAuthor.Open, false);
  assert.equal(withAuthor.CreationDate.asString(), timestamp(NOW));

  const noAuthor = noteFields({ author: '' }, { rgb: [1, 1, 1] }, TOOLS, NOW);
  assert.equal(noAuthor.T, undefined);
  assert.equal(noAuthor.Contents.decodeText(), '', '本文が無ければ空で書く');
});

test('kindFields はマークアップ・テキスト・図形・ノートで欄を分ける', () => {
  const markup = kindFields({ kind: 'underline', quads: [[1, 2, 3, 4, 5, 6, 7, 8]] }, { rgb: [0, 0, 0] }, TOOLS, NOW);
  assert.deepEqual(markup.QuadPoints, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(markup.C, [0, 0, 0]);

  // テキストは /C を書かない（箱の背景色に使うビューアがあるため。spec-4-2 確定事項25）。回転は 0 以外のときだけ。
  const text = kindFields({ kind: 'text', text: '一行目', rotation: 0 }, { da: '/SigKJP 12 Tf 0 0 0 rg' }, TOOLS, NOW);
  assert.equal(text.Contents.decodeText(), '一行目');
  assert.equal(text.DA.asString(), '/SigKJP 12 Tf 0 0 0 rg');
  assert.deepEqual(text.Border, [0, 0, 0]);
  assert.equal(text.C, undefined);
  assert.equal(text.Rotate, undefined);
  assert.equal(kindFields({ kind: 'text', text: 'a', rotation: 90 }, { da: '' }, TOOLS, NOW).Rotate, 90);

  assert.deepEqual(kindFields({ kind: 'circle' }, { rgb: [0, 1, 0], lineWidth: 5 }, TOOLS, NOW).BS, { W: 5, S: 'S' });
  assert.equal(kindFields({ kind: 'note', text: '', author: '' }, { rgb: [1, 1, 0] }, TOOLS, NOW).Name, 'Comment');
});

test('popupDict は親を指す閉じたポップアップを、印刷・拡大しない・回さないの印（/F 28）で作る', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const parent = doc.context.register(doc.context.obj({}));
  const popup = popupDict(doc.context, page, parent, [120, 600, 300, 700]);
  assert.equal(String(popup.get(PDFName.of('Subtype'))), '/Popup');
  assert.equal(popup.get(PDFName.of('Parent')), parent);
  assert.equal(popup.get(PDFName.of('P')), page.ref);
  assert.equal(popup.get(PDFName.of('F')).asNumber(), 28);
  assert.deepEqual(popup.get(PDFName.of('Rect')).asArray().map((value) => value instanceof PDFNumber && value.asNumber()), [120, 600, 300, 700]);
  assert.equal(String(popup.get(PDFName.of('Open'))), 'false');
});
