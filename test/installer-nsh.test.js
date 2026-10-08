'use strict';

// 右クリックメニューを登録・削除する build/installer.nsh の静的検査（spec-5-1 確定事項22〜31・「テストの範囲」の 10 項目）と、
// 塊②で足した書き方の決まり（WriteReg の型・キー名・マクロの外の行。spec-5-2）。関連付けと完了ページは installer-assoc.test.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { INTENTS, EXTENSIONS } = require('../launch-args.js');
const { IMAGE_FILTERS } = require('../image-io.js');
const {
  TEXT, CODE_LINES, expand, INSTALL, UNINSTALL, deletesOf, valueDeletesOf, WRITES, MENU_WRITES, isUnder, ID, EXE, SFA, valueOf, imageExtsOf,
} = require('./installer-nsh-parse.js');

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
  // customInstall で消すのは、書く前のメニューの分だけ（書いたあとに消す行も、関連付けを消す行も無い）。
  const firstWrite = INSTALL.findIndex(({ line }) => line.startsWith('WriteReg'));
  const cleanedBefore = deletesOf(INSTALL.slice(0, firstWrite), { guarded: false });
  const menuDeletes = deletesOf(expand('sigkRemoveMenus'), { guarded: false }).sort();
  assert.deepEqual([...cleanedBefore].sort(), menuDeletes);
  assert.deepEqual([...deletesOf(INSTALL, { guarded: false })].sort(), menuDeletes);
  for (const { key } of MENU_WRITES)
    assert.ok(cleanedBefore.some((top) => isUnder(key, top)), `書く前に消していない: ${key}`);
});

test('レジストリへ書く命令は WriteRegStr と WriteRegNone だけ（ほかの型で既定値などを書かない）', () => {
  const commands = new Set(CODE_LINES.filter((line) => /^WriteReg/.test(line)).map((line) => line.split(/\s/)[0]));
  assert.deepEqual([...commands].sort(), ['WriteRegNone', 'WriteRegStr']);
  assert.deepEqual(WRITES.filter(({ command }) => command === 'WriteRegNone').map(({ key }) => key), ['Software\\Classes\\.pdf\\OpenWithProgids']);
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
      assert.match(line, /^!(ifndef|ifdef|if|define|endif|else|error)\b/, `マクロの外の行: ${line}`);
  }
});

test('8. SHChangeNotify を、インストール（書いた後）とアンインストールの両方で呼ぶ', () => {
  const notify = (lines) => lines.findIndex(({ line }) => /^System::Call 'shell32::SHChangeNotify\(i 0x08000000,/.test(line));
  const lastWrite = INSTALL.map(({ line }) => line.startsWith('WriteRegStr ')).lastIndexOf(true);
  assert.ok(notify(INSTALL) > lastWrite);
  assert.ok(notify(UNINSTALL) >= 0);
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

test('electron-builder の設定が、このファイルを取り込む', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
});
