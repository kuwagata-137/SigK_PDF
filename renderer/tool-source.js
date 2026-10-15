(function (root) {
  'use strict';

  // ツールの入力ファイルの名前と、画像の形式・画素数（spec-3-1 確定事項4・spec-3-2 確定事項28）。
  //
  // 2026-10-15: PDF を読んで覗く口（openPdf・inspectPdf。分割の対象の欄と盤が使っていた）は無くした。分割も選んでいる帯（タブの文書）を
  // 対象にし、盤もタブの文書から描くため（spec-2-5 確定事項G6・G14）。

  function baseName(filePath) {
    return String(filePath ?? '').split(/[\\/]/).pop();
  }

  // 画像の形式と画素数（spec-3-1 確定事項4・spec-3-2 確定事項28）。読むのはメイン側 image-io.js で、
  // 先頭バイトだけを見る（TIFF は全体）。戻り値は { ok, kind, width, height, pages, frames, name } か
  // { reason: 'unavailable' | 'image', error }。frames はページごとの寸法（複数ページを持つのは TIFF だけ）。
  async function inspectImage(filePath) {
    const api = root.pdfAPI;
    if (api?.available !== true || typeof api.inspectImage !== 'function')
      return { reason: 'unavailable', error: '画像を読む機能を使えません' };
    const info = await api.inspectImage(filePath);
    if (info?.ok !== true)
      return { reason: 'image', error: String(info?.error ?? '画像を読めませんでした').replace(/。$/, '') };
    const frames = Array.isArray(info.frames) && info.frames.length > 0 ? info.frames : [{ width: info.width, height: info.height }];
    return { ok: true, kind: info.kind, width: info.width, height: info.height, pages: frames.length, frames, name: info.name ?? baseName(filePath) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolSource = { inspectImage, baseName };
})(typeof window !== 'undefined' ? window : globalThis);
