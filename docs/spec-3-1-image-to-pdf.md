# 仕様書: Phase 3 塊④ 画像 → PDF（JPEG・PNG）

起草日: 2026-09-07
ステータス: **確定**（2026-09-07 確定。論点4件は起草前にユーザーが決定。末尾「ユーザーの確定」を参照。
残る細部は起草者の推しで書き、その一覧を「起草者の判断で決めたもの」に置いた）
関連: `docs/05_開発ロードマップ.md` Phase 3（3-1）／`docs/01_製品要件定義.md` F-04-1〜F-04-3／
`docs/04_UI設計.md` 4-4・第5章・第7章／`docs/spec-1-6-save.md`（差し込み・画像の形式判定・`toBytes`・
ワーカーの5段）／`docs/spec-2-1-merge.md`（ツールモード・一覧の並べ替え・保存先の選択）／
`docs/spec-2-2-split.md`（出力フォルダ・同名確認の3択・「フォルダを開く」）

---

## 目的

Phase 2 まででツールモードに結合と分割が載った。Phase 3 は「変換」で、その前半が**画像を PDF にする**
経路である。Phase 1 塊⑤ の差し込み（F-02-5）で「画像1枚を白い紙に載せる」部品は既にある
（`worker/op-insert.js` の `placeImage`）。塊④ はそれを再利用して、**複数の画像を用紙・向き・余白を
指定して PDF にまとめる／画像ごとに別の PDF にする**画面を足す。

---

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| ツール一覧の「画像→PDF」と、一覧・用紙・出力の3節を持つ画面 | **BMP・GIF・TIFF**（ユーザー確定①。pdf-lib が埋め込めず、デコード手段の選定から要る。次の塊） |
| JPEG（ベースライン）・PNG の取り込み。並べ替え・外す | プログレッシブ JPEG（差し込みと同じく断る。`spec-1-6` 確定事項53-2） |
| 用紙 A4／A3／B5／レター／画像サイズ、向き 縦／横／自動、余白 なし／狭い／標準 | EXIF の Orientation の反映（既知の限界。スマホ写真が横倒しになり得る） |
| 「1つの PDF にまとめる」（保存先を選び、結果をタブで開く）と「画像ごとに別の PDF」（出力フォルダ、「フォルダを開く」） | 画像の DPI メタデータ（JFIF・pHYs）の反映（ユーザー確定②。1px = 1pt で固定） |
| 出力先に同名があるときの3択（分割と同じ経路） | PDF → 画像（3-2。別の塊） |
| `--to-pdf` の受け口 `addFromLaunch(paths)`（呼ぶ側は Phase 5） | 右クリックメニューの登録（Phase 5） |
| 起動確認 `SIGK_SMOKE_CONVERT` | 最後に使ったツールを覚えること（`spec-2-2` 確定事項39 の宿題。塊④ でも足さない。Phase 6 の設定画面で決める） |

---

## 事前調査（2026-09-07・Windows 実機・Node 24 単体・`test/fixtures/images.js` の PNG のみ）

### A. 「まとめる」のメモリ

pdf-lib の `embedPng` は呼んだ時点で PNG を RGBA へ完全展開し（`spec-1-6` 実測 H）、`save()` まで抱える。
4000×3000（12MP）の単色 PNG を1つの文書に N 枚載せて RSS を測った。

| N | 手放さない（embedPng → drawImage のみ） | 1枚ごとに `await image.embed()` |
|---|---|---|
| 1 | +138MB・embed 218ms・save 262ms | — |
| 10 | +401MB・embed 2.5秒・save 2.3秒 | +138MB・embed 4.7秒・save 7ms |
| 30 | **+695MB**・embed 7.3秒・save 6.9秒 | **+142MB**・embed 14秒・save 36ms |
| 100 | （測らず） | +15MB（基底が既に高い）・embed 50秒・save 159ms |

**`image.embed()` を1枚ごとに呼ぶと、RSS の増分が1枚ぶん（約 140MB）で頭打ちになる。**`embed()` は
展開した画素を Flate で圧縮してコンテキストへ書き込む処理で、本来 `save()` の中でまとめて走るものを
前倒しするだけである。合計時間は変わらない（10枚: 4.8秒 → 4.7秒）。`embedder` を捨てる小細工は
要らなかった（捨てても捨てなくても +142MB）。

