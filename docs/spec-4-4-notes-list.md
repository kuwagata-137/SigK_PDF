# 仕様書: Phase 4 塊④ ノート注釈＋注釈一覧とプロパティパネル

起草日: 2026-09-18
ステータス: **確定**（2026-09-18 確定。着手前の3件は `docs/07` 決定38、モックの1件と事前調査後の論点8件は `docs/07` 決定39 で
同日ユーザーが決定。9件とも起草者の推し。末尾「ユーザーの確定」を参照。残る細部は起草者の推しで書き、その一覧を
「起草者の判断で決めたもの」に置いた）
関連: `docs/05_開発ロードマップ.md` Phase 4（4-5・4-6）／`docs/01_製品要件定義.md` F-05-6・F-05-7／`docs/04_UI設計.md` 4-3／
`docs/02_アーキテクチャ設計.md` 2-3（保存の形）・第3章／`docs/spec-4-1-text-markup.md`（注釈の土台。サイドパネルの入れ替えを予告）／
`docs/spec-4-2-free-text.md`（置く・動かす・右パネルの行。ノートはこれを手本にする）／`docs/spec-4-3-shapes-ink.md`（塊④へ送った候補 3 つ）／
`docs/spec-1-4-find-print.md`（検索のジャンプの流儀・印刷の描画経路）

---

## 目的

Phase 4 の4つ目の塊。**注釈モードで「ノート」の道具を選び、紙の上を押して付箋（ピン）を置き、右パネルの「本文」に
コメントを書ける。色と不透明度を選べ、掴んで動かす・消す・元に戻せる。保存すると PDF 標準の Text 注釈（外観 `/AP`・
`/Popup` 付き）として書かれ、他のビューアでも同じ位置・色で見え、本文と作成者が注釈一覧に出る**（F-05-6）。
**あわせて、注釈モードのサイドパネルをサムネイルから「注釈」の一覧に入れ替える。文書内の注釈（自分で付けたもの・
読み込んで直せるもの・他のツールが付けた「表示のみ」のもの）がページ順に並び、行を押すと該当箇所へ飛んで選ばれる**（F-05-7）。
塊③が送った 3 つの候補のうち「表示のみの注釈を一覧から消せる」「不透明度のプロパティ」を入れ、「一覧の複数選択」は見送る（論点4・5・7）。

塊①〜③で固めた土台 — 注釈の持ち方（`{ added, removed }`）・1本の履歴・dirty・SVG の層と canvas への重ね描き・右パネル・
`/Annots` への書き込み・保存後の開き直し・読み込んだ注釈を pdf.js に描かせない印・掴んで動かす — はそのまま使い、
ノートという新しい種類（`kind: 'note'`）と、一覧という新しい画面、不透明度という新しい欄を載せる。フォントは要らない。

---

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| レールの「ノート」の道具を有効にする（これでレールの 7 つの道具が全部押せる） | 塊⑤（透かし・フラット化）・右クリックメニュー |
| 紙の上を押すと付箋を置く。本文は右パネルの「本文」欄（複数行）に書く（モック・確定 A） | 紙の上の吹き出し（ポップアップ）の表示・編集。返信（`/IRT`）・状態（`/State`）・リッチテキスト（`/RC`） |
| 色（黄・緑・青・桃。論点1）・作成者（右パネルの欄。既定は OS のユーザー名。論点2）・不透明度（論点5） | 付箋アイコンの種類の選択（`/Name` は `Comment` 固定。論点1） |
| 付箋は画面で 20pt 相当（≈27px）固定・常に上向き（規格の NoZoom・NoRotate の振る舞い。論点8） | 倍率に追従する拡大・紙と一緒に回す描き方 |
| 置いたものを選ぶ・掴んで動かす・色と不透明度と本文を変える・Delete で消す・Ctrl+Z で戻す | 矢印キーでの移動・コピー＆ペースト・複数選択（論点7） |
| 保存: `/Text`。`/Rect`（20×20pt）・`/Contents`（UTF-16BE）・`/T`・`/C`・`/CA`・`/F 28`・`/Name /Comment`・`/Open false`・`/CreationDate`・**`/AP /N`**・**`/Popup`**（`/Parent`・`/Open false`）。抽出にも付いていく | `/IRT`・`/RT`・`/State`・`/StateModel`・`/RC`・`/Subj` |
| 既存の `/Text` を読み込んで選ぶ・消す・動かす・本文と色を変える。`/AP` の有無を問わず自前の付箋で描く（論点3） | 他のツールの付箋アイコンの絵をそのまま見せる（直すと自前の絵に置き換わる。ハイライトの色変えと同じ） |
| 不透明度は図形・ペン・テキスト・ノートに 4 段（100・75・50・25%）。画面・印刷・保存で同じ（論点5） | ハイライト・下線・取り消し線の不透明度（ハイライトは multiply で既に透ける）・自由な数値 |
| サイドパネルの「注釈」一覧: ページ順 → 紙の上から下。行はアイコン（注釈の色）・p.N・本文の先頭行か種類名。行を押すと該当箇所へ飛んで選ぶ。紙の上で選ぶと行も光る（論点6） | 絞り込み・並べ替え・ページの見出し・作成者や日時の列・一覧からの編集 |
| 「表示のみ」の注釈（他のツールの `/Line`・FreeText・Polygon・3 点以上の PolyLine・Stamp 等）も一覧に出し、選ぶと破線の枠だけ出て、消せる（論点4） | 表示のみの注釈の編集・紙の上での選択 |
| 印刷に未保存のノートと不透明度が映る（塊①②③と同じ） | PDF→画像（読み直して描くので映らない。`spec-3-3` 確定事項1 のまま） |
| 起動確認 `SIGK_SMOKE_ANNOTATE` にノート・不透明度・一覧の操作を足す | 差し込んだページ・暗号化 PDF・サムネイルの扱いの変更（塊①と同じ） |

---

## 事前調査（2026-09-18・Windows 11 実機・Node 22・Electron 44・pdf.js 6.3.289・pdf-lib 1.17.1・fixtures のみ）

プローブは scratchpad の使い捨て（Node で pdf-lib を回すもの、Browser パネルで pdf.js と DOM を回すもの）。検体は
`test/fixtures/` の `three-pages.pdf`・`rotated.pdf` に B で注釈を足したもの。記録後に捨てた。

### A. pdf.js がノート（`/Text`）と `/Popup` で返すもの・描くもの — **`/AP` の無いノートは今まったく見えていない**

