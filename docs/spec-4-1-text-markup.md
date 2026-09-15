# 仕様書: Phase 4 塊① 注釈の土台＋ハイライト・下線・取り消し線

起草日: 2026-09-15
ステータス: **確定**（2026-09-15 確定。着手前の3件（`docs/07` 決定32）・モックの1件・事前調査後の論点8件は同日ユーザーが決定。
末尾「ユーザーの確定」を参照。残る細部は起草者の推しで書き、その一覧を「起草者の判断で決めたもの」に置いた）
関連: `docs/05_開発ロードマップ.md` Phase 4（4-2）／`docs/01_製品要件定義.md` F-05-1・F-05-2・F-05-7（一部）／
`docs/04_UI設計.md` 4-3・第8章・第9章・第10章 未確定事項4／`docs/02_アーキテクチャ設計.md` 2-3（保存の形）・第3章／
`docs/spec-1-3-reading.md`（テキストレイヤー）／`docs/spec-1-5-page-edit.md`（plan・履歴・dirty）／
`docs/spec-1-6-save.md`（保存の経路・保存後の状態。**本書で確定事項27〜29 を改める**）／
`docs/spec-1-4-find-print.md`（印刷の描画経路）／`docs/spec-3-3-pdf-to-image.md`（`page-image.js`）

---

## 目的

Phase 4「注釈・テキスト・透かし」の最初の塊。**文字を選んでハイライト・下線・取り消し線を付け、色を選び、
消し、元に戻し、保存すると PDF 標準の注釈として書かれる**（F-05-1・F-05-2）。他のビューアでも同じ位置に同じ色で
見える。

この塊で作るのは「注釈の土台」でもある。注釈をどこに持つか（どのページに何を付けたか）・undo・dirty・保存の形
（`/Annots` と外観 `/AP`）・画面の層（紙の上に重ねる SVG）・プロパティの置き場は、塊②〜④の注釈（フリーテキスト・
図形・フリーハンド・ノート）がそのまま載る共通部分である。フォントの同梱が要らないテキストマークアップで先に固める
（`docs/07` 決定32 ②）。

---

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| 注釈モードの道具（ツールレールの下）: ハイライト・下線・取り消し線。塊②〜④の道具は灰色の位置取りだけ | フリーテキスト・図形・フリーハンド・ノート（塊②〜④） |
| 文字を選んで付ける（道具を持ってなぞる／先に選んでから道具を押す）。付いたら選択は解除 | 注釈一覧（塊④。サイドパネルは閲覧モードと同じサムネイル 1 列） |
| 選ぶ・色を変える・Delete で消す・Esc で解除。Ctrl+Z／Ctrl+Y はページ編集と 1 本の履歴 | 自由な色・不透明度・線幅の欄（プリセットのみ。塊④のプロパティで広げる） |
| プロパティは右パネル 260px に固定（ユーザー確定 2026-09-15。モック `screenshots/phase4-annotate-props-panel.png`） | 注釈への本文（`/Contents`）・作者（`/T`）・返信・ポップアップ |
| 既存 PDF のハイライト・下線・取り消し線を読み込み、選択・色変更・削除できる（論点2） | 既存 PDF の他の注釈の編集（表示のみ。pdf.js の既定描画のまま） |
| 保存: `/Annots` に `/Subtype /Highlight|/Underline|/StrikeOut`・`/QuadPoints`・`/Rect`・`/C`・`/CA`・`/F 4`・**`/AP /N`（外観）**を書く。抽出にも付いていく | 差し込んだページ（`{ insert }`）への注釈（保存して開き直せば付けられる。既知の限界） |
| 印刷に未保存の注釈が映る（論点7） | PDF→画像（読み直して描くので未保存の編集は映らない。`spec-3-3` 確定事項1 のまま） |
| **保存後の基準の直し**（事前調査 F の不具合。論点1） | 縦書き・回転した文字列への正確な箱（矩形の外接で近似。既知の限界） |
| 回転したページでテキストレイヤーがずれる不具合の直し（事前調査 D の発見） | パスワード付き PDF の保存（付けられるが保存は断る。`spec-1-6` 確定事項12 のまま） |
| 起動確認 `SIGK_SMOKE_ANNOTATE` | 最後に使った道具を覚えること（色は覚える。論点5） |

---

## 事前調査（2026-09-15・Windows 11 実機・Electron 44・pdf.js 6.3.289・pdf-lib 1.17.1・fixtures のみ）

プローブは scratchpad の使い捨て（Node で pdf-lib を回すもの、Chromium で pdf.js を回すもの）。検体は `test/fixtures/` の
`text-heavy.pdf`・`huge-pages.pdf`・`mixed-size.pdf` と、それに pdf-lib で注釈・CropBox・回転を足したもの。記録後に捨てた。

### A. pdf.js は既存の注釈をどう描き、何を返すか

