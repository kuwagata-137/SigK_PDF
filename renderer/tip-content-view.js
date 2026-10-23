(function (root) {
  'use strict';

  // 説明の吹き出しの文のうち、ツールバー・左端の 4 つのモード・タブ・左のパネル・検索バー・文書情報／印刷／使い方の窓の ×・大きく見る窓の分
  // （spec-2-5 J1・J2・J5・J14）。計画の文の表のとおり。データだけで、DOM に触れない。1 行 1 鍵。
  // キーの「／」は keys の配列、（）の補足は keysNote。キーの無いものは keys を持たない。ボタンの名前は全角の［］で書く。

  const SAVE_UNTITLED = { name: '上書き保存', desc: 'このファイルはまだ保存先が決まっていないので、保存先と名前を聞いてから PDF のファイルにします。', keys: ['Ctrl+S'] };

  // 上書き保存の文の 2 文目（控えのファイル）。backup は控えのファイルの名前。設定の窓で「上書き保存の前に、元のファイルの控えのファイルを
  // 作る」を外していたら、作らない文にする（spec-6-1 確定事項E-9。点検の直し I-4）。設定が無い（文の表だけのテストなど）ときは作る文。
  // 帯のフロッピー（tip-content-tools.js）も使う。
  function backupSentence(backup) {
    return root.SigK?.preferences?.current?.().makeBackup === false
      ? `設定の窓で外しているので、控えのファイル（${backup}）は作りません。`
      : `元の中身は「${backup}」として残ります。`;
  }

  // ツールバーの［上書き保存］（J14）。名前の無い帯（新しい帯）を映しているときだけ、保存先と名前を聞く文にする。
  // SigK.viewer が無い（文の表だけを読み込んだテストなど）ときは、名前のある方の文。
  function saveEntry() {
    const untitled = root.SigK?.viewer?.getState?.()?.file?.untitled === true;
    if (untitled)
      return SAVE_UNTITLED;
    return { name: '上書き保存', desc: `開いているファイルに、今の変更を書き込みます。${backupSentence('名前.pdf.bak')}`, keys: ['Ctrl+S'] };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tipSaveText = { backupSentence };
  SigK.tipContent.add({
    'bar.open': { name: '開く', desc: 'PDF を選んで、タブで開きます。窓へ PDF をドロップしても開けます。', keys: ['Ctrl+O'] },
    'bar.save': saveEntry,
    'bar.saveAs': { name: '名前を付けて保存', desc: '保存先と名前を決めて、今の中身を新しいファイルに保存します。元のファイルは変わりません。', keys: ['Ctrl+Shift+S'] },
    'bar.undo': { name: '元に戻す', desc: '直前の変更を取り消して、1 つ前の状態に戻します。ツールモードでは、ページをドラッグして動かす・写す・分割の ✂ を、した順に戻します。', keys: ['Ctrl+Z'] },
    'bar.redo': { name: 'やり直し', desc: '元に戻した変更を、もう一度当てます。', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
    'bar.pointerSelect': { name: '選択', desc: '紙の上をドラッグすると、文字を選びます。左ボタンを押したまま右クリックすると、［ハンド］に切り替わります。' },
    'bar.pointerHand': { name: 'ハンド', desc: '紙の上をドラッグすると、表示が動きます（編集モードでは、動かせる書き込みの上をドラッグすると、書き込みが動きます）。Ctrl を押さずにホイールを回すと、拡大・縮小します。' },
    'bar.pagePrev': { name: '前のページ', desc: '1 つ前のページへ移ります。見開きのときは 2 ページ戻ります。', keys: ['PageUp'] },
    'bar.pageNext': { name: '次のページ', desc: '次のページへ移ります。見開きのときは 2 ページ進みます。', keys: ['PageDown'] },
    'bar.zoomOut': { name: '縮小', desc: '表示を 1 段小さくします。いちばん小さいのは 10%（ツールモードで帯に並べるページは 50%）です。', keys: ['Ctrl+−'] },
    'bar.zoomIn': { name: '拡大', desc: '表示を 1 段大きくします。いちばん大きいのは 400%（ツールモードで帯に並べるページは 300%）で、Ctrl+0 で 100% に戻ります。', keys: ['Ctrl+＋'] },
    'bar.fitWidth': { name: '幅に合わせる', desc: 'ページの幅を窓に合わせます。窓の大きさが変わっても合わせ直します。' },
    'bar.fitPage': { name: '全体を表示', desc: 'ページ全体が窓に入る大きさにします。窓の大きさが変わっても合わせ直します。' },
    'bar.facing': { name: '見開き', desc: '2 ページずつ並べて表示します（1-2・3-4 の組）。もう一度押すと、1 ページずつに戻ります。' },
    'bar.find': { name: '検索', desc: '検索バーを開いて、文書の中の文字を探します。', keys: ['Ctrl+F'] },
    'bar.print': { name: '印刷', desc: '印刷の窓を開きます。すべてのページ・今のページ・指定したページから選べます。', keys: ['Ctrl+P'] },
    'bar.settings': { name: '設定', desc: '設定の窓を開きます。書き出すときの最初のフォルダ、上書き保存の前に控えのファイルを作るか、ツールで選んだ値と最後に使ったツールを覚えるかを選びます。', keys: ['Ctrl+,'] },
    'bar.help': { name: '使い方', desc: '使い方の窓を開きます。今のモードの節から出ます。', keys: ['F1'] },
    'mode.view': { name: '閲覧', desc: 'ページを読む・探す・印刷するモードです。書き込みは見えますが、選べません。' },
    'mode.pages': { name: 'ページ編集', desc: 'ページを並べ替える・回す・消す・別のファイルに抜き出す・差し込むモードです。' },
    'mode.annot': { name: '編集', desc: 'ハイライト・文字・図形・ノートなどを書き込むモードです。モザイクで隠すことと、余白を切ることもできます。' },
    'mode.tools': { name: 'ツール', desc: '開いている PDF を帯にして並べ、結合・分割・変換・透かし・フラット化をするモードです。' },
    'tab.add': { name: 'タブを追加', desc: 'PDF を選んで、新しいタブで開きます。', keys: ['Ctrl+O'] },
    'tab.close': { name: 'タブを閉じる', desc: 'このタブを閉じます。保存していない変更があれば、閉じる前に聞きます。', keys: ['Ctrl+W'], keysNote: '選んでいるタブ' },
    'tab.dirty': { name: '保存していない変更あり', desc: 'このタブには、まだ保存していない変更があります。' },
    'side.collapse': { name: 'パネルを閉じる', desc: '左のパネルを閉じて、ページの表示を広げます。閉じている間は、閉じたパネルの細い欄の「＞」で開きます。' },
    'side.expand': { name: 'パネルを開く', desc: '閉じている左のパネルを開きます。' },
    'find.case': { name: '大文字と小文字を区別', desc: '押している間は、大文字と小文字を別の文字として探します。' },
    'find.prev': { name: '前へ', desc: '1 つ前に見つかった所へ移ります。', keys: ['Shift+F3', 'Shift+Enter'] },
    'find.next': { name: '次へ', desc: '次に見つかった所へ移ります。', keys: ['F3', 'Enter'] },
    'find.close': { name: '閉じる', desc: '検索バーを閉じます。', keys: ['Esc'] },
    'status.file': { name: '文書情報', desc: 'このファイルの場所・ページ数・作成日時などを見る窓を開きます。', keys: ['Ctrl+I'] },
    'dialog.close': { name: '閉じる', desc: 'この窓を閉じます。', keys: ['Esc'] },
    'zoom.close': { name: '閉じる', desc: '大きく見る窓を閉じます。', keys: ['Esc'] },
    'zoom.prev': { name: '前のページ', desc: '1 つ前のページを大きく見ます。', keys: ['←'] },
    'zoom.next': { name: '次のページ', desc: '次のページを大きく見ます。', keys: ['→'] },
  });
})(typeof window !== 'undefined' ? window : globalThis);
