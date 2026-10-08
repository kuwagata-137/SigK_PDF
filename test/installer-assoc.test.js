'use strict';

// 「プログラムから開く」・既定のアプリの選択肢の登録と削除、完了ページ（build/installer.nsh。spec-5-2 確定事項A・D）の静的検査。
// 右クリックメニューの分は installer-nsh.test.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CODE_LINES, expand, INSTALL, UNINSTALL, deletesOf, valueDeletesOf, WRITES, ASSOC_WRITES, isAssocDelete, updateGuarded, ID, SFA,
} = require('./installer-nsh-parse.js');

test('関連付けは書く前に消さず、上書きインストールでは消さない（spec-5-2 確定事項A6）', () => {
  assert.ok(ASSOC_WRITES.length > 0);
  // customInstall に、関連付けを消す行が 1 行も無い（マクロを使わずにじかに書いた削除も含めて）。
  assert.deepEqual(INSTALL.filter(({ line }) => isAssocDelete(line)).map(({ line }) => line), []);
  assert.deepEqual(valueDeletesOf(INSTALL), []);
  // customUnInstall では、/KEEP_APP_DATA も --updated も無いときの枠の中だけで消す。枠に ${Else} は無い。メニューは毎回消す。
  const guard = updateGuarded(UNINSTALL);
  assert.ok(guard.open >= 0 && guard.close > guard.open, '${If} ${Errors} ／ ${AndIfNot} ${isUpdated} … ${EndIf} がある');
  assert.ok(guard.options >= 0, '枠の前に ${GetOptions} $R0 "/KEEP_APP_DATA" $R1 がある');
  assert.equal(UNINSTALL[guard.options - 1].line, 'ClearErrors', 'GetOptions の前に ClearErrors');
  assert.deepEqual(guard.elses, []);
  const assocDeletes = UNINSTALL.map(({ line }, index) => ({ line, index })).filter(({ line }) => isAssocDelete(line));
  assert.ok(assocDeletes.length > 0);
  for (const { line, index } of assocDeletes)
    assert.ok(guard.inside(index), `上書きでも消してしまう: ${line}`);
  UNINSTALL.forEach(({ line, via }, index) => {
    if (via.includes('sigkRemoveMenus'))
      assert.ok(!guard.inside(index), `メニューは毎回消す: ${line}`);
  });
});

test('消す値（DeleteRegValue）は、自分が書いたキーと値の名前の組だけ', () => {
  const deletes = valueDeletesOf(UNINSTALL);
  assert.ok(deletes.length > 0);
  for (const { key, name } of deletes)
    assert.ok(WRITES.some((write) => write.key === key && write.name === name), `書いていない値を消す: ${key} [${name}]`);
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
  // 句点と読点のあとで改行し、行末に「「」をぶら下げない（spec-5-3 確かめ No.24・docs/07 決定75 ④。本物の画面で 7 行に収まることを見た）。
  assert.ok(text.includes('使えます。$\\r$\\nWindows 11 では「その他のオプションを確認」の中にあります。'));
  assert.ok(text.includes('アプリにするには、$\\r$\\nメニュー「ヘルプ」'));
  // 改行を自分で入れたので、行が増えると欄（7.5 行分）の下が切れる。空行を含めて 7 行に保つ。
  assert.equal(text.split('$\\r$\\n').length, 7, '行は空行を含めて 7（MUI_FINISHPAGE_TEXT_LARGE の欄は 7.5 行分）');
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