| Subtype | 返る欄 | 描画（canvas・`ENABLE_STORAGE`） |
|---|---|---|
| Text | `subtype 'Text'`・`annotationType 1`・`id`・`rect`・`color`（0〜255）・`contentsObj.str`（改行は `\n` のまま）・`titleObj.str`（`/T`）・`modificationDate`・`creationDate`・`name`（アイコン名。**`/AP` があると `'NoIcon'`**）・`popupRef`（`'13R'`）・`annotationFlags`・`hasAppearance`・**`noRotate: true`（`/F` に関係なく常に）**・`hasOwnCanvas: true`。`opacity` は返さない | **`/AP` があればそれを描く（334 px）。無ければ何も描かない（0 px）。** `annotationStorage.setValue(id, { noView: true })` で隠せる（37 px ＝ 下の文字の分）。**`/AP` の無いノートは `rect` を左上基準の 22×22 に直して返す**（`[60 700 80 720]` → `[60 698 82 720]`） |
| Popup | `subtype 'Popup'`・`annotationType 16`・`parentRect`・`open`・親から写した `contentsObj`・`titleObj`・`color`・`modificationDate` | **開いていても閉じていても描かない（0 px）**。隠す印は要らない |

- **PDF の規格（ISO 32000-1 §12.5.6.4）は Text 注釈を「NoZoom・NoRotate が常に立っているものとして振る舞う」と定める。**
  pdf.js もこれに従って `noRotate` を常に true にするが、**canvas への描画ではフラグを無視して `/AP` を紙と一緒に回し、`/Rect` を
  写した位置に描く**（`rotated.pdf` の `/Rotate 90` のページで、`/F 28` と `/F 4` のノートがどちらも回った付箋として
  `convertToViewportPoint(/Rect)` の箱 `[700 50 720 70]` に描かれた）。他のビューアは規格どおり、`/Rect` の左上を基準に
  上向き・一定の大きさで描く。→ 自前で描く以上、**規格どおりの見え方（左上基準・上向き・固定）に揃える**（論点8）。
  pdf.js 経由（PDF→画像）だけが回転ページで回した付箋になるのは既知の差として記録する。
- `/Contents`・`/T` は pdf-lib の `PDFHexString.fromText`（UTF-16BE）で書いたものをそのまま読める。

### B. pdf-lib で書く辞書と外観、既存のノートを直したときの保存

`three-pages.pdf`（1,464 B）に 16 個（ノート 4・表示のみ 6・不透明度 0.5 のもの 5・付随の Popup 3）を足して **114ms・9,472 B**。
読み直すと辞書の欄はすべて残る（`/Text`: `/Contents`・`/T`・`/C`・`/CA`・`/F 28`・`/Name /Comment`・`/CreationDate`・`/M`・`/NM`・`/P`・
`/AP << /N >>`・`/Popup`。`/Popup`: `/Parent`・`/Open false`・`/Rect`・`/F 28`）。

- 付箋の外観は 20×20pt の Form XObject（角丸の吹き出し＋しっぽ＋本文の印 2 本。塗りは注釈の色、線は濃い灰 1pt）。`/GS gs` の
  ExtGState で `/CA`・`/ca` を当てる（塊①〜③と同じ包み方）。
- **既存のノートを直したときの保存は remove＋add で足りる。**`annotation-remove.js` の既存経路で `remove: ['12R']` を当てると、
  ノート本体・その `/AP /N`・**`/Popup` の実体**が消え、`/Annots` の並びから Popup の参照も外れる（オブジェクト 36 → 32。
  保存して読み直しても Popup は残らない。`spec-4-1` 確定事項24 の再確認）。
- 表示のみの `/Line`（`'17R'`）も同じ経路で消える（D）。

### C. 不透明度 — **pdf.js が `opacity` を返すのはハイライトとペンだけ**

- `/CA 0.5` を書いた検体を `getAnnotations()` で読むと、`opacity` を返すのは **Highlight（0.5）と Ink（0.5）だけ**。Underline・
  Square・FreeText・Text は `/CA` を書いても返さない（`vendor/pdf.worker.mjs` で `this.data.opacity = dict.get("CA")` を持つのが
  `HighlightAnnotation` と `InkAnnotation` の 2 つ）。→ 読み込んだ矩形・楕円・直線・矢印・テキスト・ノートは不透明度 1 として
  扱い、直すと `/CA 1` で書き直される（既存の限界。塊①③のまま。「未確定のまま残すもの」）。
- 画面（SVG）と印刷（canvas）の見た目: 1 本の線・塗りでは `<g opacity>` と `globalAlpha` の画素が一致（`[236 149 149]`）。
  **同じ注釈の中で線が重なるところ（矢印の先端）だけ違う**: canvas と PDF（`/CA` は描画の 1 筆ごと）は重なりが濃くなる
  （`[226 96 96]`）が、SVG の `<g opacity>` はグループごとに合成するので濃くならない。矢じりの数 px の話で、塊③で決めた
  `<g opacity>` のままにする（`opacity` を要素ごとに付けると付箋の塗りと線の重なりで逆の差が出る）。
- ハイライト（multiply）は不透明度の対象にしない（論点5）。

### D. 一覧の材料 — 全種類が `id`・`subtype`・`rect`・`color`・`contentsObj`・`titleObj`・`modificationDate` を持つ

| 検体 | `subtype` | 一覧に要る欄 | 消せるか |
|---|---|---|---|
| 他のツールの直線 | Line | `rect`（枠線ぶん広がる `[298 698 502 762]`）・`color`・`contentsObj.str 'other line'` | 消せる（B） |
| 他のツールの FreeText（`/DA /Helv`） | FreeText | `rect`・`color`（背景 `/C`）・`contentsObj.str` | 同じ経路 |
| Polygon・3 点の PolyLine | Polygon・PolyLine | `rect`・`color`・`vertices` | 同じ経路 |
| スタンプ（`/AP` 付き） | Stamp | `rect`・`color`・`hasAppearance` | 同じ経路 |
| リンク | Link | `rect`・`url`。`titleObj` 無し | **一覧に出さない**（注釈ではなく文書の一部） |
| Popup | Popup | 親の写し | **一覧に出さない**（親の付属） |

