'use strict';

// プリンターの既定の設定の取得（printer-xml.js・printer-config.js・print-job-options.js。docs/spec-7-7-print-dialog.md 確定事項C3・質問 PR1 案A）。
// 本物のプリンターと PowerShell には触らない。XML は Print Schema の形を写した見本で、プリンター名は試験用の架空の名前にする。

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const xml = require('../printer-xml.js');
const { parseDeviceValue, parseConfigOutput, redact, createPrinterConfig } = require('../printer-config.js');
const { buildPrintSettings } = require('../print-job-options.js');

// ---- Print Schema の見本 ----

const scored = (p, k, name, value, type = 'xsd:integer') =>
  `<${p}:ScoredProperty name="${k}:${name}"><${p}:Value xsi:type="${type}">${value}</${p}:Value></${p}:ScoredProperty>`;
const prop = (p, k, name, value, type = 'xsd:integer') =>
  `<${p}:Property name="${k}:${name}"><${p}:Value xsi:type="${type}">${value}</${p}:Value></${p}:Property>`;
const media = (p, k, id, width, height, display = null) =>
  `<${p}:Option name="${k}:${id}">${display === null ? '' : prop(p, k, 'DisplayName', display, 'xsd:string')}`
  + `${scored(p, k, 'MediaSizeWidth', width)}${scored(p, k, 'MediaSizeHeight', height)}</${p}:Option>`;
const feature = (p, k, name, options) =>
  `<${p}:Feature name="${k}:${name}">${prop(p, k, 'DisplayName', name, 'xsd:string')}${options}</${p}:Feature>`;
const option = (p, k, id) => `<${p}:Option name="${k}:${id}" />`;

function ticketXml({ p = 'psf', k = 'psk', paper = media('psf', 'psk', 'ISOA4', 210000, 297000), duplex = 'OneSided', color = 'Color' } = {}) {
  return `<?xml version="1.0"?><${p}:PrintTicket xmlns:${p}="x" xmlns:${k}="y" version="1">`
    + feature(p, k, 'JobDuplexAllDocumentsContiguously', option(p, k, duplex))
    + feature(p, k, 'PageMediaSize', paper)
    + feature(p, k, 'PageOutputColor', option(p, k, color))
    + `</${p}:PrintTicket>`;
}

// 事務所のレーザープリンターを写した能力情報: A4 で四辺 4.23 mm、両面とカラーに対応。
function capsXml({ p = 'psf', k = 'psk', duplex = true, color = true, area = [4230, 4230, 201540, 288540], areaPaper = [210000, 297000] } = {}) {
  const sizes = media(p, k, 'ISOA4', 210000, 297000, 'A4') + media(p, k, 'ISOA3', 297000, 420000, 'A3')
    + media(p, k, 'JISB4', 257000, 364000, 'B4 (JIS)') + media(p, k, 'NorthAmericaLetter', 215900, 279400, 'レター')
    // ユーザー定義サイズは寸法が ParameterRef なので一覧に入れない。
    + `<${p}:Option name="${k}:CustomMediaSize"><${p}:ScoredProperty name="${k}:MediaSizeWidth"><${p}:ParameterRef name="${k}:PageMediaSizeMediaSizeWidth" /></${p}:ScoredProperty></${p}:Option>`;
  const duplexOptions = option(p, k, 'OneSided') + (duplex ? option(p, k, 'TwoSidedLongEdge') + option(p, k, 'TwoSidedShortEdge') : '');
  const colorOptions = (color ? option(p, k, 'Color') : '') + option(p, k, 'Grayscale');
  const [x, y, w, h] = area;
  const imageable = `<${p}:Property name="${k}:PageImageableSize">${prop(p, k, 'ImageableSizeWidth', areaPaper[0])}${prop(p, k, 'ImageableSizeHeight', areaPaper[1])}`
    + `<${p}:Property name="${k}:ImageableArea">${prop(p, k, 'OriginWidth', x)}${prop(p, k, 'OriginHeight', y)}${prop(p, k, 'ExtentWidth', w)}${prop(p, k, 'ExtentHeight', h)}</${p}:Property></${p}:Property>`;
  return `<?xml version="1.0"?><${p}:PrintCapabilities xmlns:${p}="x" xmlns:${k}="y" version="1">`
    + feature(p, k, 'JobDuplexAllDocumentsContiguously', duplexOptions)
    + feature(p, k, 'PageMediaSize', sizes)
    + feature(p, k, 'PageOutputColor', colorOptions)
    + imageable
    + `</${p}:PrintCapabilities>`;
}

