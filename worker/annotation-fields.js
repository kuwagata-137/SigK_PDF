'use strict';

// 注釈の辞書の欄を組む純粋層（spec-4-1 確定事項22〜27、spec-4-2 確定事項25、spec-4-3 確定事項21、spec-4-4 確定事項23・24）。
// op-annotate.js から移した（spec-4b-1a 確定事項36。中身は変えていない）。pdf-lib のクラスは tools で受け、
// 外観（content stream）は annotation-appearance.js などが組む。

const { KINDS: SHAPE_KINDS } = require('./shape-appearance.js');

function timestamp(now) {
  const pad = (value) => String(value).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `D:${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${sign}${hours}'${minutes}'`;
}

// 図形・ペンの欄（spec-4-3 確定事項21、spec-4b-1b 確定事項32〜34）。線の色 /C は線があるときだけ、塗り /IC は塗りが
// あるときだけ書く。線幅は /BS /W と /Border に選んだ太さを書き（線なしでも。/C が無ければ枠は透明で、開き直したときに
// 太さが戻る）、破線は /BS /S /D と /D に間隔を書く。雲形は /BE（と描けたときは /RD）。直線・矢印は /Vertices（と矢印の
// /LE）、ペンは /InkList。
function shapeFields(appearance, { PDFName, PDFString }) {
  const fields = {
    BS: appearance.dash ? { W: appearance.lineWidth, S: 'D', D: appearance.dash } : { W: appearance.lineWidth, S: 'S' },
    Border: [0, 0, appearance.lineWidth],
    Contents: PDFString.of(''),
  };
  if (appearance.rgb !== null)
    fields.C = appearance.rgb;
  if (appearance.fillRgb)
    fields.IC = appearance.fillRgb;
  if (appearance.cloudIntensity !== undefined)
    fields.BE = { S: 'C', I: appearance.cloudIntensity };
  if (appearance.rectDifference !== undefined)
    fields.RD = appearance.rectDifference;
  if (appearance.vertices !== undefined) {
    fields.Vertices = appearance.vertices;
    if (appearance.lineEndings[1] !== 'None')
      fields.LE = appearance.lineEndings.map((name) => PDFName.of(name));
  }
  if (appearance.inkList !== undefined)
    fields.InkList = appearance.inkList;
  return fields;
}

// ノートの欄（spec-4-4 確定事項23）。本文（空でもよい）・作成者（空なら書かない）・塗りの色・アイコン名・
// 閉じたポップアップ・作成日時（/M と同じ時刻）。
function noteFields(entry, appearance, { PDFString, PDFHexString }, now) {
  const fields = {
    Contents: PDFHexString.fromText(entry.text ?? ''),
    C: appearance.rgb,
    Name: 'Comment',
    Open: false,
    CreationDate: PDFString.of(timestamp(now)),
  };
  if (typeof entry.author === 'string' && entry.author !== '')
    fields.T = PDFHexString.fromText(entry.author);
  return fields;
}

// 種類ごとの欄。マークアップは /QuadPoints と /C、テキストは /Contents・/DA・/Border・/Rotate
// （spec-4-2 確定事項25。/C は箱の背景色に使うビューアがあるので書かない）、図形・ペンは shapeFields、
// ノートは noteFields。
function kindFields(entry, appearance, tools, now) {
  const { PDFString, PDFHexString } = tools;
  if (SHAPE_KINDS.includes(entry.kind))
    return shapeFields(appearance, tools);
  if (entry.kind === 'note')
    return noteFields(entry, appearance, tools, now);
  if (entry.kind !== 'text') {
    return { QuadPoints: entry.quads.flat(), C: appearance.rgb, Contents: PDFString.of('') };
  }
  const fields = {
    Contents: PDFHexString.fromText(entry.text),
    DA: PDFString.of(appearance.da),
    Border: [0, 0, 0],
  };
  if (entry.rotation !== 0)
    fields.Rotate = entry.rotation;
  return fields;
}

// ノートのポップアップ（spec-4-4 確定事項24）。親を指し、閉じた状態でアイコンの右隣に置く。
// 外観は持たない（ビューアが自分で窓を描く）。
function popupDict(context, page, parentRef, rect) {
  return context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: rect, Parent: parentRef, Open: false, F: 28, P: page.ref });
}

module.exports = { timestamp, shapeFields, noteFields, kindFields, popupDict };
