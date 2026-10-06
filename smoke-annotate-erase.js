'use strict';

// 起動確認のマーカー・消しゴム・道具の段の「その他」の操作と結果の欄（spec-4b-5b 確定事項33・完了判定1・3・4・7・9〜11）。
// smoke-annotate.js が annotateScript に埋める。
//
// ERASE_STATE は操作の前に置く変数、ERASE_STEPS は smoke-annotate-steps.js の分岐の続き（else if の並び）で、埋め込む先のスクリプトにある
// SigK・name・arg・wait・round・pageNode・screenPoint・mouse を使う。操作は次のもの。
//   marker:0:230x420;330x420     マーカーの道具でページ 0 の pt の点列をなぞる（; 区切り）
//   erase:0:150x480;150x520      消しゴムの道具でなぞる。erase-draft なら離さない（なぞっている途中の下見と輪のカーソル。画面写真用）
//   bar-width:944                道具の段の幅を 944px にして隠れた道具を控える（空なら元の幅に戻す。窓の幅は描き手から変えられないため）
//   more:eraser                  「その他」を押して一覧を控え、その道具の行を押す（open なら開いたまま。画面写真用）
//   reink                        いまのタブを閉じて開き直し、ペン・マーカーを控える（往復）
//   marker-pixels:2              1 ページ目を、保存した PDF を pdf.js が外観ごと描いた絵と、外観を描かずに SigK の印刷の描き手でマーカーを
//                                重ねた絵とで、倍率 2 で描き、マーカーの箱の中の暗い画素（下の文字）と黄の画素を数える（完了判定1・3）
// ERASE_REPORT は結果の erase の欄を組む文。probe（マーカーの画面の箱）は main.js が画面写真を撮ったあと pixelsIn で数える（完了判定1）。
// 文字列の中には ` と ${ を書かない（テンプレートの中に埋めるため）。

const ERASE_STATE = `
  const inkRounds = [];
  const barFits = [];
  let moreSeen = null;
  let markerPixels = null;
  const inkOf = (entry) => (entry.readonly === true ? { kind: 'other', subtype: entry.subtype, readonly: true } : {
    kind: entry.kind, src: entry.src, blend: entry.blend ?? null, color: entry.color, lineWidth: entry.lineWidth, opacity: entry.opacity,
    rect: entry.rect.map(round), paths: entry.paths.map((path) => path.map((point) => point.map(round))),
  });
  const allEntries = () => [...SigK.viewer.getAnnotations().added, ...Object.values(SigK.viewer.getImported()).flat()];
  const ownInks = () => allEntries().filter((entry) => entry.kind === 'ink' || (entry.readonly === true && entry.subtype === 'Ink')).map(inkOf);
  const markerOn = (src) => allEntries().find((entry) => entry.kind === 'ink' && entry.blend === 'multiply' && entry.src === src && entry.readonly !== true) ?? null;
  // 暗い画素（下の文字）と黄の画素の数。at は 1 画素の [R, G, B] を返す。
  const countInk = (box, at) => {
    let dark = 0;
    let yellow = 0;
    for (let y = box[1]; y < box[3]; y += 1) {
      for (let x = box[0]; x < box[2]; x += 1) {
        const [r, g, b] = at(x, y);
        if (Math.max(r, g, b) < 100)
          dark += 1;
        else if (r > 200 && g > 200 && b < 80)
          yellow += 1;
      }
    }
    return { dark, yellow, total: (box[2] - box[0]) * (box[3] - box[1]) };
  };
`;