- 既定の `AnnotationMode.ENABLE` で、Highlight／Underline／StrikeOut は **`/AP` があってもなくても canvas に描かれる**
  （`/AP` が無いものは pdf.js が既定の外観を作る。ハイライトは multiply）。
- `page.getAnnotations()` は `id`（`"86R"` の形。オブジェクト番号）・`subtype`・`rect`・`quadPoints`（**正規化済み**。四角ごとに
  `[x1, yTop, x2, yTop, x1, yBottom, x2, yBottom]` の `Float32Array`）・`color`（0〜255 の RGB）・`opacity`（**Highlight だけ**。
  Underline／StrikeOut は `/CA` を返さない）・`hasAppearance`・`isEditable`（Highlight だけ真）・`modificationDate`・`contentsObj`
  を返す。**`/NM` は返さない。**
- 注釈の無いページの `getAnnotations()` は 0.1〜0.9ms。1,000 ページを順に回して 89ms。注釈のあるページは初回 37ms（外観の解析込み）。

### B. 既存の注釈を個別に隠せるか — ① が効く

| 手 | 結果 |
|---|---|
| ① `annotationMode: ENABLE_STORAGE` ＋ `doc.annotationStorage.setValue(id, { noView: true })` | **効く。**3 種とも、`/AP` の有無を問わず消える。`annotationStorage.remove(id)` で戻る。`ENABLE` で描けば storage を見ないので元どおり（描画のキャッシュは intent ごとに別）。`noPrint` も同じ経路で印刷 intent に効く |
| ② `page.render({ isEditing: true })` | **使えない。**pdf.js が「編集できる」と見なす注釈を全部隠す。Highlight は全部消え（他人のものも `/AP` 付きも）、Underline／StrikeOut は残る |

これで「既存のテキストマークアップを自前の層で描き直し、選択・色変更・削除できる」が安く成立する（論点2）。

### C. pdf-lib で `/Annots` に書く

- `context.obj({...})` の辞書に `Type/Subtype/Rect/QuadPoints/C/CA/F/NM/P/Contents/M` と `AP: { N: <Form XObject> }` を入れ、
  `context.register` した参照をページの `/Annots` 配列へ足す（無ければ作る）。`/AP /N` は `context.stream(content, { Type: 'XObject',
  Subtype: 'Form', FormType: 1, BBox: rect, Resources: { ExtGState: { GS: { BM: 'Multiply', CA, ca } } } })`。
  `page.node.addAnnot()` は使わない（`normalize()` が content stream を q/Q で包み直すため。`inserted-annotations.js` と同じく直接触る）。
- pdf.js で読み返すと `hasAppearance: true`・色・quadPoints・opacity が書いたとおりに返る（A の検体はこれで作った）。
- **冪等な保存**: 「`/NM` が自分のものを外してから足し直す」を 3 回繰り返して、`/Annots` の数（3）・オブジェクト数（90）・
  ファイルサイズ（41,658 bytes）が動かない。外した辞書と外観は `context.delete(ref)` で消す（消さないと孤児が残り毎回増える）。
- 1,000 ページ級の保存時間（`huge-pages.pdf`。load 240ms は共通）:

| 注釈 | apply | save | 出力 |
|---|---|---|---|
| なし | 1ms | 649ms | 252KB |
| 100 ページ × 1（ハイライト） | 6ms | 825ms | 281KB |
| 1,000 ページ × 1 | 17ms | 1,532ms | 535KB |
| 1,000 ページ × 5（下線。5,000 個） | 103ms | 4,780ms | 1,785KB |

  **1 個あたり約 0.8ms・約 290 bytes。**常用の数十〜数百個なら体感できない。

### D. 座標 — 選択範囲から QuadPoints へ

- `Range.getClientRects()` を `.pdf-page` の `getBoundingClientRect()` 基準の CSS px にし、四隅を `viewport.convertToPdfPoint()` で
  pt にする。**横の範囲は `getTextContent()` の `items[].transform`・`width` と 0.1pt 以内で一致した**（倍率 0.5／1／1.5／2、
  CropBox がずれたページ、MediaBox の原点がずれたページ、`/Rotate 90`・`270` のページ、表示側の回転 90／180／270 のすべて）。
  部分選択（3〜12 文字目）も倍率を変えて ±0.1pt。
- **縦の範囲はブラウザの文字の箱に依存する。**span の高さは `line-height: 1` でもフォントの content area で決まり、標準 14 書体の
  代替 `sans-serif`（この機では 1.42em）では 9pt の文字に 12.8pt の箱が付く（行送り 13pt の本文でほぼ隣に触れる）。
  `getTextContent()` の `styles[fontName].ascent / descent`（Helvetica で 0.718 / −0.207）から `baseline ± ascent·size` で作ると
  8.3pt の箱になり、他のビューアの作る箱と同じ見た目になる。**横は DOM、縦はフォントから**が推し（確定事項12）。
