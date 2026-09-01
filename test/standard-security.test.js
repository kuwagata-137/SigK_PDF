'use strict';

// パスワード付き PDF の検体を作る層のテスト（spec-1-6 事前調査 D）。
//
// pdf.js が実際にパスワードを聞いてくること自体は、pdf.js をレンダラーで
// 動かさないと確かめられないので、起動確認（SIGK_SMOKE_PASSWORD）で見る。
// ここでは「暗号の計算が仕様どおりか」と「fixture が毎回同じか」を固める。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument } = require('pdf-lib');
const { PADDING, padPassword, rc4, objectKey, buildEncryptedPdf } = require('../test/fixtures/standard-security.js');

test('RC4 が既知のテストベクトルと一致する', () => {
  // RFC 6229 などで広く引かれている値。自前で書いた実装が正しいことの根拠。
  const out = rc4(Buffer.from('Key', 'latin1'), Buffer.from('Plaintext', 'latin1'));
  assert.equal(out.toString('hex'), 'bbf316e8d940af0ad3');
  // 同じ鍵をもう一度当てれば元へ戻る（ストリーム暗号なので暗号化と復号が同じ）。
  assert.equal(rc4(Buffer.from('Key', 'latin1'), out).toString('latin1'), 'Plaintext');
});

test('パスワードは必ず 32 バイトへ詰められる', () => {
  const padded = padPassword('user1');
  assert.equal(padded.length, 32);
  assert.equal(padded.subarray(0, 5).toString('latin1'), 'user1');
  // 余りは ISO 32000-1 表 7.16 の詰め物で埋まる。
  assert.deepEqual(padded.subarray(5), PADDING.subarray(0, 27));
});

test('32 バイトを超えるパスワードは切り詰められる', () => {
  const long = 'x'.repeat(40);
  const padded = padPassword(long);
  assert.equal(padded.length, 32);
  assert.equal(padded.toString('latin1'), 'x'.repeat(32));
});

test('空のパスワードは詰め物そのものになる', () => {
  assert.deepEqual(padPassword(''), PADDING);
});

test('オブジェクト鍵は番号と世代で変わる', () => {
  const key = Buffer.from([1, 2, 3, 4, 5]);
  const a = objectKey(key, 4, 0);
  const b = objectKey(key, 5, 0);
  const c = objectKey(key, 4, 1);
  // 40bit の鍵なら 5+5=10 バイトになる（ISO 32000-1 Algorithm 1 の手順 e）。
  assert.equal(a.length, 10);
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('検体は実行のたびに同じバイト列になる', () => {
  // 毎回変わると、差分で気づけなくなる。ID を固定してあることの確認。
  assert.deepEqual(buildEncryptedPdf(), buildEncryptedPdf());
});

test('検体は標準セキュリティハンドラの辞書を持つ', () => {
  const bytes = buildEncryptedPdf();
  const text = bytes.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Filter \/Standard/);
  assert.match(text, /\/V 1 \/R 2/);
  assert.match(text, /\/Encrypt 6 0 R/);
  assert.match(text, /\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/);
});

test('本文は暗号化されていて、平文では現れない', () => {
  const bytes = buildEncryptedPdf({ caption: 'secret words' });
  assert.equal(bytes.includes(Buffer.from('secret words')), false);
});

test('pdf-lib は暗号化と認識して読み込みを断る', async () => {
  await assert.rejects(
    () => PDFDocument.load(buildEncryptedPdf()),
    (error) => /encrypted/i.test(String(error?.message)),
  );
});

test('ignoreEncryption で読めても、それは復号ではない', async () => {
  // ここが塊⑤ の確定事項12 の根拠である。読めてしまうので保存もできてしまうが、
  // 中身は暗号化されたままなので、保存すると壊れたファイルが出来る。
  const doc = await PDFDocument.load(buildEncryptedPdf(), { ignoreEncryption: true, updateMetadata: false });
  assert.equal(doc.getPageCount(), 1);
  const resaved = Buffer.from(await doc.save({ updateFieldAppearances: false, addDefaultPage: false }));
  // 保存し直しても /Encrypt が残る＝復号されていない。
  assert.ok(resaved.includes(Buffer.from('/Encrypt')));
  assert.equal(resaved.includes(Buffer.from('encrypted fixture')), false);
});

test('パスワードを変えると O と U の項目が変わる', () => {
  const a = buildEncryptedPdf({ userPassword: 'user1' }).toString('latin1');
  const b = buildEncryptedPdf({ userPassword: 'other' }).toString('latin1');
  const pick = (text) => text.match(/\/O <([0-9A-F]+)> \/U <([0-9A-F]+)>/).slice(1);
  const [oa, ua] = pick(a);
  const [ob, ub] = pick(b);
  assert.notEqual(oa, ob);
  assert.notEqual(ua, ub);
});
