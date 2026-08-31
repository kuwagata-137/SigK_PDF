(function (root) {
  'use strict';

  // 文書情報（F-01-7・spec-1-2 確定事項11〜13）。
  // pdf.js の getMetadata() が返す info を人が読める形に直し、<dialog> に並べる。
  // 整形は純関数に寄せてあるので、DOM 抜きで検証できる。

  const UNKNOWN = '—';

  // PDF の日付は D:YYYYMMDDHHmmSS+09'00' という独自形式である（PDF 32000-1 7.9.4）。
  // 秒と時差は出さない。分まで分かれば十分で、時差まで出すと読みにくい。
  const PDF_DATE = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/;

  function formatPdfDate(raw) {
    if (typeof raw !== 'string' || raw.length === 0)
      return UNKNOWN;
    const match = PDF_DATE.exec(raw);
    // 読めない形式なら、黙って消すより元の文字列を見せる。
    if (match === null)
      return raw;
    const [, year, month = '01', day = '01', hour = '00', minute = '00'] = match;
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }

  function textOrUnknown(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : UNKNOWN;
  }

  // pdf.js は暗号化されていれば EncryptFilterName に採用したフィルター名を入れる。
  // 塊① の時点でパスワード付きは開けない（spec-1-1 確定事項15）ため、ここに
  // 出るのは「パスワード無しで開ける暗号化」だけである。
  function describeEncryption(info) {
    const filter = info?.EncryptFilterName;
    if (typeof filter === 'string' && filter.length > 0)
      return `あり（${filter}）`;
    return 'なし';
  }

  // 取れない項目は UNKNOWN のまま出す。それらしい値で埋めない（確定事項12）。
  function buildRows({ file, pageCount, info } = {}) {
    const meta = info ?? {};
    return [
      ['ファイル名', textOrUnknown(file?.name)],
      ['場所', textOrUnknown(file?.path)],
      ['ページ数', Number.isFinite(pageCount) ? `${pageCount} ページ` : UNKNOWN],
      ['ファイルサイズ', Number.isFinite(file?.size) ? root.SigK.shell.formatFileSize(file.size) : UNKNOWN],
      ['PDF バージョン', textOrUnknown(meta.PDFFormatVersion)],
      ['タイトル', textOrUnknown(meta.Title)],
      ['作成者', textOrUnknown(meta.Author)],
      ['作成アプリ', textOrUnknown(meta.Creator)],
      ['変換アプリ', textOrUnknown(meta.Producer)],
      ['作成日時', formatPdfDate(meta.CreationDate)],
      ['更新日時', formatPdfDate(meta.ModDate)],
      ['暗号化', describeEncryption(meta)],
    ];
  }

  function renderRows(doc, rows) {
    const body = doc.getElementById('doc-info-body');
    if (body === null)
      return false;

    const nodes = [];
    for (const [label, value] of rows) {
      const dt = doc.createElement('dt');
      dt.textContent = label;
      const dd = doc.createElement('dd');
      dd.textContent = value;
      nodes.push(dt, dd);
    }
    body.replaceChildren(...nodes);
    return true;
  }

  async function collect() {
    const state = root.SigK.viewer.getState();
    if (state.open !== true)
      return null;

    let info = {};
    try {
      // getMetadata は文書によっては info しか返さない。metadata（XMP）は使わない。
      const metadata = await root.SigK.viewer.getMetadata();
      info = metadata?.info ?? {};
    } catch (error) {
      // 情報が取れなくても、ファイル名とページ数は出せる。空のまま進む。
      root.SigK.log.report({
        level: 'warn',
        message: '文書情報を読めませんでした',
        stack: error?.stack,
        context: { source: 'doc-info', file: state.file?.name },
      });
    }
    return { file: state.file, pageCount: state.pageCount, info };
  }

  async function open(doc) {
    const dialog = doc.getElementById('doc-info');
    if (dialog === null)
      return false;

    const source = await collect();
    if (source === null)
      return false;

    renderRows(doc, buildRows(source));
    // jsdom には showModal が無い。open 属性で代用する。
    if (typeof dialog.showModal === 'function')
      dialog.showModal();
    else
      dialog.setAttribute('open', '');
    return true;
  }

  function close(doc) {
    const dialog = doc.getElementById('doc-info');
    if (dialog === null)
      return false;
    if (typeof dialog.close === 'function')
      dialog.close();
    else
      dialog.removeAttribute('open');
    return true;
  }

  function init(doc, win) {
    if (win.__sigkDocInfoReady === true)
      return false;
    win.__sigkDocInfoReady = true;

    doc.getElementById('doc-info-close')?.addEventListener('click', () => close(doc));
    // ステータスバーのファイル名から開く（確定事項11）。
    doc.getElementById('status-file')?.addEventListener('click', () => open(doc));
    root.pdfAPI?.onDocInfoRequest?.(() => open(doc));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.docInfo = { UNKNOWN, formatPdfDate, describeEncryption, buildRows, renderRows, open, close, init };
})(typeof window !== 'undefined' ? window : globalThis);