- **発見: アプリのテキストレイヤーは回転したページで位置がずれている。**pdf.js 6 の `TextLayer` は span を回転前の座標に置き、
  層全体を `data-main-rotation` 属性と CSS（`[data-main-rotation="90"]{ transform: rotate(90deg) translateY(-100%) }` ほか 3 本。
  `pdf_viewer.css` 6237〜6245 行）で回す。`renderer/text-layer.css` にはこの 3 本が無く（`.textLayer` ブロックだけを写した。
  `spec-1-3` 確定事項18）、`page-render.js` が回転済みの viewport を渡しても層は回らない。プローブで 3 本を足すと上の一致が得られた。
  本書で足す（確定事項31）。
- `layer.textDivs[i]` は `getTextContent().items` のうち `str !== undefined` のもの（`hasEOL` だけの空文字も含む）と 1 対 1 で並ぶ。
  span から item（`transform`・`fontName`・`width`）を引くのにこれを使う。

### E. 未保存の注釈を印刷に映せるか — 映せる

canvas 2D に `globalCompositeOperation = 'multiply'` で四角を塗る／線を引くだけで、6 個で 6ms。`page-image.js` の
`renderToCanvas` に「描いたあとに呼ぶ口」を 1 つ足せば、印刷（`print.js`）が同じ絵を得る（確定事項28）。

### F. 発見: 保存後の 2 回目の保存で並びと回転が二重に当たる（既存の不具合）

`spec-1-6` 確定事項27・29 は「保存後は開き直さず、plan もそのまま（連番へ振り直さない）」とし、`savedPlan` は dirty の判定に
だけ使っている。ところがワーカーは**保存先のファイルを読んで plan を当てる**ので、2 回目の保存で plan がもう一度当たる。
ワーカー（`runTask`）で再現した:

| 操作 | 画面 | ファイル |
|---|---|---|
| `mixed-size.pdf`（A4・A5・A4）を [2,1,3] に並べ替えて保存 → 先頭を 90 度回して保存 | A5@90・A4・A4 | **A4@90・A5・A4** |
| 先頭を 90 度回して保存 → 3 ページ目を削除して保存 | A4@90・A5 | **A4@180・A5** |

回転は相対（`resolveRotations` が元の `/Rotate` に足す）なので 90 → 180 になり、並べ替えは 2 回当たる。編集 → 保存 → 編集 → 保存
の順に使うと必ず起きる。注釈も `src`（ページ番号）で持つので同じ穴に落ちる。**本書の実装で直す**（論点1。確定事項20）。

---

## 確定事項

### A. 注釈モードの画面（`docs/04` 4-3・ユーザー確定 2026-09-15 案A）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 道具の置き場 | ツールレールのモード 4 つの下に区切り線を引き、**ハイライト・下線・取り消し線**を同じ意匠（アイコン 21px＋ラベル 10.5px）で並べる。テキスト・図形・ペン・ノートは灰色（`aria-disabled`）で位置だけ置き、塊②〜④で生かす。道具はトグルで、押している間は `.active`（縦棒は出さない。モードと区別する） |
| 2 | 道具が出るとき | 注釈モードのときだけ（`html[data-mode="annot"] .rail-item.tool` で表示）。他のモードではレールはこれまでどおり 4 つ |
| 3 | サイドパネル | **閲覧モードと同じサムネイル 1 列**（題名「サムネイル」）。注釈一覧は塊④で入れ替える。`thumbnails.isVisible()` に `annot` を足す |
| 4 | プロパティ | **右パネル 260px に固定**（未確定事項4 の決着。モックで案A を確定）。**注釈モードの間は常に出す**（注釈を選んでいないときは「次に付ける注釈」の種類と色を見せる。出たり消えたりして紙の幅が動くのを避ける）。欄: 種類／色（プリセットの丸）／ページ／対象の文字（自前で付けたものだけ。読み込んだものは出さない）／ヒント／「この注釈を削除」 |
| 5 | 紙の上の層 | `.pdf-page` の中、canvas の**あと・テキストレイヤーの前**に `<svg class="annot-layer">` を置く（DOM 順: canvas → svg → textLayer）。`pointer-events: none`。ハイライトは `mix-blend-mode: multiply` の多角形、下線・取り消し線は `<line>`。選択中の注釈は破線の枠（`--accent`）を重ねる。テキストレイヤーが上にあるので**文字の選択はどこでもできる** |
| 6 | 選ぶ | テキストレイヤーの上で**ドラッグせずに押して離した**とき（選択範囲が空のまま）、その点を含む注釈（quads の当たり判定。上に描いたものが優先）を選ぶ。無ければ選択解除。選ぶと枠とプロパティが出る |
| 7 | キー | Delete＝選んだ注釈を消す（注釈モードのとき。`handlePageEditKey` の Delete がページモード限定なのと同じ形で注釈モード限定）。Esc＝選んだ注釈があれば解除、無ければ道具を離す（検索バーが開いていればそちらが先。`spec-1-4` 確定事項19）。Ctrl+Z／Ctrl+Y＝どのモードでも最後の編集を戻す・やり直す（確定事項15） |
| 8 | モードを離れるとき | 注釈の選択を解除する。道具はそのまま持ち越す（戻ったときに同じ道具）。閲覧モードでは道具があっても付かない |
| 9 | パスワード付き PDF | 注釈モードに入った時点で帯「パスワードで保護された PDF は保存できません。」（`save.warnIfUnsaveable`。ページモードと同じ）。付けることはできる |

