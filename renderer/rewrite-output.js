(function (root) {
  'use strict';

  // 1 本の PDF から別の 1 本を書き出すツール（透かし・フラット化）の出力先の決め方と、書いたあとの
  // 後始末（spec-4-5 確定事項40〜44。論点8）。ワーカー側の worker/rewrite-task.js に対応する。
  //
  // 出力先は結合（tools-merge.js）と同じく実行時に OS の保存ダイアログで決め、同名の確認は OS に
  // 任せる。書けたら新しいタブで開く。モードは変えない（tool-output.js。決定80）。

  const banner = () => root.SigK.viewBanner;
  const tabs = () => root.SigK.tabs;

  function pathKey(filePath) {
    return typeof filePath === 'string' ? filePath.replace(/\//g, '\\').toLowerCase() : null;
  }

  // 断る出力先（確定事項41・42）。入力そのものと、タブで開いているファイル。後者は、
  // tabs.js の openPath が同じパスのタブを読み直さずに切り替えるだけで、古い内容のタブが残り、
  // そのタブを上書き保存すると書き出した結果を消してしまうため。
  function refusalFor(target, sourcePath) {
    if (pathKey(target) === pathKey(sourcePath))
      return '出力先に入力ファイルと同じファイルは選べません。';
    if ((tabs()?.list() ?? []).some((tab) => pathKey(tab.path) === pathKey(target)))
      return '出力先のファイルはタブで開いているので、タブを閉じるか、別の名前を選んでください。';
    return null;
  }

  // 保存ダイアログで出力先を決める。戻り値は { target } / { canceled } / { error }（断った理由は通知バーにも出す）。
  async function chooseTarget({ sourcePath, defaultPath, title }) {
    const api = root.pdfAPI;
    if (typeof api?.pickSavePath !== 'function')
      return { error: '保存先を選べません。' };
    const picked = await api.pickSavePath({ defaultPath, title });
    if (picked?.canceled === true)
      return { canceled: true };
    if (typeof picked?.path !== 'string')
      return { error: picked?.error ?? '保存先を決められませんでした。' };
    const refused = refusalFor(picked.path, sourcePath);
    if (refused !== null) {
      banner().show(refused);
      return { error: refused };
    }
    return { target: picked.path };
  }

  // 書いたあとの後始末。messages は { canceled, failed, done }（通知バーの文言）。
  async function finish(result, target, { canceled, failed, done }) {
    if (result?.canceled === true) {
      // 自分で止めたので赤く塗らない（決定49）。
      banner().show(canceled, { tone: 'info' });
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? failed);
      return result ?? { error: failed };
    }
    // ここから先は書けている。タブで開き、モードは変えない（タブが上限なら「最近使ったファイル」へ）。
    await root.SigK.toolOutput.openWritten(target, { done, crowded: `${done}が、タブが多すぎるため開いていません。` });
    return result;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.rewriteOutput = { refusalFor, chooseTarget, finish };
})(typeof window !== 'undefined' ? window : globalThis);
