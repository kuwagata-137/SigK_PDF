# 仕様書: Phase 4 塊⑤ 透かし＋フラット化

起草日: 2026-09-24
ステータス: **確定**（2026-09-24 確定。着手前の7件は `docs/07` 決定40、モックの1件と事前調査後の論点11件は `docs/07` 決定41 で
同日ユーザーが決定。19件とも起草者の推し。末尾「ユーザーの確定」を参照。残る細部は起草者の推しで書き、その一覧を
「起草者の判断で決めたもの」に置いた）
関連: `docs/05_開発ロードマップ.md` Phase 4（4-7・4-8）／`docs/01_製品要件定義.md` F-05-8〜F-05-10／`docs/04_UI設計.md` 4-4（ツールモード）・
第7章（戻せない操作）・第9章（アイコン）／`docs/02_アーキテクチャ設計.md` 2-3・第3章／`docs/spec-2-1-merge.md`（ツールモードの枠・
保存ダイアログ・入力と同じ出力先）／`docs/spec-2-2-split.md`（1 ファイルの対象の欄）／`docs/spec-3-3-pdf-to-image.md`（ページの集合・
題名付きの対象の選択）／`docs/spec-4-2-free-text.md`（Noto Sans JP と fontkit）／`docs/spec-4-4-notes-list.md`（付箋の外観・不透明度・表示のみの注釈）

この仕様書の「塊⑤」は Phase 4 の塊⑤を指す（Phase 1・3 にも塊⑤がある）。

---

## 目的

Phase 4 の最後の塊。**ツールモードに「透かし」と「フラット化」の 2 つの道具を足す。**

- **透かし**（F-05-8・F-05-9）: 1 つの PDF の全ページか指定したページに、文字（日本語可）か画像（PNG・JPEG）を重ね、
  新しいファイルに書き出す。文字列・色・不透明度・向き・位置・大きさを選べ、右のプレビューで書き出す前に見え方を確かめられる。
  文字は**字形の輪郭（パス）で描く**ので、書き出したファイルで透かしの文字が検索・選択・コピーに混ざらず、フォントも増えない（論点1）。
- **フラット化**（F-05-10「注釈の確定」）: 1 つの PDF の、**画面に見えている注釈**を外観のとおりページの内容へ焼き込み、
  新しいファイルに書き出す。実行前に、焼き込む件数・残すもの・失うもの（ノートの本文と作成者）を名指しして確認する。

どちらも元のファイルは変えず、書き出したファイルを新しいタブで開く（決定40 ④）。あわせて準備 3 本 — テキスト注釈の不透明度の
不具合の修正（決定40 ⑥）、窓を出さない起動確認（⑦）、ワーカーのツール系タスクの分割（⑤）— と、1 ファイルを対象にする欄の
共通部品化（論点11）を行う。**この塊の PR のマージをもって Phase 4 を完了とする。**

---

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| ツール一覧に「透かし」「フラット化」（既存の 4 つの後ろ） | 閲覧・注釈モードでの透かし・フラット化（開いている文書への編集として） |
| 対象は 1 ファイル（開いているファイル／ファイルを選ぶ／ドロップ）。ページは すべて／範囲 | 複数ファイルへのまとめての透かし |
| 文字: 1 行・50 文字まで。Noto Sans JP の字形の輪郭で描く（フォントを埋めない。論点1） | 書体・太さの選択、複数行、縁取り・影、文字として検索できる透かし |
| 画像: PNG か JPEG を 1 枚（論点7）。PNG の透過は保つ | BMP・GIF・TIFF、画像の切り抜き |
| 大きさ 小・中・大（紙に合わせる。論点5）、色 灰・赤・青・黒、不透明度 15・30・50・100%（論点6）、向き 斜め・水平（論点4）、位置 9 か所（論点3） | 数値での大きさ・角度・色の指定、背面への配置（論点2）、タイル状の繰り返し |
| 右のプレビュー（対象のページに透かしを重ねる。ページ送り付き） | プレビューの拡大、ドラッグでの位置合わせ |
| フラット化: 画面に見えている注釈を外観のとおり焼き込む（論点9）。外観の無いノートは付箋を描き起こして焼く（論点10） | 非表示・画面に出さない注釈、リンク・フォームの欄・添付ファイル・墨消しの指定などの焼き込み。外観の無い直線・テキスト等の描き起こし |
| 焼き込み前の確認（件数・残すもの・失うもの。既定はキャンセル） | 書き出したファイルでの取り消し（元のファイルは残る） |
| 出力先は実行時の保存ダイアログ（論点8）。書き出したファイルを新しいタブで開く | 出力フォルダーの記憶、既定名の変更 |
| 設定は覚えない（論点6）。アプリを閉じるまでは画面の値が残る | `settings.json` への透かしの設定の記憶（Phase 6 の設定画面で決める） |
| 準備: テキスト注釈の不透明度（決定40 ⑥）・窓を出さない起動確認 `SIGK_SMOKE_HIDDEN`（⑦）・`worker/tool-tasks.js` への分割（⑤）・1 ファイルを対象にする欄の共通部品（論点11） | 結合・画像→PDF の画面の作り直し、確認ダイアログの写しの共通化 |
| 起動確認 `SIGK_SMOKE_WATERMARK`・`SIGK_SMOKE_FLATTEN` | 右クリックメニューからの起動（Phase 5 のシェル統合で決める） |

---

## 事前調査（2026-09-24・Windows 11 実機・Node 24・Electron 44・pdf.js 6.3.289・pdf-lib 1.17.1・fixtures のみ）

プローブは scratchpad の使い捨て（Node で pdf-lib を回すもの、Browser パネルの静的サーバーで pdf.js を回して描いた画像を比べるもの）。
検体は `test/fixtures/` の `three-pages.pdf`・`rotated.pdf`・`mixed-size.pdf`・`annotated.pdf`・`image-palette.gif`・`image-wide.png` と、
それらにプローブで注釈・外観を足したもの。記録後に捨てた。

### A. 文字の透かし — **`/Artifact` で包んでも pdf.js は透かしの文字を本文として返す**

- Form XObject を 1 つ作って全ページで共有し、ページの内容の末尾に `q <cm> /SigKWM Do Q` を足す形で描ける。足し方は、文字列で組んだ
  中身を `context.stream` → `page.node.addContentStream(ref)`（pdf-lib の `normalize()` が既存の内容を `q … Q` で包む）。
  `PDFPage.pushOperators` は `instanceof PDFOperator` で確かめるので使わない（ワーカーは vendor の pdf-lib、テストは node_modules の pdf-lib）。
- 中心は CropBox の中心、紙の上の回転角は φ = 表示の角度＋ページの `/Rotate`。`rotated.pdf` の 90° のページでも表示の向きで上向き、
  `mixed-size.pdf` の A5 でも中央に来た（描いた画像で確認）。
- Resources を共有する PDF では、`newXObject`（`uniqueKey` が乱数の接尾辞を付ける）だとページ数ぶんキーが積み上がる（5 ページで 5 個）。
  固定名 `SigKWM` を `set` すれば 1 個で済む。
