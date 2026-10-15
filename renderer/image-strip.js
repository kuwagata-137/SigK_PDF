(function (root) {
  'use strict';

  // 「変換する画像」の帯（spec-2-5 確定事項H1・H4〜H8。見本 screenshots/strips3-convert.png）。画像→PDF を選んでいて、画像が 1 枚でも
  // あるときだけ、PDF の帯と受け口の間（#image-strip）に出す。タブではないので .strip にしない（帯の数え上げに入れない）。
  //
  //   #image-strip(.sel)
  //     .img-strip-head … 「画」の札・「変換する画像」・「N 枚（左から順にページになります）」・［×］（すべて外す。#image-strip-clear）
  //     #image-strip-items（横にスクロール）> .img-item[data-id](.bad) > .img-thumb（img か形式の名前・N ページの札）＋ button.img-x ＋ .cap
  //     #image-strip-note（画像ごとの注意。名前と理由）
  //
  // 状態（画像の並び・用紙）は tools-convert.js が持ち、ここは描いて、押されたらあちらの関数を呼ぶ。並べ替えは image-strip-drag.js、
  // サムネイルは image-thumbs.js、注意と説明の文は image-strip-notes.js。
  // 枠（.sel）は、画像を足した・この帯を押したときに付け、PDF の帯を押したら外す（H7）。

  const ITEM_STEP = 116;   // .img-item の幅 104px ＋ 間 12px（strips.css）
  const PREFETCH = 2;

  const state = { selected: false, shown: false };
  let el = null;

  const convert = () => root.SigK.toolsConvert;
  const notes = () => root.SigK.imageStripNotes;
  const thumbs = () => root.SigK.imageThumbs;

  function isShown() {
    return el !== null && root.SigK.tools?.isToolsMode() === true && root.SigK.toolPane?.shown() === 'convert' && convert().rows().length > 0;
  }

  function node(tag, className, text = '') {
    const made = el.doc.createElement(tag);
    made.className = className;
    made.textContent = text;
    return made;
  }

  // サムネイルか、まだ・作れないときは形式の名前（H5）。
  function thumbOf(row) {
    const box = node('div', 'img-thumb');
    const made = thumbs().get(row.path);
    if (made?.url !== undefined) {
      const img = el.doc.createElement('img');
      img.src = made.url;
      img.alt = '';
      img.draggable = false;
      box.append(img);
    } else {
      const ext = row.path.split('.').pop() ?? '';
      box.append(node('span', 'img-kind', row.pending ? '…' : String(row.kind ?? ext).toUpperCase()));
    }
    if (row.pages > 1)
      box.append(node('span', 'img-pages', `${row.pages} ページ`));
    return box;
  }

  function itemOf(row, problem) {
    const item = node('div', 'img-item');
    item.dataset.id = row.id;
    item.title = notes().describe(row);
    item.classList.toggle('bad', problem !== null);
    const off = node('button', 'img-x');
    off.type = 'button';
    off.tabIndex = -1;
    off.title = '外す';
    off.setAttribute('aria-label', `「${row.name}」を外す`);
    if (root.SigK.icons?.has('close'))
      off.append(root.SigK.icons.create(el.doc, 'close', { size: 11, strokeWidth: 2.2 }));
    item.append(thumbOf(row), off, node('span', 'cap', row.name));
    return item;
  }

  function render() {
    if (el === null)
      return false;
    const shown = isShown();
    el.host.hidden = !shown;
    // 出す・隠すが変わったら、PDF の帯の枠を付け直す（画像をすべて外して隠れたときに、どの帯にも枠が無くなっていた。点検で見つけた）。
    if (shown !== state.shown) {
      state.shown = shown;
      root.SigK.strips?.sync();
    }
    if (!shown)
      return false;
    const rows = convert().rows();
    const problems = notes().problemsOf(rows);
    el.host.classList.toggle('sel', state.selected);
    el.count.textContent = `${rows.length} 枚（左から順にページになります）`;
    const lines = rows
      .map((row, index) => (problems[index] === null ? null : node('div', 'line', `「${row.name}」：${problems[index]}`)))
      .filter((line) => line !== null);
    const items = rows.map((row, index) => itemOf(row, problems[index]));
    const line = el.items.querySelector('.img-drop-line');
    el.items.replaceChildren(...items, ...(line === null ? [] : [line]));
    el.note.replaceChildren(...lines);
    el.note.hidden = lines.length === 0;
    thumbs().keep(rows.map((row) => row.path));
    watchWidth();
    requestThumbs();
    return true;
  }

  // 幅が変わったら（窓を広げた・左のツールの一覧を閉じた）、新しく見えた画像のサムネイルを頼む（点検で見つけた。前は横にスクロール
  // するまで頼まず、形式の名前の紙のままだった）。見張りは帯を初めて出したときに付ける（隠れている間は幅が 0 で、測る意味が無い）。
  // 窓の resize は init で受ける（ResizeObserver が無いとき）。
  function watchWidth() {
    if (el.watching || typeof el.win.ResizeObserver !== 'function')
      return;
    el.watching = true;
    new el.win.ResizeObserver(() => {
      if (isShown())
        requestThumbs();
    }).observe(el.items);
  }

  // 見えている画像（左右に 2 枚の先読み）のサムネイルを頼む。幅が分からない（隠れている・テスト）ときは 8 枚分と見る。
  function requestThumbs() {
    const rows = convert().rows();
    const width = el.items.clientWidth || ITEM_STEP * 8;
    const first = Math.max(0, Math.floor(el.items.scrollLeft / ITEM_STEP) - PREFETCH);
    const last = Math.min(rows.length, Math.ceil((el.items.scrollLeft + width) / ITEM_STEP) + PREFETCH);
    thumbs().want(rows.slice(first, last).map((row) => row.path));
  }

  function setSelected(next) {
    if (state.selected === next)
      return false;
    state.selected = next;
    render();
    root.SigK.strips?.sync();   // PDF の帯の枠を付け直す
    return true;
  }

  const locked = () => convert().isRunning() || root.SigK.save?.isBusy() === true;

  function onClick(event) {
    if ((event.target.closest?.('#image-strip-clear') ?? null) !== null) {
      if (!locked())
        convert().clear();
      return;
    }
    const off = event.target.closest?.('.img-x') ?? null;
    if (off !== null) {
      if (!locked())
        convert().remove(off.closest('.img-item').dataset.id);
      return;
    }
    setSelected(true);
  }

  // ボタンにフォーカスを移さず、右の欄に残ったフォーカスを外す（帯の押しと同じ。strip-input.js）。
  function onMouseDown(event) {
    if ((event.button ?? 0) !== 0 || (event.target.closest?.('button, .img-item') ?? null) === null)
      return;
    event.preventDefault();
    el.doc.activeElement?.blur?.();
  }

  // 届いた画像の枠だけを差し替える（帯ごと描き直すと、引いている途中の表示が崩れる）。
  function onThumbReady(filePath) {
    if (!isShown())
      return;
    for (const row of convert().rows().filter((entry) => entry.path === filePath))
      el.items.querySelector(`.img-item[data-id="${row.id}"] .img-thumb`)?.replaceWith(thumbOf(row));
  }

  function init(doc, win) {
    if (win.__sigkImageStripReady === true)
      return false;
    const host = doc.getElementById('image-strip');
    if (host === null)
      return false;
    win.__sigkImageStripReady = true;
    el = {
      doc, win, host, watching: false,
      items: doc.getElementById('image-strip-items'), count: doc.getElementById('image-strip-count'), note: doc.getElementById('image-strip-note'),
    };
    host.addEventListener('click', onClick);
    host.addEventListener('mousedown', onMouseDown);
    el.items.addEventListener('scroll', requestThumbs);
    win.addEventListener('resize', () => {
      if (isShown())
        requestThumbs();
    });
    thumbs().onReady(onThumbReady);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageStrip = {
    ITEM_STEP, init, render, isShown,
    select: () => setSelected(true),
    deselect: () => setSelected(false),
    // PDF の帯に枠を付けないとき（画像の帯に枠がある間。H7）。
    hasFrame: () => state.selected && isShown(),
    isSelected: () => state.selected,
  };
})(typeof window !== 'undefined' ? window : globalThis);
