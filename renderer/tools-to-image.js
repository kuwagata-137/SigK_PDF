(function (root) {
  'use strict';

  // PDF→画像の画面の状態と指揮（spec-3-3 確定事項1〜22）。
  //
  // 対象は1ファイル（ユーザー確定 c）。ページ・形式・解像度と出力フォルダを持ち、
  // 計画（image-export-plan.js）を組み、同名を確かめてから 1 ページずつ描いて書く。
  // 描画は pdf.js（page-image.js）でレンダラーが行い、書くのはメイン（imageAPI.write）。
  // ほかのツールと向きが逆になる理由は worker/op-convert.js の頭にある。
  // 描画は tools-to-image-view.js。
  //
  // ファイルを読み直して描くので、画面上の並べ替え・回転・削除は結果に映らない
  // （確定事項1・13）。未保存のタブを対象にすることは止めず、注意だけ出す。

  const NOTE_UNSAVED = '未保存の編集は反映されません';
  const NOTE_FIRST_ONLY = '1つ目のファイルだけを対象にしました。';
  const PICK_TITLE = '画像にする PDF を選ぶ';
  // 帯の文言「画像にしています」「画像にするのを中止しました」の頭（確定事項17・20）。
  const LABEL = '画像に';

  const state = {
    source: null,          // { path, name, pageCount, sizes, blocked, note, pending }
    mode: 'all', range: '',
    format: 'png', dpi: 150,
    folder: null, folderTouched: false,
    running: false,
  };
  let el = null;

  const banner = () => root.SigK.viewBanner;
  const tabs = () => root.SigK.tabs;
  const view = () => root.SigK.toolsToImageView;
  const planner = () => root.SigK.imageExportPlan;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  function pathKey(filePath) {
    return typeof filePath === 'string' ? filePath.replace(/\//g, '\\').toLowerCase() : null;
  }

  function dirOf(filePath) {
    const at = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    return at < 0 ? '' : filePath.slice(0, at);
  }

  // フォルダーの区切りに合わせてつなぐ（分割と同じ）。
  function joinPath(folder, name) {
    const sep = folder.includes('/') && !folder.includes('\\') ? '/' : '\\';
    return folder.endsWith(sep) ? `${folder}${name}` : `${folder}${sep}${name}`;
  }

  const source = () => (state.source === null ? null : { ...state.source, sizes: state.source.sizes === null ? null : [...state.source.sizes] });
  const settings = () => ({ mode: state.mode, range: state.range, format: state.format, dpi: state.dpi, folder: state.folder });

  // ---- 対象（確定事項1〜5） ----

  async function setSource(filePath, { dirty = false } = {}) {
    if (typeof filePath !== 'string' || filePath === '')
      return false;
    const next = { path: filePath, name: baseName(filePath), pageCount: null, sizes: null, blocked: null, note: dirty ? NOTE_UNSAVED : null, pending: true };
    state.source = next;
    if (!state.folderTouched)
      state.folder = dirOf(filePath);
    view()?.render();

    const info = await root.SigK.toolSource.inspectPdfPages(filePath);
    if (state.source !== next)
      return false;   // 読んでいる間に差し替えられた
    next.pending = false;
    if (info.reason !== undefined)
      next.blocked = `${info.error}。選び直してください`;
    else {
      next.pageCount = info.pageCount;
      next.sizes = info.sizes;
      next.name = info.name;
    }
    view()?.render();
    return true;
  }

  async function useOpenTab() {
    const open = tabs()?.list() ?? [];
    const active = open.find((tab) => tab.active) ?? open[0];
    if (active === undefined || typeof active.path !== 'string') {
      banner().show('開いているファイルがありません。');
      return false;
    }
    const dirty = tabs().isDirty(active.id) === true;
    const ok = await setSource(active.path, { dirty });
    if (dirty)
      banner().show('未保存の編集は画像に反映されません。保存してから画像にし直してください。');
    return ok;
  }

  async function pickFile() {
    const api = root.pdfAPI;
    if (api?.available !== true || typeof api.pickToolSource !== 'function')
      return false;
    const picked = await api.pickToolSource({ defaultPath: state.source?.path, title: PICK_TITLE });
    if (picked?.canceled === true || typeof picked?.path !== 'string')
      return false;
    return setSource(picked.path);
  }

  // ドロップの受け口。対象は1つなので先頭だけ使う（確定事項1）。
  async function addPaths(paths) {
    const incoming = (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
    if (incoming.length === 0)
      return false;
    const ok = await setSource(incoming[0]);
    if (incoming.length > 1)
      banner().show(NOTE_FIRST_ONLY);
    return ok;
  }

  // ---- ページ・形式・出力（確定事項6〜11・15） ----

  function setPageMode(mode) {
    if (mode !== 'all' && mode !== 'range')
      return false;
    state.mode = mode;
    view()?.sync();
    return true;
  }

  function setRange(text) {
    state.range = String(text ?? '');
    view()?.sync();
    return true;
  }

  function setFormat(format) {
    if (!Object.prototype.hasOwnProperty.call(planner().FORMATS, format))
      return false;
    state.format = format;
    view()?.sync();
    return true;
  }

  function setDpi(dpi) {
    const value = Number(dpi);
    if (!planner().DPI_CHOICES.includes(value))
      return false;
    state.dpi = value;
    view()?.sync();
    return true;
  }

  // ユーザーが変えたあとは対象に追従しない（確定事項15）。
  function setFolder(folder) {
    if (typeof folder !== 'string' || folder === '')
      return false;
    state.folder = folder;
    state.folderTouched = true;
    view()?.sync();
    return true;
  }

  async function pickFolder() {
    const api = root.pdfAPI;
    if (typeof api?.pickFolder !== 'function')
      return false;
    const picked = await api.pickFolder({ defaultPath: state.folder ?? undefined });
    if (picked?.canceled === true || typeof picked?.path !== 'string')
      return false;
    return setFolder(picked.path);
  }

  // いまの設定から計画を組む。対象が決まっていなければ ready: false（error は null）、
  // 入力に誤りがあれば ready: false と error、組めれば pages・names・targets。
  function currentPlan() {
    const planned = planner().planExport(settings(), state.source);
    if (!planned.ready)
      return planned;
    const folder = state.folder ?? dirOf(state.source.path);
    return { ...planned, folder, targets: planned.names.map((name) => joinPath(folder, name)) };
  }

  function canRun() {
    return !state.running && root.SigK.save?.isBusy() !== true && currentPlan().ready === true;
  }

  // ---- 同名確認（確定事項16） ----

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

  // 戻り値は { targets } / { canceled }。3択は1回だけ出し、「別名で保存」は
  // フォルダーを選び直してもう一度確かめる（分割と同じ）。
  async function resolveTargets(targets) {
    const found = await countExisting(targets);
    if (found.length === 0)
      return { targets };
    const confirm = root.SigK.confirmReplace;
    const answer = await confirm.ask({ name: baseName(found[0]), count: found.length });
    if (answer === confirm.REPLACE)
      return { targets };
    if (answer !== confirm.RENAME)
      return { canceled: true };
    if (!(await pickFolder()))
      return { canceled: true };
    const next = currentPlan();
    return next.ready ? resolveTargets(next.targets) : { canceled: true };
  }

  // ---- 実行（確定事項17〜24） ----

  // 文書を読み直して開く（確定事項22）。映しているタブの文書は使わない。
  async function openDocument(filePath) {
    const read = await root.pdfAPI.read(filePath);
    if (read?.error !== undefined)
      return { error: read.error };
    const task = root.SigK.pdfjs.getDocument({ data: read.bytes });
    task.onPassword = (update) => update(new Error('パスワード付きの PDF は扱えません'));
    try {
      return { task, doc: await task.promise };
    } catch {
      await task.destroy?.();
      return { error: 'この PDF を開けません' };
    }
  }

  // 1 ページずつ描いて書く。中止の旗は次のページの前で見る（確定事項20）。
  async function exportPages({ plan, targets, src, frame }) {
    const opened = await openDocument(src.path);
    if (opened.error !== undefined)
      return { error: `「${src.name}」${opened.error}。`, written: 0 };

    const images = root.SigK.pageImage;
    const total = plan.pages.length;
    let written = 0;
    let current = null;
    try {
      for (let index = 0; index < total; index += 1) {
        if (frame.canceled())
          return { canceled: true, written };
        frame.report(index, total);
        current = plan.pages[index] + 1;
        const page = await opened.doc.getPage(current);
        // jsdom には 2D コンテキストが無く bytes は null で返る。経路の検証のためそのまま渡す。
        const { bytes } = await images.exportPage(el.doc, page, { scale: plan.scale, type: plan.format.type, quality: plan.format.quality });
        const result = await root.imageAPI.write(targets[index], bytes);
        if (result?.ok !== true)
          return { error: `「${plan.names[index]}」を書き込めませんでした。${result?.error ?? ''}`.trim(), written };
        written += 1;
      }
      frame.report(total, total);
      return { ok: true, written };
    } catch (error) {
      root.SigK.log?.report({
        level: 'error',
        message: error?.message ?? String(error),
        stack: error?.stack,
        context: { source: 'to-image', page: current },
      });
      return { error: `「${src.name}」の ${current} ページ目を画像にできませんでした。`, written };
    } finally {
      // 中止・失敗でも畳む（確定事項22）。
      await opened.task.destroy?.();
    }
  }

  async function run() {
    if (!canRun())
      return { error: '画像にできる状態ではありません。' };
    const current = currentPlan();
    const src = state.source;
    if (current.targets.some((target) => pathKey(target) === pathKey(src.path))) {
      banner().show('出力先に元のファイルと同じファイルは選べません。');
      return { error: '出力先に元のファイルと同じファイルは選べません。' };
    }
    const api = root.imageAPI;
    if (api?.available !== true || typeof api.write !== 'function') {
      banner().show('画像を書き出す機能を使えません。');
      return { error: '画像を書き出す機能を使えません。' };
    }

    const resolved = await resolveTargets(current.targets);
    if (resolved.canceled === true)
      return { canceled: true };
    const targets = resolved.targets;

    state.running = true;
    view()?.render();
    let result;
    try {
      result = await root.SigK.save.runLocal({
        label: LABEL,
        run: (frame) => exportPages({ plan: current, targets, src, frame }),
      });
    } finally {
      state.running = false;
      view()?.render();
    }
    return finish(result, targets);
  }

  function finish(result, targets) {
    if (result?.canceled === true) {
      const written = result.written ?? 0;
      banner().show(written > 0 ? `画像にするのを中止しました。${written} ファイルは書き出し済みです。` : '画像にするのを中止しました。');
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '画像にできませんでした。');
      return result ?? { error: '画像にできませんでした。' };
    }
    banner().show(`${result.written} ファイルに変換しました`, {
      autoHideMs: 0,
      tone: 'info',
      action: { label: 'フォルダを開く', onClick: () => root.shellAPI?.showInFolder?.(targets[0]) },
    });
    return result;
  }

  function init(doc, win) {
    if (win.__sigkToolsToImageReady === true)
      return false;
    if (doc.getElementById('toimage-run') === null)
      return false;
    win.__sigkToolsToImageReady = true;
    el = { doc, win };
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsToImage = {
    NOTE_UNSAVED, NOTE_FIRST_ONLY, PICK_TITLE, LABEL,
    init, source, settings, currentPlan, joinPath,
    setSource, useOpenTab, pickFile, addPaths,
    setPageMode, setRange, setFormat, setDpi, setFolder, pickFolder,
    canRun, resolveTargets, run,
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
