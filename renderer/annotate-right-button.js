(function (root) {
  'use strict';

  // 編集モードの右ボタン（spec-4b-3b 確定事項D）。
  //
  // 右の押し離しでは描かない・置かない・掴まない・選ばない（spec-4b-3a 確定事項B1）。右の mousedown は既定の動きを止めて、今ある
  // 文字の選択を残す（事前調査 B）。メニューを出すかどうかは、離した後に届く contextmenu で決める（事前調査 A）。書き込みの上
  // （選んでいる書き込みの枠の余白を含む）なら、選んでいなければそれだけを選んでから「削除」のメニュー（annotation-menu.js）を
  // 押した点に出す。紙の空白では何もしない（道具も替えない。決定53 ⑥）。ハンドのときも同じ。押しの振り分けは annotate-pointer.js。
  //
  // 左＋右（確定事項E）もここで持つ。#view の中で左と右の両方が押された時点で、押している操作を全部取りやめ（annotate-cancel.js）、
  // 道具を切り替える（annotate-tools.js の chord）。全部のボタンを離すまで、動きと離しを捨て、selectstart を止め、左で動かすたびに
  // 文字の選択を外す（事前調査 B）。押す順は問わず、切り替えは 1 回だけ。全部離した後も CHORD_IGNORE_MS の間は contextmenu と
  // ダブルクリック（左＋右の左の押しと続けた押しで出る）を捨てる。

  // 左＋右の後、contextmenu を捨てる間（ms）。
  const CHORD_IGNORE_MS = 1000;

  const state = {
    doc: null,
    win: null,
    // 左＋右の後、全部のボタンを離すまで true。
    chordUntilUp: false,
    // 左＋右の後、全部のボタンが離れた時刻（CHORD_IGNORE_MS はここから数える。長く押したまま右を最後に離しても、続く contextmenu を
    // 捨てるため）。
    chordAt: -Infinity,
    // 入力欄を閉じた右の押しの印。swallow は mouseup で消えるので、続く contextmenu を飲むためにここで覚える（事前調査 K）。
    swallowedRight: false,
  };

  function annotate() {
    return root.SigK.annotate;
  }

  function menu() {
    return root.SigK.annotationMenu;
  }

  function inAnnotMode() {
    return state.doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  function isOpen() {
    return root.SigK.viewer?.getState().open === true;
  }

  function inEditor(event) {
    return (event.target?.closest?.('.free-text-editor') ?? null) !== null;
  }

  function now() {
    return state.win?.performance?.now?.() ?? Date.now();
  }

  function clearTextSelection() {
    state.win?.getSelection?.()?.removeAllRanges();
  }

  // 左＋右として扱う押しか（確定事項E1）。編集モードで文書が開いていて、入力欄の中でなく、左と右の両方が押されている。
  function isChord(event) {
    return ((event.buttons ?? 0) & 3) === 3 && inAnnotMode() && isOpen() && !inEditor(event);
  }

  // 左＋右を効かせる。全部のボタンを離すまでの 2 回目以降は何もしない（確定事項E3）。切り替えたら true。
  function chord(event) {
    event.preventDefault();
    if (state.chordUntilUp)
      return false;
    root.SigK.annotateCancel.abortForChord(state.win);
    root.SigK.annotateTools.chord();
    state.chordUntilUp = true;
    return true;
  }

  // 全部のボタンが離れた（または離したと見なす）。捨てる状態を解き、contextmenu・ダブルクリックを捨てる間を数え始める。
  function release() {
    if (!state.chordUntilUp)
      return;
    state.chordUntilUp = false;
    state.chordAt = now();
  }

  // 左＋右の最中か、全部離してから CHORD_IGNORE_MS の間か（contextmenu とダブルクリックを捨てる。確定事項E4）。
  function recentlyChorded() {
    return state.chordUntilUp || now() - state.chordAt < CHORD_IGNORE_MS;
  }

  // 離した。左＋右の後なら捨てて true（全部のボタンが離れたら解く）。
  function takeChordUp(event) {
    if (!state.chordUntilUp)
      return false;
    if ((event.buttons ?? 0) === 0)
      release();
    return true;
  }

  // 動かした。左＋右の後なら文字の選択を外して true。ボタンを押していない動き（窓の外で離した）が来たら解く。
  function whileChord(event) {
    if (!state.chordUntilUp)
      return false;
    if ((event.buttons ?? 0) === 0) {
      release();
      return false;
    }
    clearTextSelection();
    return true;
  }

  // 右で押した（左＋右でないとき）。swallowed は、その押しが入力欄かメニューを閉じるのに使われたか（確定事項D6）。
  function down(event, { swallowed = false } = {}) {
    state.swallowedRight = swallowed;
    if (swallowed || !inAnnotMode() || !isOpen() || inEditor(event))
      return;
    event.preventDefault();
  }

  // 選んでいる書き込みの枠（余白を含む）の中か。一覧で選んだ表示のみの書き込みも、枠が見えていれば当たりにする（確定事項D3）。
  function frameHit(page) {
    const shown = root.SigK.annotationFrame?.shown() ?? null;
    if (shown === null || shown.index !== page.index)
      return null;
    const pad = root.SigK.annotationFrame.FRAME_PADDING;
    const [x, y] = page.point;
    const entries = annotate().selectedEntries().filter((entry) => entry !== null);
    for (const entry of entries.reverse()) {
      const key = root.SigK.annotationLayer.keyOf(entry);
      if (!shown.keys.includes(key))
        continue;
      const box = root.SigK.annotationFrame.boundsOf(entry, shown.viewport);
      if (x >= box.x - pad && x <= box.x + box.width + pad && y >= box.y - pad && y <= box.y + box.height + pad)
        return key;
    }
    return null;
  }

  // 押した点の書き込みの鍵。紙の外・空白なら null。
  function hitAt(event) {
    const page = root.SigK.annotatePress.pageAt(event);
    if (page === null)
      return null;
    return annotate().hitTest(page.index, page.point) ?? frameHit(page);
  }

  function onContextMenu(event) {
    if (!inAnnotMode() || !isOpen() || inEditor(event))
      return;
    event.preventDefault();
    const swallowed = state.swallowedRight;
    state.swallowedRight = false;
    // 左＋右の後、全部離すまでと、離してから CHORD_IGNORE_MS の間に届いたものは捨てる（確定事項E4）。
    if (swallowed || recentlyChorded())
      return;
    const key = hitAt(event);
    if (key === null) {
      menu()?.close();
      return;
    }
    if (!annotate().isSelected(key))
      annotate().select(key);
    menu()?.open(event.clientX, event.clientY);
  }

  function init(doc, win) {
    if (win.__sigkAnnotateRightButtonReady === true)
      return false;
    win.__sigkAnnotateRightButtonReady = true;
    state.doc = doc;
    state.win = win;
    doc.getElementById('view')?.addEventListener('contextmenu', onContextMenu);
    // 左＋右の後、全部離すまで文字を選び直させない（事前調査 B5）。
    doc.addEventListener('selectstart', (event) => {
      if (state.chordUntilUp)
        event.preventDefault();
    }, true);
    // #view の外で離したとき（pointer の離しが届かない）も、全部離れたら解く。
    doc.addEventListener('mouseup', (event) => {
      if ((event.buttons ?? 0) === 0)
        release();
    });
    win.addEventListener('blur', release);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateRightButton = {
    CHORD_IGNORE_MS,
    init,
    down,
    isChord,
    chord,
    takeChordUp,
    whileChord,
    recentlyChorded,
    isChording: () => state.chordUntilUp,
  };
})(typeof window !== 'undefined' ? window : globalThis);
