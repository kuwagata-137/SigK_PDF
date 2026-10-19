(function (root) {
  'use strict';

  // 帯のページを引いている間の見た目（spec-2-5 確定事項I1・I3・I4。PR-4 の起草者の判断 I-c・I-d。見本 strips4-drag-copy・strips4-drag-new）。
  //
  //   カーソルの絵   … 選んだ最初のページの絵（描けていれば）。2 枚以上なら紙を重ね、「N ページ」の札（.strip-drag-ghost）
  //   引いている紙   … 薄くする（.strip-page.dragging。ページ編集と同じ）
  //   落とす先       … 紙の列のページとページの間にアクセントの色の縦の線と札（.strip-drop-line）。写す・動かすで文を替える
  //   受け口         … 色を替え、文を「ここに落とすと、選んだ N ページで新しい PDF の帯ができます」に（.drop-zone.hot）
  //   落とせない所   … 線を出さず、カーソルのそばに理由の札（.strip-drag-refusal）
  //
  // 押し・引き・離すは strip-drag.js。ここは DOM を書くだけ。

  const GHOST = { width: 58, height: 82 };
  const state = { doc: null, ghost: null, line: null, refusal: null, dimmed: [], zone: false };

  // 線は紙と紙の間（間 12px の真ん中）。末尾なら最後の紙の右。line は strip-layout.js の row。
  function lineLeft(line, index) {
    const gap = root.SigK.stripLayout.CELL_GAP;
    if (line.lefts.length === 0)
      return 2;
    if (index < line.lefts.length)
      return line.lefts[index] - gap / 2;
    const last = line.lefts.length - 1;
    return line.lefts[last] + line.widths[last] + gap / 2;
  }

  function sheetCopy(doc, canvas) {
    const sheet = doc.createElement('canvas');
    sheet.className = 'sheet';
    sheet.width = GHOST.width;
    sheet.height = GHOST.height;
    try {
      if (canvas)
        sheet.getContext('2d')?.drawImage(canvas, 0, 0, GHOST.width, GHOST.height);
    } catch {
      // 描けなくても白い紙のまま引ける。
    }
    return sheet;
  }

  // 引き始め。cells は引いている紙のセル、canvas は最初のページの描けた絵（無ければ null）。
  function start(doc, { count, cells = [], canvas = null }) {
    clear();
    state.doc = doc;
    const ghost = doc.createElement('div');
    ghost.className = 'strip-drag-ghost';
    if (count > 1) {
      const under = doc.createElement('div');
      under.className = 'under';
      ghost.append(under);
    }
    const badge = doc.createElement('span');
    badge.className = 'badge';
    badge.textContent = `${count} ページ`;
    ghost.append(sheetCopy(doc, canvas), badge);
    doc.body.append(ghost);
    state.ghost = ghost;
    state.dimmed = cells;
    cells.forEach((cell) => cell.classList.add('dragging'));
  }

  function hideLine() {
    state.line?.remove();
    state.line = null;
  }

  function hideRefusal() {
    state.refusal?.remove();
    state.refusal = null;
  }

  // 受け口の文の頭の印。新しい帯を作るときは「＋」、ふだんは開く印（見本 strips4-drag-new）。
  function setZoneIcon(zone, name) {
    const holder = zone.querySelector('.line [data-icon]');
    const icons = root.SigK.icons;
    if (holder === null || icons?.has(name) !== true)
      return;
    holder.dataset.icon = name;
    holder.replaceChildren(icons.create(state.doc, name, { size: Number(holder.dataset.iconSize ?? 17) }));
  }

  function setZone(on, count) {
    const zone = state.doc?.getElementById('strip-drop') ?? null;
    if (zone === null || state.zone === on)
      return;
    state.zone = on;
    zone.classList.toggle('hot', on);
    setZoneIcon(zone, on ? 'plus' : 'open');
    if (on)
      state.doc.getElementById('strip-drop-text').textContent = `ここに落とすと、選んだ ${count} ページで新しい PDF の帯ができます`;
    else
      root.SigK.stripDropZone?.refresh();
  }

  // placement は { container, left, top?, height? }（strip-drag-measure.js の placementOf）。帯の紙の列なら上下は CSS に任せ、盤なら紙の段の高さ。
  function showLine({ container, left, top, height }, text) {
    if (state.line === null || state.line.parentNode !== container) {
      hideLine();
      state.line = state.doc.createElement('div');
      state.line.className = 'strip-drop-line';
      const say = state.doc.createElement('span');
      say.className = 'say';
      state.line.append(say);
      container.append(state.line);
    }
    state.line.style.left = `${left}px`;
    state.line.style.top = top === undefined ? '' : `${top}px`;
    state.line.style.height = height === undefined ? '' : `${height}px`;
    state.line.style.bottom = height === undefined ? '' : 'auto';
    state.line.firstChild.textContent = text;
  }

  function showRefusal(text, point) {
    if (state.refusal === null) {
      state.refusal = state.doc.createElement('div');
      state.refusal.className = 'strip-drag-refusal';
      state.doc.body.append(state.refusal);
    }
    state.refusal.textContent = text;
    state.refusal.style.left = `${point.x + 16}px`;
    state.refusal.style.top = `${point.y + 22}px`;
  }

  // target は strip-drop-target.js の答えに refused（断る理由の短い文か null）を足したもの。placement は線を置く器と位置（無ければ null）。
  function show(target, { count, point, placement = null }) {
    if (state.ghost !== null) {
      state.ghost.style.left = `${point.x + 10}px`;
      state.ghost.style.top = `${point.y + 6}px`;
    }
    const refused = target.refused ?? null;
    const lineable = (target.kind === 'move' || target.kind === 'copy') && refused === null && placement !== null;
    if (lineable)
      showLine(placement, target.kind === 'move' ? `ここへ ${count} ページを動かします` : `ここに ${count} ページを写します`);
    else
      hideLine();
    setZone(target.kind === 'new' && refused === null, count);
    if (refused !== null)
      showRefusal(refused, point);
    else
      hideRefusal();
  }

  function clear() {
    hideLine();
    hideRefusal();
    setZone(false, 0);
    state.ghost?.remove();
    state.ghost = null;
    state.dimmed.forEach((cell) => cell.classList.remove('dragging'));
    state.dimmed = [];
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripDragView = { start, show, clear, lineLeft };
})(typeof window !== 'undefined' ? window : globalThis);