- **`/Artifact <</Type /Pagination /Subtype /Watermark>>` で包んでも、pdf.js の `getTextContent` は透かしの文字を返す**
  （`includeMarkedContent` を渡せば印の範囲は分かるが、本アプリの検索・選択・コピーは印を見ていない）。→ 文字として書くと
  「社外秘」が本アプリの検索結果やコピーした文章に混ざる（論点1 の材料）。
- 文字として書く場合（論点1 で不採用）: フォントは文書に 1 組、3 ページで +4.2KB、1,000 ページで 1.23 秒・+489 バイト／ページ。
- 複数行を `textBlockOps`（`spec-4-2`）で組むと左揃えのまま（行ごとの中央揃えが別に要る）。背面（`/Contents` の先頭へ入れる）も描けた（論点2 で不採用）。
- `annotation-appearance.num()` は小数 2 桁で、回転行列（cos 45° ＝ 0.7071）には粗い → 行列は小数 4 桁で書く。
  `normalize()` は `/Annots` の無いページに空の `/Annots` を足す（害は無い）。

### A2. 字形の輪郭で描く（論点1 で採用）

- vendor の fontkit で `font.layout(text)` のグリフと字送りを取り、`glyph.path.commands` を PDF のパス（`m`・`l`・`c`・`h`。TrueType の
  二次曲線は三次へ直す）にして `f` で塗ると、文字として書いたものと同じ見た目になる（描いた画像で確認）。**`getTextContent` に出ず、フォントを埋めない。**
- 「社外秘」72pt で中身 6.1KB（Flate 後 2.5KB）、レイアウトから中身を組むまで 8ms。XObject は文書に 1 つなので、ページ数が増えても増えるのは
  ページごとの 1 行だけ。

### B. 画像の透かし

- `embedImage`（`worker/image-page.js`）で 1 回だけ埋め、単位の箱に縦横比で置く Form XObject を全ページで共有できる。大きさは表示の幅に
  対する割合（`/Rotate` 90・270 は紙の高さ）で決められる。
- **PNG は SMask で透過が保たれる**（輪の形のロゴを 50% で重ねると、輪だけが透けて重なった）。**GIF は `pixel-image.js` が透過を白で
  合成するので白い四角が重なる**（BMP・TIFF も同じ経路）。JPEG は元々透過を持たない（論点7 の材料）。

### C. フラット化 — 試作が動いた。**`removeAnnotations` は外観まで消すので使えない**

- 各注釈の `/AP /N`（状態の辞書なら `/AS` で選ぶ）を `q <A> cm /SigKFlat Do Q` でページの内容に焼き、辞書と Popup を `/Annots` から外す。
  外観の実体は残す（ページの Resources から参照される）。既存の `annotation-remove.js` の `removeAnnotations` は `/AP /N` の実体まで消す。
- A は ISO 32000-1 12.5.5（`/BBox` を `/Matrix` で写した箱を `/Rect` に合わせる拡大と移動。`/Matrix` は `Do` が掛ける）。`/Matrix` 付き・
  `/BBox` の原点がずれた外観でも正しく収まった。
- NoRotate（ノート）は `/Rect` の左上を軸に、`/Rotate` を打ち消す向きへ回して焼くと、表示で上向きになる（本アプリの付箋・他のビューアと
  同じ見え方。pdf.js の canvas だけは紙と一緒に回す。`spec-4-4` 事前調査 A）。
- **辞書の `/CA` は重ねない**: pdf.js は外観があるとき辞書の `/CA` を使わない（`vendor/pdf.worker.mjs` で `if (!this.appearance)` のときだけ使う）。
  本アプリの外観は中で `/GS gs` を実行して `ca` を絶対値で設定し直すので、外側で掛けても結果は変わらない（二重に薄くならない）。
  規格の該当文は記憶にあるが、検索では確かめられなかった。
- 外観の無い注釈: ノートは `note-appearance.js` で付箋を描き起こして焼ける（`/Rect` の左上から 20×20 を作り直し、`/C` を `#rrggbb` に直して渡す。
  `annotation-import.js` と同じ）。`annotated.pdf` の他のツールの直線（Line）とテキスト（FreeText）は外観が無く、焼けずに注釈のまま残った。
  本アプリの画面でそれらが見えているのは、**pdf.js が自分の中だけで仮の外観を作って描いている**ため（`_setDefaultAppearance`（直線・矩形・
  楕円・折れ線・多角形・ペン・ハイライト系）と FreeText の `fakeUnicodeFont.createAppearance`）。その外観はファイルに無い（論点10 の材料）。
  スタンプ（`/AP` 付き）は焼けた。
- 非表示（Hidden）の注釈を焼くと見えるようになり、「画面に出さない」（NoView）の注釈を焼くと画面にも出るようになる。`/F` に印刷（Print）の
  無い注釈を焼くと印刷にも出るようになる。本アプリの注釈は全部印刷の指定付き（`op-annotate.js` の `F: appearance.flags ?? 4`、ノートと Popup は 28）。
  リンク・フォームの欄は残る。`/Annots` に辞書が直に並ぶ注釈も焼ける（論点9 の材料）。
- 焼き込み後、FreeText の文字はページの文字として検索に出るようになる。ノートの本文・作成者・Popup は失われる。
- 既存の不具合を実物で確認: 不透明度 50% で付けたテキスト注釈が、保存で `/CA 1` になる（`worker/free-text-appearance.js` が常に `opacity: 1` を返す。決定40 ⑥）。

### D. 焼き込み前後の見た目（pdf.js で描いて画素差）

- 本アプリで付けた注釈 9 件（ハイライト・下線・テキスト・矩形（50%）・楕円・矢印・ペン・ノート（75%））を焼いた前後: 差は線と文字の縁の
  にじみだけ。**2 倍で描いて、差が 64 を超える画素は 200 万画素中 27。**
- 意図して差が出るもの: 回転したページのノート（前は pdf.js が横倒しに描く）、NoView（前は画面に出ない）、外観の無いノート（前は pdf.js が描かない。
  本アプリは自前の付箋で描いている）。→ 完了の判定は「差が 64 を超える画素が 0.1% 未満（意図して変わる注釈の無いページで測る）」。

### E. 画面の組み

- 1 ファイルの道具の手本は分割（`tools-split.js`）と PDF→画像（`tools-to-image.js`）。**対象の欄（`setSource`・`useOpenTab`・`pickFile`・
  `addPaths` と描き方 `renderTarget`）は両画面でほぼ同じ写し**で、違いは読む関数（`inspectPdf`／`inspectPdfPages`）・帯の文言・選ぶ口だけ（論点11 の材料）。
- 1 本を書き出す結合は、実行時に OS の保存ダイアログを出す（`tools-merge.js`。既定 `<元>_結合.pdf`、同名は OS が確かめる、入力と同じ出力先は断る、
  タブが上限なら開かず「最近使ったファイル」へ）。複数を書き出す分割・PDF→画像は画面でフォルダーを選び、同名は 3 択（論点8 の材料）。