したがって「まとめる」の組み立ては **1枚ごとに embedPng → drawImage → `await image.embed()`** とし、
入力の上限は結合と同じ **100 枚**にする（確定事項6）。12MP を 100 枚でも 1.5GB（`docs/01` 非機能要件）
を超えない。JPEG は pdf-lib が復号しない（`DCTDecode` にバイト列をそのまま入れる）ので、さらに軽い。

時間は 12MP の PNG で 1枚 0.5秒である。100 枚なら 50秒かかるが、進捗は画像単位で刻み（確定事項22）、
中止できる（確定事項24）。

### B. 部品はどこまで揃っているか

| 要るもの | ある場所 | 足すもの |
|---|---|---|
| 形式の判定・寸法の読み取り・プログレッシブの拒否 | `worker/image-format.js` `detectFormat`／`imageSize`／`isProgressiveJpeg` | 変換向けの文言 `describeImageFormat`、1本で判定する `inspectImageBytes` |
| 画像を白い紙に載せる | `worker/op-insert.js` `placeImage`／`fitInside` | 紙と箱を別に受ける `drawImagePage`、拡大の可否（確定事項12）。`worker/image-page.js` へ切り出す |
| 画素上限 | `op-insert.js` `MAX_PIXELS`（40M） | `image-format.js` へ移して共用 |
| 用紙の寸法 | `op-insert.js` の `A4` だけ | A3・B5・レターと mm→pt。`renderer/paper-size.js`（新設） |
| 複数入力を1本へ（進捗は入力単位） | `worker/pdf-task.js` `runMerge` の型 | `runConvert`（`output: 'single'`） |
| 複数出力（進捗は出力単位・書き終えた分は残す） | `pdf-task.js` `runSplit`、`task-runner.js` の `targets` 後始末 | `runConvert`（`output: 'each'`） |
| 読み口（`toBytes` 必須） | `pdf-task.js` `insertReader` | なし |
| 一覧・並べ替え・行のドラッグ | `renderer/tools-merge.js`／`tools-merge-list.js` | ドラッグを `row-drag.js` へ切り出して共用（確定事項32） |
| 保存先の選択・タブで開く | `tools-merge.js` `run`／`finish` | 変換用の題名と既定名 |
| 出力フォルダ・3択が1回・「フォルダを開く」 | `tools-split.js` `resolveTargets`／`finish` | なし（型を写す） |
| 画像の寸法を画面で読む | — | `pdfAPI.read` は `.pdf` 以外を断る（`file-io.js`）。**メインが先頭バイトだけ読む** `pdf:inspectImage`（確定事項4） |
| 画像の複数選択 | `file-io.js` `pickPdfPaths` の型 | `image-io.js` `pickImageSources` |

### C. 画像の寸法は先頭 64KB で読める

PNG は署名の直後の IHDR（24 バイト目まで）、JPEG は最初の SOF セグメントに寸法がある。JPEG の SOF は
APP0／APP1（JFIF・EXIF）や DQT・DHT の後ろに来るが、EXIF にサムネイルが入っていても 64KB を超えることは
まれである。**先頭 64KB を読んで見つからなければ全体を読み直す**（確定事項4）。画面は寸法だけが要り、
本体はワーカーが改めて読む。

---

## 確定事項

### A. 入力の一覧（F-04-1・ユーザー確定①）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 対象形式 | **JPEG（ベースライン）と PNG**。判定は拡張子でなく先頭バイト（`spec-1-6` 確定事項53）。GIF・BMP は名指しで「まだ変換できません。PNG・JPEG を選んでください」、PDF は「PDF は画像ではありません」、それ以外は「対応していない形式です」。プログレッシブ JPEG は「この JPEG は変換できません（プログレッシブ形式）」 |
| 2 | 足す経路 | 3経路。「ファイルを選ぶ…」（`pdfAPI.pickImageSources`。複数選択、フィルターは png／jpg／jpeg）、画像のドロップ（`file-drop.js` は**変換画面が選択中のときだけ**画像を受ける。閲覧・結合・分割では従来どおり PDF だけ）、`addFromLaunch(paths)`（`--to-pdf` の受け口。呼ぶ側は Phase 5） |
| 3 | 一覧の行 | グリップ／ファイル名（フルパスはツールチップ）／画素数（`4032×3024`）／形式（`JPEG`・`PNG`）／この紙（`A4 横` など、計画から。「画像サイズ」なら `1200×800 pt`）／上へ・下へ・外す／注意 |
| 4 | 寸法を読む | `pdfAPI.inspectImage(path)` → `{ ok, kind, width, height, name, size }` か `{ error }`。メイン側 `image-io.js` の `inspectImage` が `stat` → 上限 → **先頭 64KB** を読み `inspectImageBytes` へ。見つからなければ全体を読み直す。ファイル上限は **100MB**（`MAX_IMAGE_BYTES`） |
| 5 | 読めない行 | 行に印（`blocked`）と文言を付け、**実行できない**。外すのはユーザー。結合の「外してください」と同じ作法 |
| 6 | 上限 | **100 枚**（`MAX_INPUTS`。事前調査 A）。超えると帯「変換できるのは 100 ファイルまでです。」で切り捨てる（結合と同じ） |
| 7 | 重複 | 同じパスを2回足すことは止めない（同じ画像を2ページ載せる使い方がある） |
| 8 | 並べ替え | 上へ・下へ・ドラッグ（結合と同じ。`row-drag.js`）。「すべて外す」あり |
| 9 | 順序の注記 | `addFromLaunch` の並び順の注記は Phase 5 で決める（結合の `NOTE_LAUNCH_ORDER` と同じ扱い） |

