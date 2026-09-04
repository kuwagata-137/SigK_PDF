'use strict';

// 見開き表示（spec-2-3）。配置の計算そのものは viewer-layout.test.js が持つ。
// ここは「ボタン → 状態 → DOM → 覚える」のつながりを jsdom で見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, DEFAULT_VIEWPORT, A4 } = require('./harness.js');

const FIVE = [A4, A4, A4, A4, A4];

function click(document, id) {
  document.getElementById(id).dispatchEvent(new (document.defaultView.MouseEvent)('click', { bubbles: true }));
}

async function withOpenDocument(t, { sizes = [A4, A4, A4], ...options } = {}) {
  const shell = await createShell({ pdfjs: createPdfjsStub({ sizes }), ...options });
  t.after(() => shell.cleanup());
  await shell.flush();
  await shell.SigK.viewer.open(makeSource({ path: 'C:\\work\\facing.pdf' }));
  await shell.flush();
  return shell;
}

function expectedLayout(SigK, sizes, facing) {
  return SigK.viewerLayout.layoutPages({ sizes, zoom: SigK.viewer.getState().zoom, facing });
}

test('文書が無いと「見開き」は押せず、開くと押せる', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const { document, SigK } = shell;

  assert.ok(SigK.viewerControls.DOCUMENT_CONTROLS.includes('btn-facing'));
  assert.equal(document.getElementById('btn-facing').getAttribute('aria-disabled'), 'true');
  // 押せないボタンは効かない。
  click(document, 'btn-facing');
  assert.equal(SigK.viewer.getState().facing, false);

  await SigK.viewer.open(makeSource());
  await shell.flush();
  assert.equal(document.getElementById('btn-facing').hasAttribute('aria-disabled'), false);
});

test('「見開き」で切り替わり、押している間は active。もう一度押すと戻る（確定事項1・3）', async (t) => {
  const { document, SigK, uiCalls, savedUi } = await withOpenDocument(t);
  const button = document.getElementById('btn-facing');

  click(document, 'btn-facing');
  assert.equal(SigK.viewer.getState().facing, true);
  assert.equal(button.classList.contains('active'), true);
  assert.equal(document.documentElement.getAttribute('data-layout'), 'facing');
  assert.deepEqual(uiCalls, [{ pageLayout: 'facing' }]);
  assert.equal(savedUi().pageLayout, 'facing');

  click(document, 'btn-facing');
  assert.equal(SigK.viewer.getState().facing, false);
  assert.equal(button.classList.contains('active'), false);
  assert.equal(document.documentElement.getAttribute('data-layout'), 'single');
  assert.equal(savedUi().pageLayout, 'single');
});

test('見開きでは枠が 1-2 で同じ高さに並び、奇数の末尾は左に単独（確定事項7）', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  SigK.shell.setPageLayout(document, 'facing');
  const expected = expectedLayout(SigK, [A4, A4, A4], true);
  const nodes = [...document.querySelectorAll('.pdf-page')];

  for (const page of expected.pages) {
    assert.equal(nodes[page.index].style.top, `${page.top}px`);
    assert.equal(nodes[page.index].style.left, `${page.left}px`);
    assert.equal(nodes[page.index].style.width, `${page.width}px`);
  }
  assert.equal(nodes[0].style.top, nodes[1].style.top);
  assert.notEqual(nodes[0].style.left, nodes[1].style.left);
  assert.equal(nodes[2].style.left, '0px');
  assert.equal(document.getElementById('view-pages').style.width, `${expected.contentWidth}px`);
  assert.equal(SigK.viewer.getState().contentWidth, expected.contentWidth);
});

test('追従中に切り替えると「幅に合わせる」が2枚基準になり、戻すと1枚基準に戻る（確定事項4・18）', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const layout = SigK.viewerLayout;
  const single = SigK.viewer.getState().zoom;

  SigK.shell.setPageLayout(document, 'facing');
  const state = SigK.viewer.getState();
  assert.equal(state.fit, 'width', '追従は続く');
  assert.equal(state.zoom, layout.fitWidthZoom({
    pageWidth: A4.width * 2, viewportWidth: DEFAULT_VIEWPORT.width, gap: layout.FACING_GAP,
  }));
  assert.ok(state.zoom < single);
  assert.equal(document.getElementById('btn-fit-width').classList.contains('active'), true);

  SigK.shell.setPageLayout(document, 'single');
  assert.equal(SigK.viewer.getState().zoom, single);
});

test('追従していなければ倍率は変えず、配置だけを変える', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  SigK.viewer.setZoom(1);
  SigK.shell.setPageLayout(document, 'facing');

  assert.equal(SigK.viewer.getState().zoom, 1);
  assert.equal(SigK.viewer.getState().fit, null);
  const nodes = [...document.querySelectorAll('.pdf-page')];
  assert.equal(nodes[0].style.top, nodes[1].style.top);
});