- **`tabs.js` の `openPath` は、同じパスのタブがあれば読み直さずに切り替えるだけ。**書き出した先がタブで開いていると、古い内容のタブが前に出る。
- ドロップの振り分け（`file-drop.js`）は `{ split, convert, toImage }` だけで、表に無いツールは結合へ落ちる。画像を受けるのは変換だけ。
- 画像を 1 枚だけ選ぶ口が無い（`pickImageSources` は複数選択で、題名が「変換する画像を選ぶ」に固定）。画面が画像の中身を読む口も無い
  （`pdf:read` は PDF に限る）。
- 件数は画面側（pdf.js の `getAnnotations({ intent: 'any' })`。既定では NoView・Invisible を返さない）でも数えられるが、焼くときと同じ判定に
  するためワーカーで数える（確定事項32）。差し込みの下見 `insert-preview` と同じく `save.runTask` を通る（帯が出る）。
- ツールの設定は今どれも覚えていない（`tools.js` のコメント「覚えるかどうかは Phase 6 の設定画面で決める」）。

---

## 確定事項

### A. 画面（`docs/04` 4-4・モック `screenshots/phase4-watermark.png`・`phase4-flatten.png`・`phase4-flatten-confirm.png`）

| # | 項目 | 決定 |
|---|---|---|
| 1 | ツール一覧 | `renderer/tools.js` の `TOOLS` の後ろに `{ id: 'watermark', label: '透かし', hint: '文字や画像を重ねる', icon: 'watermark' }`・`{ id: 'flatten', label: 'フラット化', hint: '注釈を焼き込む', icon: 'flatten' }`。アイコンは線だけで描く幾何形状（`assets/icons.js`。モックの 2 つ）。ツールモードに入ったときに結合を選ぶのは変えない |
| 2 | 透かし画面の組み | `<div class="tool-panel" data-tool="watermark">`。見出し「透かし」＋説明「文字か画像をページに重ねて、新しいファイルに書き出します。元のファイルは変えません。」。左の列に「対象」「透かし」「ページ」の 3 節、右に「プレビュー」（幅 280px。スクロールしても上に留まる）。下の帯に要約と「実行…」。**モックの「出力」の節は置かない**（論点8） |
| 3 | 「透かし」の節 | 種類（文字／画像のラジオ。既定 文字）。**文字**（`<input type="text" maxlength="50">`。既定「社外秘」。文字のときだけ）。**画像**（「画像を選ぶ…」と、選んだ画像の名前・画素数。画像のときだけ。未選択なら「PNG か JPEG の画像を選んでください。ここへドロップしてもかまいません。」）。**大きさ**（小・中・大。既定 中。添え書き「紙の大きさに合わせて決めます」）。**色**（灰・赤・青・黒の丸。既定 灰。文字のときだけ）。**不透明度**（15・30・50・100%。既定 30%）。**向き**（斜め「左下から右上へ」・水平。既定 斜め）。**位置**（3×3 の格子のボタン 9 個。既定 中央。`aria-label` は「左上」「上」「右上」「左」「中央」「右」「左下」「下」「右下」）。向き・大きさ・不透明度・位置は文字と画像で同じ値を使う |
| 4 | 「ページ」の節 | すべて（既定）／範囲＋入力欄（例: 1-3, 5, 8-）。書き方は `page-range.js`。**重複は畳んで昇順**（`image-export-plan.js` と同じ「集合」。範囲の空欄はすべて）。誤りは欄の下に赤字（分割と同じ） |
| 5 | プレビュー | 対象のページを縮小して描き（`page-image.js`）、同じ幾何（確定事項12〜19）で透かしを SVG で重ねる。文字は `'SigK Noto Sans JP'`（保存と同じ字形）、画像はその画像。見出し「N ページ目（全 M ページ）」と前・次のボタンで全ページを送れる。透かしを入れないページは透かし無しで描き、見出しに「（透かしを入れないページ）」を足す。初めは透かしを入れる最初のページ。設定を変えるとすぐ追従する（ページの絵を描き直すのはページか対象を変えたときだけ）。対象が無い・読めないときは紙の代わりに「対象を決めるとここに出ます」 |
| 6 | 要約と実行（透かし） | 「3 ページに文字の透かしを入れます」／「3 ページに画像の透かしを入れます」。実行できないときは要約の代わりに理由（対象が無い・読んでいる・読めない・文字が空・画像が無い・範囲の誤り）を出し、「実行…」は `aria-disabled`。実行中・ほかの作業中（`save.isBusy()`）も押せない |
| 7 | フラット化画面の組み | `<div class="tool-panel" data-tool="flatten">`。見出し「フラット化」＋説明「注釈をページの内容として焼き込み、新しいファイルに書き出します。元のファイルは変えません。」。「対象」「焼き込む注釈」の 2 節と下の帯。モックの「出力」の節は置かない |
| 8 | 「焼き込む注釈」の節 | 対象を決めるとワーカーで数え（確定事項32）、数えている間は「数えています…」。まとまりごとの件数 — **ハイライト・下線・取り消し線**／**テキスト**／**図形・ペン**／**ノート**／**スタンプなど** — と合計を出す（0 件のまとまりは出さない）。下に「焼き込まずに残すもの」: 「リンク・フォームの欄など N 件はそのまま残します。」「見た目の情報を持たない注釈 N 件（直線・テキストなど）は焼き込めないため、注釈のまま残します。」「表示されていない注釈 N 件は、注釈のまま残します。」（0 件の文は出さない）。ノートがあれば注意「ノート N 件は付箋の絵だけが残り、本文と作成者は書き出したファイルに残りません。」 |
| 9 | 要約と実行（フラット化） | 「注釈 N 件を焼き込みます」。0 件なら「焼き込める注釈がありません」で実行できない。数えられなかったときは理由を出して実行できない |
| 10 | 確認ダイアログ | `<dialog id="confirm-flatten">`。題「注釈を焼き込みますか」。本文 1「注釈 N 件をページの内容として焼き込み、「<出力名>」に書き出します。書き出したファイルでは、これらの注釈を選んだり直したりできません。元のファイルは変わりません。」。本文 2（ノートがあるときだけ）「ノート N 件の本文と作成者は、書き出したファイルに残りません。」。ボタン「キャンセル」（**既定のフォーカス**）・「焼き込む」（`dlg-btn danger`）。Esc・閉じるはキャンセル（`docs/04` 第7章） |
| 11 | 実行の流れ | 「実行…」→ 保存ダイアログ（確定事項40）→ 出力先の検査（確定事項41・42）→（フラット化だけ）確認（確定事項10）→ `save.runTask` → 成功なら新しいタブで開いて閲覧モードへ（確定事項43） |

### B. 透かしの幾何（事前調査 A・B。論点3〜5）

