# 仕様書: Phase 4 塊③ 図形・フリーハンド

起草日: 2026-09-17
ステータス: **確定**（2026-09-17 確定。着手前の3件は `docs/07` 決定36、モックの1件と事前調査後の論点8件は `docs/07` 決定37 で
同日ユーザーが決定。9件とも起草者の推し。末尾「ユーザーの確定」を参照。残る細部は起草者の推しで書き、その一覧を
「起草者の判断で決めたもの」に置いた）
関連: `docs/05_開発ロードマップ.md` Phase 4（4-4）／`docs/01_製品要件定義.md` F-05-4・F-05-5／`docs/04_UI設計.md` 4-3／
`docs/02_アーキテクチャ設計.md` 2-3（保存の形）・第3章／`docs/spec-4-1-text-markup.md`（注釈の土台。本書はその上に載る）／
`docs/spec-4-2-free-text.md`（テキストの箱の移動・読み込み・右パネルの行。図形はこれを手本にする）／
`docs/spec-1-6-save.md`（保存の経路・保存後に開き直す）／`docs/spec-1-4-find-print.md`（印刷の描画経路）

---

## 目的

Phase 4 の3つ目の塊。**注釈モードで「図形」か「ペン」の道具を選び、紙の上をドラッグして矩形・楕円・直線・矢印を描き、
ペンで手描きの線を引ける。色と線の太さを選べ、描いたものを選んで動かす・消す・元に戻せる。保存すると PDF 標準の
Square／Circle／PolyLine／Ink 注釈（外観 `/AP` 付き）として書かれ、他のビューアでも同じ位置・太さ・色で見える**
（F-05-4・F-05-5）。

塊①②で固めた土台 — 注釈の持ち方（`{ added, removed }`）・1本の履歴・dirty・SVG の層と canvas への重ね描き・右パネル・
`/Annots` への書き込み・保存後の開き直し・読み込んだ注釈を pdf.js に描かせない印・掴んで動かす — はそのまま使い、
図形という新しい種類（`kind: 'square' | 'circle' | 'line' | 'arrow' | 'ink'`）を載せる。フォントは要らない。

---

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| レールの「図形」「ペン」の道具を有効にする（ノートは灰色のまま） | ノート・注釈一覧・不透明度（塊④） |
| ドラッグで矩形・楕円・直線・矢印を描く。「図形」は 1 つの道具で、右パネルの「図形の種類」で 4 種を切り替える（モック） | 多角形・折れ線・雲形・角丸・引き出し線 |
| ペンでなぞって線を引く（1 回のなぞり＝1 つの注釈。点は自前で間引く。論点7） | 平滑化（ベジェ化）・筆圧・消しゴム・なぞりのまとめ |
| Shift で正方形・正円・45° 刻みの直線（起草者判断） | 描いたあとの大きさの変更（ハンドル。論点8）・回転・複数選択 |
| 色（赤・青・緑・黒。論点2）と線の太さ（1・2・3・5・8pt。論点1）。最後の値と「図形の種類」を `settings.json` に覚える（論点4） | 塗りつぶし（`/IC`。論点3）・破線・自由な色・自由な太さ |
| 描いたものを選ぶ・掴んで動かす・色と太さを変える・Delete で消す・Ctrl+Z で戻す | 矢印キーでの移動・コピー＆ペースト |
| 保存: `/Square`・`/Circle`・**`/PolyLine`（2 点。直線・矢印。論点5）**・`/Ink`。`/Rect`・`/C`・`/BS /W`・`/Vertices`・`/LE`・`/InkList`・**`/AP /N`**。抽出にも付いていく | `/Line`（pdf.js が向きを落とすので書かない）・`/IC`・`/IT`・`/RD`・`/BE`（雲形） |
| 既存の Square／Circle／Ink／2 点の PolyLine を読み込んで選ぶ・消す・動かす・色と太さを変える（論点5） | 他のツールの `/Line`・3 点以上の PolyLine・Polygon の編集（表示のみ。pdf.js が描く） |
| 印刷に未保存の図形が映る（塊①②と同じ） | PDF→画像（読み直して描くので映らない。`spec-3-3` 確定事項1 のまま） |
| 起動確認 `SIGK_SMOKE_ANNOTATE` に図形・ペンの操作を足す | 差し込んだページ・暗号化 PDF・サムネイルの扱いの変更（塊①と同じ） |

---

## 事前調査（2026-09-17・Windows 11 実機・Node 22・Electron 44・pdf.js 6.3.289・pdf-lib 1.17.1・fixtures のみ）

プローブは scratchpad の使い捨て（Node で pdf-lib を回すもの、Chromium で pdf.js と DOM を回すもの）。検体は
`test/fixtures/` の `three-pages.pdf`・`rotated.pdf`。記録後に捨てた。

### A. pdf.js が図形の注釈で返すもの — **`/Line` は向きを落とす**

B で書いた検体（Square・Circle・Line・Line＋矢じり・PolyLine・PolyLine＋矢じり・Ink 2 本）を pdf.js の `getAnnotations()` で読んだ。

