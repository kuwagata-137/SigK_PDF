'use strict';

// 起動確認 SIGK_SMOKE_IMAGE_EDIT=<出力フォルダ>（spec-7-1 の完了判定 1〜7）。main.js の installSmokeCheck が呼ぶ。
//
// 検証用の画像（test/fixtures。無ければ smokeSampleBitmap と同じく nativeImage で作る）を出力フォルダへ写し、写しをタブで開いて、
// 書き込みの起動確認（smoke-annotate.js）と同じ手順で四角を描き、保存して、書いた画像の画素を nativeImage で読み戻す。ユーザーの実ファイルは
// 使わない（付則C）。保存の窓は main の dialog.showSaveDialog を差し替えて答える（窓を出さない）。確認の窓はボタンをクリックする。
//
// 筋書き:
//   png       PNG に赤い四角を描き［上書き保存］→ 確認の窓で［焼き込んで上書き保存］。画素数・四角の線の色・四角の外の画素・.bak を見る
//   cancel    同じく描いて［上書き保存］→［キャンセル］。ファイルが変わらないことを見る
//   alpha     透明な PNG に描き［名前を付けて保存］で別の PNG。透明な画素が透明のままかを見る
//   jpeg      JPEG に描き［上書き保存］。画素数と、四角の外の画素が元の JPEG とどれだけ違うか（JPEG に書き直すぶんの差）を見る
//   noise     画素がばらばらの JPEG を PNG で保存し、四角の外が元の JPEG を読み解いた画素と同じか（敷き直しが効いているか）を見る
//   bmp       BMP に描き［上書き保存］→ 保存の窓（PNG を選ぶ）。PNG ができたかを見る
//   pdf       PNG に描き［名前を付けて保存］で PDF。/Square の注釈が残るかを見る
//   tools     画像のタブの道具の段で、灰色の道具と吹き出しの鍵を見る
//   exif      EXIF の向きを持つ JPEG を開いて回し、上書き保存する（smoke-image-exif.js。spec-7-4 確定事項X1〜X3）

const fs = require('node:fs');
const path = require('node:path');

// 描く四角（紙の pt）。画像の大きさに合わせ、左から 10〜40%・上から 20〜40% の所に置く（1 画素＝1pt）。
const squareFor = ({ width, height }) => ({ from: [Math.round(width * 0.1), Math.round(height * 0.8)], to: [Math.round(width * 0.4), Math.round(height * 0.6)] });

// 四角を描く（smoke-annotate.js の shape の手順と同じく、紙の pt を画面の座標にしてマウスを送る）。
// 四角の大きさは、アプリが開いた画像の欄（file.image.frames）から決める（nativeImage は BMP・GIF・TIFF を読めないため）。
const drawScript = (target) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SigK = window.SigK;
  await SigK.tabs.openPath(${JSON.stringify(target)});
  await wait(700);
  const size = SigK.viewer.getState().file.image.frames[0];
  const square = (${squareFor.toString()})(size);
  SigK.shell.setMode(document, 'annot');
  await wait(300);
  const page = document.querySelector('.pdf-page[data-page="1"]');
  const viewport = SigK.freeTextEditor.pageOf(0)?.viewport ?? SigK.viewer.getTextLayer(0)?.viewport;
  const point = (x, y) => { const base = page.getBoundingClientRect(); const [cx, cy] = viewport.convertToViewportPoint(x, y); return [base.left + cx, base.top + cy]; };
  const mouse = (type, x, y, buttons) => page.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
  // 四角の道具を持つ（ボタンをクリックすると、前の筋書きで持ったままの道具が外れるので、道具を直に持つ）。
  SigK.annotate.setShapeKind('square');
  if (SigK.annotate.getTool() !== 'shape')
    SigK.annotate.setTool('shape');
  const [x1, y1] = point(square.from[0], square.from[1]);
  const [x2, y2] = point(square.to[0], square.to[1]);
  mouse('mousedown', x1, y1, 1);
  for (let step = 1; step <= 4; step += 1) { mouse('mousemove', x1 + (x2 - x1) * step / 4, y1 + (y2 - y1) * step / 4, 1); await wait(20); }
  mouse('mouseup', x2, y2, 0);
  await wait(200);
  const file = SigK.viewer.getState().file;
  return { added: SigK.viewer.getAnnotations().added.length, dirty: SigK.viewer.isDirty(), image: file.image?.kind ?? null, frames: file.image?.frames ?? null };
})()`;

// 保存を押し、確認の窓が出たら answer（'ok'・'cancel'）を押して、終わるのを待つ。
const saveScript = (mode, answer) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SigK = window.SigK;
  const saving = ${mode === 'saveAs' ? 'SigK.save.saveAsActive()' : 'SigK.save.saveActive()'};
  await wait(400);
  const dialog = document.getElementById('confirm-image-save');
  const confirm = dialog.open ? { title: dialog.querySelector('.dlg-head').textContent, text: document.getElementById('confirm-image-save-text').textContent,
    loss: document.getElementById('confirm-image-save-loss').textContent, backup: document.getElementById('confirm-image-save-backup').hidden ? null : document.getElementById('confirm-image-save-backup').textContent,
    focus: document.activeElement?.id ?? null } : null;
  if (dialog.open)
    document.getElementById(${JSON.stringify(answer === 'cancel' ? 'confirm-image-save-cancel' : 'confirm-image-save-ok')}).click();
  const result = await saving;
  await wait(500);
  const file = SigK.viewer.getState().file;
  return { confirm, result: { ok: result?.ok === true, canceled: result?.canceled === true, error: result?.error ?? null }, banner: SigK.viewBanner.text(),
    tab: { path: file?.path ?? null, image: file?.image?.kind ?? null, dirty: SigK.viewer.isDirty() } };
})()`;