| # | 項目 | 決定 |
|---|---|---|
| 12 | 基準の箱 | CropBox（無ければ MediaBox。pdf-lib の `getCropBox()`）`[x0, y0, x1, y1]`。表示の幅 W・高さ H は `/Rotate` 90・270 なら入れ替える |
| 13 | 透かしの素の箱 | XObject の中の座標で、**文字**は大きさ 100 で組んだ幅（字送りの合計）× 高さ 144.8（Noto Sans JP の ascent 1.16＋descent 0.288。`free-text-appearance.js` と同じ値）、**画像**は 100 × 100·縦／横。どちらも箱の中心を原点に置く（文字のベースラインは中心から 43.6 下） |
| 14 | 向き θ | 斜め 45°（表示で左下から右上へ）・水平 0°（論点4） |
| 15 | 大きさ | 回した箱の外形 `bw = |w cosθ| + |h sinθ|`・`bh = |w sinθ| + |h cosθ|` が、紙の幅と高さの k 倍に収まる倍率 `s = k × min(W / bw, H / bh)`。**k は 小 0.25・中 0.5・大 0.8**（論点5。文字が長いほど小さくなり、はみ出さない） |
| 16 | 位置 | 列（左・中・右）× 行（上・中・下）の 9 か所（論点3）。中心の表示座標（左上が原点・y は下向き）は、中なら紙の中央。端なら紙の縁から余白 `m = 0.05 × min(W, H)` をとって外形を寄せる（左 `m + s·bw/2`・右 `W − m − s·bw/2`。上下も同じ） |
| 17 | 表示から紙へ | 中心 (cx, cy) を `/Rotate` で紙の座標 (X, Y) へ直す。0°: `(x0 + cx, y1 − cy)`／90°: `(x0 + cy, y0 + cx)`／180°: `(x1 − cx, y0 + cy)`／270°: `(x1 − cy, y1 − cx)`。紙の上の回転角は **φ = θ + `/Rotate`** |
| 18 | 行列 | `cm = [s·cosφ, s·sinφ, −s·sinφ, s·cosφ, X, Y]`。数は小数 4 桁 |
| 19 | 画面と保存で同じ計算 | `worker/watermark-layout.js` と `renderer/watermark-geometry.js` に同じ式を持ち、一致をテストで見張る（`note-appearance.js`／`note-graphics.js` と同じ流儀。プロセスが違うので import はしない）。画面は文字の字送りを canvas の `measureText`（`'SigK Noto Sans JP'`。保存側の fontkit と日本語で一致する。`spec-4-2` 事前調査 D）で測る |

### C. 透かしの書き方（ワーカー。事前調査 A・A2・B）

| # | 項目 | 決定 |
|---|---|---|
| 20 | 文字の輪郭（論点1） | vendor の fontkit（`createFontSource().load()`）で `fontkit.create(bytes)` → `font.layout(text)`。各グリフの `path.commands` を大きさ 100 で PDF のパスにする（`moveTo`→`m`・`lineTo`→`l`・`quadraticCurveTo`→ 三次の `c`（制御点は 2/3 の内分）・`bezierCurveTo`→`c`・`closePath`→`h`）。字送りは `positions[i].xAdvance`、ずれは `xOffset`・`yOffset`。x は −幅/2 から、ベースラインは y = −43.6。全部を並べて最後に `f`（非ゼロ巻き数）で塗る。数は小数 2 桁。**フォントは埋めない** |
| 21 | 画像 | `embedImage` で 1 回だけ埋める（PNG の透過は SMask で保たれる）。形式は PNG・JPEG だけ（先頭バイトで判定。論点7）。XObject の中身は `q 100 0 0 <100·縦／横> −50 <−50·縦／横> cm /Im Do Q` |
| 22 | XObject は文書に 1 つ | `/Type /XObject /Subtype /Form /BBox <箱> /Resources << /ExtGState << /GS << /Type /ExtGState /ca a /CA a >> >>（画像は /XObject << /Im ref >> も） >>`。中身は `/GS gs` → 文字なら `r g b rg` と輪郭と `f`、画像なら `q … /Im Do Q`。a は不透明度（0.15・0.3・0.5・1）。`/BBox` は画像なら素の箱 `[−w/2 −h/2 w/2 h/2]`、文字なら素の箱と輪郭の外接の箱を合わせたもの（`/BBox` は描画を切り抜くので、字形が字送りの外へはみ出しても切れないように）。大きさと位置の計算（確定事項13〜16）は素の箱で行う |
| 23 | ページへの足し方 | 対象ページの Resources の `/XObject` に**固定名 `SigKWM`** で置く（その名前に別のものがあれば `SigKWM1`・`SigKWM2`… の空いている名前。同じ XObject なら使い回すので、Resources を共有する PDF でもキーは 1 つ）。内容の末尾に `/Artifact <</Type /Pagination /Subtype /Watermark>> BDC q <cm> cm /<名前> Do Q EMC` を 1 本足す（`context.stream` → `page.node.addContentStream`） |
| 24 | 重なり順（論点2） | 前面だけ。ページの内容の上に描かれ、注釈はさらにその上に出る |
| 25 | 対象ページ | spec の `pages`（0 始まり・重複なし・昇順）。範囲外・重複・空はワーカーでも断る |
| 26 | 保存 | 既存のツールと同じ保存の設定で `target` に書く。中止したときの書きかけは既存の経路が消す |

### D. フラット化（ワーカー。事前調査 C・D。論点9・10）

| # | 項目 | 決定 |
|---|---|---|
| 27 | 焼く・残すの判定（論点9） | **焼く種類**: `Text`・`FreeText`・`Line`・`Square`・`Circle`・`Polygon`・`PolyLine`・`Highlight`・`Underline`・`Squiggly`・`StrikeOut`・`Stamp`・`Caret`・`Ink`・`Watermark`。**働きを持つので残す**: `Link`・`Widget`・`FileAttachment`・`Sound`・`Movie`・`Screen`・`RichMedia`・`3D`・`Redact`・`PrinterMark`・`TrapNet`・知らない種類（墨消しの指定を焼くと、下の文字が残ったまま消えたように見えて危ない）。**見えていないので残す**: `/F` に Invisible（1）・Hidden（2）・NoView（32）のどれかが立つもの（pdf.js の表示の判定と同じ）。`/F` に Print の無いものも、見えていれば焼く。`Popup` は親に従う（確定事項31） |
| 28 | 外観の選び方と描き起こし（論点10） | `/AP /N` がストリームならそれ。辞書なら `/AS` の名前で引いたストリーム（`/AS` が無い・引けないなら外観なし）。ストリームに `/BBox` が無い、または幅か高さが 0 なら外観なし。**外観なしの `Text` は付箋を描き起こす**（`note-appearance.js` の `noteAppearanceOf`。`/Rect` の左上 `(x1, y2)` から 20×20・`/C` を `#rrggbb` に直した色（無ければ黄 `#ffe45a`）・不透明度 1 ＝ 本アプリの画面と同じ）。外観なしの他の種類は残す |
| 29 | 焼き方 | 外観の XObject をページの Resources の `/XObject` に `SigKF1`・`SigKF2`…（空いている名前）で置き、内容の末尾に `q <A> cm /SigKFn Do Q` を**注釈の並び順に** 1 本の内容として足す。A は ISO 32000-1 12.5.5（`/BBox` を `/Matrix` で写した外接の箱を、`/Rect` に合わせる拡大と移動）。`Text` と、`/F` に NoRotate（16）が立つ注釈は、`/Rect` の左上を軸に `/Rotate` を打ち消す向きへ回す（表示で上向き）。外観の辞書に `/Subtype /Form` が無ければ足す |
| 30 | 不透明度 | 注釈の辞書の `/CA` は重ねない（pdf.js と同じ。本アプリの外観は中で不透明度を設定し直す。事前調査 C） |
| 31 | 注釈を外す | 焼いた注釈の辞書と、その `/Popup` の辞書を文書から消す（`context.delete`。**ノートの本文・作成者がファイルに残らない**）。ページの `/Annots` は残すものだけの新しい配列にし（共有された配列を書き換えない）、空なら `/Annots` を消す。**外観のストリームは消さない**。`/Annots` に辞書が直に並ぶものも同じ判定で焼く。親を焼いた Popup は外し、残した注釈の Popup は残す。`annotation-remove.js` の `removeAnnotations` は外観まで消すので使わない |
| 32 | 数える（`flatten-preview`） | 書かずに確定事項27・28 と同じ判定を回し、`{ ok, bake: { markup, text, shape, note, other }, keep: { functional, noAppearance, hidden }, notes }` を返す（`markup` ＝ Highlight・Underline・StrikeOut・Squiggly、`text` ＝ FreeText、`shape` ＝ Square・Circle・Line・Polygon・PolyLine・Ink、`note` ＝ Text、`other` ＝ Stamp・Caret・Watermark。`notes` は焼くノートの数）。`insert-preview` と同じくファイルを書かない経路 |
| 33 | 結果 | `{ ok, baked: N, kept: M, pages }`。焼くものが 0 件ならワーカーでも断る |