### B. 用紙と配置（F-04-2・ユーザー確定②③④）

| # | 項目 | 決定 |
|---|---|---|
| 10 | 用紙 | ラジオ5つ。**A4**（既定）／A3／B5／レター／画像サイズに合わせる。pt は A4 595.28×841.89、A3 841.89×1190.55、B5（JIS）515.91×728.50、レター 612×792。定義は `renderer/paper-size.js`（純関数） |
| 11 | 画像サイズに合わせる | **1px → 1pt**（ユーザー確定②）。紙は画素数そのまま、余白は「なし」で固定し欄を押せなくする。DPI メタデータは読まない（既知の限界として案内文に「72dpi 相当」と書く） |
| 12 | 拡大 | 用紙を指定したときは**余白の内側に縦横比を保って最大化する**（ユーザー確定④。小さい画像も拡大する）。差し込み（F-02-5）の「拡大は 100% で止める」は変えない。`fitInside(image, box, { allowUpscale })` の既定は従来どおり `false` |
| 13 | 向き | ラジオ3つ。**自動**（既定）／縦／横。自動は画像の幅が高さより大きければ横、それ以外（正方形を含む）は縦。「画像サイズに合わせる」では向きは意味を持たないので欄を押せなくする |
| 14 | 余白 | ラジオ3つ。なし（0mm）／狭い（10mm）／**標準**（20mm。既定）（ユーザー確定③）。mm→pt は 72／25.4。四辺同じ |
| 15 | 計算の場所 | `renderer/convert-plan.js`（純関数）の `planPage(pixels, { paper, orientation, margin })` → `{ page: {width, height}, box: {x, y, width, height}, allowUpscale }`。ワーカーは数値を受け取って載せるだけ（分割の `split-plan.js` と同じ分業） |
| 16 | 白い紙 | 差し込みと同じく紙全体を白で塗ってから載せる（透過 PNG の下地。`spec-1-6` 確定事項62） |
| 17 | 画素上限 | `MAX_PIXELS`（40M ≒ 8000×5000）を差し込みと共用。超える画像は行に印（確定事項5） |

### C. 出力（F-04-3・起草者判断）

