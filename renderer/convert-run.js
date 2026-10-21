(function (root) {
  'use strict';

  // 画像→PDF の実行（spec-3-1 確定事項19・20・22〜27）。tools-convert.js の run から呼ぶ（分割の split-run.js と同じ分け方）。
  //
  // 「1 つにまとめる」は保存先を OS の保存ダイアログが決め、同名の確認もダイアログに任せる（結合と同じ）。「画像ごと」は出力先を
  // 画像の並びから組み、同名は 3 択で 1 回だけ確かめる。書くのはワーカー（save.js の runTask）。書けたあとの始末は convert-result.js。

  const SAME_AS_INPUT = '出力先に入力ファイルと同じファイルは選べません。';

  const banner = () => root.SigK.viewBanner;
  const convert = () => root.SigK.toolsConvert;
  const plan = () => root.SigK.convertPlan;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);
  const pathKey = (filePath) => (typeof filePath === 'string' ? filePath.replace(/\//g, '\\').toLowerCase() : null);
  const isInput = (target) => convert().rows().some((row) => pathKey(row.path) === pathKey(target));

  function refuse(message) {
    banner().show(message);
    return { error: message };
  }

  // ワーカーへ渡す画像の並び（確定事項22・spec-3-2 確定事項20）。layouts は計画がそのまま持っている（1 ファイルにページ数ぶん）。
  function imagesFor(current, targets) {
    return convert().rows().map((row, index) => ({
      path: row.path,
      name: row.name,
      layouts: current.pages[index],
      ...(targets === undefined ? {} : { target: targets[index] }),
    }));
  }

  function defaultSingleTarget() {
    const rows = convert().rows();
    if (rows.length === 0)
      return undefined;
    return convert().joinPath(convert().dirOf(rows[0].path), plan().defaultSingleName(rows));
  }

  async function countExisting(targets) {
    const api = root.pdfAPI;
    if (typeof api?.exists !== 'function')
      return [];
    const found = [];
    for (const target of targets) {
      const answer = await api.exists(target);
      if (answer?.exists === true)
        found.push(target);
    }
    return found;
  }

  // 3 択は 1 回だけ出し、「別名で保存」はフォルダを選び直してもう一度確かめる。タブで開いている出力先は 3 択より前に断る
  // （確定事項38）。戻り値は { targets } / { canceled } / { error }（分割の resolveTargets と同じ）。
  async function resolveTargets(targets) {
    const refused = root.SigK.outputTarget.refusalForFolder(targets);
    if (refused !== null)
      return { error: refused };
    const found = await countExisting(targets);
    if (found.length === 0)
      return { targets };
    const confirm = root.SigK.confirmReplace;
    const answer = await confirm.ask({ name: baseName(found[0]), count: found.length });
    if (answer === confirm.REPLACE)
      return { targets };
    if (answer !== confirm.RENAME)
      return { canceled: true };
    if (!(await convert().pickFolder()))
      return { canceled: true };
    const next = convert().currentPlan();
    return next.ready ? resolveTargets(next.targets) : { canceled: true };
  }

  function runTask(spec) {
    return root.SigK.save.runTask({ kind: 'convert', label: '変換', ...spec });
  }

  async function runSingle() {
    // 最初の場所のフォルダは、設定の窓の「ファイルを書き出すときの、最初のフォルダ」に従う（spec-6-1 確定事項E-5。点検の直し I-2）。
    const defaultPath = defaultSingleTarget();
    const picked = await root.pdfAPI.pickSavePath({ defaultPath: await root.SigK.preferences?.resolvePath(defaultPath) ?? defaultPath, title: '変換した PDF を保存' });
    if (picked?.canceled === true)
      return { canceled: true };
    if (typeof picked?.path !== 'string')
      return { error: picked?.error ?? '保存先を決められませんでした。' };
    const target = picked.path;
    if (isInput(target))
      return refuse(SAME_AS_INPUT);
    // タブで開いているファイルへは書かない（確定事項38。結合と同じ）。
    const refused = root.SigK.outputTarget.refusalFor(target);
    if (refused !== null)
      return refuse(refused);
    const result = await runTask({ output: 'single', images: imagesFor(convert().currentPlan()), target, targets: [target] });
    return root.SigK.convertResult.finish(result, [target]);
  }

  async function runEach() {
    const current = convert().currentPlan();
    if (current.targets.some(isInput))
      return refuse(SAME_AS_INPUT);
    const resolved = await resolveTargets(current.targets);
    if (resolved.canceled === true)
      return { canceled: true };
    if (resolved.error !== undefined)
      return refuse(resolved.error);
    const { targets } = resolved;
    const result = await runTask({ output: 'each', images: imagesFor(convert().currentPlan(), targets), targets });
    return root.SigK.convertResult.finish(result, targets, { each: true });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.convertRun = { runSingle, runEach, resolveTargets, defaultSingleTarget };
})(typeof window !== 'undefined' ? window : globalThis);
