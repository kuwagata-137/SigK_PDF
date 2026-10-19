(function (root) {
  'use strict';

  // 帯のページの写しを作る（spec-2-5 確定事項I5。PR-4）。枠の帯（＝映しているタブ）の今の中身（保存していない並べ替え・回転・切り取り・
  // 書き込み・差し込み）から、選んだページをワーカー（worker/op-copy.js の copy-pages）に PDF のバイト列にさせる。ファイルは書かない。
  //
  // 写した先の差し込みにするときは pdf.js で開いて返す（open: true）。pdf.js は渡したバイト列の中身を自分のワーカーへ移して空にするので、
  // 保存に使う分は渡す前に写しておく。新しい帯にするときは開かずにバイト列だけを返す（タブを開く viewer.open が同じように写して持つ）。

  let made = 0;

  function viewer() {
    return root.SigK.viewer;
  }

  // indices は枠の帯の並びの位置（0 起点）。戻り値は { ok, copy, bytes, sizes, doc? } か { error } か { canceled }。
  async function build(indices, { open = true } = {}) {
    const view = viewer().getState();
    if (view.open !== true)
      return { error: '文書が開かれていません。' };
    // 入力中のテキストは確定してから写す（保存と同じ。spec-4-2 確定事項8）。
    root.SigK.annotate?.finishEditing();
    const plan = viewer().getPlan();
    const pages = indices.map((index) => plan[index]).filter((page) => page !== undefined);
    if (pages.length === 0)
      return { error: '写すページが選ばれていません。' };

    const result = await root.SigK.save.runTask({
      kind: 'copy-pages',
      source: view.file.path ?? null,
      sourceCopy: view.file.copy ?? null,
      copies: viewer().getCopies(),
      pages,
      inserts: viewer().getInserts(),
      annotations: root.SigK.annotationState.toSaveSpec(viewer().getAnnotations(), { layoutOf: root.SigK.freeTextMetrics.layoutOfEntry }),
      label: '写す',
    });
    if (result?.canceled === true)
      return { canceled: true };
    if (result?.ok !== true)
      return { error: result?.error ?? 'ページを写せませんでした。' };

    made += 1;
    const copy = `copy-${made}`;
    const bytes = ArrayBuffer.isView(result.bytes) ? result.bytes : new Uint8Array(result.bytes);
    if (!open)
      return { ok: true, copy, bytes, sizes: result.sizes };
    const kept = bytes.slice();
    try {
      const doc = await root.SigK.pdfjs.getDocument({ data: bytes }).promise;
      return { ok: true, copy, bytes: kept, sizes: result.sizes, doc };
    } catch (error) {
      return { error: '写したページを表示できませんでした。' };
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageCopyBuild = { build };
})(typeof window !== 'undefined' ? window : globalThis);