test('見開きでは ◀ ▶ が2ページ動く。端では止まる（確定事項15）', async (t) => {
  const { document, SigK } = await withOpenDocument(t, { sizes: FIVE });
  SigK.shell.setPageLayout(document, 'facing');

  SigK.viewer.nextPage();
  assert.equal(SigK.viewer.getState().current, 2);
  SigK.viewer.nextPage();
  assert.equal(SigK.viewer.getState().current, 4);
  SigK.viewer.nextPage();
  assert.equal(SigK.viewer.getState().current, 4, '末尾より先へ行ってはいけない');
  SigK.viewer.prevPage();
  assert.equal(SigK.viewer.getState().current, 2);
  // 右ページにいても、組の先頭から数えて前の組へ動く。
  SigK.viewer.goToPage(3);
  SigK.viewer.prevPage();
  assert.equal(SigK.viewer.getState().current, 0);
  assert.equal(document.getElementById('page-current').value, '1');
});

test('右ページを指定すると組の先頭へスクロールし、描画更新のあとも番号を保つ（確定事項13・16）', async (t) => {
  const { document, SigK, flush } = await withOpenDocument(t, { sizes: FIVE });
  SigK.shell.setPageLayout(document, 'facing');
  const { pages } = expectedLayout(SigK, FIVE, true);

  const input = document.getElementById('page-current');
  input.value = '4';
  SigK.viewerControls.commitPageInput(document);

  assert.equal(SigK.viewer.getState().current, 3);
  assert.equal(document.getElementById('view').scrollTop, SigK.viewerLayout.scrollTopForPage({ pages, index: 2 }));
  // スクロール後の更新で左（3ページ目）へ戻らない。
  document.getElementById('view').dispatchEvent(new (document.defaultView.Event)('scroll'));
  await flush();
  assert.equal(SigK.viewer.getState().current, 3);
  assert.equal(input.value, '4');

  // 組が変わればふつうに追従する。
  document.getElementById('view').scrollTop = 0;
  document.getElementById('view').dispatchEvent(new (document.defaultView.Event)('scroll'));
  await flush();
  assert.equal(SigK.viewer.getState().current, 0);
});

test('見開きでは前後2ページまで先に描く（確定事項12）', async (t) => {
  const { document, SigK, flush } = await withOpenDocument(t, { sizes: Array.from({ length: 12 }, () => A4) });
  SigK.shell.setPageLayout(document, 'facing');
  SigK.viewer.goToPage(6);
  await flush();

  const { rendered } = SigK.viewer.getState();
  assert.ok(rendered.includes(4) && rendered.includes(5), `前の組が描かれていない: ${rendered}`);
  assert.ok(rendered.length <= SigK.viewerLayout.MAX_RENDERED);
});

test('ページ編集のあとも見開きのまま並び直る（確定事項22）', async (t) => {
  const { document, SigK } = await withOpenDocument(t, { sizes: FIVE });
  SigK.shell.setPageLayout(document, 'facing');

  const plan = SigK.viewer.getPlan();
  SigK.viewer.applyPlan([...plan].reverse());

  const nodes = [...document.querySelectorAll('.pdf-page')];
  assert.equal(nodes.length, 5);
  assert.equal(nodes[0].style.top, nodes[1].style.top);
  assert.equal(nodes[2].style.top, nodes[3].style.top);
  assert.notEqual(nodes[0].style.left, nodes[1].style.left);
  assert.equal(SigK.viewer.getState().facing, true);
});

test('覚えた見開きで立ち上がり、開いた直後から2枚基準で幅に合わせる（確定事項5・6）', async (t) => {
  const shell = await createShell({ ui: { mode: 'view', pageLayout: 'facing', sidePanel: { open: true, width: 240 } } });
  t.after(() => shell.cleanup());
  const { document, SigK, uiCalls } = shell;
  await shell.flush();

  assert.equal(document.documentElement.getAttribute('data-layout'), 'facing');
  assert.equal(SigK.viewer.getState().facing, true);
  // 復元は覚え直さない。
  assert.deepEqual(uiCalls, []);

  await SigK.viewer.open(makeSource());
  await shell.flush();
  const layout = SigK.viewerLayout;
  assert.equal(SigK.viewer.getState().zoom, layout.fitWidthZoom({
    pageWidth: A4.width * 2, viewportWidth: DEFAULT_VIEWPORT.width, gap: layout.FACING_GAP,
  }));
  assert.equal(document.getElementById('btn-facing').classList.contains('active'), true);
});

test('見開きはアプリ全体の設定で、タブを移っても変わらない（確定事項25）', async (t) => {
  const files = {
    'C:\\work\\a.pdf': makeSource({ path: 'C:\\work\\a.pdf' }),
    'C:\\work\\b.pdf': makeSource({ path: 'C:\\work\\b.pdf' }),
  };
  const shell = await createShell({ files });
  t.after(() => shell.cleanup());
  const { document, SigK } = shell;
  await shell.flush();

  await SigK.tabs.openPath('C:\\work\\a.pdf');
  SigK.shell.setPageLayout(document, 'facing');
  await SigK.tabs.openPath('C:\\work\\b.pdf');
  await shell.flush();
  assert.equal(SigK.viewer.getState().facing, true);

  SigK.tabs.activate(SigK.tabs.list()[0].id);
  await shell.flush();
  assert.equal(SigK.viewer.getState().facing, true);
  const nodes = [...document.querySelectorAll('.pdf-page')];
  assert.equal(nodes[0].style.top, nodes[1].style.top);
});
