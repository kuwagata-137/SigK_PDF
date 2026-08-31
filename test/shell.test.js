'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, INDEX_PATH, createShell } = require('./harness.js');
const { CSP_META_STRING, CSP_STRING, CSP_DIRECTIVES, META_IGNORED_DIRECTIVES } = require('../security-policy.js');

async function withShell(t, options) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  return shell;
}

test('index.html の meta CSP は security-policy.js の定義と一致する', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);

  assert.notEqual(match, null, 'meta の CSP が見つからない');
  assert.equal(match[1], CSP_META_STRING);
});

test('meta の CSP はヘッダから frame-ancestors だけを落としたものである', () => {
  const dropped = CSP_DIRECTIVES.filter((line) => !CSP_META_STRING.split('; ').includes(line));

  assert.equal(dropped.length, META_IGNORED_DIRECTIVES.length);
  for (const line of dropped)
    assert.ok(META_IGNORED_DIRECTIVES.some((name) => line.startsWith(`${name} `)), `${line} は meta から落とすべきでない`);
  assert.ok(CSP_STRING.includes('frame-ancestors'), 'ヘッダ側には frame-ancestors が要る');
});

test('index.html が読み込むスクリプトはすべて実在する', async (t) => {
  const shell = await withShell(t);

  assert.ok(shell.sources.length >= 4, 'スクリプトが読み込まれていない');
  for (const src of shell.sources)
    assert.ok(fs.existsSync(path.join(ROOT, ...src.split('/'))), `${src} が無い`);
});

test('画面の骨組みが組み上がる', async (t) => {
  const { document } = await withShell(t);

  for (const id of ['app', 'tabbar', 'toolbar', 'body', 'rail', 'side', 'view', 'status'])
    assert.notEqual(document.getElementById(id), null, `#${id} が無い`);
});

test('ツールレールは4つのモードを持つ', async (t) => {
  const { document, SigK } = await withShell(t);

  const modes = [...document.querySelectorAll('.rail-item')].map((el) => el.dataset.mode);

  // SigK は jsdom 側のレルムに居るため、配列をこちら側へ写してから比べる。
  assert.deepEqual(modes, [...SigK.shell.MODES]);
});

test('既定は閲覧モードでサイドパネルが開いている', async (t) => {
  const { document } = await withShell(t);

  assert.equal(document.documentElement.getAttribute('data-mode'), 'view');
  assert.equal(document.documentElement.getAttribute('data-panel'), 'open');
  assert.equal(document.getElementById('side-title').textContent, 'サムネイル');
  assert.equal(document.getElementById('side-actions').hidden, true);
});

test('ページモードに切り替えると見出しと操作欄が変わる', async (t) => {
  const { document, SigK } = await withShell(t);

  SigK.shell.setMode(document, 'pages');

  assert.equal(document.documentElement.getAttribute('data-mode'), 'pages');
  assert.equal(document.getElementById('side-title').textContent, 'ページ');
  assert.equal(document.getElementById('side-actions').hidden, false);
  const active = document.querySelector('.rail-item.active');
  assert.equal(active.dataset.mode, 'pages');
});

test('ツールレールのクリックでモードが変わる', async (t) => {
  const { document } = await withShell(t);

  document.querySelector('.rail-item[data-mode="annot"]').dispatchEvent(new document.defaultView.MouseEvent('click'));

  assert.equal(document.documentElement.getAttribute('data-mode'), 'annot');
  assert.equal(document.getElementById('side-title').textContent, '注釈');
});

test('知らないモードは受け付けない', async (t) => {
  const { document, SigK } = await withShell(t);

  assert.equal(SigK.shell.setMode(document, 'nope'), false);
  assert.equal(document.documentElement.getAttribute('data-mode'), 'view');
});

test('折りたたみボタンでサイドパネルが閉じる', async (t) => {
  const { document } = await withShell(t);
  const collapse = document.getElementById('side-collapse');

  collapse.dispatchEvent(new document.defaultView.MouseEvent('click'));
  assert.equal(document.documentElement.getAttribute('data-panel'), 'collapsed');

  collapse.dispatchEvent(new document.defaultView.MouseEvent('click'));
  assert.equal(document.documentElement.getAttribute('data-panel'), 'open');
});

test('サイドパネルの幅は 180〜420px に丸められる', async (t) => {
  const { document, SigK } = await withShell(t);

  assert.equal(SigK.shell.clampSidePanelWidth(50), 180);
  assert.equal(SigK.shell.clampSidePanelWidth(300), 300);
  assert.equal(SigK.shell.clampSidePanelWidth(900), 420);
  assert.equal(SigK.shell.setSidePanelWidth(document, 900), 420);
  assert.equal(document.documentElement.style.getPropertyValue('--side-width'), '420px');
});

test('アイコンはすべて描画され、空の入れ物が残らない', async (t) => {
  const { document } = await withShell(t);

  assert.equal(document.querySelectorAll('[data-icon]:empty').length, 0);
  const svgs = document.querySelectorAll('svg');
  assert.ok(svgs.length >= 15, `アイコンが少なすぎる: ${svgs.length}`);
  for (const svg of svgs) {
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(svg.getAttribute('stroke'), 'currentColor');
    assert.equal(svg.getAttribute('fill'), 'none');
  }
});

test('未定義のアイコンを要求すると落ちる', async (t) => {
  const { document, SigK } = await withShell(t);

  assert.throws(() => SigK.icons.create(document, 'そんなアイコンはない'), /未定義のアイコン/);
});

test('レンダラーで起きた例外はログの API へ流れる', async (t) => {
  const shell = await withShell(t);
  const { window, logs } = shell;

  window.dispatchEvent(new window.ErrorEvent('error', {
    message: '描画に失敗しました',
    filename: 'app://sigk/renderer/app.js',
    lineno: 12,
    colno: 5,
  }));

  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'error');
  assert.equal(logs[0].message, '描画に失敗しました');
  assert.equal(logs[0].context.source, 'window.error');
  assert.equal(logs[0].context.line, 12);
});

test('ログの API が無くても例外を投げない', async (t) => {
  const shell = await withShell(t, { withApis: false });

  assert.doesNotThrow(() => {
    shell.window.dispatchEvent(new shell.window.ErrorEvent('error', { message: 'x' }));
  });
});

test('アプリの版がステータスバーに出る', async (t) => {
  const { document } = await withShell(t, { appInfo: { ok: true, name: 'SigK PDF', version: '9.9.9' } });

  // showAppVersion は非同期に解決する。
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.getElementById('status-version').textContent, 'SigK PDF 9.9.9');
});

test('初期化は二度走らない', async (t) => {
  const { document, window, SigK } = await withShell(t);

  assert.equal(SigK.app.init(document, window), false);
  assert.equal(SigK.shell.init(document), false);
  assert.equal(SigK.log.install(window), false);
});
