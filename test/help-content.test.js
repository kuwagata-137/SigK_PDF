'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/help-content-edit.js');
require('../renderer/help-content-tools.js');
require('../renderer/help-content.js');
const content = globalThis.SigK.helpContent;

// 使い方の窓の中身（spec-4b-7b 確定事項D・付録）。編集モードの 7 節は help-content-edit.test.js が見る。

// 中身の文を全部集める（題・導入・見出し・箇条書き・表のセル）。
function textsOf(section) {
  const texts = [section.title, section.lead ?? ''];
  for (const block of section.blocks)
    texts.push(block.h ?? '', ...(block.items ?? []), ...(block.table ?? []).flat());
  return texts;
}

function sectionOf(id) {
  return content.SECTIONS.find((section) => section.id === id);
}

function joined(id) {
  return textsOf(sectionOf(id)).join('\n');
}

const KEY_NAMES = new Set(['Ctrl', 'Shift', 'Esc', 'Enter', 'Delete', 'Backspace', 'Tab', 'PageUp', 'PageDown', 'Home', 'End',
  'F1', 'F3', 'A', 'C', 'F', 'I', 'O', 'P', 'S', 'W', 'Y', 'Z', '0', '+', '-', 'Space', '←', '→', '↑', '↓']);

test('目次は 5 つのグループと 14 の節で、グループの順に並ぶ', () => {
  assert.equal(content.TITLE, 'SigK PDF の使い方');
  assert.deepEqual(content.GROUPS.map((group) => group.label), ['はじめに', '閲覧・ページ編集', '編集（書き込み）', 'ツール', '一覧']);
  assert.deepEqual(content.SECTIONS.map((section) => section.id), [
    'basics', 'view', 'pages', 'select', 'markup', 'text', 'shapes', 'pen', 'note', 'mosaic-trim', 'tools', 'split', 'keys', 'escape',
  ]);
  const groupIds = content.GROUPS.map((group) => group.id);
  const order = content.SECTIONS.map((section) => groupIds.indexOf(section.group));
  assert.ok(order.every((index) => index >= 0), 'どのグループにも入らない節がある');
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('どの節にも題と中身があり、表の行は列の数がそろう', () => {
  for (const section of content.SECTIONS) {
    assert.ok(section.title.length > 0, section.id);
    assert.ok(section.blocks.length > 0, section.id);
    for (const block of section.blocks) {
      assert.ok(block.items !== undefined || block.table !== undefined, `${section.id} に中身の無い見出しがある`);
      for (const row of block.table ?? [])
        assert.equal(row.length, block.table[0].length, `${section.id} の表の行: ${row[0]}`);
    }
  }
});

test('キーの書き方 [キー] は閉じていて、決めた名前だけを使う', () => {
  for (const section of content.SECTIONS) {
    for (const text of textsOf(section)) {
      const rest = text.replace(/\[([^[\]]+)\]/g, (_whole, name) => {
        assert.ok(KEY_NAMES.has(name), `${section.id} に知らないキーがある: ${name}`);
        return '';
      });
      assert.ok(!/[[\]]/.test(rest), `${section.id} の [ ] が閉じていない: ${text}`);
      // 要素にしたい文字を混ぜない（help-render.js は textContent で組むので、混ぜてもそのまま文字で出る）。
      assert.ok(!/[<>]/.test(text), `${section.id} に < > がある: ${text}`);
    }
  }
});

test('計画外の直しのあとの動きで書いてある', () => {
  // ① Ctrl＋クリック・Shift＋クリックで複数のページを選べる。
  assert.match(joined('pages'), /\[Ctrl\] を押しながらクリックすると 1 枚ずつ足す・外す/);
  // ② 閉じた左のパネルは「＞」で開く。
  assert.match(joined('basics'), /「＞」で開きます/);
  // ⑥ どのモードで開いてもタブで開き、モードは変えない。ツールモードではツールの画面にも入る（決定80。2026-10-08 の
  // 「ツールモードで開くと閲覧モードへ移る」を改めた）。
  assert.match(joined('basics'), /どのモードで開いても、ファイルはタブで開き、モードはそのままです/);
  assert.match(joined('basics'), /ツールモードで開いたときは、選んでいるツールの画面にも入ります/);
  for (const id of ['basics', 'tools'])
    assert.doesNotMatch(joined(id), /閲覧モードへ移ります/, id);
  // ④⑤ Ctrl+Shift+Z はやり直し。文字を打つ欄の中では欄の文字を戻す。
  const keys = content.SECTIONS.find((section) => section.id === 'keys').blocks[0].table;
  const redo = keys.find((row) => row[0].includes('[Ctrl]+[Shift]+[Z]'));
  assert.equal(redo[1], 'やり直し');
  assert.match(keys.find((row) => row[0] === '[Ctrl]+[Z]')[2], /文字を打つ欄の中では、欄の文字を戻す/);
});

test('キー操作の表に F1 があり、Esc の順は 10 段で窓が先頭', () => {
  const keys = sectionOf('keys').blocks[0].table;
  assert.deepEqual(keys.find((row) => row[0] === '[F1]'), ['[F1]', 'この使い方を開く', 'いつでも']);
  const order = sectionOf('escape').blocks[0].table.slice(1);
  assert.deepEqual(order.map((row) => row[0]), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.match(order[0][1], /^窓/);
  assert.match(order[9][1], /^道具を外す/);
});

test('倍率の段は、表示の倍率の段（viewer-layout.js の ZOOM_STEPS）と同じ', () => {
  require('../renderer/viewer-layout.js');
  const steps = globalThis.SigK.viewerLayout.ZOOM_STEPS.map((zoom) => Math.round(zoom * 100)).join('・');
  assert.ok(joined('view').includes(`段は ${steps}% です`), steps);
});

// 点検（文面とコードの突き合わせ）で直した所。コードの値と比べられるものは比べる。
test('元に戻せる回数は、履歴の世代の数（今の状態を含む）から 1 を引いた数', () => {
  require('../renderer/edit-history.js');
  const times = globalThis.SigK.editHistory.MAX_HISTORY - 1;
  assert.ok(joined('basics').includes(`合わせて ${times} 回まで戻せます`), String(times));
});

test('分割は「分割」の節で説明し、ツールのボタン名は画面と同じ（spec-2-2b 確定事項G4）', () => {
  const tools = joined('tools');
  assert.match(tools, /使い方は次の「分割」の節にあります/);
  assert.doesNotMatch(tools, /N ページごと|範囲（例 1-3, 8）/, '無くなった分け方を書かない');
  assert.match(tools, /［実行…］を押すと始まります/);
  const split = joined('split');
  for (const button of ['［開いているタブから選ぶ］', '［前のファイルとつなげる］', '［1 ページずつに分ける］', '［ページごとに分ける］', '［ページの前で切る］',
    '［分け目をすべて消す］', '［この範囲を 1 つのファイルにする］', '［書き出さない］', '［書き出す］', '［元に戻す］', '［やり直す］', '［実行…］'])
    assert.ok(split.includes(button), button);
  // 結合・PDF→画像・透かし・フラット化は帯の画面へ移った（spec-2-5 第 D・E 章）。［開いているタブから選ぶ］は分割だけ。
  assert.match(tools, /分割は、［開いているタブから選ぶ］か［ファイルを選ぶ…］で選ぶか/);
  assert.doesNotMatch(tools, /まとめて追加/);
});

test('ツールモードで開く・保存するときの動きで書いてある（決定80）', () => {
  // 落とした PDF はタブでも開き、画像はほかのツールからでも画像→PDF へ切り替わる（tool-handoff.js）。
  assert.match(joined('tools'), /選んだ PDF と落とした PDF は、タブでも開きます/);
  assert.match(joined('tools'), /画像を落とすと、画像→PDF に切り替わります/);
  assert.match(joined('tools'), /できたファイルを新しいタブ（帯）で開きます（ツールモードのままです）/);
  // 帯の画面と、保存していない帯の確認の窓（spec-2-5 第 D・F 章。決定80 ㉜）。用語は「帯」「書き込み」「焼き込み」にそろえる。
  assert.match(joined('tools'), /［上書き保存してから実行］［保存せずに実行］［キャンセル］/);
  assert.match(joined('tools'), /このときタブの列は出ません/);
  assert.match(joined('tools'), /ページの内容として焼き込み/);
  assert.doesNotMatch(joined('tools'), /紙に焼き込/);
  // 保存はツールモードでも効く（save.js。spec-2-1 確定事項4・5 を改めた）。
  assert.match(joined('basics'), /どのモードでも、保存するのはタブの列で選んでいるタブ（ツールモードで帯が並んでいるときは、選んでいる帯）です/);
  const keys = sectionOf('keys').blocks[0].table;
  assert.equal(keys.find((row) => row[0] === '[Ctrl]+[S] / [Ctrl]+[Shift]+[S]')[2], '文書を開いているとき');
});

test('Esc の例は、持っている道具と選んでいる書き込みを書き分ける', () => {
  assert.match(joined('escape'), /［四角］の道具を持ち、描いた四角が選ばれていて/);
});

test('既定のアプリの入口を、メニューと同じ名前で案内する（spec-5-2 確定事項C3）', () => {
  const mainJs = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainJs, /label: '既定のアプリの設定…'/);
  assert.match(joined('basics'), /メニュー「ヘルプ」→「既定のアプリの設定…」で Windows の設定を開き、SigK PDF を選びます/);
  assert.match(joined('basics'), /「プログラムから開く」から選ぶこともできます/);
});

// 閲覧の［選択］［ハンド］（spec-2-5 確定事項K。2026-10-14）。閲覧の節に節を立て、マウスの表と Esc の順にも閲覧・ページ編集を書く。
test('閲覧の節に［選択］［ハンド］の節があり、マウスの表と Esc の順が閲覧・ページ編集のハンドを含む', () => {
  const block = sectionOf('view').blocks.find((b) => b.h === '選択とハンド');
  assert.notEqual(block, undefined, '閲覧の節に「選択とハンド」が無い');
  const text = block.items.join('\n');
  for (const part of ['［選択］', '［ハンド］', '左ボタンを押したまま右クリック', 'ツールモードでは使えません', '次に起動したときも続きます'])
    assert.ok(text.includes(part), part);
  const mouse = sectionOf('keys').blocks.find((b) => b.h === 'マウス').table;
  assert.deepEqual(mouse.find((row) => row[0] === 'ホイール（ハンドのとき）'), ['ホイール（ハンドのとき）', '拡大・縮小', '閲覧・ページ編集・編集']);
  assert.equal(mouse.find((row) => row[0] === '左ボタンを押したまま右クリック')[2], '閲覧・ページ編集・編集');
  assert.match(sectionOf('escape').blocks[0].table.at(-1)[1], /閲覧・ページ編集では、ハンドを選択に戻す/);
});