### E. 画面の部品（論点7・11）

| # | 項目 | 決定 |
|---|---|---|
| 34 | 共通部品 `renderer/source-picker.js`（論点11） | 1 ファイルを対象にする欄の状態・指揮・描き方。`create({ inspect, pick, dirtyMessage, onSelect, onChange })` が `{ source(), setSource(path, { dirty }), useOpenTab(), pickFile(), addPaths(paths), render(elements) }` を返す（`onSelect(path)` は対象が決まった直後に呼ばれ、分割・PDF→画像が出力フォルダーの既定を決めるのに使う。`onChange` は描き直しの合図）。分割・PDF→画像の `setSource`・`useOpenTab`・`pickFile`・`addPaths`・`renderTarget` をここへ移し、**両画面の既存のテストは 1 行も変えずに通す**（振る舞いを変えない別のコミット）。読んでいる間に差し替えられたら古い結果を捨てる・複数本が届いたら先頭だけ使って帯を出す、は今のまま |
| 35 | 画像を 1 枚選ぶ口 | `pdfAPI.pickImageSource({ defaultPath, title })`（IPC `pdf:pickImageSource`・`image-io.js` の `pickImageSource`。1 本選択。フィルターは PNG・JPEG）→ `{ path }`／`{ canceled }`。題は「透かしにする画像を選ぶ」 |
| 36 | 画像を読む口 | `pdfAPI.readImage(path)`（IPC `pdf:readImage`・`image-io.js`。`MAX_IMAGE_BYTES` まで）→ `{ ok, kind, width, height, name, bytes }`／`{ error }`。画面はプレビューに Blob URL で出す（CSP の `img-src blob:` で許されている）。PNG・JPEG 以外は「PNG か JPEG の画像を選んでください」と断る（論点7）。書くときはワーカーがパスから読み直す（画像→PDF と同じ） |
| 37 | ドロップ | 透かしを選んでいるときは PDF と PNG・JPEG を受け、`toolsWatermark.addPaths` が PDF の先頭を対象に、画像の先頭を透かしの画像にして種類を「画像」へ切り替える（同じ種類が 2 つ以上なら先頭だけ使い帯を出す）。フラット化は PDF だけで `toolsFlatten.addPaths`（先頭 1 本）。`file-drop.js` の振り分けの表に `watermark`・`flatten` を足し、受ける拡張子をツールごとに引く（表に無いツールが結合へ落ちる今の既定は変えない） |
| 38 | 未保存のタブ | 対象が未保存のタブなら注意書き「未保存の編集は反映されません」と帯（分割と同じ流儀）。帯は透かし「未保存の編集は透かしに反映されません。保存してから透かしを入れ直してください。」、フラット化「未保存の編集はフラット化に反映されません。保存してからフラット化し直してください。」 |
| 39 | 設定を覚えない（論点6） | 透かしの設定は `settings.json` に書かない。画面の状態はモジュールの中にあるので、アプリを閉じるまではツールを切り替えても残る（既存のツールと同じ） |

### F. 出力（論点8）

| # | 項目 | 決定 |
|---|---|---|
| 40 | 保存ダイアログ | 「実行…」で `pdfAPI.pickSavePath`。題は「透かしを入れた PDF を保存」「フラット化した PDF を保存」。既定は元と同じフォルダーの **`<元の名前>_透かし.pdf`・`<元の名前>_フラット化.pdf`**。同名の確認は OS のダイアログが行う（結合と同じ） |
| 41 | 入力と同じ出力先 | 断る（帯「出力先に入力ファイルと同じファイルは選べません。」。`spec-2-1` 確定事項24） |
| 42 | タブで開いている出力先 | 断る（帯「出力先のファイルはタブで開いています。タブを閉じるか、別の名前を選んでください。」）。`openPath` は同じパスのタブを読み直さないので（事前調査 E）、同じ名前でやり直すと古い内容のタブが残り、そのタブを上書き保存すると書き出した結果を消してしまうため |
| 43 | 成功 | タブが上限なら開かず「最近使ったファイル」に足し、帯「…しました。タブが多すぎるため開いていません。」。それ以外は新しいタブで開いて閲覧モードへ（結合と同じ）。帯「3 ページに透かしを入れました」「注釈 12 件を焼き込みました」 |
| 44 | 中止・失敗 | 帯「透かしを入れるのを中止しました」「フラット化を中止しました」、失敗はワーカーの文言。書きかけは既存の経路が消す |

### G. 準備（決定40 ⑤⑥⑦）

| # | 項目 | 決定 |
|---|---|---|
| 45 | テキスト注釈の不透明度（⑥） | `freeTextAppearanceOf` が entry の `opacity`（0〜1 の有限数。無い・範囲外は 1）を返す。保存で `/CA` と外観の ExtGState に同じ値が書かれる。先に落ちるテスト（`test/free-text-appearance.test.js`・`test/op-annotate.test.js`）を書いてから直す（独立したコミット）。本アプリで開き直すと 1 に戻るのは既知の限界のまま（`spec-4-4` 事前調査 C）。`spec-4-4` の確定事項17・27・判定6 の「テキストにも通っている」旨を訂正する |
| 46 | 窓を出さない起動確認（⑦） | `SIGK_SMOKE=1` と `SIGK_SMOKE_HIDDEN=1` が揃ったときだけ効く。主窓を出さない（`ready-to-show` の `maximize()`・`show()` を止める）。`SIGK_SMOKE_DISPLAY` は無視する。閉じるときに `settings.json` の `window` を書かない。画面写真は既定の `capturePage()`。結果の JSON に `hidden: true`・写真の `isEmpty` と大きさ・`document.visibilityState`・`requestAnimationFrame` が回ったかを出す。判定は Electron を読まない関数（`smoke-window.js`）に出してテストで見張る。rAF が止まるなら起動確認の経路だけ `webContents.setBackgroundThrottling(false)`。`SIGK_SMOKE_PERF` とは併用しない。**隠した窓で描画と写真が取れなければ、決定19 の `SIGK_SMOKE_DISPLAY=secondary` に戻して報告する** |
| 47 | `worker/tool-tasks.js`（⑤） | 結合・分割・変換の実行関数と、それらが使う読み込み・保存の設定と文言を移す（共有するものは役割の分かる名前のモジュールへ）。依存は `pdf-task.js` → `tool-tasks.js` の片方向で、`tool-tasks.js` は require しても副作用なし（`parentPort` の結線と注釈のフォントの口は `pdf-task.js` に残す）。`pdf-task.js` は `runMerge`・`runSplit`・`runConvert` を再エクスポートし、**既存のテストは 1 行も変えない**（振る舞いを変えない別のコミット）。透かし・フラット化の実行関数もこの振り分けに載せる（新しい kind `watermark`・`flatten`・`flatten-preview` がそれぞれの実行関数へ届くことを `runTask` 経由のテストで見張る。表に無い kind が保存へ落ちる今の既定は変えない） |

