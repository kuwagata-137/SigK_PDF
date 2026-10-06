'use strict';

// 根から辿れない間接オブジェクトを消す（spec-4b-6b 確定事項22。事前調査 E・I）。
//
// pdf-lib は、読んだファイルの間接オブジェクトを全部持ったまま書き出す。ページの中身を差し替えたり、ページを外したりしても、古い中身は
// どこからも指されないまま保存先に残る（spec-1-6 の実測、⑥-a の事前調査 E）。モザイクで消したはずの文字が残らないよう、trailer の
// Root・Info・Encrypt から辿れるものだけを残し、ほかは context から消す。
//
// 辿り方: 参照（PDFRef）は指す先へ、辞書と配列は中の値へ、流れ（PDFStream・PDFRawStream）は辞書へ進む。流れの中身（内容の流れが名前で
// 指す資源）は /Resources の辞書から辿れるので、中身を読む必要は無い。pdf-lib は読み込むときにオブジェクトの流れ（ObjStm）と相互参照の
// 流れをほどいて中のオブジェクトを並べるので、それら自体は辿れずに消え、保存のときに pdf-lib が作り直す。まだ埋め込んでいない画像・
// フォント（save() で埋める）は参照だけ予約されて context に無いので、ここでは触れない。pdf-lib は require しない。

function reachableRefs(context, { PDFRef, PDFDict, PDFArray, PDFStream, PDFRawStream }) {
  const seen = new Set();
  const { Root, Info, Encrypt } = context.trailerInfo;
  const stack = [Root, Info, Encrypt].filter((value) => value !== undefined && value !== null);
  while (stack.length > 0) {
    const value = stack.pop();
    if (value instanceof PDFRef) {
      const key = value.toString();
      if (seen.has(key))
        continue;
      seen.add(key);
      const target = context.lookup(value);
      if (target !== undefined)
        stack.push(target);
    } else if (value instanceof PDFDict) {
      for (const [, item] of value.entries())
        stack.push(item);
    } else if (value instanceof PDFArray) {
      for (let index = 0; index < value.size(); index += 1)
        stack.push(value.get(index));
    } else if (value instanceof PDFStream || value instanceof PDFRawStream) {
      stack.push(value.dict);
    }
  }
  return seen;
}

// doc の context から、辿れない間接オブジェクトを消す。消した数を返す。
// tools は { PDFRef, PDFDict, PDFArray, PDFStream, PDFRawStream }（pdf-io.js の TOOLS）。
function pruneOrphans(doc, tools) {
  const context = doc.context;
  const keep = reachableRefs(context, tools);
  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (keep.has(ref.toString()))
      continue;
    context.delete(ref);
    removed += 1;
  }
  return removed;
}

module.exports = { reachableRefs, pruneOrphans };
