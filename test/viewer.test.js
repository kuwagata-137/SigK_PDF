'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, DEFAULT_VIEWPORT, A4 } = require('./harness.js');

const A5 = { width: 419.53, height: 595.28 };

function source(overrides = {}) {
  return {
    ok: true,
    path: 'C:\\書類\\three-pages.pdf',
    name: 'three-pages.pdf',
    size: 1463,
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    ...overrides,
  };
}

async function withShell(t, options) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  return shell;
}

async function withOpenDocument(t, options = {}) {
  const shell = await withShell(t, options);
  await shell.SigK.viewer.open(source());
  await shell.flush();
  return shell;
}

test('起動直後は文書なしで、文書に要る操作は押せない', async (t) => {
  const { document, SigK } = await withShell(t);

  assert.equal(document.documentElement.getAttribute('data-doc'), 'empty');
  assert.equal(document.getElementById('view-message').textContent, SigK.viewer.EMPTY_MESSAGE);
  assert.equal(SigK.viewer.getState().open, false);

  for (const id of SigK.viewerControls.DOCUMENT_CONTROLS)
    assert.equal(document.getElementById(id).getAttribute('aria-disabled'), 'true', `#${id} が押せてしまう`);
  // 開くボタンだけは常に押せる。
  assert.equal(document.getElementById('btn-open').hasAttribute('aria-disabled'), false);
});

test('文書を開くとページの枠がページ数どおり並ぶ', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const state = SigK.viewer.getState();

  assert.equal(state.open, true);
  assert.equal(state.pageCount, 3);
  assert.equal(document.querySelectorAll('.pdf-page').length, 3);
  assert.equal(document.documentElement.getAttribute('data-doc'), 'open');
  assert.equal(document.getElementById('view-empty').hidden, true);
  assert.equal(document.getElementById('view-pages').hidden, false);
});

test('ページの枠は計算どおりの位置と大きさを持つ', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const { zoom } = SigK.viewer.getState();
  const expected = SigK.viewerLayout.layoutPages({ sizes: [A4, A4, A4], zoom });
  const nodes = [...document.querySelectorAll('.pdf-page')];

  for (const page of expected.pages) {
    assert.equal(nodes[page.index].style.top, `${page.top}px`);
    assert.equal(nodes[page.index].style.width, `${page.width}px`);
    assert.equal(nodes[page.index].style.height, `${page.height}px`);
  }
  assert.equal(document.getElementById('view-pages').style.height, `${expected.totalHeight}px`);
});

test('開いた直後は幅に合わせる', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const state = SigK.viewer.getState();

  assert.equal(state.fit, 'width');
  assert.equal(state.zoom, SigK.viewerLayout.fitWidthZoom({
    pageWidth: A4.width,
    viewportWidth: DEFAULT_VIEWPORT.width,
  }));
  assert.equal(document.getElementById('btn-fit-width').classList.contains('active'), true);
});

test('ステータスバーにファイル名・ページ数・サイズが出る', async (t) => {
  const { document } = await withOpenDocument(t);

  assert.equal(document.getElementById('status-file').textContent, 'three-pages.pdf');
  assert.equal(document.getElementById('status-pages').textContent, '3 ページ');
  assert.equal(document.getElementById('status-size').textContent, '1.4 KB');
});

test('文書を開くとページ番号と総数がツールバーに出る', async (t) => {
  const { document } = await withOpenDocument(t);

  assert.equal(document.getElementById('page-current').value, '1');
  assert.equal(document.getElementById('page-total').textContent, '/ 3');
});

test('前後のページへ動ける。端では止まる', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  SigK.viewer.nextPage();
  assert.equal(SigK.viewer.getState().current, 1);
  assert.equal(document.getElementById('page-current').value, '2');

  SigK.viewer.lastPage();
  assert.equal(SigK.viewer.getState().current, 2);
  SigK.viewer.nextPage();
  assert.equal(SigK.viewer.getState().current, 2, '末尾より先へ行ってはいけない');

  SigK.viewer.firstPage();
  assert.equal(SigK.viewer.getState().current, 0);
  SigK.viewer.prevPage();
  assert.equal(SigK.viewer.getState().current, 0, '先頭より前へ行ってはいけない');
});

