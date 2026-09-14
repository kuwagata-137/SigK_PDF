# 仕様書: Phase 3 塊⑥ PDF → 画像（PNG・JPEG）

起草日: 2026-09-14
ステータス: **確定**（2026-09-14 確定。着手前の3件と事前調査後の論点4件は同日ユーザーが決定。末尾「ユーザーの確定」を参照。
残る細部は起草者の推しで書き、その一覧を「起草者の判断で決めたもの」に置いた）
関連: `docs/05_開発ロードマップ.md` Phase 3（3-2）／`docs/01_製品要件定義.md` F-04-4／`docs/04_UI設計.md` 4-4・第6章・第7章／
`docs/spec-1-4-find-print.md`（印刷。pdf.js で 1 ページを canvas に描いて PNG にする経路の先例）／
`docs/spec-2-2-split.md`（1 ファイルを対象にする画面・出力フォルダ・同名確認の3択・「フォルダを開く」）／
`docs/spec-3-1-image-to-pdf.md`（変換画面・ツールの命名・`op-convert.js` の非対称の注記）

---

## 目的

Phase 3「変換」の前半（塊④・⑤）で画像を PDF にする経路が揃った。塊⑥はその逆で、**PDF の指定した
ページを PNG か JPEG の画像ファイルにする**（F-04-4）。これで Phase 3 が閉じる。

描画は pdf.js に任せる。印刷（`renderer/print.js`）が既に「1 ページを canvas に描いて PNG にし、canvas を捨てる」
経路を持っているので、その canvas を作る部分を共用し、出口だけを「`<img>` に載せる（印刷）」と「バイト列に
してメインへ渡し、ファイルに書く（本書）」に分ける。

---

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| ツール一覧の「PDF→画像」と、対象・ページと形式・出力の3節を持つ画面 | パスワード付き PDF（ユーザー確定②。結合・分割と同じく断る。既知の限界） |
| 対象は **1 ファイル**（開いているファイル／ファイルを選ぶ…／ドロップ）。ファイルを読み直して描くので**未保存の編集は映らない**（分割と同じ注意書き） | JPEG の品質の欄（ユーザー確定③。0.9 で固定） |
| ページの指定: すべて／範囲（`1-3,5,8-`。`page-range.js` を共用） | ファイル名の規則の欄（ユーザー確定④。`<元の名前>_<ページ番号>` の1本） |
| 形式 PNG／JPEG、解像度 72／150／300 dpi | `--to-image` の受け口（F-07 に該当する要件が無い。右クリックメニューは Phase 5） |
| 出力フォルダ（既定は元ファイルの場所）、同名の3択が1回、帯の進捗と中止、「フォルダを開く」 | 透過を残した PNG（pdf.js が白を敷くので白地で固定。注釈も pdf.js の既定どおり描く） |
| 1 ページごとに `page.cleanup()`、終わったら `loadingTask.destroy()`（事前調査 B） | 複数ページを 1 つの画像にまとめること（TIFF・ZIP・縦に連結）。出力は 1 ページ＝1 ファイル |
| **既存の `doc.destroy?.()` 3 か所を `loadingTask.destroy()` へ直す**（事前調査 B の発見。`viewer.js`・`tool-source.js`） | 最後に使ったツールを覚えること（Phase 6 の設定画面で決める） |
| 起動確認 `SIGK_SMOKE_TO_IMAGE` | ページの一部（切り抜き）や複数ページの合成 |

---

## 事前調査（2026-09-14・Windows 11 実機・Electron 44・pdf.js 6.3.289・fixtures のみ）

プローブはレンダラーで pdf.js を回す使い捨てのスクリプトで、`text-heavy.pdf`（40 ページ・文字だけ）と
`perf-10mb-50p.pdf`（50 ページ・1 ページに画像 1 枚。`npm run fixtures:perf`）で測った。記録後に捨てた。

### A. 描画と書き出しの時間・大きさ

| dpi | 画素（A4） | 描画 | PNG 化 | IPC 往復＋書き込み | PNG／枚 | JPEG（0.9）／枚 |
|---|---|---|---|---|---|---|
| 72 | 595×842 | 1〜10ms | 3〜6ms | 7〜12ms | 64〜197KB | 59〜89KB |
| 150 | 1240×1754 | 1〜3ms | 11ms | 8〜9ms | 271〜387KB | 185〜299KB |
| 300 | 2480×3508 | 3〜10ms | 25〜38ms | 10〜13ms | 596〜674KB | 498〜839KB |

