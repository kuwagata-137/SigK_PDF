(function (root) {
  'use strict';

  // 印刷画面のプリンターの一覧・既定のプリンター・プリンターごとの設定の取得と、［プロパティ(P)］（docs/spec-7-7-print-dialog.md
  // 確定事項C3・質問 PR1 案A）。取得はメイン側（printer-config.js）。取得している間は［印刷］を押せない（print-dialog.js）。

  // printAPI.printerConfig が無い時（試験・古い preload）の初期値。メイン側の取得結果と同じ形（printer-xml.js の fallbackConfig）。
  const A4 = Object.freeze({ id: 'psk:ISOA4', name: 'A4', width: 210000, height: 297000 });
  const FALLBACK = Object.freeze({
    ok: false, source: 'fallback', paper: A4, imageable: { x: 4230, y: 4230, width: 201540, height: 288540 },
    duplex: { supported: true, mode: 'simplex' }, color: { supported: true, value: true }, collate: true, paperSizes: [A4],
  });

  const ctx = { token: 0, ready: Promise.resolve(), hooks: {} };

  const D = () => root.SigK.printDialog;
  const S = () => root.SigK.printSettings;
  const api = () => root.printAPI;

  async function loadConfig(name) {
    const mine = (ctx.token += 1);
    D().setConfig(null);
    ctx.hooks.onLoading?.();
    let config = null;
    if (name !== null && typeof api()?.printerConfig === 'function')
      config = await Promise.resolve(api().printerConfig(name)).catch(() => null);
    if (mine !== ctx.token)
      return;
    D().setConfig(config?.paper ? config : FALLBACK);
    ctx.hooks.onLoaded?.();
  }

  // 一覧を取得し、覚えているプリンターか、無ければ Windows の既定のプリンターを選ぶ。
  async function loadAll() {
    const mine = (ctx.token += 1);
    if (typeof api()?.listPrinters !== 'function') {
      D().setPrinters([]);
      D().setConfig(FALLBACK);
      ctx.hooks.onLoaded?.();
      return;
    }
    D().setConfig(null);
    const listed = await Promise.resolve(api().listPrinters()).catch(() => null);
    if (mine !== ctx.token)
      return;
    const printers = listed?.printers ?? [];
    D().setPrinters(printers);
    const state = D().getState();
    const keep = printers.some((printer) => printer.name === state.printer);
    const name = keep ? state.printer : (printers.find((printer) => printer.name === listed?.defaultName) ?? printers[0])?.name ?? null;
    if (!keep)
      D().setState(S().forPrinter(state, name));
    await loadConfig(name);
  }

  function load() {
    ctx.ready = loadAll();
    return ctx.ready;
  }

  function select(name) {
    D().setState(S().forPrinter(D().getState(), name));
    ctx.ready = loadConfig(name);
    return ctx.ready;
  }

  // ［プロパティ(P)］: 印刷設定の画面を開き、閉じたら取得し直した既定の値に合わせる。
  async function openProperties() {
    const name = D().getState()?.printer;
    if (!name || typeof api()?.openPreferences !== 'function')
      return;
    D().setBusy(true);
    const result = await Promise.resolve(api().openPreferences(name)).catch(() => null);
    D().setBusy(false);
    if (result?.ok !== true || !result.config?.paper || D().getState().printer !== name)
      return;
    D().setState(S().forPrinter(D().getState(), name));
    D().setConfig(result.config);
    ctx.hooks.onLoaded?.();
  }

  function init(hooks) {
    ctx.hooks = hooks ?? {};
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printPrinters = { FALLBACK, init, load, select, openProperties, whenReady: () => ctx.ready };
})(typeof window !== 'undefined' ? window : globalThis);
