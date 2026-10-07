'use strict';

// 内容の流れが使う資源の名前を読む（resource-narrow.js が使う。spec-4b-6b 確定事項22。コードの点検で足した）。
//
// 流れをほどき、出てくる名前（/Xxx）を全部拾う。演算子を見分けないので、文字列の中の / も拾う（残しすぎることはあっても、使う名前を
// 落とすことは無い）。名前の # の書き方（#2D など）はほどいて、pdf-lib の PDFName の decodeText() と同じ形にそろえる。知らない圧縮で
// ほどけない流れは null を返す（呼ぶ側は絞らずに残す）。pdf-lib は require しない（tools で受け取る）。

// 名前の字（PDF の区切りの字と空白以外）。
const NAME = /\/([^\x00\s()<>[\]{}/%]*)/g;

function namesIn(bytes, into) {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  for (const match of text.matchAll(NAME))
    into.add(match[1].replace(/#([0-9A-Fa-f]{2})/g, (_all, hex) => String.fromCharCode(Number.parseInt(hex, 16))));
  return into;
}

// ctx（doc.context）の中の持ち主の名前を読む口。tools は { PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream, decodePDFRawStream }。
function createContentNames(ctx, tools) {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream, decodePDFRawStream } = tools;
  const key = (text) => PDFName.of(text);
  const resolve = (value) => (value instanceof PDFRef ? ctx.lookup(value) : value);

  function bytesOf(stream) {
    try {
      if (stream instanceof PDFRawStream)
        return decodePDFRawStream(stream).decode();
      if (typeof stream.getUnencodedContents === 'function')
        return stream.getUnencodedContents();
    } catch {
      // 知らない圧縮は、ほどけないものとして扱う。
    }
    return null;
  }

  // 持ち主の内容の流れ（ページは /Contents、フォーム・模様・外観は流れ自身、Type3 は /CharProcs の流れ）。
  function streamsOf(owner) {
    if (owner instanceof PDFStream)
      return [owner];
    if (owner.get(key('Subtype')) === key('Type3')) {
      const procs = resolve(owner.get(key('CharProcs')));
      return procs instanceof PDFDict ? procs.values().map(resolve) : [];
    }
    const contents = resolve(owner.get(key('Contents')));
    if (contents instanceof PDFArray)
      return contents.asArray().map(resolve);
    return contents === undefined ? [] : [contents];
  }

  // 持ち主の流れの名前の集合。1 本でもほどけなければ null。
  function namesOf(owner) {
    const names = new Set();
    for (const stream of streamsOf(owner)) {
      const bytes = stream instanceof PDFStream ? bytesOf(stream) : null;
      if (bytes === null)
        return null;
      namesIn(bytes, names);
    }
    return names;
  }

  return { namesOf };
}

module.exports = { namesIn, createContentNames };