| # | 項目 | 決定 |
|---|---|---|
| 18 | 方式 | ラジオ2つ。**1つの PDF にまとめる**（既定）／画像ごとに別の PDF にする |
| 19 | まとめる | 「実行…」で `pdfAPI.pickSavePath`（題名「変換した PDF を保存」、既定名は先頭画像の場所に `<先頭画像の名前（拡張子なし）>.pdf`）。同名は OS の保存ダイアログが確認する。書き終えたら**新しいタブで開く**（結合と同型。タブが上限なら最近使ったファイルへ足して帯で知らせる） |
| 20 | 画像ごと | 出力フォルダ（既定＝先頭画像の場所。ユーザーが変えたあとは追従しない）に `<画像の名前（拡張子なし）>.pdf`。**一覧の中で出力名が同じになる組**（`a.jpg` と `a.png`、同じファイルを2回）は実行前に赤く示して押せなくする（黙って連番を付けない）。出力先の同名は `confirmReplace.ask({ name, count })` を**1回だけ**（分割と同じ3択。「別名で保存」はフォルダの選び直し）。終わったら帯「N ファイルに変換しました」＋「フォルダを開く」（`autoHideMs: 0`） |
| 21 | 出力の例 | 常時表示。まとめる: `photo.pdf（12 ページ）`、画像ごと: `a.pdf … l.pdf（12 ファイル）`。誤り（同名の衝突）があれば例の代わりに文言 |
| 22 | ワーカーへ渡す形 | `SigK.save.runTask({ kind: 'convert', label: '変換', output: 'single' \| 'each', images: [{ path, name, layout: { page, box, allowUpscale }, target? }], target?, targets })`。`targets` は `task-runner.js` の後始末用で、`single` では `[target]`、`each` では各画像の出力先 |
| 23 | 進捗 | `single`: `read`（合図）→ `load`（合図）→ **`apply` を画像単位**（`advance('apply', done, total)`。帯「変換しています（3 / 12 ファイル）」）→ `save` → `write`。`each`: `read`／`load`／`apply`／`save` は合図、**`write` を出力単位** |
| 24 | 中止 | 帯の「中止」（`task-runner.js` の `kill`）。`single` は書きかけの一時ファイルだけ消える。`each` は書き終えた出力を残し、帯「変換を中止しました。N ファイルは書き出し済みです。」（N は `save.lastProgress()` の `write.done`。分割と同じ） |
| 25 | 失敗 | 読めない・壊れている画像はファイル名を添えて全体を止める（結合の `withName` と同じ。「「a.jpg」画像を読み込めませんでした」）。`each` で途中の `writeDocument` が失敗したら何本目かを添え、書き終えた分は残す |
| 26 | 出力先が入力と同じ | 拡張子が違うので起きないが、念のため `pathKey` で照合して断る（結合と同じ） |
| 27 | 実行中 | 一覧の操作・設定・実行ボタンを押せなくする。モードの切り替えは許す。結合・分割との同時実行は `save.js` の `isBusy()` が塞ぐ |

### D. ワーカー（`worker/op-convert.js`・`worker/image-page.js`・`worker/pdf-task.js`）

| # | 項目 | 決定 |
|---|---|---|
| 28 | 画像を紙に載せる層 | `op-insert.js` から `fitInside`・`placeImage`・埋め込みを `worker/image-page.js` へ移す（`op-insert.js` は 251 行で目安超え）。`op-insert.js` の exports は据え置き（re-export）。`drawImagePage(doc, image, { page, box, allowUpscale }, tools)` を足す |
| 29 | 組み立て | `convertToSingle(entries, tools, { onProgress })`: 1枚ずつ `load()` → `embedImage` → `drawImagePage` → `addPage` → **`await image.embed()`** → bytes を手放す。`convertToEach(entries, tools, { onPart, onProgress })`: 1枚ごとに `PDFDocument.create()` → 同上 → `onPart(index, doc)` で呼ぶ側が save／write |
| 30 | 検証の二重化 | 画面（`inspectImage` → 行に印）とワーカー（`loadImage` → ファイル名付きで断る）の両方。文言は `describeImageFormat` の1か所に |
| 31 | 読み口 | 必ず `insertReader(fsLike)`（`toBytes()`）を通す。4KB 未満の JPEG の回帰テストを置く（`spec-1-6` 確定事項55） |
| 32 | 非対称の注記 | `docs/05` が求める「PDF→画像はレンダラー側で行う」理由コメントの置き場は `op-convert.js` の頭。塊④ では場所を用意する一文だけ書き、3-2 で本文を書く |

### E. 画面の意匠

| # | 項目 | 決定 |
|---|---|---|
| 33 | 構成 | `#tools-view` に `.tool-panel[data-tool="convert"]`。上から「画像」（一覧。結合の `.merge-list` と同じ行 36px）「用紙」（用紙・向き・余白の3行ラジオ）「出力」（方式・フォルダ・出力の例）の3節、右下に「実行…」。分割の `.split-sec`・`.split-out` のトークンを流用 |
| 34 | ツール一覧 | `tools.js` の `TOOLS` に `{ id: 'convert', label: '画像→PDF', hint: '画像を PDF に', icon: 'convert' }`。起動時の選択は「結合」のまま |
| 35 | アイコン | `assets/icons.js` に `convert`（画像の枠から紙へ矢印）。自作のインライン SVG |
| 36 | 行のドラッグ | `tools-merge-list.js` のポインタドラッグを `renderer/row-drag.js` の `attachRowDrag({ doc, list, rowSelector, onDrop, isLocked })` へ切り出し、結合と変換で共用。`toolsMergeList.isDragging`／`dropIndexFor` の公開は維持 |
| 37 | モック | 着手時に `_mockup_convert.html` を描画し `screenshots/phase3-convert.png` に残す。モックは実装着手時に削除 |

