'use strict';

// 起動確認の、保存先の FreeText の欄を読む口（spec-4b-4a・spec-4b-4b の起動確認）。smoke-annotate-text.js から移した（spec-4b-4b。
// 200 行の目安）。main.js が smoke-annotate.js を通して呼ぶ。/Rect・/DA・/DS・/C・/BS・/CA と、外観の透明グループ・外側の先頭の文字の
// 命令・行の数に、回転と吹き出しの欄（外観の /Matrix・/BBox、/IT・/CL・/LE・/RD、箱で切り抜いているか）を足した。

const fs = require('node:fs');
const path = require('node:path');

// 保存先の FreeText の欄（spec-4b-4a の起動確認。/Rect・/DA・/DS・/C・/BS・/CA と、外観の透明グループ・外側の先頭の文字の命令・行の数）。
async function inspectTexts(file) {
  const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } = require(path.join(__dirname, 'vendor', 'pdf-lib.min.js'));
  const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(file)), { updateMetadata: false });
  const context = doc.context;
  const lookup = (value) => (value === undefined ? undefined : context.lookup(value));
  const field = (dict, key) => (dict instanceof PDFDict ? lookup(dict.get(PDFName.of(key))) : undefined);
  const numbers = (value) => (value instanceof PDFArray ? value.asArray().map((item) => lookup(item)?.asNumber?.() ?? null) : null);
  // 外観の流れの中身。圧縮は pdf-lib がほどく（Flate・ASCIIHex・ASCII85・LZW・RunLength と、その重ね掛け）。
  // 他のアプリが作った外観には pdf-lib がほどけない圧縮もあるので、そのときは止まらずに null を返す。
  const content = (stream) => {
    try {
      return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    } catch {
      return null;
    }
  };
  const texts = [];
  doc.getPages().forEach((page, index) => {
    const annots = lookup(page.node.get(PDFName.of('Annots')));
    for (const item of annots instanceof PDFArray ? annots.asArray() : []) {
      const dict = lookup(item);
      if (field(dict, 'Subtype')?.encodedName !== '/FreeText')
        continue;
      const normal = field(field(dict, 'AP'), 'N');
      // 他のアプリが作った FreeText には外観（/AP /N の流れ）が無いことがある（fixtures の annotated.pdf）。外観の欄は「無い」の値にする。
      const appearance = normal instanceof PDFRawStream;
      const name = (key) => field(dict, key)?.encodedName?.slice(1) ?? null;
      const group = appearance ? field(field(field(normal.dict, 'Resources'), 'XObject'), 'G0') : undefined;
      // 外側の流れ（normal）と、文字を描く流れ（透明グループがあればその中、無ければ外側）。外観が無ければ空。
      const outer = appearance ? content(normal) : '';
      const drawn = group === undefined ? outer : content(group);
      // 外観はあるが、流れの圧縮をほどけなかったとき。流れの中から読む欄（prefix・lines・italic・clipped）は
      // 「分からない」の null にし、appearance を 'unreadable' にする。辞書から読む欄（group・matrix・bbox）はそのまま読む。
      const unreadable = outer === null || drawn === null;
      const from = (text, read) => (text === null ? null : read(text));
      texts.push({
        page: index + 1,
        rect: numbers(field(dict, 'Rect')),
        DA: field(dict, 'DA')?.decodeText?.() ?? null,
        DS: field(dict, 'DS')?.decodeText?.() ?? null,
        C: numbers(field(dict, 'C')),
        BSW: field(field(dict, 'BS'), 'W')?.asNumber?.() ?? null,
        CA: field(dict, 'CA')?.asNumber?.() ?? null,
        appearance: unreadable ? 'unreadable' : appearance,
        group: group !== undefined,
        prefix: group === undefined ? null : from(outer, (text) => text.split('\n')[0]),
        lines: from(drawn, (text) => text.split('\n').filter((line) => line.endsWith(' Tm')).length),
        italic: from(drawn, (text) => text.includes(' 0.25 1 ')),
        // 回転と吹き出し（spec-4b-4b 確定事項G）。
        matrix: appearance ? numbers(field(normal.dict, 'Matrix')) : null,
        bbox: appearance ? numbers(field(normal.dict, 'BBox')) : null,
        IT: name('IT'),
        CL: numbers(field(dict, 'CL')),
        LE: name('LE'),
        RD: numbers(field(dict, 'RD')),
        clipped: from(drawn, (text) => text.includes(' re W n')),
      });
    }
  });
  return texts;
}

module.exports = { inspectTexts };
