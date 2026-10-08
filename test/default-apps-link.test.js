'use strict';

// 既定のアプリの設定を開く URI（default-apps-link.js。docs/spec-5-2-open-with-icon.md 確定事項C2）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_APPS_URI, defaultAppsUri } = require('../default-apps-link.js');

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
