'use strict';

// 検証用の PDF を pdf-lib で生成する（docs/07 決定10）。
//
// バイナリをリポジトリに置かないのは、fixture の意図をコードとして読めるように
// するためである。「3ページ・2ページ目だけ 90 度回転」がここに書いてあれば、
// 差分にも出るし、テストが何を前提にしているかを追える。
//
// ユーザーの実ファイルは決して使わない（.claude/CLAUDE.md 付則C）。
// npm test の前に pretest から実行される。

const fs = require('node:fs');
const path = require('node:path');

const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');

const OUTPUT_DIR = __dirname;

const A4 = { width: 595.28, height: 841.89 };
const A5 = { width: 419.53, height: 595.28 };

// 生成するもの。テストはこの名前と中身の対応に依存する。
//
// caption を ASCII に限るのは、pdf-lib の標準14書体が WinAnsi しか扱えず
// 日本語を描けないためである（docs/02 1-4）。日本語を紙に載せられるのは
// Noto Sans JP を埋め込む Phase 4-1 からである。label は文書のタイトル
// （Info 辞書）に入れる。こちらは UTF-16 で書かれるため日本語で問題ない。
const FIXTURES = [
  { file: 'one-page.pdf', pages: 1, size: A4, label: '1ページだけの文書', caption: 'one page' },
  { file: 'three-pages.pdf', pages: 3, size: A4, label: '素直な3ページ', caption: 'three pages' },
  { file: 'rotated.pdf', pages: 3, size: A4, rotate: { 1: 90 }, label: '2ページ目だけ 90 度回転', caption: 'page 2 rotated 90' },
  { file: 'mixed-size.pdf', pages: 3, size: A4, sizeOverrides: { 1: A5 }, label: '2ページ目だけ A5', caption: 'page 2 is A5' },
  { file: 'many-pages.pdf', pages: 40, size: A4, label: '連続スクロールの確認用', caption: 'continuous scroll' },
];

async function buildOne(spec) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(spec.label);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < spec.pages; index += 1) {
    const size = spec.sizeOverrides?.[index] ?? spec.size;
    const page = pdf.addPage([size.width, size.height]);
    // ページの取り違えに気づけるよう、必ず番号を大きく描く。
    page.drawText(`${index + 1}`, {
      x: size.width / 2 - 40,
      y: size.height / 2 - 40,
      size: 96,
      font,
      color: rgb(0.11, 0.14, 0.19),
    });
    page.drawText(spec.caption, { x: 48, y: size.height - 64, size: 14, font, color: rgb(0.37, 0.42, 0.48) });
    const angle = spec.rotate?.[index];
    if (angle !== undefined)
      page.setRotation(degrees(angle));
  }

  const bytes = await pdf.save();
  fs.writeFileSync(path.join(OUTPUT_DIR, spec.file), bytes);
  return { file: spec.file, bytes: bytes.length };
}

async function build() {
  const built = [];
  for (const spec of FIXTURES)
    built.push(await buildOne(spec));
  return built;
}

function fixturePath(file) {
  return path.join(OUTPUT_DIR, file);
}

module.exports = { A4, A5, FIXTURES, OUTPUT_DIR, build, buildOne, fixturePath };

if (require.main === module) {
  build().then((built) => {
    console.log(`検証用 PDF を ${built.length} 件生成しました: ${built.map((item) => item.file).join('、')}`);
  }).catch((error) => {
    console.error('検証用 PDF の生成に失敗しました。');
    console.error(error);
    process.exitCode = 1;
  });
}
