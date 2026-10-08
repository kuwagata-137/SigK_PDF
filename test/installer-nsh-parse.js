'use strict';

// build/installer.nsh を読んで、!insertmacro を展開した形で「何を書き、何を消すか」を取り出す部品。
// test/installer-nsh.test.js（右クリックメニュー。spec-5-1）と test/installer-assoc.test.js（関連付けと完了ページ。spec-5-2）が使う。
// NSIS はここでは走らせない（実機での登録・上書き・削除は、別名のインストーラーで確かめる。spec-5-1 事前調査 B・spec-5-2 事前調査 E）。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

// レジストリへ書く行は全部拾う（使ってよいのは WriteRegStr と WriteRegNone だけ。それはテストで見る）。
// WriteRegNone は値の中身を持たない（.pdf の OpenWithProgids の候補。spec-5-2 確定事項A2）。
const writesOf = (lines) => lines
  .filter(({ line }) => /^WriteReg\w+ /.test(line))
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
// 関連付けを消す行（マクロの名前ではなく、消している先で見る）。関連付けのキーそのものかその親を消す DeleteRegKey と、
// 関連付けの値を消す DeleteRegValue。
const isUnder = (key, top) => key === top || key.startsWith(`${top}\\`);
function isAssocDelete(line) {
  if (line.startsWith('DeleteRegKey ')) {
    const key = tokens(line)[2];
    return ASSOC_WRITES.some((write) => isUnder(write.key, key));
  }
  if (line.startsWith('DeleteRegValue ')) {
    const [, , key, name] = tokens(line);
    return ASSOC_WRITES.some((write) => write.key === key && write.name === name);
  }
  return false;
}
// customUnInstall のうち、上書きインストールでは走らない枠（/KEEP_APP_DATA も --updated も無いときだけ）。
// 枠の中には sigkPruneEmptyKey の ${If} … ${EndIf} が入れ子で入るので、深さを数えて閉じる位置を探す。
function updateGuarded(lines) {
  const open = lines.findIndex(({ line }, index) => line === '${If} ${Errors}' && lines[index + 1]?.line === '${AndIfNot} ${isUpdated}');
  let close = -1;
  let depth = 0;
  const elses = [];
  for (let index = open; open >= 0 && index < lines.length; index++) {
    const { line } = lines[index];
    if (/^\$\{If(Not)?\}/i.test(line))
      depth += 1;
    else if (/^\$\{EndIf\}/i.test(line))
      depth -= 1;
    else if (depth === 1 && /^\$\{Else(If)?\}/i.test(line))
      elses.push(line);
    if (depth === 0) {
      close = index;
      break;
    }
  }
  const options = open < 0 ? -1 : lines.findLastIndex(({ line }, index) => index < open && line === '${GetOptions} $R0 "/KEEP_APP_DATA" $R1');
  return { open, close, elses, options, inside: (index) => open >= 0 && index > open && index < close };
}
const ID = '${SIGK_SHELL_ID}';
const EXE = '"$INSTDIR\\${APP_EXECUTABLE_FILENAME}"';
const SFA = 'Software\\Classes\\SystemFileAssociations';
const valueOf = (key, name) => WRITES.find((write) => write.key === key && write.name === name)?.value;
const imageExtsOf = (lines) => lines
  .map(({ line }) => new RegExp(`^(?:WriteRegStr|DeleteRegKey) HKCU "${SFA.replace(/\\/g, '\\\\')}\\\\(\\.[a-z]+)\\\\shell\\\\\\$\\{SIGK_SHELL_ID\\}\\.ToPdf"`).exec(line)?.[1])
  .filter(Boolean);

module.exports = {
  TEXT, CODE_LINES, tokens, expand, INSTALL, UNINSTALL, writesOf, deletesOf, valueDeletesOf, WRITES, ASSOC_WRITES, MENU_WRITES, isUnder, isAssocDelete, updateGuarded, ID, EXE, SFA, valueOf, imageExtsOf,
};
