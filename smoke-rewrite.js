'use strict';

// 起動確認の透かし・フラット化（spec-4-5 確定事項48・49）。main.js の installSmokeCheck が使う
// （2,000 行を超えた main.js にこれ以上足さないため分けた）。
//
// レンダラーで回すスクリプトの文字列と、書き出した PDF をメインで読み返す関数を持つ。スクリプトは
// 結合の起動確認と同じく、OS の保存ダイアログを通さずに画面の計画をワーカーへ渡す（出力先の
// 決め方は jsdom の画面テストが見ている）。pdf-lib は vendor から読む（配布物に node_modules は無い）。
//
//   SIGK_SMOKE_WATERMARK=<PDF>  SIGK_SMOKE_WATERMARK_OPS=<操作列>  SIGK_SMOKE_WATERMARK_OUT=<出力>
//     操作はカンマ区切り: text:<文字> / image:<PNG・JPEG のパス> / size:small|medium|large /
//     color:#rrggbb / opacity:<%> / angle:45|0 / pos:<9 か所> / pages:<範囲> / preview:<ページ番号>
//     SIGK_SMOKE_WATERMARK_STAY=1 なら書いたあとも透かしの画面に留まる（画面写真を撮るため）
//   SIGK_SMOKE_FLATTEN=<PDF>  SIGK_SMOKE_FLATTEN_OUT=<出力>
//     SIGK_SMOKE_FLATTEN_STAY=screen なら件数を出した画面で、confirm なら確認ダイアログを開いたまま止まる
//     （画面写真を撮るため）

const fs = require('node:fs');
const path = require('node:path');

const WAIT = 'const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));';

// 書き出したファイルを pdf.js で開き、全ページの本文の文字をつなげて返す（透かしの文字が出ないこと）。
const TEXT_OF = `async (filePath) => {
  const read = await window.pdfAPI.read(filePath);
  const task = window.SigK.pdfjs.getDocument({ data: read.bytes });
  const doc = await task.promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number += 1)
    pages.push((await (await doc.getPage(number)).getTextContent()).items.map((item) => item.str).join(''));
  await task.destroy();
  return pages;
}`;

function watermarkScript({ source, ops, target, stay }) {
  return `(async () => {
    ${WAIT}
    const SigK = window.SigK;
    const tool = SigK.toolsWatermark;
    const textOf = ${TEXT_OF};
    SigK.shell.setMode(document, 'tools');
    SigK.tools.select('watermark');
    await tool.setSource(${JSON.stringify(source)});
    await wait(500);
    const applied = [];
    for (const raw of ${JSON.stringify(ops)}.split(',')) {
      const step = raw.trim();
      if (step === '')
        continue;
      const [name, ...rest] = step.split(':');
      const arg = rest.join(':');
      if (name === 'text') { tool.setType('text'); tool.setText(arg); }
      else if (name === 'image') await tool.setImage(arg);
      else if (name === 'size') tool.setSize(arg);
      else if (name === 'color') tool.setColor(arg);
      else if (name === 'opacity') tool.setOpacity(Number(arg) / 100);
      else if (name === 'angle') tool.setAngle(Number(arg));
      else if (name === 'pos') tool.setPosition(arg);
      else if (name === 'pages') { tool.setPageMode('range'); tool.setRange(arg); }
      else if (name === 'preview') await SigK.watermarkPreview.showPage(Number(arg) - 1);
      applied.push(step);
      await wait(150);
    }
    // プレビューの紙の絵と、同梱フォントの読み込みを待つ。
    await wait(900);
    const overlay = document.getElementById('wm-preview-overlay');
    const preview = {
      index: SigK.watermarkPreview.pageIndex(), count: SigK.watermarkPreview.pageCount(),
      caption: document.getElementById('wm-preview-cap').textContent,
      viewBox: overlay.getAttribute('viewBox'),
      transform: overlay.querySelector('g')?.getAttribute('transform') ?? null,
      canvas: document.querySelector('#wm-preview-canvas canvas') !== null,
      fontLoaded: SigK.freeTextShape.isLoaded(),
    };
    const plan = tool.currentPlan();
    const screen = { summary: document.getElementById('wm-summary').textContent, runEnabled: document.getElementById('wm-run').getAttribute('aria-disabled') !== 'true' };
    if (!plan.ready)
      return { applied, plan: { ready: false, error: plan.error }, preview, screen };
    const started = Date.now();
    const result = await SigK.save.runTask({ ...plan.spec, target: ${JSON.stringify(target)} });
    const ms = Date.now() - started;
    const out = { applied, plan: { ready: true, summary: plan.summary, pages: plan.pages, mark: plan.spec.mark }, preview, screen, ok: result?.ok === true, error: result?.error ?? null, pages: result?.pages ?? null, ms };
    if (out.ok) {
      const pagesText = await textOf(${JSON.stringify(target)});
      out.text = { pages: pagesText, containsMark: typeof plan.spec.mark.text === 'string' && pagesText.some((line) => line.includes(plan.spec.mark.text)) };
      if (!${stay === true}) {
        await SigK.tabs.openPath(${JSON.stringify(target)});
        await wait(900);
        SigK.shell.setMode(document, 'view');
        out.opened = { tabs: SigK.tabs.count(), pageCount: SigK.viewer.getState().pageCount };
      }
    }
    // 画面に留まるときは、走っていた帯を下げてから撮る（本物は完了の帯に置き換わる）。
    if (${stay === true})
      SigK.viewBanner.hide();
    return out;
  })()`;
}