- 300dpi の PNG で **1 ページ 85〜102ms**（`getPage` 込み）。50 ページで 4.3 秒。上限の 500 ページ（確定事項8）なら
  45〜50 秒・約 300MB の見込み。時間は PNG 化が大半で、描画そのものは軽い。
- `canvas.toBlob()` は `toDataURL()` の 1.5〜2.4 倍速い（150dpi PNG: 22〜29ms 対 34〜69ms）。印刷は `<img>` に
  載せるため data URL のままでよいが、本書はバイト列が要るので `toBlob()` → `arrayBuffer()` を使う。
- `ArrayBuffer` は `contextBridge` 越しにそのまま渡せる（構造化クローン）。674KB で往復 6〜7ms。1 ページずつ
  渡して手放せば、レンダラーに画像が溜まらない。
- 描いた canvas の四隅と中央の alpha はすべて 255 だった（pdf.js が既定で白を敷く）。**JPEG にしても黒くならない。**

### B. メモリ — 2 つの発見

1. **`page.cleanup()` を呼ばないと GPU プロセスが伸びる。**pdf.js が展開した画像はページの資源として残る。50 ページを
   300dpi で描いて `cleanup()` を呼ばないと GPU が 138 → 640MB（約 +5MB／ページで線形）。**毎ページ `cleanup()` を
   呼べば 432MB で頭打ち**になった。レンダラー（Tab）は 1 ページずつ捨てれば 200 → 265MB で頭打ち。
   500 ページを回す前提では `cleanup()` が必須である（確定事項24）。
2. **pdf.js 6 の `PDFDocumentProxy` に `destroy()` は無い。**`typeof doc.destroy` は `'undefined'`。既存の
   `doc.destroy?.()`（`renderer/viewer.js` の `destroySession`・開く途中で世代が変わったとき、`renderer/tool-source.js` の
   `inspectPdf`）は**何もしていない**。正しくは `doc.loadingTask.destroy()` で、呼ぶとレンダラーが 235 → 195MB に下がった。
   タブを閉じても pdf.js のワーカー側の文書が残る潜在的な漏れなので、本書の実装で既存の 3 か所も直す（確定事項25）。

### C. 部品はどこまで揃っているか

| 要るもの | ある場所 | 足すもの |
|---|---|---|
| 1 ページを canvas に描く（回転込み） | `renderer/print.js` `renderPageImage` | canvas を作る部分を `renderer/page-image.js` へ移し、印刷はそれを呼ぶ（確定事項21） |
| ページ範囲の記法 | `renderer/page-range.js` `parsePageRange` | なし（0 始まりの列をそのまま使う） |
| 対象 1 ファイルの覗き（ページ数・暗号化・壊れ） | `renderer/tool-source.js` `inspectPdf` | ページの寸法も返す `inspectPdfPages`（確定事項3）。`destroy` の修正 |
| 対象の取り方・出力フォルダ・同名 3 択・フォルダを開く | `renderer/tools-split.js` | 型を写す（`tools-to-image.js`） |
| 1 本を選ぶダイアログ | `file-io.js` `pickSplitSource`（題名が「分割する PDF を選ぶ」で固定） | 題名を受ける `pickToolSource`（確定事項2） |
| 帯の進捗と中止・二重起動の防止 | `renderer/save.js` `runTask`（ワーカー専用） | レンダラーの中で回す `runLocal`（確定事項17） |
| バイト列を一時ファイル → rename で書く | `pdf-write.js` `writeDocument` | メインの口 `image:write`（確定事項19） |
| 出力名の `stem`・ゼロ埋め | `renderer/split-plan.js` `stem`・`outputNames` | 1 ページ＝1 本の `outputNames`（確定事項10） |

---

## 確定事項

