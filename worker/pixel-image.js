'use strict';

// 画素列を pdf-lib の画像オブジェクト（/XObject /Image）にする層（spec-3-2 確定事項15〜17）。
//
// pdf-lib が埋め込めるのは PNG・JPEG だけで、画素列を直接受ける口が無い。`PDFImage` の
// コンストラクタは embedder が `PngEmbedder`／`JpegEmbedder` のインスタンスであることを
// 確かめるが、**`PngEmbedder` は `{ width, height, bitsPerComponent }` を持つ object なら何でも
// 受け取る**（事前調査 D）。そのインスタンスを作って `embedIntoContext` だけを差し替え、
// `PDFImage.of` で包めば、`page.drawImage` も2回目の `embed()`（no-op）も公開 API のまま通る。
//
// 【その場で embed する】
// 差し込みの経路は `save()` が自動で embed しない（`doc.images` に載らないため）。ここで
// `await image.embed()` まで済ませ、`context.flateStream` が圧縮した時点で画素を手放す。
// 変換の `op-convert.js` が呼ぶ2回目の `embed()` は embedder が消えているので何もしない。

const COLOR_SPACES = { gray: 'DeviceGray', rgb: 'DeviceRGB', cmyk: 'DeviceCMYK' };

function hexOf(bytes) {
  let out = '';
  for (const value of bytes)
    out += value.toString(16).padStart(2, '0');
  return out;
}

// /ColorSpace の値。パレットは [/Indexed /DeviceRGB hival <パレット>]。
function colorSpaceOf(context, pixels, { PDFName, PDFHexString }) {
  if (pixels.colorSpace !== 'indexed')
    return COLOR_SPACES[pixels.colorSpace];
  const hival = Math.max(0, pixels.palette.length / 3 - 1);
  return context.obj([PDFName.of('Indexed'), PDFName.of('DeviceRGB'), hival, PDFHexString.of(hexOf(pixels.palette))]);
}

function validatePixels(pixels) {
  if (!(pixels?.width > 0) || !(pixels?.height > 0))
    return '画像の大きさを読み取れませんでした。';
  if (COLOR_SPACES[pixels.colorSpace] === undefined && pixels.colorSpace !== 'indexed')
    return '画像の色の形式を扱えません。';
  if (![1, 2, 4, 8].includes(pixels.bitsPerComponent))
    return '画像の色の形式を扱えません。';
  if (!(pixels.bytes instanceof Uint8Array))
    return '画像を読み込めませんでした。ファイルが壊れている可能性があります。';
  return null;
}

function makeEmbedder(pixels, tools) {
  const embedder = new tools.PngEmbedder({ width: pixels.width, height: pixels.height, bitsPerComponent: pixels.bitsPerComponent });
  let held = pixels;
  embedder.embedIntoContext = async (context, ref) => {
    const dict = {
      Type: 'XObject',
      Subtype: 'Image',
      Width: held.width,
      Height: held.height,
      BitsPerComponent: held.bitsPerComponent,
      ColorSpace: colorSpaceOf(context, held, tools),
    };
    if (held.inverted === true)
      dict.Decode = [1, 0];
    const xObject = context.flateStream(held.bytes, dict);
    held = null;                                   // 圧縮したので画素を手放す
    if (ref) {
      context.assign(ref, xObject);
      return ref;
    }
    return context.register(xObject);
  };
  return embedder;
}

// pixels（image-decode.js の形）を埋め込み、page.drawImage に渡せる PDFImage を返す。
async function embedPixels(doc, pixels, tools) {
  const invalid = validatePixels(pixels);
  if (invalid !== null)
    return { error: invalid };
  const image = tools.PDFImage.of(doc.context.nextRef(), doc, makeEmbedder(pixels, tools));
  await image.embed();
  return { ok: true, image };
}

module.exports = { embedPixels, hexOf };
