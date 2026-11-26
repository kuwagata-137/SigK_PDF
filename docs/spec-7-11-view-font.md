# フルスクリーン・範囲自動入力・テキストフォント変更・範囲選択時倍率固定（第2版 7-11）の仕様と記録

作成: 2026-11-26。作業ブランチ `claude/v150-view-font-aa0c2e`（main の d022679 から。作業ツリー `.claude/worktrees/v150-view-font-aa0c2e`）。
版 1.5.0 の改修 11 件のうち、子B が担当する 4 件（①②③⑪）の仕様と記録。図形とマーキングの 7 件（④〜⑩）は子A の `docs/spec-7-10-shape-tools.md`。
決定の元: `docs/07_開発計画の決定事項.md` 決定102（統括役が記録する）。

## 目的

ユーザーの依頼（2026-11-26。番号は統括役の計画の番号）による。

> * フルスクリーンモードを追加したい（①）
> * 画像変換やPDF変換する時に「範囲」で指定する時に、選択されているページの番号が勝手に入るようにする（②）
> * 入力できるテキストのフォントを変更できるようにする。追加するフォントについては、たくさん入れてもアプリが重くならないか等で要相談。（③）
> * 選択モードで範囲選択した時に画面表示倍率が勝手に変わらないようにしてください（⑪）

## 用語

用語は `用語集.md` に従う。この仕様書で使う、用語集にまだ無い言葉（質問の回答の後に、統括役が用語集に追加する候補）:

- フルスクリーンモード（ユーザーの言葉）
- 範囲欄: ツールモードの設定パネルの「ページ」の［範囲］の下の入力欄（結合は帯ごとの行の入力欄）。画面の aria-label は「画像に変換するページ範囲」など
- 表示倍率: ツールバーの倍率の欄（aria-label「表示倍率」）
- ステータスバー: 画面のいちばん下の行（`#status`）
- フォント（行名）: プロパティパネルで、テキストと吹き出しのフォントを選ぶ行（追加する行）

## 今の作り（2026-11-26。コードと、ウインドウを表示しない起動での実測）

| 依頼 | 今の作り | 場所 |
|---|---|---|
| ① | 全画面の機能も F11 の割り当ても無い。メニューは「ファイル」「ヘルプ」だけ。ツールバーは幅 1280px のウインドウでボタンがほぼ並び切っていて、文字の付いたボタンを 1 つ追加すると右端の［使い方］が見切れる（実測） | `main.js` `buildAppMenu`、`renderer/viewer-keys.js`、`renderer/shell.css` のツールバーの段階の詰め方（1340・1270・1060px） |
| ② | 範囲欄があるのは、結合（帯ごと）・PDF→画像・透かし・フラット化の 4 つ。帯のページの選択は範囲欄とつながっていない。帯の選択は表示の並び（plan）の位置で持ち、帯の下の番号も表示の位置。ツールは保存してあるファイルを読み直して作り、保存していない変更がある帯では、実行前の確認画面（［上書き保存してから実行］［保存せずに実行］［キャンセル］）を表示する | `renderer/strip-selection.js`、`renderer/tools-merge.js`・`tools-to-image.js`・`tools-watermark.js`・`tools-flatten.js`、`renderer/page-range.js`、`renderer/run-guard.js` |
| ③ | テキストと吹き出しは同梱の Noto Sans JP（Regular・Bold）に固定。画面は `@font-face`、保存はワーカーがサブセットで埋め込む（外観の名前 `SigKJP`・`SigKJPB`、/DA は `SigKJP`）。Noto Sans JP の 2 書体は、起動した直後に読み込まれている（`document.fonts` の status が loaded） | `renderer/free-text-font.js`、`renderer/shell.css`、`worker/font-embed.js`・`op-annotate.js`、`renderer/imported-entry.js` |
| ⑪ | 範囲選択を始めた時（`annotate-marquee.js` の `begin` が選択を解除する）にプロパティパネルが閉じ、`shell.js` の `setPropsOpen` → `notifyViewportChanged` → `viewer.refit` で、表示倍率が［幅］の時は 81% → 114%（幅 1280px のウインドウ）に変わる。離して書き込みを選択すると 81% に戻る。表示倍率が数値の時は、ページが左右に 79px 動く | `renderer/annotate-marquee.js`、`renderer/annotation-props.js` の `wantsOpen`・`refresh`、`renderer/shell.js`、`renderer/viewer.js` |

## 質問（統括役がユーザーに質問する。回答を待っている）

| 質問 | 決めること | 画像 |
|---|---|---|
| ZM3 | プロパティパネルの表示方法（重ねて表示／［選択］［ハンド］の間は開いたまま） | `screenshots/question-zm3-props-overlay.png` |
| FS1 | フルスクリーンモードで隠す範囲（ページだけ表示／ウインドウだけ全画面） | `screenshots/question-fs1-fullscreen-scope.png` |
| FS2 | 入る操作にツールバーのボタンを追加するか | `screenshots/question-fs2-fullscreen-keys.png` |
| RG1 | 範囲欄に番号を入れる時機（選択するたび／［範囲］をクリックした時） | `screenshots/question-rg1-range-timing.png` |
| RG2 | 保存していない並べ替えがある帯での番号（表示の位置／ファイルのページ番号／入れない） | `screenshots/question-rg2-range-unsaved.png` |
| RG3 | 対象のツール（4 つすべて／結合を除く 3 つ） | `screenshots/question-rg3-range-tools.png` |
| FT1 | フォントの用意の方法（同梱を追加／Windows のフォント／両方） | `screenshots/question-ft1-font-source.png` |