### A. 対象（1 ファイル・ユーザー確定 2026-09-14 ③）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 対象 | **1 ファイル。**経路は分割と同じ 3 つ: 「開いているファイル」（映しているタブ。未保存なら帯と注意書き「未保存の編集は反映されません」）、「ファイルを選ぶ…」、PDF のドロップ（このツールを選んでいるときは `file-drop.js` が対象へ入れる）。複数が届いたら先頭だけ（分割の `NOTE_FIRST_ONLY` と同じ文言） |
| 2 | 選ぶダイアログ | `pdfAPI.pickToolSource({ defaultPath, title })` → `pdf:pickToolSource`。`file-io.js` に `pickToolSource`（題名を受ける）を足し、`pickSplitSource` はそれを「分割する PDF を選ぶ」で呼ぶ形に寄せる。本書の題名は「画像にする PDF を選ぶ」 |
| 3 | 対象を覗く | `tool-source.js` に `inspectPdfPages(filePath)` を足す。`inspectPdf` と同じ判定（読めない・暗号化・壊れ）に加え、**全ページの寸法**（`getViewport({ scale: 1 })` の幅と高さ。回転込み）を返す。1,000 ページで約 1 秒。読んだら `loadingTask.destroy()` で手放し、描くときに読み直す（確定事項22） |
| 4 | 暗号化 PDF | **断る**（ユーザー確定②）。`inspectPdf` と同じ文言「保存できない PDF です（パスワード付き）」では意味が合わないので、`inspectPdfPages` は `reason: 'encrypted'` に「パスワード付きの PDF は画像にできません」を返す。行に印（`blocked`）と「選び直してください」 |
| 5 | 読めない対象 | 分割と同じ。行に印と文言を付け、実行できない |

### B. ページと形式（F-04-4・ユーザー確定 2026-09-14 ①③）

| # | 項目 | 決定 |
|---|---|---|
| 6 | ページの指定 | ラジオ 2 つ。**すべて**（既定）／範囲（`1-3,5,8-`）。範囲は `page-range.js` の `parsePageRange` で読む（結合・分割と同じ記法。同じページを 2 回書けば 2 回出るが、出力名が同じになるので**重複は畳む**。確定事項10） |
| 7 | 解像度 | ラジオ 3 つ。72／**150**（既定。印刷と同じ）／300 dpi。scale は `dpi / 72`。画素数は `Math.round(viewport.width)`×`Math.round(viewport.height)`（印刷と同じ丸め） |
| 8 | 上限 | **1 回に書き出せるのは 500 ページまで**（ユーザー確定①。分割の `MAX_OUTPUTS` と同じ数）。超えると「一度に画像にできるのは 500 ページまでです（N ページが指定されています）。」で実行できない |
| 9 | 画素の上限 | 選んだ解像度で **40M 画素**（`worker/image-format.js` の `MAX_PIXELS` と同じ値。A2 300dpi ≒ 34.8M は入り、A1 300dpi ≒ 69.6M は入らない）を超えるページがあれば、「N ページが 300dpi では大きすぎます。150dpi 以下を選んでください。」で実行できない。ページの寸法は確定事項3 で読んであるので、押す前に分かる |
| 10 | 出力名 | **`<元の名前（拡張子なし）>_<ページ番号>.png`／`.jpg`**（ユーザー確定④）。ページ番号は文書内の番号をゼロ埋め。桁は `max(3, 総ページ数の桁数)`（分割の連番と同じ規則）。範囲 `1-3,5` なら `report_001.png … report_003.png, report_005.png`。同じページを 2 回書いても 1 本 |
| 11 | 形式 | ラジオ 2 つ。**PNG**（既定）／JPEG。JPEG の品質は **0.9 で固定**し、欄は出さない（ユーザー確定③）。MIME は `image/png`／`image/jpeg`、拡張子は `.png`／`.jpg` |
| 12 | 白地 | pdf.js の既定の白背景をそのまま使う（事前調査 A）。透過は残さない |
| 13 | 回転 | ファイルの `/Rotate` は pdf.js の viewport が反映する（`getViewport` の既定の rotation）。未保存の回転・並べ替え・削除は映らない（確定事項1 の注意書き） |
| 14 | 注釈 | pdf.js の既定（注釈の見た目を描く）に従う。印刷と同じ |

### C. 出力（起草者判断・分割の型）

