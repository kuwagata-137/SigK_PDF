'use strict';

// 四角・丸・×印の「縦横比を固定」のチェックの状態（spec-7-9 確定事項D3）。annotation-settings.js が ANNOT_DEFAULTS・
// pickAnnotSettings・mergeAnnotUi のキーの並びへ広げる（200 行の目安で分けた）。
//
//   annotKeepRatio … true か false。四角・丸・×印で共通の 1 つ。既定は false（今までどおり、Shift の時だけ縦横比を保つ）

const DEFAULT_KEEP_RATIO = false;

function ratioDefaults() {
  return { annotKeepRatio: DEFAULT_KEEP_RATIO };
}

// 真偽値だけを受け取る。受け取れなければ fallback、それも真偽値でなければ既定。
function pickKeepRatio(raw, fallback) {
  if (typeof raw === 'boolean')
    return raw;
  return typeof fallback === 'boolean' ? fallback : DEFAULT_KEEP_RATIO;
}

// 読み込んだ値から取り出す。fallback は既定。
function pickRatioSettings(source, fallback) {
  return { annotKeepRatio: pickKeepRatio(source?.annotKeepRatio, fallback?.annotKeepRatio) };
}

// 部分更新。送られていなければ今の値のまま。
function mergeRatioSettings(current, next) {
  return { annotKeepRatio: pickKeepRatio(next?.annotKeepRatio, current?.annotKeepRatio) };
}

module.exports = { DEFAULT_KEEP_RATIO, ratioDefaults, pickRatioSettings, mergeRatioSettings };
