'use strict';

// ワーカーが PDF を読み書きするときの約束（spec-1-6 確定事項11・事前調査 B）。保存（pdf-task.js）と
// ツール（tool-tasks.js・convert-task.js）の両方が使う。spec-4-5 確定事項47 で pdf-task.js から
// 切り出した（中身は変えていない）。
//
// pdf-lib は vendor から読む。配布物に node_modules は入っていない（docs/07 決定18）。
// asar の中からでも require できることは実測で確かめた（spec-1-6 事前調査 A）。

const path = require('node:path');

const { toBytes } = require('../file-io.js');

const pdfLib = require(path.join(__dirname, '..', 'vendor', 'pdf-lib.min.js'));
const { PDFDocument } = pdfLib;

// 低レベルの組み立てに要る道具。ページラベル・しおり・差し込みの層へ渡す
// （vendor へのパスをあちらに持たせない）。
const TOOLS = {
  PDFDocument,
  PDFPage: pdfLib.PDFPage,
  PDFName: pdfLib.PDFName,
  PDFHexString: pdfLib.PDFHexString,
  PDFImage: pdfLib.PDFImage,               // 画素列の埋め込み（pixel-image.js。spec-3-2 確定事項18）
  PngEmbedder: pdfLib.PngEmbedder,
  rgb: pdfLib.rgb,
  PDFString: pdfLib.PDFString,             // 注釈の /NM・/M・/Contents（op-annotate.js。spec-4-1 確定事項25）
  PDFArray: pdfLib.PDFArray,
  PDFRef: pdfLib.PDFRef,
  // モザイクのページの構造ツリーと、辿れない中身を消す（struct-tree-page.js・orphan-objects.js。spec-4b-6b 確定事項21・22）。
  PDFDict: pdfLib.PDFDict,
  PDFNumber: pdfLib.PDFNumber,
  PDFStream: pdfLib.PDFStream,
  PDFRawStream: pdfLib.PDFRawStream,
  // 内容の流れをほどいて、使う名前を読む（resource-narrow.js。spec-4b-6b 確定事項22）。
  decodePDFRawStream: pdfLib.decodePDFRawStream,
};

// save() のオプション（spec-1-6 事前調査 B）。
//
//   updateFieldAppearances: false … 既定 true のままだと、getForm() を通った文書で
//     /AP を持たない和文の欄の見た目を WinAnsi で作り直そうとして失敗する。
//     このワーカーは getForm() を呼ばないので今は牙を剥かないが、明示して塞いでおく。
//   addDefaultPage: false … 0ページのときに白紙 A4 を勝手に生やさない。
//     0ページは applyPlan が先に断るので、ここは二重の備えである。
const SAVE_OPTIONS = { updateFieldAppearances: false, addDefaultPage: false };

// load のオプション。updateMetadata は **load 側**にある。save へ渡しても効かず、
// 既定のままだと読み込んだ時点で Producer が pdf-lib へ書き換わる（実測 B）。
const LOAD_OPTIONS = { updateMetadata: false };

// 例外の型を選ばずに握る。pdf-lib は内容が欠けた PDF で素の TypeError を投げる
// ことがあり、そのまま画面へ出しても意味が通らない（確定事項11）。
function describeLoadFailure(error) {
  if (/encrypted/i.test(String(error?.message ?? '')))
    return 'パスワードで保護された PDF は保存できません。';
  return 'この PDF は内容が壊れているため保存できません。';
}

// file-io.js にも同じ役目の describeReadFailure があるが、あちらは「開くとき」の文言で、
// こちらは「保存しようとしたら元が無くなっていた」文言である。取り違えないよう名前を分ける。
function describeSourceReadFailure(error) {
  switch (error?.code) {
    case 'ENOENT':
      return '元のファイルが見つかりません。移動または削除された可能性があります。';
    case 'EACCES':
    case 'EPERM':
      return '元のファイルを読む権限がありません。';
    case 'EBUSY':
      return '元のファイルが他のプログラムで使われています。';
    default:
      return '元のファイルを読めませんでした。';
  }
}

// 差し込む元をディスクから読む口。**必ず toBytes() を通す**（spec-1-6 確定事項55）。
// embedJpg は byteOffset≠0 の Uint8Array を必ず拒否し、readFileSync は 4KB 未満の
// ファイルでプール Buffer を返すためである。書き落とすと「小さい JPEG だけ
// 挿入できない」という再現しにくい不具合になる。
function insertReader(fsLike) {
  return { readFile: async (target) => toBytes(await fsLike.promises.readFile(target)) };
}

module.exports = {
  pdfLib, PDFDocument, TOOLS, SAVE_OPTIONS, LOAD_OPTIONS,
  describeLoadFailure, describeSourceReadFailure, insertReader,
};
