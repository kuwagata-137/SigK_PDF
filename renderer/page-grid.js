(function (root) {
  'use strict';

  // ページモードのサイドパネル（spec-1-5 C・D・E）。
  //
  // 枠を並べるのは thumbnails.js のままである。あちらは「地図として紙を並べる」
  // 層で、閲覧モードと共通の仕組みを持つ。ここが足すのは**ページモードでしか
  // 意味を持たないもの**――選択と、ドラッグによる並べ替えである。
  //
  // 位置の判定（どの紙の手前へ入れるか、端でどれだけスクロールするか）は
  // page-plan.js の純粋関数に置いた。jsdom は elementFromPoint も
  // setPointerCapture も持たないため、ここに書くと画面テストに載らない
  // （確定事項31・33）。

  // 掴んだと見なす移動量（確定事項32）。クリックとの取り違えを防ぐ。
  const DRAG_THRESHOLD = 5;
  // パネルの上下端これだけに入ったらスクロールする（確定事項36）。
  const AUTO_SCROLL_EDGE = 40;
  const AUTO_SCROLL_STEP = 12;
  const AUTO_SCROLL_INTERVAL = 16;

  const state = {
    // 表示上の index の集合（確定事項14）。src ではなく表示 index で持つ。
    // 並べ替えたときは移動先の index へ付け替える。
    selection: [],
    // Shift クリックの起点。単独クリックと Ctrl クリックで動き、
    // Shift クリックでは動かない（確定事項15〜17）。
    anchor: null,
  };

  // ドラッグ1回ぶんの状態。pending は「押されたがまだ動いていない」、
  // active は「閾値を超えて実際に掴んだ」である。
  const drag = {
    pending: false,
    active: false,
    startX: 0,
    startY: 0,
    indices: [],
    at: null,
    timer: 0,
  };

  let el = null;

  function pagePlan() {
    return root.SigK.pagePlan;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function thumbnails() {
    return root.SigK.thumbnails;
  }

  function isPagesMode() {
    return el !== null && el.doc.documentElement.getAttribute('data-mode') === 'pages';
  }

  function pageCount() {
    return viewer()?.getState().pageCount ?? 0;
  }

  function getSelection() {
    return [...state.selection];
  }

  function getAnchor() {
    return state.anchor;
  }

  function thumbNodes() {
    return el === null ? [] : [...el.doc.querySelectorAll('#thumbs .thumb')];
  }

  // ---- 選択（確定事項14〜18・21・22） ----

  // 選択の印を付け直す。枠は幅・列数・編集のたびに作り直されるので、
  // thumbnails.js が組み立てた直後にここが呼ばれる。
  //
  // 削除で紙が減っていることもある。実際にある枚数へ選択を丸めるのも
  // ここでやる（消えた紙を選んだままにしない）。
  function syncMarks() {
    if (el === null)
      return false;

    const count = pageCount();
    const kept = state.selection.filter((index) => index < count);
    if (kept.length !== state.selection.length)
      state.selection = kept;

    const chosen = new Set(state.selection);
    const dragging = new Set(drag.active ? drag.indices : []);
    thumbNodes().forEach((node, index) => {
      // 現在ページの .current とは別に持つ。両方付くことがある（確定事項22）。
      node.classList.toggle('selected', chosen.has(index));
      // 掴んでいる枚は半透明にする（確定事項35）。
      node.classList.toggle('dragging', dragging.has(index));
    });
    return true;
  }

  function setSelection(indices, { anchor } = {}) {
    state.selection = pagePlan().normalizeIndices(indices, pageCount());
    if (anchor !== undefined)
      state.anchor = anchor;
    // 範囲外へ出た起点は捨てる。残っていると Shift クリックが飛ぶ。
    if (!Number.isInteger(state.anchor) || state.anchor >= pageCount())
      state.anchor = state.selection[0] ?? null;
    syncMarks();
    return getSelection();
  }

  function clearSelection() {
    return setSelection([], { anchor: null });
  }

  function selectAll() {
    return setSelection(pagePlan().selectAll(pageCount()), { anchor: 0 });
  }

  // thumbnails.js のクリックから呼ばれる。ページモードで受け取ったら true を
  // 返し、閲覧モードでは false を返して従来のページ移動へ譲る。
  function handleClick(index, event) {
    if (!isPagesMode())
      return false;

    const next = pagePlan().resolveClick({
      selection: state.selection,
      anchor: state.anchor,
      index,
      ctrl: event?.ctrlKey === true,
      shift: event?.shiftKey === true,
    });
    setSelection(next.selection, { anchor: next.anchor });

    // 選択が1枚になったらページビューをそこへ寄せる（確定事項21）。
    // 複数選んでいる間は動かさない。読んでいる場所が飛ぶのを避ける。
    if (state.selection.length === 1)
      viewer()?.goToPage(state.selection[0]);
    return true;
  }

  // ---- ドラッグによる並べ替え（確定事項30〜37） ----

  // #thumbs の中の座標。position:relative の器なので、その矩形からの差が
  // そのまま layoutThumbnails の座標系になる（スクロール量は矩形に出ている）。
  function pointInList(event) {
    const rect = el.list.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function thumbIndexFrom(target) {
    const node = target?.closest?.('.thumb');
    if (node === null || node === undefined)
      return null;
    const index = Number(node.dataset.page) - 1;
    return Number.isInteger(index) ? index : null;
  }

  // 挿入先を示す縦棒（確定事項35）。1列のときだけは横棒にする。
  // 縦に積んだ紙の左右に棒を出しても、どこへ入るのか読めない。
  function markerRect(at) {
    const pages = thumbnails()?.getLayout()?.pages ?? [];
    if (pages.length === 0)
      return null;
    const columns = thumbnails()?.getState()?.columns ?? 1;
    const flat = columns <= 1;

    if (at >= pages.length) {
      const last = pages[pages.length - 1];
      return flat
        ? { left: last.left, top: last.top + last.height, width: last.width, height: 2 }
        : { left: last.left + last.width + 2, top: last.top, width: 2, height: last.height };
    }
    const page = pages[at];
    return flat
      ? { left: page.left, top: page.top - 4, width: page.width, height: 2 }
      : { left: page.left - 4, top: page.top, width: 2, height: page.height };
  }

  function showMarker(at) {
    const rect = markerRect(at);
    if (rect === null)
      return;
    if (el.line === null) {
      el.line = el.doc.createElement('div');
      el.line.className = 'drop-line';
      el.list.append(el.line);
    }
    el.line.style.left = `${rect.left}px`;
    el.line.style.top = `${rect.top}px`;
    el.line.style.width = `${rect.width}px`;
    el.line.style.height = `${rect.height}px`;
  }

  // 掴んでいる枚数のバッジ（確定事項34）。何枚運んでいるのかは、半透明に
  // なった紙を数えるより読みやすい。
  function showBadge(event) {
    if (el.badge === null) {
      el.badge = el.doc.createElement('div');
      el.badge.className = 'drag-badge';
      el.doc.body.append(el.badge);
    }
    el.badge.textContent = `${drag.indices.length} ページ`;
    el.badge.style.left = `${event.clientX + 14}px`;
    el.badge.style.top = `${event.clientY + 14}px`;
  }

  function stopAutoScroll() {
    if (drag.timer === 0)
      return;
    el.win.clearInterval(drag.timer);
    drag.timer = 0;
  }

  // 端に寄せている間だけスクロールを続ける。マウスを止めても動き続けないと、
  // 長い文書で端まで運べない（確定事項36）。
  function updateAutoScroll(event) {
    const rect = el.scroll.getBoundingClientRect();
    const step = pagePlan().autoScrollStep({
      y: event.clientY - rect.top,
      viewportHeight: el.scroll.clientHeight,
      edge: AUTO_SCROLL_EDGE,
      step: AUTO_SCROLL_STEP,
    });

    stopAutoScroll();
    if (step === 0)
      return;
    drag.timer = el.win.setInterval(() => {
      el.scroll.scrollTop += step;
    }, AUTO_SCROLL_INTERVAL);
  }

  function endDrag() {
    stopAutoScroll();
    drag.pending = false;
    drag.active = false;
    drag.indices = [];
    drag.at = null;
    el.line?.remove();
    el.line = null;
    el.badge?.remove();
    el.badge = null;
    syncMarks();
  }

  // ドラッグの取り消し（確定事項37）。plan は変えない。
  function cancelDrag() {
    if (!drag.pending && !drag.active)
      return false;
    endDrag();
    return true;
  }

  function isDragging() {
    return drag.active;
  }

  function onPointerDown(event) {
    // 左ボタンだけを受ける。中クリック・右クリックでは掴まない。
    if (!isPagesMode() || event.button !== 0)
      return;
    const index = thumbIndexFrom(event.target);
    if (index === null)
      return;

    // 掴んだ枚が選択に含まれていなければ、その1枚だけを選び直してから動かす
    // （確定事項34）。選んでいない紙を掴んだのに、選択中の別の紙が動くのは驚く。
    if (!state.selection.includes(index))
      setSelection([index], { anchor: index });

    drag.pending = true;
    drag.active = false;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.indices = getSelection();
  }

  function onPointerMove(event) {
    if (!drag.pending)
      return;

    if (!drag.active) {
      const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (moved < DRAG_THRESHOLD)
        return;
      drag.active = true;
      syncMarks();
    }

    const point = pointInList(event);
    drag.at = pagePlan().dropIndex({
      layout: thumbnails()?.getLayout(),
      columns: thumbnails()?.getState()?.columns ?? 1,
      x: point.x,
      y: point.y,
    });
    showMarker(drag.at);
    showBadge(event);
    updateAutoScroll(event);
  }

  function onPointerUp(event) {
    if (!drag.active) {
      // 動かさずに離したのはクリックである。選択は click 側で決まる。
      drag.pending = false;
      return;
    }

    // パネルの外で離したら取り消す（確定事項37）。
    const inside = el.scroll.contains(event.target);
    const at = drag.at;
    const indices = [...drag.indices];
    endDrag();
    if (!inside || at === null)
      return;

    applyMove(indices, at);
  }

  // 並べ替えを1世代として確定する。履歴に積むのは page-edit.js の担当で、
  // ここは「どう動かすか」だけを決める。
  function applyMove(indices, at) {
    const moved = pagePlan().movePages(viewer().getPlan(), indices, at);
    if (!moved.changed)
      return false;
    root.SigK.pageEdit?.commit(moved.plan, { before: indices, after: moved.selection });
    return true;
  }

  function onKeyDown(event) {
    // ドラッグ中の Esc は取り消しに使う。検索バーや選択解除より先に効かせる
    // （確定事項19・37。掴んだままでは何もできない状態が続く）。
    if (event.key === 'Escape' && (drag.active || drag.pending)) {
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
    }
  }

  // ---- タブごとの持ち回り（確定事項11・14） ----

  // viewer の detach()／attach() に相乗りする。find.js の capture()／
  // restore() と同じ作法である。
  function capture() {
    return { selection: [...state.selection], anchor: state.anchor };
  }

  function restore(session) {
    state.selection = [...(session?.selection ?? [])];
    state.anchor = session?.anchor ?? null;
    syncMarks();
    return true;
  }

  function init(doc, win) {
    if (win.__sigkPageGridReady === true)
      return false;

    const scroll = doc.getElementById('side-scroll');
    const list = doc.getElementById('thumbs');
    if (scroll === null || list === null)
      return false;
    win.__sigkPageGridReady = true;

    el = { doc, win, scroll, list, line: null, badge: null };

    // HTML5 の draggable ではなくポインタイベントにした（確定事項30・31）。
    // jsdom は DragEvent も DataTransfer も持たないため、あちらでは画面
    // テストにまったく載らない。file-drop.js は types に 'Files' があるかで
    // 判定しているので、ページどうしのドラッグとは干渉しない。
    list.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', onPointerUp);
    doc.addEventListener('keydown', onKeyDown);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageGrid = {
    DRAG_THRESHOLD,
    AUTO_SCROLL_EDGE,
    AUTO_SCROLL_STEP,
    init,
    handleClick,
    getSelection,
    getAnchor,
    setSelection,
    clearSelection,
    selectAll,
    syncMarks,
    isDragging,
    cancelDrag,
    capture,
    restore,
  };
})(typeof window !== 'undefined' ? window : globalThis);
