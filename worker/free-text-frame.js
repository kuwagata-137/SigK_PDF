'use strict';

// 注釈の辞書を直に読む口（annotation-dict-reader.js）の、FreeText の回転の読み（spec-4b-4b 確定事項I1）。読むだけで、何も書かない。
//
// 四角・丸と同じく外観の /BBox・/Matrix と /Rect から角度と回す前の箱を求める（shape-rotation.js の rotationOf）。ただし外観の
// 中身のゆがみ（appearance-reader.js の skewedContent）は見ない。SigK のテキストは文字の向き 90°・270° で `0 1 -1 0 cm` などを
// 書くので、回していなくても当たってしまう（事前調査 C）。直せるのは SigK のテキストだけで、他のアプリの FreeText は表示のみの
// ままなので、中身を見る必要が無い。
//
// SigK の回したテキストは、/BBox が回す前の箱そのもので、/Matrix はその中心まわり（確定事項H1）。そう書かれていれば /BBox を
// そのまま箱にする（/Rect の小数 2 桁の丸めを持ち込まず、何度開き直しても箱がずれない）。

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

// FreeText の外観の回転。{ box, angle }（回っている）・'skewed'（回転を読めない）・null（回っていない・外観が無い）。
function freeTextRotationOf(dict, context) {
  const appearance = appearanceOf(context, dict);
  const rect = numbersOf(context, pick(dict, '/Rect'), 4);
  if (appearance === null || rect === null)
    return null;
  const answer = rotationOf({ rect, bbox: appearance.bbox, matrix: appearance.matrix });
  if (answer === null || answer === 'skewed')
    return answer;
  const box = normalized(appearance.bbox);
  return turnsAbout(appearance.matrix, box, answer.angle) ? { box, angle: answer.angle } : answer;
}

module.exports = { MATRIX_TOLERANCE, freeTextRotationOf };
