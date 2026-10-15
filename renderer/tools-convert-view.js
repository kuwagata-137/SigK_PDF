(function (root) {
  'use strict';

  // 右の欄の画像→PDF の節（spec-3-1 確定事項10〜14・18〜21、spec-2-5 確定事項H2・H3・H9。見本 screenshots/strips3-convert.png）。
  //
  // 状態は tools-convert.js が持つ。ここは区切りボタン（ラジオボタン）と欄を状態へ合わせ、変えられたらあちらの setter を呼ぶ。
  // 画像の並びは「変換する画像」の帯（image-strip.js）、「できた PDF」のカードは convert-result.js が描く（ここから描き直しを呼ぶ）。
  // 「画像に合わせる」を選ぶと向きと余白は決まってしまうので、その 2 つを押せなくする（確定事項11・13）。値は据え置き、用紙を戻せばまた効く。

  const PAPERS = ['a4', 'a3', 'b5', 'letter', 'image'];
  const ORIENTATIONS = ['auto', 'portrait', 'landscape'];
  const MARGINS = ['none', 'narrow', 'normal'];
  const OUTPUTS = ['single', 'each'];
  const EMPTY = '画像を落とすか、下の受け口の［ファイルを選ぶ…］で選ぶと、「変換する画像」の帯に並びます。';

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

  // 出力の例（確定事項21）。まとめるなら `photo.pdf（12 ページ）`、画像ごとなら `a.pdf … l.pdf（12 ファイル）`。誤りがあれば例の代わりに文言。
  function renderExample(plan, settings) {
    el.example.replaceChildren();
    if (plan.ready !== true) {
      if (plan.error !== null)
        el.example.append(Object.assign(el.doc.createElement('span'), { className: 'err', textContent: plan.error }));
      return;
    }
    const count = Object.assign(el.doc.createElement('span'), { className: 'n' });
    if (settings.output === 'single') {
      count.textContent = `（${plan.totalPages} ページ）`;
      el.example.append(code(root.SigK.convertPlan.defaultSingleName(convert().rows())), count);
      return;
    }
    const { names } = plan;
    count.textContent = `（${names.length} ファイル）`;
    el.example.append(...(names.length === 1 ? [code(names[0])] : [code(names[0]), ' … ', code(names.at(-1))]), count);
  }

  // 下の要約。「画像 5 枚 → 1 つの PDF（5 ページ）」「画像 5 枚 → 5 個の PDF」。変換できない画像があれば、その枚数。
  function summaryText(plan, settings) {
    const rows = convert().rows();
    if (rows.length === 0)
      return '';
    if (plan.ready === true)
      return settings.output === 'single' ? `画像 ${rows.length} 枚 → 1 つの PDF（${plan.totalPages} ページ）` : `画像 ${rows.length} 枚 → ${plan.names.length} 個の PDF`;
    const blocked = rows.filter((row) => row.blocked !== null).length;
    return blocked > 0 ? `画像 ${rows.length} 枚・${blocked} 枚は変換できません` : `画像 ${rows.length} 枚`;
  }

  // 用紙・向き・余白・出力のラジオボタンを状態へ合わせる。実行中はすべて押せない（確定事項27）。
  function syncRadios(settings, running) {
    const byImage = settings.paper === 'image';
    const groups = [[el.papers, settings.paper, false], [el.orients, settings.orientation, byImage], [el.margins, settings.margin, byImage], [el.outputs, settings.output, false]];
    for (const [radios, value, fixed] of groups) {
      for (const [id, radio] of Object.entries(radios)) {
        radio.checked = value === id;
        radio.disabled = running || fixed;
      }
    }
  }

  function sync() {
    if (el === null)
      return false;
    const settings = convert().settings();
    const plan = convert().currentPlan();
    const running = convert().isRunning();
    const empty = convert().rows().length === 0;
    el.state.textContent = EMPTY;
    el.state.hidden = !empty;
    syncRadios(settings, running);
    el.fitNote.textContent = settings.paper === 'image'
      ? '画像の画素数をそのまま紙の大きさにします。余白は付きません。'
      : '画像は余白の内側に、縦横比を保って収まる大きさに合わせます。';
    // フォルダーの欄は「画像ごと」のときだけ出す（まとめるときの保存先は OS の保存ダイアログが決めるため。確定事項19・20）。
    const each = settings.output === 'each';
    el.folderKey.hidden = !each;
    el.folderRow.hidden = !each;
    el.folder.textContent = settings.folder ?? '';
    el.folder.title = settings.folder ?? '';
    renderExample(plan, settings);
    el.summary.textContent = summaryText(plan, settings);
    setDisabled(el.run, !convert().canRun());
    setDisabled(el.folderPick, running);
    root.SigK.convertResult?.render();
    return true;
  }

  function onClick(node, handler) {
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        handler();
    });
  }

  // name で引いたラジオボタンを id ごとに束ね、change で setter を呼ぶ。
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
      state: byId('convert-state'),
      fitNote: byId('convert-fit-note'),
      folderKey: byId('convert-folder-key'),
      folderRow: byId('convert-folder-row'),
      folder: byId('convert-folder'),
      folderPick: byId('convert-folder-pick'),
      example: byId('convert-example'),
      summary: byId('convert-summary'),
      papers: bindRadios(doc, 'convert-paper', PAPERS, (id) => convert().setPaper(id)),
      orients: bindRadios(doc, 'convert-orient', ORIENTATIONS, (id) => convert().setOrientation(id)),
      margins: bindRadios(doc, 'convert-margin', MARGINS, (id) => convert().setMargin(id)),
      outputs: bindRadios(doc, 'convert-output', OUTPUTS, (id) => convert().setOutput(id)),
    };
    onClick(el.folderPick, () => convert().pickFolder());
    onClick(run, () => convert().run());
    sync();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsConvertView = { init, render: sync, sync };
})(typeof window !== 'undefined' ? window : globalThis);
