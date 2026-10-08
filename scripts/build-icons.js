'use strict';

// アプリと PDF ファイルのアイコン（ICO）を、build/ の SVG から作る（docs/spec-5-2-open-with-icon.md 確定事項B3〜B5）。
//   npm run icons（= electron scripts/build-icons.js）
// 出来上がりの ICO はリポジトリに置き、ビルドのたびには作らない（ビルドステップを置かない方針。.claude/CLAUDE.md 付則A）。
// SVG を直したら回し直して、ICO も一緒にコミットする。
//
// 描き方: offscreen の窓（透明の地）に、大きさごとの <img> を 1 枚に並べて 1 回描き、切り出して PNG にする。
// 環境変数 SIGK_ICON_PNG_DIR を渡すと、切り出した PNG もそこへ書く（目で確かめるため）。

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { packIco, pngInfo } = require('./ico-file.js');

const ROOT = path.join(__dirname, '..');
// 100〜250% の表示倍率で Windows が選ぶ大きさ。24px 以下は小さい用の絵で描く。
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const SMALL_MAX = 24;
const ICONS = [
  { out: 'assets/icon.ico', large: 'build/icon-app.svg', small: 'build/icon-app-small.svg' },
  { out: 'build/pdf-file.ico', large: 'build/icon-pdf-file.svg', small: 'build/icon-pdf-file-small.svg' },
];
const GAP = 8;
const ROW_HEIGHT = Math.max(...SIZES) + GAP;
const WIDTH = SIZES.reduce((sum, size) => sum + size + GAP, GAP);
const HEIGHT = ROW_HEIGHT * ICONS.length + GAP;

// 画面の倍率や色の管理で画素が変わらないようにする。
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.disableHardwareAcceleration();

const dataUrl = (file) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, file)).toString('base64')}`;

// 並べる場所。行はアイコンごと、列は大きさごと。
function layout() {
  return ICONS.flatMap((icon, row) => {
    let x = GAP;
    return SIZES.map((size) => {
      const cell = { icon, size, x, y: GAP + row * ROW_HEIGHT, src: size <= SMALL_MAX ? icon.small : icon.large };
      x += size + GAP;
      return cell;
    });
  });
}

function pageHtml(cells) {
  const images = cells.map(({ src, size, x, y }) =>
    `<img src="${dataUrl(src)}" width="${size}" height="${size}" style="position:absolute;left:${x}px;top:${y}px">`).join('');
  return `<!doctype html><html><body style="margin:0;background:transparent">${images}</body></html>`;
}

// SVG が読めないと <img> は壊れた画像の印になり、気づかずに ICO へ入ってしまう。全部が読めたかを先に確かめる。
const DECODE_SCRIPT = `Promise.all([...document.images].map((img, index) =>
  img.decode().then(() => (img.naturalWidth > 0 ? null : index), () => index))).then((bad) => bad.filter((index) => index !== null))`;

// 少し待ってから描き直させ、頁の大きさの 1 枚を受け取る。静的な頁は paint が 1〜2 回しか来ず、
// 絵を読み終えた直後や描き直しの直後には、空や透明のままの 1 枚が来ることがある（どちらも試して見た）。
const SETTLE_MS = 800;
function paintOnce(win) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('描けませんでした（20 秒）')), 20000);
    let armed = false;
    win.webContents.on('paint', function onPaint(_event, _dirty, image) {
      const { width, height } = image.getSize();
      if (!armed || width < WIDTH || height < HEIGHT)
        return;
      win.webContents.off('paint', onPaint);
      clearTimeout(timer);
      resolve(image);
    });
    setTimeout(() => { armed = true; win.webContents.invalidate(); }, SETTLE_MS);
  });
}

// どの切り出しにも色の付いた画素があるか（透明のまま描けていない 1 枚を ICO に入れない）。
function hasInk(image) {
  const bitmap = image.toBitmap();
  for (let at = 3; at < bitmap.length; at += 4) {
    if (bitmap[at] !== 0)
      return true;
  }
  return false;
}

async function main() {
  const cells = layout();
  const win = new BrowserWindow({
    show: false, width: WIDTH, height: HEIGHT, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;base64,${Buffer.from(pageHtml(cells)).toString('base64')}`);
  const broken = await win.webContents.executeJavaScript(DECODE_SCRIPT);
  if (broken.length > 0)
    throw new Error(`SVG が読めませんでした: ${[...new Set(broken.map((index) => cells[index].src))].join(', ')}`);
  const sheet = await paintOnce(win);
  const pngDir = process.env.SIGK_ICON_PNG_DIR;
  if (pngDir)
    fs.mkdirSync(pngDir, { recursive: true });

  for (const icon of ICONS) {
    const pngs = cells.filter((cell) => cell.icon === icon).map(({ size, x, y }) => {
      const cut = sheet.crop({ x, y, width: size, height: size });
      if (!hasInk(cut))
        throw new Error(`${icon.out} の ${size}px が透明のまま描けていない`);
      const png = cut.toPNG();
      const info = pngInfo(png);
      if (info.width !== size || info.height !== size)
        throw new Error(`${icon.out} の ${size}px が ${info.width}×${info.height} で切り出された（画面の倍率が 1 でない）`);
      if (pngDir)
        fs.writeFileSync(path.join(pngDir, `${path.basename(icon.out, '.ico')}-${size}.png`), png);
      return png;
    });
    const ico = packIco(pngs);
    fs.writeFileSync(path.join(ROOT, icon.out), ico);
    console.log(`${icon.out}: ${SIZES.join('・')}px（${ico.length} バイト）`);
  }
}

app.whenReady().then(main).then(() => app.quit(), (err) => {
  console.error(err.message);
  app.exit(1);
});