---

## 足りない部品

### 新しいモジュール

| ファイル | 役目 | 依存 |
|---|---|---|
| `renderer/paper-size.js` | 用紙の pt 定義・`mmToPt`・`resolveOrientation`・`paperSize` | なし |
| `renderer/convert-plan.js` | `planPage`・`stem`・`outputNames`・`duplicateNames`・`planConvert`・`MAX_INPUTS` | `paperSize` |
| `renderer/row-drag.js` | 一覧の行のポインタドラッグ | jsdom |
| `renderer/tools-convert.js` | 変換画面の状態と指揮 | jsdom |
| `renderer/tools-convert-list.js` | 一覧の描画 | jsdom |
| `renderer/tools-convert-view.js` | 用紙・出力の欄と例の同期 | jsdom |
| `worker/image-page.js` | `fitInside`（拡大可否）・`embedImage`・`placeImage`・`drawImagePage` | pdf-lib |
| `worker/op-convert.js` | `loadImage`・`convertToSingle`・`convertToEach` | pdf-lib |
| `image-io.js`（ルート直下） | `inspectImage`・`pickImageSources`・`createImageIo` | なし（`dialog` は引数） |

### 既存への追記

| ファイル | 追記 |
|---|---|
| `worker/image-format.js` | `MAX_PIXELS`、`IMAGE_KINDS`、`inspectImageBytes`、`describeImageFormat` |
| `worker/op-insert.js` | 実体を `image-page.js` へ。exports は据え置き |
| `worker/pdf-task.js` | `runConvert`、`runTask` の `kind: 'convert'` |
| `preload.js` / `main.js` | `pdfAPI.pickImageSources`・`pdfAPI.inspectImage`、`SIGK_SMOKE_CONVERT` |
| `package.json` `build.files` | `image-io.js` |
| `.gitignore` | `test/fixtures/*.png` |
| `renderer/tools.js` | `TOOLS` に `convert` |
| `renderer/tools-merge-list.js` | ドラッグを `row-drag.js` に置き換え |
| `renderer/file-drop.js` | 変換画面では画像を受ける |
| `renderer/tool-source.js` | `inspectImage` の包み |
| `renderer/app.js` | init 3本 |
| `index.html` / `renderer/shell.css` / `assets/icons.js` | パネル・`<script>`・意匠・アイコン |
| `test/harness.js` | `pickImageSources`／`inspectImage` のスタブ |
| `test/fixtures/build.js` | ディスク上の PNG 検体（下記） |
| `test/tools.test.js` | ツールの一覧に `convert` |
| `docs/02_アーキテクチャ設計.md` | preload API 表・現在地の注記 |

### fixture

`test/fixtures/build.js` に PNG を4枚足す（`images.js` の `makePng` で本物を作る）。起動確認と
`pdf-task` の通しテストが使う。JPEG はディスクに置かない（`makeJpeg` はヘッダーだけで pdf.js が描けず、
タブで開くと console error になる）。単体テストはメモリの `makeJpeg` で足り、起動確認は
`SIGK_SMOKE_CONVERT_JPEG=1` でメインが `nativeImage.toJPEG` で本物を一時フォルダに作る。

| ファイル | 中身 | 用途 |
|---|---|---|
| `image-wide.png` | 1200×800 | 自動→横、A4 に縮小して内接 |
| `image-tall.png` | 600×900 | 自動→縦、拡大して余白内へ |
| `image-small.png` | 64×64 | 拡大の確認、画像サイズ紙（64×64pt） |
| `image-alpha.png` | 300×200・alpha 0 | 白地が敷かれる |

---

## テストの範囲

