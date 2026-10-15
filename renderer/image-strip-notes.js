(function (root) {
  'use strict';

  // 「変換する画像」の帯に書く、画像ごとの注意と説明の文（spec-2-5 確定事項H5・H8）。DOM には触れない。描くのは image-strip.js。

  const convert = () => root.SigK.toolsConvert;
  const plan = () => root.SigK.convertPlan;

  // 出力名が重なる画像（「画像ごと」のときだけ。spec-3-1 確定事項20）。
  function duplicateIds(rows) {
    if (convert().settings().output !== 'each')
      return new Set();
    const names = plan().outputNames(rows);
    const dupes = new Set(plan().duplicateNames(names).map((name) => name.toLowerCase()));
    return new Set(rows.filter((_row, index) => dupes.has(names[index].toLowerCase())).map((row) => row.id));
  }

  // 画像の注意（H8）。読めない・大きすぎる（行の blocked）、出力名の重なり、用紙に収まらない。無ければ null。
  function problemOf(row, dupes) {
    if (row.blocked !== null)
      return row.blocked;
    if (dupes.has(row.id))
      return '出力名がほかの画像と重なります';
    if (row.width === null)
      return null;
    return plan().planPage({ width: row.width, height: row.height }, convert().settings()).error ?? null;
  }

  // rows と同じ順の注意（無ければ null）の並び。
  function problemsOf(rows) {
    const dupes = duplicateIds(rows);
    return rows.map((row) => problemOf(row, dupes));
  }

  // カーソルを当てると出る説明。前の一覧の列（画素数・形式・この紙。spec-3-1 確定事項3・21）をここへ移した。
  function describe(row) {
    if (row.pending || row.width === null)
      return row.path;
    const pages = row.pages > 1 ? `・${row.pages} ページ` : '';
    const planned = plan().planPage({ width: row.width, height: row.height }, convert().settings());
    const paper = planned.error === undefined ? `\nこの紙: ${plan().describePage(planned, convert().settings().paper)}` : '';
    return `${row.path}\n${row.width}×${row.height}・${String(row.kind).toUpperCase()}${pages}${paper}`;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageStripNotes = { problemsOf, describe };
})(typeof window !== 'undefined' ? window : globalThis);
