(function (root) {
  'use strict';

  // 書き出す先の検査（docs/07 決定42。spec-1-6 確定事項96・97、spec-2-1 確定事項45、
  // spec-2-2 確定事項42、spec-3-1 確定事項38）。
  //
  // 書き出す先のファイルがタブで開いていたら、何も書かずに断る。tabs.js の openPath は同じパスの
  // タブを読み直さずに切り替えるだけなので、書いても古い内容のタブが残る。そのタブから保存すると、
  // ワーカーは書き換わったファイルを読み直して古い並びと注釈を当てるので、書き出した結果が壊れる。
  // 透かし・フラット化（spec-4-5 確定事項42）も同じ規則で、文言も揃えてある。
  //
  // どの関数も、断るなら帯に出す文言を、通すなら null を返す。帯に出すのは呼ぶ側である。

  const OPEN_IN_TAB = '出力先のファイルはタブで開いています。タブを閉じるか、別の名前を選んでください。';
  const SAME_AS_SOURCE = '出力先に元のファイルと同じファイルは選べません。';
  const SAVE_AS_OPEN_IN_TAB = '保存先のファイルは別のタブで開いています。そのタブを閉じるか、別の名前を選んでください。';

  function pathKey(filePath) {
    return typeof filePath === 'string' ? filePath.replace(/\//g, '\\').toLowerCase() : null;
  }

  function baseName(filePath) {
    return String(filePath ?? '').split(/[\\/]/).pop();
  }

  function openTab(target) {
    return root.SigK.tabs?.findByPath(target) ?? null;
  }

  // 保存ダイアログで 1 本を選ぶ経路（結合・画像→PDF のまとめる・抽出）。source を渡すと、元の
  // ファイルそのものも断る（抽出。結合と変換は、入力と同じ出力先を呼ぶ前に自分で断っている）。
  function refusalFor(target, { source = null } = {}) {
    if (source !== null && pathKey(target) === pathKey(source))
      return SAME_AS_SOURCE;
    return openTab(target) === null ? null : OPEN_IN_TAB;
  }

  // フォルダーへ何本も書く経路（分割・画像→PDF の画像ごと）。同名の 3 択より前に呼ぶ。
  // 名前は規則で決まるので、変えてもらうのはフォルダーである。開いている最初の 1 本を名指しする。
  function refusalForFolder(targets) {
    const open = (targets ?? []).find((target) => openTab(target) !== null);
    if (open === undefined)
      return null;
    return `出力先の「${baseName(open)}」はタブで開いています。タブを閉じるか、フォルダを変えてください。`;
  }

  // 名前を付けて保存。保存すると映しているタブがその保存先へ移る（spec-1-6 確定事項26）ので、
  // 別のタブで開いているファイルを選ぶと同じパスのタブが 2 枚になる。映しているタブの
  // ファイルそのもの（自分自身への保存）は通す。
  function refusalForSaveAs(target) {
    const tab = openTab(target);
    return tab === null || tab.active ? null : SAVE_AS_OPEN_IN_TAB;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.outputTarget = { OPEN_IN_TAB, SAME_AS_SOURCE, SAVE_AS_OPEN_IN_TAB, refusalFor, refusalForFolder, refusalForSaveAs };
})(typeof window !== 'undefined' ? window : globalThis);