### B. 付け方と座標（F-05-1・事前調査 D）

| # | 項目 | 決定 |
|---|---|---|
| 10 | 付ける操作 | 2 通り（論点6）。**①道具を持ってなぞる**: 道具が active のとき、テキストレイヤーで `mouseup` した時点の選択範囲が空でなければ注釈を作り、選択を解除する。**②先に選んでから道具を押す**: 道具を押した時点で選択範囲があれば作って選択を解除し、道具は active になる。どちらも 1 回の操作で 1 世代（確定事項15） |
| 11 | 範囲の切り方 | 選択範囲（`Range`）が触れる `textDivs[i]` ごとに部分 `Range` を作り、`getClientRects()` を `.pdf-page` 基準の CSS px にして `viewport.convertToPdfPoint()` で pt の四隅にする。**ページをまたぐ選択は、ページごとに 1 つの注釈**（PDF の注釈は 1 ページに属する） |
| 12 | 四角の高さ | 横（文字の進む方向）は DOM の矩形から、縦は item の `baseline ± ascent·size / descent·size`（`styles[fontName]` の値。無ければ 0.8／−0.2）から作る。文字が回転している（`transform` の角度が 0 でない）span と `vertical` なフォントは DOM の四隅をそのまま使う（外接矩形の近似。既知の限界）。四角は **UL・UR・LL・LR** の順（他のビューアの読み方に合わせる）。行ごとに 1 四角。`/Rect` は四角の外接 |
| 13 | 同じ行の結合 | 同じ item を細切れに選んでも四角は 1 つ（`Range` が item 単位に切れるため自然にそうなる）。隣り合う span（同じ行の続き）は別の四角のまま（重ねても見た目は変わらない。ビューアの互換のために単純さを取る） |
| 14 | 空の選択・文字の無い場所 | 何もしない。画像だけのページでは付かない（テキストレイヤーが無い）。既知の限界として書く |

### C. 注釈の持ち方と履歴（`spec-1-5` の plan と同じ型）

| # | 項目 | 決定 |
|---|---|---|
| 15 | 1 本の履歴 | ページ編集と注釈は **1 本の履歴**（論点3）。世代のスナップショットを `plan` から **`{ plan, annots }`** に広げる。`renderer/page-history.js` は `renderer/edit-history.js` に改名し、`SigK.editHistory`。`page-edit.commit(plan, …)` は現在の `annots` を添えて積み、`annotate.commit(annots, …)` は現在の `plan` を添えて積む。Ctrl+Z はモードを問わず最後の操作を戻す（ページ編集の確定事項55 と同じ理屈） |
| 16 | 注釈の状態 | `annots = { added: [...], removed: [...] }`。**ファイルとの差分**として持つ（plan が「元の並びに対する結果」であるのと同じ考え）。`added[]` は自前の注釈 `{ id, src, kind, color, opacity, quads, rect, text }`（`id` は `sigk-<time36>-<n>`、`src` は元ページ番号、`kind` は `'highlight' | 'underline' | 'strikeout'`、`color` は `#rrggbb`、`quads` は `[[8 数値], …]`、`rect` は `[x1, y1, x2, y2]`、`text` は選んだ文字の先頭 200 字）。`removed[]` は読み込んだ注釈の `ref`（`"86R"`）の並び |
| 17 | 読み込んだ注釈 | `imported[src] = [{ ref, src, kind, color, opacity, quads, rect }]`。文書を開いたときに **全ページ `getAnnotations()`**（1,000 ページで 0.1 秒。事前調査 A）で集め、`imported` は**履歴に入れない**（ファイルの中身であり、編集ではない）。読み込んだ注釈の色を変える＝`removed` に `ref` を足し、写しを `added` に足す。消す＝`removed` に足す |
| 18 | 描画 | ページ `src` の層には `imported[src]` のうち `removed` に無いものと、`added` のうち `src` が一致するものを描く。**読み込んだテキストマークアップは pdf.js に描かせない**: 描く前に `annotationStorage.setValue(ref, { noView: true })` を全部に入れ、`page.render({ annotationMode: ENABLE_STORAGE })` にする（事前調査 B ①）。他の注釈（Link・Widget・FreeText…）は pdf.js が従来どおり描く |
| 19 | dirty | `!samePlan(plan, savedPlan) || !sameAnnots(annots, savedAnnots)`。`sameAnnots` は `added` の `id` 列と `removed` の列の比較。タブごとの session に `annots`・`savedAnnots`・`imported` を載せ、`detach()/attach()` で持ち回る |
| 20 | **保存後の基準（論点1）** | **保存に成功したら、保存先のファイルを開き直す**（`spec-1-6` 確定事項27・28・29 を改める）。開き直しは `viewer.reopen()` で、倍率・「幅／全体」・見開き・現在ページ・スクロール位置・サイドパネルの位置を保ったまま `state.doc` を差し替える（画面を空にしない。見えているページだけ描き直す）。開き直した時点で `plan` は連番、`inserts` は空、`annots` は空、`imported` は読み直し、履歴は 1 世代目から（**保存後は Ctrl+Z で保存前へ戻れない**）。これで「ファイルの中身＝基準」が常に成り立ち、2 回目の保存で plan が二重に当たる不具合（事前調査 F）と、注釈の `/NM` による冪等化・セッションの札が要らなくなる |
| 21 | 抽出 | 抽出の spec にも `annotations` を添え、選んだページに付いた注釈（読み込んだものの削除・色変更も含む）が抽出先に付いていく。抽出後の画面は変わらない（`spec-1-5` 確定事項60 のまま） |

