(function (root) {
  'use strict';

  // ツールチップの文言のうち、印刷画面の分（docs/spec-7-7-print-dialog.md・決定94）。データだけで、DOM に触れない。1 行 1 鍵。
  // ⓘ の説明の文言は、Acrobat の画面写真（質問 PR4）が届いたら見直す。注釈とフォーム(M) には、注釈が書き込みのことだと書く（質問 PR2）。

  root.SigK.tipContent.add({
    'print.advanced': { name: '詳細設定', desc: 'SigK PDF では使用できません。プリンターの細かい設定は［プロパティ］で変更します。' },
    'print.inkInfo': { name: 'インク / トナーを節約', desc: 'ページの色を白に近づけて薄く印刷し、インクやトナーの使用量を減らします。' },
    'print.handlingInfo': { name: 'ページサイズ処理', desc: 'ページを用紙に配置する方法を選択します。［ポスター］は 1 ページを複数の用紙に分割し、［複数］は 1 枚に複数のページを、［小冊子］は二つ折りで綴じる順番に印刷します。' },
    'print.comments': { name: '注釈とフォーム', desc: '注釈（書き込み）とフォームフィールドを印刷するかを選択します。［文書と注釈］は保存していない書き込みも印刷し、［文書］は書き込みを印刷しません。' },
    'print.summary': { name: '注釈の一覧', desc: '書き込みのあるページの後ろに、一覧ページ（書き込みの番号・作成者・種類・本文）を入れて印刷します。' },
  });
})(typeof window !== 'undefined' ? window : globalThis);
