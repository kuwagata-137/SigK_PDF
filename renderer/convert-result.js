(function (root) {
  'use strict';

  // 画像→PDF の変換のあと（spec-2-5 確定事項H3・H11〜H13。決定80 ㊱。見本 screenshots/strips3-converted.png）。
  //
  // できた PDF は新しい帯（タブ）として PDF の帯の末尾に足して選ぶ（画像の帯は消えない）。「画像ごと」でできた PDF は帯の上限（20）まで
  // 足して最後の 1 本を選び、入りきらない分は開かずに知らせる。右の欄の上に「できた PDF」のカード（#convert-result）を出し、
  // ［ほかの帯と結合する］［分割する］でそのツールへ移れる。カードは、画像の帯の中身・用紙・出力を変えたとき（tools-convert.js の
  // revision が進む）・次の変換を始めたとき・できた帯がすべて閉じられたときに消す（H12）。

  const state = { paths: [], revision: -1 };
  let el = null;

  const banner = () => root.SigK.viewBanner;
  const tabs = () => root.SigK.tabs;
  const convert = () => root.SigK.toolsConvert;
  const baseName = (filePath) => String(filePath ?? '').split(/[\\/]/).pop();
  const folderAction = (target) => ({ label: 'フォルダを開く', onClick: () => root.shellAPI?.showInFolder?.(target) });

  // 中止までに書き終えた本数（「画像ごと」。spec-3-1 確定事項24）。出力先の有無ではなく、ワーカーの進捗（write の done）で数える。
  function writtenBeforeCancel() {
    const progress = root.SigK.save?.lastProgress?.() ?? null;
    return progress?.phase === 'write' && Number.isInteger(progress.done) ? progress.done : 0;
  }

  // 中止・失敗なら帯で知らせて true（自分で止めたときは赤く塗らない。決定49）。
  function stopped(result, { each = false } = {}) {
    if (result?.canceled === true) {
      const written = each ? writtenBeforeCancel() : 0;
      banner().show(written > 0 ? `変換を中止しましたが、${written} ファイルは書き出し済みです。` : '変換を中止しました。', { tone: 'info' });
      return true;
    }
    if (result?.ok === true)
      return false;
    banner().show(result?.error ?? '変換できませんでした。');
    return true;
  }

  // 知らせの文（H13）。skipped は帯の上限で開かなかった本数。ここから先は書けているので、開けなかったときも赤く塗らない（決定48）。
  // 開くのに失敗した帯の理由は tabs.js が先に出すが、書けたことは伝えたいので、この知らせで置き換える。
  function announce(targets, opened, skipped) {
    const total = targets.length;
    const max = tabs().MAX_TABS;
    const folder = { autoHideMs: 0, tone: 'info', action: folderAction(targets[0]) };
    const made = total === 1 ? `画像を PDF にして「${baseName(targets[0])}」を作りました` : `画像を ${total} 個の PDF にしました`;
    // 1 つで帯が上限のときは、結合と同じく最近使ったファイルに載せるだけにする（tool-output.js）。
    if (skipped > 0 && opened.length === 0)
      banner().show(`${made}が、帯が ${max} 本を超えるので開いていません。`, total === 1 ? { tone: 'info' } : folder);
    else if (skipped > 0)
      banner().show(`画像を ${total} 個の PDF にして、帯を ${opened.length} 本足しました。残りの ${skipped} 個は、帯が ${max} 本を超えるので開いていません。`, folder);
    else if (opened.length === 0)
      banner().show(`${made}。`, folder);
    else if (total === 1)
      banner().show(`画像を PDF にして、「${baseName(targets[0])}」の帯を足しました。`, { autoHideMs: 2500, tone: 'info' });
    else
      banner().show(`画像を ${total} 個の PDF にして、帯を足しました。`, folder);
  }

  // 帯の上限まで 1 本ずつ開く（開いた帯が前に出るので、最後の 1 本が選ばれる。H11）。{ opened, skipped }。
  async function openStrips(targets) {
    const opened = [];
    let skipped = 0;
    for (const target of targets) {
      if (tabs().count() >= tabs().MAX_TABS && tabs().findByPath(target) === null) {
        skipped += 1;
        continue;
      }
      if (await tabs().openPath(target))
        opened.push(target);
    }
    // 上限で開かなかった 1 本は、最近使ったファイルに載せて後から開けるようにする（結合と同じ。tool-output.js）。
    if (skipped === 1 && targets.length === 1)
      await root.recentAPI?.add?.({ path: targets[0], name: baseName(targets[0]), openedAt: new Date().toISOString() });
    return { opened, skipped };
  }

  // 書けたあとの始末。結果を返す（tools-convert.js の run がそのまま返す）。
  async function finish(result, targets, { each = false } = {}) {
    if (stopped(result, { each }))
      return result ?? { error: '変換できませんでした。' };
    const { opened, skipped } = await openStrips(targets);
    root.SigK.imageStrip?.deselect();   // 足した帯を選ぶ（H7）
    announce(targets, opened, skipped);
    state.paths = opened;
    state.revision = convert().revision();
    render();
    return result;
  }

  function clear() {
    state.paths = [];
    return render();
  }

  // まだ開いているできた帯（タブ）。帯の画面の番号（1 始まり）も添える。
  function liveStrips() {
    if (state.revision !== convert().revision())
      return [];
    const list = tabs().list();
    return state.paths
      .map((filePath) => ({ path: filePath, no: list.findIndex((tab) => tab.id === tabs().findByPath(filePath)?.id) + 1 }))
      .filter((entry) => entry.no > 0);
  }

  function numbersText(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const contiguous = sorted.every((no, index) => index === 0 || no === sorted[index - 1] + 1);
    if (sorted.length === 1)
      return `${sorted[0]} 番`;
    return contiguous ? `${sorted[0]}〜${sorted.at(-1)} 番` : `${sorted.join('・')} 番`;
  }

  function render() {
    if (el === null)
      return false;
    const live = liveStrips();
    el.card.hidden = live.length === 0;
    if (live.length === 0)
      return false;
    const single = state.paths.length === 1;
    el.title.textContent = single ? `できた PDF（${baseName(live[0].path)}）` : `できた PDF（${live.length} 個）`;
    el.desc.textContent = `新しい帯（${numbersText(live.map((entry) => entry.no))}）として足しました。続けて使うツールを選べます。`;
    el.mergeText.textContent = single ? 'この PDF をほかの帯と結合する' : 'できた PDF をほかの帯と結合する';
    el.splitText.textContent = single ? 'この PDF を分割する' : '最後にできた PDF を分割する';
    return true;
  }

  const locked = () => convert().isRunning() || root.SigK.save?.isBusy() === true;

  // ［結合する］は結合へ移るだけ（新しい帯は既定でチェックが入る。ほかの帯のチェックもそのまま。決定80 ㊱・E2）。
  function goMerge() {
    if (locked() || liveStrips().length === 0)
      return false;
    return root.SigK.tools.select('merge');
  }

  // ［分割する］は最後にできた PDF の帯を選んで分割へ移る（その帯が ✂ の盤に広がる。G1）。
  function goSplit() {
    const last = liveStrips().at(-1);
    if (locked() || last === undefined)
      return false;
    tabs().activate(tabs().findByPath(last.path).id);
    return root.SigK.tools.select('split');
  }

  function init(doc, win) {
    if (win.__sigkConvertResultReady === true)
      return false;
    const card = doc.getElementById('convert-result');
    if (card === null)
      return false;
    win.__sigkConvertResultReady = true;
    const byId = (id) => doc.getElementById(id);
    el = {
      card, title: byId('convert-result-title'), desc: byId('convert-result-desc'),
      mergeText: byId('convert-result-merge').querySelector('.t'), splitText: byId('convert-result-split').querySelector('.t'),
    };
    byId('convert-result-merge').addEventListener('click', goMerge);
    byId('convert-result-split').addEventListener('click', goSplit);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.convertResult = { init, render, finish, clear, goMerge, goSplit, paths: () => liveStrips().map((entry) => entry.path) };
})(typeof window !== 'undefined' ? window : globalThis);