test('ページ番号を入力すると、そのページへ移る', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const input = document.getElementById('page-current');

  input.value = '3';
  SigK.viewerControls.commitPageInput(document);

  assert.equal(SigK.viewer.getState().current, 2);
  assert.equal(document.getElementById('view').scrollTop, SigK.viewerLayout.scrollTopForPage({
    pages: SigK.viewerLayout.layoutPages({ sizes: [A4, A4, A4], zoom: SigK.viewer.getState().zoom }).pages,
    index: 2,
  }));
});

test('範囲外のページ番号は現在ページへ戻す', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const input = document.getElementById('page-current');

  SigK.viewer.goToPage(1);
  input.value = '99';
  SigK.viewerControls.commitPageInput(document);

  assert.equal(SigK.viewer.getState().current, 1);
  assert.equal(input.value, '2');
});

test('拡大すると段が上がり、幅への追従は外れる', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const before = SigK.viewer.getState().zoom;

  SigK.viewer.zoomIn();
  const after = SigK.viewer.getState();

  assert.ok(after.zoom > before, `${after.zoom} は ${before} より大きいはず`);
  assert.equal(after.fit, null, '手で倍率を変えたら追従をやめる');
  assert.equal(document.getElementById('btn-fit-width').classList.contains('active'), false);
  assert.equal(document.getElementById('zoom-value').textContent, SigK.viewerLayout.formatZoom(after.zoom));
});

test('倍率を変えるとページの枠も付いてくる', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const before = document.querySelector('.pdf-page').style.width;

  SigK.viewer.setZoom(2);

  assert.notEqual(document.querySelector('.pdf-page').style.width, before);
  assert.equal(SigK.viewer.getState().zoom, 2);
});

test('倍率は 25〜400% を超えない', async (t) => {
  const { SigK } = await withOpenDocument(t);

  assert.equal(SigK.viewer.setZoom(99), 4);
  assert.equal(SigK.viewer.setZoom(0.01), 0.25);
});

// 1,000ページの文書でも canvas を持ち続けないことが要る（spec-1-1 確定事項9）。
test('描くのは見えている範囲とその前後だけである', async (t) => {
  const sizes = Array.from({ length: 40 }, () => A4);
  const shell = await withOpenDocument(t, { pdfjs: createPdfjsStub({ sizes }) });
  const { SigK } = shell;

  // SigK は jsdom 側のレルムに居るため、配列をこちら側へ写してから比べる。
  assert.deepEqual([...SigK.viewer.getState().rendered], [0, 1]);

  SigK.viewer.goToPage(20);
  await shell.flush();

  const rendered = [...SigK.viewer.getState().rendered];
  assert.ok(rendered.includes(20), `20ページ目が描かれていない: ${rendered}`);
  assert.ok(rendered.length <= SigK.viewerLayout.MAX_RENDERED, `描きすぎ: ${rendered.length}`);
  assert.equal(rendered.includes(0), false, '見えなくなったページを抱えたまま');
});

test('幅の違うページが混ざっていても中央に並ぶ', async (t) => {
  const { document, SigK } = await withOpenDocument(t, { pdfjs: createPdfjsStub({ sizes: [A4, A5, A4] }) });
  const nodes = [...document.querySelectorAll('.pdf-page')];

  assert.equal(nodes[0].style.left, '0px');
  assert.notEqual(nodes[1].style.left, '0px');
  assert.ok(SigK.viewer.getState().contentWidth > 0);
});