→ 「表示のみ」の entry は `{ ref, src, kind: 'other', subtype, color, opacity: 1, rect, quads: [rect の四角], text（本文）, author, readonly: true }`。
対象は規格が markup annotation とする種類（`Text`・`FreeText`・`Line`・`Square`・`Circle`・`Polygon`・`PolyLine`・`Highlight`・
`Underline`・`Squiggly`・`StrikeOut`・`Stamp`・`Caret`・`Ink`・`FileAttachment`・`Sound`・`Redact`）のうち、塊①〜④の読み込みで
拾えなかったもの。`Link`・`Widget`・`Popup`・`Screen`・`PrinterMark`・`TrapNet`・`Watermark`・`3D`・`Movie`・`RichMedia` は出さない。
Text は全部拾う（論点3）ので表示のみにはならない。

### E. 一覧からのジャンプと選択、再描画のコスト

- `viewer.goToPage(index)` はページの先頭へスクロールして `scheduleUpdate()` を呼び、描かれたページは `attachAnnotationLayer` →
  `drawAnnotations` で **描いた時点の `annotate.getSelected()`** を見て枠を描く。→ **先に `annotate.select(key)` してから
  `goToPage` すれば、未描画のページでも描かれたときに枠が出る**（`findAnnot` はページの描画に依らない）。
- 注釈の位置へ寄せるのは検索と同じ流儀（`find.js` の `pendingReveal` ＋ `onPageRendered` → `scrollIntoView({ block: 'center' })`）。
  **SVG の `<g>` にも `scrollIntoView` が効く**（スクロールする器の中で `scrollTop` 0 → 1360。`getBoundingClientRect` が SVG 要素でも取れる）。
  描画の合図は `page-render.attachAnnotationLayer` の末尾に `annotationList.onPageRendered(index)` を足す（`freeTextEditor.onPageRendered` の隣）。
- **一覧の行を全部組み直すコスト（Chromium）: 500 行で 8〜14ms、2,000 行で 32〜39ms。** 差分更新は要らず、合図のたびに
  `replaceChildren` で組み直してよい（合図は `setAnnotations`・`setImported`・`applyPlan`・モードの切り替え・選択の変化）。

---

## 確定事項

### A. 画面（`docs/04` 4-3・モック `screenshots/phase4-notes-list.png`・`-selected.png`）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 道具 | レールの「ノート」（`data-tool="note"`）を有効にする（`aria-disabled` を外す）。押している間は `.active`。道具を持っているとき、紙の上のカーソルは `crosshair`、テキストレイヤーは `user-select: none`（図形・ペンと同じ） |
| 2 | 置く操作 | 道具を持って紙の上を押して離す（`CLICK_SLOP` 以下。テキストと同じ経路の末尾）と、**押した点を中心に**付箋を置いて 1 世代積み、置いたものを選び、右パネルの「本文」欄にフォーカスを移す。本文は空でもよい（付箋は残る）。押した点が選んでいる注釈の上ならドラッグ移動。文字が選ばれていれば作らない（マークアップと同じ）。紙の端をはみ出す位置は紙の中へ寄せる（テキストの `fitOrigin` と同じ） |
| 3 | 右パネル（ノート） | 「種類」は道具なら「ノート（次に付ける）」、選んでいれば「ノート」。「色」は黄・緑・青・桃。**「本文」の行（`<textarea id="props-contents">`。ノートを選んでいるときだけ。3 行の高さ・縦に伸ばせる）**。**「作成者」の行（`<input id="props-author">`。ノートの道具を持って何も選んでいないときは編集でき、ノートを選んでいるときはその注釈の作成者を読み取りで見せる）**。「ページ」「この注釈を削除」は塊①〜③と同じ。塊②の「本文」（`#props-text-row`。テキストとマークアップの読み取りの行）はノートでは隠す |
| 4 | 本文の確定 | 「本文」欄は、欄の外を押す（blur）か Ctrl+Enter で確定し、変わっていれば `updateAnnot(entry, { text })` で 1 世代積む（読み込んだノートは写しになる。塊①の色変えと同じ）。Esc は欄を離れる（blur ＝ 確定）。Enter は改行。欄にフォーカスがある間、Delete・Ctrl+Z・Esc などの注釈モードのキーは欄のもの（`viewer-controls.js` の入力欄の除外に載せる） |
| 5 | 右パネル（不透明度。論点5） | **「不透明度」の行（`<select id="props-opacity">`。100%・75%・50%・25%）**。テキスト・図形・ペン・ノートの道具を持っているか、テキスト・図形系・ノートの注釈を選んでいるときに出す。選んでいればその注釈を変えて 1 世代積み、無ければ次に付ける値として道具ごと（`text`・`shape`・`pen`・`note`）に覚える（色と同じ流儀）。ハイライト・下線・取り消し線では出さない。読み込んだ注釈のプリセット外の値（ペンの 0.5 など）は末尾に選択肢を足して見せる（線の太さと同じ） |
| 6 | 右パネル（表示のみ） | 一覧から表示のみの注釈を選ぶと、「種類」に「直線（表示のみ）」のように種類名＋（表示のみ）、色の丸は出さず、「ページ」「本文」（読み取り。あれば）、ヒント「他のツールで付けた注釈です。Delete で消せます。編集はできません。」、「この注釈を削除」は押せる |
| 7 | 選ぶ・動かす・消す | 紙の上で付箋を押すと選ぶ（当たり判定は画面の箱。確定事項13）。選んだ付箋を掴んでドラッグすると動く（離したときに 1 世代）。Delete で消す、Esc で解除、Ctrl+Z で戻す。ダブルクリックは「本文」欄にフォーカスを移す |
| 8 | 見た目 | 付箋は自前の吹き出し（角丸の四角＋左下のしっぽ＋本文の印 2 本）。塗りは注釈の色、線は濃い灰（`#4a4a4a` 1px 相当）。SVG は `<g class="note" transform="translate(x y) scale(s)">` に 20×20 の座標で描く。選択中は塊①と同じ破線の枠（画面の箱＋3px） |
| 9 | サイドパネル | 注釈モードの題名を「注釈」にし（`MODE_TITLES.annot`）、サムネイルの代わりに `#annot-list` を出す（`isVisible()` から `annot` を外す）。文書が無ければ「文書を開くと注釈の一覧が出ます」、注釈が無ければ「注釈はありません」。閲覧・ページモードのサムネイルは変えない |

### B. 座標・大きさ・回転（事前調査 A。論点8）

