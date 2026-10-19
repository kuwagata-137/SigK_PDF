(function (root) {
  'use strict';

  // 帯のページを動かす・写す・新しい帯を作る（spec-2-5 確定事項I2〜I5・I7・I8。PR-4）。引いて落とす操作（strip-drag.js）と ✂ の盤の
  // 引いて落とす（split-board-input.js）が、落とした先に応じてここを呼ぶ。引き始めた帯はいつも枠の帯（＝映しているタブ。起草者の判断 I-a）。
  //
  //   同じ帯       → 動かす（pagePlan.movePages ＋ pageEdit.commit。Ctrl+Z で戻せる。動かしたページを選んだまま）
  //   ほかの帯     → 写す（写しの PDF を差し込みとして入れる。枠と元の選択はそのまま。I7）
  //   受け口       → 選んだページで新しい帯（名前の無いタブ「新しい PDF N」。枠は新しい帯へ。I7）
  //
  // 保存していないモザイクのあるページは写さない（決定80 ㊵。I8）。写しを作っている途中（非同期）に写す先が閉じられた・枠の帯が替わったら、
  // どの帯にも入れない。写した先と動かした帯は、ツールモードの Ctrl+Z の記録（tool-history.js）に控える。

  let untitled = 0;

  const tabs = () => root.SigK.tabs;
  const viewer = () => root.SigK.viewer;
  const banner = () => root.SigK.viewBanner;

  function mosaicRefusal(name) {
    return `モザイクを保存していないページは写せません。「${name}」を上書き保存してから、もう一度引いてください。`;
  }

  // 写す先の帯が使えないときの理由。使えれば null。
  function targetRefusal(tabId) {
    const peeked = tabs().peek(tabId);
    if (peeked === null || peeked.doc === undefined)
      return '開けなかった PDF には写せません。';
    if (peeked.file?.encrypted === true)
      return 'パスワード付きの PDF には写せません。';
    return null;
  }

  // target は { kind: 'move' } か { kind: 'copy', tabId } か { kind: 'new' }。断る理由の文か null。
  function refusalFor({ indices, target }) {
    if (target?.kind === 'move')
      return null;
    const view = viewer().getState();
    if (view.file?.encrypted === true)
      return 'パスワード付きの PDF のページは写せません。';
    const plan = viewer().getPlan();
    if (indices.some((index) => (root.SigK.pageMosaic?.countOf(plan[index]) ?? 0) > 0))
      return mosaicRefusal(view.file.name);
    if (target?.kind === 'new') {
      const max = tabs().MAX_TABS;
      return tabs().count() >= max ? `帯が ${max} 本あるので、新しい帯を作れません。使わない帯を閉じてください。` : null;
    }
    return targetRefusal(target?.tabId);
  }

  function refuse(text) {
    banner().show(text, { tone: 'warn' });
    return { refused: text };
  }

  // 写しを作れなかった・中止したことを知らせる（進み具合の文を残さない）。中止は自分で止めたので赤く塗らない（決定49）。
  function report(built) {
    if (built.canceled === true)
      banner().show('ページを写すのを中止しました。', { tone: 'info' });
    else if (built.error !== undefined)
      banner().show(built.error);
    return built;
  }

  // 同じ帯の中で動かす。to は今の並びの、その位置の手前へ入れる 0..length。動かなければ何もせずに false。
  // board は ✂ の盤の中で動かしたとき（G4）。盤の選択も動かしたページへ移し、箱の末尾に落としたとき（boxEnd）は、そのページを箱に入れるため ✂ を
  // 落としたページの後ろへ動かす（盤の操作として積むので、Ctrl+Z は ✂ → 並びの順に戻り、✂ も元の位置へ戻る。起草者の判断 I-k）。
  function move(indices, to, { board = false, boxEnd = false } = {}) {
    const tabId = tabs().activeId();
    const moved = root.SigK.pagePlan.movePages(viewer().getPlan(), indices, to);
    if (tabId === null || !moved.changed)
      return false;
    // 盤の箱の末尾に落としたときの並べ替えと ✂ の動きは、ツールモードの記録で 1 つにまとめる（Ctrl+Z 1 回で戻る。I6）。
    const batch = root.SigK.toolHistory?.batch ?? ((fn) => fn());
    batch(() => {
      root.SigK.pageEdit.commit(moved.plan, { before: indices, after: moved.selection });
      root.SigK.toolHistory?.record('pages', tabId);
      // 動かしたページを選んだままにする（起草者の判断 I-g）。並びの参照は、帯が描き直しで比べるタブの今の並び。
      root.SigK.stripSelection.set(tabId, moved.selection, tabs().peek(tabId)?.plan ?? null);
      if (board)
        followOnBoard(moved.selection, boxEnd);
    });
    return true;
  }

  function followOnBoard(selection, boxEnd) {
    const edit = root.SigK.toolsSplitEdit;
    const first = selection[0];
    const last = selection[selection.length - 1];
    if (boxEnd)
      edit.moveCut(first, last + 1);
    edit.setSelection(root.SigK.splitSelection.dragTo(first, last));
  }

  // 写しを tabId の帯の at（並びの位置）へ差し込みとして入れる。枠の帯は替えない（I7）。
  function insertInto(tabId, built, at) {
    tabs().withActive(tabId, () => {
      const numbers = viewer().addInserts(built.sizes.map((size, page) => ({ path: null, copy: built.copy, bytes: built.bytes, page, size, doc: built.doc })));
      const plan = viewer().getPlan();
      const position = Math.max(0, Math.min(at, plan.length));
      const next = [...plan.slice(0, position), ...numbers.map((insert) => ({ insert, rotate: 0 })), ...plan.slice(position)];
      root.SigK.pageEdit.commit(next, { before: [], after: numbers.map((_number, offset) => position + offset) });
    });
  }

  async function copyTo(tabId, indices, at) {
    const refused = refusalFor({ indices, target: { kind: 'copy', tabId } });
    if (refused !== null)
      return refuse(refused);
    const sourceId = tabs().activeId();
    const built = await root.SigK.pageCopyBuild.build(indices);
    if (built.ok !== true)
      return report(built);
    if (tabs().activeId() !== sourceId || targetRefusal(tabId) !== null) {
      built.doc?.destroy?.();
      return { canceled: true };
    }
    insertInto(tabId, built, at);
    root.SigK.toolHistory?.record('pages', tabId);
    const name = tabs().list().find((tab) => tab.id === tabId)?.name ?? '';
    banner().show(`${built.sizes.length} ページを「${name}」に写しました。`, { autoHideMs: 2500, tone: 'info' });
    return { ok: true, pages: built.sizes.length };
  }

  function folderOf(filePath) {
    if (typeof filePath !== 'string')
      return null;
    const at = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    return at > 0 ? filePath.slice(0, at) : null;
  }

  // 選んだページで新しい帯を作る。名前は「新しい PDF N」（アプリを起動してから作った順。閉じても番号を戻さない。起草者の判断 I-h）。
  async function toNewStrip(indices) {
    const refused = refusalFor({ indices, target: { kind: 'new' } });
    if (refused !== null)
      return refuse(refused);
    const file = viewer().getState().file;
    const folder = folderOf(file?.path) ?? file?.folder ?? null;
    const built = await root.SigK.pageCopyBuild.build(indices, { open: false });
    if (built.ok !== true)
      return report(built);
    untitled += 1;
    const opened = await tabs().openSource({
      ok: true, path: null, name: `新しい PDF ${untitled}`, size: built.bytes.length, mtimeMs: null, bytes: built.bytes, copy: built.copy, untitled: true, folder,
    });
    if (!opened)
      return report({ error: '新しい帯を開けませんでした。' });
    banner().show(`${indices.length} ページで、新しい帯「新しい PDF ${untitled}」を作りました。`, { autoHideMs: 2500, tone: 'info' });
    return { ok: true, tabId: tabs().activeId() };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageTransfer = { refusalFor, move, copyTo, toNewStrip };
})(typeof window !== 'undefined' ? window : globalThis);
