'use strict';

// 印刷画面と小さな画面を、Acrobat の画面写真 3-01〜3-14（2026-11-13 にユーザーから受け取ったもの）に合わせた点（docs/spec-7-7-print-dialog.md）。
// 詳細オプションの並び・選択肢の文言と順番・ポスターの片面・ⓘ を押すと開く説明の画面・進行状況画面の文言・インク / トナーを節約の濃さを見る。
// 画面の寸法と位置は起動確認の画面写真で見る（jsdom には配置の計算が無い）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

async function withPrint(t) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  await shell.SigK.viewer.open(makeSource());
  await shell.flush();
  assert.equal(shell.SigK.print.open(), true);
  await shell.SigK.print.whenConfigReady();
  const $ = (id) => shell.document.getElementById(id);
  const texts = (id) => [...$(id).options].map((option) => option.textContent);
  return { shell, $, texts };
}

const isOpen = (dialog) => dialog.hasAttribute('open');

test('詳細オプション: 1 行目に 現在の表示範囲(V) と 逆順に印刷(E)、2 行目に 偶数または奇数ページ（画面写真 3-01）', async (t) => {
  const { $ } = await withPrint(t);
  const rows = [...$('print-more-body').children];
  assert.equal(rows.length, 2);
  assert.ok(rows[0].contains($('print-range-view')) && rows[0].contains($('print-reverse')));
  assert.ok(rows[1].contains($('print-parity')));
  assert.equal(rows[1].querySelector('label').textContent, '偶数または奇数ページ :');
});

test('選択肢の文言と順番は Acrobat と同じ（画面写真 3-04・3-05・3-06・3-07・3-09）', async (t) => {
  const { $, texts } = await withPrint(t);
  assert.deepEqual(texts('print-multi-count'), ['2', '4', '6', '9', '16', 'カスタム...']);
  assert.deepEqual(texts('print-booklet-binding'), ['左', '右', '縦長左', '縦長右']);
  assert.deepEqual(texts('print-booklet-method'), ['両面で印刷', '片面で印刷 (表側)', '片面で印刷 (裏側)']);
  assert.deepEqual(texts('print-multi-order'), ['横', '横 (右から左)', '縦', '縦 (右から左)']);
  assert.deepEqual(texts('print-comments'), ['文書', '文書と注釈', '文書とスタンプ', 'フォームフィールドのみ']);
  assert.equal($('print-comments').value, 'markups', '初めは 文書と注釈');
  assert.equal($('print-booklet-from').labels[0].textContent, '開始ページ', 'コロンを付けない（画面写真 3-03）');
  assert.equal($('print-booklet-to').labels[0].textContent, '終了ページ');
  assert.equal($('print-flip-long').closest('label').textContent, '長辺を綴じる(L)', '画面写真 3-08');
});

test('ポスター: 用紙の両面に印刷(B) の行は表示せず、両面がオンでも片面で送る（画面写真 3-02）', async (t) => {
  const { shell, $ } = await withPrint(t);
  $('print-duplex').click();
  assert.equal($('print-duplex').checked, true);
  $('print-handling-poster').click();
  assert.equal($('print-duplex-row').hidden, true);
  assert.equal($('print-flip-row').hidden, true);
  await shell.SigK.print.run({ mode: 'current' });
  assert.equal(shell.printCalls.length > 0, true);
  assert.equal(shell.printCalls.every((call) => call.duplexMode === 'simplex'), true);
});

test('ⓘ を押すと説明の画面を開き、［閉じる］で閉じて ⓘ にフォーカスを戻す。ⓘ で Enter を押しても印刷しない（画面写真 3-12・3-13）', async (t) => {
  const { shell, $ } = await withPrint(t);
  $('print-handling-info').click();
  assert.equal(isOpen($('print-handling-info-dialog')), true);
  assert.equal($('print-handling-info-title').textContent, 'ページサイズ処理');
  assert.match($('print-handling-info-dialog').textContent, /ページサイズと処理の情報 :/);
  $('print-handling-info-close').click();
  assert.equal(isOpen($('print-handling-info-dialog')), false);
  assert.equal(shell.document.activeElement?.id, 'print-handling-info');
  $('print-ink-info').focus();
  $('print-ink-info').dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await shell.flush();
  assert.equal(isOpen($('print-ink-info-dialog')), true);
  assert.equal($('print-ink-info-title').textContent, 'トナー節約情報 :');
  assert.match($('print-ink-info-dialog').textContent, /トナーを最大 15% 節約できます/);
  assert.equal(shell.printCalls.length, 0, 'Enter で［印刷］を押さない');
  $('print-ink-info-close').click();
  assert.equal(isOpen($('print-ink-info-dialog')), false);
  assert.equal($('print-ink-info').hasAttribute('data-tip'), false, 'ツールチップは表示しない');
});

test('進行状況画面: 題名は「進行状況」、文言は「準備中 : 0%」から始まる（画面写真 3-14）。注釈の一覧の確認に［×］は無い（3-10）', async (t) => {
  const { shell, $ } = await withPrint(t);
  assert.equal($('print-progress-title').textContent, '進行状況');
  shell.SigK.printProgress.show(() => {});
  assert.equal($('print-progress-text').textContent, '準備中 : 0%');
  shell.SigK.printProgress.preparing(0.5);
  assert.equal($('print-progress-text').textContent, '準備中 : 50%');
  shell.SigK.printProgress.hide();
  assert.equal($('print-summary-confirm').querySelector('.pd-x'), null);
});

test('インク / トナーを節約の濃さは 85%（質問 PR5「15% 節約」。説明の画面の「最大 15%」と同じ）', async (t) => {
  const { shell } = await withPrint(t);
  assert.equal(shell.SigK.printSheetRender.INK_SAVE_DENSITY, 0.85);
});
