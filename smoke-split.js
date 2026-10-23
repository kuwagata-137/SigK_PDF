'use strict';

// 起動確認の分割（spec-2-2 完了判定9・spec-2-2b 確定事項K1〜K4）。main.js の installSmokeCheck が使う
// （2,000 行を超えた main.js にこれ以上足さないため分けた）。
//
//   SIGK_SMOKE_SPLIT=<PDF>  SIGK_SMOKE_SPLIT_OPS=<操作列>  SIGK_SMOKE_SPLIT_OUT=<出力フォルダ>  SIGK_SMOKE_SPLIT_RULE=seq|pages
//     操作はカンマ区切りで、ページと箱の番号は 1 始まり: each / every:<N> / at:<3+7 のように + でつなぐ> / clear /
//     cut:<そのページの前で切る> / join:<箱> / select:<a>-<b> / one / skip / unskip / undo / redo /
//     size:<ツールモードの紙の倍率。0.5〜3。2026-10-23 に「大きさ 小・中・大」をやめてツールバーの倍率にした。docs/07 決定83> /
//     scroll:<0〜1> / fold（別のツールへ移って戻る） / leave（別のツールへ移ったまま。畳んだあとのメモリを見るため） /
//     zoom:<ページ> / zoom-step:<±1> / zoom-close / state（その時点を控える）
//     省略時は every:10。
//   SIGK_SMOKE_SPLIT_STAY=1 なら実行せずに盤の画面に留まる（画面写真を撮るため）。SIGK_SMOKE_SPLIT_CANCEL=1 なら通知バーの「中止」を押す。
//
// PDF はタブ（帯）で開いて分割を選び、その帯を ✂ の盤に広げる（spec-2-5 確定事項G1・G13。エクスプローラーからの分割と同じ useFromLaunch）。
// 盤は帯の画面（#strips）のスクロールに乗るので、scroll の操作と scrollTop はその器で見る（G9）。
//
// 2 段に分ける。先に画面を組んで出力先の一覧をメインへ返し、メインが先頭の出力先を空で作ってから、画面の［実行…］と同じ
// run() を回す。同名の 3 択は run() の中で開くので、開いたのを見て「上書き」を押す（spec-2-2 完了判定6）。

const WAIT = 'const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));';

// 盤のいまの様子（画面の DOM・描く層・計画）。
const SNAPSHOT = `() => {
  const SigK = window.SigK;
  const plan = SigK.toolsSplit.currentPlan();
  const scroller = SigK.splitBoardView.scroller();
  const host = SigK.splitStrip.hostNode();
  return {
    files: plan.files ?? 0,
    reason: plan.reason,
    parts: plan.parts ? plan.parts.map((pages) => pages.length) : [],
    summary: document.getElementById('split-summary').textContent,
    band: document.getElementById('split-band').hidden ? null : document.getElementById('split-band-text').textContent,
    canRun: SigK.toolsSplit.canRun(),
    dom: SigK.splitBoardView.getState(),
    fileRows: document.querySelectorAll('#split-files .sb-file').length,
    canvases: document.querySelectorAll('#split-board-canvas canvas').length,
    thumbs: SigK.splitThumbs.getState(),
    scrollTop: Math.round(scroller.scrollTop),
    // 盤を入れている帯（spec-2-5 確定事項G1）。帯の中にあるか・広げているか・その帯の高さ。
    host: host === null ? null : { name: host.querySelector('.fname')?.textContent ?? null, inStrip: host.contains(document.getElementById('split-strip-board')),
      board: host.classList.contains('board'), height: Math.round(host.getBoundingClientRect().height) },
    strips: document.querySelectorAll('#strips .strip').length,
    tabbarHidden: getComputedStyle(document.getElementById('tabbar')).display === 'none',
    totalHeight: Math.round(Number.parseFloat(document.getElementById('split-board-canvas').style.height) || 0),
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    zoom: SigK.splitZoom ? { open: SigK.splitZoom.isOpen(), page: SigK.splitZoom.current() } : null,
  };
}`;

