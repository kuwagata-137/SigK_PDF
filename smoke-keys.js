'use strict';

// 起動確認 SIGK_SMOKE_KEYS=<操作列>（spec-4b-7a 確定事項J）。main.js の installSmokeCheck が使う。
// SIGK_SMOKE_PDF で開いた文書に、キーとマウスを main から debugger の Input.dispatchKeyEvent・Input.dispatchMouseEvent で
// 本物の入力（isTrusted）として流す（事前調査 S）。窓の取りやめ（close request）とスライダーのつまみは、本物の入力でしか動かない。
//
// 操作は , 区切り。
//   esc / key:<名前>（Delete・Enter・ctrl+z・ctrl+- など）/ type:<文字> / zoomout:<回数>（Ctrl+−）
//   press:<page>:<x>x<y> / drag:<page>:<x>x<y> / release（紙の座標 pt で本物のマウス。drag は押したまま動かす）
//   slide:<id>:<割合>:<割合>（スライダーを押して動かす。離さない）/ thumb-drag:<from>-<to>（サムネイルを押して動かす。離さない）
//   shape:<kind>:<page>:<x1>x<y1>-<x2>x<y2>（合成のマウスで描く）
//   mode・find・dialog:<info|print>・print-prepare・focus:<id|none>・select-pages:<a>-<b>・select-text:<page>・zoom・facing:<on|off>・
//   fit・scroll:<割合>（画面の口を呼ぶ。smoke-keys-page.js）
//   wait:<ms> / state（様子を控える）/ memory（アプリ全体の実メモリを控える）
// 例: SIGK_SMOKE_KEYS=mode:annot,shape:square:0:100x700-300x600,find:text,dialog:info,esc,state,esc,state
//
// 数・範囲が読めない操作は、黙って 0 回にせず、止めて problems に書く。mode・facing は設定に残るので、起動確認の決まりどおり
// --user-data-dir=<scratchpad> で常用の設定から切り離して流す。操作の相手は、その時に映しているタブ（SIGK_SMOKE_DROP と一緒に
// 使えば、落としたファイルのタブ）。

const page = require('./smoke-keys-page.js');

// キーの名前 → [windowsVirtualKeyCode, code]。
const KEYS = {
  Escape: [27, 'Escape'], Delete: [46, 'Delete'], Backspace: [8, 'Backspace'], Enter: [13, 'Enter'],
  PageDown: [34, 'PageDown'], PageUp: [33, 'PageUp'], Home: [36, 'Home'], End: [35, 'End'], Tab: [9, 'Tab'], F3: [114, 'F3'],
  ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], '-': [189, 'Minus'], '=': [187, 'Equal'],
  f: [70, 'KeyF'], p: [80, 'KeyP'], w: [87, 'KeyW'], y: [89, 'KeyY'], z: [90, 'KeyZ'],
};

// 'ctrl+z' → Input.dispatchKeyEvent の引数（type を除く）。知らない名前は null。
function keyEvent(name) {
  const text = String(name);
  const plus = text.lastIndexOf('+', text.length - 2);
  const key = plus < 0 ? text : text.slice(plus + 1);
  const mods = plus < 0 ? [] : text.slice(0, plus).toLowerCase().split('+');
  const entry = KEYS[key];
  if (entry === undefined)
    return null;
  const modifiers = (mods.includes('alt') ? 1 : 0) | (mods.includes('ctrl') ? 2 : 0) | (mods.includes('shift') ? 8 : 0);
  return { key, code: entry[1], windowsVirtualKeyCode: entry[0], nativeVirtualKeyCode: entry[0], modifiers };
}

// 'esc,key:Delete,press:0:100x700' → [{ raw, name, args }]。空の項目は飛ばす。
function parseSpec(spec) {
  return String(spec ?? '').split(',').map((raw) => raw.trim()).filter((raw) => raw.length > 0).map((raw) => {
    const [name, ...args] = raw.split(':');
    return { raw, name, args };
  });
}

// 数として読む。読めなければ止める（黙って 0 にしない）。
function numberOf(text, label) {
  const value = Number(text);
  if (String(text ?? '').trim() === '' || !Number.isFinite(value))
    throw new Error(`${label} を数として読めない: ${text}`);
  return value;
}

// '100x700' → [100, 700]。
function pointOf(text) {
  const parts = String(text).split('x');
  if (parts.length !== 2)
    throw new Error(`座標は <x>x<y> で書く: ${text}`);
  return parts.map((part) => numberOf(part, '座標'));
}

// '0-3' → [0, 3]。
function spanOf(text) {
  const parts = String(text).split('-');
  if (parts.length !== 2)
    throw new Error(`範囲は <a>-<b> で書く: ${text}`);
  return parts.map((part) => numberOf(part, '範囲'));
}