### H. 起動確認（開発ツリーと配布物の両方。窓は出さない）

| # | 項目 | 決定 |
|---|---|---|
| 48 | `SIGK_SMOKE_WATERMARK` | 透かしの画面を操作列（例 `source:three-pages.pdf,text:社外秘,size:large,color:#d92c2c,opacity:50,angle:0,pos:top-right,pages:1-2,run`。画像は `image:image-alpha.png`）で動かし、プレビューの行列、書き出した PDF の各ページの透かしの名前と行列、XObject とフォントの数、pdf.js の `getTextContent` に透かしの文字が出ないこと、開いたタブを JSON で出す。`rotated.pdf`・`mixed-size.pdf` でも回す |
| 49 | `SIGK_SMOKE_FLATTEN` | フラット化の画面を操作列で動かし、数えた件数、確認ダイアログの既定のフォーカス、焼いた後の `/Annots`（リンクは残る）、ノートの本文が残っていないこと、**焼き込み前後を pdf.js で描いた画素差**（差が 64 を超える画素の割合）を出す。検体は `annotated.pdf` と、`SIGK_SMOKE_ANNOTATE` で本アプリの注釈を付けて保存したもの |

---

## 足りない部品

### 新しいモジュール（テストは `test/<module>.test.js` と 1 対 1）

| ファイル | 層 | 役目 |
|---|---|---|
| `worker/watermark-layout.js` | 純関数 | 確定事項12〜18。`SIZE_RATIOS`・`MARGIN_RATIO`・`ANGLES`・`POSITIONS`・`displaySize(box, rotate)`・`placementOf({ box, rotate, width, height, angle, size, position })` → `cm` の 6 数 |
| `worker/glyph-outline.js` | 純関数 | 確定事項20。`pathOps(commands, scale, dx, dy)`・`outlineOf(font, text)` → `{ ops, width, height }`（fontkit のフォントを受け取る。pdf-lib を知らない） |
| `worker/watermark-appearance.js` | 純関数 | 確定事項21・22。`textMarkOf(outline, { color, opacity })`・`imageMarkOf({ aspect, opacity })` → `{ content, bbox, gs }`。色・不透明度の検査 |
| `worker/op-watermark.js` | ワーカー | 確定事項21〜26。`runWatermark(spec, deps)`（読む → XObject を 1 つ作る → 対象ページへ足す → 書く） |
| `worker/flatten-geometry.js` | 純関数 | 確定事項29。`multiply`・`placementMatrix(bbox, matrix, rect)`・`noRotateMatrix(rect, rotate)` |
| `worker/flatten-selection.js` | 純関数 | 確定事項27・32。`decide({ subtype, flags, hasAppearance })` → `{ action: 'bake' \| 'draw-note' \| 'keep', reason, group }`・`census(decisions)` |
| `worker/op-flatten.js` | ワーカー | 確定事項27〜33。`runFlatten(spec, deps)`・`previewFlatten(spec, deps)`（外観を選ぶ・描き起こす・焼く・外す） |
| `worker/tool-tasks.js` | ワーカー | 確定事項47。ツールの kind の振り分けと実行関数 |
| `smoke-window.js` | 純関数（メイン） | 確定事項46 の判定（`SIGK_SMOKE`・`SIGK_SMOKE_HIDDEN`・`SIGK_SMOKE_DISPLAY`・`SIGK_SMOKE_PERF` から窓の出し方を決める） |
| `renderer/source-picker.js` | 画面 | 確定事項34 |
| `renderer/watermark-geometry.js` | 純関数 | 確定事項19。`worker/watermark-layout.js` と同じ式でプレビューの `transform` を返す |
| `renderer/watermark-plan.js` | 純関数 | 設定の検査と spec の組み立て（文字の整え方・ページの集合・既定の出力名・要約の文）。確定事項3・4・6・40 |
| `renderer/watermark-preview.js` | 画面 | 確定事項5。ページの絵は `page-image.js`、透かしは SVG |
| `renderer/tools-watermark.js`・`tools-watermark-view.js` | 指揮・画面 | 確定事項2〜6・11・35〜44（分割の 2 本と同じ分け方） |
| `renderer/tools-flatten.js` | 指揮・画面 | 確定事項7〜9・11・32・40〜44 |
| `renderer/confirm-flatten.js` | 画面 | 確定事項10。`ask({ count, name, notes })` → `'flatten'`／`'cancel'` |

### 既存への追記

| ファイル | 変更 |
|---|---|
| `renderer/tools.js` | 確定事項1（`TOOLS` に 2 つ。「透かしはそれを作るフェーズで足す」のコメントを現状へ） |
| `renderer/file-drop.js` | 確定事項37 |
| `renderer/tools-split.js`・`tools-split-view.js`・`tools-to-image.js`・`tools-to-image-view.js` | 確定事項34（対象の欄を `source-picker.js` へ。振る舞いは変えない） |
| `index.html` | パネル 2 つ・`#confirm-flatten`・`<script>`（`app.js` より前） |
| `renderer/app.js` | 新しい画面の `init` |
| `assets/icons.js` | `watermark`・`flatten` |
| `renderer/shell.css` | 透かし・フラット化の画面とプレビュー（モックの `.wm-*`・`.fl-*`）・`#confirm-flatten` |
| `image-io.js`・`main.js`・`preload.js`・`test/harness.js` | 確定事項35・36（`pickImageSource`・`readImage`） |
| `worker/pdf-task.js` | 確定事項47（振り分けを `tool-tasks.js` へ。`flatten-preview` はファイルを書かない経路に載せる） |
| `worker/free-text-appearance.js` | 確定事項45。53 行目のコメント「塊⑤の透かしも同じ口」を現状へ（透かしは輪郭で描く） |
| `main.js` | 確定事項46・48・49（`SIGK_SMOKE_HIDDEN`・`watermarkScript`・`flattenScript`） |
| `test/fixtures/build.js` | 検体 2 つを生成コードで足す: `rotations.pdf`（`/Rotate` 0・90・180・270 のページと CropBox が MediaBox と違うページ、Resources を 1 つ共有）、`annotation-flags.pdf`（`/Matrix` と `/AS` 付きの外観・Hidden・NoView・Print 無し・外観の無いノートと直線・Popup・リンク・墨消しの指定） |
| `test/tools.test.js`・`test/shell.test.js` | ツールの並び、アイコン、確認ダイアログの既定のフォーカスと危険色 |
| `docs/02`・`docs/04`・`docs/05`・`docs/06`・`docs/07`・`README.md`・`docs/spec-4-2`・`docs/spec-4-4` | 現在地と、文書の食い違いの訂正（下の「文書の食い違い」） |