| Subtype | 返る欄 | 直せるか |
|---|---|---|
| Square／Circle | `rect`・`color`（0〜255 の RGB）・`borderStyle.width`（`/BS /W`）・`hasAppearance`。`/IC` を書かなければ `interiorColor` の欄そのものが無い | **直せる**（欄が揃う） |
| Line | `lineCoordinates`・`lineEndings`（`/LE` の順のまま）。**ただし `lineCoordinates` は `Util.normalizeRect(/L)` で `[minX minY maxX maxY]` に並べ直されている**。`/L [100 520 480 430]`（右下がり）が `[100 430 480 520]` で返り、右上がりの線と区別がつかず、矢じりがどちらの端か（4 通り）も分からない | **直せない**（pdf.js の `LineAnnotation` の実装。`vendor/pdf.worker.mjs` で確認） |
| PolyLine | `vertices`（`Float32Array`。**`/Vertices` の並びのまま** `[480 330 100 300]`）・`lineEndings`（`/LE`。Line と同じく `[/None /OpenArrow]` が使える）・`borderStyle.width`・`color` | **直せる** |
| Ink | `inkLists`（`Float32Array` の配列。x y の平たい並び。`100.4` は float32 の `100.4000015` で返る）・`borderStyle.width`・`color`・`opacity`・`isEditable: true` | **直せる**（読み込みで小数 2 桁に丸める） |

- `annotationStorage.setValue(id, { noView: true })` で 5 種とも個別に隠せる（注釈の矩形内の暗い画素が 0 になる。
  残るのは矩形の重なった隣の注釈の分だけ）。塊①②の `annotation-import` の経路がそのまま使える。
- `/AP` の無い注釈も pdf.js は自前の外観で描く（描画 34ms。`/AP` 付きは 14.5ms）。ただし矢じりは描かない
  （`m l S` だけ）。他のビューアは `/AP` の無い注釈をどう描くか分からないので、塊①②と同じく**外観は必ず書く**。
- **直線・矢印は `/Line` ではなく 2 点の `/PolyLine` で書く**（論点5・6）。`/Vertices` は向きを保ったまま返り、`/LE` で矢じりを
  付けられる（PDF 1.5 以降の標準。他のビューアは `/AP` を描くので見え方は同じ）。他のツールが `/Line` で書いた直線・矢印は
  向きを復元できないので表示のみ（他のツールの FreeText と同じ扱い）。

### B. pdf-lib で書く外観と辞書

`three-pages.pdf`（1,464 B）の 1 ページ目に 8 つ足して保存。**6ms・+35,066 B**（うち 1,000 点のペンが `/InkList` と `/AP` で
約 16 KB ×2。残り 7 つは合計 3 KB）。読み直すと辞書の欄はすべて残る。

| 種類 | content stream（`/GS gs`・`r g b RG` のあと） | 大きさ |
|---|---|---|
| 矩形 | `w w x+w/2 y+w/2 (幅−w) (高さ−w) re S`（線は `/Rect` の内側に収める） | 49 B |
| 楕円 | ベジェ 4 本（κ = 0.5523）`m c c c c h S` | 196 B |
| 直線 | `w w 1 J x1 y1 m x2 y2 l S`（丸い端） | 52 B |
| 矢印 | 直線 ＋ 終点に開いた矢じり `p1 m x2 y2 l p2 l S`（長さ max(9pt, 線幅×6)・開き 30°・`1 j` 丸い角） | 102 B |
| ペン | `w w 1 J 1 j x0 y0 m x1 y1 l … S`（6 点 98 B。1,000 点 15,797 B） |

辞書は共通に `/Type /Annot /Subtype /Rect /C（線の色）/CA 1 /F 4 /BS << /W w /S /S >> /Border [0 0 w] /Contents () /NM /P /M /AP << /N >>`。
種類ごとに `/Vertices [x1 y1 x2 y2]`（直線・矢印）・`/LE [/None /OpenArrow]`（矢印）・`/InkList [[x y …]]`（ペン）。
`/Rect` は矩形・楕円では箱そのもの、直線・矢印・ペンでは描く点（矢じりの先を含む）の外接に線幅の半分を足したもの。
塗り（`/IC`）は書かない（論点3）。

### C. 紙の上のドラッグ描画と、ペンの点の量

- **押し離しの振り分け**（`annotate-pointer.js`）: 図形・ペンの道具を持っているとき、mousedown で「選んでいる注釈の上」なら
  従来どおりドラッグ移動、そうでなければ描き始める（`preventDefault` で文字選択を始めさせない。テキストレイヤーは CSS で
  `user-select: none`）。mousemove で下書き（SVG の `<g class="annot-draft">`）を更新し、mouseup で `CLICK_SLOP`（3px）を超えて
  動いていれば 1 世代積む。動いていなければ下書きを捨てて従来の「押した」経路（当たり判定で選ぶ・選択を外す）へ流す。
  既存の選択・テキストの配置・マークアップの作成は触らない。
- **描画コスト**（Chromium）: 1,000 点の `<polyline>` を 60 回組み直して 9.4ms（1 回 0.16ms）、3,000 点で 27.6ms。`points` 属性を
  伸ばすだけなら 1,000 点で 1.8ms。canvas に 1,000 点を 60 回描いて 2.9ms。**描画の量は問題にならない。**
- **間引き**（0.5px 刻みの波形 1,000 点）: 距離しきい値 2px で 334 点、そのあと Douglas–Peucker（許容 1px）で **52 点**。content
  stream は 16.0 KB → 5.3 KB → **0.8 KB**。DP は 20 行の再帰で 1ms。→ `simplify-js` は足さず、自前の純関数にする（論点7）。

