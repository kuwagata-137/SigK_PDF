(function (root) {
  'use strict';

  // ツールの入力ファイルを覗く（spec-2-1 確定事項14・spec-2-2 確定事項4）。
  //
  // pdf.js で numPages だけ読んで、文書はすぐ手放す。パスワード付きは聞かずに
  // 断る（password-prompt.js は通さない。結合も分割も暗号化 PDF を書けないため）。
  //
  // 戻り値は { pageCount, name } か { reason, error }。reason は
  // 'unavailable'（読む機能が無い）・'read'（ファイルを読めない）・
  // 'encrypted'・'broken'。画面に出す文言は呼ぶ側が決める（結合は「外してください」、
  // 分割は「選び直してください」と続きが違う）。error は素の文言である。

  function baseName(filePath) {
    return String(filePath ?? '').split(/[\\/]/).pop();
  }

  // 全ページの寸法（pt・回転込み）。PDF→画像が画素の上限と出力の例に使う（spec-3-3 確定事項3）。
  // 1,000 ページで約 1 秒。
  async function collectSizes(doc) {
    const sizes = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push({ width: viewport.width, height: viewport.height });
    }
    return sizes;
  }

  async function inspect(filePath, { withSizes, encryptedError }) {
    const api = root.pdfAPI;
    if (api?.available !== true || root.SigK.pdfjs?.available !== true)
      return { reason: 'unavailable', error: 'PDF を読む機能を使えません' };
    const read = await api.read(filePath);
    if (read?.error !== undefined)
      return { reason: 'read', error: read.error };

    const task = root.SigK.pdfjs.getDocument({ data: read.bytes });
    let encrypted = false;
    task.onPassword = (update) => {
      encrypted = true;
      update(new Error('パスワード付きの PDF は扱えません'));
    };
    try {
      const doc = await task.promise;
      const info = { pageCount: doc.numPages, name: read.name ?? baseName(filePath) };
      if (withSizes)
        info.sizes = await collectSizes(doc);
      return info;
    } catch {
      return encrypted
        ? { reason: 'encrypted', error: encryptedError }
        : { reason: 'broken', error: 'この PDF を開けません' };
    } finally {
      // 畳むのは loadingTask（spec-3-3 確定事項25）。doc.destroy は pdf.js 6 に無い。
      // 開けなかったときも呼んでおく（pdf.js は失敗したタスクの destroy を許す）。
      await task.destroy?.();
    }
  }

  // 結合・分割の対象。書けないので暗号化は「保存できない」と断る。
  function inspectPdf(filePath) {
    return inspect(filePath, { withSizes: false, encryptedError: '保存できない PDF です（パスワード付き）' });
  }

  // PDF→画像の対象（spec-3-3 確定事項3・4）。寸法まで読む。書かないので文言は「画像にできません」。
  function inspectPdfPages(filePath) {
    return inspect(filePath, { withSizes: true, encryptedError: 'パスワード付きの PDF は画像にできません' });
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
  SigK.toolSource = { inspectPdf, inspectPdfPages, inspectImage, baseName };
})(typeof window !== 'undefined' ? window : globalThis);