// 焼き込み前後を pdf.js で 2 倍で描き、差が 64 を超える画素の割合をページごとに返す（完了判定5）。
const PIXEL_DIFF = `async (before, after) => {
  const open = async (filePath) => {
    const read = await window.pdfAPI.read(filePath);
    const task = window.SigK.pdfjs.getDocument({ data: read.bytes });
    return { task, doc: await task.promise };
  };
  const pixels = async (doc, number) => {
    const page = await doc.getPage(number);
    const { canvas, width, height } = await window.SigK.pageImage.renderToCanvas(document, page, { scale: 2 });
    return { data: canvas.getContext('2d').getImageData(0, 0, width, height).data, width, height };
  };
  const a = await open(before);
  const b = await open(after);
  const pages = [];
  try {
    for (let number = 1; number <= a.doc.numPages; number += 1) {
      const x = await pixels(a.doc, number);
      const y = await pixels(b.doc, number);
      if (x.width !== y.width || x.height !== y.height) {
        pages.push({ page: number, error: '大きさが違う' });
        continue;
      }
      let over = 0;
      for (let index = 0; index < x.data.length; index += 4) {
        const diff = Math.max(Math.abs(x.data[index] - y.data[index]), Math.abs(x.data[index + 1] - y.data[index + 1]), Math.abs(x.data[index + 2] - y.data[index + 2]));
        if (diff > 64)
          over += 1;
      }
      const total = x.width * x.height;
      pages.push({ page: number, over, total, ratio: Math.round((over / total) * 1e6) / 1e6 });
    }
  } finally {
    await a.task.destroy();
    await b.task.destroy();
  }
  return pages;
}`;

function flattenScript({ source, target, stay }) {
  return `(async () => {
    ${WAIT}
    const SigK = window.SigK;
    const tool = SigK.toolsFlatten;
    const pixelDiff = ${PIXEL_DIFF};
    SigK.shell.setMode(document, 'tools');
    SigK.tools.select('flatten');
    await tool.setSource(${JSON.stringify(source)});
    for (let tries = 0; tries < 80; tries += 1) {
      const census = tool.census();
      if (census !== null && !census.pending)
        break;
      await wait(100);
    }
    await wait(200);
    const census = tool.census();
    const screen = {
      rows: [...document.querySelectorAll('#fl-list .fl-row')].map((row) => row.textContent),
      keep: document.getElementById('fl-keep-text').textContent,
      warn: document.getElementById('fl-warn').textContent,
      summary: document.getElementById('fl-summary').textContent,
      runEnabled: document.getElementById('fl-run').getAttribute('aria-disabled') !== 'true',
      bandVisible: SigK.viewBanner.isVisible(),
    };
    if (!tool.status().ready || ${JSON.stringify(stay)} === 'screen')
      return { census, screen };
    const asked = SigK.confirmFlatten.ask({ count: census.result.baked, name: ${JSON.stringify(path.basename(target))}, notes: census.result.notes });
    await wait(300);
    const dialog = {
      open: SigK.confirmFlatten.isOpen(),
      focusOnCancel: document.activeElement === document.getElementById('confirm-flatten-cancel'),
      danger: document.getElementById('confirm-flatten-ok').classList.contains('danger'),
      text: document.getElementById('confirm-flatten-text').textContent,
      notes: document.getElementById('confirm-flatten-notes').textContent,
    };
    if (${JSON.stringify(stay)} === 'confirm')
      return { census, screen, dialog };
    document.getElementById('confirm-flatten-ok').click();
    const agreed = await asked;
    const started = Date.now();
    const result = await SigK.save.runTask({ kind: 'flatten', label: 'フラット化', source: ${JSON.stringify(source)}, target: ${JSON.stringify(target)} });
    const ms = Date.now() - started;
    const out = { census, screen, dialog, agreed, ok: result?.ok === true, error: result?.error ?? null, baked: result?.baked ?? null, kept: result?.kept ?? null, ms };
    if (out.ok) {
      out.diff = await pixelDiff(${JSON.stringify(source)}, ${JSON.stringify(target)});
      await SigK.tabs.openPath(${JSON.stringify(target)});
      await wait(900);
      SigK.shell.setMode(document, 'view');
      out.opened = { tabs: SigK.tabs.count(), pageCount: SigK.viewer.getState().pageCount };
    }
    return out;
  })()`;
}

