(function (root) {
  'use strict';

  // pdf.js の getAnnotations() が返す値を、自前の entry の部品にする純粋層（spec-4-1 確定事項17、spec-4-4 確定事項20）。
  // imported-entry.js から移した（spec-4b-1a 確定事項36。中身は変えていない）。imported-entry.js と imported-shape.js が使う。

  function hexOf(color) {
    if (color === null || color === undefined || color.length < 3)
      return '#000000';
    return `#${[...color].slice(0, 3).map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  }

  // pdf.js の quadPoints（正規化済み。四角ごとに 8 つ）を四角の並びにする。
  function quadsOf(points) {
    const quads = [];
    for (let index = 0; index + 8 <= (points?.length ?? 0); index += 8)
      quads.push([...points.slice(index, index + 8)].map((value) => Math.round(value * 100) / 100));
    return quads;
  }

  function roundRect(rect) {
    return [...rect].map((value) => Math.round(value * 100) / 100);
  }

  function isRect(rect) {
    return Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite);
  }

  function contentsOf(annotation) {
    return String(annotation.contentsObj?.str ?? '').replace(/\r\n?/g, '\n');
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.importedValues = { hexOf, quadsOf, roundRect, isRect, contentsOf };
})(typeof window !== 'undefined' ? window : globalThis);
