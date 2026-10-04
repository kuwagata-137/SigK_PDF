'use strict';

// 注釈の辞書を直に読む口（annotation-dict-reader.js）の、FreeText の回転と吹き出しの読み（spec-4b-4b 確定事項I1・I2）。読むだけで、
// 何も書かない。
//
// 四角・丸と同じく外観の /BBox・/Matrix と /Rect から角度と回す前の箱を求める（shape-rotation.js の rotationOf）。ただし外観の
// 中身のゆがみ（appearance-reader.js の skewedContent）は見ない。SigK のテキストは文字の向き 90°・270° で `0 1 -1 0 cm` などを
// 書くので、回していなくても当たってしまう（事前調査 C）。直せるのは SigK のテキストだけで、他のアプリの FreeText は表示のみの
// ままなので、中身を見る必要が無い。
//
// SigK の回したテキストは、/BBox が回す前の箱そのもので、/Matrix はその中心まわり（確定事項H1）。そう書かれていれば /BBox を
// そのまま箱にする（/Rect の小数 2 桁の丸めを持ち込まず、何度開き直しても箱がずれない）。
//
// 吹き出し（/IT /FreeTextCallout）は、箱が /BBox から /RD［左 下 右 上］を引いたもの（決定59 ③。回していても回す前の /BBox からの差。
// 確定事項H2）、先が /CL の始点（回していれば箱の中心まわりに戻す）。回していれば /Matrix の回転の中心が箱の中心と合うことを確かめる。

const { pick } = require('./pdf-tree-reader.js');
const { appearanceOf, numbersOf } = require('./appearance-reader.js');
const { matrixOf, rotationOf } = require('./shape-rotation.js');

// 書いた /Matrix とみなす差（cos・sin は小数 4 桁、移動も小数 4 桁で書く）。
const MATRIX_TOLERANCE = 0.001;

function normalized([x1, y1, x2, y2]) {
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

// matrix が box の中心まわりに angle 度回す /Matrix（matrixOf と同じ値）か。
function turnsAbout(matrix, box, angle) {
  const expected = matrixOf(box, angle);
  return matrix.every((value, index) => Math.abs(value - expected[index]) <= MATRIX_TOLERANCE);
}

function isCalloutDict(dict, context) {
  const intent = context.lookup(pick(dict, '/IT'));
  return intent?.encodedName === '/FreeTextCallout';
}

// 吹き出しの箱（/BBox − /RD）。/RD が崩れていれば null。足し引きの端数（464.86 + 23.48 = 488.34000000000003）は /RD と同じ
// 小数 4 桁で落とす。
function calloutBoxOf(dict, context, outer) {
  const rd = numbersOf(context, pick(dict, '/RD'), 4);
  if (rd === null || rd.some((value) => value < 0))
    return null;
  const fine = (value) => Math.round(value * 10000) / 10000;
  const box = [outer[0] + rd[0], outer[1] + rd[1], outer[2] - rd[2], outer[3] - rd[3]].map(fine);
  return box[2] > box[0] && box[3] > box[1] ? box : null;
}

// 行列で写した点を戻す（読んだ /Matrix の逆。書いたときと同じ行列で戻すので、/CL の丸めのほかに差が出ない）。
function undo([a, b, c, d, e, f], [x, y]) {
  const det = a * d - b * c;
  return [(d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det];
}

// /CL の始点（紙の座標）。4 つか 6 つの数でなければ null。
function calloutTipOf(dict, context) {
  const line = numbersOf(context, pick(dict, '/CL'), 4) ?? numbersOf(context, pick(dict, '/CL'), 6);
  return line === null ? null : [line[0], line[1]];
}

// FreeText の外観の回転と吹き出し。rotation は { box, angle }（回っている）・'skewed'（回転を読めない）・null（回っていない・外観が無い）、
// callout は { box, tip }（回す前）・'unreadable'（欄が崩れている）・null（吹き出しでない）。
function freeTextFrameOf(dict, context) {
  const callout = isCalloutDict(dict, context);
  const appearance = appearanceOf(context, dict);
  const rect = numbersOf(context, pick(dict, '/Rect'), 4);
  if (appearance === null || rect === null)
    return { rotation: null, callout: callout ? 'unreadable' : null };
  const outer = normalized(appearance.bbox);
  const box = callout ? calloutBoxOf(dict, context, outer) : outer;
  const tip = callout ? calloutTipOf(dict, context) : null;
  if (callout && (box === null || tip === null))
    return { rotation: null, callout: 'unreadable' };
  const answer = rotationOf({ rect, bbox: appearance.bbox, matrix: appearance.matrix });
  if (answer === 'skewed')
    return { rotation: answer, callout: callout ? 'unreadable' : null };
  if (answer === null)
    return { rotation: null, callout: callout ? { box, tip } : null };
  if (!turnsAbout(appearance.matrix, box, answer.angle))
    return callout ? { rotation: 'skewed', callout: 'unreadable' } : { rotation: answer, callout: null };
  const rotation = { box, angle: answer.angle };
  if (!callout)
    return { rotation, callout: null };
  return { rotation, callout: { box, tip: undo(appearance.matrix, tip).map((value) => Math.round(value * 100) / 100) } };
}

// FreeText の外観の回転（四角・丸と同じ答えの形）。
function freeTextRotationOf(dict, context) {
  return freeTextFrameOf(dict, context).rotation;
}

module.exports = { MATRIX_TOLERANCE, freeTextFrameOf, freeTextRotationOf };
