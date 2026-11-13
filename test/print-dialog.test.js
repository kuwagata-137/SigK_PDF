'use strict';

// 印刷画面の操作（docs/spec-7-7-print-dialog.md・決定94）。Acrobat Reader の［印刷］ダイアログと同じ構成の画面で、
// ページサイズ処理の切り替え・向き・両面・プリンターの既定・［プロパティ(P)］・注釈の一覧(T)・ページ設定・アクセスキー・プレビューの文字を見る。
// 画素（プレビューの絵）は起動確認で見る。プリンター名は試験用の架空の名前（test/harness.js）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, TEST_PRINTER_CONFIG } = require('./harness.js');

async function withPrint(t, options = {}) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  await shell.SigK.viewer.open(makeSource());
  await shell.flush();
  assert.equal(shell.SigK.print.open(), true);
  await shell.SigK.print.whenConfigReady();
  const $ = (id) => shell.document.getElementById(id);
  const click = (id) => $(id).click();
  const change = (id, value) => {
    $(id).value = String(value);
    $(id).dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  };
  return { shell, $, click, change };
}

const shown = (node) => node.hidden !== true && node.closest('[hidden]') === null;

test('ページサイズ処理のボタンで、下の中身（サイズ・ポスター・複数・小冊子）が切り替わる', async (t) => {
  const { $, click } = await withPrint(t);
  assert.equal($('print-handling-size').getAttribute('aria-pressed'), 'true');
  assert.equal(shown($('print-panel-size')), true);
  for (const handling of ['poster', 'multiple', 'booklet', 'size']) {
    click(`print-handling-${handling}`);
    for (const other of ['size', 'poster', 'multiple', 'booklet']) {
      assert.equal($(`print-handling-${other}`).getAttribute('aria-pressed'), String(other === handling), `${handling}: ${other}`);
      assert.equal(shown($(`print-panel-${other}`)), other === handling, `${handling}: ${other}`);
    }
  }
});

test('向き: サイズは 自動・縦・横、ほかは 縦・横 と「各シート内でページを自動回転(W)」（ユーザーの画面写真 2）', async (t) => {
  const { $, click } = await withPrint(t);
  assert.equal(shown($('print-orient-auto-label')), true);
  assert.equal($('print-orient-auto').checked, true);
  assert.equal(shown($('print-autorotate-row')), false);
  click('print-handling-poster');
  assert.equal(shown($('print-orient-auto-label')), false);
  assert.equal($('print-orient-portrait').checked, true, '自動は縦にする');
  assert.equal(shown($('print-autorotate-row')), true);
});

test('複数: 決まった数では Acrobat と同じく用紙の向きを選び、列と行は灰色で表示する。カスタムで列と行を入力できる', async (t) => {
  const { $, click, change } = await withPrint(t);
  click('print-handling-multiple');
  // A4 の縦のページを 1 枚に 2 ページなら、横の用紙に 2 列 1 行。
  assert.equal($('print-orient-landscape').checked, true);
  assert.deepEqual([$('print-multi-cols').value, $('print-multi-rows').value], ['2', '1']);
  assert.equal($('print-multi-cols').disabled, true);
  change('print-multi-count', '4');
  assert.equal($('print-orient-portrait').checked, true);
  assert.deepEqual([$('print-multi-cols').value, $('print-multi-rows').value], ['2', '2']);
  change('print-multi-count', 'custom');
  assert.equal($('print-multi-cols').disabled, false);
  change('print-multi-cols', '３');
  assert.equal($('print-multi-cols').value, '3', '全角の数字も受け付ける');
});

test('小冊子: 偶数または奇数ページ・逆順に印刷は灰色。両面は小冊子の印刷方法で決まり、綴じる辺の選択は表示しない', async (t) => {
  const { $, click, change } = await withPrint(t);
  click('print-handling-booklet');
  assert.equal($('print-parity').disabled, true);
  assert.equal($('print-reverse').disabled, true);
  assert.equal($('print-duplex').disabled, true);
  assert.equal($('print-duplex').checked, true);
  assert.equal(shown($('print-flip-row')), false);
  assert.equal($('print-booklet-to').value, '1', '3 ページは紙 1 枚');
  change('print-booklet-method', 'front');
  assert.equal($('print-duplex').checked, false);
});

