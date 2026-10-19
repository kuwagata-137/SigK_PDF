(function (root) {
  'use strict';

  // 説明の吹き出しの文のうち、ツールモード（ツールの一覧・帯のボタン・「変換する画像」の帯・✂ の盤）とページ編集のボタンの分
  // （spec-2-5 J1・J2・J5・J14・J16）。計画の文の表のとおり。データだけで、DOM に触れない。1 行 1 鍵。
  // キーの「／」は keys の配列、（）の補足は keysNote。キーの無いものは keys を持たない。ボタンの名前は全角の［］で書く。

  // 帯のフロッピー（J14）。帯のファイル名は、Task 5 が要素の data-tip-file に付ける。
  function stripSave(node) {
    const file = node.dataset.tipFile ?? '';
    return {
      name: '上書き保存',
      desc: `この帯のファイル（${file}）に、今の変更を書き込みます。元の中身は「${file}.bak」として残ります。`,
      keys: ['Ctrl+S'],
      keysNote: '選んでいる帯',
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tipContent.add({
    'tools.merge': { name: '結合', desc: 'チェックを入れた帯の PDF を、帯の上から順に 1 つにまとめます。ファイルごとにページの範囲を決められます。' },
    'tools.split': { name: '分割', desc: '選んでいる帯の PDF を、ページの間で切って、いくつかのファイルに分けます。' },
    'tools.convert': { name: '画像→PDF', desc: 'PNG・JPEG・BMP・GIF・TIFF の画像を PDF にします。1 つにまとめるか、画像ごとに分けるかを選べます。' },
    'tools.toImage': { name: 'PDF→画像', desc: '選んでいる帯の PDF のページを、PNG か JPEG にしてフォルダへ書き出します。' },
    'tools.watermark': { name: '透かし', desc: '選んでいる帯の PDF のページに、文字か画像の透かしを入れます。' },
    'tools.flatten': { name: 'フラット化', desc: '選んでいる帯の PDF の書き込みを、ページの内容として焼き込み、直せない形にします。' },
    'strip.up': { name: '上へ', desc: 'この帯を 1 つ上へ動かします。タブの並びと結合の順番も一緒に変わります。' },
    'strip.down': { name: '下へ', desc: 'この帯を 1 つ下へ動かします。タブの並びと結合の順番も一緒に変わります。' },
    'strip.save': stripSave,
    'strip.saveAs': { name: '名前を付けて保存', desc: 'この帯はまだファイルになっていません。保存先と名前を決めて、PDF のファイルにします。', keys: ['Ctrl+Shift+S'], keysNote: '選んでいる帯' },
    'strip.close': { name: '閉じる', desc: 'この帯（PDF のタブ）を閉じます。保存していない変更があれば、閉じる前に聞きます。', keys: ['Ctrl+W'], keysNote: '選んでいる帯' },
    'image.clear': { name: 'すべて外す', desc: '「変換する画像」の帯から、画像をすべて外します。画像のファイルは消えません。' },
    'image.remove': { name: '外す', desc: 'この画像を「変換する画像」の帯から外します。画像のファイルは消えません。' },
    'split.cut': { name: 'ここで分ける', desc: 'このページの前で切って、箱を 2 つに分けます。' },
    'split.undo': { name: '元に戻す', desc: '✂ の盤でした操作（切る・つなげる・書き出さない など）を 1 つ戻します。' },
    'split.redo': { name: 'やり直す', desc: '✂ の盤で元に戻した操作を、もう一度当てます。' },
    'pages.rotateLeft': { name: '左回転', desc: '選んだページを左に 90 度回します。何も選んでいないときは、表示しているページを回します。' },
    'pages.rotateRight': { name: '右回転', desc: '選んだページを右に 90 度回します。何も選んでいないときは、表示しているページを回します。' },
    'pages.extract': { name: '抽出', desc: '選んだページを、別の PDF に書き出します。元のファイルは変わりません。' },
    'pages.insert': { name: '挿入', desc: 'PDF か画像を、選んだページの前に差し込みます。何も選んでいなければ、最後に入ります。' },
    'pages.delete': { name: '削除', desc: '選んだページを消します。何も選んでいないときは、表示しているページを消します。', keys: ['Delete'] },
    'thumb.rotateLeft': { name: '左に回す', desc: 'このページだけを左に 90 度回します。' },
    'thumb.rotateRight': { name: '右に回す', desc: 'このページだけを右に 90 度回します。' },
    'thumb.delete': { name: 'このページを削除', desc: 'このページだけを消します。' },
  });
})(typeof window !== 'undefined' ? window : globalThis);