| # | 項目 | 決定 |
|---|---|---|
| 15 | フォルダ | 既定は元ファイルの場所。「変更…」で `pdfAPI.pickFolder`。ユーザーが変えたあとは対象に追従しない（分割と同じ） |
| 16 | 同名 | 実行前に `pdfAPI.exists` で数え、あれば `confirmReplace.ask({ name, count })` を **1 回だけ**。「別名で保存」はフォルダの選び直し。元ファイルと同じパスは拡張子が違うので起きないが、`pathKey` で照合して断る |
| 17 | 走らせる枠 | `save.js` に **`runLocal({ label, run })`** を足す。`runTask` と同じ `state.running` を使い、帯「画像にしています（3 / 12 ページ）」と「中止」を出し、`isBusy()` が真になる（保存・抽出・結合・分割・変換と同時に走らない）。違いは、中止がワーカーの `kill` ではなく**キャンセルの旗**を立てることで、`run({ report(done, of), canceled() })` の中のループが旗を見て抜ける。走らせる枠を 1 つに保つ（`spec-1-6` 確定事項9）ための置き場であり、帯と二重起動の防止を別に持たない |
| 18 | 進捗 | ページ単位。`report(done, of)` のたびに帯を書き直す。単位は「ページ」 |
| 19 | 書き出し | 1 ページごとに `imageAPI.write(target, bytes)` → `image:write`。メインは `pdf-write.js` の `writeDocument(target, bytes)` で**一時ファイル → rename**（`.bak` は作らない・`expect` は無し）。書きかけの `.sigk-tmp` が残らないのは分割と同じ。戻り値 `{ ok, size }`／`{ error }` |
| 20 | 中止・失敗 | 中止は次のページの前で止まり、**書き終えた分は残す**。帯「画像にするのを中止しました。N ファイルは書き出し済みです。」。失敗（描けない・書けない）はページ番号を添えて止め、書き終えた分は残す。「「report.pdf」の 7 ページ目を画像にできませんでした。」／「「report_007.png」を書き込めませんでした。〜」 |
| 21 | 終了 | 帯「N ファイルに変換しました」＋「フォルダを開く」（`shellAPI.showInFolder(targets[0])`。`autoHideMs: 0`） |

### D. 描画と手放し方（事前調査 A・B）

| # | 項目 | 決定 |
|---|---|---|
| 22 | 文書の持ち方 | 実行時に `pdfAPI.read` → `SigK.pdfjs.getDocument` で**読み直す**（対象を決めた時点では確定事項3 で寸法だけ読んで手放してある）。映しているタブの文書は使わない。終わったら（中止・失敗でも）`loadingTask.destroy()` |
| 23 | canvas を作る層 | `renderer/page-image.js`（新設）。`renderToCanvas(page, { scale, rotation, doc })` が canvas を作って描き、`toBytes(canvas, { type, quality })` が `toBlob` → `ArrayBuffer`、`release(canvas)` が `width = height = 0` で捨てる。印刷の `renderPageImage` はここを呼んで `toDataURL` する形に寄せる（`test/print.test.js` が緑のまま） |
| 24 | 1 ページごとの手放し | 描いて書いたら `canvas` を捨て、**`page.cleanup()`** を呼ぶ（事前調査 B-1）。バイト列はメインへ渡したら参照を残さない |
| 25 | `destroy` の修正 | `renderer/viewer.js` の `destroySession`（文書と差し込みの文書）と開く途中の世代ずれ、`renderer/tool-source.js` の `inspectPdf` の **`doc.destroy?.()` を `doc.loadingTask?.destroy?.()` に直す**（事前調査 B-2）。jsdom のテストでは `loadingTask.destroy` が呼ばれたことを見る |
| 26 | 非対称の注記 | `worker/op-convert.js` の頭に予約してあった一文を本文に置き換える: PDF → 画像はレンダラーで行い、メインは書くだけ。ワーカーは Node 側で canvas を持たず、pdf.js の描画は DOM の canvas（か OffscreenCanvas）を要するため。ワーカーへ移すには pdf.js を Node で動かす canvas の実装が要り、依存が増える。他のツールが「レンダラーは計画、ワーカーが実体」なのに対し、この 1 本だけ逆向きである |

### E. 画面の意匠

