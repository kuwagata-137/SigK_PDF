'use strict';

// コマンドライン引数の解釈のテスト（spec-1-6 確定事項72〜80）。
//
// 依存なしで回る層である（`docs/07` 第4章）。Electron も fs も要らず、
// 実在するファイルかどうかは `isFile` で差し替える。
//
// パスはすべて Windows の形で書く。CI は ubuntu で回るので、`launch-args.js` が
// 素の `path` を使っていると、ここの検体が「絶対パスでない」と判定されて落ちる。
// あちらは `path.win32` に固定してある。
//
// いちばん確かめたいのは**スイッチの次を値とみなさない**ことである（確定事項73）。
// `second-instance` の argv は並べ替えられ、Electron が
// `--allow-file-access-from-files` を差し込むので、隣接ペアで組むと必ず壊れる。

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseLaunchArgs } = require('../launch-args.js');

const EXE = 'C:\\Program Files\\SigK PDF\\SigK PDF.exe';
const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

// 決めたパスだけが実在することにする。
const only = (...paths) => ({ isFile: (target) => paths.includes(target) });

test('引数が無ければ null', () => {
  assert.equal(parseLaunchArgs([EXE], only()), null);
  assert.equal(parseLaunchArgs([], only()), null);
  assert.equal(parseLaunchArgs(null, only()), null);
});

test('--open とパスで、開く要求になる', () => {
  assert.deepEqual(parseLaunchArgs([EXE, '--open', A], only(A)), { intent: 'open', paths: [A] });
});

test('裸のパスも「開く」として扱う', () => {
  // exe へのドラッグ＆ドロップに備える（確定事項76）。
  assert.deepEqual(parseLaunchArgs([EXE, A], only(A)), { intent: 'open', paths: [A] });
});

test('【要】並べ替えられた argv でも、スイッチ名をパスとして掴まない', () => {
  // second-instance に届く実際の形。スイッチが前へ、位置引数が後ろへ寄せられ、
  // Electron が --allow-file-access-from-files を差し込む（実測 I）。
  const argv = [EXE, '--open', '--allow-file-access-from-files', '--disable-gpu', A];

  assert.deepEqual(parseLaunchArgs(argv, only(A)), { intent: 'open', paths: [A] });
});

test('知らないスイッチは黙って捨てる', () => {
  const argv = [EXE, '--allow-file-access-from-files', '--lang=de', '--no-sandbox', A];
  assert.deepEqual(parseLaunchArgs(argv, only(A)), { intent: 'open', paths: [A] });
});

test('--open=<path> の形は1トークンのまま届く', () => {
  assert.deepEqual(parseLaunchArgs([EXE, `--open=${A}`], only(A)), { intent: 'open', paths: [A] });
});

test('切り出しは argv.slice(1) で固定する', () => {
  // 開発時は [electron.exe, アプリのディレクトリ, ...引数] になる。
  // ディレクトリは「実在するファイル」の条件で落ちる（確定事項74・75）。
  const argv = ['C:\\node_modules\\electron\\dist\\electron.exe', 'C:\\work\\SigK_PDF', '--open', A];
  assert.deepEqual(parseLaunchArgs(argv, only(A)), { intent: 'open', paths: [A] });
});

test('相対パス・存在しないファイル・意図に合わない拡張子は落ちる', () => {
  assert.equal(parseLaunchArgs([EXE, 'a.pdf'], only('a.pdf')), null, '相対パスは受けない');
  assert.deepEqual(parseLaunchArgs([EXE, '--open', A], only()), { intent: 'open', paths: [] },
    '実在しないファイルは落ちる');
  assert.equal(parseLaunchArgs([EXE, 'C:\\work\\photo.jpg'], only('C:\\work\\photo.jpg')), null,
    'open に画像は渡せない（Phase 5 で toPdf を足すときに決める）');
});

test('拡張子は大文字でも通る', () => {
  const upper = 'C:\\work\\A.PDF';
  assert.deepEqual(parseLaunchArgs([EXE, upper], only(upper)), { intent: 'open', paths: [upper] });
});

test('同じパスは1回しか載せない', () => {
  assert.deepEqual(parseLaunchArgs([EXE, `--open=${A}`, A], only(A)), { intent: 'open', paths: [A] });
});

test('複数のパスは順に並ぶ', () => {
  assert.deepEqual(parseLaunchArgs([EXE, '--merge', A, B], only(A, B)), { intent: 'merge', paths: [A, B] });
});

test('意図ごとに受け付ける拡張子が違う', () => {
  const photo = 'C:\\work\\photo.jpg';
  assert.deepEqual(parseLaunchArgs([EXE, '--to-pdf', photo], only(photo)),
    { intent: 'toPdf', paths: [photo] });
  assert.deepEqual(parseLaunchArgs([EXE, '--split', photo], only(photo)),
    { intent: 'split', paths: [] }, '分割に画像は渡せない');
});

test('意図のスイッチだけでも要求として返す', () => {
  // Phase 2 の結合・分割は「画面だけ開く」がある。パスが無いことと
  // 「引数が無い」ことは違う。
  assert.deepEqual(parseLaunchArgs([EXE, '--merge'], only()), { intent: 'merge', paths: [] });
});

test('意図のスイッチが複数あれば、最初のものを採る', () => {
  assert.deepEqual(parseLaunchArgs([EXE, '--merge', '--split', A], only(A)),
    { intent: 'merge', paths: [A] });
});
