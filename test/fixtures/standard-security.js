'use strict';

// パスワード付き PDF の検証用ファイルを生成する（spec-1-6 確定事項・docs/02 第9章 論点5）。
//
// なぜ手で PDF を組み立てるのか。pdf-lib は暗号化した書き出しに対応しないため、
// 選定済みの依存だけでは暗号化 PDF を作れない。qpdf のような外部バイナリを
// devDependency に足す案もあったが、数MB の同梱とライセンス確認を伴う。
// ISO 32000-1 の標準セキュリティハンドラ（RC4 40bit）は Algorithm 2／3／4 の
// 3つで足り、900 バイトほどの PDF なら手で書けるので、依存を増やさない道を採った
// （ユーザー確定 2026-09-01）。
//
// RC4 を自前で書いているのは、OpenSSL 3 が RC4 を既定の provider から外しており
// crypto.createCipheriv('rc4', ...) が使えないためである。MD5 は使える。
//
// ここで作るのは「開くときにパスワードを聞かれること」を試すための検体である。
// 本アプリは暗号化しての書き出しを行わない（第1版の範囲外。F-06-6 は読み込みのみ）。

const crypto = require('node:crypto');

// ISO 32000-1 表 7.16 の詰め物。パスワードを 32 バイトに揃えるのに使う。
const PADDING = Buffer.from([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
]);

const KEY_BYTES = 5;   // 40bit。R=2 はこの長さで固定である。

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest();
}

// パスワードを 32 バイトへ詰める（Algorithm 2 の手順 a）。
// PDF のパスワードは Latin-1 で解釈する。
function padPassword(password) {
  return Buffer.concat([Buffer.from(password, 'latin1'), PADDING]).subarray(0, 32);
}

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_value, index) => index);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// Algorithm 3: /O（オーナーパスワードの項目）。
function ownerEntry(userPassword, ownerPassword) {
  return rc4(md5(padPassword(ownerPassword)).subarray(0, KEY_BYTES), padPassword(userPassword));
}

// Algorithm 2: 暗号化鍵。R=2 なので繰り返しの MD5 は行わない。
function encryptionKey({ userPassword, owner, permissions, documentId }) {
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions, 0);
  return md5(Buffer.concat([padPassword(userPassword), owner, p, documentId])).subarray(0, KEY_BYTES);
}

// Algorithm 4: /U（ユーザーパスワードの項目）。R=2 は詰め物を鍵で暗号化するだけ。
function userEntry(key) {
  return rc4(key, PADDING);
}

// Algorithm 1: オブジェクトごとの鍵。番号と世代を混ぜるので、同じ文書でも
// オブジェクトが違えば別の鍵になる。
function objectKey(key, objectNumber, generation) {
  const extra = Buffer.alloc(5);
  extra.writeUIntLE(objectNumber, 0, 3);
  extra.writeUIntLE(generation, 3, 2);
  return md5(Buffer.concat([key, extra])).subarray(0, Math.min(key.length + 5, 16));
}

function hex(buffer) {
  return buffer.toString('hex').toUpperCase();
}

// 1ページだけの暗号化 PDF を組み立てる。
//
// permissions の既定 -1 は「すべて許可」。ビットを落とした値を渡せば、
// 印刷や抽出を禁じた文書も作れる（いまは使っていない）。
function buildEncryptedPdf({
  userPassword = 'user1',
  ownerPassword = 'owner1',
  permissions = -1,
  caption = 'encrypted fixture',
} = {}) {
  // ID は毎回同じにする。fixture が実行のたびに変わると、差分で気づけなくなる。
  const documentId = md5(Buffer.from('sigk-pdf-encrypted-fixture', 'latin1'));
  const owner = ownerEntry(userPassword, ownerPassword);
  const key = encryptionKey({ userPassword, owner, permissions, documentId });
  const user = userEntry(key);

  const content = Buffer.from(`BT /F1 24 Tf 72 700 Td (${caption}) Tj ET\n`, 'latin1');
  // 内容ストリームはオブジェクト 4 なので、その鍵で暗号化する。
  const encrypted = rc4(objectKey(key, 4, 0), content);

  const bodies = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'latin1'),
    Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n', 'latin1'),
    Buffer.concat([
      Buffer.from(`4 0 obj\n<< /Length ${encrypted.length} >>\nstream\n`, 'latin1'),
      encrypted,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ]),
    Buffer.from('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n', 'latin1'),
    // /Encrypt 辞書そのものは暗号化しない（ISO 32000-1 7.6.1）。
    Buffer.from(`6 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${hex(owner)}> /U <${hex(user)}> `
      + `/P ${permissions} >>\nendobj\n`, 'latin1'),
  ];

  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  const parts = [header];
  const offsets = [];
  let position = header.length;
  for (const body of bodies) {
    offsets.push(position);
    parts.push(body);
    position += body.length;
  }

  const size = bodies.length + 1;
  let tail = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${size} /Root 1 0 R /Encrypt 6 0 R `
    + `/ID [<${hex(documentId)}> <${hex(documentId)}>] >>\nstartxref\n${position}\n%%EOF\n`;
  parts.push(Buffer.from(tail, 'latin1'));

  return Buffer.concat(parts);
}

module.exports = { PADDING, KEY_BYTES, padPassword, rc4, objectKey, buildEncryptedPdf };
