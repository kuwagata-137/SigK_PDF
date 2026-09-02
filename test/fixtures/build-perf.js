'use strict';

// 非機能要件の実測（`docs/01_製品要件定義.md` 第4章）に使う検体を組み立てる。
//
// 要件が想定するのは **10MB・50ページ程度の PDF** である。実務でこの寸法に
// なるのは、まず「紙を取り込んだ書類」である。だから1ページにつき画像を1枚
// 貼る形にした。文字だけのページでは 50ページで 10MB に遠く届かず、要件が
// 想定しているものとは違うものを測ることになる。
//
// **`pretest` では作らない。**10MB を毎回のテストで書き直す意味が無い。
// 実測のときだけ `npm run fixtures:perf` で作る。出力先の `test/fixtures/*.pdf`
// は .gitignore 済みで、コミットされない（決定10）。
//
// 依存は増やさない（決定18）。PNG は zlib だけで本物を作れる（`images.js` と
// 同じ作法）。
//
// 【寸法の合わせ方】
// deflate は乱数をほとんど縮められず、白地はほぼ消える。つまり出力の寸法は
// **乗せた乱数の量でほぼ決まる**。ただし1画素あたり何バイトになるかは
// alpha が一定であることなどに左右されて読み切れないので、**先に1枚組んで
// 実測し、そこから必要な行数を逆算する**（`calibrate`）。決め打ちの係数を
// 置くより確実で、画像の寸法を変えても付いてくる。

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { PDFDocument } = require('pdf-lib');

const { PNG_SIGNATURE, chunk } = require('./images.js');

const OUTPUT = path.join(__dirname, 'perf-10mb-50p.pdf');

const PAGE_COUNT = 50;
const TARGET_BYTES = 10 * 1024 * 1024;

// A4 を 110dpi で取り込んだくらいの画素数。実務の取り込みは 150〜300dpi だが、
// ここで効かせたいのは「1ページにつき画像を1枚ほどく重さ」であって解像度の
// 高さではない。上げるとページあたりの画素数だけが増え、狙いの 10MB へ
// 合わせるために乱数の量を減らす羽目になって、かえって実物から離れる。
const IMAGE = { width: 900, height: 1273 };
const A4 = { width: 595.28, height: 841.89 };

// 「文字の行」に見立てた帯。行数で全体の寸法を合わせるので、行数は可変。
const LINE = { width: 780, height: 3, left: 60 };
const MARGIN = 90;

// 同じ検体を何度でも作れるように、乱数は種から作る（mulberry32）。
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 白地に「文字の行」を並べた RGBA の画素列。PNG の各行は先頭1バイトが
// フィルター種別で、0（フィルターなし）にする。
function scanLikeRaw(lineCount, random) {
  const stride = 1 + IMAGE.width * 4;
  const raw = Buffer.alloc(stride * IMAGE.height, 0xff);   // 0xff ＝ 不透明な白
  for (let y = 0; y < IMAGE.height; y += 1)
    raw[y * stride] = 0;

  if (lineCount <= 0)
    return raw;

  const spacing = Math.floor((IMAGE.height - MARGIN * 2) / lineCount);
  for (let i = 0; i < lineCount; i += 1) {
    for (let dy = 0; dy < LINE.height; dy += 1) {
      const y = MARGIN + i * spacing + dy;
      if (y >= IMAGE.height)
        break;
      const base = y * stride + 1 + LINE.left * 4;
      for (let x = 0; x < LINE.width; x += 1) {
        const at = base + x * 4;
        raw[at] = Math.floor(random() * 256);
        raw[at + 1] = Math.floor(random() * 256);
        raw[at + 2] = Math.floor(random() * 256);
        // alpha はそのまま 0xff。
      }
    }
  }
  return raw;
}

function toPng(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(IMAGE.width, 0);
  ihdr.writeUInt32BE(IMAGE.height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // color type: RGBA
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 指定した行数のページを並べた PDF を組む。ページごとに違う画像にする。
// 同じバイト列だと pdf-lib が1つにまとめてしまい、50ページでも中身は
// 1枚ぶんにしかならない（取り込んだ書類の実物とも違う）。
async function buildDoc(pageCount, lineCount) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    const png = toPng(scanLikeRaw(lineCount, makeRandom(i + 1)));
    const image = await doc.embedPng(png);
    const page = doc.addPage([A4.width, A4.height]);
    page.drawImage(image, { x: 0, y: 0, width: A4.width, height: A4.height });
  }
  return doc.save();
}

// 小さい PDF を3本組んで、必要な行数を逆算する。
//
// **PNG を縮めた寸法から見積もってはいけない。**pdf-lib は PNG を一度ほどいて
// 自前で入れ直すので、同じ画素でも出来上がりの寸法が変わる（実測で狙いの
// 85% にしかならなかった）。出口である PDF そのもので測る。
//
//   blank1 = 定数部 + 白紙1ページ
//   blank2 = 定数部 + 白紙2ページ        → 白紙1ページぶん = blank2 - blank1
//   probe  = 定数部 + (白紙 + L行)1ページ → 1行あたり = (probe - blank1) / L
async function calibrate() {
  const probeLines = 20;
  const [blank1, blank2, probe] = await Promise.all([
    buildDoc(1, 0),
    buildDoc(2, 0),
    buildDoc(1, probeLines),
  ]).then((docs) => docs.map((bytes) => bytes.length));

  const perPage = blank2 - blank1;
  const fixed = blank1 - perPage;
  const perLine = (probe - blank1) / probeLines;
  const lineCount = Math.max(1,
    Math.round((TARGET_BYTES - fixed - PAGE_COUNT * perPage) / (PAGE_COUNT * perLine)));
  return { fixed, perPage, perLine: Math.round(perLine), lineCount };
}

async function build() {
  const plan = await calibrate();
  const bytes = await buildDoc(PAGE_COUNT, plan.lineCount);
  fs.writeFileSync(OUTPUT, bytes);
  return { plan, bytes: bytes.length };
}

if (require.main === module) {
  build().then(({ plan, bytes }) => {
    const mb = (bytes / 1024 / 1024).toFixed(2);
    console.log(`${path.basename(OUTPUT)}: ${PAGE_COUNT}ページ / ${mb}MB (${bytes} バイト)`);
    console.log(`  行数 ${plan.lineCount}（白紙1ページ ${plan.perPage} バイト・`
      + `1行あたり ${plan.perLine} バイト・定数部 ${plan.fixed} バイト）`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { OUTPUT, PAGE_COUNT, TARGET_BYTES, IMAGE, build, calibrate };
