'use strict';

// 回した四角・丸を載せた検体（spec-4b-2 事前調査 B・確定事項34〜36）。他のアプリの書き方は合成で作る（製品名は書かない）。
//
//   1 ページ目: SigK PDF の書き方（保存と同じ経路 worker/op-annotate.js）で回した四角・丸
//              （30° の四角・45° の塗った丸・15° の雲形の四角・300° の半透明の四角・90° の四角）
//   2 ページ目: 回転が読める他のアプリの書き方（直せる）
//              P1 /Matrix で 30°（/BBox は箱）・P3 P1 に注釈の /Rotate 30・P9 /Matrix で 30° の丸・P10 P1 の /Rect だけを 40pt ずらした・
//              P12 /BBox が線の外側まで 2pt 広い・PL /BBox [0 0 w h] を中心まわりに回してから置いた（あるライブラリの書き方）
//   3 ページ目: 回転が読めない書き方
//              P2 外観の中身の cm で 30°（表示のみ）・P4 4 頂点の /Polygon（表示のみ）・P5 横に 1.5 倍の /Matrix（回っていないので直せる）・
//              P6 /Matrix で 30° と外接に対する /RD（/Rect が広く、外観がゆがむので表示のみ）・P11 /Rect の幅だけ 1.3 倍（表示のみ）・
//              MR 裏返しの /Matrix（表示のみ）
// 外観は辞書の欄（青の線 4pt・黄の塗り）のとおりに描く。
//
// buildEncryptedRotatedPdf は、暗号化した文書でも読み戻しの口が /BBox・/Matrix・/Rect を読めることを確かめる検体
// （RC4 40bit・ユーザーのパスワード user1。手で組む。standard-security.js と同じ作り方）。

const crypto = require('node:crypto');
const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const { PADDING, rc4, objectKey } = require('./standard-security.js');

const A4 = [595.28, 841.89];
const W = 4;

const r2 = (value) => Math.round(value * 100) / 100;
const r4 = (value) => {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

// 箱の中心まわりに、画面で時計回りに angle 度（紙の座標では [cos −sin sin cos]）。
function turnMatrix(box, angle) {
  const t = (angle * Math.PI) / 180;
  const cos = r4(Math.cos(t));
  const sin = r4(Math.sin(t));
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return [cos, r4(-sin), sin, cos, r4(cx - (cos * cx + sin * cy)), r4(cy - (-sin * cx + cos * cy))];
}

function transform([x, y], m) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function boundsOf(box, m) {
  const points = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map((point) => transform(point, m));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(r2);
}

// 線 4pt を箱の内側に描いて黄で塗る四角の中身。
function squareOps([x1, y1, x2, y2]) {
  return `0 0 1 RG 1 1 0 rg ${W} w ${x1 + W / 2} ${y1 + W / 2} ${x2 - x1 - W} ${y2 - y1 - W} re B`;
}

function ellipseOps([x1, y1, x2, y2]) {
  const k = 0.5523;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1) / 2 - W / 2;
  const ry = (y2 - y1) / 2 - W / 2;
  const curve = (...values) => `${values.map(r2).join(' ')} c`;
  return [`0 0 1 RG 1 1 0 rg ${W} w ${r2(cx + rx)} ${r2(cy)} m`,
    curve(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry),
    curve(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy),
    curve(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry),
    curve(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy), 'h B'].join(' ');
}