| # | 項目 | 決定 |
|---|---|---|
| 27 | 構成 | `#tools-view` に `.tool-panel[data-tool="toImage"]`。上から「対象」（分割の `.split-target` と同じ行）「ページと形式」（ページ・形式・解像度の 3 行ラジオ。変換画面の `.picks` を流用）「出力」（フォルダ・出力の例。分割の `.split-out`）の 3 節、右下に「実行…」。足元に要約「12 ページを PNG（150dpi）で 12 ファイルへ」 |
| 28 | ツール一覧 | `tools.js` の `TOOLS` に `{ id: 'toImage', label: 'PDF→画像', hint: 'PDF のページを画像に', icon: 'toImage' }`。起動時の選択は「結合」のまま |
| 29 | アイコン | `assets/icons.js` に `toImage`（紙から画像の枠へ矢印。`convert` の左右を入れ替えた構図）。自作のインライン SVG |
| 30 | 出力の例 | 常時表示。`report_001.png … report_012.png（12 ファイル・1240×1754 px）`。誤り（範囲の記法・上限・画素の上限）があれば例の代わりに文言 |
| 31 | モック | 着手時に `_mockup_pdf-to-image.html` を描画し `screenshots/phase3-pdf-to-image.png` に残す。モックは実装着手時に削除 |

---

## 足りない部品

### 新しいモジュール

| ファイル | 役目 | 依存 |
|---|---|---|
| `renderer/image-export-plan.js` | `DPI_CHOICES`・`MAX_PAGES`・`MAX_PIXELS`・`scaleFor(dpi)`・`pixelSizeFor(size, dpi)`・`resolvePages(mode, text, pageCount)`・`outputNames(baseName, pages, pageCount, format)`・`planExport(settings, source)` | `pageRange`・`splitPlan.stem` |
| `renderer/page-image.js` | `renderToCanvas`・`toBytes`・`toDataUrl`・`release`・`exportPage(doc, number, { dpi, type, quality })` | pdf.js（jsdom では寸法だけ） |
| `renderer/tools-to-image.js` | 画面の状態と指揮（対象・設定・計画・同名確認・実行ループ・後始末） | jsdom |
| `renderer/tools-to-image-view.js` | 対象の行・ラジオ・フォルダ・例・要約の描画 | jsdom |

### 既存への追記

| ファイル | 追記 |
|---|---|
| `renderer/print.js` | canvas を作る部分を `page-image.js` に置き換える（挙動は変えない） |
| `renderer/save.js` | `runLocal`（確定事項17） |
| `renderer/tool-source.js` | `inspectPdfPages`、`destroy` の修正 |
| `renderer/viewer.js` | `destroy` の修正（3 か所） |
| `renderer/tools.js` | `TOOLS` に `toImage` |
| `renderer/file-drop.js` | `toImage` を選んでいるときの PDF ドロップを `toolsToImage.addPaths` へ |
| `renderer/app.js` | init 2 本 |
| `file-io.js` | `pickToolSource`（`pickSplitSource` はこれを呼ぶ） |
| `preload.js` | `pdfAPI.pickToolSource`、**`imageAPI`**（`available`・`write(target, bytes)`） |
| `main.js` | `pdf:pickToolSource`・`image:write`（`pdf-write.js` の `writeDocument`）、`SIGK_SMOKE_TO_IMAGE` |
| `worker/op-convert.js` | 非対称の注記の本文（確定事項26） |
| `index.html` / `renderer/shell.css` / `assets/icons.js` | パネル・`<script>` 4 本・意匠・アイコン |
| `test/harness.js` | `pickToolSource`／`imageAPI.write` のスタブ（届いた `{ target, bytes }` を並べる） |
| `test/tools.test.js` | ツールの一覧に `toImage`（4 ツール） |
| `test/shell.test.js` | `<script>`・パネルの要素・`toImage` のアイコン |
| `docs/02_アーキテクチャ設計.md` | preload API 表・モジュール構成・現在地 |

ルート直下にモジュールは足さない（`package.json` の `build.files` は変わらない。`test/dist-files.test.js` が見張る）。
依存は増えない（pdf.js は既にある）。`THIRD-PARTY-NOTICES.md` の追記は無い。

---

## テストの範囲

