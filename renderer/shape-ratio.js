(function (root) {
  'use strict';

  // 「縦横比を固定」のチェックの状態（spec-7-9 確定事項D3・D4）。四角・丸・×印で共通の 1 つで、アプリが記憶する
  // （settings.json の annotKeepRatio）。チェックがある時は、新しく描く四角・丸・×印を正方形・正円にし（shape-draft.js）、角と辺の
  // ハンドルで縦横比を保ち（shape-resize.js）、大きさの数値欄で入力していない側を今の縦横比で変える（annotation-size-row.js）。

  let kept = false;

  function persist(patch) {
    root.SigK.shell?.persist?.(patch);
  }

  function refresh() {
    root.SigK.annotationProps?.refresh();
  }

  function isKept() {
    return kept;
  }

  // その種類で縦横比を保つか（チェックがあり、四角・丸・×印の時だけ）。
  function keepsFor(kind) {
    return kept && root.SigK.shapeSize?.isBoxKind(kind) === true;
  }

  // 起動時に settings.json から戻す。真偽値でなければ捨てる。
  function apply(value) {
    if (typeof value === 'boolean')
      kept = value;
    refresh();
    return kept;
  }

  // チェック欄から。変わった時だけ記憶する。
  function setKept(value) {
    if (typeof value !== 'boolean' || value === kept)
      return false;
    kept = value;
    persist({ annotKeepRatio: value });
    refresh();
    return true;
  }

  function reset() {
    kept = false;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeRatio = { isKept, keepsFor, apply, setKept, reset };
})(typeof window !== 'undefined' ? window : globalThis);