test('用紙の両面に印刷(B) をオンにすると、長辺を綴じる・短辺を綴じるを選べ、印刷に渡る', async (t) => {
  const { shell, $, click } = await withPrint(t);
  assert.equal(shown($('print-flip-row')), false);
  click('print-duplex');
  assert.equal(shown($('print-flip-row')), true);
  assert.equal($('print-flip-long').checked, true);
  click('print-flip-short');
  await shell.SigK.print.run({ mode: 'current' });
  assert.equal(shell.printCalls[0].duplexMode, 'shortEdge');
});

test('両面に対応していないプリンターでは、用紙の両面に印刷(B) を表示しない（Acrobat と同じ）', async (t) => {
  const config = { ...TEST_PRINTER_CONFIG, duplex: { supported: false, mode: 'simplex' } };
  const { $ } = await withPrint(t, { printerConfigs: { 試験用プリンター: config } });
  assert.equal(shown($('print-duplex-row')), false);
});

test('グレースケールと両面の初期値は、選んだプリンターの Windows の設定に従う（確定事項C3）', async (t) => {
  const config = { ...TEST_PRINTER_CONFIG, color: { supported: true, value: false }, duplex: { supported: true, mode: 'longEdge' } };
  const { shell, $ } = await withPrint(t, { printerConfigs: { 試験用プリンター: config } });
  assert.equal($('print-gray').checked, true);
  assert.equal($('print-duplex').checked, true);
  await shell.SigK.print.run({ mode: 'current' });
  assert.equal(shell.printCalls[0].color, false);
  assert.equal(shell.printCalls[0].duplexMode, 'longEdge');
});

test('プリンターを替えると、そのプリンターの設定を取得し直し、そのプリンターへ送る', async (t) => {
  const a3 = { ...TEST_PRINTER_CONFIG, paper: { id: 'psk:ISOA3', name: 'A3', width: 297000, height: 420000 } };
  const { shell, change } = await withPrint(t, { printerConfigs: { 試験用プリンター2: a3 } });
  change('print-printer', '試験用プリンター2');
  await shell.SigK.print.whenConfigReady();
  shell.SigK.print.refreshPreview(false);
  assert.equal(shell.document.getElementById('print-preview-size').textContent, '297.00 x 420.00 ミリ');
  await shell.SigK.print.run({ mode: 'current' });
  assert.equal(shell.printCalls[0].deviceName, '試験用プリンター2');
  assert.equal('pageSize' in shell.printCalls[0], false, 'プリンターの既定の用紙（A3）なので用紙は指定しない');
});

test('［プロパティ(P)］は印刷設定の画面を開き、閉じたら取得し直した既定の値に合わせる（質問 PR1 案A）', async (t) => {
  const { shell, $, click } = await withPrint(t);
  assert.equal($('print-duplex').checked, false);
  shell.window.printAPI.openPreferences = async (name) => {
    shell.preferenceCalls.push(name);
    return { ok: true, config: { ...TEST_PRINTER_CONFIG, duplex: { supported: true, mode: 'longEdge' } } };
  };
  click('print-props');
  await shell.flush();
  assert.deepEqual([...shell.preferenceCalls], ['試験用プリンター']);
  assert.equal($('print-duplex').checked, true);
});

test('注釈の一覧(T) は確認画面を表示し、［はい(Y)］で一覧ページを入れる。［いいえ(N)］で入れない', async (t) => {
  const { shell, $, click } = await withPrint(t);
  click('print-summary');
  assert.equal($('print-summary-confirm').hasAttribute('open'), true);
  assert.equal($('print-summary-text').textContent, '印刷する文書に注釈の一覧テキストを含めますか？');
  click('print-summary-yes');
  await shell.flush();
  assert.equal($('print-summary-confirm').hasAttribute('open'), false);
  assert.equal($('print-summary').getAttribute('aria-pressed'), 'true');
  click('print-summary');
  click('print-summary-no');
  await shell.flush();
  assert.equal($('print-summary').getAttribute('aria-pressed'), 'false');
});

