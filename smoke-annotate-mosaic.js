'use strict';

// 起動確認のモザイクの操作と結果の欄（spec-4b-6b 確定事項31・完了判定1〜6・8・9）。smoke-annotate.js が annotateScript に埋める。
//
// MOSAIC_STATE は操作の前に置く変数、MOSAIC_STEPS は smoke-annotate-steps.js の分岐の続き（else if の並び）で、埋め込む先のスクリプトにある
// SigK・name・arg・wait・round・pageNode・screenPoint・mouse と、smoke-annotate-trim.js の trimPull を使う。操作は次のもの（座標は紙の pt）。
//   mosaic:0:100x700-400x600[:14]   モザイクの道具でページ 0 の (100,700) から (400,600) まで引いて離す（:14 なら先に粗さを 14pt に）
//   mosaic-draft:0:100x700-400x600  同じく引くが離さない（破線の四角の画面写真用。次の操作の前に離す）
//   unmosaic:0                      ページ 0 へ移り、［このページのモザイクを外す］を押す
//   mosaic-tool                     道具の段の「モザイク」を押す（持っていれば外す）
//   mosaic-save                     上書き保存し、確認の文を控えて「置き換えて保存」を押し、終わるまで待つ
//   mosaic-confirm                  上書き保存を始め、確認を開いたまま止める（確認の画面写真用。最後に置く）
// MOSAIC_REPORT は結果の mosaic の欄を組む文。inspectMosaic は保存先を pdf-lib で読む（main.js が呼ぶ）。
// 文字列の中には ` と ${ を書かない（テンプレートの中に埋めるため）。

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const MOSAIC_STATE = `
  const mosaicSteps = [];
  // モザイクを置く前に読んだ、そのページの文字（保存先に残っていないかを main.js が数える）。
  const mosaicSecrets = new Set();
  const mosaicPlan = () => SigK.viewer.getPlan().map((page) => (page.mosaic === undefined ? null : page.mosaic));
  const holdMosaic = () => {
    if (SigK.annotate.getTool() !== 'mosaic')
      SigK.annotate.setTool('mosaic');
  };
  const pageTexts = async (index) => (await (await SigK.viewer.getPage(index + 1)).getTextContent()).items.map((item) => item.str).filter((text) => text.trim().length >= 4);
  // ページの canvas の、紙の座標の箱の中の色の数（下見でモザイクになっていれば少ない）。描いていなければ null。
  const mosaicColors = (index, box) => {
    const canvas = pageNode(index)?.querySelector('canvas');
    const viewport = viewportOf(index);
    if (!canvas || !viewport)
      return null;
    const ratio = canvas.width / pageNode(index).clientWidth;
    const [ax, ay] = viewport.convertToViewportPoint(box[0], box[1]);
    const [bx, by] = viewport.convertToViewportPoint(box[2], box[3]);
    const x = Math.round(Math.min(ax, bx) * ratio) + 1;
    const y = Math.round(Math.min(ay, by) * ratio) + 1;
    const w = Math.max(1, Math.round(Math.abs(bx - ax) * ratio) - 2);
    const h = Math.max(1, Math.round(Math.abs(by - ay) * ratio) - 2);
    const data = canvas.getContext('2d').getImageData(x, y, w, h).data;
    const colors = new Set();
    for (let at = 0; at < data.length; at += 4)
      colors.add(data[at] * 65536 + data[at + 1] * 256 + data[at + 2]);
    return { colors: colors.size, pixels: w * h };
  };
`;

