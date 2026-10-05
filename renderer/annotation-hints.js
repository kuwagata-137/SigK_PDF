(function (root) {
  'use strict';

  // 右パネルのヒントの文言と選び方（spec-4-1 確定事項4、spec-4-2 確定事項2、spec-4-3 確定事項2、spec-4-4 確定事項6、
  // spec-4b-1a 確定事項13、spec-4b-1b 確定事項4、spec-4b-3a 確定事項C5・I1、spec-4b-3b 確定事項A6）。DOM に触れない。annotation-props.js が選んだ書き込みか道具に合わせて出す。

  const HINTS = Object.freeze({
    selected: 'Delete で消せます。Esc で選択を解除します。Ctrl+Z で元に戻せます。',
    tool: '文字をなぞると付きます。先に文字を選んでから道具を押しても付きます。',
    none: '上の道具を選ぶか、文字を選んでから道具を押してください。',
    text: '紙の上を押すと、そこに文字を置けます。Enter で改行、枠の外を押すか Ctrl+Enter で確定します。',
    // 幅のつまみの説明は「掴んで動かせます。」のあと（spec-4b-4a 確定事項F。図形の spec-4b-2 確定事項28 と同じ並び）。
    textSelected: 'ダブルクリックか Enter で直せます。掴んで動かせます。左右の白いつまみで幅を変えると、文字はその幅で折り返します。丸いつまみを引くと回ります（Shift で 15° ずつ）。Delete で消せます。Ctrl+Z で元に戻せます。',
    // 吹き出し（spec-4b-4b 確定事項F6）。
    callout: '紙の上を押すと、そこに吹き出しを置けます。Enter で改行、枠の外を押すか Ctrl+Enter で確定します。しっぽの先は、置いたあとで白いつまみを引くと動きます。',
    calloutSelected: 'ダブルクリックか Enter で直せます。掴んで動かせます。しっぽの先の白いつまみを引くと、しっぽの向きが変わります（Shift で水平か垂直）。左右の白いつまみで幅を、丸いつまみで向きを変えられます。Delete で消せます。Ctrl+Z で元に戻せます。',
    shape: '紙の上をドラッグすると描けます。Shift を押しながらで正方形・正円・45° 刻みになります。Esc で道具を離します。',
    pen: '紙の上をなぞると線が引けます。1 回のなぞりが 1 つの書き込みになります。Esc で道具を離します。',
    shapeSelected: '掴んで動かせます。Delete で消せます。Ctrl+Z で元に戻せます。',
    // 四角・丸と直線・矢印を選んだときに「掴んで動かせます。」のあとへ挟む（spec-4b-2 確定事項28）。
    move: '掴んで動かせます。',
    boxTransform: '四隅と辺の白いつまみで大きさを、上の丸いつまみで向きを変えられます。Shift を押しながら引くと、四隅のつまみは縦と横の比を保ち、向きは 15° ずつ回ります。',
    lineTransform: '両端の白いつまみで向きと長さを変えられます。Shift を押しながら動かすと、端は横か縦にだけ動きます。',
    note: '紙の上を押すと、そこに付箋を置けます。本文は「本文」の欄に書きます。Esc で道具を離します。',
    noteSelected: '本文は欄の外を押すか Ctrl+Enter で確定します。掴んで動かせます。Delete で消せます。Ctrl+Z で元に戻せます。',
    readonly: '他のアプリで付けた書き込みです。Delete で消せます。直すことはできません。',
    // 四角・丸に添える（spec-4b-1b 確定事項4）。塗りの一文は塗りがあるときだけ。
    box: '線と塗りを両方「なし」にはできません。',
    fill: '塗りは下の文字を隠すだけで、文字は検索やコピーで取り出せます。',
    // 2 件以上を選んでいるとき（spec-4b-3a 確定事項I1）。
    // 「選択」の道具を持っていて、何も選んでいないとき（spec-4b-3a 確定事項C5）。
    select: '紙の上を引くと、囲んだ書き込みを選びます（Ctrl か Shift で足す）。もう一度押すか Esc で道具を外します。',
    // 「ハンド」の道具を持っていて、何も選んでいないとき（spec-4b-3b 確定事項A6）。
    hand: '紙を引くと表示が動きます。ホイールで拡大・縮小します。書き込みの上で右クリックすると削除できます。もう一度押すか Esc で道具を外します。',
    multi: '掴むとまとめて動き、Ctrl を押しながら引くと写しを作ります（Shift で横か縦だけ）。Ctrl を押しながら押すと選ぶ・外すを切り替えます。Delete で消せます。',
  });

  function entryKinds() {
    return root.SigK.annotationEntry;
  }

  // 四角・丸・閉じた多角形（fillable）のヒントに添える文。
  function boxHintOf(fillable, fill) {
    if (!fillable)
      return '';
    return fill === null ? HINTS.box : `${HINTS.box}${HINTS.fill}`;
  }

  function forSelected(entry) {
    if (entry.readonly === true)
      return HINTS.readonly;
    if (entry.kind === 'text')
      return entry.callout === undefined ? HINTS.textSelected : HINTS.calloutSelected;
    if (entryKinds()?.isNoteKind(entry.kind) === true)
      return HINTS.noteSelected;
    if (entryKinds()?.isDrawnKind(entry.kind) !== true)
      return HINTS.selected;
    // つまみの説明は「掴んで動かせます。」のあと（spec-4b-2 確定事項28）。ペンはつまみを出さない。
    const transform = { square: HINTS.boxTransform, circle: HINTS.boxTransform, cross: HINTS.boxTransform, line: HINTS.lineTransform, arrow: HINTS.lineTransform }[entry.kind] ?? '';
    const shape = HINTS.shapeSelected.replace(HINTS.move, `${HINTS.move}${transform}`);
    return `${shape}${boxHintOf(root.SigK.shapeStyle.canFill(entry), root.SigK.shapeStyle.fillOf(entry))}`;
  }

  // 道具を持っているとき（kind はその道具が描く種類。図形は道具の段で選んだ種類）。道具が無ければ tool は null。
  function forTool(tool, kind, fill) {
    if (tool === null)
      return HINTS.none;
    return `${HINTS[tool] ?? HINTS.tool}${boxHintOf(root.SigK.shapeStyle.isFillableKind(kind), fill)}`;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationHints = { HINTS, forSelected, forTool };
})(typeof window !== 'undefined' ? window : globalThis);