// 画面の操作の引数を、流す前に確かめる。
const CHECK_ACTION = {
  'select-pages': (arg) => spanOf(arg),
  'select-text': (arg) => numberOf(arg, 'ページ'),
  zoom: (arg) => numberOf(arg, '倍率'),
  scroll: (arg) => numberOf(arg, '割合'),
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendKey(ctx, name) {
  const event = keyEvent(name);
  if (event === null)
    throw new Error(`知らないキー: ${name}`);
  await ctx.dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event });
  await ctx.dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
  await wait(150);
}

async function mouse(ctx, type, [x, y], buttons) {
  await ctx.dbg.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1 });
  ctx.last = [x, y];
  await wait(60);
}

// 押したまま to へ 3 回に分けて動かす（掴む判定と落とす判定が同じフレームに来ないように）。
async function moveTo(ctx, to) {
  const from = ctx.last ?? to;
  for (const ratio of [0.34, 0.67, 1])
    await mouse(ctx, 'mouseMoved', [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio], 1);
}

async function pressAt(ctx, point) {
  await mouse(ctx, 'mouseMoved', point, 0);
  await mouse(ctx, 'mousePressed', point, 1);
}

const OPS = {
  esc: (ctx) => sendKey(ctx, 'Escape'),
  key: (ctx, args) => sendKey(ctx, args.join(':')),
  type: async (ctx, args) => {
    await ctx.dbg.sendCommand('Input.insertText', { text: args.join(':') });
    await wait(100);
  },
  zoomout: async (ctx, [count]) => {
    for (let index = 0; index < numberOf(count, '回数'); index += 1)
      await sendKey(ctx, 'ctrl+-');
  },
  press: async (ctx, [index, at]) => pressAt(ctx, await ctx.js(page.pointScript(index, ...pointOf(at)))),
  drag: async (ctx, [index, at]) => moveTo(ctx, await ctx.js(page.pointScript(index, ...pointOf(at)))),
  release: (ctx) => mouse(ctx, 'mouseReleased', ctx.last ?? [0, 0], 0),
  slide: async (ctx, [id, from, to]) => {
    const box = await ctx.js(page.boxScript(id));
    if (box === null)
      throw new Error(`要素が無い: ${id}`);
    const at = (ratio) => [box.left + box.width * numberOf(ratio, '割合'), box.top + box.height / 2];
    await pressAt(ctx, at(from));
    await moveTo(ctx, at(to));
  },
  'thumb-drag': async (ctx, [span]) => {
    const [from, to] = spanOf(span);
    await pressAt(ctx, await ctx.js(page.thumbScript(from)));
    await moveTo(ctx, await ctx.js(page.thumbScript(to)));
  },
  shape: (ctx, [kind, index, span]) => ctx.js(page.shapeScript(kind, numberOf(index, 'ページ'), ...String(span).split('-').map(pointOf))),
  wait: (ctx, [ms]) => wait(numberOf(ms, '待ち時間')),
  state: async (ctx, args, step) => {
    ctx.states.push({ at: step.index, ...(await ctx.js(page.stateScript)) });
  },
  // アプリ全体の実メモリ（MB。main.js の memorySnapshot と同じ数え方）。electron は起動確認のときだけ読む（テストは node で読む）。
  memory: async (ctx, args, step) => {
    const metrics = require('electron').app.getAppMetrics();
    const kb = metrics.reduce((sum, entry) => sum + (entry.memory?.workingSetSize ?? 0), 0);
    ctx.states.push({ at: step.index, memoryMb: Math.round(kb / 1024 * 10) / 10 });
  },
};

// 1 つの操作を流す。
async function runStep(ctx, step, index) {
  const op = OPS[step.name];
  if (op !== undefined)
    return op(ctx, step.args, { ...step, index });
  const arg = step.args.join(':');
  const script = page.actionScript(step.name, arg);
  if (script === null)
    throw new Error('知らない操作');
  CHECK_ACTION[step.name]?.(arg);
  return ctx.js(script);
}

// 操作列を流し、控えた様子を返す。失敗した操作は、その操作の名前を添えて problems に書き、そこで止める。
async function run(win, spec) {
  const steps = parseSpec(spec);
  const ctx = { dbg: win.webContents.debugger, js: (code) => win.webContents.executeJavaScript(code), last: null, states: [] };
  const applied = [];
  const problems = [];
  let current = '(attach)';
  try {
    ctx.dbg.attach('1.3');
    for (const [index, step] of steps.entries()) {
      current = step.raw;
      await runStep(ctx, step, index);
      applied.push(step.raw);
      await wait(120);
    }
  } catch (err) {
    problems.push(`smoke-keys: ${current}: ${err.message}`);
  } finally {
    if (ctx.dbg.isAttached())
      ctx.dbg.detach();
  }
  return { applied, states: ctx.states, problems };
}

module.exports = { KEYS, keyEvent, parseSpec, pointOf, spanOf, numberOf, run, OP_NAMES: Object.keys(OPS) };