| 層 | 対象 |
|---|---|
| 依存なし | `paper-size.js`（4用紙の pt・`mmToPt`・向きの解決）、`convert-plan.js`（紙と箱・画像サイズ・不正値・`stem`・`duplicateNames`・`planConvert`・上限）、`image-format.js` の `inspectImageBytes`／`describeImageFormat`、`image-io.js`（上限・ENOENT・先頭だけで足りるか・`pickImageSources` の親の有無） |
| pdf-lib | `image-page.js`（`allowUpscale` の有無、`drawImagePage` の紙と箱のオフセット・白地）、`op-insert.test.js` が緑のまま（差し込みの挙動が変わらない証拠）、`op-convert.js`（N 枚→N ページ・順序・`each` の `onPart`・途中失敗で `written`・GIF／プログレッシブ／PDF を名前付きで断る）、`pdf-task.js` の `runConvert`（進捗の刻み・4KB 未満 JPEG・書けない出力先で書き終えた分が残る） |
| jsdom | `tools.test.js`（3ツール）、`file-drop.test.js`（変換画面で画像を受ける／他画面は断る）、`tools-merge.test.js` が緑のまま（`row-drag.js` 切り出し後）、`tools-convert.test.js`（3経路・上限・読めない行・並べ替え・設定→例と「この紙」・画像サイズで余白と向きが固定・同名衝突で実行不可・`single` の保存先と spec とタブ・`each` の3択1回と spec・中止と失敗の帯・実行中の disabled） |
| 起動確認 | `SIGK_SMOKE_CONVERT=<a.png;b.png>` ＋ `_OUTPUT=single\|each`・`_PAPER`・`_ORIENT`・`_MARGIN`・`_OUT`・`_JPEG=1`・`_CANCEL=1`・`_STAY=1`。開発ツリーと配布物の両方 |

---

## 完了の判定

1. ツール一覧に「画像→PDF」が増え、結合・分割と切り替えられる。変換画面では画像のドロップが一覧に入り、他の画面では従来どおり PDF だけを受ける
2. 「ファイルを選ぶ…」「ドロップ」「`addFromLaunch`」で画像が一覧に入り、画素数と形式が出る。GIF・BMP・PDF・プログレッシブ JPEG は印が付いて実行できない。101 枚目は断られる
3. 用紙・向き・余白を変えると各行の「この紙」と出力の例が更新される。「画像サイズに合わせる」では向きと余白が押せなくなる
4. 「まとめる」で保存先を選ぶと、帯に「変換しています（n / N ファイル）」が出て、終わると新しいタブで開き、各ページの寸法が指定した紙と一致する（A4 横なら 841.89×595.28）
5. 「画像ごと」で出力フォルダに N 本でき、帯「N ファイルに変換しました」＋「フォルダを開く」。同名があれば3択が1回だけ出る
6. 一覧内で出力名が衝突すると赤く示され実行できない
7. 12MP の PNG を 30 枚まとめても RSS の増分が 1 枚ぶんに収まる（事前調査 A の再現）。途中で中止でき、一時ファイルが残らない
8. 変換した PDF を他のビューアで開き、余白・向き・白地が正しい（ユーザー目視）
9. `npm test` が緑で、`npm run dist` の配布物でも `SIGK_SMOKE=1` と `SIGK_SMOKE_CONVERT` が通る

### 人が目で確かめる手順

- 変換画面の見た目がモックのスクリーンショット（`screenshots/phase3-convert.png`）と揃っていること。
- 実物の写真（JPEG）を A4・標準余白で変換し、他のビューアで余白と向きを確かめること。
- 「フォルダを開く」でエクスプローラーが先頭の出力を選択した状態で開くこと。

---

## ユーザーの確定（2026-09-07）

起草前に AskUserQuestion で4件を聞き、すべて起草者の推しで確定した。

| # | 論点 | 確定 | 推しの根拠 |
|---|---|---|---|
| ① | 対象形式 | **JPEG／PNG で塊を切り、BMP／GIF／TIFF は次の塊** | pdf-lib は JPEG／PNG しか埋め込めず、デコード手段（Chromium の canvas か、純 JS ライブラリの追加か）の選定とライセンス点検が要る。既存の `placeImage` 経路で完成させるほうが確実 |
| ② | 「画像サイズに合わせる」の換算 | **1px → 1pt** | 単純で検証しやすい。DPI メタデータを読むと JFIF／EXIF／pHYs の解析と検体が要る |
| ③ | 余白 | **3択（なし／10mm／20mm）** | 入力検証が要らず、分割のファイル名規則と同じ簡素さ |
| ④ | 小さい画像 | **拡大して合わせる** | 「用紙に合わせる」意図に素直。差し込みの既存挙動は変えない |

あわせて同日、着手する塊は Phase 3-1 とし（Phase 5 前倒し案は取り下げ）、到達点は塊まるごととした。

### 起草者の判断で決めたもの

