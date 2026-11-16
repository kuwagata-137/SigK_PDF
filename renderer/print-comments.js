(function (root) {
  'use strict';

  // 注釈とフォーム(M) の描き分け（docs/spec-7-7-print-dialog.md「配置の計算」・質問 PR2）。
  //
  // markups（文書と注釈）: 今と同じ（未保存の書き込みも印刷する。決定33 ⑦）。
  // document（文書）: 書き込みを印刷しない。フォームフィールドは印刷する。
  // stamps（文書とスタンプ）: 書き込みのうちスタンプだけを印刷する。
  // forms（フォームフィールドのみ）: ページの内容を印刷せず、フォームフィールドだけを印刷する。フォームフィールドを描いた絵と、
  // ページの内容だけの絵を比べ、違う画素だけを残す（spec-7-7 の Claude の案）。
  // pdf.js に描かせない注釈は、文書の annotationStorage の noView で一時的に隠し、描き終えたら元に戻す。

  const MODES = Object.freeze(['markups', 'document', 'stamps', 'forms']);
  // 書き込みでないもの（フォームフィールド・リンク・ポップアップ）は隠さない。
  const NOT_MARKUP = new Set(['Widget', 'Link', 'Popup']);
  // 2 つの絵で同じとみなす色の差（PNG にする前の画素の値の差。描く順番の違いで出る端の 1〜2 の揺れを落とす）。
  const SAME_COLOR = 8;

  function images() {
    return root.SigK.pageImage;
  }

  function annotationMode(name) {
    return root.SigK.pdfjs?.lib?.AnnotationMode?.[name];
  }

  // pdf.js の注釈の一覧から、この描き方で隠す注釈の id。
  function idsToHide(annotations, mode) {
    if (mode !== 'document' && mode !== 'stamps' && mode !== 'forms')
      return [];
    return (annotations ?? [])
      .filter((annotation) => !NOT_MARKUP.has(annotation?.subtype))
      .filter((annotation) => !(mode === 'stamps' && annotation.subtype === 'Stamp'))
      .map((annotation) => annotation.id)
      .filter((id) => typeof id === 'string' && id !== '');
  }

  // 隠してから task を走らせ、終わったら元に戻す。もともと noView のもの（自前で描く書き込み）は触らない。
  async function withHidden(storage, ids, task) {
    const restore = [];
    for (const id of ids) {
      const before = storage?.getRawValue?.(id);
      if (before?.noView === true || typeof storage?.setValue !== 'function')
        continue;
      restore.push({ id, existed: before !== undefined, noView: before?.noView });
      storage.setValue(id, { noView: true });
    }
    try {
      return await task();
    } finally {
      for (const entry of restore) {
        if (entry.existed)
          storage.setValue(entry.id, { noView: entry.noView });
        else
          storage.remove?.(entry.id);
      }
    }
  }

  // 自前の層で重ねる書き込み。文書と注釈は全部、文書とスタンプはスタンプだけ、ほかは重ねない。
  function overlayFor(src, mode) {
    const annotate = root.SigK.annotate;
    if (mode === 'markups')
      return annotate?.painterFor(src) ?? null;
    if (mode === 'stamps')
      return annotate?.painterFor(src, (entry) => entry.subtype === 'Stamp') ?? null;
    return null;
  }

  // 違わない画素を白にする（フォームフィールドのみ）。
  function keepDifference(target, base) {
    const width = target.width;
    const height = target.height;
    const a = target.getContext('2d').getImageData(0, 0, width, height);
    const b = base.getContext('2d').getImageData(0, 0, width, height).data;
    const data = a.data;
    for (let i = 0; i < data.length; i += 4) {
      const same = Math.abs(data[i] - b[i]) <= SAME_COLOR && Math.abs(data[i + 1] - b[i + 1]) <= SAME_COLOR && Math.abs(data[i + 2] - b[i + 2]) <= SAME_COLOR;
      if (same) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      }
    }
    target.getContext('2d').putImageData(a, 0, 0);
  }

  // 1 ページ（またはその一部）を、注釈とフォームの指定どおりに描く。options は page-image.js の renderToCanvas に渡すもの
  // （scale・rotation・box・mosaic・maxPixels）。annotations は pdf.js の getAnnotations() の結果（隠す注釈を決めるのに使う）。
  async function renderPage(doc, page, { mode = 'markups', src, annotations = [], storage = null, ...options }) {
    const draw = (extra) => images().renderToCanvas(doc, page, { ...options, annotationMode: annotationMode('ENABLE_STORAGE'), ...extra });
    if (mode === 'markups')
      return draw({ overlay: overlayFor(src, mode) });
    return withHidden(storage, idsToHide(annotations, mode), async () => {
      const drawn = await draw({ overlay: overlayFor(src, mode) });
      if (mode !== 'forms' || drawn.canvas === null)
        return drawn;
      const content = await draw({ annotationMode: annotationMode('DISABLE'), overlay: null });
      try {
        keepDifference(drawn.canvas, content.canvas);
      } finally {
        images().release(content.canvas);
      }
      return drawn;
    });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printComments = { MODES, idsToHide, withHidden, overlayFor, keepDifference, renderPage };
})(typeof window !== 'undefined' ? window : globalThis);