const toolsScript = `(() => {
  const buttons = [...document.querySelectorAll('#edit-bar .edit-tool[data-tool]')];
  return buttons.filter((button) => button.getAttribute('aria-disabled') === 'true').map((button) => ({ tool: button.dataset.tool, tip: button.dataset.tip, desc: window.SigK.tipContent.resolve(button).desc }));
})()`;

// nativeImage の画素（BGRA）を読む口。
function pixelsOf(nativeImage, filePath) {
  const image = nativeImage.createFromPath(filePath);
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const at = (x, y) => { const i = (y * width + x) * 4; return { r: bitmap[i + 2], g: bitmap[i + 1], b: bitmap[i], a: bitmap[i + 3] }; };
  return { width, height, at, bitmap };
}

// 四角の外（四角から 30px 以上離れた所）の画素の、元との差の最大と、差のある画素の数。
function outsideDiff(before, after, box) {
  let max = 0;
  let differing = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      if (x > box[0] - 30 && x < box[2] + 30 && y > box[1] - 30 && y < box[3] + 30)
        continue;
      const a = before.at(x, y);
      const b = after.at(x, y);
      const d = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b), Math.abs(a.a - b.a));
      max = Math.max(max, d);
      if (d > 0)
        differing += 1;
    }
  }
  return { max, differing };
}

// 四角の箱（画素。左・上・右・下）。紙の y は上下が逆。
const boxFor = (image) => { const square = squareFor(image); return [square.from[0], image.height - square.from[1], square.to[0], image.height - square.to[1]]; };
// 四角の上の辺の線の画素（左の端から 20px）。
const edgeOf = (pixels, image) => { const box = boxFor(image); return pixels.at(box[0] + 20, box[1]); };
// 画像を開いて、その大きさに合わせた四角を描く。
const drawOn = (js, _nativeImage, target) => js(drawScript(target));

// 画素がばらばらの画像（決まった種から作る）。JPEG にとっていちばん厳しい中身で、読み解き方の違いが表に出る。
function noiseImage(nativeImage, width, height) {
  const buffer = Buffer.alloc(width * height * 4);
  let seed = 7;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 256; };
  for (let at = 0; at < buffer.length; at += 4) {
    buffer[at] = next();
    buffer[at + 1] = next();
    buffer[at + 2] = next();
    buffer[at + 3] = 255;
  }
  return nativeImage.createFromBitmap(buffer, { width, height });
}

function fixture(root, name) {
  return path.join(root, 'test', 'fixtures', name);
}

