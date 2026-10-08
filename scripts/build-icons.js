'use strict';

// アプリと PDF ファイルのアイコン（ICO）を、build/ の SVG から作る（docs/spec-5-2-open-with-icon.md 確定事項B3〜B5）。
//   npm run icons（= electron scripts/build-icons.js）
// 出来上がりの ICO はリポジトリに置き、ビルドのたびには作らない（ビルドステップを置かない方針。.claude/CLAUDE.md 付則A）。
// SVG を直したら回し直して、ICO と build/icon-sources.json も一緒にコミットする（test/app-icon.test.js が作り忘れを見つける）。
//
// 描き方: offscreen の窓（透明の地）に、大きさごとの <img> を 1 枚に並べて 1 回描き、切り出して PNG にする。
// 環境変数 SIGK_ICON_PNG_DIR を渡すと、切り出した PNG もそこへ書く（目で確かめるため）。

const { app, BrowserWindow, nativeImage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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
const SOURCES_FILE = 'build/icon-sources.json';
const GAP = 8;
const ROW_HEIGHT = Math.max(...SIZES) + GAP;
const WIDTH = SIZES.reduce((sum, size) => sum + size + GAP, GAP);
const HEIGHT = ROW_HEIGHT * ICONS.length + GAP;
// 絵の画素のうち、色の付いた（透明でない）画素の割合の下限。今の絵は 52〜75%。描きかけの 1 枚を詰めないため。
const MIN_INK_RATIO = 0.3;
const SETTLE_MS = 800;
const LIMIT_MS = 60000;

// 画面の倍率や色の管理で画素が変わらないようにする。設定やキャッシュは一時フォルダーへ（%APPDATA%\Electron に作らない）。
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.tmpdir(), 'sigk-build-icons'));

// 止まったときに窓（「A JavaScript error occurred」）を出さず、文字だけ出して終わる。
function fail(err) {
  console.error(err?.message ?? String(err));
  app.exit(1);
}
process.on('uncaughtException', fail);
setTimeout(() => fail(new Error(`${LIMIT_MS / 1000} 秒で終わりませんでした`)), LIMIT_MS).unref();

const readSource = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const dataUrl = (file) => `data:image/svg+xml;base64,${Buffer.from(readSource(file)).toString('base64')}`;

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
// 絵を読み終えた直後や描き直しの直後には、空や透明のままの画像が 1 枚返ってくることがある（どちらも試してみた）。
// 受け取った画像は描画の共有メモリを指したままのことがあるので、写しを取ってから使う。
function paintOnce(win) {
  return new Promise((resolve) => {
    let armed = false;
    win.webContents.on('paint', function onPaint(_event, _dirty, image) {
      const size = image.getSize();
      if (!armed || size.width < WIDTH || size.height < HEIGHT)
        return;
      win.webContents.off('paint', onPaint);
      resolve(nativeImage.createFromBitmap(image.toBitmap(), size));
    });
    setTimeout(() => { armed = true; win.webContents.invalidate(); }, SETTLE_MS);
  });
}

// 透明でない画素の割合（BGRA の 4 バイトごとの A）。
function inkRatio(image) {
  const bitmap = image.toBitmap();
  let ink = 0;
  for (let at = 3; at < bitmap.length; at += 4) {
    if (bitmap[at] !== 0)
      ink += 1;
  }
  return ink / (bitmap.length / 4);
}

// 1 つのアイコンの 8 枚を切り出して確かめ、ICO にする（まだ書かない）。
function buildIco(sheet, cells, icon) {
  const pngs = cells.filter((cell) => cell.icon === icon).map(({ size, x, y }) => {
    const cut = sheet.crop({ x, y, width: size, height: size });
    const ratio = inkRatio(cut);
    if (ratio < MIN_INK_RATIO)
      throw new Error(`${icon.out} の ${size}px は色の付いた画素が ${Math.round(ratio * 100)}% しかない（描けていない）`);
    const png = cut.toPNG();
    const info = pngInfo(png);
    if (info.width !== size || info.height !== size)
      throw new Error(`${icon.out} の ${size}px が ${info.width}×${info.height} で切り出された（画面の倍率が 1 でない）`);
    return { size, png };
  });
  return { icon, pngs, ico: packIco(pngs.map(({ png }) => png)) };
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
  // 絵と絵の間の隙間は透明のはず。地が白などで塗られていたら、どの絵にも四角い地が付いてしまう。
  if (inkRatio(sheet.crop({ x: 0, y: 0, width: GAP, height: GAP })) !== 0)
    throw new Error('地が透明になっていません');

  // 全部を確かめてから書く（途中で止まって、片方の ICO だけ新しくなるのを避ける）。
  const built = ICONS.map((icon) => buildIco(sheet, cells, icon));
  const pngDir = process.env.SIGK_ICON_PNG_DIR;
  for (const { icon, pngs, ico } of built) {
    if (pngDir) {
      fs.mkdirSync(pngDir, { recursive: true });
      for (const { size, png } of pngs)
        fs.writeFileSync(path.join(pngDir, `${path.basename(icon.out, '.ico')}-${size}.png`), png);
    }
    fs.writeFileSync(path.join(ROOT, icon.out), ico);
    console.log(`${icon.out}: ${SIZES.join('・')}px（${ico.length} バイト）`);
  }
  // どの SVG から作ったかの控え。改行を LF にそろえた中身の SHA-256。
  const sources = Object.fromEntries(ICONS.flatMap(({ large, small }) => [large, small])
    .map((file) => [file, crypto.createHash('sha256').update(readSource(file)).digest('hex')]));
  fs.writeFileSync(path.join(ROOT, SOURCES_FILE), `${JSON.stringify(sources, null, 2)}\n`);
}

app.whenReady().then(main).then(() => app.quit(), fail);
