(function (root) {
  'use strict';

  // アイコンは自前のインライン SVG で描く。外部のアイコンライブラリを参照しない。
  // 24×24 の viewBox、線のみ、currentColor。幾何形状にとどめる。
  // Phase 0 の画面に出るものだけを定義する。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DEFAULT_STROKE_WIDTH = 1.75;

  const ICONS = {
    open: [['path', { d: 'M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z' }]],
    save: [
      ['path', { d: 'M12 4v10m0 0l-4-4m4 4l4-4' }],
      ['path', { d: 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2' }],
    ],
    chevronLeft: [['path', { d: 'M14 6l-6 6 6 6' }]],
    chevronRight: [['path', { d: 'M10 6l6 6-6 6' }]],
    chevronDown: [['path', { d: 'M6 9l6 6 6-6' }]],
    // 検索の「前へ」。chevronDown を上下に反転した形にする（spec-1-4 F）。
    chevronUp: [['path', { d: 'M6 15l6-6 6 6' }]],
    close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
    plus: [['path', { d: 'M12 5v14M5 12h14' }]],
    search: [
      ['circle', { cx: 11, cy: 11, r: 6 }],
      ['path', { d: 'M15.5 15.5L21 21' }],
    ],
    fitWidth: [['path', { d: 'M3 12h18M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4' }]],
    fitPage: [
      ['rect', { x: 4, y: 4, width: 16, height: 16, rx: 1.5 }],
      ['path', { d: 'M9 9h6v6H9z' }],
    ],
    // 見開き（spec-2-3 確定事項28）。2枚の紙が横に並ぶ。
    facing: [
      ['rect', { x: 3, y: 5, width: 8.5, height: 14, rx: 1.2 }],
      ['rect', { x: 12.5, y: 5, width: 8.5, height: 14, rx: 1.2 }],
    ],
    modeView: [
      ['rect', { x: 5, y: 3, width: 14, height: 18, rx: 1.5 }],
      ['path', { d: 'M9 8h6M9 12h6M9 16h4' }],
    ],
    modePages: [
      ['rect', { x: 3.5, y: 4, width: 7, height: 7, rx: 1 }],
      ['rect', { x: 13.5, y: 4, width: 7, height: 7, rx: 1 }],
      ['rect', { x: 3.5, y: 13, width: 7, height: 7, rx: 1 }],
      ['rect', { x: 13.5, y: 13, width: 7, height: 7, rx: 1 }],
    ],
    modeAnnot: [
      ['path', { d: 'M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z' }],
      ['path', { d: 'M13.5 7l3.5 3.5' }],
    ],
    modeTools: [
      ['path', { d: 'M4 7h10M18 7h2M4 12h4M12 12h8M4 17h9M17 17h3' }],
      ['circle', { cx: 16, cy: 7, r: 2 }],
      ['circle', { cx: 10, cy: 12, r: 2 }],
      ['circle', { cx: 15, cy: 17, r: 2 }],
    ],
    rotateLeft: [
      ['path', { d: 'M4 9a8 8 0 1 1 1.2 6' }],
      ['path', { d: 'M4 4v5h5' }],
    ],
    rotateRight: [
      ['path', { d: 'M20 9a8 8 0 1 0-1.2 6' }],
      ['path', { d: 'M20 4v5h-5' }],
    ],
    extract: [
      ['path', { d: 'M9 4h8a1 1 0 0 1 1 1v10' }],
      ['rect', { x: 5, y: 8, width: 9, height: 12, rx: 1 }],
    ],
    trash: [['path', { d: 'M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13' }]],
    // 結合（spec-2-1 確定事項43）。2つの紙が1本の線に合流する。
    merge: [
      ['path', { d: 'M5 5h5v5H5zM5 14h5v5H5z' }],
      ['path', { d: 'M10 7.5h3a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h2M10 16.5h3' }],
      ['path', { d: 'M17 14l2.5 2.5L17 19' }],
    ],
    // 分割（spec-2-2 確定事項40）。結合の裏返しで、1つの紙から2本へ分かれる。
    split: [
      ['path', { d: 'M4 9.5h5v5H4z' }],
      ['path', { d: 'M9 12h2.5a2 2 0 0 0 2-2V7a2 2 0 0 1 2-2H19M11.5 12a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2H19' }],
      ['path', { d: 'M16.5 2.5L19 5l-2.5 2.5M16.5 16.5L19 19l-2.5 2.5' }],
    ],
    // 行を掴むつまみ（結合画面の並べ替え）。
    grip: [
      ['circle', { cx: 9, cy: 6, r: 1.2 }], ['circle', { cx: 15, cy: 6, r: 1.2 }],
      ['circle', { cx: 9, cy: 12, r: 1.2 }], ['circle', { cx: 15, cy: 12, r: 1.2 }],
      ['circle', { cx: 9, cy: 18, r: 1.2 }], ['circle', { cx: 15, cy: 18, r: 1.2 }],
    ],
    // 挿入。extract（紙を取り出す）と対になる向きにする。
    insert: [
      ['rect', { x: 4, y: 9, width: 16, height: 11, rx: 1 }],
      ['path', { d: 'M12 3v5m0 0l-2.5-2.5M12 8l2.5-2.5' }],
    ],
    // 元に戻す・やり直し。左向きの弧と矢じり、およびその左右反転。
    undo: [
      ['path', { d: 'M9 14l-4-4 4-4' }],
      ['path', { d: 'M5 10h8a5 5 0 0 1 0 10h-3' }],
    ],
    redo: [
      ['path', { d: 'M15 14l4-4-4-4' }],
      ['path', { d: 'M19 10h-8a5 5 0 0 0 0 10h3' }],
    ],
    // プリンタ。幾何形状にとどめる（docs/06 2-2。他社製品の意匠に寄せない）。
    print: [
      ['path', { d: 'M7 9V4h10v5' }],
      ['path', { d: 'M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2' }],
      ['rect', { x: 7, y: 14, width: 10, height: 6, rx: 1 }],
    ],
  };

  function has(name) {
    return Object.prototype.hasOwnProperty.call(ICONS, name);
  }

  // innerHTML ではなく createElementNS で組む。属性をテストから直接検査でき、
  // CSP の観点でも素直である。
  function createIcon(doc, name, { size = 17, strokeWidth = DEFAULT_STROKE_WIDTH } = {}) {
    if (!has(name))
      throw new Error(`未定義のアイコンです: ${name}`);

    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(strokeWidth));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    for (const [tag, attrs] of ICONS[name]) {
      const shape = doc.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs))
        shape.setAttribute(key, String(value));
      svg.appendChild(shape);
    }
    return svg;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.icons = { names: Object.keys(ICONS), has, create: createIcon, DEFAULT_STROKE_WIDTH };
})(typeof window !== 'undefined' ? window : globalThis);