| # | 項目 | 決定 |
|---|---|---|
| 10 | 紙の座標 | ノートの `rect` は **20×20pt** で、`[x1, y2 − 20, x1 + 20, y2]`。**基準は左上の角 `(x1, y2)`**（規格の NoRotate が固定する点）。置くときは、押した点を中心にした画面の箱の左上を `convertToPdfPoint` で紙に直したものを `(x1, y2)` にする。`quads` は `rect` の四隅を 1 つ |
| 11 | 画面の箱 | 基準の点を `convertToViewportPoint` で表示へ直し、そこから右下へ **`ICON_SIZE × CSS_UNITS` ＝ 20 × 96/72 ≈ 26.7px** の正方形。**倍率に依らず一定、回転した紙でも上向き**（規格の NoZoom・NoRotate の振る舞い。他のビューアと同じ見え方）。`noteGraphics.boxOf(entry, viewport)` が唯一の計算元で、描画・選択枠・当たり判定・一覧からの寄せがこれを使う |
| 12 | 回転したページ | 基準の点だけを紙 ↔ 表示で往復する（`/Rotate 90` でも `convertToViewportPoint` → `convertToPdfPoint` は誤差なし。`spec-4-3` 事前調査 D）。`/Rotate` は書かず、entry にも回転を持たない（他のビューアが規格どおり上向きに描く）。pdf.js の canvas（PDF→画像）だけは紙と一緒に回した付箋を `/Rect` を写した位置に描く（既知の差。事前調査 A） |
| 13 | 当たり判定 | 画面の箱（確定事項11）に押した点（`.pdf-page` 基準の CSS px）が入るか。`annotate.hitTest` が kind で分け、`hits` に表示の点も渡す。表示のみの注釈（`readonly`）は当てない |
| 14 | 動かす | ドラッグの差分を紙の座標に直し（塊②の `endDrag` と同じ）、基準の点に足して `rect`・`quads` を作り直す。大きさは変えない |

### C. 注釈の持ち方と履歴（`spec-4-3` C を広げる）

| # | 項目 | 決定 |
|---|---|---|
| 15 | entry（ノート） | `{ id, src, kind: 'note', color, opacity, rect, quads: [箱の四角], text（本文。空でもよい）, author（作成者。文字列） }`。`KINDS` に `note` を足し、`isNoteKind` を公開する。`validEntry` はノートなら `text` が文字列（空を許す）・`author` が文字列か未設定・`quads.length === 1`。塊②のテキストの `text`（空を許さない）とは kind で分ける |
| 16 | entry（表示のみ） | `{ ref, src, kind: 'other', subtype, color, opacity: 1, rect, quads, text, author, readonly: true }`。`KINDS` には入れない（`addAnnot` で足せない）。`imported` にだけ現れ、`annotsOnPage`・`findAnnot` は今までどおり返す。`removeAnnot` は `ref` で消せる。**`updateAnnot`・`recolorAnnot` は `readonly` なら何もしない** |
| 17 | 変える口 | `updateAnnot` の `PATCH_FIELDS` に **`opacity`** を足し（0〜1 の有限数）、`text` の検証を kind で分ける（ノートは空を許す）。`copyEntry`・`sameEntry`・`toSaveEntry` に `author`（ノートだけ）を足す。`opacity` は既に全経路を通っている（`spec-4-1`。レンダラーが 1 を入れていただけ） |
| 18 | 履歴 | 「置く」「動かす」「本文を変える」「色を変える」「不透明度を変える」「消す」で 1 世代ずつ、塊①の `commitAnnots` に載せる。本文は確定のときだけ（打鍵ごとには積まない） |
| 19 | 保存の形 | `toSaveSpec` はノートを `{ src, kind: 'note', color, opacity, rect, text, author }` で写す（`quads` は落とす）。図形・テキストの `opacity` は今までどおり写る |
| 20 | 読み込み（論点3・4） | 文書を開いたとき、`Text` → `note`（`rect` の左上 `(x1, y2)` から 20×20 を作り直す。`color` 無しは黄・`contentsObj.str`（`\r\n`・`\r` は `\n` に）・`titleObj.str`）。**`/AP` の有無を問わず拾い、`noView` で pdf.js に描かせず自前で描く**（`/AP` の無いものは今まで見えていなかった）。`Popup` は拾わない（描かれない）。**事前調査 D の markup 注釈のうち塊①〜④で拾えなかったものは `readonly` の entry にして `imported` に入れる**（`noView` は付けない。pdf.js が描き続ける）。それ以外（Link・Widget・Popup 等）は拾わない |
| 21 | 覚える値 | `settings.json` の `ui.annotColors.note`（黄・緑・青・桃。プリセット外は既定 黄）、**`ui.annotOpacity`**（`{ text, shape, pen, note }`。各 1・0.75・0.5・0.25。プリセット外は 1）、**`ui.annotAuthor`**（文字列。空なら OS のユーザー名）。起動時に `annotate.applyColors`／`annotateOpacity.applyOpacities`／`annotateNote.applyAuthor` |

### D. ワーカー（事前調査 A・B）

| # | 項目 | 決定 |
|---|---|---|
| 22 | 純関数 `worker/note-appearance.js` | pdf-lib を知らない。`ICON_SIZE = 20`、`NOTE_SHAPE`（20×20・y 下向きの座標で書いた吹き出しの輪郭と本文の印 2 本。**renderer の `note-graphics.js` と同じ配列で、一致をテストで見張る**）、`isNoteEntry(entry)`、`noteAppearanceOf(entry)` → `{ content, bbox, subtype: 'Text', rgb, opacity, flags: 28, popupRect }`。content は `/GS gs` → 塗り `rg`・線 `0.29 0.29 0.29 RG 1 w 1 j 1 J` → 輪郭 `m/l/c … h B` → 印 `m l S` ×2（y は `y2 − py` で紙の向きへ）。数は `annotation-appearance.num` |
| 23 | 注釈の辞書 | `/Type /Annot`・`/Subtype /Text`・`/Rect`（＝`bbox`。20×20）・`/Contents`（`PDFHexString.fromText`。空なら空文字）・**`/T`**（作成者。空なら書かない）・`/C`（塗りの色）・`/CA`・**`/F 28`**（Print＋NoZoom＋NoRotate）・**`/Name /Comment`**・**`/Open false`**・**`/CreationDate`**（`/M` と同じ時刻）・`/NM sigk-…`・`/P`・`/M`・`/AP << /N ref >>`・**`/Popup ref`**。**書かないもの**: `/IRT`・`/RT`・`/State`・`/StateModel`・`/RC`・`/Subj` |
| 24 | `/Popup` | 間接オブジェクト `/Type /Annot /Subtype /Popup /Rect [x2 + 2, y2 − 100, x2 + 182, y2] /Parent ref /Open false /F 28 /P`。ノートの直後に同じ `/Annots` へ並べる。紙の外にはみ出しても切らない（ビューアが自分で収める）。消すときは `annotation-remove.js` の既存経路が実体と参照を外す（事前調査 B） |
| 25 | 外観 `/AP /N` | Form XObject。`BBox` ＝ `/Rect`、`Matrix` 無し、`Resources: { ExtGState: { GS } }`（`CA`・`ca` ＝ 不透明度）。塊①〜③と同じ包み方。フォントは要らない |
| 26 | `op-annotate.js` | `kindFields` に `note` の分岐（確定事項23）。`addAnnotation` は `F` を外観の `flags`（無ければ 4）にし、`popupRect` があれば `/Popup` を一緒に足す（確定事項24）。`validAdd` は `noteAppearanceOf(entry) !== null`。`applyAnnotations` の流れ（検証 → フォント → 外観 → 消す → 足す）は変えない |
| 27 | 不透明度の保存 | 図形・ペン・テキストは `opacity` が `/CA` と ExtGState に既に通っている（塊①〜③）。ノートも同じ。読み直して `/CA` と `/AP` の `/ExtGState /GS /CA /ca` が同じ値になることをテストで見る |

