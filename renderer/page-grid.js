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
  // active は「閾値を超えて実際に掴んだ」である。pressed は押した紙の表示 index。
  const drag = {
    pending: false,
    active: false,
    pressed: null,
    startX: 0,
    startY: 0,
    indices: [],
    at: null,
    timer: 0,
  };
  // 引いて離した直後か。続く click を 1 回だけ捨てる（handleClick）。次の押下で外す（click が来ないで終わることがある）。
  let clickAfterDrag = false;

  let el = null;

  function pagePlan() {
    return root.SigK.pagePlan;
  }

  // 選択と並べ替えの当たり判定（spec-4b-6a a0 で page-plan.js から分けた）。
  function gridRules() {
    return root.SigK.pageGridRules;
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
      syncThumbTools(node);
    });
    return true;
  }

  // 紙の上に出す小さなボタン（確定事項52。docs/04 4-2）。ページモードのときだけ
  // 置く。紙の幅が 100px 前後になるため、文字は入れずアイコンだけにする。
  const THUMB_TOOLS = [
    ['rotateLeft', 'rotateLeft', '左に90度回す'],
    ['rotateRight', 'rotateRight', '右に90度回す'],
    ['delete', 'trash', 'このページを削除'],
  ];

  function syncThumbTools(node) {
    const existing = node.querySelector('.thumb-tools');
    if (!isPagesMode()) {
      existing?.remove();
      return;
    }
    if (existing !== null)
      return;

    const tools = el.doc.createElement('div');
    tools.className = 'thumb-tools';
    for (const [tool, icon, title] of THUMB_TOOLS) {
      const button = el.doc.createElement('button');
      button.type = 'button';
      button.className = 'thumb-tool';
      button.dataset.tool = tool;
      button.title = title;
      if (tool === 'delete')
        button.classList.add('danger');
      button.append(root.SigK.icons.create(el.doc, icon, { size: 16, strokeWidth: 1.9 }));
      tools.append(button);
    }
    node.append(tools);
  }

  function setSelection(indices, { anchor } = {}) {
    state.selection = pagePlan().normalizeIndices(indices, pageCount());
    if (anchor !== undefined)
      state.anchor = anchor;
    // 範囲外へ出た起点は捨てる。残っていると Shift クリックが飛ぶ。
    if (!Number.isInteger(state.anchor) || state.anchor >= pageCount())
      state.anchor = state.selection[0] ?? null;
    syncMarks();
    // 全ページを選ぶと削除は押せなくなる（確定事項41）。選択のたびに揃える。
    root.SigK.pageEdit?.syncActions();
    return getSelection();
  }

  function clearSelection() {
    return setSelection([], { anchor: null });
  }

  function selectAll() {
    return setSelection(gridRules().selectAll(pageCount()), { anchor: 0 });
  }

  // thumbnails.js のクリックから呼ばれる。ページモードで受け取ったら true を
  // 返し、閲覧モードでは false を返して従来のページ移動へ譲る。
  function handleClick(index, event) {
    if (!isPagesMode())
      return false;
    // 引いて離したあとの click は捨てる（spec-4b-7b 点検の直し）。同じサムネイルの上で離すと、click が選択を 1 枚に選び直し、
    // Ctrl＋クリックの手が少し動いて掴んだときは、押したページを外して選択が空になっていた。
    if (clickAfterDrag) {
      clickAfterDrag = false;
      return true;
    }

    // 紙の上の小さなボタンは、その1枚だけに掛ける。選択は動かさない。
    const tool = event?.target?.closest?.('.thumb-tool');
    if (tool !== null && tool !== undefined) {
      runThumbTool(index, tool.dataset.tool);
      return true;
    }

    const next = gridRules().resolveClick({
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

  function runThumbTool(index, tool) {
    const edit = root.SigK.pageEdit;
    if (edit === undefined)
      return false;
    if (tool === 'rotateLeft')
      return edit.rotate(-90, [index]);
    if (tool === 'rotateRight')
      return edit.rotate(90, [index]);
    if (tool === 'delete')
      return edit.remove([index]);
    return false;
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
    const step = gridRules().autoScrollStep({
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
    drag.pressed = null;
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
    clickAfterDrag = false;
    // 左ボタンだけを受ける。中クリック・右クリックでは掴まない。
    if (!isPagesMode() || event.button !== 0)
      return;
    // 紙の上のボタンを押したのであって、紙を掴んだのではない。
    if (event.target?.closest?.('.thumb-tool') !== null && event.target?.closest?.('.thumb-tool') !== undefined)
      return;
    const index = thumbIndexFrom(event.target);
    if (index === null)
      return;

    // Ctrl+A を「サイドパネルにフォーカスがあるときだけ」に限るため、
    // 触った時点でフォーカスを移す（確定事項18）。
    el.scroll.focus?.({ preventScroll: true });

    // 押しただけでは選択を変えない。動かさずに離せばクリックで、選択は click 側（handleClick。確定事項15〜17）が決める。
    // ここで選び直すと、Ctrl・Shift のクリックが当たる前に選択と起点が替わり、Ctrl＋クリックで選択が空になり、Shift＋クリックが
    // 押した 1 枚だけになっていた（計画外の直し①。本物のマウスでは pointerdown が click より先に来る）。
    drag.pending = true;
    drag.active = false;
    drag.pressed = index;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.indices = [];
  }

  // 閾値を超えて掴んだときに、運ぶ紙を決める。掴んだ枚が選択に含まれていなければ、その1枚だけを選び直してから動かす
  // （確定事項34）。選んでいない紙を掴んだのに、選択中の別の紙が動くのは驚く。選んでいる紙を掴んだなら選んでいる全部を運ぶ。
  function grab() {
    if (!state.selection.includes(drag.pressed))
      setSelection([drag.pressed], { anchor: drag.pressed });
    drag.indices = getSelection();
    drag.active = true;
    syncMarks();
  }

  function onPointerMove(event) {
    if (!drag.pending)
      return;

    if (!drag.active) {
      const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (moved < DRAG_THRESHOLD)
        return;
      grab();
    }

    const point = pointInList(event);
    drag.at = gridRules().dropIndex({
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
      drag.pressed = null;
      return;
    }

    // パネルの外で離したら取り消す（確定事項37）。
    clickAfterDrag = true;
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
    // ドラッグ中の Esc は取り消しに使う（確定事項19・37。掴んだままでは何もできない状態が続く）。stopPropagation では同じ
    // document の振り分け（escape-order.js）は止まらない。こちらが先に登録されているので、preventDefault を見て検索バーや
    // 選択を残す（spec-4b-7a 確定事項C1）。
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
    // タッチで列をスクロールすると pointerup の代わりに pointercancel が来る。押下の控えを残すと、そのあとマウスを動かしただけで
    // 掴んだ状態が始まっていた（spec-4b-7b 点検の直し。前からの不具合）。
    doc.addEventListener('pointercancel', () => cancelDrag());
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
