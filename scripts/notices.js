'use strict';

// THIRD-PARTY-NOTICES.md を node_modules の実物から組み立てる。
// 手で転記すると版が上がったときに現物とずれる。依存を足したら BUNDLED か
// DEV_ONLY に1行足して `npm run notices` を回す。

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');

// 配布物に入るもの。全文を収録する。
const BUNDLED = [
  {
    pkg: 'electron',
    license: 'node_modules/electron/LICENSE',
    note: 'アプリケーションの実行基盤。Electron が内包する Chromium と Node.js の告知は、'
      + '配布物に同梱される `LICENSES.chromium.html` に収録されている。',
  },
  {
    pkg: 'pdfjs-dist',
    license: 'node_modules/pdfjs-dist/LICENSE',
    note: 'PDF の描画に用いる。`vendor/pdf.mjs`・`vendor/pdf.worker.mjs`・`vendor/cmaps/`・'
      + '`vendor/standard_fonts/`・`vendor/wasm/`・`vendor/iccs/` として同梱する。'
      + 'このうち `vendor/wasm/` と `vendor/iccs/` は出自の異なるコードを含むため、次節に個別に掲げる。',
  },
  {
    pkg: 'pdf-lib',
    license: 'node_modules/pdf-lib/LICENSE.md',
    note: 'PDF の生成と編集に用いる。`vendor/pdf-lib.min.js` として同梱する。',
  },
  {
    pkg: '@pdf-lib/fontkit',
    license: null,
    note: 'フォントの埋め込みに用いる。`vendor/fontkit.umd.min.js` として同梱する。'
      + 'パッケージにライセンスファイルが含まれていないため、`package.json` の `license` 欄'
      + '（MIT）に基づき、下に MIT ライセンスの本文を掲げる。',
    fallbackLicense: 'MIT',
    fallbackCopyright: 'Copyright (c) 2020 Andrew Dillon',
  },
  {
    pkg: 'pako',
    license: 'node_modules/pako/LICENSE',
    note: '`vendor/pdf-lib.min.js` に取り込まれている。',
  },
  {
    pkg: '@pdf-lib/standard-fonts',
    license: 'node_modules/@pdf-lib/standard-fonts/LICENSE.md',
    note: '`vendor/pdf-lib.min.js` に取り込まれている。',
  },
  {
    pkg: '@pdf-lib/upng',
    license: 'node_modules/@pdf-lib/upng/LICENSE',
    note: '`vendor/pdf-lib.min.js` に取り込まれている。',
  },
  {
    pkg: 'tslib',
    license: 'node_modules/tslib/LICENSE.txt',
    note: '`vendor/pdf-lib.min.js` に取り込まれている。',
  },
];

// パッケージの中に同居している、出自の違うコードである。package.json を持たないため
// 版を引けない。名称・ライセンス・用途で示し、全文は付属のライセンスファイルから読む。
// vendor/wasm/ と vendor/iccs/ を同梱すると決めたのは spec-1-1 確定事項3・4 である。
const BUNDLED_COMPONENTS = [
  {
    name: 'JBIG2 デコーダ',
    license: 'BSD-3-Clause（PDFium）/ Apache-2.0（pdf.js の組み込み部分）',
    note: 'JBIG2 で圧縮された白黒画像の展開に用いる。`vendor/wasm/jbig2.wasm` として同梱する。',
    files: ['node_modules/pdfjs-dist/wasm/LICENSE_JBIG2', 'node_modules/pdfjs-dist/wasm/LICENSE_PDFJS_JBIG2'],
  },
  {
    name: 'JPEG2000 デコーダ（OpenJPEG）',
    license: 'BSD-2-Clause',
    note: 'JPEG2000 で圧縮された画像の展開に用いる。`vendor/wasm/openjpeg.wasm` として同梱する。',
    files: ['node_modules/pdfjs-dist/wasm/LICENSE_OPENJPEG', 'node_modules/pdfjs-dist/wasm/LICENSE_PDFJS_OPENJPEG'],
  },
  {
    name: '色管理（qcms）',
    license: 'MIT',
    note: 'ICC プロファイルに基づく色変換に用いる。`vendor/wasm/qcms_bg.wasm` として同梱する。',
    files: ['node_modules/pdfjs-dist/wasm/LICENSE_QCMS', 'node_modules/pdfjs-dist/wasm/LICENSE_PDFJS_QCMS'],
  },
  {
    name: 'CGATS001Compat-v2-micro（ICC プロファイル）',
    license: 'CC0-1.0',
    note: 'CMYK の色を画面の色へ移すときの既定のプロファイルである。`vendor/iccs/` として同梱する。',
    files: ['node_modules/pdfjs-dist/iccs/LICENSE'],
  },
];

