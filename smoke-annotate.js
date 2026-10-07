'use strict';

// 起動確認の注釈の経路（spec-4-1〜4-4 の完了判定）。main.js の installSmokeCheck が使う。
// 2,000 行を超えた main.js から移した（spec-4b-1a 確定事項36。中身は変えていない）。操作ごとの分岐は
// smoke-annotate-steps.js、見た目の操作と保存先の見た目の欄は smoke-annotate-style.js（spec-4b-1b）、
// 結果を組む部分は smoke-annotate-report.js にある。
//
// SIGK_SMOKE_ANNOTATE=<操作列> を付けると、注釈の経路を通す（spec-4-1 の完了判定）。
// 文書は SIGK_SMOKE_ANNOTATE_OUT（省略時は一時フォルダー）へ複製してタブで開く
// （保存して開き直す経路まで通すため）。元は SIGK_SMOKE_PDF。
//
// 操作はカンマ区切りで、次のものを受ける。
//   page:2                     2 ページ目（1 起点）へ移る
//   select:1:0-1               1 ページ目（0 起点）の span 0〜1 を選ぶ
//   highlight / underline / strikeout   道具を押す（選んでいれば付く）
//   color:#c00000              色を当てる（選んでいればその書き込み、無ければ次に付ける色）
//   click:0:80x705             ページ 0 の pt (80,705) を押して離す（選ぶ）
//   delete / esc / undo / redo / save
//   rotate:0                   ページ 0 を右へ 90 度（保存後に開き直す経路の確認用）
//   tool:text                  道具を持つ（空なら離す）
//   text:0:100x700:一行目|二行目  テキストの道具でページ 0 の pt (100,700) に置いて打ち、Esc で確定する
//                              （| は改行。spec-4-2 の完了判定）
//   draft:0:100x700:打ちかけ    同じく置いて打つが確定しない（画面写真用。入力欄が残る）
//   edit:直した文字            選んでいるテキストを Enter で開き、打ち直して確定する
//   size:18                    文字の大きさ（選んでいればその注釈、無ければ次に置く大きさ）
//   bold / italic              右パネルの書式の B・I を押す（選んでいればそのテキスト、無ければ次に置く書式。spec-4b-4a）
//   drag:30x-20                選んでいるテキスト・図形を掴んで紙の座標で (30,-20)pt 動かす
//   shape:arrow:0:100x700-300x650  図形の道具でページ 0 の pt (100,700) から (300,650) へドラッグして描く
//                              （種類は square / circle / line / arrow。spec-4-3 の完了判定）
//   pen:0:100x500;120x480;150x510  ペンでページ 0 の pt の点列をなぞる（; 区切り）
//   width:3                    線の太さ（選んでいればその図形、無ければ次に描く太さ）
//   note:0:100x700:本文|2行目    ノートの道具でページ 0 の pt (100,700) を押して付箋を置き、「本文」欄に打って確定する
//                              （| は改行。本文が無ければ空のまま。spec-4-4 の完了判定）
//   contents:直した本文         選んでいるノートの「本文」欄を打ち直して確定する
//   opacity:50                 不透明度（%）。選んでいればその注釈、無ければ道具の次の値
//   author:名前                「作成者」欄を打つ（ノートの道具を持っているとき）
//   list:1                     一覧の 1 行目（1 起点）を押す（該当箇所へ飛んで選ぶ。一覧を出していなければ先に出す）
//   bar:square                 道具の段のボタンを押す（highlight・underline・strikeout・text・arrow・line・square・
//                              circle・pen・note。spec-4b-1a 確定事項38）
//   side:list                  左の見出しの切り替えを押す（thumbs か list）
//   wait-details               書き込みの読み込み（辞書の読み戻しを含む）が終わるまで待つ
//   fill: stroke: style: chip: palette: other: slide:   見た目の操作（smoke-annotate-style.js の冒頭）
//   grab: angle: angle-preset:   大きさと向きの操作（smoke-annotate-transform.js の冒頭。spec-4b-2）
//   ctrl-click: marquee: move: list-ctrl: list-shift: key:   選択と複数選択の操作（smoke-annotate-select.js の冒頭。spec-4b-3a）
//   fontsize: size-list: reopen compare:   テキストの書式の操作（smoke-annotate-text.js の冒頭。spec-4b-4a）
//   polygon: snap: reshape compare-shapes:  図形の追加の操作（smoke-annotate-shapes.js の冒頭。spec-4b-5a）
//   marker: erase: bar-width: more: reink marker-pixels:  マーカー・消しゴム・「その他」の操作（smoke-annotate-erase.js の冒頭。spec-4b-5b）
//   trim: trim-draft: trim-move: untrim: trim-tool fit:   トリミングの操作（smoke-annotate-trim.js の冒頭。spec-4b-6a）
//   mosaic: mosaic-draft: unmosaic: mosaic-tool mosaic-save   モザイクの操作（smoke-annotate-mosaic.js の冒頭。spec-4b-6b）
// 各操作のあとに、履歴がいくつ進んだか（historyDelta）を控える。
//
// 例: SIGK_SMOKE_ANNOTATE=select:0:2-3,highlight,color:#8ce99a,select:0:5-5,underline,undo,redo,save
// 例: SIGK_SMOKE_ANNOTATE=text:0:100x700:こんにちは|世界,size:18,drag:30x-20,edit:直した,save
// 例: SIGK_SMOKE_ANNOTATE=shape:arrow:0:100x700-300x650,width:3,pen:0:100x500;120x480;150x510,undo,redo,save
// 例: SIGK_SMOKE_ANNOTATE=tool:note,author:総務,note:0:100x700:確認|2行目,color:#8ce99a,opacity:50,tool:shape,shape:square:0:100x500-300x400,opacity:50,list:1,undo,redo,save
// 例: SIGK_SMOKE_ANNOTATE=bar:square,opacity:50,shape:square:0:100x700-300x600,bar:line,width:8,shape:line:0:100x200-300x200,save,wait-details
// 例: SIGK_SMOKE_ANNOTATE=bar:square,palette:fill:3x8,stroke:none,style:cloudy,shape:square:0:100x700-300x600,slide:opacity:80;50;35,save,wait-details
// 例: SIGK_SMOKE_ANNOTATE=shape:square:0:100x700-300x600,grab:x2y2:40x-20,grab:rotate:80x60,angle:45,save
// 例: SIGK_SMOKE_ANNOTATE=shape:square:0:100x700-200x600,shape:square:0:300x700-400x600,bar:select,marquee:0:80x720-420x580,color:#00aa00,move:20x0:shift,move:0x-30:ctrl,undo,key:Backspace,undo,save

