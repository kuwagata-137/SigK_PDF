'use strict';

// 紙全体の大きさ（MediaBox）を読むだけの口（spec-4b-6a 確定事項9・10）。tool-tasks.js の表の page-boxes。
//
// pdf.js は MediaBox を返さない（page.view は CropBox との重なり）。トリミングを外して紙全体に戻すには、ファイルの MediaBox が要る。
// annotation-details と同じく、開いているファイルを読むだけで書かず、進捗も送らない。開いたあとで外から書き換えられていたら読まない。

const fs = require('node:fs');

const { PDFDocument, LOAD_OPTIONS } = require('./pdf-io.js');
const { mediaBoxesOf } = require('./page-box-rules.js');
const { readSignature, signaturesMatch } = require('../pdf-write.js');

function requestOf(spec) {
  const { source, expect } = spec ?? {};
  if (typeof source !== 'string' || source === '')
    return null;
  if (!Number.isFinite(expect?.size) || expect.size < 0 || !Number.isFinite(expect?.mtimeMs))
    return null;
  return { source, expect: { size: expect.size, mtimeMs: expect.mtimeMs } };
}

// 戻り値は { ok: true, boxes } か { ok: false, reason }。boxes はページ順の [x1, y1, x2, y2]（読めないページは null）。
async function runPageBoxes(spec, { fsLike = fs } = {}) {
  const request = requestOf(spec);
  if (request === null)
    return { ok: false, reason: 'invalid' };
  const current = await readSignature(request.source, { fsLike });
  if (current !== null && !signaturesMatch(request.expect, current))
    return { ok: false, reason: 'changed' };
  try {
    const bytes = await fsLike.promises.readFile(request.source);
    const doc = await PDFDocument.load(bytes, { ...LOAD_OPTIONS, ignoreEncryption: true });
    return { ok: true, boxes: mediaBoxesOf(doc) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

module.exports = { requestOf, runPageBoxes };
