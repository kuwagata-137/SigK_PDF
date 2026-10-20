'use strict';

// 異常な PDF の検体（spec-6-1 タスク D の D1。ロードマップ 6-3）。依存を足さず、バイト列を直に組む（決定21・spec-1-6 事前調査 D と同じ）。
//
//   empty.pdf          … 0 バイト。
//   header-only.pdf    … PDF の見出し（%PDF-1.7）の 1 行だけ。
//   not-a-pdf.pdf      … 拡張子は .pdf だが、中身はただの文字。
//   owner-only.pdf     … 所有者のパスワード（owner1）だけの暗号化（RC4 40bit。ユーザーのパスワードは空なので、開くときは聞かれない）。
//   aes-128.pdf        … AES-128 の暗号化（/V 4 /R 4・/CFM /AESV2。ユーザー user1 ／所有者 owner1）。
//   one-bad-page.pdf   … 3 ページのうち 2 ページ目のページの辞書だけが壊れている（辞書でない値に置き換えた）。
//
// AES は ISO 32000-1 の Algorithm 1（オブジェクトの鍵。"sAlT" を足す）・2（暗号の鍵。R 3 以上は MD5 を 50 回）・3（/O）・5（/U）で組む。
// AES の IV は検体が毎回同じになるよう決め打ちにする（検体の差分で変化に気づくため）。

const crypto = require('node:crypto');

const { PADDING, padPassword, rc4, buildEncryptedPdf } = require('./standard-security.js');

const md5 = (buffer) => crypto.createHash('md5').update(buffer).digest();
const hex = (buffer) => buffer.toString('hex').toUpperCase();
const latin1 = (text) => Buffer.from(text, 'latin1');

// オブジェクトの本体（'N 0 obj ... endobj' の Buffer）の並びから、xref と trailer を付けた PDF を組む。
function assemble(bodies, trailerExtra = '') {
  const header = latin1('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
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
  tail += `trailer\n<< /Size ${size} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${position}\n%%EOF\n`;
  parts.push(latin1(tail));
  return Buffer.concat(parts);
}

const streamObject = (number, data) => Buffer.concat([latin1(`${number} 0 obj\n<< /Length ${data.length} >>\nstream\n`), data, latin1('\nendstream\nendobj\n')]);
const caption = (text) => latin1(`BT /F1 24 Tf 72 700 Td (${text}) Tj ET\n`);
const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

// ---- AES-128（/V 4 /R 4） ----

const KEY_BYTES = 16;

// RC4 を 20 回（2 回目からは鍵の各バイトに回の番号を XOR する。Algorithm 3・5 の R 3 以上）。
function rc4Twenty(key, data) {
  let out = rc4(key, data);
  for (let round = 1; round <= 19; round += 1)
    out = rc4(Buffer.from(key.map((byte) => byte ^ round)), out);
  return out;
}

function ownerEntry(userPassword, ownerPassword) {
  let hash = md5(padPassword(ownerPassword));
  for (let index = 0; index < 50; index += 1)
    hash = md5(hash);
  return rc4Twenty(hash.subarray(0, KEY_BYTES), padPassword(userPassword));
}

function encryptionKey({ userPassword, owner, permissions, documentId }) {
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions, 0);
  let hash = md5(Buffer.concat([padPassword(userPassword), owner, p, documentId]));
  for (let index = 0; index < 50; index += 1)
    hash = md5(hash.subarray(0, KEY_BYTES));
  return hash.subarray(0, KEY_BYTES);
}

function userEntry(key, documentId) {
  const first = rc4Twenty(key, md5(Buffer.concat([PADDING, documentId])));
  return Buffer.concat([first, Buffer.alloc(16)]);
}

function aesObjectKey(key, objectNumber, generation) {
  const extra = Buffer.alloc(5);
  extra.writeUIntLE(objectNumber, 0, 3);
  extra.writeUIntLE(generation, 3, 2);
  return md5(Buffer.concat([key, extra, latin1('sAlT')])).subarray(0, 16);
}

function aesEncrypt(key, iv, data) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([iv, cipher.update(data), cipher.final()]);
}

function buildAesPdf({ userPassword = 'user1', ownerPassword = 'owner1', permissions = -4, text = 'aes-128 fixture' } = {}) {
  const documentId = md5(latin1('sigk-pdf-aes-128-fixture'));
  const owner = ownerEntry(userPassword, ownerPassword);
  const key = encryptionKey({ userPassword, owner, permissions, documentId });
  const user = userEntry(key, documentId);
  const iv = md5(latin1('sigk-pdf-aes-iv'));
  const content = aesEncrypt(aesObjectKey(key, 4, 0), iv, caption(text));
  const bodies = [
    latin1('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    latin1('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    latin1('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n'),
    streamObject(4, content),
    latin1(`5 0 obj\n${FONT}\nendobj\n`),
    latin1(`6 0 obj\n<< /Filter /Standard /V 4 /R 4 /Length 128 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV2 /Length 16 >> >> `
      + `/StmF /StdCF /StrF /StdCF /O <${hex(owner)}> /U <${hex(user)}> /P ${permissions} >>\nendobj\n`),
  ];
  return assemble(bodies, `/Encrypt 6 0 R /ID [<${hex(documentId)}> <${hex(documentId)}>] `);
}

// ---- 1 ページだけ壊れた PDF ----

function buildOneBadPagePdf() {
  const page = (number, contents) => latin1(`${number} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 8 0 R >> >> /Contents ${contents} 0 R >>\nendobj\n`);
  const bodies = [
    latin1('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    latin1('2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n'),
    page(3, 6),
    // 2 ページ目のページの辞書を、辞書でない値に置き換えた。
    latin1('4 0 obj\n(broken page)\nendobj\n'),
    page(5, 7),
    streamObject(6, caption('page 1')),
    streamObject(7, caption('page 3')),
    latin1(`8 0 obj\n${FONT}\nendobj\n`),
  ];
  return assemble(bodies);
}

// build.js の HANDMADE に足す表（ファイル名 → 組み立て）。
const ABNORMAL = {
  'empty.pdf': () => Buffer.alloc(0),
  'header-only.pdf': () => latin1('%PDF-1.7\n'),
  'not-a-pdf.pdf': () => Buffer.from('これは PDF ではありません。拡張子だけが .pdf のテキストです。\n', 'utf8'),
  'owner-only.pdf': () => buildEncryptedPdf({ userPassword: '', ownerPassword: 'owner1', caption: 'owner-only fixture' }),
  'aes-128.pdf': () => buildAesPdf(),
  'one-bad-page.pdf': () => buildOneBadPagePdf(),
};

module.exports = { ABNORMAL, assemble, buildAesPdf, buildOneBadPagePdf, aesObjectKey };
