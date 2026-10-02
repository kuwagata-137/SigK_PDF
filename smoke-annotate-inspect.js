'use strict';

// 起動確認の、保存先の FreeText の欄を読む口（spec-4b-4a・spec-4b-4b の起動確認）。smoke-annotate-text.js から移した（spec-4b-4b。
// 200 行の目安）。main.js が smoke-annotate.js を通して呼ぶ。/Rect・/DA・/DS・/C・/BS・/CA と、外観の透明グループ・外側の先頭の文字の
// 命令・行の数に、回転と吹き出しの欄（外観の /Matrix・/BBox、/IT・/CL・/LE・/RD、箱で切り抜いているか）を足した。

const fs = require('node:fs');
const path = require('node:path');

// 保存先の FreeText の欄（spec-4b-4a の起動確認。/Rect・/DA・/DS・/C・/BS・/CA と、外観の透明グループ・外側の先頭の文字の命令・行の数）。
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
      const name = (key) => field(dict, key)?.encodedName?.slice(1) ?? null;
      const group = field(field(field(normal?.dict, 'Resources'), 'XObject'), 'G0');
      const drawn = content(group ?? normal);
      texts.push({
        page: index + 1,
        rect: numbers(field(dict, 'Rect')),
        DA: field(dict, 'DA')?.decodeText?.() ?? null,
        DS: field(dict, 'DS')?.decodeText?.() ?? null,
        C: numbers(field(dict, 'C')),
        BSW: field(field(dict, 'BS'), 'W')?.asNumber?.() ?? null,
        CA: field(dict, 'CA')?.asNumber?.() ?? null,
        group: group !== undefined,
        prefix: group === undefined ? null : content(normal).split('\n')[0],
        lines: drawn.split('\n').filter((line) => line.endsWith(' Tm')).length,
        italic: drawn.includes(' 0.25 1 '),
        // 回転と吹き出し（spec-4b-4b 確定事項G）。
        matrix: numbers(field(normal?.dict, 'Matrix')),
        bbox: numbers(field(normal?.dict, 'BBox')),
        IT: name('IT'),
        CL: numbers(field(dict, 'CL')),
        LE: name('LE'),
        RD: numbers(field(dict, 'RD')),
        clipped: drawn.includes(' re W n'),
      });
    }
  });
  return texts;
}

module.exports = { inspectTexts };