### D. 回転したページ

`rotated.pdf` の 2 ページ目（`/Rotate 90`）に紙の座標で矩形・矢印・ペンを書き、pdf.js で表示した。

- `convertToViewportPoint` → `convertToPdfPoint` の往復は誤差なし（`(50,700)` → 表示 `(700,50)` → `(50,700)`）。
- 紙の座標の軸に沿った矩形は、回転した表示でも軸に沿った矩形になる（90° 単位なので）。→ 表示でドラッグした 2 点を紙の座標に
  直し、min／max で組み直せば矩形・楕円の `/Rect` になる（`markupQuads.cssRectToQuad` と同じ作法）。直線・矢印・ペンは点を
  そのまま直すだけ。**テキストのような `/Rotate` は要らない**（図形は紙に描いたものなので、紙と一緒に回るのが正しい）。
- 描画位置は期待どおり（矩形が右上に縦長、矢印が左下向き）。

### E. 印刷の重ね描き

150dpi（倍率 2.083）で、pdf.js が `/AP` を描いた画素と、`/AP` を隠して canvas 2D に同じ形（`strokeRect`・`ellipse`・`lineTo`）を
描いた画素を比べた: 矩形 5,774 = 5,774、楕円 6,313 vs 6,335、直線 1,965 vs 1,968、ペン 7,606 vs 7,615・4,540 vs 4,541。外接矩形は
一致。→ 塊①②と同じ `overlay` の口で映せる。

---

## 確定事項

### A. 画面（`docs/04` 4-3・モック `screenshots/phase4-shapes-ink.png`・`-selected.png`）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 道具 | レールの「図形」（`data-tool="shape"`）と「ペン」（`data-tool="pen"`）を有効にする（`aria-disabled` を外す）。ノートは灰色のまま。押している間は `.active`。道具を持っているとき、紙の上のカーソルは `crosshair`、テキストレイヤーは `user-select: none`（ドラッグで文字を選ばせない） |
| 2 | 右パネル | 塊②の欄に **「図形の種類」の行**（矩形・楕円・直線・矢印の 4 つのボタン。**「図形」の道具を持ち、何も選んでいないときだけ**出す）と **「線の太さ」の行**（`<select>`。図形・ペンの道具を持っているか、図形系の注釈を選んでいるときに出す）を足す。「種類」は道具なら「図形（次に付ける）」「ペン（次に付ける）」、選んでいれば「矩形」「楕円」「直線」「矢印」「ペン」。ページ・削除は塊①②と同じ。ヒントは図形用（ドラッグで描く・Shift・Esc）、ペン用（なぞる・1 回＝1 つ）、選択中用（掴んで動かす・Delete・Ctrl+Z） |
| 3 | 描く操作 | 道具を持って紙の上で押す → 動かす → 離す。押した点と今の点から下書き（`<g class="annot-draft">`。確定後と同じ見た目）を SVG の層に描き直し、離したときに `CLICK_SLOP`（3px）を超えて動いていれば注釈にして 1 世代積み、**描いたものを選ぶ**。動いていなければ下書きを捨てて塊①②の「押した」経路（当たり判定で選ぶ・何も無ければ選択を外す）へ流す。押した点が**選んでいる注釈の上**なら描かずにドラッグ移動（塊②と同じ）。Esc は描いている途中なら下書きを捨てる（それ以外は塊①の順） |
| 4 | Shift（起草者判断） | 押しながら描くと、矩形は正方形・楕円は正円（|dx|・|dy| の大きい方を辺にし、向きは保つ）、直線・矢印は角度を 45° 刻みに吸着（水平・垂直を含む）。判定は表示の座標で行う（90° 単位の回転なので紙でも同じ形になる） |
| 5 | 選ぶ・動かす・消す | 押して離すと選ぶ（確定事項12 の当たり判定）。選んだ図形を掴んでドラッグすると動く（離したときに 1 世代。塊②の `beginDrag/endDrag` を図形系に広げる）。Delete で消す、Esc で解除、Ctrl+Z で戻す。ダブルクリックは何もしない |
| 6 | ペン（論点7） | なぞっている間、直前の点から **2px**（表示）以上離れた点だけを足し、離したときに **Douglas–Peucker（許容 1px・表示）** で間引いてから紙の座標に直す。1 回のなぞり＝1 つの Ink 注釈（`paths` は 1 本）。平滑化はしない（折れ線。丸い端と角） |
| 7 | 太さ・色・種類の変更 | 「線の太さ」と色は、図形系の注釈を選んでいればその注釈を変えて 1 世代積み、選んでいなければ次に描く値として覚える（塊②の文字の大きさと同じ）。「図形の種類」は次に描く種類だけ（描いた図形の種類は変えられない。消して描き直す） |
| 8 | 見た目 | SVG: 矩形 `<rect>`・楕円 `<ellipse>`・直線 `<line>`・矢印 `<line>`＋矢じりの `<polyline>`・ペン `<polyline>`。`stroke-width` は線幅 × 倍率、`fill: none`。直線・矢印・ペンは丸い端と角（`round`）、矩形は角のまま（`miter`）。線は矩形・楕円の `/Rect` の**内側**に収める（線幅の半分だけ内へ。保存の外観と同じ）。選択中は塊①と同じ破線の枠（`quads` の外接＋3px） |