function annotsOf(doc, page) {
  let annots = doc.context.lookup(page.node.get(PDFName.of('Annots')));
  if (annots === undefined) {
    annots = doc.context.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  return annots;
}

function addOther(doc, page, { subtype = 'Square', rect, bbox, matrix = null, content, extra = {} }) {
  const ctx = doc.context;
  const form = { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: bbox, Resources: {} };
  if (matrix !== null)
    form.Matrix = matrix;
  const ap = ctx.register(ctx.stream(content, form));
  const dict = { Type: 'Annot', Subtype: subtype, Rect: rect, C: [0, 0, 1], IC: [1, 1, 0], BS: { W, S: 'S' }, F: 4, P: page.ref, AP: { N: ap }, ...extra };
  annotsOf(doc, page).push(ctx.register(ctx.obj(dict)));
}

// 1 ページ目: SigK PDF の書き方。
async function addSigkShapes(doc) {
  const { applyAnnotations } = require('../../worker/op-annotate.js');
  const add = [
    { src: 0, kind: 'square', color: '#d92c2c', opacity: 1, rect: [60, 640, 220, 740], lineWidth: 3, angle: 30 },
    { src: 0, kind: 'circle', color: '#2c5cd9', fill: '#ffd966', opacity: 1, rect: [320, 640, 500, 720], lineWidth: 2, angle: 45 },
    { src: 0, kind: 'square', color: '#7c3aed', lineStyle: 'cloudy', opacity: 1, rect: [60, 420, 240, 540], lineWidth: 2, angle: 15 },
    { src: 0, kind: 'square', color: '#1e3a8a', fill: '#ef4444', opacity: 0.5, rect: [320, 420, 500, 520], lineWidth: 6, angle: 300 },
    { src: 0, kind: 'square', color: '#1e8e3e', opacity: 1, rect: [200, 160, 400, 240], lineWidth: 2, angle: 90 },
  ];
  const result = await applyAnnotations(doc, { add }, { PDFName, PDFString, PDFHexString, PDFArray, PDFRef }, { now: new Date(2026, 9, 1, 9, 0, 0) });
  if (result.ok !== true)
    throw new Error(result.error);
}

// 2 ページ目: 回転が読める他のアプリの書き方。
function addReadable(doc, page) {
  const p1 = [60, 660, 210, 750];
  addOther(doc, page, { rect: boundsOf(p1, turnMatrix(p1, 30)), bbox: p1, matrix: turnMatrix(p1, 30), content: squareOps(p1) });
  const p3 = [330, 660, 480, 750];
  addOther(doc, page, { rect: boundsOf(p3, turnMatrix(p3, 30)), bbox: p3, matrix: turnMatrix(p3, 30), content: squareOps(p3), extra: { Rotate: 30 } });
  const p9 = [60, 440, 210, 530];
  addOther(doc, page, { subtype: 'Circle', rect: boundsOf(p9, turnMatrix(p9, 30)), bbox: p9, matrix: turnMatrix(p9, 30), content: ellipseOps(p9) });
  const p10 = [330, 440, 480, 530];
  addOther(doc, page, { rect: boundsOf(p10, turnMatrix(p10, 30)).map((value) => r2(value + 40)), bbox: p10, matrix: turnMatrix(p10, 30), content: squareOps(p10) });
  const p12 = [60, 200, 210, 290];
  const wide = [p12[0] - 2, p12[1] - 2, p12[2] + 2, p12[3] + 2];
  addOther(doc, page, { rect: boundsOf(wide, turnMatrix(p12, 30)), bbox: wide, matrix: turnMatrix(p12, 30), content: squareOps(p12) });
  // /BBox [0 0 150 90] を中心まわりに 30° 回してから (330, 200) へ置く。
  const local = [0, 0, 150, 90];
  const turn = turnMatrix(local, 30);
  const placed = [turn[0], turn[1], turn[2], turn[3], r4(turn[4] + 330), r4(turn[5] + 200)];
  addOther(doc, page, { rect: boundsOf(local, placed), bbox: local, matrix: placed, content: squareOps(local) });
}

// 3 ページ目: 回転が読めない書き方（と、回っていない伸び縮み）。
function addUnreadable(doc, page) {
  const p2 = [60, 660, 210, 750];
  const p2Matrix = turnMatrix(p2, 30);
  const p2Rect = boundsOf(p2, p2Matrix);
  addOther(doc, page, { rect: p2Rect, bbox: p2Rect, content: `q ${p2Matrix.join(' ')} cm ${squareOps(p2)} Q` });
  const p4 = [330, 660, 480, 750];
  const corners = [[p4[0], p4[1]], [p4[2], p4[1]], [p4[2], p4[3]], [p4[0], p4[3]]].map((point) => transform(point, turnMatrix(p4, 30)).map(r2));
  const p4Rect = boundsOf(p4, turnMatrix(p4, 30)).map((value, index) => r2(index < 2 ? value - W : value + W));
  addOther(doc, page, { subtype: 'Polygon', rect: p4Rect, bbox: p4Rect, content: `0 0 1 RG 1 1 0 rg ${W} w ${corners.map((point, index) => `${point.join(' ')} ${index === 0 ? 'm' : 'l'}`).join(' ')} h B`, extra: { Vertices: corners.flat() } });
  const p5 = [60, 440, 160, 530];
  const stretch = [1.5, 0, 0, 1, -0.5 * p5[0], 0];
  addOther(doc, page, { rect: boundsOf(p5, stretch), bbox: p5, matrix: stretch, content: squareOps(p5) });
  const p6 = [330, 440, 480, 530];
  const p6Bounds = boundsOf(p6, turnMatrix(p6, 30));
  addOther(doc, page, { rect: p6Bounds.map((value, index) => r2(index < 2 ? value - 6 : value + 6)), bbox: p6, matrix: turnMatrix(p6, 30), content: squareOps(p6), extra: { RD: [6, 6, 6, 6] } });
  const p11 = [60, 200, 210, 290];
  const [x1, y1, x2, y2] = boundsOf(p11, turnMatrix(p11, 30));
  addOther(doc, page, { rect: [x1, y1, r2(x1 + (x2 - x1) * 1.3), y2], bbox: p11, matrix: turnMatrix(p11, 30), content: squareOps(p11) });
  const mirror = [330, 200, 480, 290];
  addOther(doc, page, { rect: mirror, bbox: mirror, matrix: [-1, 0, 0, 1, mirror[0] + mirror[2], 0], content: squareOps(mirror) });
}

async function buildRotatedShapesPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('回した四角・丸を載せた3ページ');
  const pages = [doc.addPage(A4), doc.addPage(A4), doc.addPage(A4)];
  await addSigkShapes(doc);
  addReadable(doc, pages[1]);
  addUnreadable(doc, pages[2]);
  return doc.save({ addDefaultPage: false, useObjectStreams: false });
}

