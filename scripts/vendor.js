'use strict';

// 同梱ライブラリを node_modules から vendor/ へ複製する。
// バンドラーを置かない方針のため、レンダラーは vendor/ 配下を app:// 経由で直接読む。
// npm install の postinstall から実行される。
//
// 複製元は devDependencies に置いてある。実行時に node_modules から require する
// ことはなく、あくまで vendor/ を作るための材料だからである。dependencies に
// 置くと electron-builder が node_modules を丸ごと同梱し、pdfjs-dist が引き込む
// ネイティブモジュールまで配布物に入って100MB以上膨らむ。

const fs = require('node:fs');
const path = require('node:path');

// 複製するもの。from はパッケージのルートからの相対パス。
const VENDOR_MANIFEST = [
  { label: 'pdf.js', pkg: 'pdfjs-dist', from: 'build/pdf.mjs', to: 'pdf.mjs', kind: 'file' },
  { label: 'pdf.js worker', pkg: 'pdfjs-dist', from: 'build/pdf.worker.mjs', to: 'pdf.worker.mjs', kind: 'file' },
  { label: 'pdf.js cmaps', pkg: 'pdfjs-dist', from: 'cmaps', to: 'cmaps', kind: 'dir' },
  { label: 'pdf.js 標準フォント', pkg: 'pdfjs-dist', from: 'standard_fonts', to: 'standard_fonts', kind: 'dir' },
  { label: 'pdf-lib', pkg: 'pdf-lib', from: 'dist/pdf-lib.min.js', to: 'pdf-lib.min.js', kind: 'file' },
  { label: 'fontkit', pkg: '@pdf-lib/fontkit', from: 'dist/fontkit.umd.min.js', to: 'fontkit.umd.min.js', kind: 'file' },
];

// 複製計画を組む。ファイルシステムには触らない（テストから安全に呼べるようにするため）。
function planVendorCopy({ rootDir, manifest = VENDOR_MANIFEST } = {}) {
  if (!rootDir)
    throw new Error('planVendorCopy: rootDir が必要です');

  const nodeModules = path.join(rootDir, 'node_modules');
  const vendorDir = path.join(rootDir, 'vendor');

  return manifest.map((item) => ({
    label: item.label,
    kind: item.kind,
    from: path.join(nodeModules, ...item.pkg.split('/'), ...item.from.split('/')),
    to: path.join(vendorDir, ...item.to.split('/')),
  }));
}

// 複製元が実在するかを調べ、欠けているものだけを返す。
function verifyVendorSources(plan, fsLike = fs) {
  return plan.filter((entry) => !fsLike.existsSync(entry.from));
}

function formatMissing(missing) {
  const lines = missing.map((entry) => `  - ${entry.label}: ${entry.from}`);
  return [
    '同梱ライブラリの複製元が見つかりません。',
    'npm install が正常に終わっているか、パッケージのファイル構成が変わっていないかを確認してください。',
    ...lines,
  ].join('\n');
}

// 実際に複製する。複製元が欠けていれば、黙って進めず全件を列挙して落とす。
// 黙って進めると Phase 1 で原因の分からない失敗になる（spec-0 確定事項9）。
function runVendorCopy({ rootDir, manifest = VENDOR_MANIFEST, log = () => {} } = {}) {
  const plan = planVendorCopy({ rootDir, manifest });
  const missing = verifyVendorSources(plan);
  if (missing.length > 0)
    throw new Error(formatMissing(missing));

  const vendorDir = path.join(rootDir, 'vendor');
  fs.rmSync(vendorDir, { recursive: true, force: true });
  fs.mkdirSync(vendorDir, { recursive: true });

  for (const entry of plan) {
    fs.mkdirSync(path.dirname(entry.to), { recursive: true });
    fs.cpSync(entry.from, entry.to, { recursive: entry.kind === 'dir' });
    log(`${entry.label} → ${path.relative(rootDir, entry.to)}`);
  }

  return plan;
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const plan = runVendorCopy({ rootDir, log: (line) => console.log(`  ${line}`) });
  console.log(`同梱ライブラリを ${plan.length} 件複製しました。`);
}

module.exports = { VENDOR_MANIFEST, planVendorCopy, verifyVendorSources, runVendorCopy };

if (require.main === module)
  main();