### D. 保存の形（`docs/02` 2-3 を実態へ）

| # | 項目 | 決定 |
|---|---|---|
| 22 | spec | `saveSpec` の `ops: []` を **`annotations: { add: [...], remove: [...] }`** に置き換える（`ops` は誰も読んでいなかった。`docs/02` 2-3 の `{ type: 'annotate' }` の形は本書で塗り替える）。`add[]` は `added[]` から `id`・`text` を落としたもの。`remove[]` は `removed[]` |
| 23 | 当てる順 | `applyForSave`／`applyForExtract` とも **`readLabels` → `prepareInserts` → `applyAnnotations`（本書） → `applyPlan`（または抽出の複製）→ …**。注釈は `src`＝ワーカーが読んだ文書のページ番号で当てるので、並べ替えの前に当てる。削除されたページの注釈は当てても捨てられる。`src` の範囲外・`kind` 不明・`quads` の形が違うものは `{ error }` で断る（`validatePlan` と同じ流儀） |
| 24 | 消す | `remove[]` の `"86R"` をオブジェクト番号（と世代）に読み、そのページの `/Annots` から外す。`/Popup` を持っていればそれも外す。外した辞書・外観・ポップアップは `context.delete()` で消す。無いものは黙って飛ばす（保存後に開き直すので、二重の削除は起きない） |
| 25 | 足す | 辞書: `/Type /Annot`・`/Subtype`・`/Rect`・`/QuadPoints`（UL・UR・LL・LR）・`/C`（0〜1 の RGB）・`/CA`・`/F 4`（印刷される）・`/NM sigk-…`・`/P`・`/M`（保存時刻）・`/Contents ()`。**`/AP /N` を必ず書く**（論点4 は起草者判断で確定。他のビューアが既定の外観を作らなくても見えるように）。ハイライト: `/ExtGState << /BM /Multiply /CA ca /ca ca >>` で四角を塗る。下線: 四角の下辺から `h/14`（最小 0.5pt）上に太さ `h/14` の線。取り消し線: 四角の中央に同じ太さの線。BBox は `/Rect` |
| 26 | 純関数 | `worker/annotation-appearance.js` が content stream の文字列と BBox を作る（テストは文字列の比較）。`worker/op-annotate.js` が消す・足すを行う（`pdf-tree-reader.js` の `pick` と `inserted-annotations.js` の作法） |
| 27 | 上限 | 置かない（1 個 0.8ms・290 bytes。5,000 個で +4 秒。事前調査 C） |

### E. 印刷・PDF→画像（論点7）

| # | 項目 | 決定 |
|---|---|---|
| 28 | 印刷 | **未保存の注釈が映る。**`page-image.renderToCanvas(doc, page, { scale, rotation, annotationMode, overlay })` に `overlay(ctx2d, viewport)` を足し、`print.js` は `annotate.paintPage(src)` が返す描き手を渡す（canvas 2D で multiply の四角・線）。読み込んだテキストマークアップを二重に描かないよう、印刷の描画も `ENABLE_STORAGE`（`noView` は文書を開いたとき全ページ分入れてある。確定事項17） |
| 29 | PDF→画像 | 映らない（読み直して描く。`spec-3-3` 確定事項1 の注意書きのまま）。保存してから画像にする |
| 30 | サムネイル | 映さない（第1版。サムネイルは pdf.js の描画そのままで、読み込んだテキストマークアップも pdf.js が描く＝見た目は一致する。自前の注釈が映らないのは既知の限界。塊④で注釈一覧が入れば要らない） |

