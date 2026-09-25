'use strict';

// 起動要求に「同じ操作の束」の印を付ける（spec-5-1 確定事項3〜5・docs/03 3-2）。
//
// エクスプローラーで複数選んで右クリックすると、シェルはファイル 1 つにつき 1 本ずつ
// アプリを起こす（MultiSelectModel=Player でも束ならない。事前調査 A1）。2 本目以降は
// 1 本目へ引数を渡して終わるので、1 本目には要求が 1 件ずつ届く。
//
// **静まるのを待ってまとめる形にはしない**（論点1）。待つと 1 ファイルでも W だけ
// 待たせる。届くたびにすぐ画面へ渡し、「直前の要求と意図が同じで、間隔が W 以下」なら
// 同じ束の印を付ける。束をどう見せるか（名前の順・一覧の置き換え）は画面が決める。
//
// Electron に依存しない純関数にしてある（launch-args.js と同じ作法）。

// 事前調査 A3: 20 個選んでも隣の到着の最大間隔は 362ms（全 50 回）。その 3 倍（1,086ms）より
// 長く取る。間隔は直前の要求から測るので、束の長さ（20 個で最大 1.8 秒）は W を超えてよい。
const BATCH_WINDOW_MS = 2000;

// 時計は戻らないものを使う。Date.now() は OS の時刻合わせで戻ることがある。
const monotonicNow = () => performance.now();

function createLaunchBatcher({ windowMs = BATCH_WINDOW_MS, now = monotonicNow } = {}) {
  let last = null;   // { intent, at }
  let seq = 0;

  // request は parseLaunchArgs の戻り値 { intent, paths }。
  function assign(request) {
    const at = now();
    const continues = last !== null && last.intent === request.intent && at - last.at <= windowMs;
    if (!continues)
      seq += 1;
    last = { intent: request.intent, at };
    return { intent: request.intent, paths: [...request.paths], batch: { id: seq, first: !continues } };
  }

  return { assign };
}

module.exports = { BATCH_WINDOW_MS, createLaunchBatcher };