### B. 座標と回転（事前調査 C・D）

| # | 項目 | 決定 |
|---|---|---|
| 9 | 座標 | 表示の点（`.pdf-page` 基準の CSS px）は `viewport.convertToPdfPoint` で紙の座標（pt・小数 2 桁）へ。矩形・楕円は押した点と離した点の min／max で `rect [x1 y1 x2 y2]`（辺は最低 1pt）。直線・矢印は `paths: [[[x1 y1] [x2 y2]]]`（押した点 → 離した点。矢じりは離した点）。ペンは間引いた点列 `paths: [[[x y] …]]` |
| 10 | `rect` と `quads` | 矩形・楕円は `rect` が箱そのもの。直線・矢印・ペンは「描く点（矢じりの 2 つの翼を含む）の外接に線幅の半分を足したもの」。`quads` はどれも `rect` の四隅を 1 つ（`freeTextGeometry.quadOfRect`。塊①の選択枠・検証がそのまま通る）。太さを変えると `rect`・`quads` を作り直す |
| 11 | 回転 | 図形は紙に描いたものなので、紙と一緒に回る。`/Rotate` は書かず、entry にも回転を持たない。矢じりの翼は紙の座標で計算してから表示へ直す（保存の外観と同じ点になる）。楕円は紙の座標の箱を表示へ直した箱に描く（90° 単位なので軸に沿ったまま） |
| 12 | 当たり判定 | 矩形・楕円は箱の内側（`markupQuads.hitTest`。塊①と同じ）。直線・矢印・ペンは **線分からの距離**（矢じりの 2 本を含む）が `線幅 / 2 + 3px相当（3 / 倍率 pt）` 以下。`annotate.hitTest` が kind で分ける（`shapeGeometry.hitsPath`） |
| 13 | 読み込み（論点5） | 文書を開いたとき、`Square` → `square`、`Circle` → `circle`、`Ink` → `ink`、**`PolyLine` は頂点が 2 つのものだけ**（`lineEndings` が `[None, None]` なら `line`、`[None, OpenArrow]` なら `arrow`。それ以外は拾わない）。`Line`・Polygon・3 点以上の PolyLine は拾わない（pdf.js が描く。表示のみ）。欄は `color`（`/C`。無ければ拾わない）・`lineWidth`（`borderStyle.width`。無ければ 1）・`rect`・`paths`（`vertices`／`inkLists`。小数 2 桁に丸める。2 点未満の path は捨て、path が無ければ拾わない）。拾ったものは `noView` で pdf.js に描かせず自前で描く（塊①と同じ） |

### C. 注釈の持ち方と履歴（`spec-4-2` C を広げる）

| # | 項目 | 決定 |
|---|---|---|
| 14 | entry | `{ id, src, kind, color, opacity: 1, lineWidth, rect, quads: [箱の四角], paths?, text: '' }`。`KINDS` に `square`・`circle`・`line`・`arrow`・`ink` を足し、`SHAPE_KINDS`（矩形・楕円・直線・矢印）と `PATH_KINDS`（直線・矢印・ペン。`paths` を持つ）を公開する。`validEntry` は図形系なら `lineWidth` が正の有限・`quads.length === 1`、`PATH_KINDS` なら `paths` が 1 本以上（直線・矢印は 1 本ちょうどで 2 点、ペンは各 path が 2 点以上）で各点が有限の `[x, y]` |
| 15 | 変える口 | `updateAnnot` の `PATCH_FIELDS` に **`lineWidth`・`paths`** を足す（移動は `rect`・`quads`・`paths` を、太さは `lineWidth`・`rect`・`quads` を渡す）。読み込んだものを変えると写しが `added` に足される（塊①②と同じ） |
| 16 | dirty | `sameEntry` に `lineWidth` と `paths`（点ごと）の比較を足す |
| 17 | 履歴 | 「描く」「動かす」「色を変える」「太さを変える」「消す」で 1 世代ずつ、塊①の `commitAnnots` に載せる。下書きは履歴に載らない |
| 18 | 保存の形 | `toSaveSpec` は図形系を `{ src, kind, color, opacity, rect, lineWidth, paths? }` で写す（`quads` は落とす。矩形・楕円に `paths` は無い） |
| 19 | 覚える値 | `settings.json` の `ui.annotColors.shape`・`ui.annotColors.pen`（塊①の経路に 2 つ足す。4 種の図形は `shape` の色を共有）、**`ui.annotLineWidth`**（プリセット外は既定 2）、**`ui.annotShapeKind`**（プリセット外は `square`）。起動時に `annotate.applyColors`／`annotateShape.applyLineWidth`／`applyShapeKind` |

### D. ワーカー（事前調査 A・B）