test('［ページ設定(S)...］でサイズを A3 にすると、A3 の用紙を指定して送る（質問 PR3 ②）', async (t) => {
  const { shell, $, click, change } = await withPrint(t);
  click('print-setup');
  assert.equal($('print-setup-dialog').hasAttribute('open'), true);
  assert.deepEqual([...$('print-setup-size').options].map((option) => option.textContent), ['A4', 'A3', 'A5']);
  assert.equal($('print-setup-size').value, 'psk:ISOA4');
  assert.equal($('print-setup-source').disabled, true, '給紙方法は自動選択だけ');
  change('print-setup-size', 'psk:ISOA3');
  click('print-setup-ok');
  await shell.flush();
  await shell.SigK.print.run({ mode: 'current' });
  assert.deepEqual({ ...shell.printCalls[0].pageSize }, { width: 297000, height: 420000 });
});

test('アクセスキー: Alt＋P で［プロパティ(P)］、Alt＋G でページ指定。ページ指定の欄で Enter を押すと印刷する', async (t) => {
  const { shell, $ } = await withPrint(t);
  const key = (target, init) => target.dispatchEvent(new shell.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  key($('print-dialog'), { key: 'p', altKey: true });
  await shell.flush();
  assert.deepEqual([...shell.preferenceCalls], ['試験用プリンター']);
  key($('print-dialog'), { key: 'g', altKey: true });
  assert.equal($('print-range-custom').checked, true);
  assert.equal($('print-pages').disabled, false);
  assert.equal($('print-pages').value, '1 - 3');
  $('print-pages').value = '2';
  $('print-pages').dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  key($('print-pages'), { key: 'Enter' });
  for (let i = 0; i < 20 && shell.printCalls.length === 0; i += 1)
    await shell.flush();
  assert.equal(shell.printCalls.length, 1);
});

test('プレビュー: サイズでは倍率・用紙の寸法・n / m ページ、複数では倍率を表示せず「(最初のページ番号)」を足す', async (t) => {
  const { shell, $, click } = await withPrint(t);
  shell.SigK.print.refreshPreview(false);
  assert.equal($('print-preview-scale').textContent, '倍率 : 95%');
  assert.equal($('print-preview-size').textContent, '210.00 x 297.00 ミリ');
  assert.equal($('print-preview-count').textContent, '1 / 3 ページ');
  click('print-handling-multiple');
  shell.SigK.print.refreshPreview(false);
  assert.equal($('print-preview-scale').textContent, '');
  assert.equal($('print-preview-size').textContent, '297.00 x 210.00 ミリ');
  assert.equal($('print-preview-count').textContent, '1 / 2 ページ (1)');
  click('print-preview-next');
  assert.equal($('print-preview-count').textContent, '2 / 2 ページ (3)');
});

test('詳細オプションを開くと、現在の表示範囲(V)・偶数または奇数ページ・逆順に印刷(E) を表示する', async (t) => {
  const { shell, $, click, change } = await withPrint(t);
  assert.equal(shown($('print-more-body')), false);
  click('print-more');
  assert.equal($('print-more').getAttribute('aria-expanded'), 'true');
  assert.equal(shown($('print-more-body')), true);
  change('print-parity', 'odd');
  click('print-reverse');
  const result = await shell.SigK.print.prepare();
  assert.deepEqual([...result.pages], [3, 1]);
});

test('部数の上下の矢印で 1〜999 の範囲を増減する', async (t) => {
  const { $, click } = await withPrint(t);
  click('print-copies-down');
  assert.equal($('print-copies').value, '1');
  click('print-copies-up');
  click('print-copies-up');
  assert.equal($('print-copies').value, '3');
});

test('ヘルプ(H) は印刷画面を閉じ、使い方画面の「閲覧・検索・印刷」の節を開く（質問 PR3 ⑤）', async (t) => {
  const { shell, $, click } = await withPrint(t);
  click('print-help');
  assert.equal($('print-dialog').hasAttribute('open'), false);
  assert.equal($('help-dialog').hasAttribute('open'), true);
  assert.equal(shell.SigK.helpDialog.current(shell.document), 'view');
});

test('詳細設定(D) は押せない状態で表示する（質問 PR3 ①）', async (t) => {
  const { $ } = await withPrint(t);
  assert.equal($('print-advanced').disabled, true);
});
