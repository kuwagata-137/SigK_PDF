'use strict';

// プリンターの既定の設定を Windows から取得する（docs/spec-7-7-print-dialog.md 確定事項C3）。
//
// Electron の getPrintersAsync は、既定のプリンター・用紙・両面・印刷可能領域を返さない。そこで、
// 既定のプリンターはレジストリの Device の値を読む。用紙などは、PowerShell で System.Printing の印刷チケットを読む
// （CONFIG_SCRIPT。読めない時は Get-PrintConfiguration）。
// ［プロパティ(P)］で開く印刷設定の画面（質問 PR1 案A）は printui.dll で開く。
// どれも外部のコマンドなので、実行する関数（execFile・spawn）は外から渡す（試験では偽物を渡す）。
// プリンター名はコマンドの文字列に埋め込まず、環境変数か引数で渡す（名前の記号でコマンドが壊れないように）。
// PowerShell の文は単一引用符だけで書く（二重引用符はコマンドラインの引用符の処理と混ざるため）。

const path = require('node:path');
const { buildConfig, fallbackConfig } = require('./printer-xml.js');

const QUERY_TIMEOUT = 20000;
// 能力情報の XML は、ドライバーによっては数百 KB になる。
const MAX_BUFFER = 32 * 1024 * 1024;

const PS_PREFIX = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
];

const DEFAULT_SCRIPT = [
  ...PS_PREFIX,
  "(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name Device).Device",
].join('; ');

// System.Printing（.NET の印刷機能）で印刷チケットと能力情報を読む手順（決定97 ④）。
// 印刷設定（［プロパティ(P)］で開く画面）が変更するのは、ユーザーごとの設定値（UserPrintTicket）である。
// Get-PrintConfiguration はプリンター全体の既定値（DefaultPrintTicket と同じ値）を返すので、印刷設定で変更した用紙が読めない。
// ユーザーごとの設定値が無いプリンターは、プリンター全体の既定値を読む。能力情報は、読んだ印刷チケットに対する値を読む。
// 印刷可能領域は、その印刷チケットで指定した用紙の値になる。
// \\サーバー\名前 の形のプリンター名はネットワークプリンターなので、そのサーバーの PrintServer から取得する。
// カラーと部単位は、印刷チケットに指定が無い時に Get-PrintConfiguration と同じ値（白黒・部単位）になるように決める。
// 2026-11-17 に、このパソコンのプリンター 29 台で、両面・カラー・部単位が修正前と同じ値になることを確認した。
const TICKET_STEPS = [
  'Add-Type -AssemblyName System.Printing',
  '$n = $env:SIGK_PRINTER',
  String.raw`if ($n -match '^(\\\\[^\\]+)\\(.+)$') { $q = (New-Object System.Printing.PrintServer($Matches[1])).GetPrintQueue($Matches[2]) }`
    + ' else { $q = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($n) }',
  "$t = $q.UserPrintTicket; $src = 'user'",
  "if ($t -eq $null) { $t = $q.DefaultPrintTicket; $src = 'default' }",
  '$tx = (New-Object System.IO.StreamReader($t.GetXmlStream())).ReadToEnd()',
  '$cx = (New-Object System.IO.StreamReader($q.GetPrintCapabilitiesAsXml($t))).ReadToEnd()',
  '$paper = [string]$t.PageMediaSize.PageMediaSizeName',
  '$dup = [string]$t.Duplexing',
  "$col = [string]$t.OutputColor -eq 'Color'",
  "$coll = [string]$t.Collation -ne 'Uncollated'",
].join('; ');

// System.Printing で読めない時は、以前と同じく Get-PrintConfiguration（プリンター全体の既定値）を読む。
const PRINTCONFIG_STEPS = [
  '$c = Get-PrintConfiguration -PrinterName $env:SIGK_PRINTER',
  "$src = 'printconfig'",
  '$paper = [string]$c.PaperSize',
  '$dup = [string]$c.DuplexingMode',
  '$col = [bool]$c.Color',
  '$coll = [bool]$c.Collate',
  '$tx = [string]$c.PrintTicketXML',
  '$cx = [string]$c.PrintCapabilitiesXML',
].join('; ');

