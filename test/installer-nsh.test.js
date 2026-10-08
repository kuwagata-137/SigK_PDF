'use strict';

// 右クリックメニューと「プログラムから開く」・既定のアプリの選択肢を登録・削除する build/installer.nsh の
// 静的検査（spec-5-1 確定事項22〜31・「テストの範囲」の 10 項目、spec-5-2 確定事項A・D・「テストの範囲」）。
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

// WriteRegNone は値の中身を持たない（.pdf の OpenWithProgids の候補。spec-5-2 確定事項A2）。
const writesOf = (lines) => lines
  .filter(({ line }) => /^WriteReg(Str|None) /.test(line))
  .map(({ line }) => {
    const [command, root, key, name, value] = tokens(line);
    return { command, root, key, name, value };
  });
// 子も値も無いときだけ消す親キー（sigkPruneEmptyKey の中の DeleteRegKey）は分けて扱う。
const deletesOf = (lines, { guarded }) => lines
  .filter(({ line }) => line.startsWith('DeleteRegKey '))
  .filter(({ via }) => via.includes('sigkPruneEmptyKey') === guarded)
  .map(({ line }) => tokens(line)[2]);
const valueDeletesOf = (lines) => lines
  .filter(({ line }) => line.startsWith('DeleteRegValue '))
  .map(({ line }) => {
    const [, , key, name] = tokens(line);
    return { key, name };
  });

const WRITES = writesOf(INSTALL);
// 関連付け（spec-5-2 確定事項A）。メニュー（spec-5-1）とは書き方と消し方が違う。
const ASSOC_WRITES = writesOf(expand('sigkWriteAssoc'));
const MENU_WRITES = WRITES.filter((write) => !ASSOC_WRITES.some((assoc) => assoc.key === write.key && assoc.name === write.name));
// customUnInstall のうち、${ifNot} ${isUpdated} の中の行（上書きインストールでは走らない）。
function updateGuarded(lines) {
  const open = lines.findIndex(({ line }) => line === '${ifNot} ${isUpdated}');
  const close = lines.findIndex(({ line }, index) => index > open && line === '${endIf}');
  return { open, close, inside: (index) => open >= 0 && index > open && index < close };
}
const ID = '${SIGK_SHELL_ID}';
const EXE = '"$INSTDIR\\${APP_EXECUTABLE_FILENAME}"';
const SFA = 'Software\\Classes\\SystemFileAssociations';
const valueOf = (key, name) => WRITES.find((write) => write.key === key && write.name === name)?.value;
const imageExtsOf = (lines) => lines
  .map(({ line }) => new RegExp(`^(?:WriteRegStr|DeleteRegKey) HKCU "${SFA.replace(/\\/g, '\\\\')}\\\\(\\.[a-z]+)\\\\shell\\\\\\$\\{SIGK_SHELL_ID\\}\\.ToPdf"`).exec(line)?.[1])
  .filter(Boolean);

test('1. customInstall で書くキーと値は、すべて customUnInstall で消す', () => {
  const deletes = deletesOf(UNINSTALL, { guarded: false });
  const valueDeletes = valueDeletesOf(UNINSTALL);
  assert.ok(WRITES.length > 0);
  for (const { key, name } of WRITES) {
    const byKey = deletes.some((top) => key === top || key.startsWith(`${top}\\`));
    const byValue = valueDeletes.some((del) => del.key === key && del.name === name);
    assert.ok(byKey || byValue, `消し忘れ: ${key} [${name}]`);
  }
  // メニューは、上書きで二重にならないよう、書く前にも同じものを消す（spec-5-1 事前調査 B3）。
  const firstWrite = INSTALL.findIndex(({ line }) => line.startsWith('WriteRegStr '));
  const cleanedBefore = deletesOf(INSTALL.slice(0, firstWrite), { guarded: false });
  assert.deepEqual([...cleanedBefore].sort(), deletesOf(expand('sigkRemoveMenus'), { guarded: false }).sort());
  for (const { key } of MENU_WRITES)
    assert.ok(cleanedBefore.some((top) => key === top || key.startsWith(`${top}\\`)), `書く前に消していない: ${key}`);
});

