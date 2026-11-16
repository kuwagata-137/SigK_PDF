'use strict';

// 画像を開くために、画像を PDF に組み立てる（spec-7-1 確定事項A1〜A4）。kind は 'image-open'。画像はパス（spec.path）で受け、
// 空のタブに貼り付けたクリップボードの画像だけはバイト列（spec.bytes）で受ける（spec-7-8 確定事項NT8）。
//
// 画面（pdf.js）が開けるのは PDF だけなので、画像は 1 画素＝1pt の紙に、白を敷かずに載せた PDF にして渡す。ファイルは書かない。
// 載せ方は画像→PDF・差し込みと同じ embedImage を通る（BMP・GIF・TIFF の展開も同じ）。複数ページの TIFF はページごとに 1 ページ、
// GIF は最初のコマだけ（画像→PDF と同じ）。
//
// 返すのは { ok, bytes, kind, frames: [{ width, height }…], signature, original? }。signature は読む前に取った印（大きさと更新時刻）で、
// 上書き保存のときに照らす。original は元の画像のバイト列で、JPEG のときだけ添える。pdf.js は JPEG を自前で読み解くので、ブラウザが
// 読み解いた画素と少しずれる。保存のときはブラウザで読み解いた元の画像を敷き直す（spec-7-1 事前調査 A・確定事項B4）。
//
// JPEG の EXIF の向きのうち回転（3・6・8）は、ページの回転（/Rotate）にして、エクスプローラーと同じ向きで表示する。紙と frames は
// 画素のまま（回す前）の大きさにする。original は、向きを 1 に書き換えた写しにする（ブラウザが向きを当てて読み解くと、pdf.js の画素と
// 向きが食い違うため）。spec-7-4 確定事項X1・X2（jpeg-orientation.js）。

const fs = require('node:fs');

const { readSignature } = require('../pdf-write.js');
const { inspectImageBytes, detectFormat, isProgressiveJpeg } = require('./image-format.js');
const { embedImage, drawImagePage } = require('./image-page.js');
const { jpegOrientation, rotationOf, withoutOrientation } = require('./jpeg-orientation.js');
const { TOOLS, SAVE_OPTIONS } = require('./pdf-io.js');
const { failure, passFailure } = require('./task-failure.js');

// 画像ファイルの上限（image-io.js の MAX_IMAGE_BYTES と同じ。画像→PDF と同じ上限にする）。
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

// 1 枚（1 ページ）を、画素と同じ大きさの紙に載せる。拡大も縮小もしない。
async function addFrame(doc, loaded, frame, size, tools) {
  const embedded = await embedImage(doc, loaded, tools, { frame });
  if (embedded.ok !== true)
    return embedded;
  const made = drawImagePage(doc, embedded.image, { page: size, box: { x: 0, y: 0, ...size }, paper: false }, tools);
  if (made.ok !== true)
    return made;
  doc.addPage(made.page);
  // 載せた直後に圧縮してコンテキストへ書き込む（op-convert.js の事前調査 A。PNG を RGBA のまま save() まで抱えない）。
  await embedded.image.embed();
  return { ok: true };
}

// bytes（画像ファイルの中身）を PDF に組み立てる。{ ok, bytes, kind, frames } / { error }。
async function buildImageDocument(bytes, tools = TOOLS) {
  // 判定は画像→PDF と同じだが、断る文は「開けません」にする（inspectImageBytes の文は「変換できません」）。
  if (detectFormat(bytes) === 'jpeg' && isProgressiveJpeg(bytes))
    return { error: 'この JPEG はプログレッシブ形式なので、開けません。' };
  const inspected = inspectImageBytes(bytes);
  if (inspected.ok !== true)
    return passFailure(inspected);
  const frames = inspected.frames.map(({ width, height }) => ({ width, height }));
  const doc = await tools.PDFDocument.create();
  const loaded = { kind: inspected.kind, bytes };
  for (const [frame, size] of frames.entries()) {
    const added = await addFrame(doc, loaded, frame, size, tools);
    if (added.ok !== true)
      return added;
  }
  // JPEG は 1 ページだけなので、1 ページ目を回す。
  const rotation = inspected.kind === 'jpeg' ? rotationOf(jpegOrientation(bytes)) : 0;
  if (rotation !== 0)
    doc.getPage(0).setRotation(tools.degrees(rotation));
  return { ok: true, bytes: await doc.save(SAVE_OPTIONS), kind: inspected.kind, frames };
}

const TOO_LARGE = `${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB までに対応していますが、画像が大きすぎます。`;

// view（画像の中身）を PDF に組み立て、JPEG なら元のバイト列（向きを 1 に書き換えたコピー）を添える。brokenText は、組み立ての途中で
// 例外が起きたときに返すエラーメッセージ。
async function buildWithOriginal(view, brokenText) {
  let built;
  try {
    built = await buildImageDocument(view);
  } catch (error) {
    return failure(brokenText, error);
  }
  if (built.ok !== true)
    return built;
  return { ...built, ...(built.kind === 'jpeg' ? { original: withoutOrientation(view) } : {}) };
}

// 空のタブに貼り付けたクリップボードの画像（spec-7-8 確定事項NT8）は、パスの代わりに PNG のバイト列（spec.bytes）で届く
// （clipboard-image.js）。ファイルが無いので、読む前の印（signature）は添えない。
async function runFromBytes(bytes) {
  if (bytes.length === 0)
    return { error: '開く画像が指定されていません。' };
  if (bytes.length > MAX_IMAGE_BYTES)
    return { error: TOO_LARGE };
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buildWithOriginal(view, '画像を読み込めませんでした。');
}

async function runImageOpen(spec, { fsLike = fs } = {}) {
  if (spec?.bytes instanceof Uint8Array)
    return runFromBytes(spec.bytes);
  const sourcePath = spec?.path;
  if (typeof sourcePath !== 'string' || sourcePath === '')
    return { error: '開く画像が指定されていません。' };
  // 印は読む前に取る（読んだあとに取ると、間の書き換えを見落とす。insert-preview と同じ）。
  const signature = await readSignature(sourcePath, { fsLike });
  if (signature !== null && signature.size > MAX_IMAGE_BYTES)
    return { error: TOO_LARGE };
  let bytes;
  try {
    bytes = await fsLike.promises.readFile(sourcePath);
  } catch (error) {
    return failure('画像を読み込めませんでした。移動または削除された可能性があります。', error);
  }
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const built = await buildWithOriginal(view, '画像を読み込めませんでした。ファイルが壊れている可能性があります。');
  return built.ok === true ? { ...built, signature } : built;
}

module.exports = { MAX_IMAGE_BYTES, buildImageDocument, runImageOpen };