- 用紙の既定は A4、向きの既定は自動、余白の既定は標準（確定事項10・13・14）。
- 正方形の画像は「自動」で縦（確定事項13）。
- 入力の上限 100 枚（確定事項6。事前調査 A）。画像ファイルの上限 100MB（確定事項4）。
- 「まとめる」の既定名は先頭画像の名前（確定事項19）。「画像ごと」は元画像名 + `.pdf`（確定事項20）。
- 一覧内の出力名の衝突は連番を付けずに断る（確定事項20）。
- 出力フォルダはユーザーが変えたあとは追従しない（確定事項20。分割と同じ）。
- 中止・失敗でも書き終えた出力は残す（確定事項24・25。分割と同じ）。
- ツールの表示名は「画像→PDF」（3-2 で「PDF→画像」を別のツールとして足せるように）（確定事項34）。
- `--to-pdf` の並び順の注記は Phase 5（確定事項9）。

---

## 未確定のまま残すもの

| 項目 | 扱い |
|---|---|
| ~~BMP／GIF／TIFF~~ | **解決済み**（2026-09-14。塊⑤ `docs/spec-3-2-bmp-gif-tiff.md`）。ワーカーで utif（TIFF）・omggif（GIF）・自作（BMP）が画素へ展開し、`worker/pixel-image.js` が `/XObject /Image` に直接埋め込む。複数ページの TIFF は全ページ。差し込みにも広がった |
| EXIF の Orientation | 既知の限界。安く直す手（APP1 の Orientation を読んで `/Rotate` を付ける）は次の塊の候補 |
| CMYK JPEG | pdf-lib は `DeviceCMYK` で埋め込めるが、Adobe の反転が絡む。検体が無いので未検証 |
| DPI メタデータ | 読まない（ユーザー確定②）。要望が出たら「画像サイズに合わせる」の換算に足す |
| 最後に使ったツールを覚えるか | Phase 6 の設定画面で決める |
| `pdf-task.js` の分割 | 370 行 → 約 430 行になる。`runMerge`／`runSplit`／`runConvert` を `worker/tool-tasks.js` へ移す整理は塊④ の外 |

---

## 実装の記録（2026-09-07〜09-08・`claude/phase-3-convert` ブランチ）

確定事項1〜37 をそのまま実装した。仕様書から変えた点・足した点は次のとおり。

| 項目 | 仕様書 | 実装 | 理由 |
|---|---|---|---|
| 行のドラッグの切り出し | `row-drag.js` に `attachRowDrag` を置く（確定事項36） | そのとおり。状態を結線ごとのクロージャに閉じたので、結合と変換の一覧が同じ document 上で同居できる。`toolsMergeList` の `dropIndexFor`・`isDragging` は handle の素通しで公開を保った | 元の実装はモジュールスコープに `drag` を1つ持っており、2つの一覧が同時に動くと混ざる |
| フォルダーの欄 | 「出力」の節に常時置く（確定事項33） | 「画像ごと」を選んだときだけ出す | 「まとめる」の保存先は OS の保存ダイアログが決めるので、置いても押せない欄になる |
| 一覧内の出力名の衝突 | 実行前に赤く示す（確定事項20） | 重なった行すべてを赤くし、行の下に「出力名がほかの行と重なります」を出す。`duplicateNames` は2回目以降しか返さないので、画面側で同名の行を拾い直す | 2つ目だけ赤いと、どれと重なっているのか分からない |
| 「この紙」の列 | 計画から出す（確定事項3） | 行ごとに `planPage` を引き直して出す。用紙・向き・余白を変えると一覧も追従する | 出力の例（確定事項21）と同じ理屈で、設定の効きが一覧で見える |
| 足元の数え上げ | — | `4 ファイル ・ 3 件は変換できません` | 読めない行が下のほうにあると気づけない |
| 起動確認 | `SIGK_SMOKE_CONVERT` ＋ `_OUTPUT`・`_PAPER`・`_ORIENT`・`_MARGIN`・`_OUT`・`_JPEG`・`_CANCEL`・`_STAY` | すべて作った。分割と同じ2段構え。「画像ごと」は画面の `run()` をそのまま回し、「まとめる」は保存ダイアログを自動で押せないので結合と同じく `save.runTask` へ spec を直に渡す | 保存ダイアログの有無で経路が分かれる |
| 一覧の列間隔 | 7列（確定事項3） | 「形式」を右寄せ、「この紙」を左寄せにすると隣り合って読みにくかったので、この紙の側に 14px の余白を入れた | 実機の画面で見つけた（`screenshots/phase3-convert-app.png`） |

### 完了判定の結果

