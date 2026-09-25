'use strict';

// 右クリックメニューを登録・削除する build/installer.nsh の静的検査（spec-5-1 確定事項22〜31・
// 「テストの範囲」の 10 項目）。
//
// NSIS はここでは走らせない（実機での登録・上書き・削除は、別名のインストーラーで確かめる。
// spec-5-1 事前調査 B・起動確認 S8）。ここは .nsh の文字列を読み、!insertmacro を展開した
// 形で「何を書き、何を消すか」を見張る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { INTENTS, EXTENSIONS } = require('../launch-args.js');
const { IMAGE_FILTERS } = require('../image-io.js');

const NSH_PATH = path.join(__dirname, '..', 'build', 'installer.nsh');
const TEXT = fs.readFileSync(NSH_PATH, 'utf8');

// コメント（; で始まる行）と空行を落とした行。
const CODE_LINES = TEXT.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith(';'));

// NSIS の引数を切り出す。"…"・'…'・`…` は 1 つの引数で、中の引用符はそのまま残る。
function tokens(line) {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
}

function parseMacros() {
  const macros = new Map();
  let current = null;
  for (const line of CODE_LINES) {
    const open = /^!macro\s+(\S+)(.*)$/.exec(line);
    if (open !== null) {
      current = { name: open[1], params: open[2].trim().split(/\s+/).filter(Boolean), body: [] };
      continue;
    }
    if (line === '!macroend') {
      macros.set(current.name.toLowerCase(), current);
      current = null;
      continue;
    }
    if (current !== null)
      current.body.push(line);
  }
  return macros;
}

const MACROS = parseMacros();

// !insertmacro を展開する。via は、その行がどのマクロを通って出てきたか（外側から）。
// NSIS のマクロ名は大文字と小文字を区別しない（事前調査 B5）。
function expand(name, args = [], via = []) {
  const macro = MACROS.get(name.toLowerCase());
  assert.ok(macro !== undefined, `マクロ ${name} が無い`);
  const lines = [];
  for (const raw of macro.body) {
    let line = raw;
    macro.params.forEach((param, index) => { line = line.split(`\${${param}}`).join(args[index]); });
    const insert = /^!insertmacro\s+(\S+)(.*)$/.exec(line);
    if (insert === null)
      lines.push({ line, via: [...via, macro.name] });
    else
      lines.push(...expand(insert[1], tokens(insert[2]), [...via, macro.name]));
  }
  return lines;
}

const INSTALL = expand('customInstall');
const UNINSTALL = expand('customUnInstall');

const writesOf = (lines) => lines
  .filter(({ line }) => line.startsWith('WriteRegStr '))
  .map(({ line }) => {
    const [, root, key, name, value] = tokens(line);
    return { root, key, name, value };
  });
// 子も値も無いときだけ消す親キー（sigkPruneEmptyKey の中の DeleteRegKey）は分けて扱う。
const deletesOf = (lines, { guarded }) => lines
  .filter(({ line }) => line.startsWith('DeleteRegKey '))
  .filter(({ via }) => via.includes('sigkPruneEmptyKey') === guarded)
  .map(({ line }) => tokens(line)[2]);

const WRITES = writesOf(INSTALL);
const ID = '${SIGK_SHELL_ID}';
const EXE = '"$INSTDIR\\${APP_EXECUTABLE_FILENAME}"';
const SFA = 'Software\\Classes\\SystemFileAssociations';
const valueOf = (key, name) => WRITES.find((write) => write.key === key && write.name === name)?.value;
const imageExtsOf = (lines) => lines
  .map(({ line }) => new RegExp(`^(?:WriteRegStr|DeleteRegKey) HKCU "${SFA.replace(/\\/g, '\\\\')}\\\\(\\.[a-z]+)\\\\shell\\\\\\$\\{SIGK_SHELL_ID\\}\\.ToPdf"`).exec(line)?.[1])
  .filter(Boolean);