function setupScript({ source, ops = 'every:10', outDir = null, rule = 'seq' }) {
  return `(async () => {
    ${WAIT}
    const SigK = window.SigK;
    const edit = SigK.toolsSplitEdit;
    const snapshot = ${SNAPSHOT};
    await SigK.toolsSplit.useFromLaunch([${JSON.stringify(source)}]);
    await wait(800);
    if (${JSON.stringify(outDir)} !== null)
      SigK.toolsSplit.setFolder(${JSON.stringify(outDir)});
    SigK.toolsSplit.setRule(${JSON.stringify(rule)});
    const applied = [];
    const states = [];
    for (const raw of ${JSON.stringify(ops)}.split(',')) {
      const step = raw.trim();
      if (step === '')
        continue;
      const [name, arg = ''] = step.split(':');
      const scroll = SigK.splitBoardView.scroller();
      if (name === 'each' || name === 'clear') edit.bulk(name);
      else if (name === 'every') { edit.setBulkText('every', arg); edit.bulk('every'); }
      else if (name === 'at') { edit.setBulkText('at', arg.split('+').join(', ')); edit.bulk('at'); }
      else if (name === 'cut') edit.cut(Number(arg) - 1);
      else if (name === 'join') edit.join(Number(arg) - 1);
      else if (name === 'select') { const [from, to = from] = arg.split('-').map(Number); edit.select(from - 1); edit.select(to - 1, { shift: true }); }
      else if (name === 'one') edit.makeOne();
      else if (name === 'skip') edit.skip();
      else if (name === 'unskip') edit.unskip();
      else if (name === 'undo') edit.undo();
      else if (name === 'redo') edit.redo();
      else if (name === 'size') SigK.toolsZoom.set(Number(arg));
      else if (name === 'scroll') { scroll.scrollTop = Number(arg) * (scroll.scrollHeight - scroll.clientHeight); scroll.dispatchEvent(new Event('scroll')); }
      else if (name === 'leave') SigK.tools.select('merge');
      else if (name === 'fold') { SigK.tools.select('merge'); await wait(400); states.push({ at: 'folded', ...snapshot() }); SigK.tools.select('split'); }
      else if (name === 'zoom') await SigK.splitZoom.open(Number(arg) - 1);
      else if (name === 'zoom-step') await SigK.splitZoom.step(Number(arg));
      else if (name === 'zoom-close') SigK.splitZoom.close();
      else if (name === 'state') { states.push({ at: applied.length, ...snapshot() }); continue; }
      else { applied.push('unknown:' + step); continue; }
      applied.push(step);
      await wait(name === 'fold' || name === 'leave' || name === 'scroll' || name.startsWith('zoom') ? 800 : 250);
    }
    await wait(600);
    const src = SigK.toolsSplit.source();
    const plan = SigK.toolsSplit.currentPlan();
    return {
      source: src ? { name: src.name, pageCount: src.pageCount, blocked: src.blocked } : null,
      mode: document.documentElement.getAttribute('data-mode'),
      selected: SigK.tools.selected(),
      applied, states,
      final: snapshot(),
      runDisabled: document.getElementById('split-run').getAttribute('aria-disabled'),
      targets: plan.ready ? plan.targets : [],
    };
  })()`;
}

function runScript({ cancel = false } = {}) {
  return `(async () => {
    ${WAIT}
    const SigK = window.SigK;
    const started = Date.now();
    const pending = SigK.toolsSplit.run();
    await wait(250);
    const dialogOpen = SigK.confirmReplace.isOpen();
    const focusOnCancel = document.activeElement === document.getElementById('confirm-replace-cancel');
    if (dialogOpen)
      document.getElementById('confirm-replace-ok').click();
    let canceledAt = null;
    if (${cancel === true}) {
      await wait(400);
      const action = document.querySelector('#view-banner .banner-action');
      if (action && action.textContent === '中止') { action.click(); canceledAt = Date.now() - started; }
    }
    const result = await pending;
    const ms = Date.now() - started;
    await wait(300);
    return {
      dialogOpen, focusOnCancel,
      ok: result ? result.ok === true : false,
      canceled: result ? result.canceled === true : false,
      canceledAt,
      banner: SigK.viewBanner.text(),
      bannerAction: SigK.viewBanner.action() ? SigK.viewBanner.action().textContent : null,
      error: result ? (result.error ?? null) : 'result が無い',
      written: result ? (result.written ?? null) : null,
      tabs: SigK.tabs.count(),
      mode: document.documentElement.getAttribute('data-mode'),
      ms,
    };
  })()`;
}

module.exports = { setupScript, runScript };