### F. 既存の不具合の直し（事前調査 D・F）

| # | 項目 | 決定 |
|---|---|---|
| 31 | 回転したページのテキストレイヤー | `renderer/text-layer.css` に `[data-main-rotation="90|180|270"]` の 3 本を足す（出典を `pdf_viewer.css` 6237〜6245 行と明記）。`spec-1-3` 確定事項18 の「写した範囲」に追記 |
| 32 | 2 回目の保存 | 確定事項20 のとおり。`spec-1-6` の確定事項27〜29 に「2026-09-15 改訂」を書く |

### G. 色と意匠（論点5・`docs/06` の商標ルール）

| # | 項目 | 決定 |
|---|---|---|
| 33 | プリセット | ハイライト: 黄 `#ffe45a`・緑 `#8ce99a`・青 `#8fbfff`・桃 `#ffa8c8`。下線・取り消し線: 赤 `#d92c2c`・青 `#2c5cd9`・黒 `#1c2430`。既定はハイライト黄・下線赤・取り消し線赤。自由な色は塊④ |
| 34 | 覚える | 種類ごとに最後に使った色を `settings.json` の `ui.annotColors`（`{ highlight, underline, strikeout }`）に覚える（`DEFAULTS → mergeDefaults → pickUi/mergeUi → persist` の経路。値はプリセットに無ければ既定へ戻す）。道具は覚えない |
| 35 | 不透明度 | ハイライト 1（multiply で文字が透ける）、線 1。欄は出さない。読み込んだハイライトの `opacity` はそのまま使う（線は 1 と見なす。pdf.js が返さない） |
| 36 | アイコン | `assets/icons.js` に `highlight`（帯＋文字 2 本）・`underline`（文字 2 本＋太い下線）・`strikeout`（文字 2 本＋太い横線）・`text`・`shape`・`pen`・`note`（位置取り用）・`trash`（既存の `trash` があればそれ）。幾何形状のみ。モックで形は決めた |
| 37 | 選択の枠 | 四角群の外接に 3px の余白を取った破線（`--accent`、`stroke-dasharray: 4 3`、角丸 3px） |

---

## 足りない部品

### 新しいモジュール

| ファイル | 層 | 役目 |
|---|---|---|
| `renderer/annotation-state.js` | 純関数 | `createAnnots()`・`addAnnot`・`removeAnnot`（自前は `added` から外す、読み込みは `removed` に足す）・`recolorAnnot`・`cloneAnnots`・`sameAnnots`・`annotsOnPage(annots, imported, src)`・`newId()` |
| `renderer/markup-quads.js` | 純関数 | `quadsFromRects(rects, viewport)`・`quadFromItem(rectPt, item, style)`・`unionRect(quads)`・`normalizeQuad`（UL・UR・LL・LR に並べ直す）・`hitTest(quads, point)` |
| `renderer/markup-selection.js` | 画面 | `Selection` → ページごとの `{ src, quads, rect, text }`（テキストレイヤーの `textDivs`・items・viewport を使う。`text-layer.js` の handle 経由） |
| `renderer/annotation-layer.js` | 画面 | `.pdf-page` の SVG。`mount(node, viewport)`・`draw(annots, { selected })`・`paint(ctx2d, viewport, annots)`（印刷用。canvas 2D） |
| `renderer/annotate.js` | 指揮 | 道具・作成・選択・削除・色変更・`commit`・キー・モードの出入り・`importDocument(doc)`・`paintPage(src)`・`capture()/restore()` |
| `renderer/annotation-props.js` | 画面 | 右パネル（種類・色の丸・ページ・対象の文字・ヒント・削除） |
| `worker/annotation-appearance.js` | 純関数 | `appearanceOf(kind, quads, rect, color, opacity)` → `{ content, bbox, blend }` |
| `worker/op-annotate.js` | ワーカー | `applyAnnotations(doc, { add, remove }, TOOLS)` → `{ ok, added, removed }`／`{ error }` |

### 既存への追記・改名