| 層 | 対象 |
|---|---|
| 依存なし | `image-export-plan.js`（dpi → scale、画素数、すべて／範囲／重複の畳み、500 の上限、40M 画素の上限と文言、出力名のゼロ埋めと拡張子、`planExport` の `ready`／`error`）、`file-io.js` の `pickToolSource`（題名が届く・`pickSplitSource` の題名が変わらない）、`main.js` の `image:write` が呼ぶ `writeDocument`（`pdf-write.test.js` は既にある） |
| jsdom | `page-image.js`（jsdom には 2D コンテキストが無いので寸法と `release` を見る）、`print.test.js` が緑のまま、`save.test.js` に `runLocal`（`isBusy`・帯・中止の旗・終わったら `running` が戻る・`runTask` と同時に走らない）、`tool-source.test.js`（`inspectPdfPages` の寸法・暗号化の文言・`loadingTask.destroy` が呼ばれる）、`viewer.test.js`／`tabs.test.js` に `destroySession` が `loadingTask.destroy` を呼ぶこと、`tools.test.js`（4 ツール）、`file-drop.test.js`（`toImage` で PDF を受ける）、`tools-to-image.test.js`（3 経路・読めない対象・未保存の注意・ページと形式と解像度 → 例と要約・上限・画素の上限・同名の 3 択が 1 回・実行で `imageAPI.write` に届く `target` と `bytes`・中止で書き終えた分の帯・失敗の帯・実行中の disabled・`destroy` が呼ばれる） |
| 起動確認 | `SIGK_SMOKE_TO_IMAGE=<pdf>` ＋ `_PAGES`（省略時すべて）・`_FORMAT`（png／jpeg）・`_DPI`・`_OUT`・`_CANCEL=1`・`_STAY=1`。開発ツリーと配布物の両方。出力の枚数・寸法・バイト数・`tempLeft` を報告する |

---

## 完了の判定

1. ツール一覧に「PDF→画像」が増え、結合・分割・画像→PDF と切り替えられる。このツールを選んでいるときの PDF のドロップは対象に入り、他の画面では従来どおり
2. 「開いているファイル」「ファイルを選ぶ…」「ドロップ」で対象が入り、ページ数が出る。パスワード付き・壊れた PDF は印が付いて実行できない。未保存のタブは注意書きが出る
3. ページ（すべて／範囲）・形式・解像度を変えると出力の例と要約が更新される。501 ページ以上、40M 画素超えは理由が出て実行できない
4. 「実行…」で帯「画像にしています（n / N ページ）」が出て、終わると出力フォルダに `<名前>_<番号>.png` が N 本でき、帯「N ファイルに変換しました」＋「フォルダを開く」。画素数が指定の解像度と一致する（A4 150dpi = 1240×1754）
5. JPEG を選ぶと `.jpg` ができ、白地である（黒くならない）
6. 同名があれば 3 択が 1 回だけ出る。「中止」で書き終えた分が残り、一時ファイルは残らない
7. 300dpi で 40 ページを回してもレンダラーと GPU の実メモリが頭打ちになる（事前調査 B の再現。`page.cleanup()` と `loadingTask.destroy()` が効いている）
8. タブを閉じたとき・`inspectPdf` のあとに `loadingTask.destroy()` が呼ばれる（jsdom）。**既存の漏れが塞がった**
9. 書き出した画像を他のビューアで開き、文字・白地・回転が正しい（ユーザー目視）
10. `npm test` が緑で、`npm run dist` の配布物でも `SIGK_SMOKE=1` と `SIGK_SMOKE_TO_IMAGE` が通る

### 人が目で確かめる手順

- 画面の見た目がモックのスクリーンショット（`screenshots/phase3-pdf-to-image.png`）と揃っていること。
- 実物の PDF（文字と写真を含むもの）を 150dpi の PNG と JPEG にし、他のビューアで文字の読みやすさ・白地・回転を確かめること。
- 「フォルダを開く」でエクスプローラーが先頭の出力を選択した状態で開くこと。

---

## ユーザーの確定（2026-09-14）

セッション冒頭に着手前の 3 件、事前調査のあとに論点 4 件を AskUserQuestion で聞き、7 件すべて起草者の推しで確定した。

### 着手前