const fs = require('node:fs');
const path = require('node:path');

const { REPORT } = require('./smoke-annotate-report.js');
const { STEPS } = require('./smoke-annotate-steps.js');
const { STYLE_STEPS, inspectAnnotations } = require('./smoke-annotate-style.js');
const { TRANSFORM_STEPS, TRANSFORM_REPORT } = require('./smoke-annotate-transform.js');
const { SELECT_STEPS, SELECT_REPORT } = require('./smoke-annotate-select.js');
const { TEXT_STATE, TEXT_STEPS, TEXT_REPORT, inspectTexts } = require('./smoke-annotate-text.js');
const { SHAPE_STATE, SHAPE_STEPS, SHAPE_REPORT } = require('./smoke-annotate-shapes.js');
const { ERASE_STATE, ERASE_STEPS, ERASE_REPORT, pixelsIn } = require('./smoke-annotate-erase.js');
const { TRIM_STATE, TRIM_STEPS, TRIM_REPORT, inspectBoxes } = require('./smoke-annotate-trim.js');
const { MOSAIC_STATE, MOSAIC_STEPS, MOSAIC_REPORT, inspectMosaic } = require('./smoke-annotate-mosaic.js');

const annotateScript = (target, spec) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SigK = window.SigK;
  const round = (value) => Math.round(value * 100) / 100;
  const LF = String.fromCharCode(10);

  await SigK.tabs.openPath(${JSON.stringify(target)});
  await wait(700);
  // 編集モードへ入る前と後の倍率と表示域（spec-4b-1a 確定事項19。「幅」で開くので、表示域が変われば倍率も変わるはず）。
  const viewSize = () => ({ zoom: SigK.viewer.getState().zoom, fit: SigK.viewer.getState().fit, width: document.getElementById('view').clientWidth, height: document.getElementById('view').clientHeight });
  const zoomBefore = viewSize();
  SigK.shell.setMode(document, 'annot');
  await wait(400);
  const zoomAfter = viewSize();
  const importedBefore = Object.values(SigK.viewer.getImported()).reduce((sum, list) => sum + list.length, 0);

  const pageNode = (index) => document.querySelector('.pdf-page[data-page="' + (index + 1) + '"]');
  const viewportOf = (index) => SigK.freeTextEditor.pageOf(index)?.viewport ?? SigK.viewer.getTextLayer(index)?.viewport;
  // 紙の座標 pt を画面の座標にする。
  const screenPoint = (index, x, y) => {
    const base = pageNode(index).getBoundingClientRect();
    const [cx, cy] = viewportOf(index).convertToViewportPoint(x, y);
    return [base.left + cx, base.top + cy];
  };
  const mouse = (type, target, x, y) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  const editorNode = () => document.querySelector('textarea.free-text-editor');
  // 入力欄に打って Esc で確定する（IME は通さない。文字は value に置く）。
  const typeAndCommit = async (body, { commit = true } = {}) => {
    const node = editorNode();
    if (node === null)
      return false;
    node.value = body.split('|').join(LF);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(100);
    if (commit)
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  };
  // 右パネルの「本文」欄に打って Ctrl+Enter で確定する（spec-4-4 確定事項4）。
  const typeContents = async (body) => {
    const field = document.getElementById('props-contents');
    if (field === null || document.getElementById('props-contents-row').hidden)
      return false;
    field.focus();
    field.value = body.split('|').join(LF);
    await wait(100);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(100);
    return true;
  };
  const applied = [];
  let saveResult = null;
