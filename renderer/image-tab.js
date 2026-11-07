(function (root) {
  'use strict';

  // 画像のタブの見分け（spec-7-1）。純関数だけで、DOM にも viewer にも触れない。
  //
  // 画像のタブは、viewer の getState().file が image（{ kind, frames, original? }）を持つ。kind は worker/image-format.js の形式の名前
  // （'png'・'jpeg'・'bmp'・'gif'・'tiff'）。保存の形式は 'png'・'jpeg'・'pdf'（file-io.js の SAVE_FORMAT_FILTERS と同じ名前）。

  // 同じ形式で書ける画像（確定事項B1）。BMP・GIF・TIFF は書く手段が無い（canvas が書けるのは PNG と JPEG だけ）。
  const WRITABLE = Object.freeze(['png', 'jpeg']);
  // JPEG の品質（確定事項B1）。PDF→画像の 0.9 より上げ、上書きのたびに画質が落ちるのを抑える。
  const JPEG_QUALITY = 0.95;
  const MIME = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg' });
  // 画像のタブで使えない道具（確定事項C1）。文字を選んで引く 3 つと、焼き込むと本文が消えるノート。
  const BLOCKED_TOOLS = Object.freeze(['highlight', 'underline', 'strikeout', 'note']);

  function isImageFile(file) {
    return file?.image !== undefined && file?.image !== null;
  }

  // 上書きで同じ形式に書けるか。書けるならその形式、書けなければ null。
  function overwriteFormatOf(file) {
    return isImageFile(file) && WRITABLE.includes(file.image.kind) ? file.image.kind : null;
  }

  // 画像にできるか（確定事項B3）。ページが 1 枚のときだけ。
  function canWriteImage(pageCount) {
    return pageCount === 1;
  }

  // 名前を付けて保存で選べる形式の並び。最初が既定（元の形式。BMP・GIF・TIFF なら PNG）。画像にできなければ PDF だけ（確定事項B2・B3）。
  function saveFormatsOf(file, pageCount) {
    if (!canWriteImage(pageCount))
      return ['pdf'];
    const first = overwriteFormatOf(file) ?? 'png';
    return [first, first === 'png' ? 'jpeg' : 'png', 'pdf'];
  }

  function stemAndExt(filePath) {
    const text = String(filePath ?? '');
    const slash = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'));
    const dot = text.lastIndexOf('.');
    return dot > slash ? { stem: text.slice(0, dot), ext: text.slice(dot).toLowerCase() } : { stem: text, ext: '' };
  }

  // 名前を付けて保存の窓の既定のパス。同じフォルダの同じ名前で、拡張子は形式のもの。JPEG は元の拡張子（.jpg か .jpeg）を残す。
  function defaultPathFor(filePath, format) {
    const { stem, ext } = stemAndExt(filePath);
    if (format === 'jpeg')
      return `${stem}${ext === '.jpeg' ? '.jpeg' : '.jpg'}`;
    return `${stem}.${format === 'pdf' ? 'pdf' : 'png'}`;
  }

  function mimeOf(format) {
    return MIME[format] ?? null;
  }

  function qualityOf(format) {
    return format === 'jpeg' ? JPEG_QUALITY : undefined;
  }

  // 画像のタブで、その道具を使えないか。
  function blocksTool(file, tool) {
    return isImageFile(file) && BLOCKED_TOOLS.includes(tool);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageTab = {
    WRITABLE, JPEG_QUALITY, BLOCKED_TOOLS,
    isImageFile, overwriteFormatOf, canWriteImage, saveFormatsOf, defaultPathFor, mimeOf, qualityOf, blocksTool,
  };
})(typeof window !== 'undefined' ? window : globalThis);