依存は増えない（fontkit は塊②で入っている）。

### 文書の食い違い（この塊で揃える）

- `docs/04` 4-4・第9章・`docs/02` の画面モジュールは「透かし」だけを挙げる → 「透かし」「フラット化」の 2 つにする（決定40 ④）。
- `docs/04` 第7章のフラット化の確認文言「以後この注釈は編集できません」は、元のファイルが残る形と合わない → 確定事項10 の文言へ。
- `spec-4-2` 確定事項27 は `textBlockOps` が `matrix` を受けると書くが、実物は受けない。また「塊⑤の透かしも同じ口」（`spec-4-2` の目的・
  確定事項27、`docs/02` の同じ記述、`free-text-appearance.js` のコメント）は論点1 で変わった → 実物と論点1 に合わせる。
- `docs/07` 手順60 の括弧書き「塊②の `textBlockOps` を透かしの文字に使う」→ 論点1 に合わせる。
- `docs/06` の Noto Sans JP の用途欄に「透かし（字形の輪郭を描く。フォントは埋めない）」を足す。

---

## テストの範囲

| 層 | 対象 |
|---|---|
| 依存なし | `watermark-layout.js`（9 か所・2 つの向き・3 つの大きさ・`/Rotate` 0〜270・CropBox の原点がずれた箱・長い文字で小さくなる・外形が紙の k 倍に収まる）、**`renderer/watermark-geometry.js` との一致**、`glyph-outline.js`（各コマンドの変換・二次 → 三次・字送りとずれ・中心とベースライン）、`watermark-appearance.js`（中身の文字列・BBox・不透明度・色の検査）、`op-watermark.js`（書いて読み直し: 対象ページだけに `SigKWM` と `Do`・XObject は 1 つ・フォントは増えない・`/Rotate 90` のページの行列・Resources を共有する PDF でキーが 1 つ・名前の衝突・PNG の SMask・JPEG・BMP は断る・範囲外のページは断る）、`flatten-geometry.js`（12.5.5 の写像・`/Matrix` 付き・原点のずれ・NoRotate の 4 つの回転）、`flatten-selection.js`（種類と `/F` の表）、`op-flatten.js`（`annotated.pdf` と `annotation-flags.pdf`: 焼いた注釈が `/Annots` から消えリンクは残る・外観の実体が生きている・内容に `Do`・`/AS` の選択・外観の無いノートの描き起こし・直線は残る・Hidden／NoView は残る・Popup が消える・ノートの `/Contents` がファイルのどこにも無い・直に並ぶ辞書・共有された `/Annots`・`previewFlatten` の件数が `runFlatten` と一致）、`free-text-appearance.js`・`op-annotate.js`（テキストの `/CA 0.5` と ExtGState）、`tool-tasks.js`（新しい kind の振り分け）、`smoke-window.js` |
| jsdom | `source-picker.test.js`、分割・PDF→画像の既存テスト（無変更で通る）、`watermark-plan.test.js`（文字の整え方・空・50 文字・ページの集合・範囲の誤り・spec の完全一致・既定の出力名）、`tools-watermark.test.js`（対象・画像を選ぶ・種類の切り替え・設定の変更・「実行…」→ 保存ダイアログ → `runTask` の spec・入力と同じ出力先／タブで開いている出力先を断る・中止・タブが上限・未保存の注意書き）、`watermark-preview.test.js`（ページ送り・透かしを入れないページ・SVG の transform）、`tools-flatten.test.js`（数える → 件数と残すもの・0 件で実行できない・確認で「キャンセル」なら何もしない・「焼き込む」で `runTask`）、`confirm-flatten.test.js`（文言・既定のフォーカス・Esc）、`file-drop.test.js`（透かしに PDF と画像・フラット化に PDF）、`tools.test.js`・`shell.test.js` |
| 起動確認 | 確定事項46・48・49。開発ツリーと配布物の両方で、`SIGK_SMOKE_HIDDEN=1` を付けて窓を出さずに回す |

---

## 完了の判定

1. ツール一覧に「透かし」「フラット化」が並び、画面がモックのとおり（「出力」の節が無いことを除く）。透かしのプレビューが設定に追従し、
   書き出した結果と同じ位置・向き・大きさ
2. 文字の透かし: 日本語の文字列・大きさ・色・不透明度・向き・9 か所の位置・ページ範囲を指定して新しいファイルに書け、新しいタブで開く。
   書き出したファイルでは、透かしの文字が検索・文字の選択・コピーに出ず、フォントも増えていない
3. 画像の透かし: PNG か JPEG を 1 枚選び（ドロップでも）、大きさ・不透明度・向き・位置を指定して同じように書ける。PNG の透過が保たれる。
   BMP・GIF・TIFF は断る
4. 回転（90・180・270）・大きさ違い・CropBox が MediaBox と違うページでも、指定した位置に表示の向きで上向き。透かしの XObject は文書に 1 つで、
   Resources を共有する PDF でもキーが増えない
5. フラット化: 実行前に確認が出る（既定はキャンセル・「焼き込む」は危険色）。出力では焼いた注釈が注釈として残らず（リンクは残る）、
   見た目は焼き込み前と同じ（pdf.js で描いて差が 64 を超える画素が 0.1% 未満。意図して変わる注釈の無いページで測る）
6. 外観の無いノートは付箋として焼かれ、外観の無い他の注釈・表示されていない注釈・働きを持つ注釈は注釈のまま残る。焼いたノートの本文と作成者、
   焼いた注釈の Popup はファイルに残らない（`annotated.pdf`・`annotation-flags.pdf`）
7. 入力と同じ出力先・タブで開いている出力先は断る。同名は OS の確認。パスワード付き・壊れた PDF は実行できない。中止で書きかけが残らない。
   未保存のタブには注意書き
8. テキスト注釈を不透明度 50% で保存すると、保存した PDF の `/CA` と外観の ExtGState が 0.5 になる
9. 分割・PDF→画像の画面を共通部品に差し替えても、既存のテストが 1 行も変えずに通る
10. `npm test` が緑（`TZ=UTC` でも）。配布物でも `SIGK_SMOKE=1 SIGK_SMOKE_HIDDEN=1` で起動確認（`SIGK_SMOKE_WATERMARK`・`SIGK_SMOKE_FLATTEN` を含む）が
    通り、窓が出ない
11. 書き出した PDF を他のビューアで開き、透かし・焼き込んだ注釈・テキスト注釈の不透明度が同じに見える（**ユーザーの目視**。塊①判定10〜
    塊④判定12 と同じ扱い）