// ---- 印刷チケットと能力情報を読む（printer-xml.js） ----

test('印刷チケットから、今の用紙（µm）・両面・カラーを読む', () => {
  assert.deepEqual(xml.readTicket(ticketXml()), { paper: { id: 'psk:ISOA4', width: 210000, height: 297000 }, duplex: 'simplex', color: true });
  const a3 = xml.readTicket(ticketXml({ paper: media('psf', 'psk', 'ISOA3', 297000, 420000), duplex: 'TwoSidedLongEdge', color: 'Grayscale' }));
  assert.deepEqual(a3, { paper: { id: 'psk:ISOA3', width: 297000, height: 420000 }, duplex: 'longEdge', color: false });
  assert.equal(xml.readTicket(ticketXml({ duplex: 'TwoSidedShortEdge' })).duplex, 'shortEdge');
});

test('名前空間の接頭辞がドライバーごとに違っても読める', () => {
  const ticket = ticketXml({ p: 'ns0', k: 'ns1', paper: media('ns0', 'ns1', 'ISOA5', 148000, 210000), duplex: 'TwoSidedLongEdge' });
  assert.deepEqual(xml.readTicket(ticket).paper, { id: 'ns1:ISOA5', width: 148000, height: 210000 });
  const caps = xml.readCapabilities(capsXml({ p: 'ns0', k: 'ns1' }));
  assert.equal(caps.paperSizes.length, 4);
  assert.equal(caps.imageable.x, 4230);
});

test('ユーザー定義サイズの用紙は、ParameterInit の値から寸法を読む', () => {
  const paper = '<psf:Option name="psk:CustomMediaSize"><psf:ScoredProperty name="psk:MediaSizeWidth"><psf:ParameterRef name="psk:PageMediaSizeMediaSizeWidth" /></psf:ScoredProperty>'
    + '<psf:ScoredProperty name="psk:MediaSizeHeight"><psf:ParameterRef name="psk:PageMediaSizeMediaSizeHeight" /></psf:ScoredProperty></psf:Option>';
  const inits = '<psf:ParameterInit name="psk:PageMediaSizeMediaSizeWidth"><psf:Value xsi:type="xsd:integer">100000</psf:Value></psf:ParameterInit>'
    + '<psf:ParameterInit name="psk:PageMediaSizeMediaSizeHeight"><psf:Value xsi:type="xsd:integer">148000</psf:Value></psf:ParameterInit>';
  const ticket = ticketXml({ paper }).replace('</psf:PrintTicket>', `${inits}</psf:PrintTicket>`);
  assert.deepEqual(xml.readTicket(ticket).paper, { id: 'psk:CustomMediaSize', width: 100000, height: 148000 });
});

test('能力情報から、印刷可能領域・用紙サイズ一覧・両面とカラーの可否を読む', () => {
  const caps = xml.readCapabilities(capsXml());
  assert.deepEqual(caps.imageable, { x: 4230, y: 4230, width: 201540, height: 288540, paperWidth: 210000, paperHeight: 297000 });
  assert.deepEqual(caps.paperSizes.map((size) => size.name), ['A4', 'A3', 'B4 (JIS)', 'レター']);
  assert.deepEqual(caps.paperSizes[1], { id: 'psk:ISOA3', name: 'A3', width: 297000, height: 420000 });
  assert.equal(caps.duplexSupported, true);
  assert.equal(caps.colorSupported, true);

  const mono = xml.readCapabilities(capsXml({ duplex: false, color: false }));
  assert.equal(mono.duplexSupported, false);
  assert.equal(mono.colorSupported, false);
});