| # | 論点 | 確定 | 推しの根拠 |
|---|---|---|---|
| a | 着手する塊 | **塊⑥ PDF→画像** | ロードマップの順序どおり。決定5 に当たる常用の不満は記録に無く、2026-09-07 も順序どおりで確定していた。Phase 5 前倒しは採らない |
| b | 到達点 | **塊まるごと**（仕様書 → 実装 → 完了判定 → 作業ブランチへ push。PR はユーザー指示待ち） | 塊④・⑤と同じ運び。仕様書と実装を分ける利点は小さい |
| c | 画面の置き場 | **ツールモードの「PDF→画像」** | `docs/04` 4-4 と spec-3-1 確定事項34（「画像→PDF」と名付けたのは別ツールとして足すため）に沿う。閲覧側のダイアログにすると未保存の編集は映るが、ツール一覧に「変換」が揃わず、右クリック起動の受け口も置きにくい |

### 事前調査後

| # | 論点 | 確定 | 推しの根拠 |
|---|---|---|---|
| ① | 上限ページ数 | **500**（分割の `MAX_OUTPUTS` と同じ） | 300dpi PNG で 500 ページ ≈ 45〜50 秒・約 300MB。メモリは 1 ページずつ捨てるので積み上がらず、帯の進捗と中止がある。「出力の本数」の上限として分割と同じ数にすると規則が 1 つで済む |
| ② | 暗号化 PDF | **断る**（結合・分割と同じ） | ツール側にパスワード入力の経路が無い。第1版は既知の限界とし、要望が出たら `password-prompt.js` を通す形で足す |
| ③ | JPEG の品質 | **0.9 で固定・欄なし** | 300dpi で 1 枚 0.5〜0.84MB と PNG と同程度。用途は「ページを画像として貼る・送る」で、品質を詰める場面はまれ |
| ④ | 出力名 | **`<元の名前>_<ページ番号>`・欄なし** | ページ番号なら `1-3,5` が `_001 _002 _003 _005` となり、どのページの画像かが名前で分かる。1 ページ＝1 ファイルなので分割の「連番」と分ける意味が薄い |

### 起草者の判断で決めたもの

- 解像度の既定は 150dpi（印刷と同じ。確定事項7）。形式の既定は PNG（確定事項11）。ページの既定は「すべて」（確定事項6）。
- 範囲に同じページを 2 回書いても 1 本（確定事項6・10）。結合の「2 回入る」と違うのは、出力名が同じになるためである。
- 画素の上限は `MAX_PIXELS`（40M）を共用（確定事項9。決定30 ⑦と同じ値）。
- 出力フォルダはユーザーが変えたあとは追従しない（確定事項15。分割と同じ）。
- 中止・失敗でも書き終えた出力は残す（確定事項20。分割・変換と同じ）。
- 走らせる枠は `save.js` に足す（確定事項17）。新しいモジュールに分けると帯・二重起動の防止が 2 か所になる。
- 対象を決めた時点で寸法だけ読んで手放し、実行時に読み直す（確定事項3・22）。ツールを離れても文書を抱えない。
- `--to-image` の受け口は置かない（F-07 に無い）。
- 既存の `doc.destroy?.()` は本書の中で直す（確定事項25）。同じ領域の不具合で、直し方が 1 行だからである。

---

## 未確定のまま残すもの

| 項目 | 扱い |
|---|---|
| パスワード付き PDF | 既知の限界（ユーザー確定②）。`password-prompt.js` を `inspectPdfPages` と実行時の `getDocument` に通せば足せる。要望が出てから |
| JPEG の品質 | 0.9 で固定（ユーザー確定③）。要望が出たら 3 択を足す |
| 透過を残す PNG | 白地で固定。pdf.js の `background: 'transparent'` を指定すれば作れるが、白い紙のつもりで貼る用途で透過は事故のもとなので入れない |
| 複数ページの合成（縦連結・TIFF・ZIP） | 入れない。1 ページ＝1 ファイル |
| GPU プロセスの頭打ち（約 430MB） | Chromium の画像キャッシュで、`cleanup()` を呼んでも 300MB 近く上がる。総量は `docs/01` の 1.5GB に収まる。下げるなら描画の間だけ pdf.js の `canvasMaxAreaInBytes` を絞るが、効き目は未実測。常用の不満を見てから |
| `save.js` の行数 | `runLocal` で約 300 行になる。`runTask`・`runLocal`・帯を「走らせる枠」として別モジュールへ移す整理は塊⑥の外 |