test('1. customInstall で書くキーは、すべて customUnInstall で消す', () => {
  const deletes = deletesOf(UNINSTALL, { guarded: false });
  assert.ok(WRITES.length > 0);
  for (const { key } of WRITES)
    assert.ok(deletes.some((top) => key === top || key.startsWith(`${top}\\`)), `消し忘れ: ${key}`);
  // 上書きで二重にならないよう、書く前にも同じものを消す（事前調査 B3）。
  const firstWrite = INSTALL.findIndex(({ line }) => line.startsWith('WriteRegStr '));
  const cleanedBefore = deletesOf(INSTALL.slice(0, firstWrite), { guarded: false });
  assert.deepEqual([...cleanedBefore].sort(), [...deletes].sort());
});

test('2. 書き先・消し先・調べ先は HKCU だけ', () => {
  const roots = [...TEXT.matchAll(/\bHK[A-Z_]+\b/g)].map((m) => m[0]);
  assert.ok(roots.length > 0);
  assert.deepEqual([...new Set(roots)], ['HKCU']);
});

test('3. 画像の拡張子は、起動引数（launch-args.js）と変換画面のファイル選択（image-io.js）と同じ 7 つ', () => {
  const expected = [...EXTENSIONS.toPdf].sort();
  assert.deepEqual([...new Set(imageExtsOf(INSTALL.filter(({ line }) => line.startsWith('WriteRegStr '))))].sort(), expected);
  assert.deepEqual([...new Set(imageExtsOf(UNINSTALL))].sort(), expected, '消すのも同じ 7 つ');
  assert.deepEqual(IMAGE_FILTERS.flatMap((filter) => filter.extensions).map((ext) => `.${ext}`).sort(), expected);
});

test('4. 使うスイッチは INTENTS にあるものだけで、項目との対応が正しい', () => {
  const commands = WRITES.filter(({ key }) => key.endsWith('\\command'));
  const switchOf = (key) => /(--[a-z-]+)/.exec(commands.find((write) => write.key === key).value)[1];
  assert.equal(switchOf(`Software\\Classes\\${ID}.Menu\\shell\\01open\\command`), '--open');
  assert.equal(switchOf(`Software\\Classes\\${ID}.Menu\\shell\\02merge\\command`), '--merge');
  assert.equal(switchOf(`Software\\Classes\\${ID}.Menu\\shell\\03split\\command`), '--split');
  for (const ext of EXTENSIONS.toPdf)
    assert.equal(switchOf(`${SFA}\\${ext}\\shell\\${ID}.ToPdf\\command`), '--to-pdf');
  for (const { value } of commands)
    assert.ok(Object.hasOwn(INTENTS, /(--[a-z-]+)/.exec(value)[1]), value);
  assert.equal(commands.length, 3 + EXTENSIONS.toPdf.length);
});

test('5. コマンドは引用符付きの exe のパスと、引用符付きの "%1" で書く（事前調査 C）', () => {
  for (const { key, name, value } of WRITES.filter((write) => write.key.endsWith('\\command'))) {
    assert.equal(name, '', `${key} は既定値に書く`);
    assert.match(value, /^"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" --[a-z-]+ "%1"$/, key);
  }
  for (const { value } of WRITES.filter((write) => write.name === 'Icon'))
    assert.equal(value, '$INSTDIR\\${APP_EXECUTABLE_FILENAME},0');
  assert.ok(EXE.length > 0);
});

test('6. キー名は SIGK_SHELL_ID から組み、名前をじかに書かない', () => {
  for (const { key } of WRITES)
    assert.ok(key.includes(ID), key);
  const literal = CODE_LINES.filter((line) => line.includes('SigKPDF'));
  assert.deepEqual(literal, ['!define SIGK_SHELL_ID "SigKPDF"'], '既定の名前は !define の 1 か所だけ');
  assert.equal(CODE_LINES.some((line) => line.includes('SigK PDF')), false, '製品名は ${PRODUCT_NAME} から');
});

test('7. Var・Function・Section を置かない（インストーラーとアンインストーラーの両方の頭に入るため）', () => {
  const declared = CODE_LINES.filter((line) => /^(Var|Function|FunctionEnd|Section|SectionEnd)\b/i.test(line));
  assert.deepEqual(declared, []);
  // マクロの外に置いてよいのは define と、その条件だけ。
  let depth = 0;
  for (const line of CODE_LINES) {
    if (line.startsWith('!macro '))
      depth += 1;
    else if (line === '!macroend')
      depth -= 1;
    else if (depth === 0)
      assert.match(line, /^!(ifndef|ifdef|define|endif|else)\b/, `マクロの外の行: ${line}`);
  }
});

