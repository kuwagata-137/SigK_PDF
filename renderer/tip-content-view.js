(function (root) {
  'use strict';

  // 説明の吹き出しの文のうち、ツールバー・左端の 4 つのモード・タブ・左のパネル・検索バー・文書情報／印刷／使い方の窓の ×・大きく見る窓の分
  // （spec-2-5 J1・J2・J5・J14）。計画の文の表のとおり。データだけで、DOM に触れない。1 行 1 鍵。
  // キーの「／」は keys の配列、（）の補足は keysNote。キーの無いものは keys を持たない。ボタンの名前は全角の［］で書く。

  const SAVE_UNTITLED = { name: '上書き保存', desc: 'このファイルは保存先が未指定なので、保存画面で保存先と名前を指定してから PDF ファイルとして保存します。', keys: ['Ctrl+S'] };

  // 上書き保存の文の 2 文目（控えのファイル）。backup は控えのファイルの名前。設定の窓で「上書き保存の前に、元のファイルの控えのファイルを
  // 作る」を外していたら、作らない文にする（spec-6-1 確定事項E-9。点検の直し I-4）。設定が無い（文の表だけのテストなど）ときは、既定と
  // 同じく作らない文（2026-11-12 に既定を作らないへ改めた。spec-7-4 確定事項BK1）。
  // 帯のフロッピー（tip-content-tools.js）も使う。
  function backupSentence(backup) {
    return root.SigK?.preferences?.current?.().backupBeforeOverwrite !== true
      ? `設定画面でチェックを外しているので、バックアップファイル（${backup}）は作成しません。`
      : `上書き前の内容は「${backup}」として残ります。`;
  }

  // ツールバーの［上書き保存］（J14）。名前の無い帯（新しい帯）を映しているときだけ、保存先と名前を聞く文にする。
  // SigK.viewer が無い（文の表だけを読み込んだテストなど）ときは、名前のある方の文。
  function saveEntry() {
    const untitled = root.SigK?.viewer?.getState?.()?.file?.untitled === true;
    if (untitled)
      return SAVE_UNTITLED;
    return { name: '上書き保存', desc: `開いているファイルに、現在の変更内容を上書き保存します。${backupSentence('名前.pdf.bak')}`, keys: ['Ctrl+S'] };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tipSaveText = { backupSentence };
  SigK.tipContent.add({
    'bar.open': { name: '開く', desc: 'PDF か画像を選択して、タブで開きます。ウインドウへドロップしても開けます。', keys: ['Ctrl+O'] },
    'bar.save': saveEntry,
    'bar.saveAs': { name: '名前を付けて保存', desc: '保存先と名前を指定して、現在の内容を新しいファイルに保存します。元のファイルは変更されません。', keys: ['Ctrl+Shift+S'] },
    'bar.undo': { name: '元に戻す', desc: '直前の変更を取り消して、1 つ前の状態に戻します。ツールモードでは、ページのドラッグによる移動・コピーと、✂ による分割を、行った順序に従って戻します。', keys: ['Ctrl+Z'] },
    'bar.redo': { name: 'やり直す', desc: '元に戻した変更を、もう一度適用します。', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
    'bar.pointerSelect': { name: '選択', desc: 'ページ上をドラッグすると、文字を選択します。左ボタンを押したまま右クリックすると、［ハンド］に切り替わります。' },
    'bar.pointerHand': { name: 'ハンド', desc: 'ページ上をドラッグすると、表示がスクロールします（編集モードでは、移動できる書き込みの上をドラッグすると、書き込みが移動します）。Ctrl を押さずにホイールを回すと、拡大・縮小します。' },
    'bar.pagePrev': { name: '前のページ', desc: '1 つ前のページへ移動します。見開きのときは 2 ページ戻ります。', keys: ['PageUp'] },
    'bar.pageNext': { name: '次のページ', desc: '次のページへ移動します。見開きのときは 2 ページ進みます。', keys: ['PageDown'] },
    'bar.zoomOut': { name: '縮小', desc: '表示を 1 段階縮小します。最小は 10%（ツールモードで帯に並べるページは 50%）です。', keys: ['Ctrl+−'] },
    'bar.zoomIn': { name: '拡大', desc: '表示を 1 段階拡大します。最大は 1000%（ツールモードで帯に並べるページは 300%）で、Ctrl+0 で 100% に戻ります。', keys: ['Ctrl+＋'] },
    'bar.fitWidth': { name: '幅に合わせる', desc: 'ページ幅をウインドウに合わせます。ウインドウサイズが変わっても、合わせた状態を保ちます。' },
    'bar.fitPage': { name: '全体を表示', desc: 'ページ全体がウインドウに収まるサイズで表示します。ウインドウサイズが変わっても、合わせた状態を保ちます。' },
    'bar.facing': { name: '見開き', desc: '2 ページずつ並べて表示します（1-2・3-4 の組）。もう一度押すと、1 ページずつに戻ります。' },
    'bar.find': { name: '検索', desc: '検索バーを開いて、文書内の文字を検索します。', keys: ['Ctrl+F'] },
    'bar.print': { name: '印刷', desc: '印刷画面を開きます。すべてのページ・現在のページ・指定したページから選択できます。', keys: ['Ctrl+P'] },
    'bar.settings': { name: '設定', desc: '設定画面を開きます。書き出し先フォルダの初期値と、上書き保存前のバックアップファイル作成、画像の上書き保存前の確認画面表示、ツールで選択した値と最後に使用したツールの記憶を設定します。', keys: ['Ctrl+,'] },
    'bar.help': { name: '使い方', desc: '使い方画面を開きます。現在のモードの説明から表示します。', keys: ['F1'] },
    'mode.view': { name: '閲覧', desc: 'ページの閲覧・検索・印刷を行うモードです。書き込みは表示されますが、選択できません。' },
    'mode.pages': { name: 'ページ編集', desc: 'ページの並べ替え・回転・削除・別ファイルへの抽出・差し込みを行うモードです。' },
    'mode.annot': { name: '編集', desc: 'ハイライト・文字・図形・ノートなどを書き込むモードです。モザイクで隠すことと、余白をトリミングすることもできます。' },
    'mode.tools': { name: 'ツール', desc: '開いている PDF を帯にして並べ、結合・分割・変換・透かし・フラット化をするモードです。' },
    'tab.add': { name: 'タブを追加', desc: 'PDF か画像を選択して、新しいタブで開きます。', keys: ['Ctrl+O'] },
    'tab.close': { name: 'タブを閉じる', desc: 'このタブを閉じます。保存していない変更があれば、閉じる前に確認します。', keys: ['Ctrl+W'], keysNote: '選択中のタブ' },
    'tab.dirty': { name: '保存していない変更あり', desc: 'このタブには、まだ保存していない変更があります。' },
    'side.collapse': { name: 'パネルを閉じる', desc: '左パネルを閉じて、ページを表示する領域を広げます。閉じている間は、パネルの位置に残る細い欄の「＞」で開きます。' },
    'side.expand': { name: 'パネルを開く', desc: '閉じている左パネルを開きます。' },
    'find.case': { name: '大文字と小文字を区別', desc: '押している間は、大文字と小文字を別の文字として検索します。' },
    'find.prev': { name: '前へ', desc: '1 つ前の検索結果へ移動します。', keys: ['Shift+F3', 'Shift+Enter'] },
    'find.next': { name: '次へ', desc: '次の検索結果へ移動します。', keys: ['F3', 'Enter'] },
    'find.close': { name: '閉じる', desc: '検索バーを閉じます。', keys: ['Esc'] },
    'status.file': { name: '文書情報', desc: 'このファイルの場所・ページ数・作成日時などを表示する画面を開きます。', keys: ['Ctrl+I'] },
    'dialog.close': { name: '閉じる', desc: 'この画面を閉じます。', keys: ['Esc'] },
    'zoom.close': { name: '閉じる', desc: '拡大表示画面を閉じます。', keys: ['Esc'] },
    'zoom.prev': { name: '前のページ', desc: '1 つ前のページを拡大表示します。', keys: ['←'] },
    'zoom.next': { name: '次のページ', desc: '次のページを拡大表示します。', keys: ['→'] },
  });
})(typeof window !== 'undefined' ? window : globalThis);