### E. 注釈一覧（事前調査 D・E。論点4・6・7）

| # | 項目 | 決定 |
|---|---|---|
| 28 | 純関数 `renderer/annotation-index.js` | `rowsOf(annots, imported, plan)` → いまの並び（`plan`）の順にページを回し、`annotsOnPage(annots, imported, src)` を**紙の上から下（`rect[3]` の大きい順）、同じ高さなら左から右（`rect[0]` の小さい順）**に並べ、行 `{ key, kind, subtype?, readonly, page（1 始まりの表示位置）, src, title（本文の先頭行。無ければ ''）, color }` を返す。`title` はノート・テキストは本文、自分で付けたマークアップは対象の文字、表示のみは `contentsObj` の本文 |
| 29 | 画面 `renderer/annotation-list.js` | `#side-scroll` の中に `#annot-list`（行の入れ物）と `#annot-list-empty` を置く。行は `<div class="annot-row" data-key>`: 種類のアイコン（`assets/icons.js`。注釈の色。表示のみは灰色）・`p.N`・本文の先頭行（無ければ種類名を灰色で）・表示のみは「表示のみ」の印。合図（`viewer.setAnnotations`・`setImported`・`applyPlan`・`resetView`、モードの切り替え、`annotate.select`）のたびに `replaceChildren` で全部組み直す（事前調査 E: 2,000 行で 40ms 以下） |
| 30 | 行を押す | `annotate.select(key)` → その注釈のページが描かれていれば `.annot-layer` の `g[data-annot]`（表示のみは `.annot-frame`）へ `scrollIntoView({ block: 'center' })`、描かれていなければ `viewer.goToPage(index)` して `pendingReveal` に覚え、`onPageRendered(index)` で寄せる（検索と同じ流儀） |
| 31 | 選択の同期 | 紙の上で選ぶと（`annotate.select`）該当の行に `.on` を付け、`scrollIntoView({ block: 'nearest' })` で一覧をその行まで動かす。解除で外す |
| 32 | 表示のみ（論点4） | 一覧から選べ、紙の上には破線の枠だけ出る（`annotation-layer.draw` は `readonly` を描かず、選ばれていれば枠だけ描く）。Delete と「この注釈を削除」で `removed` に足す（保存で `/Annots` から外れる）。紙の上では当たり判定に入れない（大きな外接矩形がテキスト・付箋の配置を邪魔しないように）。動かせない・色は変えられない |
| 33 | 複数選択（論点7） | 見送り。選んでいる注釈は 1 つのまま |

### F. 印刷・PDF→画像（`spec-4-1` E と同じ）

| # | 項目 | 決定 |
|---|---|---|
| 34 | 印刷 | `annotation-layer.paint` がノートを `note-graphics.paint(ctx, entry, viewport)` に委ねる。印刷は `/Rect` の大きさ（**20pt × viewport の倍率**。規格は印刷時に NoZoom の注釈を `/Rect` の大きさで出す）で、基準の点から右下へ上向きに描く。不透明度は `globalAlpha`（塊①〜③と同じ）。表示のみの注釈は描かない（pdf.js が描いている） |
| 35 | PDF→画像 | 映らない（読み直して描く。`spec-3-3` 確定事項1 のまま）。保存済みのノートは pdf.js が `/AP` を描くので映る（回転ページでは回った付箋。確定事項12） |

### G. プリセット・設定（論点1・2・5）

| # | 項目 | 決定 |
|---|---|---|
| 36 | 道具と種類 | `TOOLS` に `note` を足す（7 つ）。`TOOL_LABELS` に `note: 'ノート'`。表示のみの種類名は `READONLY_LABELS`（`Line: '直線'`・`Polygon: '多角形'`・`PolyLine: '折れ線'`・`FreeText: 'テキスト'`・`Stamp: 'スタンプ'`・`Caret: '挿入記号'`・`Squiggly: '波線'`・`FileAttachment: '添付ファイル'`・`Sound: '音声'`・`Redact: '墨消し'`・`Highlight: 'ハイライト'`・`Underline: '下線'`・`StrikeOut: '取り消し線'`・`Square: '矩形'`・`Circle: '楕円'`・`Ink: 'ペン'`・`Text: 'ノート'`。無ければ subtype のまま） |
| 37 | 色 | ノートは **黄 `#ffe45a`・緑 `#8ce99a`・青 `#8fbfff`・桃 `#ffa8c8`**（ハイライトと同じ並び）、既定 **黄**。`COLORS.note`、`ui.annotColors.note` |
| 38 | 不透明度 | `OPACITIES = [1, 0.75, 0.5, 0.25]`（`<select>` は「100%」「75%」「50%」「25%」）。既定 **1**。対象の道具 `OPACITY_TOOLS = ['text', 'shape', 'pen', 'note']`、対象の種類は `paletteOf(kind)` がその 4 つになるもの。`ui.annotOpacity.{text,shape,pen,note}`。`settings.js` の `ANNOT_OPACITIES`・`ANNOT_COLORS.note` と `annotation-presets.js` の一致を `settings.test.js` が見張る |
| 39 | 作成者 | `ui.annotAuthor`（文字列。前後の空白を落とし 100 文字まで）。**空なら OS のユーザー名**（`os.userInfo().username`。メインが `settings:getUi` の応答で埋める）。右パネルの「作成者」欄で変えると `persist({ annotAuthor })`。保存の `/T` は entry の `author` |
| 40 | 付箋の寸法 | `ICON_SIZE = 20`（pt）。画面は `20 × 96/72` px 固定、印刷は `20 × 倍率`、保存は `/Rect` 20×20 |

