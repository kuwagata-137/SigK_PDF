(function (root) {
  'use strict';

  // 結合の状態と指揮（spec-2-1 確定事項21〜28・35〜40、spec-2-5 確定事項E2・E7）。
  //
  // 結合する PDF は帯（＝タブ）で、順番はタブの並び（帯の ↑↓ で変える）。ここはタブごとのチェックと範囲（merge-picks.js）を持ち、
  // 行はそのつどタブから組む。ページ数はファイルの中身（basePages）で、ワーカーはこれまでどおりファイルを読み直して組む
  // （保存していない変更は結果に入らない。実行の前に確かめる〔確定事項F〕）。描画は tools-merge-list.js。

  // 起動からの結合の注記（確定事項E7）。
  const NOTE_NAME_ORDER = 'ファイル名の順に並べたので、エクスプローラーの並びと違うときは、帯の ↑↓ で入れ替えてください。';

  const state = { running: false, launchTabs: [], note: false };
  const picks = root.SigK.mergePicks.create();
  let el = null;
  let launchBatch = null;

  const banner = () => root.SigK.viewBanner;
  const tabs = () => root.SigK.tabs;
  const view = () => root.SigK.toolsMergeList;
  const intake = () => root.SigK.launchIntake;
  const batches = () => (launchBatch ??= intake().createBatchTracker());

  function pathKey(filePath) {
    return typeof filePath === 'string' ? filePath.replace(/\//g, '\\').toLowerCase() : null;
  }

  function baseName(filePath) {
    return String(filePath ?? '').split(/[\\/]/).pop();
  }

  // 使えない帯の理由（行に赤で出し、チェックを入れられない）。
  function blockedOf(tab, peeked) {
    if (peeked === null || peeked.doc === undefined)
      return '開けなかったので、結合に使えません';
    if (typeof tab.path !== 'string')
      return '保存すると結合に使えます';
    if (peeked.file?.encrypted === true)
      return 'パスワード付きなので、結合に使えません';
    return null;
  }

  function rowOf(tab, index) {
    const peeked = tabs().peek(tab.id);
    const blocked = blockedOf(tab, peeked);
    const pageCount = blocked === null ? peeked.basePages.length : null;
    const range = picks.rangeOf(tab.id);
    const checked = blocked === null && picks.isChecked(tab.id);
    let pages = null;
    let error = null;
    if (checked && range.trim() !== '') {
      const parsed = root.SigK.pageRange.parsePageRange(range, pageCount);
      if (parsed.error !== undefined)
        error = parsed.error;
      else
        pages = parsed.pages;
    }
    return { tabId: tab.id, no: index + 1, path: tab.path, name: tab.name, pageCount, checked, range, pages, error, blocked };
  }

  // 帯の順の行（チェックを外した帯・使えない帯も含む）。
  function rows() {
    const list = tabs().list();
    picks.sync(list.map((tab) => tab.id));
    return list.map(rowOf);
  }

  // 結合に入れる行（チェックを入れた、使える帯）。
  function inputs() {
    return rows().filter((row) => row.checked);
  }

  function setChecked(tabId, on) {
    picks.setChecked(tabId, on);
    view()?.render();
    return true;
  }

  function setRange(tabId, text) {
    picks.setRange(tabId, text);
    view()?.render();
    return true;
  }

  // ---- 起動からの結合（spec-5-1 確定事項9・16・18、spec-2-5 確定事項E7。決定80 ㉛） ----

  // 束の帯どうしを、束の帯がいる位置の中でファイル名の順に並べ替える。
  function sortBatch(ids) {
    const order = tabs().list().map((tab) => tab.id);
    const slots = order.map((id, index) => (ids.includes(id) ? index : -1)).filter((index) => index >= 0);
    const pathOf = (id) => tabs().list().find((tab) => tab.id === id)?.path;
    const sorted = slots.map((index) => order[index]).sort((a, b) => intake().compareNames(pathOf(a), pathOf(b)));
    slots.forEach((slot, at) => { order[slot] = sorted[at]; });
    tabs().reorder(order);
  }

  // 右クリックで N 個選ぶと 1 件ずつ届く。束の最初でツールモードの結合へ切り替え、前から開いていた帯のチェックを外す。
  // open（launch.js）で選んだ PDF をタブで開いてから、その帯にチェックを入れる。
  async function addFromLaunch(paths, { batch, open }) {
    const { starts } = batches().enter(batch);
    if (starts) {
      root.SigK.shell.setMode(el.doc, 'tools');
      root.SigK.tools.select('merge');
      picks.sync(tabs().list().map((tab) => tab.id));
      picks.uncheckAll();
      state.launchTabs = [];
      state.note = false;
    }
    const incoming = (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
    await open(incoming);
    for (const filePath of incoming) {
      const tab = tabs().findByPath(filePath);
      if (tab === null)
        continue;
      picks.setChecked(tab.id, true);
      if (!state.launchTabs.includes(tab.id))
        state.launchTabs.push(tab.id);
    }
    sortBatch(state.launchTabs);
    state.note = state.launchTabs.length >= 2;
    view()?.render();
    return state.launchTabs.length;
  }

  // ---- 実行（spec-2-1 確定事項21〜25・35〜38） ----

  function canRun() {
    const chosen = inputs();
    return !state.running && root.SigK.save?.isBusy() !== true && chosen.length > 0 && chosen.every((row) => row.error === null);
  }

  function outputPages(chosen = inputs()) {
    return chosen.reduce((sum, row) => sum + (row.pages?.length ?? row.pageCount ?? 0), 0);
  }

  function defaultTargetFor(filePath) {
    if (typeof filePath !== 'string' || filePath === '')
      return undefined;
    return `${filePath.replace(/\.pdf$/i, '')}_結合.pdf`;
  }

  // 出力先に同名があれば 3 択を出す（確定事項26〜28）。結合は OS の保存ダイアログが同名を確かめるので通らないが、分割が使う。
  // 戻り値は { path } / { canceled }。
  async function resolveTarget(target, { name = baseName(target) } = {}) {
    const api = root.pdfAPI;
    if (typeof api?.exists !== 'function')
      return { path: target };
    const found = await api.exists(target);
    if (found?.exists !== true)
      return { path: target };
    const answer = await root.SigK.confirmReplace.ask({ name });
    if (answer === root.SigK.confirmReplace.REPLACE)
      return { path: target };
    if (answer !== root.SigK.confirmReplace.RENAME)
      return { canceled: true };
    const picked = await api.pickSavePath({ defaultPath: target, title: '結合した PDF を保存' });
    if (picked?.canceled === true || typeof picked?.path !== 'string')
      return { canceled: true };
    return resolveTarget(picked.path);
  }

  // 保存ダイアログ・書いた後の始末まで実行中と数える（spec-5-1 確定事項12）。
  async function run() {
    if (!canRun())
      return { error: '結合できる状態ではありません。' };
    state.running = true;
    view()?.render();
    try {
      return await runChosen(inputs());
    } finally {
      state.running = false;
      view()?.render();
    }
  }

  async function runChosen(chosen) {
    const picked = await root.pdfAPI.pickSavePath({ defaultPath: defaultTargetFor(chosen[0].path), title: '結合した PDF を保存' });
    if (picked?.canceled === true)
      return { canceled: true };
    if (typeof picked?.path !== 'string')
      return { error: picked?.error ?? '保存先を決められませんでした。' };
    const target = picked.path;
    // 入力と同じファイル・タブで開いているファイルへは書かない（確定事項45）。帯はどれもタブなので、入力と同じ名前は後者でも断られる。
    const refused = chosen.some((row) => pathKey(row.path) === pathKey(target))
      ? '出力先に入力ファイルと同じファイルは選べません。'
      : root.SigK.outputTarget.refusalFor(target);
    if (refused !== null) {
      banner().show(refused);
      return { error: refused };
    }
    const result = await root.SigK.save.runTask({
      kind: 'merge',
      label: '結合',
      inputs: chosen.map((row) => ({ path: row.path, name: row.name, pages: row.pages })),
      target,
    });
    return finish(result, target, chosen.length);
  }

  async function finish(result, target, count) {
    if (result?.canceled === true) {
      banner().show('結合を中止しました。', { tone: 'info' });   // 自分で止めたので赤く塗らない（決定49）
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '結合できませんでした。');
      return result ?? { error: '結合できませんでした。' };
    }
    state.note = false;
    // 書けている。新しい帯としてタブで開き、モードは変えない（tool-output.js。決定80。新しい帯にも既定でチェックが入る）。
    await root.SigK.toolOutput.openWritten(target, {
      done: `${count} ファイルを結合しました（${result.pages} ページ）`,
      crowded: '結合しましたが、タブが多すぎるため開いていません。',
    });
    return result;
  }

  function init(doc, win) {
    if (win.__sigkToolsMergeReady === true)
      return false;
    win.__sigkToolsMergeReady = true;
    el = { doc, win };
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsMerge = {
    NOTE_NAME_ORDER,
    init, rows, inputs, setChecked, setRange, addFromLaunch,
    canRun, outputPages, defaultTargetFor, resolveTarget, run,
    isRunning: () => state.running,
    showsNote: () => state.note,
  };
})(typeof window !== 'undefined' ? window : globalThis);