// 開発時だけ使い、配布物には入らないもの。名称と種別のみ挙げる。
const DEV_ONLY = ['electron-builder', 'jsdom'];

const MIT_TEMPLATE = (copyright) => `MIT License

${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// 1つの節に複数のライセンス全文を並べるときの区切り。
const SEPARATOR = '\n\n----------------------------------------\n\n';

function readManifest(pkg) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', ...pkg.split('/'), 'package.json'), 'utf8'));
}

function licenseText(entry) {
  if (entry.license === null)
    return MIT_TEMPLATE(entry.fallbackCopyright);
  return fs.readFileSync(path.join(ROOT, entry.license), 'utf8').trimEnd();
}

// GPL 系が紛れ込んでいないかを機械的に確かめる。同梱前に判断が要るため。
function findCopyleft() {
  const modules = path.join(ROOT, 'node_modules');
  const hits = [];
  const visit = (dir, scope) => {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.'))
        continue;
      if (name.startsWith('@') && scope === null) {
        visit(path.join(dir, name), name);
        continue;
      }
      const pkgName = scope === null ? name : `${scope}/${name}`;
      let license;
      try {
        license = readManifest(pkgName).license;
      } catch {
        continue;
      }
      if (typeof license === 'string' && /(^|[^L])GPL|AGPL/i.test(license))
        hits.push(`${pkgName}: ${license}`);
    }
  };
  visit(modules, null);
  return hits;
}

function build() {
  const copyleft = findCopyleft();

  const sections = BUNDLED.map((entry) => {
    const manifest = readManifest(entry.pkg);
    const license = manifest.license ?? entry.fallbackLicense;
    return [
      `### ${entry.pkg} ${manifest.version}`,
      '',
      `- ライセンス: ${typeof license === 'string' ? license : JSON.stringify(license)}`,
      manifest.homepage ? `- 配布元: ${manifest.homepage}` : null,
      '',
      entry.note,
      '',
      '```',
      licenseText(entry),
      '```',
    ].filter((line) => line !== null).join('\n');
  });

  const componentSections = BUNDLED_COMPONENTS.map((entry) => [
    `### ${entry.name}`,
    '',
    `- ライセンス: ${entry.license}`,
    '',
    entry.note,
    '',
    '```',
    entry.files.map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8').trimEnd()).join(SEPARATOR),
    '```',
  ].join('\n'));

  const devList = DEV_ONLY.map((pkg) => {
    const manifest = readManifest(pkg);
    return `| ${pkg} | ${manifest.version} | ${manifest.license} |`;
  });

  const body = `# 第三者ソフトウェアの告知

SigK PDF は以下の第三者ソフトウェアを利用している。それぞれのライセンス条項に従い、
著作権表示と許諾条項の全文をここに掲げる。

このファイルは \`scripts/notices.js\` が \`node_modules\` の実物から組み立てている。
依存を足したときは同スクリプトの一覧に加えて \`npm run notices\` を実行すること。

## 同梱するもの

配布物（インストーラー）に含まれるソフトウェアである。

${sections.join('\n\n')}

## 同梱するもの（パッケージの一部として入るもの）

上のパッケージの中に同居しており、著作権者と条項が異なるものである。

${componentSections.join('\n\n')}

## 開発時にのみ用いるもの

配布物には含まれないため、全文は掲げず名称と種別のみを挙げる。

| 名称 | 版 | ライセンス |
|---|---|---|
${devList.join('\n')}

## 今後追加するもの

| 名称 | ライセンス | 追加する時期 |
|---|---|---|
| Noto Sans JP | SIL Open Font License 1.1 | Phase 4-1（日本語フォントの埋め込み基盤） |

## コピーレフト系ライセンスの確認

${copyleft.length === 0
    ? '`node_modules` を走査し、GPL・AGPL のパッケージが含まれていないことを確認している。'
    : `**確認が必要である。**次のパッケージが該当した。\n\n${copyleft.map((line) => `- ${line}`).join('\n')}`}

## SigK PDF 自体のライセンス

MIT License。全文は \`LICENSE\` を参照のこと。
`;

  fs.writeFileSync(OUTPUT, body, 'utf8');
  return { path: OUTPUT, bundled: BUNDLED.length, components: BUNDLED_COMPONENTS.length, copyleft };
}

module.exports = { BUNDLED, BUNDLED_COMPONENTS, DEV_ONLY, findCopyleft, build };

if (require.main === module) {
  const result = build();
  console.log(`同梱 ${result.bundled} 件＋構成部品 ${result.components} 件の告知を書き出しました: ${path.relative(ROOT, result.path)}`);
  if (result.copyleft.length > 0) {
    console.error('GPL / AGPL のパッケージが見つかりました。同梱の可否を確認してください。');
    console.error(result.copyleft.join('\n'));
    process.exitCode = 1;
  }
}
