'use strict';

// 起動確認 SIGK_SMOKE_IMAGE_EDIT の筋書き exif（spec-7-4 確定事項X1〜X3。2026-11-12 の不具合の再現と、直したことの確認）。
// smoke-image-edit.js が呼ぶ。
//
// 横 300・縦 200 の画素に、EXIF の向き 6（右に 90 度回して見せる）を付けた JPEG を作って開き、次の 3 つを見る。
//   opened    ページの回転が 90 か。画面の紙（pdf.js の絵）と保存用の絵（image-render.js）が、画素を右に 90 度回した絵と一致するか
//   written   ［右回転］を押して上書き保存した画像が、画素を 180 度回した絵（横 300・縦 200）と一致し、向きの情報を持たないか
//   reopened  保存のあと開き直したタブは、ページの回転が 0 で、画面の紙が 180 度回した絵と一致するか
// 絵は、境目を半分の位置からずらして塗り分ける。縦横比が崩れると境目が動くので、一致しない点が増える。

const fs = require('node:fs');
const path = require('node:path');

const { jpegOrientation } = require('./worker/jpeg-orientation.js');

const WIDTH = 300;
const HEIGHT = 200;
const COLORS = { red: [255, 0, 0], green: [0, 160, 0], blue: [0, 0, 255], white: [255, 255, 255] };
// 比べる点（幅と高さに対する割合。10×10 点）。
const GRID = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];

// 回す前の画素の色の名前。上の段は左上の小さな区画だけ赤、下の段は左から 7 割が青。
function patternAt(x, y) {
  if (y < 100)
    return x < 90 && y < 60 ? 'red' : 'green';
  return x < 210 ? 'blue' : 'white';
}

function patternImage(nativeImage) {
  const buffer = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const [r, g, b] = COLORS[patternAt(x, y)];
      buffer.set([b, g, r, 255], (y * WIDTH + x) * 4);
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: WIDTH, height: HEIGHT });
}

// JPEG に、向きのタグ（EXIF の Orientation）だけを持つ APP1 を入れる。JFIF の APP0 があれば、その後ろに入れる。
function withExifOrientation(jpeg, orientation) {
  const app1 = Buffer.from([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const head = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2;
  return Buffer.concat([jpeg.subarray(0, head), app1, jpeg.subarray(head)]);
}

// 時計回りに angle 度回した絵の点 (u, v) が、回す前のどの画素かを返す。
function sourceOf(u, v, angle) {
  if (angle === 90)
    return [v, HEIGHT - 1 - u];
  if (angle === 180)
    return [WIDTH - 1 - u, HEIGHT - 1 - v];
  if (angle === 270)
    return [WIDTH - 1 - v, u];
  return [u, v];
}

// 画素の色を、いちばん近い色の名前にする。
function colorName([r, g, b]) {
  let best = null;
  let bestDistance = Infinity;
  for (const [name, [nr, ng, nb]] of Object.entries(COLORS)) {
    const distance = (r - nr) ** 2 + (g - ng) ** 2 + (b - nb) ** 2;
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}

// 点の色（samples は GRID の行ごとの [r, g, b]）を、angle 度回した絵の色と比べ、一致しない点の数を返す。大きさが違えば null。
function mismatches({ size, samples }, angle) {
  const expected = angle === 90 || angle === 270 ? [HEIGHT, WIDTH] : [WIDTH, HEIGHT];
  if (size[0] !== expected[0] || size[1] !== expected[1])
    return null;
  let count = 0;
  GRID.forEach((fy, row) => GRID.forEach((fx, column) => {
    const [x, y] = sourceOf(Math.floor(size[0] * fx), Math.floor(size[1] * fy), angle);
    if (colorName(samples[row][column]) !== patternAt(x, y))
      count += 1;
  }));
  return count;
}

// 映しているタブ（target があれば開いてから）の、ページの回転・画面の紙の点の色・保存用の絵の点の色を調べる。
const probeScript = (target) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SigK = window.SigK;
  if (${JSON.stringify(target)} !== null) {
    await SigK.tabs.openPath(${JSON.stringify(target)});
    await wait(700);
    SigK.shell.setMode(document, 'annot');
    await wait(300);
  }
  const grid = ${JSON.stringify(GRID)};
  const samplesOf = (canvas) => { const ctx = canvas.getContext('2d');
    return grid.map((fy) => grid.map((fx) => Array.from(ctx.getImageData(Math.floor(canvas.width * fx), Math.floor(canvas.height * fy), 1, 1).data).slice(0, 3))); };
  const file = SigK.viewer.getState().file;
  const page = await SigK.viewer.getPage(1);
  const screen = await SigK.pageImage.renderToCanvas(document, page, { scale: 1, rotation: SigK.viewer.viewportRotation(1, page) });
  const rendered = await SigK.imageRender.render(document, 'png');
  const bitmap = await createImageBitmap(new Blob([rendered.bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  return { frames: file.image?.frames ?? null, pageRotate: page.rotate, dirty: SigK.viewer.isDirty(),
    screen: { size: [screen.width, screen.height], samples: samplesOf(screen.canvas) }, render: { size: [canvas.width, canvas.height], samples: samplesOf(canvas) } };
})()`;

// 保存した画像の点の色（nativeImage で読む）。
function fileSamples(pixels) {
  const samples = GRID.map((fy) => GRID.map((fx) => {
    const { r, g, b } = pixels.at(Math.floor(pixels.width * fx), Math.floor(pixels.height * fy));
    return [r, g, b];
  }));
  return { size: [pixels.width, pixels.height], samples };
}

// 調べた結果を、大きさと一致しない点の数にまとめる。
function summarize(probe, angle) {
  return {
    frames: probe.frames, pageRotate: probe.pageRotate, dirty: probe.dirty,
    screen: { size: probe.screen.size, mismatches: mismatches(probe.screen, angle) },
    render: { size: probe.render.size, mismatches: mismatches(probe.render, angle) },
  };
}

async function run({ js, dir, nativeImage, saveScript, pixelsOf }) {
  const target = path.join(dir, 'exif6.jpg');
  fs.writeFileSync(target, withExifOrientation(patternImage(nativeImage).toJPEG(95), 6));
  const opened = summarize(await js(probeScript(target)), 90);
  const rotated = await js('window.SigK.pageActions.rotateCurrent(90)');
  const saved = await js(saveScript('overwrite', 'ok'));
  const written = fileSamples(pixelsOf(nativeImage, target));
  const reopened = summarize(await js(probeScript(null)), 180);
  return {
    opened, rotated, saved: saved.result,
    written: { size: written.size, mismatches: mismatches(written, 180), orientation: jpegOrientation(fs.readFileSync(target)) },
    reopened,
  };
}

module.exports = { run, patternAt, sourceOf, mismatches };
