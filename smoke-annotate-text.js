'use strict';

// 起動確認のテキストの書式の操作と結果の欄（spec-4b-4a の起動確認）。smoke-annotate.js が annotateScript に埋める。
//
// TEXT_STATE は操作の前に置く変数、TEXT_STEPS は smoke-annotate-steps.js の分岐の続き（else if の並び）で、埋め込む先の
// スクリプトにある SigK・name・arg・wait・round を使う。操作は次のもの。
//   fontsize:13.3        右パネルの文字の大きさの数値の欄に打って Enter（丸めて当たる）
//   size-list:36         右パネルのよく使う大きさの一覧で選ぶ
//   reopen               いまのタブの文書を閉じて開き直し、読み込み（辞書の読み戻し）が終わるまで待って、自前のテキストを控える
//                        （保存と開き直しを繰り返して、幅・位置・書式・行が変わらないことを見る。完了判定5）
//   compare:2            いまのタブのファイルの 1 ページ目を、pdf.js が外観ごと描いた絵と、外観を描かずに SigK の印刷の描き手で
//                        自前のテキストを重ねた絵とで、倍率 2 で比べる（差が 32 を超える画素の割合。完了判定2・3）。pdf.js が外観から
//                        読み戻す文字の大きさと色も控える
// TEXT_REPORT は結果の text の欄（テキストの書き込みの書式と行・入力欄の行・開き直しの控え・画素の比べ・右パネルの行）を組む文。
// 文字列の中には ` と ${ を書かない（テンプレートの中に埋めるため）。inspectTexts は保存先の FreeText の欄を読む（main.js が呼ぶ）。

const fs = require('node:fs');
const path = require('node:path');

const TEXT_STATE = `
  const textRounds = [];
  let textCompare = null;
  const activePath = () => SigK.tabs.list().find((tab) => tab.active)?.path ?? null;
  const textOf = (entry) => ({
    key: entry.ref ?? entry.id, src: entry.src, text: entry.text, fontSize: entry.fontSize, rotation: entry.rotation, color: entry.color,
    opacity: entry.opacity, width: entry.width ?? null, bold: entry.bold === true, italic: entry.italic === true, fill: entry.fill ?? null,
    borderColor: entry.borderColor ?? null, borderWidth: entry.borderWidth ?? null, rect: entry.rect.map(round), angle: entry.angle ?? 0, tip: entry.tip?.map(round) ?? null,
    lines: entry.readonly === true ? null : SigK.freeTextMetrics.layoutOfEntry(entry).lines, readonly: entry.readonly === true,
  });
  const ownTexts = () => [...SigK.viewer.getAnnotations().added, ...Object.values(SigK.viewer.getImported()).flat()].filter((entry) => entry.kind === 'text').map(textOf);
`;

const TEXT_STEPS = `
    else if (name === 'fontsize') {
      // 隠した窓はフォーカスを持たないので、focus()・blur() で focus・blur の出来事が出ない。打ち始めの相手を覚え直すよう、自分で出す。
      const field = document.getElementById('props-size');
      field.focus();
      field.dispatchEvent(new FocusEvent('focus'));
      field.value = arg;
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      field.blur();
      field.dispatchEvent(new FocusEvent('blur'));
    } else if (name === 'size-list') {
      const list = document.getElementById('props-size-list');
      list.value = arg;
      list.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (name === 'reopen') {
      const file = activePath();
      const tab = SigK.tabs.list().find((item) => item.active);
      await SigK.tabs.forceCloseTab(tab.id);
      await wait(300);
      await SigK.tabs.openPath(file);
      await wait(700);
      await SigK.annotationImport.settled();
      await wait(300);
      SigK.shell.setMode(document, 'annot');
      await wait(200);
      textRounds.push(ownTexts().map(({ key, ...rest }) => rest));
    } else if (name === 'compare') {
      const scale = Number(arg) || 2;
      const read = await window.pdfAPI.read(activePath());
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
      const entries = Object.values(SigK.viewer.getImported()).flat().filter((entry) => entry.kind === 'text' && entry.readonly !== true && entry.src === 0);
      SigK.annotationLayer.paint(bySigk.getContext('2d'), entries, viewport);
      const width = byPdfjs.width;
      const a = byPdfjs.getContext('2d').getImageData(0, 0, width, byPdfjs.height).data;
      const b = bySigk.getContext('2d').getImageData(0, 0, width, byPdfjs.height).data;
      const count = (box) => {
        let ink = 0;
        let over = 0;
        for (let y = Math.max(0, box[1]); y < Math.min(byPdfjs.height, box[3]); y += 1) {
          for (let x = Math.max(0, box[0]); x < Math.min(width, box[2]); x += 1) {
            const at = (y * width + x) * 4;
            if (Math.min(a[at], a[at + 1], a[at + 2], b[at], b[at + 1], b[at + 2]) >= 240)
              continue;
            ink += 1;
            if (Math.max(Math.abs(a[at] - b[at]), Math.abs(a[at + 1] - b[at + 1]), Math.abs(a[at + 2] - b[at + 2])) > 32)
              over += 1;
          }
        }
        return { ink, over, ratio: ink === 0 ? 0 : Math.round((over / ink) * 10000) / 10000 };
      };
      // 比べる範囲は 4 隅の外接（回したテキストは回した 4 隅、吹き出しはしっぽの先も。spec-4b-4b）。
      const boxOf = (entry) => {
        const quad = entry.quads[0];
        const tips = Array.isArray(entry.tip) ? [SigK.calloutTail.tipOnPaper(entry)] : [];
        const points = [0, 2, 4, 6].map((at) => [quad[at], quad[at + 1]]).concat(tips).map((point) => viewport.convertToViewportPoint(point[0], point[1]));
        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        return [Math.floor(Math.min(...xs)) - 2, Math.floor(Math.min(...ys)) - 2, Math.ceil(Math.max(...xs)) + 2, Math.ceil(Math.max(...ys)) + 2];
      };
      // pdf.js が外観から読み戻す文字の大きさと色（半透明でも読めるか。完了判定3）。
      const pdfjsRead = (await page.getAnnotations()).filter((item) => item.subtype === 'FreeText')
        .map((item) => ({ fontSize: item.defaultAppearanceData?.fontSize ?? null, fontColor: [...(item.defaultAppearanceData?.fontColor ?? [])], opacity: item.opacity ?? null }));
      textCompare = { scale, page: count([0, 0, width, byPdfjs.height]), texts: entries.map((entry) => ({ text: entry.text.slice(0, 12), ...count(boxOf(entry)) })), pdfjsRead };
      await task.destroy();
    }
`;