test('2つ目を開くと1つ目を置き換える', async (t) => {
  const shell = await withOpenDocument(t);

  await shell.SigK.viewer.open(source({ name: 'one-page.pdf', size: 952 }));
  await shell.flush();

  assert.equal(shell.document.getElementById('status-file').textContent, 'one-page.pdf');
  assert.equal(shell.document.querySelectorAll('.pdf-page').length, 3, 'スタブは常に3ページを返す');
});

// 「幅に合わせる」の結果が1つ目と同じ倍率になると、setZoom は倍率が変わって
// いないと見て配置をやり直さない。紙の大きさが同じ文書を続けて開けば普通に
// 起こる（塊② のタブ切り替えを作る途中で見つかった）。
test('2つ目の文書が同じ倍率でも、ページの配置は置き直される', async (t) => {
  const shell = await withOpenDocument(t);
  const before = shell.SigK.viewer.getState().zoom;

  await shell.SigK.viewer.open(source({ name: 'same-size.pdf' }));
  await shell.flush();
  const state = shell.SigK.viewer.getState();

  assert.equal(state.zoom, before, '前提: 倍率は変わっていない');
  assert.ok(state.totalHeight > 0, 'ページの総高さが空のまま残っている');
  assert.notEqual(shell.document.querySelectorAll('.pdf-page')[0].style.height, '');
  assert.ok(state.rendered.length > 0, '描画対象が1つも選ばれていない');
});

test('閉じると空の表示に戻る', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  SigK.viewer.close();

  assert.equal(SigK.viewer.getState().open, false);
  assert.equal(document.querySelectorAll('.pdf-page').length, 0);
  assert.equal(document.getElementById('status-file').textContent, '文書なし');
  assert.equal(document.getElementById('pager').getAttribute('aria-disabled'), 'true');
});

test('パスワード付きの PDF は理由を画面に出す', async (t) => {
  const error = new Error('No password given');
  error.name = 'PasswordException';
  const { document, SigK } = await withShell(t, { pdfjs: createPdfjsStub({ openError: error }) });

  const opened = await SigK.viewer.open(source());

  assert.equal(opened, false);
  assert.match(document.getElementById('view-message').textContent, /パスワード/);
  assert.equal(document.getElementById('view-empty').hidden, false);
});

test('壊れた PDF は理由を画面に出す', async (t) => {
  const error = new Error('bad xref');
  error.name = 'InvalidPDFException';
  const { document, SigK } = await withShell(t, { pdfjs: createPdfjsStub({ openError: error }) });

  await SigK.viewer.open(source());

  assert.match(document.getElementById('view-message').textContent, /壊れている/);
});

test('読み込みに失敗した理由はそのまま画面に出る', async (t) => {
  const { document, SigK } = await withShell(t);

  const opened = await SigK.viewer.open({ error: 'ファイルが見つかりません。' });

  assert.equal(opened, false);
  assert.equal(document.getElementById('view-message').textContent, 'ファイルが見つかりません。');
});

test('開くダイアログで選ばれたファイルを表示する', async (t) => {
  const shell = await withShell(t, { openResults: [source()] });

  await shell.SigK.viewer.openViaDialog();
  await shell.flush();

  assert.equal(shell.SigK.viewer.getState().open, true);
  assert.equal(shell.document.getElementById('status-file').textContent, 'three-pages.pdf');
});

test('ダイアログを取り消しても何も変わらない', async (t) => {
  const shell = await withShell(t, { openResults: [{ canceled: true }] });

  const opened = await shell.SigK.viewer.openViaDialog();

  assert.equal(opened, false);
  assert.equal(shell.SigK.viewer.getState().open, false);
  assert.equal(shell.document.getElementById('view-message').textContent, shell.SigK.viewer.EMPTY_MESSAGE);
});

// メニューの「開く」（Ctrl+O）はメインから合図が届く。ツールバーと同じ経路を通す。
test('メニューからの合図でもダイアログが開く', async (t) => {
  const shell = await withShell(t, { openResults: [source()] });

  shell.fireOpenRequest();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await shell.flush();

  assert.equal(shell.SigK.viewer.getState().open, true);
});

