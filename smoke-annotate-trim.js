'use strict';

// 起動確認のトリミングの操作と結果の欄（spec-4b-6a 確定事項28・完了判定1〜4・6〜8・11）。smoke-annotate.js が annotateScript に埋める。
//
// TRIM_STATE は操作の前に置く変数、TRIM_STEPS は smoke-annotate-steps.js の分岐の続き（else if の並び）で、埋め込む先のスクリプトにある
// SigK・name・arg・wait・round・pageNode・screenPoint・mouse を使う。操作は次のもの（座標は紙の pt）。
//   trim:0:100x700-400x300[:all]   トリミングの道具でページ 0 の (100,700) から (400,300) まで引き、Enter で切る（:all ならすべてのページ）
//   trim-draft:0:100x700-400x300   同じく引くが切らない（枠とつまみの画面写真用）
//   trim-move:30x-20               枠の中を掴んで紙の座標で (30,-20)pt 動かす
//   untrim:0[:all]                 ページ 0 へ移り、［トリミングを外す］を押して、紙全体を読み終えて戻すまで待つ
//   trim-tool                      道具の段の「トリミング」を押す（持っていれば外す）
//   fit:page                       倍率を「全体」（page）か「幅」（width）に合わせる（画面写真用）
// TRIM_REPORT は結果の trim の欄を組む文。inspectBoxes は保存先の各ページの /MediaBox と /CropBox を pdf-lib で読む（main.js が呼ぶ）。
// 文字列の中には ` と ${ を書かない（テンプレートの中に埋めるため）。

const fs = require('node:fs');
const path = require('node:path');

const TRIM_STATE = `
  const trimSteps = [];
  const trimPoints = (text) => text.split('-').map((point) => point.split('x').map(Number));
  const trimCrops = () => SigK.viewer.getPlan().map((page) => (page.crop === undefined ? null : page.crop));
  // index のページで、紙の座標の点 from から to まで左ボタンで引く。押している間の動きには buttons を付ける（離しが届かなかったと
  // 見なされないように。spec-4b-6a）。
  const trimPull = async (index, from, to) => {
    const [x1, y1] = screenPoint(index, from[0], from[1]);
    const [x2, y2] = screenPoint(index, to[0], to[1]);
    const held = (type, x, y) => pageNode(index).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
    held('mousedown', x1, y1);
    for (let part = 1; part <= 4; part += 1) {
      held('mousemove', x1 + ((x2 - x1) * part) / 4, y1 + ((y2 - y1) * part) / 4);
      await wait(20);
    }
    mouse('mouseup', pageNode(index), x2, y2);
  };
  const holdTrim = (scope) => {
    if (SigK.annotate.getTool() !== 'trim')
      SigK.annotate.setTool('trim');
    SigK.trimTool.setScope(scope === 'all' ? 'all' : 'page');
  };
`;

const TRIM_STEPS = `
    else if (name === 'trim' || name === 'trim-draft') {
      const [page, points, scope] = arg.split(':');
      const index = Number(page);
      holdTrim(scope);
      SigK.viewer.goToPage(index);
      await wait(300);
      const [from, to] = trimPoints(points);
      await trimPull(index, from, to);
      await wait(100);
      const frame = SigK.annotateTrim.getFrame();
      if (name === 'trim')
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await wait(300);
      trimSteps.push({ step: name, frame, crops: trimCrops(), banner: SigK.viewBanner.text() });
    } else if (name === 'trim-move') {
      const frame = SigK.annotateTrim.getFrame();
      if (frame !== null) {
        const [dx, dy] = arg.split('x').map(Number);
        const center = [(frame.box[0] + frame.box[2]) / 2, (frame.box[1] + frame.box[3]) / 2];
        await trimPull(frame.index, center, [center[0] + dx, center[1] + dy]);
        await wait(100);
      }
      trimSteps.push({ step: name, before: frame, frame: SigK.annotateTrim.getFrame() });
    } else if (name === 'untrim') {
      const [page, scope] = arg.split(':');
      holdTrim(scope);
      SigK.viewer.goToPage(Number(page));
      await wait(300);
      const button = document.getElementById('props-trim-remove');
      const enabled = !button.hidden && button.getAttribute('aria-disabled') !== 'true';
      button.click();
      for (let tries = 0; tries < 200 && SigK.trimTool.isRemoving(); tries += 1)
        await wait(50);
      await wait(200);
      trimSteps.push({ step: name, enabled, boxes: SigK.pageBoxes.statusOf(SigK.viewer.getState().file), crops: trimCrops() });
    } else if (name === 'trim-tool') {
      document.querySelector('#edit-bar .edit-tool[data-tool="trim"]').click();
      await wait(300);
    } else if (name === 'fit') {
      SigK.viewer.applyFit(arg === 'width' ? 'width' : 'page');
      await wait(400);
    }
`;