async function run({ win, dir, root, dialog, nativeImage }) {
  fs.mkdirSync(dir, { recursive: true });
  const report = {};
  const answers = [];
  const original = dialog.showSaveDialog;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: answers.shift() ?? path.join(dir, 'unexpected.png') });
  const js = (script) => win.webContents.executeJavaScript(script);
  const copy = (name, as) => { const target = path.join(dir, as); fs.copyFileSync(fixture(root, name), target); return target; };
  try {
    // exif: EXIF の向きを持つ写真を開き、回して上書き保存する（smoke-image-exif.js）。SIGK_SMOKE_IMAGE_EDIT_ONLY=exif なら、これだけを行う。
    report.exif = await require('./smoke-image-exif.js').run({ js, dir, nativeImage, saveScript, pixelsOf, dialog });
    if (process.env.SIGK_SMOKE_IMAGE_EDIT_ONLY === 'exif')
      return report;

    // png: 上書き保存（了承）
    const png = copy('image-wide.png', 'wide.png');
    const pngBefore = pixelsOf(nativeImage, png);
    const drawn = await drawOn(js, nativeImage, png);
    report.tools = await js(toolsScript);
    // 画面の写真（目で見る用）: 灰色の道具に吹き出しを出したところと、確認の窓。
    report.shots = await takeShots(win, dir);
    const saved = await js(saveScript('overwrite', 'ok'));
    const pngAfter = pixelsOf(nativeImage, png);
    report.png = {
      drawn, saved, size: [pngAfter.width, pngAfter.height], sizeBefore: [pngBefore.width, pngBefore.height],
      edge: edgeOf(pngAfter, pngBefore), edgeBefore: edgeOf(pngBefore, pngBefore),
      outside: outsideDiff(pngBefore, pngAfter, boxFor(pngBefore)), backupSameAsOriginal: fs.existsSync(`${png}.bak`) && fs.readFileSync(`${png}.bak`).equals(fs.readFileSync(fixture(root, 'image-wide.png'))),
    };

    // cancel: 上書き保存（キャンセル）
    const kept = copy('image-tall.png', 'tall.png');
    report.cancel = { drawn: await drawOn(js, nativeImage, kept), saved: await js(saveScript('overwrite', 'cancel')), unchanged: fs.readFileSync(kept).equals(fs.readFileSync(fixture(root, 'image-tall.png'))), backup: fs.existsSync(`${kept}.bak`) };

    // alpha: 透明な PNG を別の PNG へ
    const alpha = copy('image-alpha.png', 'alpha.png');
    const alphaOut = path.join(dir, 'alpha-out.png');
    const alphaBefore = pixelsOf(nativeImage, alpha);
    const alphaDrawn = await drawOn(js, nativeImage, alpha);
    answers.push(alphaOut);
    const alphaSaved = await js(saveScript('saveAs', 'ok'));
    const alphaAfter = pixelsOf(nativeImage, alphaOut);
    report.alpha = { drawn: alphaDrawn, saved: alphaSaved, edge: edgeOf(alphaAfter, alphaBefore), edgeBefore: edgeOf(alphaBefore, alphaBefore), size: [alphaAfter.width, alphaAfter.height], cornerBefore: alphaBefore.at(5, 5), corner: alphaAfter.at(5, 5),
      outside: outsideDiff(alphaBefore, alphaAfter, boxFor(alphaBefore)), sourceUnchanged: fs.readFileSync(alpha).equals(fs.readFileSync(fixture(root, 'image-alpha.png'))) };

    // jpeg: JPEG を上書き
    const jpeg = path.join(dir, 'photo.jpg');
    fs.writeFileSync(jpeg, nativeImage.createFromPath(fixture(root, 'image-wide.png')).toJPEG(90));
    const jpegBefore = pixelsOf(nativeImage, jpeg);
    const jpegDrawn = await drawOn(js, nativeImage, jpeg);
    const jpegSaved = await js(saveScript('overwrite', 'ok'));
    const jpegAfter = pixelsOf(nativeImage, jpeg);
    report.jpeg = { drawn: jpegDrawn, saved: jpegSaved, edge: edgeOf(jpegAfter, jpegBefore), backup: fs.existsSync(`${jpeg}.bak`), size: [jpegAfter.width, jpegAfter.height], outside: outsideDiff(jpegBefore, jpegAfter, boxFor(jpegBefore)) };

    // noise: 画素がばらばらの JPEG を PNG で保存し、四角の外が、元の JPEG を読み解いた画素と同じかを見る（敷き直しの確かめ。spec-7-1 事前調査 A）。
    const noise = path.join(dir, 'noise.jpg');
    fs.writeFileSync(noise, noiseImage(nativeImage, 333, 257).toJPEG(95));
    const noiseOut = path.join(dir, 'noise-out.png');
    const noiseBefore = pixelsOf(nativeImage, noise);
    const noiseDrawn = await drawOn(js, nativeImage, noise);
    answers.push(noiseOut);
    const noiseSaved = await js(saveScript('saveAs', 'ok'));
    const noiseAfter = pixelsOf(nativeImage, noiseOut);
    report.noise = { drawn: noiseDrawn, saved: noiseSaved, size: [noiseAfter.width, noiseAfter.height], outside: outsideDiff(noiseBefore, noiseAfter, boxFor(noiseBefore)) };

    // bmp: 上書き保存 → 保存の窓で PNG
    const bmp = copy('image-rgb.bmp', 'scan.bmp');
    const bmpOut = path.join(dir, 'scan.png');
    const bmpDrawn = await drawOn(js, nativeImage, bmp);
    answers.push(bmpOut);
    const bmpSaved = await js(saveScript('overwrite', 'ok'));
    const bmpAfter = fs.existsSync(bmpOut) ? pixelsOf(nativeImage, bmpOut) : null;
    report.bmp = { drawn: bmpDrawn, saved: bmpSaved, written: bmpAfter === null ? null : [bmpAfter.width, bmpAfter.height], sourceUnchanged: fs.readFileSync(bmp).equals(fs.readFileSync(fixture(root, 'image-rgb.bmp'))) };

    // pdf: 名前を付けて保存で PDF
    const forPdf = copy('image-wide.png', 'for-pdf.png');
    const pdfOut = path.join(dir, 'for-pdf.pdf');
    const pdfDrawn = await drawOn(js, nativeImage, forPdf);
    answers.push(pdfOut);
    const pdfSaved = await js(saveScript('saveAs', 'ok'));
    report.pdf = { drawn: pdfDrawn, saved: pdfSaved, written: fs.existsSync(pdfOut) ? await inspectPdf(root, pdfOut) : null };
  } finally {
    dialog.showSaveDialog = original;
  }
  return report;
}