### 人が目で確かめる手順

- 画面の見た目が `screenshots/phase4-watermark.png`・`phase4-flatten.png`・`phase4-flatten-confirm.png` と揃っていること（「出力」の節は無い）。
- 透かしの設定を変えるとプレビューがすぐ変わり、書き出したファイルを開くと同じ見え方であること（回転したページでも）。
- 書き出したファイルを他のビューアで開き、透かしが同じ位置・向き・濃さで見え、文字として選べないこと。
- フラット化したファイルを他のビューアで開き、注釈がページの一部として同じ見え方で残り、注釈の一覧に出ないこと。

---

## ユーザーの確定

### 着手前（2026-09-24。`docs/07` 決定40）

1. 着手する塊は塊⑤（ロードマップの順序どおり）
2. 塊①〜④の目視（`spec-4-1` 判定10・`spec-4-2` 判定11・`spec-4-3` 判定12・`spec-4-4` 判定12）はまだ → 持ち越し
3. 到達点は塊⑤まるごと（事前調査 → モック → 仕様書と論点の確定 → 実装 → 完了判定 → 配布物の起動確認 → push。PR は指示待ち。Phase 5 に入らない）
4. 置き場は透かし・フラット化とも、ツールモードの道具。対象は 1 ファイル。結果は別の新しいファイルに書いて新しいタブで開き、元のファイルは残る
5. `worker/pdf-task.js` のツール系タスクを `worker/tool-tasks.js` へ分ける（振る舞いは変えない）
6. 既存の不具合「テキスト注釈の不透明度が保存で 100% に戻る」を塊⑤の中で直す
7. 起動確認に「窓を出さない」指定を足す（駄目なら決定19 の方法に戻して報告する）

### モック（2026-09-24。`docs/07` 決定41）

8. 透かしの画面は**右にプレビューを置く**（対象のページを縮小して透かしを重ねる。ページ送り付き）（置かない＝分割・PDF→画像と同じ 1 列の画面）
   （`screenshots/phase4-watermark.png`・`phase4-flatten.png`・`phase4-flatten-confirm.png`）

### 事前調査後（2026-09-24。`docs/07` 決定41。11件とも起草者の推し。括弧内は採らなかった代替）

9. 論点1 透かしの文字は**字形の輪郭で描く**。フォントを埋めない（塊②の `textBlockOps` と同梱フォントのサブセットで文字として書く）
10. 論点2 **前面だけ**。重ね方の欄は置かない（前面・背面を選べる）
11. 論点3 位置は **9 か所から選ぶ**（中央だけ）
12. 論点4 向きは**斜め（45°）・水平の 2 択**（2 択＋角度の数値／角度の数値だけ）
13. 論点5 大きさは**小・中・大（紙に合わせる）**。文字にも画像にも同じ欄（文字は pt・画像は紙の幅の %／小・中・大＋割合の数値）
14. 論点6 設定は**覚えない**。色は灰・赤・青・黒、不透明度は 15・30・50・100%、既定は「社外秘」・灰・30%・斜め・中央・中（最後の値を `settings.json` に覚える）
15. 論点7 画像は **PNG と JPEG だけ**（5 形式すべて／5 形式で透過も保つ）
16. 論点8 出力先は**実行時の保存ダイアログ**。既定は元と同じフォルダーの `<元の名前>_透かし.pdf`・`_フラット化.pdf`（画面でフォルダーを選び、名前は決まった形）
17. 論点9 焼き込むのは**画面に見えている注釈**。非表示・画面に出さない注釈、働きを持つ注釈は残す。印刷の指定の無い注釈も見えていれば焼く（印刷に出る注釈だけ／非表示も含めてすべて）
18. 論点10 外観の無い注釈は、**ノートだけ付箋を描き起こして焼き、他は注釈のまま残す**（すべて残す／線で描ける種類も描き起こす）
19. 論点11 1 ファイルを対象にする欄を**共通部品にまとめ、分割・PDF→画像も差し替える**（新しい 2 画面だけが使う／まとめない）

### 起草者の判断で決めたもの

- ツール一覧の並び・名前・説明・アイコン（確定事項1）
- 確認ダイアログの文言・危険色・既定のフォーカス・順序（保存ダイアログの後）（確定事項10・11）。`docs/04` 第7章の「以後この注釈は編集できません」は、
  元のファイルが残る形に合わせて「書き出したファイルでは…」に改めた。抽出の確認（元を変えないので既定のフォーカスは実行側）と扱いを変えるのは、
  書き出したファイルの中では焼き込みを戻せないため
- 透かしの文字は 1 行・50 文字まで。前後の空白を落とし、制御文字は空白にする（確定事項3）。複数行は置かない（モックの入力欄のとおり）
- 大きさの割合（小 0.25・中 0.5・大 0.8）と縁の余白（紙の短い辺の 5%）、素の箱の高さは Noto Sans JP の ascent＋descent（確定事項13・15・16）
- プレビューは全ページを送れ、透かしを入れないページは透かし無しで見せる（確定事項5）
- 焼く種類と残す種類の線引き、Invisible も残す（pdf.js と同じ）（確定事項27）
- 外観の無いノートは不透明度 1 で描き起こす（本アプリの画面の見え方と同じ）（確定事項28）
- 件数はワーカーで数える（焼くときと同じ判定）（確定事項32）
- 出力先がタブで開いているときは断る（確定事項42）
- 透かしの XObject の固定名 `SigKWM` と衝突したときの別名、焼き込みの `SigKF<n>`、`/Artifact`（`/Pagination /Watermark`）で包む（確定事項23・29）
- 検体 2 つ（`rotations.pdf`・`annotation-flags.pdf`）を生成コードで足す
- モジュールの切り方と名前（「足りない部品」）。起動確認の操作列

---

## 未確定のまま残すもの

| 項目 | 扱い |
|---|---|
| フォントに無い文字 | 保存は `.notdef` の形（多くは空の四角）で描く。プレビューは画面の書体の代わりの字で出るので見え方が違う。テキスト注釈と同じ扱い |
| 焼いた注釈を指すタグ付き PDF の構造木の参照 | 宙に浮く（読み手は無視する）。構造木は直さない |
| 焼いた注釈の押したとき・重ねたときの外観（`/AP /D`・`/R`） | 参照されないまま残る（見た目にも中身にも効かない） |
| 外観の無い直線・テキスト等 | 注釈のまま残す（論点10）。要望があれば外観を作る部品を足す |
| 本アプリで開き直したテキスト注釈の不透明度 | 1 に戻る（`spec-4-4` 事前調査 C のまま）。保存した PDF には正しい値が残る |
| 透かしの設定の記憶・右クリックメニューからの起動 | Phase 6 の設定画面・Phase 5 のシェル統合で決める |
| 既存の結合・分割・画像→PDF・抽出の出力先がタブで開いているとき | 古い内容のタブへ切り替わるだけ（確定事項42 と同じ問題）。この塊では直さず、別の作業として記録する |
| 既にある透かしの検出・取り除き | 非対応 |

---

## 実装の記録

（実装後に書く）
