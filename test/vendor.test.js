'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { VENDOR_MANIFEST, planVendorCopy, verifyVendorSources, runVendorCopy } = require('../scripts/vendor.js');

const ROOT = path.resolve(__dirname, '..');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-vendor-'));
}

// マニフェストどおりの偽の node_modules を作る。complete=false のときは1件だけ欠けさせる。
function createFakeSources(rootDir, { complete = true } = {}) {
  const entries = complete ? VENDOR_MANIFEST : VENDOR_MANIFEST.slice(0, -1);
  for (const item of entries) {
    const from = path.join(rootDir, 'node_modules', ...item.pkg.split('/'), ...item.from.split('/'));
    if (item.kind === 'dir') {
      fs.mkdirSync(from, { recursive: true });
      fs.writeFileSync(path.join(from, 'sample.bin'), `${item.label}\n`, 'utf8');
      continue;
    }
    fs.mkdirSync(path.dirname(from), { recursive: true });
    fs.writeFileSync(from, `${item.label}\n`, 'utf8');
  }
}

test('planVendorCopy はマニフェストと同数の計画を返す', () => {
  const plan = planVendorCopy({ rootDir: ROOT });

  assert.equal(plan.length, VENDOR_MANIFEST.length);
  for (const entry of plan) {
    assert.ok(path.isAbsolute(entry.from), `${entry.label} の from が絶対パスでない`);
    assert.ok(path.isAbsolute(entry.to), `${entry.label} の to が絶対パスでない`);
    assert.ok(entry.from.startsWith(path.join(ROOT, 'node_modules')), `${entry.label} の from が node_modules 配下でない`);
    assert.ok(entry.to.startsWith(path.join(ROOT, 'vendor')), `${entry.label} の to が vendor 配下でない`);
  }
});

test('planVendorCopy は rootDir が無いと落ちる', () => {
  assert.throws(() => planVendorCopy({}), /rootDir/);
});

test('verifyVendorSources は揃っていれば空配列を返す', () => {
  const rootDir = makeTempRoot();
  createFakeSources(rootDir);

  const missing = verifyVendorSources(planVendorCopy({ rootDir }));

  assert.deepEqual(missing, []);
});

test('verifyVendorSources は欠けているものだけを返す', () => {
  const rootDir = makeTempRoot();
  createFakeSources(rootDir, { complete: false });

  const missing = verifyVendorSources(planVendorCopy({ rootDir }));

  assert.equal(missing.length, 1);
  assert.equal(missing[0].label, VENDOR_MANIFEST[VENDOR_MANIFEST.length - 1].label);
});

test('runVendorCopy は複製元が欠けていると絶対パス付きで落ちる', () => {
  const rootDir = makeTempRoot();
  createFakeSources(rootDir, { complete: false });
  const last = VENDOR_MANIFEST[VENDOR_MANIFEST.length - 1];
  const expectedPath = path.join(rootDir, 'node_modules', ...last.pkg.split('/'), ...last.from.split('/'));

  assert.throws(
    () => runVendorCopy({ rootDir }),
    (err) => err.message.includes(last.label) && err.message.includes(expectedPath),
  );
  assert.equal(fs.existsSync(path.join(rootDir, 'vendor')), false, '失敗時に vendor/ を作ってはいけない');
});

test('runVendorCopy はファイルもディレクトリも複製する', () => {
  const rootDir = makeTempRoot();
  createFakeSources(rootDir);

  const plan = runVendorCopy({ rootDir });

  for (const entry of plan) {
    assert.ok(fs.existsSync(entry.to), `${entry.label} が複製されていない`);
    if (entry.kind === 'dir')
      assert.ok(fs.existsSync(path.join(entry.to, 'sample.bin')), `${entry.label} の中身が複製されていない`);
  }
});

test('runVendorCopy は古い vendor/ を消してから複製する', () => {
  const rootDir = makeTempRoot();
  createFakeSources(rootDir);
  const stale = path.join(rootDir, 'vendor', 'stale.js');
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, 'old', 'utf8');

  runVendorCopy({ rootDir });

  assert.equal(fs.existsSync(stale), false, '前回の残骸が消えていない');
});