test('関連付けは書く前に消さず、上書きインストールでは消さない（spec-5-2 確定事項A6）', () => {
  assert.ok(ASSOC_WRITES.length > 0);
  // customInstall に関連付けを消す行が無い。
  assert.equal(INSTALL.some(({ via }) => via.includes('sigkRemoveAssoc')), false);
  assert.deepEqual(valueDeletesOf(INSTALL), []);
  // customUnInstall では、${ifNot} ${isUpdated} の中だけで消す。メニューは毎回消す。
  const guard = updateGuarded(UNINSTALL);
  assert.ok(guard.open >= 0 && guard.close > guard.open, '${ifNot} ${isUpdated} … ${endIf} がある');
  UNINSTALL.forEach(({ line, via }, index) => {
    if (via.includes('sigkRemoveAssoc'))
      assert.ok(guard.inside(index), `上書きでも消してしまう: ${line}`);
    if (via.includes('sigkRemoveMenus'))
      assert.ok(!guard.inside(index), `メニューは毎回消す: ${line}`);
  });
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
  assert.equal(switchOf(`Software\\Classes\\${ID}.Document\\shell\\open\\command`), '--open');
  assert.equal(switchOf('Software\\Classes\\Applications\\${APP_EXECUTABLE_FILENAME}\\shell\\open\\command'), '--open');
  for (const { value } of commands)
    assert.ok(Object.hasOwn(INTENTS, /(--[a-z-]+)/.exec(value)[1]), value);
  // メニュー 3・画像 7・関連付け 2（ProgID と Applications の open。spec-5-2 確定事項A1・A3）。
  assert.equal(commands.length, 3 + EXTENSIONS.toPdf.length + 2);
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
  // ID を含まないのは、exe の名前で組む Applications と、Windows の共有の場所（.pdf の候補・既定のアプリの一覧）だけ。
  const shared = ['Software\\Classes\\Applications\\${APP_EXECUTABLE_FILENAME}', 'Software\\Classes\\.pdf\\OpenWithProgids', 'Software\\RegisteredApplications'];
  for (const { key } of WRITES)
    assert.ok(key.includes(ID) || shared.some((top) => key === top || key.startsWith(`${top}\\`)), key);
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

test('9. .pdf の既定値に書かない。.pdf に書くのは OpenWithProgids の自分の値だけ。消す親キーは子も値も無いときだけ', () => {
  const pdfWrites = WRITES.filter(({ key }) => /^Software\\Classes\\\.pdf(\\|$)/i.test(key));
  assert.deepEqual(pdfWrites.map(({ command, key, name }) => [command, key, name]), [['WriteRegNone', 'Software\\Classes\\.pdf\\OpenWithProgids', `${ID}.Document`]]);
  assert.deepEqual(valueDeletesOf(UNINSTALL).filter(({ key }) => key.includes('.pdf')), [{ key: 'Software\\Classes\\.pdf\\OpenWithProgids', name: `${ID}.Document` }]);
  // 確かめずに消すのは自分のキーだけ（ID を含むか、exe の名前の Applications のキー）。
  for (const key of [...deletesOf(INSTALL, { guarded: false }), ...deletesOf(UNINSTALL, { guarded: false })])
    assert.ok(key.includes(ID) || key === 'Software\\Classes\\Applications\\${APP_EXECUTABLE_FILENAME}', `確かめずに消すのは自分のキーだけ: ${key}`);
  const guarded = new Set(deletesOf(UNINSTALL, { guarded: true }));
  assert.ok(guarded.has(`${SFA}\\.pdf`) && guarded.has(`${SFA}\\.pdf\\shell`));
  // 共有の親キーは、空になっても消さない（spec-5-2 確定事項A5。事前調査 E）。自分の Software\<ID> は空なら消す。
  for (const key of ['Software\\Classes\\.pdf', 'Software\\Classes\\.pdf\\OpenWithProgids', 'Software\\Classes\\Applications', 'Software\\RegisteredApplications'])
    assert.ok(!guarded.has(key), `消さない: ${key}`);
  assert.ok(guarded.has(`Software\\${ID}`));
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

test('インストールは自分だけに固定し、完了ページで Windows 11 の出る場所と既定のアプリの入口を知らせる（spec-5-1 論点6・7・spec-5-2 確定事項D）', () => {
  assert.deepEqual(expand('customInstallMode').map(({ line }) => line), ['StrCpy $isForceCurrentInstall "1"']);
  const open = CODE_LINES.indexOf('!ifndef BUILD_UNINSTALLER');
  const close = CODE_LINES.indexOf('!endif', open);
  const block = CODE_LINES.slice(open + 1, close);
  const text = block.find((line) => line.startsWith('!define MUI_FINISHPAGE_TEXT '));
  assert.ok(open >= 0 && text !== undefined, 'アンインストーラーには効かせない');
  // 日本語版 Windows 11 の項目名は「確認」（docs/07 決定45 ⑤）。
  assert.match(text, /「その他のオプションを確認」/);
  assert.doesNotMatch(text, /その他のオプションを表示/);
  // 入口の名前は main.js のメニューと同じ（spec-5-2 確定事項C1）。
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainJs, /label: '既定のアプリの設定…'/);
  assert.ok(text.includes('メニュー「ヘルプ」→「既定のアプリの設定…」'));
  // 「完了後に起動」があると文の欄は 5 行分。7 行の文を入れるため広げる（事前調査 I）。
  assert.ok(block.includes('!define MUI_FINISHPAGE_TEXT_LARGE'));
  assert.equal(text.split('$\\r$\\n$\\r$\\n').length, 3, '段落は 3 つ（「ウィザードを閉じるには…」は入りきらないので除いた）');
});

test('関連付けの値は docs/03 2-1・spec-5-2 確定事項A のとおり', () => {
  const assoc = (key, name) => ASSOC_WRITES.find((write) => write.key === key && write.name === name)?.value;
  const progId = `Software\\Classes\\${ID}.Document`;
  const apps = 'Software\\Classes\\Applications\\${APP_EXECUTABLE_FILENAME}';
  const caps = `Software\\${ID}\\Capabilities`;
  const open = '"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" --open "%1"';
  assert.equal(assoc(progId, ''), 'PDF 文書');
  assert.equal(assoc(`${progId}\\DefaultIcon`, ''), '${SIGK_PDF_FILE_ICON}');
  assert.equal(assoc(`${progId}\\shell\\open\\command`, ''), open);
  assert.equal(assoc(apps, 'FriendlyAppName'), '${PRODUCT_NAME}');
  assert.equal(assoc(`${apps}\\DefaultIcon`, ''), '${SIGK_PDF_FILE_ICON}');
  assert.equal(assoc(`${apps}\\shell\\open\\command`, ''), open);
  assert.equal(assoc(`${apps}\\SupportedTypes`, '.pdf'), '');
  assert.equal(assoc(caps, 'ApplicationName'), '${PRODUCT_NAME}');
  assert.equal(assoc(caps, 'ApplicationIcon'), '$INSTDIR\\${APP_EXECUTABLE_FILENAME},0');
  assert.equal(assoc(`${caps}\\FileAssociations`, '.pdf'), `${ID}.Document`);
  assert.equal(assoc('Software\\RegisteredApplications', '${PRODUCT_NAME}'), caps);
  // PDF ファイルの絵は、extraResources で resources へ出した ICO（spec-5-2 確定事項B4）。
  assert.ok(CODE_LINES.includes('!define SIGK_PDF_FILE_ICON "$INSTDIR\\resources\\pdf-file.ico"'));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.extraResources.some((entry) => entry.to === 'pdf-file.ico'));
});

test('electron-builder の設定が、このファイルを取り込む', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
});
