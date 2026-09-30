(function (root) {
  'use strict';

  // 右パネルのヒントの文言と選び方（spec-4-1 確定事項4、spec-4-2 確定事項2、spec-4-3 確定事項2、spec-4-4 確定事項6、
  // spec-4b-1a 確定事項13、spec-4b-1b 確定事項4）。DOM に触れない。annotation-props.js が選んだ書き込みか道具に合わせて出す。

  const HINTS = Object.freeze({
    selected: 'Delete で消せます。Esc で選択を解除します。Ctrl+Z で元に戻せます。',
    tool: '文字をなぞると付きます。先に文字を選んでから道具を押しても付きます。',
    none: '上の道具を選ぶか、文字を選んでから道具を押してください。',
    text: '紙の上を押すと、そこに文字を置けます。Enter で改行、枠の外を押すか Ctrl+Enter で確定します。',
    textSelected: 'ダブルクリックか Enter で直せます。掴んで動かせます。Delete で消せます。Ctrl+Z で元に戻せます。',
    shape: '紙の上をドラッグすると描けます。Shift を押しながらで正方形・正円・45° 刻みになります。Esc で道具を離します。',
    pen: '紙の上をなぞると線が引けます。1 回のなぞりが 1 つの書き込みになります。Esc で道具を離します。',
    shapeSelected: '掴んで動かせます。Delete で消せます。Ctrl+Z で元に戻せます。',
    note: '紙の上を押すと、そこに付箋を置けます。本文は「本文」の欄に書きます。Esc で道具を離します。',
    noteSelected: '本文は欄の外を押すか Ctrl+Enter で確定します。掴んで動かせます。Delete で消せます。Ctrl+Z で元に戻せます。',
    readonly: '他のアプリで付けた書き込みです。Delete で消せます。直すことはできません。',
    // 四角・丸に添える（spec-4b-1b 確定事項4）。塗りの一文は塗りがあるときだけ。
    box: '線と塗りを両方「なし」にはできません。',
    fill: '塗りは下の文字を隠すだけで、文字は検索やコピーで取り出せます。',
  });

  function entryKinds() {
    return root.SigK.annotationEntry;
  }

  // 四角・丸のヒントに添える文。
  function boxHintOf(kind, fill) {
    if (!root.SigK.shapeStyle.isBoxedKind(kind))
      return '';
    return fill === null ? HINTS.box : `${HINTS.box}${HINTS.fill}`;
  }

  function forSelected(entry) {
    if (entry.readonly === true)
      return HINTS.readonly;
    if (entry.kind === 'text')
      return HINTS.textSelected;
    if (entryKinds()?.isNoteKind(entry.kind) === true)
      return HINTS.noteSelected;
    if (entryKinds()?.isDrawnKind(entry.kind) !== true)
      return HINTS.selected;
    return `${HINTS.shapeSelected}${boxHintOf(entry.kind, root.SigK.shapeStyle.fillOf(entry))}`;
  }

  // 道具を持っているとき（kind はその道具が描く種類。図形は道具の段で選んだ種類）。道具が無ければ tool は null。
  function forTool(tool, kind, fill) {
    if (tool === null)
      return HINTS.none;
    return `${HINTS[tool] ?? HINTS.tool}${boxHintOf(kind, fill)}`;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationHints = { HINTS, forSelected, forTool };
})(typeof window !== 'undefined' ? window : globalThis);