| ファイル | 変更 |
|---|---|
| `renderer/page-history.js` → `renderer/edit-history.js` | スナップショットを `{ plan, annots }` に。`SigK.pageHistory` → `SigK.editHistory`。`test/page-history.test.js` → `test/edit-history.test.js` |
| `renderer/page-edit.js` | `commit` が `annots` を添える。`step` が `viewer.applyPlan` と `annotate.apply` の両方を呼ぶ。`reset/capture/restore` に注釈が乗る |
| `renderer/viewer.js` | session に `annots`・`savedAnnots`・`imported`。`isDirty()`・`markSaved()`・`detach()/attach()`・`resetView()`。**`reopen()`**（確定事項20）。`getAnnotations()`・`setAnnotations()` |
| `renderer/tabs.js` | `isTabDirty()` が注釈も見る |
| `renderer/page-render.js` | canvas のあとに `annotationLayer.mount`。`page.render` に `annotationMode: ENABLE_STORAGE`。`releasePage` で層も捨てる |
| `renderer/text-layer.js` | handle に `viewport`・`items()`・`styles()` |
| `renderer/text-layer.css` | 回転の 3 本（確定事項31） |
| `renderer/page-image.js` | `renderToCanvas` に `annotationMode`・`overlay` |
| `renderer/print.js` | `overlay` を渡す |
| `renderer/save.js`・`renderer/extract.js` | spec に `annotations`。保存成功後に `viewer.reopen()`（`markSaved` の代わり。名前を付けて保存ではタブの移動のあと） |
| `renderer/shell.js` | `setMode` で注釈の選択解除・プロパティの出し入れ・帯（確定事項8・9）。`MODE_TITLES.annot` は「サムネイル」（塊④で「注釈」へ） |
| `renderer/thumbnails.js` | `isVisible()` に `annot` |
| `renderer/viewer-controls.js` | Delete・Esc の注釈モード分岐（確定事項7） |
| `worker/pdf-task.js` | `TOOLS` に `PDFRef`・`PDFArray`・`PDFString`・`PDFNumber`。`applyForSave`／`applyForExtract` で `applyAnnotations`（確定事項23） |
| `settings.js` | `DEFAULTS.ui.annotColors`・`pickUi/mergeUi` |
| `index.html`・`renderer/shell.css`・`assets/icons.js` | レールの道具 7 つと区切り、右パネル `#props`、`<script>` 6 本、意匠、アイコン 8 つ |
| `renderer/app.js` | `annotate.init`・`annotationProps.init` |
| `main.js` | 起動確認 `SIGK_SMOKE_ANNOTATE` |
| `test/harness.js` | `createPdfjsStub` に `AnnotationMode`・`annotationStorage`・`getAnnotations`、`Range.getClientRects` の擬似、`settingsAPI.setUi` の `annotColors` |
| `docs/02`・`docs/04`・`docs/05`・`docs/07`・`spec-1-3`・`spec-1-6`・`README.md` | 現在地・保存の形・未確定事項4 の決着・改訂 |

ルート直下にモジュールは足さない（`package.json` の `build.files` は変わらない。`test/dist-files.test.js` が見張る）。
依存は増えない。`THIRD-PARTY-NOTICES.md` の追記は無い。

---

## テストの範囲

| 層 | 対象 |
|---|---|
| 依存なし | `annotation-state.js`（追加・削除・色変更・`sameAnnots`・複製・ページごとの取り出し）、`markup-quads.js`（CSS px → pt の四隅、UL・UR・LL・LR の並べ直し、item からの高さ、外接、当たり判定、回転した viewport）、`worker/annotation-appearance.js`（3 種の content stream と BBox）、`worker/op-annotate.js`（fixtures に書いて pdf-lib で読み返す: `/Annots` の数・`/Subtype`・`/QuadPoints`・`/AP`・`/NM`、`remove` で消えて孤児が残らない、`/Popup` も消える、範囲外は `error`、`applyPlan` の前に当てて並べ替え後のページに付いている、抽出に付いていく）、`edit-history.js`（`{ plan, annots }` の世代）、`settings.js`（`annotColors` の既定と丸め） |
| jsdom | `annotate.test.js`（道具のトグル、選択 → 作成（両方の操作）、ページをまたぐ選択、選ぶ・解除・Delete・Esc、色変更、undo/redo がページ編集と 1 本、dirty、タブの持ち回り、モードの出入り、読み込んだ注釈の削除・色変更、`imported` が履歴に入らない、暗号化の帯）、`annotation-layer.test.js`（SVG の要素と枠、`paint` の呼び出し）、`annotation-props.test.js`、`page-render.test.js`（層の生成・破棄と `ENABLE_STORAGE`）、`text-layer.test.js`（handle の `viewport`・`items`）、`viewer.test.js`／`tabs.test.js`（`reopen` が倍率・位置を保つ、履歴が空になる、`isDirty` が注釈を見る）、`save.test.js`／`extract.test.js`（spec に `annotations`、保存後に `reopen` が呼ばれる）、`print.test.js`（`overlay` が渡る）、`shell.test.js`（レールの道具・`#props`・`<script>`・アイコン） |
| 起動確認 | `SIGK_SMOKE_ANNOTATE=<操作列>`（例 `select:1:3-4,highlight,color:green,select:1:6-6,underline,delete,undo,save`）＋ `SIGK_SMOKE_PDF`。作成した注釈の数・quads・dirty・履歴の深さ・保存後の `/Annots` の数（pdf-lib で読み返す）・回転ページ（`rotated.pdf`）で span と item の横位置が一致することを JSON で出す。開発ツリーと配布物の両方 |