| # | 項目 | 決定 |
|---|---|---|
| 20 | 純関数 `worker/shape-appearance.js` | pdf-lib を知らない。`isShapeEntry(entry)` と `shapeAppearanceOf(entry)` → `{ content, bbox, subtype, rgb, opacity, lineWidth, vertices?, lineEndings?, inkList? }`。content は事前調査 B の形（`/GS gs` → `RG` → 種類ごとの演算子列）。数は `annotation-appearance.num`（小数 2 桁・末尾 0 無し）。矢じりの翼と楕円の κ（0.5523）は renderer の `shape-geometry.js` と同じ値・同じ式で、**一致をテストで見張る**（プロセスが違うので import できない。塊②の行の寸法と同じ流儀） |
| 21 | 注釈の辞書 | `/Type /Annot`・`/Subtype`（`Square`／`Circle`／`PolyLine`／`Ink`）・`/Rect`（＝`bbox`）・`/C`（線の色）・**`/BS << /W 線幅 /S /S >>`**・`/Border [0 0 線幅]`・`/Contents ()`・`/CA 1`・`/F 4`・`/NM sigk-…`・`/P`・`/M`・`/AP << /N ref >>`。直線・矢印は `/Vertices [x1 y1 x2 y2]`、矢印はさらに `/LE [/None /OpenArrow]`、ペンは `/InkList [[x y …]]`。**書かないもの**: `/IC`・`/IT`・`/RD`・`/BE`・`/L` |
| 22 | 外観 `/AP /N` | Form XObject。`BBox` ＝ `/Rect`、`Matrix` 無し、`Resources: { ExtGState: { GS } }`（`CA`・`ca` 1）。塊①と同じ包み方（`op-annotate.appearanceStream`）。フォントは要らない |
| 23 | `op-annotate.js` | `kindFields` を kind で 3 つに分ける（マークアップ・テキスト・図形系）。`validateAdd` は図形系を `shapeAppearanceOf(entry) !== null` で見る。`applyAnnotations` の流れ（検証 → フォント（テキストがあるときだけ）→ 外観 → 消す → 足す）は変えない。消す側（`annotation-remove.js`）も変えない |
| 24 | 精度 | 座標・線幅は小数 2 桁。ペンの点は間引いてから書く（1 回のなぞりで数十〜百点、1〜3 KB） |

### E. 印刷・PDF→画像（`spec-4-1` E と同じ）

| # | 項目 | 決定 |
|---|---|---|
| 25 | 印刷 | `annotation-layer.paint` が図形系を `shape-graphics.paint(ctx, entry, viewport)` に委ね、SVG と同じ幾何（紙の座標で計算 → `convertToViewportPoint`）で `strokeRect`／`ellipse`／`lineTo` を描く（事前調査 E で `/AP` と画素が一致）。線幅は線幅 × 倍率、端と角は SVG と同じ |
| 26 | PDF→画像 | 映らない（読み直して描く。`spec-3-3` 確定事項1・塊①の 33-⑦ のまま） |

### F. プリセット（論点1・2・4）

| # | 項目 | 決定 |
|---|---|---|
| 27 | 道具と種類 | `TOOLS` に `shape`・`pen` を足す。`TOOL_LABELS` に `shape: '図形'`・`pen: 'ペン'`・`square: '矩形'`・`circle: '楕円'`・`line: '直線'`・`arrow: '矢印'`・`ink: 'ペン'`。`SHAPE_KINDS = ['square', 'circle', 'line', 'arrow']`、既定の種類は `square` |
| 28 | 色 | 図形・ペンとも **赤 `#d92c2c`・青 `#2c5cd9`・緑 `#2f9e5a`・黒 `#1c2430`**、既定 **赤**。`COLORS.shape`・`COLORS.pen`（同じ並び。覚える値は別）。4 種の図形と `ink` は `paletteOf(kind)` で `shape`／`pen` の色を引く。`COLOR_NAMES` に `#2f9e5a: '緑'` |
| 29 | 線の太さ | `LINE_WIDTHS = [1, 2, 3, 5, 8]` pt の `<select>`。既定 **2**。図形とペンで共通。`ui.annotLineWidth` に覚える。`settings.js` の `ANNOT_LINE_WIDTHS`・`ANNOT_SHAPE_KINDS`・`ANNOT_COLORS.shape/pen` と `annotation-presets.js` の一致を `settings.test.js` が見張る |
| 30 | 矢じり（論点6） | 終点に開いた矢じり。翼の長さは `max(9pt, 線幅 × 6)`、開きは 30°。線と同じ太さ・色・丸い端と角。`/LE [/None /OpenArrow]` |

---

## 足りない部品

### 新しいモジュール（テストは `test/<module>.test.js` と 1 対 1）

| ファイル | 層 | 役目 |
|---|---|---|
| `renderer/shape-geometry.js` | 純関数 | `boxOf(from, to, { square })`（2 点 → 正規化した箱。辺は最低 1pt）・`snapAngle(from, to)`（45° 刻み）・`arrowHead(from, to, lineWidth)`（翼 2 点）・`boundsOf(points, pad)`・`rectOfEntry(kind, paths, lineWidth)`（`rect`・`quads`）・`distanceToSegment`・`hitsPath(paths, point, tolerance, { arrow })`・`thinPoints(points, minStep)`・`simplifyPath(points, tolerance)`（Douglas–Peucker）・定数 `ARROW_MIN_LENGTH`・`ARROW_LENGTH_RATIO`・`ARROW_ANGLE`・`MIN_STEP`・`SIMPLIFY_TOLERANCE`・`HIT_SLACK` |
| `renderer/shape-graphics.js` | 画面 | `svgOf(doc, entry, viewport)`（`<rect>`・`<ellipse>`・`<line>`・`<polyline>`）と `paint(ctx, entry, viewport)`（印刷）。`free-text-shape.js` と同じ口 |
| `renderer/annotate-shape.js` | 指揮 | `beginDraft({ index, point, shift })`・`updateDraft(point, shift)`・`finishDraft(point, shift)`（`CLICK_SLOP` 以下なら捨てる。注釈にして `commitAnnots` → 選ぶ）・`cancelDraft()`・`isDrawing()`・`move(key, delta)`・`setLineWidth(width)`・`setShapeKind(kind)`・`getLineWidth/getShapeKind/applyLineWidth/applyShapeKind/rememberLineWidth/rememberShapeKind` |
| `worker/shape-appearance.js` | 純関数 | `KAPPA`・`isShapeEntry(entry)`・`shapeAppearanceOf(entry)`・`arrowHead(from, to, lineWidth)`（renderer と同値。テストで見張る） |

