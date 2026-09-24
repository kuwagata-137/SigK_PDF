(function (root) {
  'use strict';

  // 透かしの置き方の幾何の画面側（spec-4-5 確定事項12〜19）。DOM に触れない純関数。
  //
  // worker/watermark-layout.js と同じ式を持ち、一致は test/watermark-geometry.test.js が見張る
  // （プロセスが違うので import はしない。note-graphics.js と note-appearance.js と同じ流儀）。
  // プレビュー（watermark-preview.js）は表示の座標での中心・倍率・角度（displayPlacementOf）を使う。
  //
  // 座標の約束（worker/watermark-layout.js と同じ）:
  //   box      … 基準の箱（CropBox。pdf.js の page.view）[x0, y0, x1, y1]。紙の座標で y は上向き
  //   表示     … ページの /Rotate を当てたあとの見た目。左上が原点で y は下向き
  //   素の箱   … 透かしの XObject の中の座標で width × height。中心が原点

  const SIZE_RATIOS = Object.freeze({ small: 0.25, medium: 0.5, large: 0.8 });
  const MARGIN_RATIO = 0.05;
  const ANGLES = Object.freeze({ diagonal: 45, horizontal: 0 });
  const POSITIONS = Object.freeze([
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right',
  ]);
  // 文字の素の箱（worker/glyph-outline.js と同じ。大きさ 100 で組み、高さは ascent＋descent）。
  // ベースラインは中心から 43.6 下（画面は y が下向きなので +43.6）。
  const TEXT_SIZE = 100;
  const TEXT_HEIGHT = 144.8;
  const TEXT_BASELINE = 43.6;
  // 画像の素の箱の幅（worker/watermark-appearance.js と同じ）。
  const IMAGE_WIDTH = 100;

  function normalizeRotation(rotate) {
    if (!Number.isFinite(rotate))
      return 0;
    const value = ((Math.round(rotate) % 360) + 360) % 360;
    return value % 90 === 0 ? value : 0;
  }

  function isBox(box) {
    return Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)
      && box[0] !== box[2] && box[1] !== box[3];
  }

  function displaySize(box, rotate) {
    const width = Math.abs(box[2] - box[0]);
    const height = Math.abs(box[3] - box[1]);
    return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
  }

  function outerSize(width, height, angle) {
    const radians = (angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    return { width: width * cos + height * sin, height: width * sin + height * cos };
  }

  function centerOf(display, outer, scale, position) {
    const index = POSITIONS.indexOf(position);
    const column = index % 3;
    const row = Math.floor(index / 3);
    const margin = MARGIN_RATIO * Math.min(display.width, display.height);
    const halfWidth = (scale * outer.width) / 2;
    const halfHeight = (scale * outer.height) / 2;
    const x = [margin + halfWidth, display.width / 2, display.width - margin - halfWidth][column];
    const y = [margin + halfHeight, display.height / 2, display.height - margin - halfHeight][row];
    return [x, y];
  }

  function toPaper([x, y], box, rotate) {
    const x0 = Math.min(box[0], box[2]);
    const y0 = Math.min(box[1], box[3]);
    const x1 = Math.max(box[0], box[2]);
    const y1 = Math.max(box[1], box[3]);
    switch (rotate) {
      case 90: return [x0 + y, y0 + x];
      case 180: return [x1 - x, y0 + y];
      case 270: return [x1 - y, y1 - x];
      default: return [x0 + x, y1 - y];
    }
  }

  // 表示の座標での置き方。戻り値は { cx, cy, scale, angle, rotation, display } か null（形が違う）。
  function displayPlacementOf({ box, rotate = 0, width, height, angle, size, position }) {
    if (!isBox(box) || !(width > 0) || !(height > 0) || !Number.isFinite(angle))
      return null;
    if (!Object.hasOwn(SIZE_RATIOS, size) || !POSITIONS.includes(position))
      return null;
    const rotation = normalizeRotation(rotate);
    const display = displaySize(box, rotation);
    const outer = outerSize(width, height, angle);
    const scale = SIZE_RATIOS[size] * Math.min(display.width / outer.width, display.height / outer.height);
    const [cx, cy] = centerOf(display, outer, scale, position);
    return { cx, cy, scale, angle, rotation, display };
  }

  // 紙の cm の 6 数（worker/watermark-layout.js の placementOf と同じ値）。
  function placementOf(args) {
    const placed = displayPlacementOf(args);
    if (placed === null)
      return null;
    const [x, y] = toPaper([placed.cx, placed.cy], args.box, placed.rotation);
    const phi = ((args.angle + placed.rotation) * Math.PI) / 180;
    const cos = Math.cos(phi) * placed.scale;
    const sin = Math.sin(phi) * placed.scale;
    return [cos, sin, -sin, cos, x, y];
  }

  // 画像の素の箱の高さ（worker/watermark-appearance.js の imageMarkOf と同じ丸め）。
  function imageBoxHeight(width, height) {
    return Math.round(((IMAGE_WIDTH * height) / width) * 100) / 100;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.watermarkGeometry = {
    SIZE_RATIOS, MARGIN_RATIO, ANGLES, POSITIONS, TEXT_SIZE, TEXT_HEIGHT, TEXT_BASELINE, IMAGE_WIDTH,
    displayPlacementOf, placementOf, imageBoxHeight,
  };
})(typeof window !== 'undefined' ? window : globalThis);
