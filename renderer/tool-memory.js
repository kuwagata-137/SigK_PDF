(function (root) {
  'use strict';

  // ツールで選んだ値と、最後に使ったツールを覚える（spec-6-1 タスク E の確定事項E-7・E-8。決定81 ⑦）。
  //
  // 値の持ち主は各ツール（tools-*.js）のまま。ここはツールごとの「何を覚えるか」（読む口と当てる口）の表を持ち、
  //   - 右の欄（#tool-pane）で値が替わったら、少し待ってから各ツールの今の値を読み、替わっていれば設定に書く
  //   - 起動して設定を読めたら、覚えた値を各ツールの設定の口（setText など。右の欄が使うのと同じ口）で当てる
  //   - ツールを選んだら（tools.js が知らせる）最後のツールとして書き、起動したときに選んでおく（右クリックの「PDF を分割」などで
  //     先に選ばれていたら、そちらを先にする）
  // 設定の窓で「覚える」を外していたら、当てず、書かない（覚えた値は消さない）。ページの範囲・透かしの画像のファイル・✂ の位置は覚えない。

  const SAVE_DELAY_MS = 400;

  const pick = (values, keys) => Object.fromEntries(keys.filter((key) => values?.[key] !== undefined).map((key) => [key, values[key]]));
  const call = (tool, name, value) => (value === undefined ? undefined : tool?.[name]?.(value));

  // ツールの id → { read(): 覚える値, apply(values): 当てる }。
  const TOOLS = {
    watermark: {
      read: () => pick(root.SigK.toolsWatermark?.settings(), ['type', 'text', 'color', 'opacity', 'angle', 'size', 'position']),
      apply: (values) => {
        const tool = root.SigK.toolsWatermark;
        for (const [key, name] of [['type', 'setType'], ['text', 'setText'], ['color', 'setColor'], ['opacity', 'setOpacity'], ['angle', 'setAngle'], ['size', 'setSize'], ['position', 'setPosition']])
          call(tool, name, values[key]);
      },
    },
    toImage: {
      read: () => pick(root.SigK.toolsToImage?.settings(), ['format', 'dpi']),
      apply: (values) => {
        call(root.SigK.toolsToImage, 'setFormat', values.format);
        call(root.SigK.toolsToImage, 'setDpi', values.dpi);
      },
    },
    convert: {
      read: () => pick(root.SigK.toolsConvert?.settings(), ['paper', 'orientation', 'margin', 'output']),
      apply: (values) => {
        for (const [key, name] of [['paper', 'setPaper'], ['orientation', 'setOrientation'], ['margin', 'setMargin'], ['output', 'setOutput']])
          call(root.SigK.toolsConvert, name, values[key]);
      },
    },
    split: {
      read: () => pick(root.SigK.toolsSplit?.settings(), ['rule']),
      apply: (values) => call(root.SigK.toolsSplit, 'setRule', values.rule),
    },
    flatten: {
      read: () => pick(root.SigK.toolsFlatten?.choices(), ['kinds']),
      apply: (values) => {
        if (!Array.isArray(values.kinds))
          return;
        for (const key of root.SigK.flattenChoice?.KEYS ?? [])
          root.SigK.toolsFlatten?.setKind(key, values.kinds.includes(key));
      },
    },
  };

  const state = { saved: {}, timer: null, applied: false, selectedSinceInit: false, win: null };

  const preferences = () => root.SigK.preferences;

  // 右の欄で替わった値を書く（替わったツールだけ）。
  async function savePending() {
    if (state.timer !== null) {
      state.win.clearTimeout(state.timer);
      state.timer = null;
    }
    if (preferences()?.current().rememberToolValues !== true)
      return false;
    const changed = {};
    for (const [id, tool] of Object.entries(TOOLS)) {
      const values = tool.read();
      if (JSON.stringify(values) !== JSON.stringify(state.saved[id] ?? null)) {
        changed[id] = values;
        state.saved[id] = values;
      }
    }
    if (Object.keys(changed).length === 0)
      return false;
    await preferences().set({ toolValues: changed });
    return true;
  }

  function schedule() {
    if (!state.applied)
      return;
    if (state.timer !== null)
      state.win.clearTimeout(state.timer);
    state.timer = state.win.setTimeout(() => savePending(), SAVE_DELAY_MS);
  }

  // tools.js の select から呼ばれる。最後のツールとして書く。
  function toolSelected(id) {
    state.selectedSinceInit = true;
    if (state.applied && preferences()?.current().rememberLastTool === true && preferences().current().lastTool !== id)
      preferences().set({ lastTool: id });
  }

  // 設定を読めたら、覚えた値と最後のツールを当てる。
  function applyRemembered() {
    const values = preferences()?.current();
    if (values?.rememberToolValues === true) {
      for (const [id, tool] of Object.entries(TOOLS)) {
        if (values.toolValues?.[id] !== undefined)
          tool.apply(values.toolValues[id]);
      }
    }
    for (const [id, tool] of Object.entries(TOOLS))
      state.saved[id] = tool.read();
    if (values?.rememberLastTool === true && typeof values.lastTool === 'string' && !state.selectedSinceInit)
      root.SigK.tools?.select(values.lastTool);
    state.applied = true;
  }

  async function init(doc, win) {
    if (win.__sigkToolMemoryReady === true)
      return false;
    win.__sigkToolMemoryReady = true;
    state.win = win;
    const pane = doc.getElementById('tool-pane');
    for (const type of ['input', 'change', 'click'])
      pane?.addEventListener(type, () => schedule());
    await preferences()?.ready();
    applyRemembered();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolMemory = { SAVE_DELAY_MS, TOOLS, init, savePending, toolSelected };
})(typeof window !== 'undefined' ? window : globalThis);