---

## 足りない部品

### 新しいモジュール（テストは `test/<module>.test.js` と 1 対 1）

| ファイル | 層 | 役目 |
|---|---|---|
| `renderer/note-graphics.js` | 画面 | `ICON_SIZE`・`ICON_PX`・`NOTE_SHAPE`・`anchorOf(entry, viewport)`・`boxOf(entry, viewport)`（画面の箱。確定事項11）・`svgOf(doc, entry, viewport)`（`<g class="note">`）・`paint(ctx, entry, viewport)`（印刷。確定事項34） |
| `renderer/annotate-note.js` | 指揮 | `place({ index, point })`（確定事項2）・`move(key, delta)`・`setContents(text)`（確定事項4）・`editSelected()`（「本文」欄にフォーカス）・`getAuthor/setAuthor/applyAuthor`（確定事項39）。`annotate-text.js` を手本に、`annotate.js` から委譲で公開 |
| `renderer/annotate-opacity.js` | 指揮 | `setOpacity(value)`（選んでいればその注釈、無ければ道具の値）・`opacityOf(kind)`・`getOpacities/applyOpacities/rememberOpacity`・`isOpacityKind(kind)`（確定事項5・21） |
| `renderer/annotation-index.js` | 純関数 | `rowsOf(annots, imported, plan)`・`titleOf(entry)`・`labelOf(entry)`（種類名。表示のみは `READONLY_LABELS`）・`iconOf(entry)`（確定事項28） |
| `renderer/annotation-list.js` | 画面 | `init(doc, win)`・`refresh()`・`syncSelected(key)`・`reveal(key)`・`onPageRendered(index)`（確定事項29〜31） |
| `worker/note-appearance.js` | 純関数 | `ICON_SIZE`・`NOTE_SHAPE`・`isNoteEntry(entry)`・`noteAppearanceOf(entry)`（確定事項22） |

### 既存への追記

| ファイル | 変更 |
|---|---|
| `renderer/annotation-entry.js` | 確定事項15〜17・19（`KINDS` に `note`、`isNoteKind`、`author`、`PATCH_FIELDS` に `opacity`、kind で分ける `text` の検証、`copyEntry`・`sameEntry`・`validEntry`・`toSaveEntry`） |
| `renderer/annotation-state.js` | 確定事項16（`updateAnnot` は `readonly` なら何もしない）。再公開に `isNoteKind` |
| `renderer/annotation-presets.js` | 確定事項36〜38（`TOOLS`・`TOOL_LABELS.note`・`READONLY_LABELS`・`COLORS.note`・`OPACITIES`・`DEFAULT_OPACITY`・`OPACITY_TOOLS`・`isOpacity`） |
| `renderer/annotation-import.js` | 確定事項20（`SUBTYPES.Text`、`importedNote`、`MARKUP_SUBTYPES` と `readonlyEntry`、`Popup` は拾わない） |
| `renderer/annotation-layer.js` | `groupOf`・`paint` がノートを `noteGraphics` へ委ね、`readonly` は描かない（枠だけ）。`frameOf` はノートなら画面の箱から |
| `renderer/annotate.js` | `hitTest` でノートは画面の箱・`readonly` は当てない。`setColor` は `readonly`・プリセットの無い種類を断る。`select` が `annotationList.syncSelected` を呼ぶ。`onModeChanged` が `annotationList.refresh` を呼ぶ。委譲 `setOpacity`・`getOpacity`・`setContents`・`setAuthor`・`getAuthor`・`editNote` |
| `renderer/annotate-pointer.js` | `isMovable` に `note`。mouseup の末尾でノートの道具なら `annotateNote.place`。`endDrag` の振り分けにノート。dblclick はノートなら `annotateNote.editSelected` |
| `renderer/annotation-props.js`・`index.html` | 「本文」（`<textarea id="props-contents">`）・「作成者」（`<input id="props-author">`）・「不透明度」（`<select id="props-opacity">`）の行。`HINTS.note`・`HINTS.noteSelected`・`HINTS.readonly`。表示のみの「種類」。`focusContents()` |
| `renderer/viewer.js` | `setAnnotations`・`setImported`・`applyPlan`・`resetView` の末尾で `annotationList.refresh()` |
| `renderer/page-render.js` | `attachAnnotationLayer` の末尾で `annotationList.onPageRendered(index)` |
| `renderer/shell.js`・`renderer/thumbnails.js`・`renderer/tools.js` | `MODE_TITLES.annot = '注釈'`。`isVisible()` から `annot` を外す。「文書を開くと…」の案内を注釈モードでも隠す |
| `renderer/viewer-controls.js` | 注釈モードのキー（Delete・Esc・Enter・Ctrl+Z）を「本文」「作成者」の欄にフォーカスがあるときは素通しする |
| `renderer/app.js` | `annotateNote.init`・`annotateOpacity.init`・`annotationList.init`・`applyOpacities(result.ui.annotOpacity)`・`applyAuthor(result.ui.annotAuthor)` |
| `renderer/shell.css` | `.annot-list`・`.annot-row`（`.on`・`.readonly`・`.ic`・`.pg`・`.tx`・`.ro`）・`.props-textarea`・`.props-input`・`html[data-tool="note"] .textLayer { cursor: crosshair; user-select: none }` |
| `index.html` | L100 の `aria-disabled` を外し `data-tool="note"`。サイドパネルに `#annot-list`・`#annot-list-empty`。右パネルの 3 行。`<script>` 5 本（`note-graphics`・`annotation-index`・`annotation-list`・`annotate-opacity`・`annotate-note`） |
| `worker/op-annotate.js` | 確定事項23〜27 |
| `settings.js` | `DEFAULTS.annotColors.note`・`ANNOT_COLORS.note`・`DEFAULTS.annotOpacity`・`ANNOT_OPACITIES`・`DEFAULTS.annotAuthor: ''`・`pickUi/mergeUi` |
| `main.js` | `settings:getUi` の応答で `annotAuthor` が空なら `os.userInfo().username`。`annotateScript` に `note:<page>:<x>x<y>:<本文>`（紙の座標に置く）・`contents:<本文>`・`opacity:<pct>`・`author:<名前>`・`list:<n>`（一覧の n 行目を押す）。結果に `notes`・`importedNotes`・`listRows`・`propsOpacity`・`propsAuthor` |
| `test/shell.test.js` | 有効 7・灰色 0 |
| `test/settings.test.js` | `note` の既定色、`annotOpacity`・`annotAuthor` の丸め、`annotation-presets` との一致 |
| `test/harness.js` | `createPdfjsStub({ annotations })` の `Text`（`contentsObj`・`titleObj`・`popupRef`）・`Popup`・表示のみ（`Line`・他ツールの FreeText）の形、`settingsAPI.setUi` の 2 キー |
| 既存テストの「無効な kind ＝ `note`」5 か所（`annotation-state`・`op-annotate`・`annotation-appearance`・`shape-appearance`・`annotation-presets`） | `stamp` へ |
| `docs/02`（2-3・第3章のツリー・現在地）・`docs/04`（4-3 追記・第3章の表）・`docs/05`・`docs/07`・`README.md` | 現在地 |

