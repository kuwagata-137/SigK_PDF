(function (root) {
  'use strict';

  // 画像→PDF の用紙・出力の欄（spec-3-1 確定事項10〜14・18〜21・33）。
  //
  // 状態は tools-convert.js が持つ。ここはラジオと欄を状態へ合わせ、変えられたら
  // あちらの setter を呼ぶだけである（分割の tools-split-view.js と同じ役割）。
  // 一覧そのものは tools-convert-list.js が描く。
  //
  // 「画像サイズに合わせる」を選ぶと向きと余白は決まってしまうので、その2つの
  // ラジオを押せなくする（確定事項11・13）。値は据え置き、用紙を戻せばまた効く。

  const PAPERS = ['a4', 'a3', 'b5', 'letter', 'image'];
  const ORIENTATIONS = ['auto', 'portrait', 'landscape'];
  const MARGINS = ['none', 'narrow', 'normal'];
  const OUTPUTS = ['single', 'each'];

  let el = null;

  const convert = () => root.SigK.toolsConvert;

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function code(text) {
    const node = el.doc.createElement('code');
    node.textContent = text;
    return node;
  }

  // 出力の例（確定事項21）。まとめるなら `photo.pdf（12 ページ）`、
  // 画像ごとなら `a.pdf … l.pdf（12 ファイル）`。誤りがあれば例の代わりに文言。
  function renderExample(plan, settings) {
    el.example.replaceChildren();
    if (plan.ready !== true) {
      if (plan.error !== null) {
        const err = el.doc.createElement('span');
        err.className = 'err';
        err.textContent = plan.error;
        el.example.append(err);
      }
      return;
    }
    const count = el.doc.createElement('span');
    count.className = 'n';
    if (settings.output === 'single') {
      count.textContent = `（${plan.pages.length} ページ）`;
      el.example.append(code(root.SigK.convertPlan.defaultSingleName(convert().rows())), count);
      return;
    }
    const { names } = plan;
    count.textContent = `（${names.length} ファイル）`;
    if (names.length === 1)
      el.example.append(code(names[0]), count);
    else
      el.example.append(code(names[0]), ' … ', code(names[names.length - 1]), count);
  }

  // 用紙・向き・余白・方式のラジオを状態へ合わせる。実行中はすべて押せない（確定事項27）。
  function syncRadios(settings, running) {
    const byImage = settings.paper === 'image';
    for (const id of PAPERS) {
      el.papers[id].checked = settings.paper === id;
      el.papers[id].disabled = running;
    }
    for (const id of ORIENTATIONS) {
      el.orients[id].checked = settings.orientation === id;
      el.orients[id].disabled = running || byImage;
    }
    for (const id of MARGINS) {
      el.margins[id].checked = settings.margin === id;
      el.margins[id].disabled = running || byImage;
    }
    for (const id of OUTPUTS) {
      el.outputs[id].checked = settings.output === id;
      el.outputs[id].disabled = running;
    }
  }

  function sync() {
    if (el === null)
      return false;
    const settings = convert().settings();
    const plan = convert().currentPlan();
    const running = convert().isRunning();

    syncRadios(settings, running);
    el.fitNote.textContent = settings.paper === 'image'
      ? '画像の画素数をそのまま紙の大きさにします。余白は付きません。'
      : '画像は余白の内側に、縦横比を保って収まる大きさに合わせます。';

    // フォルダーの欄は「画像ごと」のときだけ出す（まとめるときの保存先は
    // OS の保存ダイアログが決めるため。確定事項19・20）。
    const each = settings.output === 'each';
    el.folderKey.hidden = !each;
    el.folderRow.hidden = !each;
    el.folder.textContent = settings.folder ?? '';
    el.folder.title = settings.folder ?? '';

    renderExample(plan, settings);
    setDisabled(el.run, !convert().canRun());
    setDisabled(el.folderPick, running);
    return true;
  }

  // 一覧は tools-convert-list.js が描く。ここから呼ぶのは欄の同期だけでよい。
  function render() {
    return sync();
  }

  function onClick(node, handler) {
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        handler();
    });
  }

  // name で引いたラジオを id ごとに束ね、change で setter を呼ぶ。
  function bindRadios(doc, name, ids, apply) {
    const radios = {};
    for (const id of ids) {
      const radio = doc.querySelector(`input[name="${name}"][value="${id}"]`);
      radios[id] = radio;
      radio.addEventListener('change', () => { if (radio.checked) apply(id); });
    }
    return radios;
  }

  function init(doc, win) {
    if (win.__sigkToolsConvertViewReady === true)
      return false;
    const run = doc.getElementById('convert-run');
    if (run === null)
      return false;
    win.__sigkToolsConvertViewReady = true;

    const byId = (id) => doc.getElementById(id);
    el = {
      doc, win, run,
      fitNote: byId('convert-fit-note'),
      folderKey: byId('convert-folder-key'),
      folderRow: byId('convert-folder-row'),
      folder: byId('convert-folder'),
      folderPick: byId('convert-folder-pick'),
      example: byId('convert-example'),
      papers: bindRadios(doc, 'convert-paper', PAPERS, (id) => convert().setPaper(id)),
      orients: bindRadios(doc, 'convert-orient', ORIENTATIONS, (id) => convert().setOrientation(id)),
      margins: bindRadios(doc, 'convert-margin', MARGINS, (id) => convert().setMargin(id)),
      outputs: bindRadios(doc, 'convert-output', OUTPUTS, (id) => convert().setOutput(id)),
    };

    onClick(el.folderPick, () => convert().pickFolder());

    sync();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsConvertView = { init, render, sync };
})(typeof window !== 'undefined' ? window : globalThis);
