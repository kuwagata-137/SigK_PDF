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

  async function inspectPdf(filePath) {
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
      const pageCount = doc.numPages;
      doc.destroy?.();
      return { pageCount, name: read.name ?? baseName(filePath) };
    } catch {
      return encrypted
        ? { reason: 'encrypted', error: '保存できない PDF です（パスワード付き）' }
        : { reason: 'broken', error: 'この PDF を開けません' };
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolSource = { inspectPdf, baseName };
})(typeof window !== 'undefined' ? window : globalThis);
