(function (root) {
  'use strict';

  // 説明の吹き出しの文のうち、ツールモード（ツールの一覧・帯のボタン・「変換する画像」の帯・✂ の盤）とページ編集のボタンの分
  // （spec-2-5 J1・J2・J5・J14・J16）。計画の文の表のとおり。データだけで、DOM に触れない。1 行 1 鍵。
  // キーの「／」は keys の配列、（）の補足は keysNote。キーの無いものは keys を持たない。ボタンの名前は全角の［］で書く。

  // 帯のフロッピー（J14）。帯のファイル名は、Task 5 が要素の data-tip-file に付ける。
  // ファイル名が空・無いときは、「（）」を出さず、ファイル名を抜いた文にする（.bak の名前は見本の「名前.pdf.bak」）。
  // 2 文目（控えのファイル）は、ツールバーの［上書き保存］と同じく設定の窓に合わせる（tip-content-view.js の backupSentence）。
  function stripSave(node) {
    const file = node.dataset.tipFile;
    const target = file ? `この帯のファイル（${file}）` : 'この帯のファイル';
    const backup = file ? `${file}.bak` : '名前.pdf.bak';
    return {
      name: '上書き保存',
      desc: `${target}に、現在の変更内容を上書き保存します。${root.SigK.tipSaveText.backupSentence(backup)}`,
      keys: ['Ctrl+S'],
      keysNote: '選択中の帯',
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tipContent.add({
    'tools.merge': { name: '結合', desc: 'チェックを入れた帯の PDF を、帯の上から順に 1 つに結合します。ファイルごとにページ範囲を指定できます。' },
    'tools.split': { name: '分割', desc: '選択中の帯の PDF を、ページ間で分割し、複数のファイルにします。' },
    'tools.convert': { name: '画像→PDF', desc: 'PNG・JPEG・BMP・GIF・TIFF の画像を PDF に変換します。1 つの PDF に結合するか、画像ごとに PDF を作成するかを選択できます。' },
    'tools.toImage': { name: 'PDF→画像', desc: '選択中の帯にある PDF のページを、PNG か JPEG に変換してフォルダへ書き出します。' },
    'tools.watermark': { name: '透かし', desc: '選択中の帯にある PDF のページに、文字か画像の透かしを入れます。' },
    'tools.flatten': { name: 'フラット化', desc: '選択中の帯にある PDF の書き込みを、ページの内容として焼き込み、編集できない状態にします。' },
    'strip.up': { name: '上へ', desc: 'この帯を 1 つ上へ移動します。タブの並び順と結合順序も、あわせて変わります。' },
    'strip.down': { name: '下へ', desc: 'この帯を 1 つ下へ移動します。タブの並び順と結合順序も、あわせて変わります。' },
    'strip.save': stripSave,
    // 名前の無い帯のフロッピー。空のタブに貼り付けた画像の帯は、PNG・JPEG・PDF から形式を選ぶ（spec-7-8 確定事項NT9）。
    'strip.saveAs': { name: '名前を付けて保存', desc: 'この帯はまだ保存されていません。保存先と名前を指定して保存します。新しい PDF の帯は PDF ファイルとして、貼り付けた画像の帯は PNG・JPEG・PDF から選んだ形式で保存します。', keys: ['Ctrl+Shift+S'], keysNote: '選択中の帯' },
    'strip.close': { name: '閉じる', desc: 'この帯（PDF のタブ）を閉じます。保存していない変更があれば、閉じる前に確認します。', keys: ['Ctrl+W'], keysNote: '選択中の帯' },
    'image.clear': { name: 'すべて削除', desc: '「変換する画像」の帯から、画像をすべて削除します。元の画像ファイルは削除されません。' },
    'image.remove': { name: '削除', desc: 'この画像を「変換する画像」の帯から削除します。元の画像ファイルは削除されません。' },
    'split.cut': { name: 'ここで分割', desc: 'このページの前で分割し、出力ファイルを 2 つにします。' },
    'split.undo': { name: '元に戻す', desc: '分割画面で行った操作（分割・結合・書き出さない など）を 1 つ元に戻します。' },
    'split.redo': { name: 'やり直す', desc: '分割画面で元に戻した操作を、もう一度適用します。' },
    'pages.rotateLeft': { name: '左回転', desc: '選択したページを左に 90 度回転します。何も選択していないときは、表示しているページを回転します。' },
    'pages.rotateRight': { name: '右回転', desc: '選択したページを右に 90 度回転します。何も選択していないときは、表示しているページを回転します。' },
    'pages.extract': { name: '抽出', desc: '選択したページを、別の PDF に書き出します。元のファイルは変更されません。' },
    'pages.insert': { name: '挿入', desc: 'PDF か画像を、選択したページの前に差し込みます。何も選択していなければ、末尾に差し込みます。' },
    'pages.delete': { name: '削除', desc: '選択したページを削除します。何も選択していないときは、表示しているページを削除します。削除する前に確認画面が表示されます。', keys: ['Delete'] },
    'thumb.rotateLeft': { name: '左回転', desc: 'このページだけを左に 90 度回転します。' },
    'thumb.rotateRight': { name: '右回転', desc: 'このページだけを右に 90 度回転します。' },
    'thumb.delete': { name: 'このページを削除', desc: 'このページだけを削除します。削除する前に確認画面が表示されます。' },
  });
})(typeof window !== 'undefined' ? window : globalThis);