---

## 完了の判定

1. 注釈モードでレールに道具 3 つ（＋灰色 4 つ）が出て、サイドパネルはサムネイル、右にプロパティが出る（モックのとおり）
2. ハイライトを持って文字をなぞると、離した瞬間に付き、選択が解除される。先に選んでから道具を押しても付く
3. 付けた注釈を押すと枠とプロパティが出て、色の丸で色が変わり、Delete で消え、Esc で解除される
4. Ctrl+Z／Ctrl+Y で注釈の作成・削除・色変更が戻り、ページの並べ替えと交互に行っても順に戻る。タブの点と「変更あり」が連動する
5. 上書き保存すると `/Annots` に `/AP` 付きで書かれ、保存後に開き直しても（アプリ・pdf.js・他のビューア）同じ位置・同じ色で見える。保存後は履歴が空で、続けて編集して保存しても二重に当たらない（事前調査 F の再現が緑）
6. 既存 PDF のハイライト・下線・取り消し線を選んで消す・色を変えることができ、保存に反映される。他の注釈はこれまでどおり見える
7. `/Rotate 90` のページ・回転したページ・CropBox のずれたページ・倍率を変えたときも、付けた四角が文字に重なる（span と item の横位置が 0.5pt 以内）
8. 印刷のプレビューに未保存の注釈が映る。PDF→画像には映らない（注意書きのまま）
9. 回転したページで文字を選んだときの選択の見た目が文字に重なる（既存の不具合の直し）
10. 保存した PDF を他のビューアで開き、色・位置・文字の透け方（multiply）が正しい（**ユーザーの目視**）
11. `npm test` が緑で、`npm run dist` の配布物でも `SIGK_SMOKE=1` と `SIGK_SMOKE_ANNOTATE` が通る

### 人が目で確かめる手順

- 画面の見た目が `screenshots/phase4-annotate-props-panel.png` と揃っていること。
- 実物の PDF（埋め込みフォント・日本語）で文字をなぞり、保存して他のビューアで開き、四角が文字に重なっていること。
- 既存の注釈（他のアプリで付けたハイライト）を消して保存し、他のビューアで消えていること。

---

## ユーザーの確定

### 着手前（2026-09-15。`docs/07` 決定32）

1. Phase 4 にロードマップの順序どおり着手する
2. 刻みは「注釈の土台から」の 5 塊（本書は塊①）
3. 到達点は塊①まるごと

### モック（2026-09-15）

4. プロパティは右パネル 260px に固定（案A）。`docs/04` 未確定事項4 の決着

### 事前調査後（2026-09-15。8件とも起草者の推し）

5. **保存後は開き直す**（論点1。確定事項20。`spec-1-6` 確定事項27〜29 を改める）
6. **既存のハイライト・下線・取り消し線は読み込んで編集できる**（論点2。確定事項17・18）
7. **履歴はページ編集と 1 本**（論点3。確定事項15）
8. **付け方は、なぞると先に選ぶの両方**（論点6。確定事項10）
9. **種類ごとに最後に使った色を覚える**（論点5。確定事項34）
10. **印刷に未保存の注釈を映す**（論点7。確定事項28）
11. **プロパティは注釈モードの間は常に出す**（論点4'。確定事項4）
12. **サイドパネルはサムネイル 1 列**（論点3'。確定事項3）

### 起草者の判断で決めたもの

- `/AP` を必ず書く（確定事項25）。他のビューアが既定の外観を作らなくても見えるように
- 四角の縦はフォントの ascent／descent から（確定事項12）。ブラウザの文字の箱は代替フォントで 1.4em になり隣の行に触れる
- 紙の上の層はテキストレイヤーの下（確定事項5）。文字の選択を奪わない
- 上限を置かない（確定事項27）。パスワード付き PDF は付けられるが保存は断る（確定事項9）
- 差し込んだページには塊①では付けない。サムネイルには自前の注釈を映さない（確定事項30）

---

## 未確定のまま残すもの

| 項目 | 扱い |
|---|---|
| 差し込んだページへの注釈 | 保存して開き直せば付けられる。塊①では「差し込んだページには保存後に付けられます」の帯で断る |
| 縦書き・回転した文字列の四角 | 外接矩形で近似（確定事項12）。要望が出たら item の `transform` から回転した四角を作る |
| 画像だけのページ（テキストレイヤーが無い） | 付かない。図形（塊③）で代替 |
| サムネイルへの反映 | 自前の注釈は映らない（確定事項30）。塊④の注釈一覧で置き換える |
| `/CA` が pdf.js から取れない下線・取り消し線 | 1 と見なす。保存で 1 になる |
| 保存後に Ctrl+Z で保存前へ戻ること | できない（確定事項20）。`spec-1-6` 確定事項28 を改める |