test('印刷可能領域が別の用紙の値の時は、四辺の余白だけを借りて今の用紙に当てる', () => {
  const imageable = { x: 4230, y: 5000, width: 207440, height: 270400, paperWidth: 215900, paperHeight: 279400 };
  // レターの余白（左 4.23・右 4.23・上 5・下 4 mm）を A4 に当てる。
  assert.deepEqual(xml.fitImageable({ width: 210000, height: 297000 }, imageable), { x: 4230, y: 5000, width: 201540, height: 288000 });
  // 同じ用紙ならそのまま。取得できなければ四辺 4.23 mm。
  assert.deepEqual(xml.fitImageable({ width: 215900, height: 279400 }, imageable), { x: 4230, y: 5000, width: 207440, height: 270400 });
  assert.deepEqual(xml.fitImageable({ width: 210000, height: 297000 }, null), { x: 4230, y: 4230, width: 201540, height: 288540 });
});

test('取得結果を、印刷画面が使う形にまとめる。用紙の名前は能力情報の一覧から引く', () => {
  const config = xml.buildConfig({ ticket: ticketXml({ paper: media('psf', 'psk', 'ISOA3', 297000, 420000), duplex: 'TwoSidedLongEdge' }), caps: capsXml(), collate: true });
  assert.equal(config.ok, true);
  assert.equal(config.source, 'printer');
  assert.deepEqual(config.paper, { id: 'psk:ISOA3', name: 'A3', width: 297000, height: 420000 });
  assert.deepEqual(config.imageable, { x: 4230, y: 4230, width: 288540, height: 411540 });
  assert.deepEqual(config.duplex, { supported: true, mode: 'longEdge' });
  assert.deepEqual(config.color, { supported: true, value: true });
  assert.equal(config.paperSizes.length, 4);
});