| # | 判定 | 結果 |
|---|---|---|
| 1 | ツール一覧に「画像→PDF」、結合・分割と切り替え、変換画面だけ画像のドロップを受ける | ✅ jsdom（`test/tools.test.js`・`test/file-drop.test.js`・`test/tools-convert.test.js`）・実機 |
| 2 | 3経路で画像が入り画素数と形式が出る。GIF・PDF・プログレッシブ JPEG は印が付いて実行不可。101 枚目は断る | ✅ jsdom・起動確認（`_JPEG=1` の本物の JPEG を `jpeg 1200×800` と読む） |
| 3 | 用紙・向き・余白を変えると「この紙」と例が更新。「画像サイズ」で向きと余白が押せなくなる | ✅ jsdom・起動確認（`_PAPER=image` で「1200×800 pt」） |
| 4 | 「まとめる」で帯が出て、終わるとタブで開き、寸法が指定の紙と一致（A4 横 = 841.89×595.28） | ✅ 起動確認（4枚 → 4ページ・260ms・`pageCount: 4`。`pages` が `841.89×595.28` と `595.28×841.89`） |
| 5 | 「画像ごと」で N 本でき、帯「N ファイルに変換しました」＋「フォルダを開く」。同名の3択は1回 | ✅ 起動確認（3枚 → 3本・570ms・`dialogOpen: true`・`bannerAction: フォルダを開く`）・jsdom |
| 6 | 一覧内で出力名が衝突すると赤く示され実行できない | ✅ jsdom・起動確認（同じ画像を 60 枚で `出力名が重なります: image-wide.pdf`・`canRun: false`） |
| 7 | 12MP の PNG 30 枚で RSS の増分が 1 枚ぶん。中止でき、一時ファイルが残らない | ✅ メモリは事前調査 A を再現（下記）。中止は起動確認 `_CANCEL=1`（40枚を 662ms で止め、`4 ファイルは書き出し済みです。`・`tempLeft: false`） |
| 8 | 他のビューアで開いて余白・向き・白地が正しい | ⏳ **ユーザーの目視待ち。**pdf-lib で読み直した検証（`test/op-convert.test.js`・`test/image-page.test.js`）は通っている |
| 9 | `npm test` 緑、配布物で `SIGK_SMOKE=1` と `SIGK_SMOKE_CONVERT` | ✅ 908件（875 → 908）。配布物の結果は下記 |

### 実測（Windows 11 実機）

| 入力 | 結果 |
|---|---|
| fixtures の PNG 4枚を A4・自動・標準でまとめる | 4ページ・7.2KB・260ms。紙は `A4 横 / A4 縦 / A4 縦 / A4 横`（自動が効いている） |
| 同じ4枚を画像ごと | 4本・`tempLeft: false`。帯「4 ファイルに変換しました」＋「フォルダを開く」 |
| `_JPEG=1`（`nativeImage.toJPEG` の本物）＋ `_PAPER=image` | 2本。JPEG を `1200×800` と読み、紙も `1200×800 pt` |
| 別名の PNG 40枚を画像ごと、途中で中止 | 押してから 662ms で `canceled`。4本を書き終えて残し、一時ファイル無し |
| **12MP（4000×3000）の PNG 30枚を1本にまとめる**（Node 単体。事前調査 A の再現） | 30ページ・14.0秒。RSS 137MB → 頂点 207MB（増分 **69MB**）。1枚ぶんが 46MB、30枚ぶんなら 1373MB なので、積み上がっていない |
| **配布物**（`npm run dist` → `dist/win-unpacked`）で画像ごと3枚 | `SIGK_SMOKE=1` は `problems: []`・アイコン 37 個すべて描画。3本・`tempLeft: false` |

> 起動確認を Git Bash から回すときは、`SIGK_SMOKE_CONVERT` に**絶対パスを `;` で並べない**こと。
> MSYS が「Windows のパス一覧」と見なして POSIX 形式（`/c/...`）へ書き換えるため、アプリ側が
> ファイルを見つけられなくなる。相対パスで渡すか、`MSYS_NO_PATHCONV=1` を付ける。

### 人が目で確かめる手順（残り）

- `screenshots/phase3-convert-app.png` が `screenshots/phase3-convert.png`（モック）と揃っていること。
- 実物の写真（JPEG）を A4・標準余白で変換し、他のビューアで余白・向き・白地を確かめること（判定8）。
- 「フォルダを開く」でエクスプローラーが先頭の出力を選択した状態で開くこと。