依存は増えない。

---

## テストの範囲

| 層 | 対象 |
|---|---|
| 依存なし | `worker/note-appearance.js`（content の文字列・`bbox`・`popupRect`・`flags`・形が違えば `null`・**renderer の `NOTE_SHAPE` との一致**）、`worker/op-annotate.js`（保存して読み直し: `/Subtype /Text`・`/Rect`・`/Contents`・`/T`・`/C`・`/CA`・`/F 28`・`/Name`・`/Open`・`/CreationDate`・`/AP /N`・`/Popup` と Popup の `/Parent`・`/Open`、`/T` が空なら無い、図形の `/CA 0.5` と ExtGState、抽出先にノートと Popup が付いていく、消すと Popup も消える）、`renderer/annotation-entry.js`・`annotation-state.js`（ノートの `validEntry`（空の本文）・`author`・`opacity` の `updateAnnot`・`readonly` は変えられない・`toSaveSpec`）、`renderer/annotation-index.js`（ページ順と上から下、`title`・`label`・`icon`、表示のみ、並べ替え後の `page`）、`renderer/annotation-presets.js`＋`settings.js`（一致・既定・丸め） |
| jsdom | `note-graphics.test.js`（`boxOf` が倍率に依らず 26.67px・回転した viewport でも上向き・`svgOf` の属性・`paint` の呼び出し）、`annotate-note.test.js`（置く → `commitAnnots` 1 回・選ばれる・「本文」にフォーカス、本文の確定で 1 世代・変わらなければ積まない、移動、作成者の覚え）、`annotate-opacity.test.js`（選んでいれば注釈・無ければ道具の値・対象外の種類は断る・`persist`）、`annotation-list.test.js`（行の描画・`.on` の同期・行を押すと `select`＋`goToPage`／`scrollIntoView`・空の案内・モードの切り替えで出し入れ・表示のみの行）、`annotation-props.test.js`（3 行の出し入れ・textarea の blur／Ctrl+Enter → `setContents`・作成者の `change`・不透明度の `change` → `setOpacity`・表示のみの種類）、`annotate-pointer.test.js`（ノートの道具で押すと置く／選んでいる付箋の上は移動／dblclick）、`annotation-layer.test.js`（委譲・`readonly` は描かず枠だけ）、`annotation-import.test.js`（`Text` を `/AP` の有無を問わず拾う・`Popup` は拾わない・`Line` 等は `readonly`・`Link` は拾わない）、`annotate.test.js`（`hitTest` の分岐・`readonly` は当てない・`setColor` を断る）、`shell.test.js`・`thumbnails.test.js`（注釈モードでサムネイルを出さない）、`viewer-controls.test.js`（欄にフォーカスがあれば素通し）、`app.test.js`（`applyOpacities`／`applyAuthor`） |
| 起動確認 | `SIGK_SMOKE_ANNOTATE`（例 `tool:note,note:0:100x700:確認,contents:確認 2 行目,color:#8ce99a,opacity:50,tool:shape,shape:square:0:100x500-300x400,opacity:50,list:1,undo,redo,save`）で、置いたノートの本文・色・不透明度・rect・一覧の行・dirty・履歴・保存後の `/Annots`（`/Text`・`/Popup`・`/CA`）・開き直し後の `importedNotes`（`rotated.pdf` でも）を JSON で出す。開発ツリーと配布物の両方 |

---

## 完了の判定

1. 注釈モードでレールの「ノート」が押せ、サイドパネルが「注釈」の一覧になり、右パネルに「本文」「作成者」「不透明度」の行が出る（モックのとおり）
2. ノートの道具で紙を押すと付箋が置かれて選ばれ、「本文」欄に書いて欄の外を押すと本文が残る。色を選べ、掴んで動かせ、Delete で消え、Ctrl+Z／Y で戻る
3. 付箋は倍率を変えても回転したページでも同じ大きさ・上向きで、`/Rect` の左上を基準に置かれる
4. 一覧に文書内の注釈がページ順に出て、行を押すと該当箇所へ飛んで選ばれる。紙の上で選んだものは一覧でも光る。ページを並べ替えると p.N が追従する
5. 他のツールの `/Line`・FreeText・Polygon 等が一覧に「表示のみ」で出て、選ぶと枠だけ出て、消せる（保存後に `/Annots` から消えている）
6. 不透明度が図形・ペン・テキスト・ノートに効き、画面・印刷・保存（`/CA`・ExtGState）で同じ値になる
7. 上書き保存すると `/Annots` に `/Text` が `/Contents`・`/T`・`/M`・`/CreationDate`・`/C`・`/CA`・`/F 28`・`/Name /Comment`・`/AP /N`・`/Popup` 付きで書かれ、開き直しても同じ位置・色で見え、本文・色・位置を直せる。他のツールのノート（`/AP` の無いものを含む）も見えて直せる
8. `/Rotate 90` のページでも置いた位置に保存され、開き直しても同じ位置・上向き
9. 印刷のプレビューに未保存のノートと不透明度が映る。PDF→画像には映らない（注意書きのまま）
10. 色・不透明度・作成者の最後の値が `settings.json` に残り、次回起動で戻る。作成者が空なら OS のユーザー名
11. `npm test` が緑（`TZ=UTC` でも）。`npm run dist` の配布物でも `SIGK_SMOKE=1` と `SIGK_SMOKE_ANNOTATE` が通る
12. 保存した PDF を他のビューアで開き、付箋が同じ位置・色で見え、本文と作成者が注釈一覧に出て、不透明度が同じに見える（**ユーザーの目視**）

