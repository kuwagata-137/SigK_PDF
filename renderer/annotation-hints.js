(function (root) {
  'use strict';

  // 右パネルのヒントの文言と選び方（spec-4-1 確定事項4、spec-4-2 確定事項2、spec-4-3 確定事項2、spec-4-4 確定事項6、
  // spec-4b-1a 確定事項13、spec-4b-1b 確定事項4、spec-4b-3a 確定事項C5・I1、spec-4b-3b 確定事項A6、spec-4b-7b 確定事項F）。DOM に触れない。annotation-props.js が選んだ書き込みか道具に合わせて出す。

  const HINTS = Object.freeze({
    selected: 'Delete で削除できます。Esc で選択を解除します。Ctrl+Z で元に戻せます。',
    tool: '文字をドラッグすると追加されます。先に文字を選択してから書き込みツールを押しても追加されます。',
    none: '上の書き込みツールを選択するか、文字を選択してから書き込みツールを押してください。',
    text: 'ページ上をクリックすると、そこに文字を配置できます。Enter で改行、枠外をクリックするか Ctrl+Enter で確定します。',
    // 幅のつまみの説明は「掴んで動かせます。」のあと（spec-4b-4a 確定事項F。図形の spec-4b-2 確定事項28 と同じ並び）。
    textSelected: 'ダブルクリックか Enter で編集できます。ドラッグで移動できます。左右の白いハンドルで幅を変更すると、文字はその幅で折り返します。丸いハンドルをドラッグすると回転します（Shift で 15° ずつ）。Delete で削除できます。Ctrl+Z で元に戻せます。',
    // 吹き出し（spec-4b-4b 確定事項F6）。
    callout: 'ページ上をクリックすると、そこに吹き出しを配置できます。Enter で改行、枠外をクリックするか Ctrl+Enter で確定します。しっぽの先は、配置したあとで白いハンドルをドラッグすると移動します。',
    calloutSelected: 'ダブルクリックか Enter で編集できます。ドラッグで移動できます。しっぽの先にある白いハンドルをドラッグすると、しっぽの向きが変わります（Shift で本体の向きに水平か垂直）。左右の白いハンドルで幅を、丸いハンドルで向きを変更できます。Delete で削除できます。Ctrl+Z で元に戻せます。',
    // 書き込みの上からのドラッグは描かずに動かす（決定84 ②④。spec-4b-3a 確定事項O7）。
    shape: 'ページ上をドラッグすると描画できます。Shift を押しながらドラッグすると、正方形・正円・45° 刻みになります。移動できる書き込みの上から（中を塗っていない四角・丸は線上から）ドラッグすると、描画せずにその書き込みが移動します。Esc で書き込みツールの選択を解除します。',
    // 多角形の道具（spec-4b-5a 確定事項31）。描いていないときと、描いている途中。
    polygon: 'クリックで頂点を配置します。始点をクリックすると閉じ、ダブルクリックで開いたまま確定します。Shift で 45° 刻みになります。Esc で書き込みツールの選択を解除します。',
    polygonDrawing: '始点をクリックすると閉じます。ダブルクリックで開いたまま確定、Esc か右クリックでキャンセルします。',
    // 直線・矢印の道具に添える（spec-4b-5a 確定事項19・31）。始点を決めたあと。
    lineSnap: '図形の端や角をダブルクリックすると、そこから線を引けます。',
    lineAnchor: 'クリックした所までの線を引きます（Shift で 45° 刻み）。Esc か右クリックでキャンセルします。',
    pen: 'ページ上をドラッグすると線を引けます。1 回のドラッグが 1 つの書き込みになります。Esc で書き込みツールの選択を解除します。',
    // マーカーの道具（spec-4b-5b 確定事項31）。
    marker: 'ページ上をドラッグすると、下の文字が透ける線を引けます。1 回のドラッグが 1 つの書き込みになります。Esc で書き込みツールの選択を解除します。',
    shapeSelected: 'ドラッグで移動できます。Delete で削除できます。Ctrl+Z で元に戻せます。',
    // 四角・丸と直線・矢印を選んだときに「掴んで動かせます。」のあとへ挟む（spec-4b-2 確定事項28）。
    move: 'ドラッグで移動できます。',
    boxTransform: '四隅と辺の白いハンドルでサイズを、上の丸いハンドルで向きを変更できます。Shift を押しながらドラッグすると、四隅のハンドルは縦横比を保ち、向きは 15° ずつ回転します。',
    lineTransform: '両端の白いハンドルで向きと長さを変更できます。Shift を押しながらドラッグすると、端は横か縦にだけ移動します。',
    // 多角形を選んだとき（spec-4b-5a 確定事項31）。
    polygonTransform: '頂点の白いハンドルで形を、上の丸いハンドルで向きを変更できます。Shift を押しながらドラッグすると、頂点は横か縦にだけ移動し、向きは 15° ずつ回転します。',
    note: 'ページ上をクリックすると、そこに付箋を配置できます。本文は「本文」欄に入力します。Esc で書き込みツールの選択を解除します。',
    noteSelected: '本文は欄の外をクリックするか Ctrl+Enter で確定します。ドラッグで移動できます。Delete で削除できます。Ctrl+Z で元に戻せます。',
    readonly: '他のアプリで追加した書き込みです。Delete で削除できますが、編集することはできません。',
    // 四角・丸に添える（spec-4b-1b 確定事項4）。塗りの一文は塗りがあるときだけ。
    box: '線と塗りを両方「なし」にはできません。',
    fill: '塗りは下の文字を隠すだけで、文字は検索やコピーで取得できます。',
    // 2 件以上を選んでいるとき（spec-4b-3a 確定事項I1）。
    // 「選択」の道具を持っていて、何も選んでいないとき（spec-4b-3a 確定事項C5）。
    select: 'ページ上をドラッグすると、囲んだ書き込みを選択します。Ctrl か Shift を押しながらドラッグすると追加します。もう一度押すか Esc でツールの選択を解除します。',
    // 「消しゴム」の道具を持っていて、何も選んでいないとき（spec-4b-5b 確定事項31）。
    eraser: 'ページ上をドラッグすると、ペンとマーカーの線は触れた所だけ、図形は丸ごと削除されます。テキスト・吹き出し・ノート・ハイライト・下線・取り消し線と、他のアプリで追加した書き込みは削除されません。Ctrl+Z で元に戻せます。もう一度押すか Esc で書き込みツールの選択を解除します。',
    // 「ハンド」の道具を持っていて、何も選んでいないとき（spec-4b-3b 確定事項A6。決定84 ③で、動かせる書き込みを選んで動かす文を先頭に足した）。
    hand: '図形・ペンとマーカーの線・テキスト・吹き出し・ノートは、クリックで選択でき、ドラッグで移動できます。ほかの所をドラッグすると、表示が移動します。ホイールで拡大・縮小します。書き込みの上で右クリックすると表示されるメニューから削除できます。もう一度押すか Esc でツールの選択を解除します。',
    // 「トリミング」の道具（spec-4b-6a 確定事項17。見本 screenshots/phase4b-6-trim-frame.png・-trim-applied.png）。枠が無くて切ってあるときは trimCropped。
    trim: 'ページ上をドラッグして残す範囲を囲み、ハンドルで調整してください。Enter か［適用］でトリミングします。Esc でキャンセルします。トリミング範囲外は非表示になるだけで、［トリミングを解除］で元に戻せます。',
    // 「モザイク」の道具（spec-4b-6b 確定事項14。見本 screenshots/phase4b-6b-mosaic-remove.png）。
    mosaic: 'ページ上をドラッグして、隠す範囲を囲んでください。保存するまでは元に戻せますが、保存すると、モザイクを入れたページは丸ごと画像に置き換わり、そのページの文字は検索・選択・コピーできなくなります。',
    trimCropped: 'もう一度ドラッグすると、トリミング範囲内でトリミングをやり直せます。ページ全体に戻すときは［トリミングを解除］を押してください。',
    multi: 'ドラッグするとまとめて移動し、Ctrl を押しながらドラッグするとコピーを作成します（Shift で横か縦だけ）。Ctrl を押しながらクリックすると、選択と選択解除を切り替えます。Delete で削除できます。',
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
    const transform = { square: HINTS.boxTransform, circle: HINTS.boxTransform, cross: HINTS.boxTransform, polygon: HINTS.polygonTransform, line: HINTS.lineTransform, arrow: HINTS.lineTransform }[entry.kind] ?? '';
    const shape = HINTS.shapeSelected.replace(HINTS.move, `${HINTS.move}${transform}`);
    return `${shape}${boxHintOf(root.SigK.shapeStyle.canFill(entry), root.SigK.shapeStyle.fillOf(entry))}`;
  }

  // 道具を持っているとき（kind はその道具が描く種類。図形は道具の段で選んだ種類）。道具が無ければ tool は null。
  function forTool(tool, kind, fill) {
    if (tool === null)
      return HINTS.none;
    if (tool === 'shape' && (kind === 'line' || kind === 'arrow'))
      return root.SigK.annotateLineAnchor?.isActive() === true ? HINTS.lineAnchor : `${HINTS.shape}${HINTS.lineSnap}`;
    if (tool === 'shape' && kind === 'polygon') {
      const drawing = root.SigK.annotatePolygon?.isDrawing() === true;
      return drawing ? HINTS.polygonDrawing : `${HINTS.polygon}${boxHintOf(true, fill)}`;
    }
    return `${HINTS[tool] ?? HINTS.tool}${boxHintOf(root.SigK.shapeStyle.isFillableKind(kind), fill)}`;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationHints = { HINTS, forSelected, forTool };
})(typeof window !== 'undefined' ? window : globalThis);
