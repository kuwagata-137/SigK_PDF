'use strict';

// 起動確認（SIGK_SMOKE=1）の窓の出し方を、環境変数から決める（spec-4-5 確定事項46）。
// Electron を読まない純関数で、main.js の start と installSmokeCheck が使う。
//
// SIGK_SMOKE_HIDDEN=1 を足すと主窓を出さずに回す（ユーザー全体のルール 2026-09-18
// 「動作確認で別アプリの窓を出さない」。main.js が offscreen 描画の窓にする）。SIGK_SMOKE_PERF は「窓を出すまでの時間」を
// 測るので一緒には効かず、そのときは窓を出して警告を返す。SIGK_SMOKE_DISPLAY
// （決定19 の、別のディスプレイへ寄せる方法）は窓を出すときだけ効く。

const PERF_CONFLICT = 'SIGK_SMOKE_HIDDEN は SIGK_SMOKE_PERF と一緒には効きません（表示までの時間を測るため窓を出しました）';

// 戻り値は { smoke, hidden, display, warning }。display は寄せる先の指定（無ければ null）、
// warning は起動確認の problems に載せる文言（無ければ null）。
function smokeWindowMode(env = {}) {
  const smoke = env.SIGK_SMOKE === '1';
  const wantsHidden = smoke && env.SIGK_SMOKE_HIDDEN === '1';
  const perf = env.SIGK_SMOKE_PERF !== undefined;
  const hidden = wantsHidden && !perf;
  const display = smoke && !hidden && env.SIGK_SMOKE_DISPLAY ? env.SIGK_SMOKE_DISPLAY : null;
  return { smoke, hidden, display, warning: wantsHidden && perf ? PERF_CONFLICT : null };
}

module.exports = { PERF_CONFLICT, smokeWindowMode };