### 既存への追記

| ファイル | 変更 |
|---|---|
| `renderer/annotation-state.js` | 確定事項14〜18（`KINDS`・`SHAPE_KINDS`・`PATH_KINDS`・`isShapeKind`・`isPathKind`・`validEntry`・`PATCH_FIELDS`・`sameEntry`・`copyEntry`・`toSaveEntry`） |
| `renderer/annotation-layer.js` | `groupOf`・`paint` が図形系を `shapeGraphics` へ委ねる。`draw` に `draft`（下書きの entry。最後に `<g class="annot-draft">` で描く）を足す |
| `renderer/annotate-pointer.js` | mousedown で図形・ペンの道具なら `annotateShape.beginDraft`（選んでいる注釈の上ならドラッグ移動）、mousemove で `updateDraft`、mouseup で `finishDraft`（描いたら return、描かなければ従来の経路）。`beginDrag` を図形系にも広げ、`endDrag` の `move` を kind で `annotateText`／`annotateShape` に振る。Shift は `event.shiftKey` |
| `renderer/annotate.js` | `hitTest` を kind で分ける（`PATH_KINDS` は `shapeGeometry.hitsPath`）。`escape()` の先頭で `annotateShape.cancelDraft()`。`isDrawing` を公開。`COLORS` の引き方を `paletteOf` 経由に |
| `renderer/annotation-presets.js` | 確定事項27〜30（`TOOLS`・`TOOL_LABELS`・`SHAPE_KINDS`・`SHAPE_KIND_LABELS`・`DEFAULT_SHAPE_KIND`・`COLORS.shape/pen`・`COLOR_NAMES`・`paletteOf`・`LINE_WIDTHS`・`DEFAULT_LINE_WIDTH`・`isLineWidth`・`isShapeKind`） |
| `renderer/annotation-props.js`・`index.html` | 「図形の種類」の行（`#props-shape-row`。4 つの `<button>`）・「線の太さ」の行（`<select id="props-width">`）。`HINTS.shape`・`HINTS.pen`・`HINTS.shapeSelected`。`renderSwatches(paletteOf(kind), …)` |
| `renderer/annotation-import.js` | `SUBTYPES` に `Square`・`Circle`・`Ink`・`PolyLine`（確定事項13。`importedShape`） |
| `renderer/app.js` | `annotateShape.init`・`applyLineWidth(result.ui.annotLineWidth)`・`applyShapeKind(result.ui.annotShapeKind)` |
| `renderer/shell.css` | `.props-kinds`（種類のボタン）・`.annot-draft`・`html[data-tool="shape"] .textLayer, html[data-tool="pen"] .textLayer { cursor: crosshair; user-select: none }` |
| `assets/icons.js` | `shapeSquare`・`shapeCircle`・`shapeLine`・`shapeArrow`（右パネルの種類のボタン用） |
| `index.html` | L98・99 の `aria-disabled` を外し `data-tool="shape"`／`"pen"`。右パネルの 2 行。`<script>` 3 本（`shape-geometry`・`shape-graphics`・`annotate-shape`） |
| `worker/op-annotate.js` | 確定事項21〜23 |
| `settings.js` | `DEFAULTS.annotColors.shape/pen`・`ANNOT_COLORS.shape/pen`・`DEFAULTS.annotLineWidth: 2`・`ANNOT_LINE_WIDTHS`・`DEFAULTS.annotShapeKind: 'square'`・`ANNOT_SHAPE_KINDS`・`pickUi/mergeUi` |
| `test/shell.test.js` | 有効 6（`shape`・`pen` を含む）・灰色 1 |
| `test/settings.test.js` | `shape`・`pen` の既定色、`annotLineWidth`・`annotShapeKind` の丸め、`annotation-presets` との一致 |
| `test/harness.js` | `createPdfjsStub({ annotations })` の Square／Circle／PolyLine／Ink の形（`borderStyle`・`vertices`・`lineEndings`・`inkLists`）、`settingsAPI.setUi` の 2 キー |
| `test/op-annotate.test.js`・`test/pdf-task.test.js` | 図形の往復（下記） |
| `main.js` | `annotateScript` に `shape:<種類>:<page>:<x1>x<y1>-<x2>x<y2>`（紙の座標 pt でドラッグして描く）・`pen:<page>:<x>x<y>,<x>x<y>,…`（なぞる）・`width:<pt>`（線の太さ）を足し、`drag:` を図形にも効かせる。結果に `shapes`（ページごとの kind・線幅・色・rect）・`importedShapes`（保存→開き直し後） |
| `docs/02`（2-3・第3章のツリー・現在地）・`docs/04`（4-3 追記・第3章の表）・`docs/05`・`docs/07`・`README.md` | 現在地 |