// ---- 暗号化した検体（手で組む） ----

const md5 = (buffer) => crypto.createHash('md5').update(buffer).digest();
const padPassword = (password) => Buffer.concat([Buffer.from(password, 'latin1'), PADDING]).subarray(0, 32);
const hex = (buffer) => buffer.toString('hex');

// 1 ページに、/Matrix で 30° 回した四角（7 0 R）と、中身の cm で 30° 回した四角（9 0 R）を置く。
function buildEncryptedRotatedPdf() {
  const userPassword = 'user1';
  const permissions = -1;
  const documentId = md5(Buffer.from('sigk-rotated-encrypted', 'latin1'));
  const owner = rc4(md5(padPassword('owner1')).subarray(0, 5), padPassword(userPassword));
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  const key = md5(Buffer.concat([padPassword(userPassword), owner, p, documentId])).subarray(0, 5);
  const user = rc4(key, PADDING);
  const encrypt = (number, text) => rc4(objectKey(key, number, 0), Buffer.from(text, 'latin1'));

  const box = [80, 120, 220, 200];
  const matrix = turnMatrix(box, 30);
  const rect = boundsOf(box, matrix);
  const pageContent = encrypt(4, 'BT /F1 12 Tf 72 760 Td (rotated) Tj ET\n');
  const matrixForm = encrypt(8, `0 0 1 RG 1 1 0 rg ${W} w 82 122 136 76 re B`);
  const cmForm = encrypt(10, `q ${matrix.join(' ')} cm 0 0 1 RG 1 1 0 rg ${W} w 302 122 136 76 re B Q`);
  const cmRect = boundsOf([300, 120, 440, 200], turnMatrix([300, 120, 440, 200], 30));
  const stream = (number, dict, bytes) => [`${number} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream\nendobj\n'];
  const bodies = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [7 0 R 9 0 R] >>\nendobj\n',
    stream(4, '', pageContent),
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `6 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${hex(owner)}> /U <${hex(user)}> /P ${permissions} >>\nendobj\n`,
    `7 0 obj\n<< /Type /Annot /Subtype /Square /Rect [${rect.join(' ')}] /C [0 0 1] /IC [1 1 0] /BS << /W ${W} /S /S >> /F 4 /AP << /N 8 0 R >> >>\nendobj\n`,
    stream(8, `/Type /XObject /Subtype /Form /FormType 1 /BBox [${box.join(' ')}] /Matrix [${matrix.join(' ')}] /Resources << >>`, matrixForm),
    `9 0 obj\n<< /Type /Annot /Subtype /Square /Rect [${cmRect.join(' ')}] /C [0 0 1] /IC [1 1 0] /BS << /W ${W} /S /S >> /F 4 /AP << /N 10 0 R >> >>\nendobj\n`,
    stream(10, `/Type /XObject /Subtype /Form /FormType 1 /BBox [${cmRect.join(' ')}] /Resources << >>`, cmForm),
  ].map((body) => (Array.isArray(body) ? Buffer.concat(body.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : part))) : Buffer.from(body, 'latin1')));

  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  const parts = [header];
  const offsets = [];
  let position = header.length;
  for (const body of bodies) {
    offsets.push(position);
    parts.push(body);
    position += body.length;
  }
  const size = bodies.length + 1;
  let tail = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${size} /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(documentId)}> <${hex(documentId)}>] >>\nstartxref\n${position}\n%%EOF\n`;
  parts.push(Buffer.from(tail, 'latin1'));
  return { bytes: Buffer.concat(parts), box, rect, cmRect };
}

module.exports = { buildRotatedShapesPdf, buildEncryptedRotatedPdf, turnMatrix, boundsOf };