test('印刷チケットを読めない時は A4・四辺 4.23 mm・片面・カラーの初期値にする', () => {
  for (const config of [xml.buildConfig({ ticket: '', caps: '' }), xml.fallbackConfig('failed')]) {
    assert.deepEqual(config.paper, { id: 'psk:ISOA4', name: 'A4', width: 210000, height: 297000 });
    assert.deepEqual(config.imageable, { x: 4230, y: 4230, width: 201540, height: 288540 });
    assert.equal(config.duplex.mode, 'simplex');
    assert.equal(config.color.value, true);
    assert.ok(config.paperSizes.length >= 8, 'ページ設定画面の用紙サイズの初期の一覧がある');
  }
  assert.equal(xml.fallbackConfig('failed').ok, false);
  // 両面は印刷チケットに無くても、Get-PrintConfiguration の DuplexingMode から読む。
  assert.equal(xml.buildConfig({ ticket: ticketXml().replace(/<psf:Feature name="psk:JobDuplex[\s\S]*?<\/psf:Feature>/, ''), caps: '', duplexingMode: 'TwoSidedShortEdge' }).duplex.mode, 'shortEdge');
});

// ---- 既定のプリンターと PowerShell の結果（printer-config.js） ----

test('レジストリの Device の値から、既定のプリンターの名前を取り出す', () => {
  assert.equal(parseDeviceValue('試験用プリンター,winspool,Ne01:'), '試験用プリンター');
  assert.equal(parseDeviceValue('\uFEFF\\\\server\\試験用,winspool,Ne02:\r\n'), '\\\\server\\試験用');
  assert.equal(parseDeviceValue('名前,だけ'), '名前');
  assert.equal(parseDeviceValue(''), null);
  assert.equal(parseDeviceValue(null), null);
});

test('PowerShell の出力（JSON）を読む。読めない時は null', () => {
  assert.deepEqual(parseConfigOutput('\uFEFF{"paperSize":"A4","color":true}\r\n'), { paperSize: 'A4', color: true });
  assert.equal(parseConfigOutput(''), null);
  assert.equal(parseConfigOutput('Get-PrintConfiguration : エラー'), null);
  assert.equal(parseConfigOutput('null'), null);
});

test('ログに残す文から、プリンター名を伏せる', () => {
  assert.equal(redact('プリンター 試験用(手差し) が見つかりません: 試験用(手差し)', '試験用(手差し)'), 'プリンター <printer> が見つかりません: <printer>');
  assert.equal(redact('そのまま', ''), 'そのまま');
});

// 偽物の execFile。呼ばれた引数と環境変数を控え、決めた結果を返す。
function fakeExecFile(answer) {
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args, env: options.env, windowsHide: options.windowsHide });
    const { error = null, stdout = '', stderr = '' } = answer(calls.length, options.env);
    setImmediate(() => callback(error, stdout, stderr));
  };
  return { calls, execFile };
}

const CONFIG_JSON = JSON.stringify({ paperSize: 'A4', duplexingMode: 'OneSided', color: true, collate: true, ticket: ticketXml(), caps: capsXml() });

test('プリンター名はコマンドの文字列に入れず、環境変数で PowerShell に渡す', async () => {
  const fake = fakeExecFile(() => ({ stdout: CONFIG_JSON }));
  const printers = createPrinterConfig({ execFile: fake.execFile, spawn: () => null, env: { SystemRoot: 'C:\\Windows' } });
  const config = await printers.config('試験用プリンター "引用符"');
  assert.equal(config.ok, true);
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(call.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.ok(!call.args.join(' ').includes('試験用プリンター'), 'コマンドの文字列にプリンター名が無い');
  assert.ok(!call.args[3].includes('"'), 'PowerShell の文に二重引用符が無い');
  assert.equal(call.env.SIGK_PRINTER, '試験用プリンター "引用符"');
  assert.equal(call.windowsHide, true);
});

test('同じプリンターの取得は、成功した結果を保持して PowerShell を 2 回起こさない', async () => {
  const fake = fakeExecFile(() => ({ stdout: CONFIG_JSON }));
  const printers = createPrinterConfig({ execFile: fake.execFile, spawn: () => null, env: {} });
  const [first, second] = await Promise.all([printers.config('試験用A'), printers.config('試験用A')]);
  assert.equal(first, second);
  await printers.config('試験用A');
  assert.equal(fake.calls.length, 1);
  await printers.config('試験用B');
  assert.equal(fake.calls.length, 2);
  printers.invalidate('試験用A');
  await printers.config('試験用A');
  assert.equal(fake.calls.length, 3);
});

test('取得に失敗したら A4 の初期値を返し、保持せずに次は取り直す。ログにプリンター名を残さない', async () => {
  const error = Object.assign(new Error('Command failed: 試験用(手差し)'), { killed: false });
  const fake = fakeExecFile((count) => (count === 1 ? { error, stderr: 'プリンター 試験用(手差し) が見つかりません' } : { stdout: CONFIG_JSON }));
  const logs = [];
  const printers = createPrinterConfig({ execFile: fake.execFile, spawn: () => null, logError: (entry) => logs.push(entry), env: {} });
  const failed = await printers.config('試験用(手差し)');
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'failed');
  assert.equal(failed.paper.name, 'A4');
  assert.equal(logs.length, 1);
  assert.ok(!JSON.stringify(logs).includes('試験用(手差し)'), 'ログにプリンター名が無い');
  assert.equal((await printers.config('試験用(手差し)')).ok, true);
  assert.equal(fake.calls.length, 2);
});

test('時間切れは reason: timeout、空の名前は PowerShell を起こさない', async () => {
  const fake = fakeExecFile(() => ({ error: Object.assign(new Error('timeout'), { killed: true }) }));
  const printers = createPrinterConfig({ execFile: fake.execFile, spawn: () => null, env: {} });
  assert.equal((await printers.config('試験用')).reason, 'timeout');
  assert.equal((await printers.config('')).reason, 'invalid');
  assert.equal(fake.calls.length, 1);
});

test('既定のプリンターは Device の値から読み、失敗したら null', async () => {
  const ok = createPrinterConfig({ execFile: fakeExecFile(() => ({ stdout: '試験用プリンター,winspool,Ne00:\r\n' })).execFile, spawn: () => null, env: {} });
  assert.equal(await ok.defaultPrinter(), '試験用プリンター');
  const logs = [];
  const ng = createPrinterConfig({ execFile: fakeExecFile(() => ({ error: new Error('denied') })).execFile, spawn: () => null, logError: (entry) => logs.push(entry), env: {} });
  assert.equal(await ng.defaultPrinter(), null);
  assert.equal(logs.length, 1);
});

test('［プロパティ(P)］は printui.dll の印刷設定の画面を開き、閉じたら取得結果を捨てる', async () => {
  const fake = fakeExecFile(() => ({ stdout: CONFIG_JSON }));
  const spawned = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    spawned.push({ file, args, options });
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
  const printers = createPrinterConfig({ execFile: fake.execFile, spawn, env: { SystemRoot: 'C:\\Windows' } });
  await printers.config('試験用 プリンター');
  const result = await printers.openPreferences('試験用 プリンター');
  assert.deepEqual(result, { ok: true, code: 0 });
  assert.deepEqual(spawned[0].file, 'C:\\Windows\\System32\\rundll32.exe');
  assert.deepEqual(spawned[0].args, ['printui.dll,PrintUIEntry', '/e', '/n', '試験用 プリンター']);
  assert.notEqual(spawned[0].options.windowsHide, true, '印刷設定の画面を隠さない');
  await printers.config('試験用 プリンター');
  assert.equal(fake.calls.length, 2, '閉じた後は取り直す');
});

test('印刷設定の画面を開けない時は ok: false とログ', async () => {
  const logs = [];
  const throwing = createPrinterConfig({ execFile: () => {}, spawn: () => { throw new Error('ENOENT'); }, logError: (entry) => logs.push(entry), env: {} });
  assert.deepEqual(await throwing.openPreferences('試験用'), { ok: false });
  const failing = createPrinterConfig({
    execFile: () => {},
    spawn: () => { const child = new EventEmitter(); setImmediate(() => child.emit('error', new Error('denied'))); return child; },
    logError: (entry) => logs.push(entry),
    env: {},
  });
  assert.deepEqual(await failing.openPreferences('試験用'), { ok: false });
  assert.equal(logs.length, 2);
});

// ---- 印刷の指定（print-job-options.js） ----

test('印刷画面の［印刷］（silent）は、用紙を必ず指定し、余白 0 で直接送る', () => {
  const settings = buildPrintSettings({ silent: true, deviceName: '試験用プリンター' });
  assert.deepEqual(settings, {
    silent: true, printBackground: true, deviceName: '試験用プリンター',
    copies: 1, collate: true, color: true, duplexMode: 'simplex', landscape: false,
    margins: { marginType: 'none' }, usePrinterDefaultPageSize: true,
  });
});

test('部数・部単位・白黒・両面・向き・用紙の寸法を、型と範囲を確かめてから渡す', () => {
  const settings = buildPrintSettings({
    silent: true, copies: 3, collate: false, color: false, duplexMode: 'shortEdge', landscape: true, pageSize: { width: 420000, height: 297000 },
  });
  assert.equal(settings.copies, 3);
  assert.equal(settings.collate, false);
  assert.equal(settings.color, false);
  assert.equal(settings.duplexMode, 'shortEdge');
  assert.equal(settings.landscape, true);
  assert.deepEqual(settings.pageSize, { width: 297000, height: 420000 }, '寸法は縦長の向きで渡す');
  assert.equal('usePrinterDefaultPageSize' in settings, false, 'pageSize と同時に指定しない');

  assert.equal(buildPrintSettings({ silent: true, copies: 5000 }).copies, 999);
  assert.equal(buildPrintSettings({ silent: true, copies: 0 }).copies, 1);
  assert.equal(buildPrintSettings({ silent: true, copies: '2' }).copies, 2);
  assert.equal(buildPrintSettings({ silent: true, copies: 1.5 }).copies, 1);
  assert.equal(buildPrintSettings({ silent: true, duplexMode: 'both' }).duplexMode, 'simplex');
  assert.equal(buildPrintSettings({ silent: true, pageSize: { width: 10, height: 297000 } }).usePrinterDefaultPageSize, true);
  assert.equal(buildPrintSettings({ silent: true, pageSize: 'A4' }).usePrinterDefaultPageSize, true);
});

test('silent でない印刷（Windows の印刷画面）は、以前と同じくプリンター名だけを渡す', () => {
  assert.deepEqual(buildPrintSettings({ silent: false }), { silent: false, printBackground: true });
  assert.deepEqual(buildPrintSettings(null), { silent: false, printBackground: true });
  assert.deepEqual(buildPrintSettings({ deviceName: '' }), { silent: false, printBackground: true });
});