function loadPdfLib(rootDir) {
  return require(path.join(rootDir, 'vendor', 'pdf-lib.min.js'));
}

async function loadDoc(file, rootDir) {
  const { PDFDocument } = loadPdfLib(rootDir);
  return PDFDocument.load(new Uint8Array(fs.readFileSync(file)), { updateMetadata: false });
}

// ページの Resources の /XObject のうち、名前が prefix で始まるもの。
function xobjectNamesOf(page, prefix, { PDFName }) {
  const dict = page.node.Resources()?.lookup(PDFName.of('XObject'));
  return typeof dict?.keys === 'function' ? dict.keys().map((key) => key.decodeText()).filter((name) => name.startsWith(prefix)) : [];
}

// 透かしを入れたファイルを読み返す: ページごとの透かしの名前・文書の Form XObject（透かし）の数・フォントの数。
async function inspectWatermarked(file, rootDir) {
  const lib = loadPdfLib(rootDir);
  const doc = await loadDoc(file, rootDir);
  const refs = new Set();
  const pages = doc.getPages().map((page) => {
    const names = xobjectNamesOf(page, 'SigKWM', lib);
    const dict = page.node.Resources().lookup(lib.PDFName.of('XObject'));
    names.forEach((name) => refs.add(String(dict.get(lib.PDFName.of(name)))));
    return { names, rotate: page.getRotation().angle };
  });
  let fonts = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj?.get?.(lib.PDFName.of('Type'))?.encodedName === '/Font')
      fonts += 1;
  }
  return { pages, watermarkForms: refs.size, fonts, bytes: fs.statSync(file).size };
}

// ノートの本文（/Contents）の文字。焼いたあとに文書のどこにも残らないことを見る。
async function noteContentsOf(file, rootDir) {
  const lib = loadPdfLib(rootDir);
  const doc = await loadDoc(file, rootDir);
  const texts = [];
  for (const page of doc.getPages()) {
    const annots = doc.context.lookup(page.node.get(lib.PDFName.of('Annots')));
    for (const item of typeof annots?.asArray === 'function' ? annots.asArray() : []) {
      const dict = doc.context.lookup(item);
      const contents = dict?.get?.(lib.PDFName.of('Contents'));
      if (dict?.get?.(lib.PDFName.of('Subtype'))?.encodedName === '/Text' && typeof contents?.decodeText === 'function')
        texts.push(contents.decodeText());
    }
  }
  return texts;
}

// 文書の全オブジェクトの辞書の値から、文字列（PDFString・PDFHexString）を集める。出力はオブジェクト
// ストリームで圧縮されているので、ファイルの生のバイトを探しても見つからない。読み返して調べる。
function stringsOf(doc) {
  const found = new Set();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = typeof obj?.entries === 'function' ? obj : obj?.dict;
    for (const [, value] of typeof dict?.entries === 'function' ? dict.entries() : []) {
      if (typeof value?.decodeText === 'function')
        found.add(value.decodeText());
    }
  }
  return found;
}

// フラット化したファイルを読み返す: ページごとに残った注釈の種類と、焼いた外観の名前の数、ノートの本文の残り。
async function inspectFlattened(source, file, rootDir) {
  const lib = loadPdfLib(rootDir);
  const doc = await loadDoc(file, rootDir);
  const pages = doc.getPages().map((page) => {
    const annots = doc.context.lookup(page.node.get(lib.PDFName.of('Annots')));
    const subtypes = (typeof annots?.asArray === 'function' ? annots.asArray() : [])
      .map((item) => doc.context.lookup(item)?.get?.(lib.PDFName.of('Subtype'))?.encodedName?.slice(1) ?? '?');
    return { annots: subtypes, baked: xobjectNamesOf(page, 'SigKF', lib).length };
  });
  const notesBefore = await noteContentsOf(source, rootDir);
  const strings = stringsOf(doc);
  return { pages, notesBefore: notesBefore.length, notesLeft: notesBefore.filter((text) => strings.has(text)).length, bytes: fs.statSync(file).size };
}

module.exports = { watermarkScript, flattenScript, inspectWatermarked, inspectFlattened };