test('Ctrl+＋ と Ctrl+0 で倍率が変わる', async (t) => {
  const { document, SigK, window } = await withOpenDocument(t);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true }));
  assert.equal(SigK.viewer.getState().zoom, 1);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true }));
  assert.equal(SigK.viewer.getState().zoom, 1.25);
});

test('End と Home でページの端へ飛ぶ', async (t) => {
  const { document, SigK, window } = await withOpenDocument(t);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(SigK.viewer.getState().current, 2);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(SigK.viewer.getState().current, 0);
});

// 入力欄で End を押したら文末へ動くのが当たり前である。奪ってはいけない。
test('ページ番号の入力中はページ移動のキーを奪わない', async (t) => {
  const { document, SigK, window } = await withOpenDocument(t);
  const input = document.getElementById('page-current');

  SigK.viewer.goToPage(1);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));

  assert.equal(SigK.viewer.getState().current, 1);
});

test('文書を開いていなければキー操作は効かない', async (t) => {
  const { document, SigK, window } = await withShell(t);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));

  assert.equal(SigK.viewer.getState().current, 0);
  assert.equal(SigK.viewer.getState().open, false);
});

// サイドパネルはページビューの幅を変える。追従中なら倍率も計算し直す。
test('サイドパネルを畳むと幅への追従が計算し直される', async (t) => {
  const shell = await withOpenDocument(t);
  const before = shell.SigK.viewer.getState().zoom;

  // 視野が広がったことにして畳む。
  shell.window.Object.defineProperty(shell.document.getElementById('view'), 'clientWidth', {
    value: DEFAULT_VIEWPORT.width + 240,
    configurable: true,
  });
  shell.SigK.shell.setSidePanelOpen(shell.document, false);

  assert.ok(shell.SigK.viewer.getState().zoom > before, '幅が広がったのに倍率が変わっていない');
});

test('pdf.js が読み込めていなければ、その旨を出す', async (t) => {
  const { document, SigK } = await withShell(t, { pdfjs: null });

  const opened = await SigK.viewer.open(source());

  assert.equal(opened, false);
  assert.match(document.getElementById('view-message').textContent, /表示機能/);
});

// bindClick が実際に効いているかを、API 直呼びではなくクリックで確かめる。
// ここが切れていても、他のテストは全部通ってしまう。
test('ツールバーのクリックで拡大・全体表示・ページ送りが動く', async (t) => {
  const { document, SigK, window } = await withOpenDocument(t);
  const click = (id) => document.getElementById(id).dispatchEvent(new window.MouseEvent('click'));
  const before = SigK.viewer.getState().zoom;

  click('zoom-in');
  assert.ok(SigK.viewer.getState().zoom > before, '＋ が効いていない');

  click('zoom-out');
  assert.equal(SigK.viewer.getState().zoom, before === 1 ? 0.75 : SigK.viewerLayout.prevZoom(SigK.viewerLayout.nextZoom(before)));

  click('btn-fit-page');
  assert.equal(SigK.viewer.getState().fit, 'page');

  click('page-next');
  assert.equal(SigK.viewer.getState().current, 1);

  click('page-prev');
  assert.equal(SigK.viewer.getState().current, 0);
});

test('文書が無いときはツールバーを押しても何も起きない', async (t) => {
  const { document, SigK, window } = await withShell(t);

  document.getElementById('zoom-in').dispatchEvent(new window.MouseEvent('click'));
  document.getElementById('page-next').dispatchEvent(new window.MouseEvent('click'));

  assert.equal(SigK.viewer.getState().open, false);
  assert.equal(SigK.viewer.getState().current, 0);
});

test('開くボタンのクリックでダイアログが出る', async (t) => {
  const shell = await withShell(t, { openResults: [source()] });

  shell.document.getElementById('btn-open').dispatchEvent(new shell.window.MouseEvent('click'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await shell.flush();

  assert.equal(shell.SigK.viewer.getState().open, true);
});
