'use strict';

// 既定のアプリの設定を開く URI（default-apps-link.js。docs/spec-5-2-open-with-icon.md 確定事項C2）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_APPS_URI, defaultAppsUri, openDefaultAppsSettings } = require('../default-apps-link.js');

// 偽物の shell。openExternal に渡された URI を控え、決めた結果を返す。
function fakeShell(result) {
  const calls = [];
  return { calls, openExternal: (uri) => { calls.push(uri); return result(); } };
}

test('押すと、製品名のページの URI で openExternal を 1 回呼ぶ', async () => {
  const shell = fakeShell(() => Promise.resolve());
  const logs = [];
  const result = await openDefaultAppsSettings({ shell, appName: 'SigK PDF', logError: (entry) => logs.push(entry) });
  assert.deepEqual(shell.calls, ['ms-settings:defaultapps?registeredAppUser=SigK%20PDF']);
  assert.deepEqual(result, { ok: true, uri: shell.calls[0] });
  assert.deepEqual(logs, []);
});

test('開けなかったら窓は出さず、ログに 1 件残す（断られたときも、その場で投げたときも）', async () => {
  for (const result of [() => Promise.reject(new Error('denied')), () => { throw new Error('boom'); }]) {
    const shell = fakeShell(result);
    const logs = [];
    const done = await openDefaultAppsSettings({ shell, appName: 'SigK PDF', logError: (entry) => logs.push(entry) });
    assert.equal(done.ok, false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].message, '既定のアプリの設定を開けませんでした');
    assert.equal(logs[0].context.uri, 'ms-settings:defaultapps?registeredAppUser=SigK%20PDF');
    assert.match(logs[0].stack, /denied|boom/);
  }
});

test('アプリの名前を URI の決まりで符号化して、そのアプリのページを開く', () => {
  assert.equal(defaultAppsUri('SigK PDF'), 'ms-settings:defaultapps?registeredAppUser=SigK%20PDF');
  assert.equal(defaultAppsUri('SigK PDF Probe'), 'ms-settings:defaultapps?registeredAppUser=SigK%20PDF%20Probe');
  assert.equal(defaultAppsUri('ピー&ディー=エフ'), `ms-settings:defaultapps?registeredAppUser=${encodeURIComponent('ピー&ディー=エフ')}`);
  assert.ok(!defaultAppsUri('a&b=c').includes('&b'), '名前の & で問い合わせが切れない');
});

test('名前が無いときは、既定のアプリの画面の頭を開く', () => {
  assert.equal(DEFAULT_APPS_URI, 'ms-settings:defaultapps');
  for (const name of [undefined, null, '', '   ', 42])
    assert.equal(defaultAppsUri(name), DEFAULT_APPS_URI);
});

test('名前は package.json の製品名で、インストーラーの RegisteredApplications の値の名前（${PRODUCT_NAME}）と同じ', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.productName, 'SigK PDF');
  assert.equal(pkg.build.productName, pkg.productName);
});