const TRIM_REPORT = `
  const trimLayer = document.querySelector('.trim-layer');
  const trimReport = {
    steps: trimSteps,
    tool: SigK.annotate.getTool(),
    scope: SigK.trimTool.getScope(),
    frame: SigK.annotateTrim.getFrame(),
    drawn: trimLayer === null ? null : {
      page: Number(trimLayer.parentElement.dataset.page),
      handles: trimLayer.querySelectorAll('.trim-handle').length,
      label: trimLayer.querySelector('.trim-label').textContent,
      shade: getComputedStyle(trimLayer.querySelector('.trim-shade')).backgroundColor,
      border: getComputedStyle(trimLayer.querySelector('.trim-box')).borderTopWidth,
    },
    cursor: document.documentElement.getAttribute('data-trim-cursor'),
    crops: trimCrops(),
    // 画面の寸法（plan を当てたあと）・ページの器の大きさ（CSS px）と、元ページのファイルの見える範囲（保存して開き直したあとは切った範囲）。
    sizes: SigK.viewer.getSizes().map((size) => [round(size.width), round(size.height)]),
    nodes: [...document.querySelectorAll('#view-pages .pdf-page')].map((node) => [round(node.getBoundingClientRect().width), round(node.getBoundingClientRect().height)]),
    views: SigK.viewer.getPlan().map((page) => (Number.isInteger(page.src) ? SigK.viewer.getBasePage(page.src)?.view ?? null : null)),
    boxes: SigK.pageBoxes.statusOf(SigK.viewer.getState().file),
    props: {
      kind: document.getElementById('props-kind').textContent,
      rows: [...document.querySelectorAll('#props .props-body > .prop')].filter((row) => !row.hidden).map((row) => row.textContent.trim()),
      buttons: ['props-trim-cancel', 'props-trim-apply', 'props-trim-remove', 'props-delete'].filter((id) => document.getElementById(id).closest('[hidden]') === null),
      hint: document.getElementById('props-hint').textContent,
    },
    barHidden: SigK.editBarOverflow.hiddenButtons().map((button) => button.dataset.tool),
  };
`;

// 保存先の各ページの紙全体（受け継いだ値も解決した /MediaBox）と、ページ自身の /CropBox（無ければ null）。
async function inspectBoxes(file) {
  const { PDFDocument, PDFName } = require(path.join(__dirname, 'vendor', 'pdf-lib.min.js'));
  const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(file)), { updateMetadata: false });
  return doc.getPages().map((page) => {
    const media = page.getMediaBox();
    const raw = page.node.get(PDFName.of('CropBox'));
    const crop = raw === undefined ? null : doc.context.lookup(raw).asArray().map((item) => item.asNumber());
    return { media: [media.x, media.y, media.x + media.width, media.y + media.height], crop };
  });
}

module.exports = { TRIM_STATE, TRIM_STEPS, TRIM_REPORT, inspectBoxes };