質問の下書き（選択肢・推奨案・調べた結果）は `~/.claude/plans/v150-questions-b.md`。

## 確定事項

回答の後に書く。

## 実測（2026-11-26。質問 FT1 の材料）

- 起動の時間（プロセスの作成から画面の読み込みの完了まで。ウインドウを表示しない起動で 3 回）: 今 2.30〜2.48 秒、`@font-face` を 10 個追加して 2.30〜2.41 秒。使わない `@font-face` は読み込まれないので、起動の時間は変わらない。
- 同梱のフォント（Noto Sans JP 5.4MB）を新しく読み込む時間: 1 回目 0.30〜0.32 秒、2 つ目から 0.03〜0.04 秒（3 回）。
- Windows のフォントで最初の文字の幅を測るまで: 游ゴシック 0.08〜0.13 秒、游明朝 0.04〜0.07 秒、メイリオ 0.02 秒、MS ゴシック・MS 明朝・BIZ UDP の各フォント 0.01 秒前後。
- 保存した PDF の増え方（Noto Sans JP、3 ページの PDF にテキストを 1 つ追加）: 20 字 +4,569 バイト、91 字 +14,176 バイト、太字 20 字 +4,644 バイト、標準と太字の両方 +9,214 バイト。
- インストーラーの増え方: Bold を同梱した時の実測（`docs/spec-4b-4a-text-format.md` の実装の記録。5,468,188 バイトで +2,724,945 バイト）の比 約 0.50 から計算する。

## 調べた結果（Web。2026-11-26）

- Microsoft の Font redistribution FAQ（https://learn.microsoft.com/en-us/typography/fonts/font-faq ）: Windows のフォントの再配布（アプリへの同梱）は認めない。埋め込みの決まり（OpenType の fsType）に従うアプリが作る文書（PDF を含む）への埋め込みは認める。`docs/spec-4-2-free-text.md` の事前調査 A（65 行）の「OS のフォント … 再配布・埋め込みの許諾が無い」のうち、埋め込みの部分はこの FAQ と食い違う（FT1 の回答の後に、spec-4-2 に注記する）。
- fsType の値は Microsoft の公式のページに無く、個人が公開した一覧（2020 年）にだけあった: 游ゴシック・游明朝・メイリオ・MS ゴシック・MS 明朝は Editable、Windows の BIZ UD と UD デジタル 教科書体は Preview & Print。
- BIZ UD の Google Fonts 版は SIL OFL 1.1（Windows の版より 4 文字多い版）。
- pdf-lib は `fontkit.create` を PostScript 名なしで呼ぶので、.ttc のフォントはそのままでは埋め込めない見込み（`worker/font-embed.js` の `paddedFontkit` で PostScript 名を渡す形にする案）。

## 実装の記録

### 回答に関係しない下準備（2026-11-26）

| コミット | 内容 |
|---|---|
| `88654e4` | ⑪ 範囲選択の途中で表示倍率が変わった時に、枠が押した点からずれる不具合を修正した。押した点をページの pt（`anchor`）で控え、動かすたびと離した時に、今の倍率の viewport で px に直す。試験 `test/annotate-marquee.test.js`（押した後に倍率を 1.5 倍にしても、枠の角が押した点にあり、囲んだ書き込みを選択する。修正前は枠の角が [107,163] で、押した点 [160,244] からずれて失敗した）。倍率を変えない方法そのものは質問 ZM3 の回答を待つ |
| `22d5b95` | ② `renderer/page-range.js` に `formatPageRange`（1 始まりの番号を「2-4, 7」の形にする。`parsePageRange` の逆）を追加した。新しい `renderer/strip-range.js` は、帯の選択（表示の位置）から、表示の位置の番号とファイルのページ番号の両方と、2 つが同じか（`numberingMatches`。並べ替え・削除・差し込みが無いか。回転・トリミング・モザイクは番号を変えない）を返す。画面への組み込み（`index.html` の読み込みを含む）は、質問 RG1〜RG3 の回答の後に行う |
| `39d0d1f` | ③ テキストのフォントの名前を、フォントの一覧 1 か所で持つようにした。画面の側 `renderer/text-fonts.js`（id・画面に表示する名前・font-family・/DA のフォント名）と、保存の側 `worker/text-fonts.js`（id・/DA のフォント名・標準と太字のファイル・サブセットの名前・Resources の名前）。今のフォントは Noto Sans JP の 1 つで、名前は今までと同じ（動きは変えない）。`test/text-fonts.test.js` が 2 つの一覧の食い違いと、`shell.css` の `@font-face` を見張る |