### 人が目で確かめる手順

- 画面の見た目が `screenshots/phase4-notes-list.png`・`-selected.png` と揃っていること。
- マウスで付箋を置き、本文を書き、掴んで動かし、倍率を変えても付箋の大きさが変わらないこと。
- 一覧の行を押すと該当箇所へ飛び、紙の上で押すと一覧の行が光ること。
- 保存した PDF を他のビューアで開き、付箋の位置・色・本文・作成者が同じで、ポップアップが開けること。
- 他のツールで付けた注釈（直線・スタンプ等）が一覧に「表示のみ」で出て、消したものが他のビューアでも消えていること。

---

## ユーザーの確定

### 着手前（2026-09-18。`docs/07` 決定38）

1. 着手する塊は塊④（ロードマップの順序どおり）
2. 塊①〜③の目視（`spec-4-1` 判定10・`spec-4-2` 判定11・`spec-4-3` 判定12）はまだ → 持ち越し
3. 到達点は塊④まるごと（事前調査 → モック → 仕様書と論点の確定 → 実装 → 完了判定 → 配布物の起動確認 → push。PR は指示待ち）

### モック（2026-09-18。`docs/07` 決定39）

4. 本文の書き場所は **A) 右パネルの「本文」欄**（常に出ていて、欄が増えても紙の上を隠さない。B) 紙の上の吹き出し／C) 両方は採らず）
   （`screenshots/phase4-notes-list.png`・`phase4-notes-list-selected.png`）

### 事前調査後（2026-09-18。`docs/07` 決定39。8件とも起草者の推し。括弧内は採らなかった代替）

5. 論点1 ノートの色は黄・緑・青・桃の 4 色（ハイライトと同じ淡い色。付箋の塗りに向く）、既定 黄。アイコンは吹き出し 1 種類で `/Name /Comment`
   （赤・青・緑・黒／アイコンの種類も選べる）
6. 論点2 作成者は右パネルの「作成者」欄で変えられる。既定は OS のユーザー名。`ui.annotAuthor` に残る（OS 名固定で欄を置かない／`/T` を書かない）
7. 論点3 既存の `/Text` は読み込んで直せる（本文・色・位置・削除）。`/AP` の有無を問わず自前の付箋で描く（表示のみ／`/AP` があるものは pdf.js に描かせる）
8. 論点4 「表示のみ」の注釈は一覧に出して消せる。紙の上では選べない（出すが消せない／出さない）
9. 論点5 不透明度は 100・75・50・25% の 4 段。対象は図形・ペン・テキスト・ノート。道具ごとに覚える（ハイライト等も対象／自由な数値）
10. 論点6 一覧はページ順 → 紙の上から下。行はアイコン（注釈の色）・p.N・本文の先頭行か種類名（ページの見出し／作成者・日時の列）
11. 論点7 一覧の複数選択は見送り。選択は 1 つのまま（Ctrl／Shift でまとめて Delete）
12. 論点8 付箋は画面で 20pt 相当（≈27px）固定・常に上向き。保存は `/Rect` 20×20pt＋`/F 28`（倍率に追従して紙と一緒に回す／`/F 4`）

### 起草者の判断で決めたもの

- 押した点を中心に置く。紙の端は中へ寄せる。置いた直後に「本文」欄へフォーカス（確定事項2）
- 本文の確定は blur と Ctrl+Enter。Esc は blur。打鍵ごとには積まない。空の本文を許す（確定事項4・15）
- 付箋の絵（角丸の吹き出し＋しっぽ＋本文の印 2 本。線は濃い灰 1px）と寸法 20pt。画面は `20 × 96/72` px（確定事項8・40）
- `/Popup` の位置と大きさ（アイコンの右隣 180×100pt）、`/Open false`、`/CreationDate` は `/M` と同じ時刻（直すと写しの時刻になる）（確定事項23・24）
- 表示のみの対象（規格の markup annotation）と除外（Link・Widget・Popup 等）、表示のみの entry の形（`kind: 'other'`・`readonly`）（確定事項16・20）
- 不透明度は `<g opacity>` のまま（矢印の先端の数 px の差を許容。事前調査 C）
- 読み込んだ矩形・楕円・直線・矢印・テキスト・ノートの不透明度は 1 扱い（pdf.js が返さない。事前調査 C）
- 一覧は合図のたびに全部組み直す。行の並びの第 2 キーは左から右（確定事項28・29）
- ダブルクリックしたノートは「本文」欄へフォーカス（確定事項7）
- 差し込んだページには「差し込んだページには保存後に付けられます」の帯（塊①と同じ）。暗号化 PDF は付けられるが保存は断る
- モジュールの切り方と名前（「足りない部品」）。起動確認の操作列

---

## 未確定のまま残すもの

| 項目 | 扱い |
|---|---|
| 一覧の複数選択・まとめて削除 | 見送り（論点7）。要望が出たら塊⑤以降 |
| 紙の上の吹き出し（ポップアップ）の表示 | 非対応。本文は右パネル。他のビューアでは `/Popup` を開ける |
| 返信（`/IRT`）・状態（`/State`）・リッチテキスト（`/RC`） | 返信は一覧に別のノートとして平らに出る。返信の付いたノートを消すと返信の `/IRT` が宙に浮く（ビューアは無視する）。書かない |
| 読み込んだ注釈の不透明度 | pdf.js が `opacity` を返すのはハイライトとペンだけ。それ以外は 1 として扱い、直すと `/CA 1` になる（事前調査 C） |
| pdf.js（PDF→画像）の回転ページの付箋 | 紙と一緒に回した付箋を `/Rect` を写した位置に描く（他のビューアと最大 20pt ずれる）。pdf.js の実装による |
| 付箋アイコンの種類（`/Name`）・大きさの変更 | 非対応（`Comment` 固定・20pt 固定） |
| 他のツールの付箋アイコンの絵 | 自前の絵で描く。直すと保存も自前の絵になる |
| 表示のみの注釈の編集・紙の上での選択 | 非対応（一覧から消すだけ） |
| 一覧の絞り込み・並べ替え・作成者や日時の列 | 非対応 |
| 差し込んだページ・暗号化 PDF・サムネイル・PDF→画像 | 塊①と同じ |