const ERASE_STEPS = `
    else if (name === 'marker' || name === 'erase' || name === 'erase-draft') {
      const [page, points] = arg.split(':');
      const index = Number(page);
      const screen = points.split(';').map((point) => point.split('x').map(Number)).map(([x, y]) => screenPoint(index, x, y));
      SigK.annotate.setTool(name === 'marker' ? 'marker' : 'eraser');
      mouse('mousedown', pageNode(index), screen[0][0], screen[0][1]);
      for (const [x, y] of screen.slice(1)) {
        mouse('mousemove', pageNode(index), x, y);
        await wait(30);
      }
      if (name !== 'erase-draft')
        mouse('mouseup', pageNode(index), screen.at(-1)[0], screen.at(-1)[1]);
    } else if (name === 'bar-width') {
      const bar = document.getElementById('edit-bar');
      bar.style.width = arg === '' ? '' : arg + 'px';
      await wait(300);
      SigK.editBarOverflow.fit();
      barFits.push({ width: bar.clientWidth, hidden: SigK.editBarOverflow.hiddenButtons().map((button) => button.dataset.tool), more: !document.querySelector('#edit-bar .edit-more').hidden });
    } else if (name === 'more') {
      document.getElementById('edit-more').click();
      await wait(100);
      const rows = [...document.querySelectorAll('#edit-more-menu .edit-more-row')];
      moreSeen = { rows: rows.map((row) => row.textContent), open: SigK.editBarMore.isOpen(), focus: document.activeElement?.textContent ?? null };
      if (arg !== 'open') {
        const index = SigK.editBarOverflow.hiddenButtons().findIndex((button) => button.dataset.tool === arg);
        rows[index]?.click();
        moreSeen.picked = SigK.annotate.getTool();
        moreSeen.closed = !SigK.editBarMore.isOpen();
        moreSeen.active = document.getElementById('edit-more').classList.contains('active');
      }
    } else if (name === 'reink') {
      const file = SigK.tabs.list().find((tab) => tab.active)?.path ?? null;
      const tab = SigK.tabs.list().find((item) => item.active);
      await SigK.tabs.forceCloseTab(tab.id);
      await wait(300);
      await SigK.tabs.openPath(file);
      await wait(700);
      await SigK.annotationImport.settled();
      await wait(300);
      SigK.shell.setMode(document, 'annot');
      await wait(200);
      inkRounds.push(ownInks());
    } else if (name === 'marker-pixels') {
      const scale = Number(arg) || 2;
      const marker = markerOn(0);
      const file = SigK.tabs.list().find((tab) => tab.active)?.path ?? null;
      const read = await window.pdfAPI.read(file);
      const task = SigK.pdfjs.getDocument({ data: read.bytes });
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale });
      const canvasOf = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        return canvas;
      };
      const modes = SigK.pdfjs.lib.AnnotationMode;
      const byPdfjs = canvasOf();
      await page.render({ canvasContext: byPdfjs.getContext('2d'), viewport, annotationMode: modes.ENABLE }).promise;
      const bySigk = canvasOf();
      await page.render({ canvasContext: bySigk.getContext('2d'), viewport, annotationMode: modes.DISABLE }).promise;
      if (marker !== null)
        SigK.annotationLayer.paint(bySigk.getContext('2d'), [marker], viewport);
      const width = byPdfjs.width;
      const [left, bottom] = marker === null ? [0, 0] : viewport.convertToViewportPoint(marker.rect[0], marker.rect[1]);
      const [right, top] = marker === null ? [0, 0] : viewport.convertToViewportPoint(marker.rect[2], marker.rect[3]);
      const box = [Math.ceil(left), Math.ceil(top), Math.floor(right), Math.floor(bottom)];
      const pixelsOf = (canvas) => {
        const data = canvas.getContext('2d').getImageData(0, 0, width, canvas.height).data;
        return countInk(box, (x, y) => [data[(y * width + x) * 4], data[(y * width + x) * 4 + 1], data[(y * width + x) * 4 + 2]]);
      };
      markerPixels = { scale, found: marker !== null, pdfjs: pixelsOf(byPdfjs), sigk: pixelsOf(bySigk) };
      await task.destroy();
    }
`;

const ERASE_REPORT = `
  const eraseMarker = markerOn(0);
  const eraseGroup = eraseMarker === null ? null : document.querySelector('.annot-layer g[data-annot="' + (eraseMarker.ref ?? eraseMarker.id) + '"]');
  const eraseRing = document.querySelector('.eraser-ring');
  const eraseReport = {
    inks: ownInks(),
    rounds: inkRounds,
    roundsSame: inkRounds.every((round) => JSON.stringify(round) === JSON.stringify(inkRounds[0])),
    markerPixels,
    bars: barFits,
    more: moreSeen,
    tool: SigK.annotate.getTool(),
    erasing: SigK.annotateErase.isErasing(),
    ring: eraseRing === null ? null : { shown: getComputedStyle(eraseRing).display !== 'none', width: eraseRing.getBoundingClientRect().width, height: eraseRing.getBoundingClientRect().height },
    markerBlend: eraseGroup === null ? null : getComputedStyle(eraseGroup).mixBlendMode,
    // マーカーの画面の箱（CSS px）。main.js が画面写真の画素を数える。
    probe: (() => {
      if (eraseMarker === null)
        return null;
      const index = SigK.viewer.getPlan().findIndex((page) => page.src === eraseMarker.src);
      const [x1, y1] = screenPoint(index, eraseMarker.rect[0], eraseMarker.rect[3]);
      const [x2, y2] = screenPoint(index, eraseMarker.rect[2], eraseMarker.rect[1]);
      return { box: [x1, y1, x2, y2].map(round), viewWidth: window.innerWidth, viewHeight: window.innerHeight };
    })(),
  };
`;

// 画面写真（Electron の NativeImage）の中の、probe の箱（CSS px）の暗い画素と黄の画素を数える（完了判定1。画面の乗算が効いていれば、
// マーカーの下の文字が暗いまま残る）。toBitmap は B・G・R・A の順。箱が画面の外なら null。
function pixelsIn(image, probe) {
  const size = image.getSize();
  const factor = size.width / probe.viewWidth;
  const [x1, y1, x2, y2] = probe.box.map((value) => Math.round(value * factor));
  const box = [Math.max(0, x1 + 1), Math.max(0, y1 + 1), Math.min(size.width, x2 - 1), Math.min(size.height, y2 - 1)];
  if (box[2] <= box[0] || box[3] <= box[1])
    return null;
  const bitmap = image.toBitmap();
  let dark = 0;
  let yellow = 0;
  for (let y = box[1]; y < box[3]; y += 1) {
    for (let x = box[0]; x < box[2]; x += 1) {
      const at = (y * size.width + x) * 4;
      const [b, g, r] = [bitmap[at], bitmap[at + 1], bitmap[at + 2]];
      if (Math.max(r, g, b) < 100)
        dark += 1;
      else if (r > 200 && g > 200 && b < 80)
        yellow += 1;
    }
  }
  return { dark, yellow, total: (box[2] - box[0]) * (box[3] - box[1]), factor: Math.round(factor * 100) / 100 };
}

module.exports = { ERASE_STATE, ERASE_STEPS, ERASE_REPORT, pixelsIn };
