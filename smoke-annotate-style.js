'use strict';

// 起動確認の見た目の操作と、保存先の書き込みの見た目を読む口（spec-4b-1b の起動確認）。smoke-annotate.js と main.js が使う。
//
// STYLE_STEPS は smoke-annotate-steps.js の分岐の続き（else if の並び）として annotateScript のループに埋める文で、
// 埋め込む先のスクリプトにある SigK・name・arg・wait を使う。操作は次のもの。
//   fill:#rrggbb|none          塗り（四角・丸。選んでいればその書き込み、無ければ次に付ける値）
//   stroke:#rrggbb|none        線の色か線なし
//   style:solid|dashed|cloudy  右パネルの線種のボタンを押す
//   chip:color|fill            色か塗りのチップを押してパレットの窓を開いたままにする（画面写真用）
//   palette:3x5                パレットを開いて行 x 列（1 起点。1 行目がテーマの色、2〜6 行目が濃淡、7 行目が標準の色）を押す
//                              （塗りは palette:fill:3x5）
//   other:#123456              「その他の色…」で色を選んだことにする（OS の色の選択は窓を出さない確かめでは開けないので、
//                              隠した入力に値を置いて change を送る。塗りは other:fill:#123456）
//   slide:width:6;12;17        スライダーを ; 区切りの値の順に動かし（input）、最後の値で離す（change。不透明度は
//                              slide:opacity:80;50;35 で %）。履歴は 1 だけ増える
// 文字列の中には ` と ${ を書かない（テンプレートの中に埋めるため）。

const fs = require('node:fs');
const path = require('node:path');

const STYLE_STEPS = `
    else if (name === 'fill') {
      SigK.annotate.setFill(arg === 'none' ? null : arg);
    } else if (name === 'stroke') {
      if (arg === 'none')
        SigK.annotate.setStrokeNone();
      else
        SigK.annotate.setColor(arg);
    } else if (name === 'style') {
      document.querySelector('#props-style button[data-style="' + arg + '"]')?.click();
    } else if (name === 'chip') {
      document.getElementById(arg === 'fill' ? 'props-fill' : 'props-color')?.click();
      await wait(150);
    } else if (name === 'palette' || name === 'other') {
      const parts = arg.split(':');
      const chip = document.getElementById(parts.length > 1 && parts[0] === 'fill' ? 'props-fill' : 'props-color');
      const value = parts.at(-1);
      // chip: で開いたままなら押し直さない（押すと閉じる）。
      if (!(SigK.colorPopover.isOpen() && SigK.colorPopover.anchor() === chip))
        chip?.click();
      await wait(100);
      if (name === 'palette') {
        const [row, column] = value.split('x').map(Number);
        document.querySelectorAll('#color-pop .cell')[(row - 1) * 10 + (column - 1)]?.click();
      } else {
        const input = document.querySelector('#color-pop input.other-input');
        input.value = value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (name === 'slide') {
      const [field, values] = arg.split(':');
      const range = document.getElementById(field === 'opacity' ? 'props-opacity-range' : 'props-width-range');
      for (const value of values.split(';')) {
        range.value = value;
        range.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(60);
      }
      range.dispatchEvent(new Event('change', { bubbles: true }));
    }
`;

// 描く種類の書き込み（保存先で見た目の欄を読むもの）。
const DRAWN_SUBTYPES = Object.freeze(['Square', 'Circle', 'PolyLine', 'Ink']);

// 保存先の図形・ペンの辞書の見た目の欄（spec-4b-1b 完了判定6）。/Subtype・/Rect・/C・/IC・/CA・/BS（/W・/S・/D）・/BE・/RD と、
// 外観が透明グループで包まれているか。起動確認でしか使わないので、pdf-lib はここで初めて読む。
async function inspectAnnotations(file) {
  const { PDFDocument, PDFName, PDFArray, PDFDict } = require(path.join(__dirname, 'vendor', 'pdf-lib.min.js'));
  const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(file)), { updateMetadata: false, ignoreEncryption: true });
  const context = doc.context;
  const lookup = (value) => (value === undefined ? undefined : context.lookup(value));
  const field = (dict, key) => (dict instanceof PDFDict ? lookup(dict.get(PDFName.of(key))) : undefined);
  const numbers = (value) => (value instanceof PDFArray ? value.asArray().map((item) => lookup(item)?.asNumber?.() ?? null) : null);
  const number = (value) => value?.asNumber?.() ?? null;
  const name = (value) => (typeof value?.encodedName === 'string' ? value.encodedName.slice(1) : null);
  // 外観の Resources の XObject に /Group を持つ Form があるか（確定事項31）。
  const grouped = (dict) => {
    const normal = field(field(dict, 'AP'), 'N');
    const xobjects = field(field(normal?.dict, 'Resources'), 'XObject');
    return xobjects instanceof PDFDict && xobjects.entries().some(([, ref]) => lookup(ref)?.dict?.has(PDFName.of('Group')) === true);
  };
  const written = [];
  doc.getPages().forEach((page, index) => {
    const annots = lookup(page.node.get(PDFName.of('Annots')));
    for (const item of annots instanceof PDFArray ? annots.asArray() : []) {
      const dict = lookup(item);
      const subtype = name(field(dict, 'Subtype'));
      if (!DRAWN_SUBTYPES.includes(subtype))
        continue;
      const bs = field(dict, 'BS');
      const be = field(dict, 'BE');
      // 外観の /BBox と /Matrix（回した四角・丸。spec-4b-2 確定事項29）。
      const normal = field(field(dict, 'AP'), 'N');
      written.push({
        page: index + 1,
        subtype,
        rect: numbers(field(dict, 'Rect')),
        C: numbers(field(dict, 'C')),
        IC: numbers(field(dict, 'IC')),
        CA: number(field(dict, 'CA')),
        BS: bs instanceof PDFDict ? { W: number(field(bs, 'W')), S: name(field(bs, 'S')), D: numbers(field(bs, 'D')) } : null,
        BE: be instanceof PDFDict ? { S: name(field(be, 'S')), I: number(field(be, 'I')) } : null,
        RD: numbers(field(dict, 'RD')),
        group: grouped(dict),
        bbox: numbers(field(normal?.dict, 'BBox')),
        matrix: numbers(field(normal?.dict, 'Matrix')),
      });
    }
  });
  return written;
}

module.exports = { STYLE_STEPS, DRAWN_SUBTYPES, inspectAnnotations };