// source は読み取り元（'user' はユーザーごとの設定値、'default' はプリンター全体の既定値、'printconfig' は
// Get-PrintConfiguration）。
const CONFIG_SCRIPT = [
  ...PS_PREFIX,
  `try { ${TICKET_STEPS} } catch { ${PRINTCONFIG_STEPS} }`,
  '[pscustomobject]@{ source = $src; paperSize = $paper; duplexingMode = $dup; color = $col; collate = $coll; ticket = $tx; caps = $cx } '
    + '| ConvertTo-Json -Compress',
].join('; ');

function systemExe(env, ...parts) {
  return path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', ...parts);
}

// Device の値は「プリンター名,winspool,ポート名」の形。名前の後ろの 2 つを外す。
function parseDeviceValue(text) {
  const value = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (value === '')
    return null;
  const parts = value.split(',');
  const name = (parts.length >= 3 ? parts.slice(0, -2).join(',') : parts[0]).trim();
  return name === '' ? null : name;
}

function parseConfigOutput(text) {
  const body = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (body === '')
    return null;
  try {
    const raw = JSON.parse(body);
    return raw !== null && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function runFile(execFile, file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderrText = String(stderr ?? '').slice(0, 2000);
        reject(error);
        return;
      }
      resolve(String(stdout ?? ''));
    });
  });
}

// PowerShell のエラー文にはプリンター名が入ることがある。社内の名前なので、ログに残す前に伏せる。
function redact(text, name) {
  const value = String(text ?? '');
  return typeof name === 'string' && name !== '' ? value.split(name).join('<printer>') : value;
}

function errorContext(error, name = null) {
  return { where: 'printer-config', stderr: redact(error?.stderrText, name) };
}

function createPrinterConfig({ execFile, spawn, logError = () => {}, env = process.env }) {
  const powershell = systemExe(env, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const rundll32 = systemExe(env, 'rundll32.exe');
  // プリンターごとの取得結果。取得中は同じ Promise を返し、PowerShell を 2 回起こさない。成功だけを保持する。
  const cache = new Map();

  function runPowerShell(script, extraEnv = {}) {
    return runFile(execFile, powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: QUERY_TIMEOUT, maxBuffer: MAX_BUFFER, env: { ...env, ...extraEnv },
    });
  }

  async function defaultPrinter() {
    try {
      return parseDeviceValue(await runPowerShell(DEFAULT_SCRIPT));
    } catch (error) {
      logError({ message: '既定のプリンターを取得できませんでした', stack: error?.stack, context: errorContext(error) });
      return null;
    }
  }

  async function query(name) {
    try {
      const raw = parseConfigOutput(await runPowerShell(CONFIG_SCRIPT, { SIGK_PRINTER: name }));
      if (raw === null)
        return fallbackConfig('unreadable');
      return buildConfig(raw);
    } catch (error) {
      logError({ message: 'プリンターの設定を取得できませんでした', stack: redact(error?.stack, name), context: errorContext(error, name) });
      return fallbackConfig(error?.killed === true ? 'timeout' : 'failed');
    }
  }

  function config(name) {
    if (typeof name !== 'string' || name === '')
      return Promise.resolve(fallbackConfig('invalid'));
    if (cache.has(name))
      return cache.get(name);
    const pending = query(name).then((result) => {
      if (result.ok !== true)
        cache.delete(name);
      return result;
    });
    cache.set(name, pending);
    return pending;
  }

  function invalidate(name) {
    cache.delete(name);
  }

  // 印刷設定の画面を開き、閉じるまで待つ。閉じたら取得結果を捨てる（次の config で取り直す）。
  // windowsHide を付けない（付けると、印刷設定の画面そのものが隠れることがある）。
  function openPreferences(name) {
    return new Promise((resolve) => {
      const done = (result) => {
        cache.delete(name);
        resolve(result);
      };
      let child = null;
      try {
        child = spawn(rundll32, ['printui.dll,PrintUIEntry', '/e', '/n', name], { stdio: 'ignore' });
      } catch (error) {
        logError({ message: '印刷設定の画面を開けませんでした', stack: error?.stack, context: { where: 'printer-config' } });
        done({ ok: false });
        return;
      }
      child.once('error', (error) => {
        logError({ message: '印刷設定の画面を開けませんでした', stack: error?.stack, context: { where: 'printer-config' } });
        done({ ok: false });
      });
      child.once('exit', (code) => done({ ok: true, code }));
    });
  }

  return { defaultPrinter, config, invalidate, openPreferences };
}

module.exports = { DEFAULT_SCRIPT, CONFIG_SCRIPT, parseDeviceValue, parseConfigOutput, redact, createPrinterConfig };