// 灰色の道具（ハイライト）に吹き出しを出した画面と、上書きの確認の窓を出した画面を撮る。窓は［キャンセル］で閉じる（あとの保存の筋書きは変えない）。
async function takeShots(win, dir) {
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const target = path.join(dir, name);
    fs.writeFileSync(target, image.toPNG());
    return target;
  };
  await win.webContents.executeJavaScript(`(async () => {
    const button = document.querySelector('#edit-bar .edit-tool[data-tool="highlight"]');
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 900));
  })()`);
  const tools = await shot('shot-tools.png');
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('#edit-bar .edit-tool[data-tool="highlight"]').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    window.__smokeSaving = window.SigK.save.saveActive();
    await new Promise((resolve) => setTimeout(resolve, 500));
  })()`);
  const confirm = await shot('shot-confirm.png');
  await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('confirm-image-save-cancel').click();
    await window.__smokeSaving;
    await new Promise((resolve) => setTimeout(resolve, 300));
    window.SigK.settingsDialog.open();
    await new Promise((resolve) => setTimeout(resolve, 300));
  })()`);
  // 設定の窓の「上書き保存」の欄（spec-7-4 確定事項BK1・CF3）。［キャンセル］で閉じる（設定は変えない）。
  const settings = await shot('shot-settings.png');
  await win.webContents.executeJavaScript(`(async () => {
    window.SigK.settingsDialog.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
  })()`);
  return { tools, confirm, settings };
}

// 書いた PDF のページの大きさと注釈の種類（vendor の pdf-lib で読む。配布物に node_modules は無い）。
async function inspectPdf(root, filePath) {
  const { PDFDocument, PDFName } = require(path.join(root, 'vendor', 'pdf-lib.min.js'));
  const doc = await PDFDocument.load(fs.readFileSync(filePath));
  const page = doc.getPage(0);
  const annots = page.node.Annots();
  const subtypes = annots === undefined ? [] : annots.asArray().map((ref) => doc.context.lookup(ref).get(PDFName.of('Subtype'))?.toString());
  return { pages: doc.getPageCount(), size: page.getSize(), subtypes };
}

module.exports = { run, pixelsOf, outsideDiff };