const TEXT_REPORT = `
  const textReport = (() => {
    const node = document.querySelector('textarea.free-text-editor');
    const draft = SigK.freeTextEditor.getDraft();
    let editor = null;
    if (node !== null && draft !== null) {
      const style = getComputedStyle(node);
      const inner = node.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const lineHeight = parseFloat(style.fontSize) * 1.25;
      editor = { rows: Math.round(inner / lineHeight), lines: SigK.freeTextMetrics.layoutOfEntry({ ...draft, kind: 'text', text: node.value }).lines, wrap: node.wrap, width: node.style.width };
    }
    const rows = ['size', 'format', 'fill', 'border', 'width'];
    return {
      texts: ownTexts(),
      editor,
      rounds: textRounds,
      roundsSame: textRounds.every((round) => JSON.stringify(round) === JSON.stringify(textRounds[0])),
      compare: textCompare,
      props: {
        shown: rows.filter((row) => !document.getElementById('props-' + row + '-row').hidden),
        size: document.getElementById('props-size').value,
        format: [...document.querySelectorAll('#props-format button.on')].map((button) => button.dataset.format),
        border: document.getElementById('props-border-name').textContent,
        widthLabel: document.getElementById('props-width-label').textContent,
      },
      nextStyle: SigK.annotate.getTextStyle(),
    };
  })();
`;

// 保存先の FreeText の欄（spec-4b-4a の起動確認。/Rect・/DA・/DS・/C・/BS・/CA と、外観の透明グループ・外側の先頭の文字の命令・行の数。
// spec-4b-4b で外観の /BBox・/Matrix と、吹き出しの /IT・/CL・/RD・/LE を足した）。
async function inspectTexts(file) {
  const { PDFDocument, PDFName, PDFArray, PDFDict } = require(path.join(__dirname, 'vendor', 'pdf-lib.min.js'));
  const zlib = require('node:zlib');
  const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(file)), { updateMetadata: false });
  const context = doc.context;
  const lookup = (value) => (value === undefined ? undefined : context.lookup(value));
  const field = (dict, key) => (dict instanceof PDFDict ? lookup(dict.get(PDFName.of(key))) : undefined);
  const numbers = (value) => (value instanceof PDFArray ? value.asArray().map((item) => lookup(item)?.asNumber?.() ?? null) : null);
  const content = (stream) => {
    const raw = Buffer.from(stream.contents);
    return (stream.dict.get(PDFName.of('Filter')) ? zlib.inflateSync(raw) : raw).toString('latin1');
  };
  const texts = [];
  doc.getPages().forEach((page, index) => {
    const annots = lookup(page.node.get(PDFName.of('Annots')));
    for (const item of annots instanceof PDFArray ? annots.asArray() : []) {
      const dict = lookup(item);
      if (field(dict, 'Subtype')?.encodedName !== '/FreeText')
        continue;
      const normal = field(field(dict, 'AP'), 'N');
      const group = field(field(field(normal?.dict, 'Resources'), 'XObject'), 'G0');
      const drawn = content(group ?? normal);
      texts.push({
        page: index + 1,
        rect: numbers(field(dict, 'Rect')),
        BBox: numbers(field(normal?.dict, 'BBox')),
        Matrix: numbers(field(normal?.dict, 'Matrix')),
        DA: field(dict, 'DA')?.decodeText?.() ?? null,
        DS: field(dict, 'DS')?.decodeText?.() ?? null,
        C: numbers(field(dict, 'C')),
        BSW: field(field(dict, 'BS'), 'W')?.asNumber?.() ?? null,
        IT: field(dict, 'IT')?.encodedName ?? null,
        CL: numbers(field(dict, 'CL')),
        RD: numbers(field(dict, 'RD')),
        LE: field(dict, 'LE')?.encodedName ?? null,
        CA: field(dict, 'CA')?.asNumber?.() ?? null,
        group: group !== undefined,
        prefix: group === undefined ? null : content(normal).split('\n')[0],
        lines: drawn.split('\n').filter((line) => line.endsWith(' Tm')).length,
        italic: drawn.includes(' 0.25 1 '),
      });
    }
  });
  return texts;
}

module.exports = { TEXT_STATE, TEXT_STEPS, TEXT_REPORT, inspectTexts };