const MOSAIC_STEPS = `
    else if (name === 'mosaic' || name === 'mosaic-draft') {
      const [page, points, block] = arg.split(':');
      const index = Number(page);
      holdMosaic();
      if (block !== undefined)
        SigK.annotateMosaic.setBlock(Number(block));
      SigK.viewer.goToPage(index);
      await wait(300);
      for (const text of await pageTexts(index))
        mosaicSecrets.add(text);
      const [from, to] = points.split('-').map((point) => point.split('x').map(Number));
      const box = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.max(from[0], to[0]), Math.max(from[1], to[1])];
      const before = mosaicColors(index, box);
      if (name === 'mosaic') {
        await trimPull(index, from, to);
        await wait(700);
      } else {
        const [x1, y1] = screenPoint(index, from[0], from[1]);
        const [x2, y2] = screenPoint(index, to[0], to[1]);
        const held = (type, x, y) => pageNode(index).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
        held('mousedown', x1, y1);
        held('mousemove', (x1 + x2) / 2, (y1 + y2) / 2);
        held('mousemove', x2, y2);
        await wait(100);
      }
      mosaicSteps.push({ step: name, block: SigK.annotateMosaic.getBlock(), mosaic: mosaicPlan(), before, after: mosaicColors(index, box), draft: document.querySelector('.mosaic-draft') !== null });
    } else if (name === 'unmosaic') {
      holdMosaic();
      SigK.viewer.goToPage(Number(arg));
      await wait(300);
      const button = document.getElementById('props-mosaic-remove');
      const enabled = !button.hidden && button.getAttribute('aria-disabled') !== 'true';
      button.click();
      await wait(500);
      mosaicSteps.push({ step: name, enabled, mosaic: mosaicPlan() });
    } else if (name === 'mosaic-tool') {
      document.querySelector('#edit-bar .edit-tool[data-tool="mosaic"]').click();
      await wait(300);
    } else if (name === 'mosaic-confirm') {
      SigK.save.saveActive();
      for (let tries = 0; tries < 100 && !SigK.confirmMosaic.isOpen(); tries += 1)
        await wait(50);
      mosaicSteps.push({ step: name, open: SigK.confirmMosaic.isOpen(), focused: document.activeElement?.id ?? null });
    } else if (name === 'mosaic-save') {
      const started = performance.now();
      const saving = SigK.save.saveActive();
      for (let tries = 0; tries < 100 && !SigK.confirmMosaic.isOpen(); tries += 1)
        await wait(50);
      const confirm = ['confirm-mosaic-text', 'confirm-mosaic-loss', 'confirm-mosaic-backup'].map((id) => document.getElementById(id).textContent);
      const focused = document.activeElement?.id ?? null;
      document.getElementById('confirm-mosaic-ok').click();
      saveResult = await saving;
      saveResult.ms = round(performance.now() - started);
      await wait(1200);
      mosaicSteps.push({ step: name, confirm, focused, banner: SigK.viewBanner.text(), mosaic: mosaicPlan() });
    }
`;

const MOSAIC_REPORT = `
  const mosaicTexts = [];
  for (let index = 0; index < SigK.viewer.getState().pageCount; index += 1) {
    const spans = [...(pageNode(index)?.querySelectorAll('.textLayer span') ?? [])];
    mosaicTexts.push({ spans: spans.length, blank: spans.filter((span) => span.textContent === '').length, items: (await pageTexts(index)).length });
  }
  const mosaicReport = {
    steps: mosaicSteps,
    tool: SigK.annotate.getTool(),
    block: SigK.annotateMosaic.getBlock(),
    mosaic: mosaicPlan(),
    secrets: [...mosaicSecrets],
    texts: mosaicTexts,
    props: {
      kind: document.getElementById('props-kind').textContent,
      rows: [...document.querySelectorAll('#props .props-body > .prop')].filter((row) => !row.hidden).map((row) => row.textContent.trim()),
      buttons: ['props-mosaic-remove', 'props-delete'].filter((id) => document.getElementById(id).closest('[hidden]') === null),
      hint: document.getElementById('props-hint').textContent,
    },
    barHidden: SigK.editBarOverflow.hiddenButtons().map((button) => button.dataset.tool),
  };
`;

function hex(text) {
  return Buffer.from(text, 'latin1').toString('hex');
}

// 保存先を読む: 各ページの XObject の名前・フォントの有無・書き込みの数、控え（.bak）の有無、モザイクを置く前に読んだ文字が
// 保存先の流れ（ObjStm も）を全部ほどいた中に何回出るか（素の字と 16 進。spec-4b-6b 完了判定5・6）。
async function inspectMosaic(file, secrets = []) {
  const { PDFDocument, PDFName, PDFDict } = require(path.join(__dirname, 'vendor', 'pdf-lib.min.js'));
  const bytes = fs.readFileSync(file);
  const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  const pages = doc.getPages().map((page) => {
    const resources = page.node.Resources();
    const xobjects = resources?.lookup(PDFName.of('XObject'), PDFDict);
    return {
      xobjects: xobjects === undefined ? [] : xobjects.keys().map((key) => key.decodeText()),
      fonts: resources?.lookup(PDFName.of('Font')) !== undefined,
      annots: page.node.Annots()?.size() ?? 0,
      rotate: page.getRotation().angle,
    };
  });
  const text = bytes.toString('latin1');
  const bodies = [text];
  const re = /stream\r?\n/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[0].length;
    try {
      bodies.push(zlib.inflateSync(Buffer.from(text.slice(start, text.indexOf('endstream', start)), 'latin1')).toString('latin1'));
    } catch {
      // 圧縮していない流れは text に入っている。
    }
  }
  const found = secrets.filter((secret) => bodies.some((body) => [secret, hex(secret), hex(secret).toUpperCase()].some((needle) => body.includes(needle))));
  return { pages, backup: fs.existsSync(`${file}.bak`), secrets: secrets.length, found };
}

module.exports = { MOSAIC_STATE, MOSAIC_STEPS, MOSAIC_REPORT, inspectMosaic };