${TEXT_STATE}
${SHAPE_STATE}
${ERASE_STATE}
${TRIM_STATE}
${MOSAIC_STATE}
  for (const raw of ${JSON.stringify(spec)}.split(',')) {
    const step = raw.trim();
    if (step.length === 0)
      continue;
    const [name, ...rest] = step.split(':');
    const arg = rest.join(':');
    const t0 = performance.now();
    const historyBefore = SigK.pageEdit.getHistoryState().at;
${STEPS}${STYLE_STEPS}${TRANSFORM_STEPS}${SELECT_STEPS}${TEXT_STEPS}${SHAPE_STEPS}${ERASE_STEPS}${TRIM_STEPS}${MOSAIC_STEPS}
    applied.push({ step, ms: round(performance.now() - t0), selected: SigK.annotate.getSelected(), count: SigK.annotate.getSelection().length, historyDelta: SigK.pageEdit.getHistoryState().at - historyBefore });
    await wait(120);
  }

${TRANSFORM_REPORT}
${SELECT_REPORT}
${TEXT_REPORT}
${SHAPE_REPORT}
${ERASE_REPORT}
${TRIM_REPORT}
${MOSAIC_REPORT}
${REPORT}
})()`;

// 保存先に埋まったフォント（/Type0 の辞書）の数を数える（spec-4-2 完了判定）。
// 起動確認でしか使わないので、pdf-lib はここで初めて読む。
async function countEmbeddedFonts(file) {
  const { PDFDocument, PDFName } = require(path.join(__dirname, 'vendor', 'pdf-lib.min.js'));
  const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(file)), { updateMetadata: false });
  let count = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj?.get?.(PDFName.of('Subtype'))?.encodedName === '/Type0')
      count += 1;
  }
  return count;
}

module.exports = { annotateScript, countEmbeddedFonts, inspectAnnotations, inspectTexts, inspectBoxes, inspectMosaic, pixelsIn };