test('8. SHChangeNotify を、インストール（書いた後）とアンインストールの両方で呼ぶ', () => {
  const notify = (lines) => lines.findIndex(({ line }) => /^System::Call 'shell32::SHChangeNotify\(i 0x08000000,/.test(line));
  const lastWrite = INSTALL.map(({ line }) => line.startsWith('WriteRegStr ')).lastIndexOf(true);
  assert.ok(notify(INSTALL) > lastWrite);
  assert.ok(notify(UNINSTALL) >= 0);
});

test('9. .pdf の既定値と OpenWithProgids に触らない。消す親キーは子も値も無いときだけ', () => {
  assert.equal(CODE_LINES.some((line) => /OpenWithProgids/i.test(line)), false);
  for (const { key } of WRITES)
    assert.ok(!/^Software\\Classes\\\.pdf(\\|$)/i.test(key), key);
  for (const key of [...deletesOf(INSTALL, { guarded: false }), ...deletesOf(UNINSTALL, { guarded: false })])
    assert.ok(key.includes(ID), `確かめずに消すのは自分のキーだけ: ${key}`);
  const guarded = new Set(deletesOf(UNINSTALL, { guarded: true }));
  assert.ok(guarded.has(`${SFA}\\.pdf`) && guarded.has(`${SFA}\\.pdf\\shell`));
});

test('10. 他社の製品名・サービス名が入っていない（docs/06 1-4・1-6）', () => {
  assert.equal(/adobe|acrobat|postscript|pdf24/i.test(TEXT), false);
});

test('何個選んでも出すよう、PDF の入口と画像の項目に Player を付け、カスケードの子には付けない（論点5）', () => {
  assert.equal(valueOf(`${SFA}\\.pdf\\shell\\${ID}`, 'MultiSelectModel'), 'Player');
  assert.equal(valueOf(`${SFA}\\.pdf\\shell\\${ID}`, 'ExtendedSubCommandsKey'), `${ID}.Menu`);
  for (const ext of EXTENSIONS.toPdf)
    assert.equal(valueOf(`${SFA}\\${ext}\\shell\\${ID}.ToPdf`, 'MultiSelectModel'), 'Player', ext);
  const children = WRITES.filter(({ key }) => key.includes(`${ID}.Menu\\`));
  assert.ok(children.length > 0);
  assert.equal(children.some(({ name }) => name === 'MultiSelectModel'), false, '子には効かない（事前調査 A2）');
});

test('表示名は docs/03 2-2・2-3 のとおり', () => {
  assert.equal(valueOf(`${SFA}\\.pdf\\shell\\${ID}`, 'MUIVerb'), '${PRODUCT_NAME}');
  assert.equal(valueOf(`Software\\Classes\\${ID}.Menu\\shell\\01open`, 'MUIVerb'), '${PRODUCT_NAME} で開く');
  assert.equal(valueOf(`Software\\Classes\\${ID}.Menu\\shell\\02merge`, 'MUIVerb'), '選択した PDF を結合');
  assert.equal(valueOf(`Software\\Classes\\${ID}.Menu\\shell\\03split`, 'MUIVerb'), 'PDF を分割');
  for (const ext of EXTENSIONS.toPdf)
    assert.equal(valueOf(`${SFA}\\${ext}\\shell\\${ID}.ToPdf`, 'MUIVerb'), 'PDF に変換（${PRODUCT_NAME}）');
});

test('インストールは自分だけに固定し、完了ページで Windows 11 の出る場所を知らせる（論点6・7）', () => {
  assert.deepEqual(expand('customInstallMode').map(({ line }) => line), ['StrCpy $isForceCurrentInstall "1"']);
  const define = CODE_LINES.findIndex((line) => line.startsWith('!define MUI_FINISHPAGE_TEXT '));
  assert.ok(define > 0);
  assert.equal(CODE_LINES[define - 1], '!ifndef BUILD_UNINSTALLER', 'アンインストーラーには効かせない');
  assert.match(CODE_LINES[define], /その他のオプションを表示/);
});

test('electron-builder の設定が、このファイルを取り込む', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
});
