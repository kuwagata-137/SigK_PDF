(function (root) {
  'use strict';

  // 透かしの画面の状態と指揮（spec-4-5 確定事項2〜6・11・34〜44）。
  //
  // 対象（source-picker.js）・透かしの画像・設定を持ち、計画（watermark-plan.js）を組んで、実行時に
  // 保存ダイアログで出力先を決め（rewrite-output.js）、ワーカー（kind: watermark）へ渡す。描画は
  // tools-watermark-view.js（欄）と watermark-preview.js（右のプレビュー）。ファイルを読み直して書くので
  // 未保存の編集は反映されない。設定は覚えない（論点6。アプリを閉じるまでは画面の値が残る）。

  const PICK_TITLE = '透かしを入れる PDF を選ぶ';
  const SAVE_TITLE = '透かしを入れた PDF を保存';
  const NOTE_FIRST_IMAGE = '1つ目の画像だけを使いました。';

  const planner = () => root.SigK.watermarkPlan;
  const banner = () => root.SigK.viewBanner;
  const view = () => root.SigK.toolsWatermarkView;
  const preview = () => root.SigK.watermarkPreview;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  const state = {
    settings: { ...root.SigK.watermarkPlan.DEFAULTS },
    // { path, name, kind, width, height, bytes, pending, error }
    image: null,
    running: false,
  };

  function changed() {
    view()?.sync();
    preview()?.update();
  }

  // ---- 対象（確定事項2・34・38） ----

  const field = root.SigK.sourcePicker.create({
    inspect: (filePath) => root.SigK.toolSource.inspectPdf(filePath),
    pick: ({ defaultPath }) => {
      const api = root.pdfAPI;
      if (api?.available !== true || typeof api.pickToolSource !== 'function')
        return null;
      return api.pickToolSource({ defaultPath, title: PICK_TITLE });
    },
    dirtyMessage: '未保存の編集は透かしに反映されません。保存してから透かしを入れ直してください。',
    onChange: () => {
      view()?.render();
      preview()?.setSource(field.source());
    },
  });

  const source = () => field.source();
  const { setSource, useOpenTab, pickFile } = field;

  // ---- 透かしの画像（確定事項35〜37。論点7） ----

  const image = () => (state.image === null ? null : { ...state.image });

  async function setImage(filePath) {
    if (typeof filePath !== 'string' || filePath === '')
      return false;
    const next = { path: filePath, name: baseName(filePath), kind: null, width: null, height: null, bytes: null, pending: true, error: null };
    state.image = next;
    state.settings.type = 'image';
    changed();
    const api = root.pdfAPI;
    const read = typeof api?.readWatermarkImage === 'function'
      ? await api.readWatermarkImage(filePath)
      : { error: '画像を読む機能を使えません。' };
    if (state.image !== next)
      return false;   // 読んでいる間に差し替えられた
    next.pending = false;
    if (read?.ok === true)
      Object.assign(next, { name: read.name ?? next.name, kind: read.kind, width: read.width, height: read.height, bytes: read.bytes });
    else
      next.error = read?.error ?? '画像を読めませんでした。';
    changed();
    return next.error === null;
  }

  async function pickImage() {
    const api = root.pdfAPI;
    if (typeof api?.pickWatermarkImage !== 'function')
      return false;
    const picked = await api.pickWatermarkImage({ defaultPath: state.image?.path });
    if (picked?.canceled === true || typeof picked?.path !== 'string')
      return false;
    return setImage(picked.path);
  }

  // ドロップの受け口（確定事項37）。PDF の先頭を対象に、PNG・JPEG の先頭を透かしの画像にする。
  async function addPaths(paths) {
    const incoming = (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
    const pdfs = incoming.filter((filePath) => /\.pdf$/i.test(filePath));
    const images = incoming.filter((filePath) => /\.(png|jpe?g)$/i.test(filePath));
    let ok = false;
    if (pdfs.length > 0)
      ok = (await field.addPaths(pdfs)) || ok;
    if (images.length > 0) {
      ok = (await setImage(images[0])) || ok;
      if (images.length > 1)
        banner().show(NOTE_FIRST_IMAGE, { tone: 'warn' });   // 注意・お知らせは黄色（決定49）
    }
    return ok;
  }

  // ---- 設定（確定事項3・4） ----

  const settings = () => ({ ...state.settings });

  function setSetting(key, value, isValid) {
    if (!isValid(value))
      return false;
    state.settings[key] = value;
    changed();
    return true;
  }

  const setType = (type) => setSetting('type', type, (value) => value === 'text' || value === 'image');
  const setText = (text) => setSetting('text', String(text ?? ''), () => true);
  const setSize = (size) => setSetting('size', size, (value) => Object.hasOwn(root.SigK.watermarkGeometry.SIZE_RATIOS, value));
  const setColor = (color) => setSetting('color', color, (value) => planner().COLORS.includes(value));
  const setOpacity = (opacity) => setSetting('opacity', Number(opacity), (value) => planner().OPACITIES.includes(value));
  const setAngle = (angle) => setSetting('angle', Number(angle), (value) => Object.values(root.SigK.watermarkGeometry.ANGLES).includes(value));
  const setPosition = (position) => setSetting('position', position, (value) => root.SigK.watermarkGeometry.POSITIONS.includes(value));
  const setPageMode = (mode) => setSetting('pageMode', mode, (value) => value === 'all' || value === 'range');
  const setRange = (text) => setSetting('range', String(text ?? ''), () => true);

  // ---- 実行（確定事項6・11・40〜44） ----

  function currentPlan() {
    return planner().planOf({ source: source(), image: state.image, settings: state.settings });
  }

  function canRun() {
    return !state.running && root.SigK.save?.isBusy() !== true && currentPlan().ready === true;
  }

  // 保存ダイアログ・書いた後の始末まで実行中と数える（spec-5-1 確定事項12。結合と同じ）。
  async function run() {
    if (!canRun())
      return { error: '透かしを入れられる状態ではありません。' };
    state.running = true;
    view()?.render();
    try {
      return await runPlanned();
    } finally {
      state.running = false;
      view()?.render();
    }
  }

  async function runPlanned() {
    const planned = currentPlan();
    const src = source();
    const chosen = await root.SigK.rewriteOutput.chooseTarget({ sourcePath: src.path, defaultPath: planner().defaultTarget(src.path), title: SAVE_TITLE });
    if (chosen.target === undefined)
      return chosen;

    const result = await root.SigK.save.runTask({ ...planned.spec, target: chosen.target });
    return root.SigK.rewriteOutput.finish(result, chosen.target, {
      canceled: '透かしの追加を中止しました。',
      failed: '透かしを入れられませんでした。',
      done: `${planned.pages.length} ページに透かしを入れました`,
    });
  }

  function init(doc, win) {
    if (win.__sigkToolsWatermarkReady === true)
      return false;
    if (doc.getElementById('wm-run') === null)
      return false;
    win.__sigkToolsWatermarkReady = true;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsWatermark = {
    PICK_TITLE, SAVE_TITLE, NOTE_FIRST_IMAGE,
    init, source, image, settings, currentPlan, canRun,
    setSource, useOpenTab, pickFile, addPaths, setImage, pickImage,
    setType, setText, setSize, setColor, setOpacity, setAngle, setPosition, setPageMode, setRange,
    run,
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