依存は増えない（幾何は自前の純関数。`simplify-js` は足さない。論点7）。

---

## テストの範囲

| 層 | 対象 |
|---|---|
| 依存なし | `renderer/shape-geometry.js`（`boxOf` の正規化と正方形・最低 1pt、`snapAngle` の 8 方向、`arrowHead` の翼の位置と長さ、`rectOfEntry` の余白、`distanceToSegment`、`hitsPath` の許容、`thinPoints`、`simplifyPath` が直線を 2 点に・角を残す）、`worker/shape-appearance.js`（5 種の content の文字列、`bbox`、`vertices`／`lineEndings`／`inkList`、形が違えば `null`、**renderer の `arrowHead`・定数との一致**）、`worker/op-annotate.js`（保存して読み直し: `/Subtype`・`/Rect`・`/C`・`/BS /W`・`/Border`・`/Vertices`・`/LE`・`/InkList`・`/AP /N`、`/IC` と `/L` が無い、テキストが無ければフォント無し、抽出先に付いていく、形が違えば `{ error }`）、`renderer/annotation-state.js`（図形系の `validEntry`・`updateAnnot`（`lineWidth`・`paths`）・`sameAnnots`・kind 別の `toSaveSpec`）、`renderer/annotation-presets.js`＋`settings.js`（一致・既定・丸め） |
| jsdom | `annotate-shape.test.js`（下書き → 確定で `commitAnnots` が 1 回・選ばれる、`CLICK_SLOP` 以下は作らない、Esc で捨てる、ペンの間引き、移動、太さ・色・種類の変更と覚える値）、`annotate-pointer.test.js`（道具を持ってドラッグすると描く／押し離しは選ぶ／選んでいる図形の上は移動、Shift）、`shape-graphics.test.js`（5 種の SVG 要素と属性、`paint` の呼び出し、回転した viewport での位置）、`annotation-layer.test.js`（委譲・`draft`）、`annotation-props.test.js`（2 行の出し入れ・ボタンの `on`・`change` → `setLineWidth`）、`annotation-import.test.js`（Square／Circle／Ink／2 点 PolyLine を拾い、Line・3 点 PolyLine・`/C` 無しは拾わない）、`annotate.test.js`（`hitTest` の分岐・`escape`）、`shell.test.js`、`app.test.js`（`applyLineWidth`／`applyShapeKind`） |
| 起動確認 | `SIGK_SMOKE_ANNOTATE`（例 `tool:shape,shape:arrow:0:100x700-300x650,width:3,color:#d92c2c,pen:0:100x500,120x480,150x510,undo,redo,save`）で、描いたものの kind・線幅・色・rect・dirty・履歴・保存後の `/Annots`・開き直し後の `importedShapes`（`rotated.pdf` でも）を JSON で出す。開発ツリーと配布物の両方 |

---

## 完了の判定

1. 注釈モードでレールの「図形」「ペン」が押せ（ノートは灰色）、右パネルに「図形の種類」「線の太さ」の行が出る（モックのとおり）
2. 図形の道具で紙をドラッグすると矩形・楕円・直線・矢印が描け、Shift で正方形・正円・45° 刻みになる。押して離すだけでは作らない
3. ペンでなぞると線が引け、点が間引かれる（1,000 点級のなぞりが 100 点以下）
4. 描いたものを押すと枠とプロパティ（種類・色・線の太さ・ページ）が出て、色と太さを変えられ、掴んで動かせ、Delete で消える
5. Ctrl+Z／Ctrl+Y で描画・移動・色・太さ・削除が戻り、ページ編集と交互に行っても順に戻る。タブの点と「変更あり」が連動する
6. 色・太さ・図形の種類の最後の値が `settings.json` に残り、次回起動で戻る
7. 上書き保存すると `/Annots` に `/Square`・`/Circle`・`/PolyLine`（`/Vertices`・`/LE`）・`/Ink`（`/InkList`）が `/AP /N`・`/BS /W`・`/C` 付きで書かれ、開き直しても同じ位置・太さ・色で見え、自分で描いたものは選んで直せる
8. 他のツールの `/Line` は表示のみ（pdf.js が描き、押しても選べない）。他のツールの Square／Circle／Ink は選んで消せる
9. `/Rotate 90` のページ・ページ編集で回したページでも、描いた位置に保存され、開き直しても同じ位置に見える
10. 印刷のプレビューに未保存の図形が映る。PDF→画像には映らない（注意書きのまま）
11. `npm test` が緑（`TZ=UTC` でも）。`npm run dist` の配布物でも `SIGK_SMOKE=1` と `SIGK_SMOKE_ANNOTATE` が通る
12. 保存した PDF を他のビューアで開き、図形・矢印・線が同じ位置・太さ・色で見える（**ユーザーの目視**）

### 人が目で確かめる手順

- 画面の見た目が `screenshots/phase4-shapes-ink.png`・`-selected.png` と揃っていること。
- マウスで矩形・楕円・直線・矢印・ペンを描き、描いている途中の形が指に付いてくること。Shift で正方形・正円・水平になること。
- 保存した PDF を他のビューアで開き、図形が同じ位置・太さ・色で見え、矢じりが終点にあること。
- 他のツールで付けた図形が今までどおり見えていること（`/Line` は選べないこと）。

---

## ユーザーの確定

### 着手前（2026-09-17。`docs/07` 決定36）

1. 着手する塊は塊③（ロードマップの順序どおり）
2. 塊①の目視（`spec-4-1` 判定10）と塊②の目視（`spec-4-2` 判定11）はまだ → 持ち越し
3. 到達点は塊③まるごと（事前調査 → モック → 仕様書と論点の確定 → 実装 → 完了判定 → 配布物の起動確認 → push。PR は指示待ち）

### モック（2026-09-17。`docs/07` 決定37）

4. モックのとおり（案のまま確定）: レールの「図形」「ペン」を有効に・右パネルに「図形の種類」（4 つの切り替え。道具を持っていて
   何も選んでいないときだけ）と「線の太さ」（`<select>`）の行・描いている途中は確定後と同じ見た目・選ぶと破線の枠
   （`screenshots/phase4-shapes-ink.png`・`phase4-shapes-ink-selected.png`）

### 事前調査後（2026-09-17。`docs/07` 決定37。8件とも起草者の推し。括弧内は採らなかった代替）

5. 論点1 線の太さはプリセット 5 段（1・2・3・5・8pt）の `<select>`。既定 2pt。図形とペンで共通。`ui.annotLineWidth` に覚える（自由な数値入力／3 段）
6. 論点2 色は図形・ペンとも赤・青・緑・黒の 4 色、既定 赤。最後に使った色は図形とペンで別々に覚える（既定を青／下線と同じ 3 色）
7. 論点3 塗りつぶしは無し（枠線のみ。`/IC` を書かない）（塗りの有無の切り替え）
8. 論点4 「図形の種類」は最後に使った種類を `ui.annotShapeKind` に覚える。初めては矩形（毎回矩形から）
9. 論点5 直線・矢印は 2 点の `/PolyLine` で書く。自分で描いたものも既存の Square／Circle／Ink／2 点 PolyLine も読み込んで直せる。
   他のツールの `/Line` は表示のみ（`/Line` で書いて保存後は表示のみ／`/Line` で書いて向きを `/Rect` の余白に埋め込む）
10. 論点6 矢じりは終点に開いた矢じり（`/LE [/None /OpenArrow]`）（塗った三角）
11. 論点7 ペンは 1 回のなぞり＝1 つの注釈。点は自前の距離しきい値と Douglas–Peucker で間引く（短い間隔のなぞりをまとめる／`simplify-js` を足す）
12. 論点8 描いたあとの大きさの変更（ハンドル）は無し。動かすだけ（4 隅のハンドル）

### 起草者の判断で決めたもの

- Shift で正方形・正円・45° 刻み（確定事項4）
- 当たり判定: 矩形・楕円は箱の内側、直線・矢印・ペンは線分からの距離 `線幅/2 + 3px相当`（確定事項12）
- 最小の大きさ: `CLICK_SLOP`（3px）以下のドラッグは作らない。矩形・楕円の辺は最低 1pt（確定事項3・9）
- 不透明度は 1 固定（`/CA 1`。プロパティの不透明度は塊④の一覧と一緒に）
- 描いた直後にその図形を選ぶ（続けて色・太さを直せる）。「図形の種類」は描いた図形には効かない（確定事項3・7）
- 矢じりの寸法（翼 `max(9pt, 線幅×6)`・開き 30°）、楕円の κ 0.5523、丸い端と角、矩形は角のまま（確定事項8・30）
- ペンの間引きの値: 描きながら 2px、離したとき許容 1px（表示の px。確定事項6）
- `/AP /N` を必ず書く。`/Rect` の取り方（確定事項10・21・22）
- 読み込みで拾う範囲（`/C` 無し・2 点未満・3 点以上の PolyLine は拾わない。確定事項13）
- 差し込んだページには「差し込んだページには保存後に付けられます」の帯（塊①と同じ）。暗号化 PDF は付けられるが保存は断る
- モジュールの切り方と名前（「足りない部品」）。起動確認の操作列

---

## 未確定のまま残すもの

| 項目 | 扱い |
|---|---|
| 他のツールの `/Line`（直線・矢印） | 表示のみ（pdf.js が描く）。選択・削除・編集はできない。**塊④の注釈一覧から「表示のみ」の注釈も消せるようにする**候補（消すのに向きは要らない） |
| 3 点以上の PolyLine・Polygon・雲形・引き出し線 | 表示のみ |
| 大きさの変更（ハンドル）・回転・複数選択 | 非対応（消して描き直す）。要望が出たら塊④以降 |
| ペンの平滑化・筆圧・なぞりのまとめ | 非対応（折れ線。1 回のなぞり＝1 つ）。手書きの文字を 1 つとして動かしたいときは塊④の一覧で複数選択 |
| 塗りつぶし・破線・不透明度 | 非対応（不透明度は塊④で一覧と一緒に） |
| 他のビューアで直線・矢印を編集すると | PolyLine として扱われる（頂点の編集）。矢じりの `/LE` は保たれる |
| pdf.js の `Float32Array` による座標の丸め | 読み込みで小数 2 桁に丸める（0.01pt 級。見た目に出ない） |
| 差し込んだページ・暗号化 PDF・サムネイル・PDF→画像 | 塊①と同じ |

---
