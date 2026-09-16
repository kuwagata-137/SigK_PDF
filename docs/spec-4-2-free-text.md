# 仕様書: Phase 4 塊② 日本語フォント基盤＋フリーテキスト

起草日: 2026-09-16
ステータス: **確定**（2026-09-16 確定。着手前の2件は `docs/07` 決定34、モックの1件と事前調査後の論点10件は `docs/07` 決定35 で
同日ユーザーが決定。11件とも起草者の推し。末尾「ユーザーの確定」を参照。残る細部は起草者の推しで書き、その一覧を
「起草者の判断で決めたもの」に置いた）
関連: `docs/05_開発ロードマップ.md` Phase 4（4-1・4-3）／`docs/01_製品要件定義.md` F-05-3／`docs/04_UI設計.md` 4-3／
`docs/02_アーキテクチャ設計.md` 1-3・1-4（フォントの同梱とサブセット化）・2-3（保存の形）・第3章／
`docs/06_ライセンス・商標チェックリスト.md`（Noto Sans JP の OFL）／`docs/spec-4-1-text-markup.md`（注釈の土台。本書はその上に載る）／
`docs/spec-1-6-save.md`（保存の経路・保存後に開き直す）／`docs/spec-1-4-find-print.md`（印刷の描画経路）

---

## 目的

Phase 4 の2つ目の塊。**注釈モードで「テキスト」の道具を選び、紙の好きな位置を押して日本語を打てる。文字の大きさと色を
選べ、置いた文字を選んで直す・動かす・消す・元に戻せる。保存すると PDF 標準の FreeText 注釈（外観 `/AP` 付き）として
書かれ、他のビューアでも同じ文字が同じ位置に見える**（F-05-3）。

同時に「日本語フォントの埋め込み基盤」（ロードマップ 4-1）を作る。pdf-lib の標準14書体は WinAnsi しか扱えず日本語を
描けないため（`docs/02` 1-4）、Noto Sans JP を同梱し、保存のたびに使った文字だけをサブセットにして埋め込む。この基盤は
塊⑤のテキスト透かし（F-05-8）も同じ口を使う。

塊①（`spec-4-1`）で固めた土台 — 注釈の持ち方（`{ added, removed }`）・1本の履歴・dirty・SVG の層・右パネル・
`/Annots` への書き込み・保存後の開き直し — はそのまま使い、テキストという新しい種類（`kind: 'text'`）を載せる。

---

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| レールの「テキスト」の道具を有効にする（図形・ペン・ノートは灰色のまま） | 図形・フリーハンド・ノート・注釈一覧（塊③④） |
| 押した位置に文字を置く。箱は文字に合わせて自動で広がる（改行は Enter。論点5） | 自動折り返し・箱の大きさの手動変更・縦書き |
| 文字の大きさ（プリセット）と色（プリセット）。最後の値を `settings.json` に覚える（論点9・10） | 太字・斜体・別の書体（Noto Sans JP Regular の1書体に固定）・自由な色 |
| 置いた文字を選ぶ・直す（ダブルクリック／Enter）・掴んで動かす（論点7）・Delete で消す・Ctrl+Z で戻す | 矢印キーでの移動・複数選択・コピー＆ペースト |
| 自分で付けたテキストは保存後も読み込んで直せる（論点3。`/DA` のフォント名で見分ける） | 他のツールが作った FreeText の編集（表示のみ。pdf.js が描く。論点8） |
| 保存: `/Subtype /FreeText`・`/Rect`・`/Contents`・`/DA`・`/Rotate`・**`/AP /N`（Noto のサブセットを `/Resources /Font` に）**。抽出にも付いていく | `/DS`・`/RC`（リッチテキスト）・`/IT`・`/CL`（引き出し線）・枠線・背景色 |
| Noto Sans JP の同梱（`assets/fonts/`。論点1）と `THIRD-PARTY-NOTICES.md`・`docs/06` の更新 | フォントの選択・OS のフォントの利用 |
| 画面も同じ Noto を `@font-face` で使う（論点2） | 未対応文字（絵文字・稀な漢字）の警告（豆腐のまま） |
| 印刷に未保存のテキストが映る（塊①の 33-⑦ と同じ） | PDF→画像（読み直して描くので映らない。`spec-3-3` 確定事項1 のまま） |
| fontkit の TTF サブセットの不具合の回避（事前調査 B。奇数長のグリフを詰める） | pdf-lib・fontkit の版上げ（どちらも凍結された版。1.17.1・1.1.1 に固定） |
| `annotate.js` 344 行の分割（押し離し・テキストの操作・プリセットを別モジュールへ。`docs/07` 積み残し） | `page-render.js` 270 行の分割（積み残しのまま） |
| 起動確認 `SIGK_SMOKE_ANNOTATE` にテキストの操作を足す | 差し込んだページ・暗号化 PDF・サムネイル・PDF→画像の扱いの変更（塊①と同じ） |

---

## 事前調査（2026-09-16・Windows 11 実機・Node 22・Electron 44・pdf.js 6.3.289・pdf-lib 1.17.1・@pdf-lib/fontkit 1.1.1・fixtures のみ）

プローブは scratchpad の使い捨て（Node で pdf-lib＋fontkit を回すもの、Chromium で pdf.js と DOM を回すもの）。検体は
`test/fixtures/` の `three-pages.pdf`・`rotated.pdf`・`huge-pages.pdf`（1,000 ページ）。記録後に捨てた。

### A. フォントの入手と読み込み経路

| 候補 | 中身 | 評価 |
|---|---|---|
| **Google Fonts v56 の静的 TTF `NotoSansJP-Regular.ttf`** | 5,472,784 バイト。TrueType（glyf）。Version 2.004-H2。sha256 `d930d5d5…caec`。同梱の `OFL.txt`（4,481 バイト。「Copyright 2014-2021 Adobe, with Reserved Font Name 'Source'」）と `README.txt` | **採用**（B で全グリフが正しく出た） |
| 公式 notofonts/noto-cjk の OTF `Sans/SubsetOTF/JP/NotoSansJP-Regular.otf` | 4,533,028 バイト。CFF（CID キー付き）。Version 2.004。sha256 `dff723ba…5073` | 却下（B でカタカナが化けた） |
| npm `@fontsource/noto-sans-jp` 5.3.0 | 2,319 ファイル・80MB。woff2 を unicode-range で 1,125 本に割った配布で、単一の TTF／OTF が無い | 却下（`scripts/vendor.js` に足す形は取れない） |
| OS のフォント（游ゴシック等） | 再配布・埋め込みの許諾が無い | 却下（`docs/06`） |

読み込みの経路（ワーカーはタスクごとに fork されるので、**素の Node の新プロセス**で 3 回測った）:
`require(vendor/fontkit.umd.min.js)` 43ms／TTF の `readFileSync` 3.5ms／`fontkit.create()`＋`layout()` 16ms／
`embedFont`＋`embed()`（7 文字）27〜35ms。RSS の増分は pdf-lib 込みで +40MB。**テキスト注釈のある保存に約 90ms 足す**だけで、
無い保存には影響しない（フォントは要るときだけ読む。確定事項22）。asar の中から読めるかは配布物の起動確認で確かめる
（`spec-1-6` で `utilityProcess` が asar から `require` できることは実証済み）。

### B. pdf-lib ＋ fontkit のサブセット埋め込み — 不具合を 2 つ見つけた

`doc.registerFontkit(fontkit)` → `embedFont(bytes, { subset: true, customName })` → FreeText の `/AP`（Form XObject の
`/Resources /Font << /SigKJP ref >>`）に `BT /SigKJP 12 Tf <hex> Tj ET` で描いて保存。`three-pages.pdf` に 1 文字／100 文字
（かな・カナ・英数・漢字の混在）／1,000 文字、`huge-pages.pdf` に 5 文字を 1 個／10 個。

| 文字数 | TTF: サブセット／出力の増分／save | OTF: サブセット／増分／save |
|---|---|---|
| 1 | 542 B／3,055 B／9ms | 1,749 B／4,287 B／21ms |
| 100 | 15,244 B／19,458 B／11ms | 19,906 B／24,144 B／26ms |
| 1,000 | 104,780 B／122,582 B／32ms | 130,868 B／148,694 B／79ms |
| 1,000 ページに 5 文字 ×1 | 1,026 B／save 910ms（何も付けない保存 884ms。**+26ms**） | 17,182 B／906ms |
| 同 ×10（100 ページごと） | +4,892 B（1 個 ≈ 540 B）／920ms | 886ms |

- `embedFont` 自体は 6〜13ms。`subset: false` だと +3,311,617 バイト（`docs/02` 1-4 のとおりサブセット化は必須）。
- **2 回目の保存**（出力を読み直して別の文字を足す）: フォントの辞書が 1 組（`/Type0`＋`/CIDFontType2`＋記述子）と
  `FontFile2` が 1 本増えるだけ。TTF は +3,595 バイト（11 文字）。前回の注釈は触らない（確定事項24）。
- **抽出**: `copyPages` は先に `srcDoc.flush()` を呼ぶので、フォントの辞書は明示の `embed()` 無しでも抽出先に付いていく
  （両方で確認）。それでも `applyAnnotations` の末尾で `font.embed()` を呼んで、後続が「辞書は context にある」前提で書ける
  ようにする（確定事項23）。
- API: `PDFHexString.asString()`（`<>` 無しの hex）、`PDFFont.embed()`、`PDFFont.ref`、`pdfFont.embedder.font`（fontkit の
  Font。`ascent` 1160）がある。`widthOfTextAtSize('あ', 12)` = 12（全角は 1em）、`heightAtSize(12)` = 17.376（descender 込み）。
- 計量（TTF・OTF とも同じ）: unitsPerEm 1000、hhea ascent 1160／descent −288／lineGap 0、OS/2 typo 880／−120／0
  （USE_TYPO_METRICS は立っていない）、win 1160／288、capHeight 733、xHeight 543。グリフ数 TTF 17,103・OTF 17,936。
  `😀` は gid 0（豆腐）、`𠮷`（U+20BB7）・`𠀋` は字がある。落ちない。

**不具合1（TTF）: fontkit の TTF サブセットは、`loca` を短い形式（offset/2）で書くとき奇数長のグリフを詰めない。**
`preEncode` が `offsets[i] >>>= 1` と切り捨てるだけなので、奇数長のグリフの次から 1 バイトずれ、pdf.js は壊れたグリフを
空白にする。100 文字の検体では 101 グリフ中 45 個が「Trying to access beyond buffer length」で読めず、画面では
「ぁあ　う　き　こごさざし…」と歯抜けになった。サブセットが 64KB を超えると長い形式になって症状が消えるため、**短い
文字列ほど壊れる**。Google Fonts の TTF は奇数長のグリフを普通に含む（`ぃ` は 147 バイト）。
→ **回避策**: `registerFontkit` へ渡す fontkit を包み、`createSubset()` が返すサブセットの `_addGlyph` を「元の処理のあと、
奇数長なら 1 バイト詰めて `offset` を 1 進める」形に差し替える（fontkit が同梱する Buffer 実装で `concat` する。Node の
Buffer は弾かれる）。101 グリフすべてが読め、pdf.js で全文字が出た。増分は 1 文字 −140 B・100 文字 +17 B・1,000 文字
+131 B（詰めた分だけ）。pdf-lib・fontkit とも凍結された版（1.17.1・1.1.1）なので、内部の名前に依存する回避策でも
版上げで壊れる心配は無い。テストで見張る（確定事項22）。

**不具合2（OTF）: CID キー付き CFF のサブセットでカタカナが化ける**（「ア」「イ」が消え「エ」が四角になる）。fontkit の
CFF サブセットの FDSelect まわりの既知の弱さで、回避が重い。→ **OTF は使わず TTF にする**（論点1 の TTF／OTF の判断）。

### C. pdf.js の FreeText

B の検体を Browser パネルの pdf.js で開いた。

- `getAnnotations()` は FreeText について `subtype`・`rect`・**`rotation`**（`/Rotate` から）・`hasAppearance`・
  `contentsObj.str`（改行は `\n` のまま）・**`defaultAppearanceData { fontName, fontSize, fontColor }`**（`/DA` から。`/AP` が
  あると `fontSize`・`fontColor` は `/AP` から読み直されるが、**`fontName` は `/DA` の `SigKJP` のまま来る**）・`color`
  （`/C` を書かないので `null`）・`textContent`・`isEditable` を返す。→ **`fontName === 'SigKJP'` で自分の注釈を見分けられる**
  （確定事項13）。
- `ENABLE_STORAGE` ＋ `annotationStorage.setValue(id, { noView: true })` で FreeText も個別に隠せる（注釈の矩形内の暗い画素
  1,854 → 0）。塊①の `annotation-import` の経路がそのまま使える。
- **回転**: `/Rotate 90` のページに、pdf.js の `FreeTextAnnotation.createNewAppearanceStream` と同じ式（`cm` の回転行列＋
  回転後の座標での clip と起点）で描き `/Rotate 90` を書くと、表示で**左上に上向き**に読める。回転を考えずに描くと横倒し
  になる（右上に縦に並ぶ）。→ pdf.js と同じ約束にする（確定事項11）。
- `/AP` の無い FreeText（他のツール由来。`/DA /Helv`）は pdf.js が代替フォントで描く（青い文字が出た）。→ 表示のみで
  済む（論点8）。
- 描画時間はページあたり 15〜30ms で、テキストマークアップと変わらない。

### D. 紙の上の文字入力

- `@font-face` で同梱の TTF を `font-src 'self'` の下から読む: `document.fonts.load()` が **39ms**。
- canvas の `measureText`（Noto）と pdf-lib の `widthOfTextAtSize` は、日本語で**一致**（「あいうえお」60＝60、「日本語テキストの
  幅を測る 123」166.668＝166.668）、英字は −0.5%（「The quick brown fox jumps」150.08 vs 150.83。ヒンティングの丸め）。
  游ゴシック UI で測ると −22%（46.6 vs 60）。→ **画面も Noto でなければ箱の大きさが保存後に変わる**（論点2）。
- Chromium は Noto Sans JP の hhea（1160／−288）を使う: 12px で ascent 14px・descent 3px。`line-height: 1.25` の行箱（15px）
  より字面（17.4px）が大きく、textarea は 2 行 24px で clientHeight 60・scrollHeight 62 と 2px はみ出す。→ 高さは
  `scrollHeight` で合わせる。ベースラインは行の上端から `(LINE_HEIGHT − (asc + desc)) / 2 + asc` ＝ **1.061em**（確定事項19）。
- `keydown` の `event.target.closest('.free-text-editor')` は入力欄の中のキーだけを見分ける（Ctrl+Z・Esc は true、紙の上の
  Delete は false）。→ `viewer-controls.js` の 1 行で済む（確定事項8）。
- IME の変換中の Enter／Esc は `event.isComposing` で見分ける（Chromium の既定。実機の起動確認で確かめる）。

### E. 印刷の重ね描き

150dpi（倍率 2.083）で、pdf.js が `/AP` を描いた画素と、`/AP` を隠して canvas の `fillText`（同じ Noto・同じベースライン）で
描いた画素を比べた: 外接矩形が一致（dx 0・dy 0・幅と高さの差 0）、暗い画素数も 65 で同じ。→ 塊①と同じ `overlay` の口で
映せる（確定事項29）。フォントは印刷の前に `document.fonts.load()` を待つ。

---

## 確定事項

### A. 画面（`docs/04` 4-3・モック `screenshots/phase4-free-text.png`）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 道具 | レールの「テキスト」を有効にする（`data-tool="text"`。`aria-disabled` を外す）。図形・ペン・ノートは灰色のまま。押している間は `.active`。テキストの道具を持っているとき、テキストレイヤーの上のカーソルは `text` |
| 2 | 右パネル | 塊①の欄に **「文字の大きさ」の行（`<select>`）** を足す。テキストの道具を持っているとき、またはテキスト注釈を選んでいるときだけ出す。「対象の文字」の行はテキスト注釈では「本文」と読み替えて本文（先頭 200 字）を出す。ヒントはテキスト用の文言（置き方・確定の仕方・移動・削除） |
| 3 | 置く操作（論点5） | テキストの道具を持って、注釈も文字選択も無い場所を**押して離す**（動かない）→ その点を箱の左上として入力欄（`<textarea>`）を出し、フォーカスする。**箱は文字に合わせて自動で広がる**（幅＝最長行の幅＋余白、高さ＝行数×行送り＋余白）。折り返しは無く、Enter で改行。文字選択があるときはテキストの道具を押しても何も作らない（マークアップの「先に選んでから道具」はマークアップだけ） |
| 4 | 確定と取り消し（論点6） | **枠の外を押す・Esc・Ctrl+Enter で確定**。Enter は改行。IME の変換中（`isComposing`）の Enter／Esc は入力欄に任せる。**空（空白だけ）で確定したら注釈を作らない**（既存の注釈を空にしたら削除として積む） |
| 5 | 直す | 置いた文字を**ダブルクリック**、または選んでいるときに **Enter** で入力欄を開く。開いている間、その注釈は SVG に描かない（入力欄が代わり）。確定して文字・大きさ・色が変わっていなければ履歴に積まない |
| 6 | 選ぶ・動かす（論点7） | 押して離すと選ぶ（塊①の `hitTest`。箱を 1 つの四角として当てる）。**選んだテキストを掴んでドラッグすると動く**（離したときに 1 世代）。掴んだときは `preventDefault()` で文字選択を始めさせない。大きさの手動変更は無い（自動なので要らない） |
| 7 | 消す・解除 | Delete で消す、Esc で解除（塊①の確定事項7 と同じ）。入力欄が開いているときは先に確定してから（確定事項8） |
| 8 | キーの調停 | `viewer-controls.handleKey` は **`event.target.closest('.free-text-editor')` なら何もしない**（Ctrl+Z／Y は入力欄の素の取り消し、Delete・Esc・PageUp 等も奪わない）。Ctrl+Tab・Ctrl+W・Ctrl+S・Ctrl+P・モード切替・タブ切替・開き直し・印刷・抽出の前に **`annotate.finishEditing()`**（確定して閉じる。取り消しではない）を 1 本の口で呼ぶ |
| 9 | 入力欄の生き残り | 入力欄の下書き `{ id\|null, src, index, origin(pt), text, fontSize, color, rotation }` は **DOM ではなく `free-text-editor.js` の状態が真**。スクロール・倍率変更で `.pdf-page` の枠が捨てられても（`page-render.releasePage`）下書きは残り、枠が戻ったら再マウントする（フォーカスは戻さない）。`page-render.js` に `onPageRendered(index, node, viewport)`／`onPageReleased(index)` のフック 2 行 |
| 10 | 見た目 | 入力欄は破線の枠（`--accent`）・背景は透明・`white-space: pre`・`resize: none`。確定後は SVG の `<text>`（`font-family: 'SigK Noto Sans JP'`）。選択中は塊①と同じ破線の枠。モック `screenshots/phase4-free-text.png` |

### B. 座標と回転（事前調査 C・D）

| # | 項目 | 決定 |
|---|---|---|
| 11 | `rotation` | 置いたときの**表示の回転**（`viewport.rotation` ＝ 紙の `/Rotate` ＋ ページ編集の回転）を entry に持つ（0・90・180・270）。あとでページを回転させても値は変えない（紙に貼った文字は紙と一緒に回る）。画面の角度は `(viewport.rotation − rotation) mod 360` |
| 12 | 箱の四隅 | `rect`（紙の座標 pt）は、表示で見えた左上の点 `origin` と箱の大きさ `size`（表示の向きでの幅・高さ）を `rotation` で紙の座標へ回して作る（`free-text-geometry.rectFromOrigin`）。逆の `frameOrigin(rect, rotation)` と往復できる。`quads` は `rect` の四隅を 1 つ持つ（塊①の当たり判定・選択枠・検証がそのまま通る） |
| 13 | 読み込み | 文書を開いたとき、`getAnnotations()` の FreeText のうち **`defaultAppearanceData.fontName === 'SigKJP'` のものだけ**を `{ ref, src, kind: 'text', color, text: contentsObj.str, fontSize, rotation, rect, quads }` で拾い、`noView` で pdf.js に描かせず自前で描く（論点3）。他の FreeText は拾わない（pdf.js が描く。論点8） |
| 14 | 幅の計測 | 画面は canvas の `measureText`（Noto を先読みしてから）、保存はワーカーの `widthOfTextAtSize`。日本語は一致、英字は 0.5% 以内の差（事前調査 D）。ワーカーは念のため `/Rect` を右へ 1pt 伸ばす（確定事項18） |

### C. 注釈の持ち方と履歴（`spec-4-1` C を広げる）

| # | 項目 | 決定 |
|---|---|---|
| 15 | entry | `{ id, src, kind: 'text', color, opacity: 1, quads: [箱の四角], rect, text, fontSize, rotation }`。`KINDS` に `'text'` を足し、`MARKUP_KINDS`（3 種）を分けて公開する。`validEntry` は text なら `text` が空でない文字列・`fontSize` が正の有限・`rotation ∈ {0,90,180,270}`・`quads.length === 1` を足す |
| 16 | 変える口 | `recolorAnnot` を **`updateAnnot(annots, target, patch)`** に一般化（`patch` は `color`・`text`・`fontSize`・`rect`・`quads` のうち渡された欄）。自前は書き換え、読み込んだもの（`ref`）は「元を `removed` に足し、写しを `added` に足す」（塊①と同じ）。`recolorAnnot` は互換のため残す |
| 17 | dirty | `sameAnnots` を **欄ごとの比較**に広げる（`id`・`src`・`kind`・`color`・`opacity`・`text`・`fontSize`・`rotation`・`rect`）。「同じ id で四角だけ変わる操作は無い」という塊①の前提は、移動と編集で崩れるため |
| 18 | 保存の形 | `toSaveSpec` は kind で写し方を分ける: markup は `{ src, kind, color, opacity, quads, rect }`（従来どおり）、text は `{ src, kind, color, opacity, rect, text, fontSize, rotation }`（quads は落とす）。ワーカーは text の `/Rect` を右へ 1pt 伸ばして書く（確定事項14） |
| 19 | 行の寸法の定数 | `FONT_ASCENT = 1.16`・`FONT_DESCENT = 0.288`（hhea）・`LINE_HEIGHT = 1.25`・`BASELINE = 1.061`（`(1.25 − 1.448) / 2 + 1.16`）・`PADDING = 2`（pt。上下左右）。renderer（`free-text-geometry.js`）と worker（`free-text-appearance.js`）に同じ値を持ち、**一致をテストで見張る**（プロセスが違うので import できない。`settings.test.js` が `ANNOT_COLORS` を見張るのと同じ流儀） |
| 20 | 履歴 | 「置いて確定」「直して確定（変わったときだけ）」「動かす」「大きさ・色を変える」「消す」で 1 世代ずつ、塊①の `commitAnnots` に載せる。入力欄の中の打ち直しは textarea の素の Ctrl+Z |
| 21 | 覚える値 | `settings.json` の `ui.annotColors.text`（塊①の経路に kind を足す）と **`ui.annotFontSize`**（新キー。`pickUi/mergeUi`）。起動時に `annotate.applyColors`／`applyFontSize` |

### D. フォント基盤とワーカー（事前調査 A・B）

| # | 項目 | 決定 |
|---|---|---|
| 22 | `worker/font-embed.js` | `vendor/fontkit.umd.min.js` を `require` し、**不具合1 の回避策で包んで** `doc.registerFontkit` に渡す。`assets/fonts/NotoSansJP-Regular.ttf` を `toBytes()` で読み、`embedFont(bytes, { subset: true, customName: '<乱数6大文字>+NotoSansJP-Regular' })`。**`add[]` に `kind: 'text'` があるときだけ**、保存 1 回につき 1 度（`embedFont` を呼ぶと文字が無くても空のサブセットが埋まるため）。純関数へは「文字を知る口」`measure = { name: 'SigKJP', encode(line) → hex, width(line, size) → pt }` を渡す（サブセットは `encodeText` を通したグリフからしか作られないので、`/AP` に書く行は必ず `encode` を通す）。読めなければ `{ error: '日本語フォントを読めなかったため、テキスト注釈を保存できません。' }` |
| 23 | `applyAnnotations` の async 化 | `applyAnnotations(doc, { add, remove }, tools, { now, fontSource })` を `async` にし、検証 → フォント（要るときだけ）→ 外観 → `removeAnnotations` → `addAnnotation` → **`await font.embed()`** の順。呼び出し元 `pdf-task.js` の `applyForSave`／`applyForExtract` は `await` を足すだけ（既に async）。`fontSource` は `pdf-task.js` が `createFontSource({ fsLike })` で作って渡す（vendor・assets へのパスを op 層に持たせない） |
| 24 | 2 回目以降の保存（論点4） | 保存ごとに、その保存で足したテキストの分だけの 1 サブセット（辞書 1 組＋`FontFile2` 1 本。事前調査 B）。前回までの注釈は触らない。編集・削除で古い `/AP` を消してもフォント本体は残る（他の注釈と共有かもしれないので消さない）。増分は既知の限界として書く |
| 25 | 注釈の辞書 | `/Type /Annot`・`/Subtype /FreeText`・`/Rect`・**`/Contents`（`PDFHexString.fromText`。UTF-16BE。改行は `\n`）**・**`/DA (/SigKJP <size> Tf r g b rg)`**・`/Border [0 0 0]`・`/Rotate <rotation>`（0 のときは書かない）・`/F 4`・`/NM sigk-…`・`/P`・`/M`・`/CA 1`・`/AP << /N ref >>`。**書かないもの**: `/C`（ビューアによっては箱の背景色に使う）・`/DS`・`/RC`・`/IT`・`/Q`・`/QuadPoints`。`PDFString.of` は 1 バイト文字用で日本語が壊れるので使わない |
| 26 | 外観 `/AP /N` | Form XObject。`BBox` ＝ `/Rect`、`Matrix` 無し（塊①と同じ「紙の座標をそのまま書く」流儀）、`Resources: { Font: { SigKJP: fontRef }, ExtGState: { GS } }`。content は pdf.js と同じ式: `q` → `rotation` の `cm`（90: `0 1 -1 0`、180: `-1 0 0 -1`、270: `0 -1 1 0`）→ 回転後の座標での `re W n` → `BT rg Tf TL Td <hex> Tj (T* <hex> Tj)… ET Q`。1 行目のベースラインは枠の上端から `PADDING + BASELINE × size` |
| 27 | 純関数の境界 | `worker/free-text-appearance.js` は pdf-lib を知らず、`measure` を受け取って content stream の文字列と `bbox`・`da` を返す。`frameOf(rect, rotation)`（4 方向の `cm`・clip・起点）と `textBlockOps({ lines, fontSize, rgb, origin, matrix }, measure)` を分けて公開し、塊⑤の透かし（任意の角度の行列）も同じ口に載せる |
| 28 | 消すとき | `annotation-remove.js`（`op-annotate.js` から切り出す）の `deleteAnnot` は塊①と同じく `/AP /N` と `/Popup` を消す。フォントは消さない（確定事項24） |

### E. 印刷・PDF→画像（`spec-4-1` E と同じ）

| # | 項目 | 決定 |
|---|---|---|
| 29 | 印刷 | `annotation-layer.paint` が text を `free-text-shape.paint(ctx, entry, viewport)` に委ね、SVG と同じ位置・角度で `fillText`（事前調査 E で `/AP` と画素が一致）。`print.js` は準備の前に `freeTextShape.ensureLoaded()` を `await` |
| 30 | PDF→画像 | 映らない（読み直して描く。`spec-3-3` 確定事項1・塊①の 33-⑦ のまま） |

### F. 同梱と告知（`docs/06`）

| # | 項目 | 決定 |
|---|---|---|
| 31 | 置き場（論点1） | `assets/fonts/NotoSansJP-Regular.ttf`（5.2MB）と `assets/fonts/OFL.txt` をリポジトリに置く（`docs/02` 第3章のツリー案。`.gitattributes` は `*.ttf binary` 済み）。`package.json` の `build.files` は `assets/**` を含むので追記なしで配布物に入る。`test/dist-files.test.js` の「ワーカーが `path.join` で読むもの」に `vendor/fontkit.umd.min.js`・`assets/fonts/NotoSansJP-Regular.ttf` を足す |
| 32 | 告知 | `scripts/notices.js` の `BUNDLED_COMPONENTS` に `{ name: 'Noto Sans JP', license: 'SIL Open Font License 1.1', files: ['assets/fonts/OFL.txt'] }` を足し、「今後追加するもの」の予定行を消して `npm run notices` で `THIRD-PARTY-NOTICES.md` を生成し直す。`docs/06` の行を「同梱済み」に。同じコミットで行う |
| 33 | 画面のフォント（論点2） | `renderer/shell.css` の `@font-face { font-family: 'SigK Noto Sans JP'; src: url('../assets/fonts/NotoSansJP-Regular.ttf') }`。CSP `font-src 'self'` と `.ttf` の MIME は `security-policy.js` に既にある。注釈モードに入ったとき・自前のテキストを読み込んだとき・印刷の前に `document.fonts.load()` で先読み（39ms） |

### G. プリセット（論点9・10）

| # | 項目 | 決定 |
|---|---|---|
| 34 | 文字の大きさ | `[8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]` pt の `<select>`。既定 **12**。`ui.annotFontSize` に覚える |
| 35 | 色 | 黒 `#1c2430`・赤 `#d92c2c`・青 `#2c5cd9`（下線と同じ 3 色）。既定 **黒**。`ui.annotColors.text` に覚える。`ANNOT_COLORS` と `annotation-presets.js` の一致を `settings.test.js` が見張る |

---

## 足りない部品

### 新しいモジュール（テストは `test/<module>.test.js` と 1 対 1）

| ファイル | 層 | 役目 |
|---|---|---|
| `assets/fonts/NotoSansJP-Regular.ttf`・`assets/fonts/OFL.txt` | 資産 | 同梱フォントと許諾（確定事項31・32） |
| `worker/font-embed.js` | ワーカー | `createFontSource({ fsLike, fontkit, fontPath })`・`embedBundledFont(doc, fontSource)` → `{ font, measure }`／`{ error }`・`measureOf(pdfFont)`・`paddedFontkit(fontkit)`（不具合1 の回避）・`subsetTag()`・`FONT_PATH`・`DA_FONT_NAME` |
| `worker/free-text-appearance.js` | 純関数 | `LINE_HEIGHT`・`BASELINE`・`PADDING`・`frameOf(rect, rotation)`・`textBlockOps(...)`・`freeTextAppearanceOf(entry, measure)` → `{ content, bbox, rect, da, subtype: 'FreeText', rgb, opacity }` |
| `worker/annotation-remove.js` | ワーカー | `parseRef`・`sameRef`・`deleteAnnot`・`removeAnnotations`（`op-annotate.js` から移す。FreeText で 200 行を超えるため） |
| `renderer/annotation-presets.js` | 純関数 | `TOOLS`・`MARKUP_TOOLS`・`TOOL_LABELS`・`COLORS`（`text` を追加）・`COLOR_NAMES`・`DEFAULT_COLORS`・`FONT_SIZES`・`DEFAULT_FONT_SIZE`・`isPresetColor`・`isFontSize`（`annotate.js` から出す。`SigK.annotate` は互換のため同名で再公開） |
| `renderer/free-text-geometry.js` | 純関数 | 定数（worker と同値）・`quadOfRect`・`rectFromOrigin(origin, size, rotation)`・`frameOrigin(rect, rotation)`・`frameSize(rect, rotation)`・`screenAngle(viewportRotation, rotation)`・`boxOfLines(lines, fontSize, widthOf)` |
| `renderer/free-text-shape.js` | 画面 | `FAMILY`・`ensureLoaded(doc)`・`measure(doc, text, px)`（canvas。jsdom では `0.5em／1em` の見積もり）・`svgOf(doc, entry, viewport)`（`<g transform><text><tspan>`）・`paint(ctx, entry, viewport)` |
| `renderer/free-text-editor.js` | 画面 | 下書きの状態・`begin(draft)`・`onPageRendered/onPageReleased`・`mount/unmount`・`autosize`・`finish({ commit })`・`cancel`・`isEditing`・document の `mousedown` capture・textarea の keydown（Esc／Ctrl+Enter／`isComposing`） |
| `renderer/annotate-pointer.js` | 画面 | `annotate.js` の押し離しを移し、`mousedown/mousemove/mouseup/dblclick` を `#view` に結ぶ。当たり判定・作成（マークアップ）・配置（テキスト）・編集・ドラッグ移動の振り分け。`CLICK_SLOP` |
| `renderer/annotate-text.js` | 指揮 | `place({ index, src, point })`・`beginEdit(key)`・`commitDraft(draft)`（add／update／削除を決めて `commitAnnots`）・`move(key, delta)`・`setFontSize(size)`・`finishEditing()` |

### 既存への追記

| ファイル | 変更 |
|---|---|
| `renderer/annotate.js`（344 → 約 210 行） | 押し離し・プリセット・テキストの操作を出す。`toggleTool` は `MARKUP_TOOLS` のときだけ選択から作る。`state.fontSize`・`applyFontSize`・`rememberFontSize`。`finishEditing` を公開。`escape()` は編集中なら確定 |
| `renderer/annotation-state.js` | 確定事項15〜18 |
| `renderer/annotation-layer.js` | `draw` は `entry.kind === 'text'` を `freeTextShape.svgOf` へ、`paint` も委譲。`{ selected, editing }`（編集中は描かない） |
| `renderer/annotation-props.js`・`index.html` | 「文字の大きさ」の行（`<select id="props-size">`）。`HINTS.text`・`HINTS.textSelected`。`renderSwatches('text', …)`。「対象の文字」→「本文」の読み替え |
| `renderer/annotation-import.js` | `SUBTYPES` に `FreeText`（`fontName === 'SigKJP'` のときだけ）。`quadPoints` 無しの経路（`rect` から `quadOfRect`） |
| `renderer/page-render.js` | フック 2 行（確定事項9） |
| `renderer/viewer-controls.js` | 1 行の除外（確定事項8） |
| `renderer/viewer.js`・`save.js`・`extract.js`・`print.js`・`tabs.js`・`shell.js` | `annotate.finishEditing()` を先に呼ぶ。`print.js` は `ensureLoaded` を `await` |
| `renderer/app.js` | `applyFontSize(result.ui.annotFontSize)`。`freeTextEditor.init`・`annotatePointer.init` |
| `renderer/shell.css` | `@font-face`・`.free-text-editor`・`.free-text`・`.props-select`・`html[data-tool="text"] .textLayer{cursor:text}` |
| `index.html` | L97 の `aria-disabled` を外し `data-tool="text"`。`<script>` 6 本 |
| `worker/op-annotate.js` | async・kind 分岐（`Contents`・`DA`・`Border`・`Rotate`・`Resources.Font`）・`flush`・`annotation-remove.js` への切り出し |
| `worker/pdf-task.js` | `fontSource` を渡す。`await` |
| `settings.js` | `DEFAULTS.annotColors.text`・`ANNOT_COLORS.text`・`DEFAULTS.annotFontSize: 12`・`FONT_SIZES`・`pickUi/mergeUi` |
| `scripts/notices.js`・`THIRD-PARTY-NOTICES.md`・`docs/06` | 確定事項32 |
| `test/dist-files.test.js` | `runtime` に `vendor/fontkit.umd.min.js`・`assets/fonts/NotoSansJP-Regular.ttf` |
| `test/shell.test.js` | 有効 4（`text` を含む）・灰色 3 |
| `test/settings.test.js` | `text` の既定色・`annotFontSize` の丸め・`annotation-presets` との一致 |
| `test/harness.js` | `createPdfjsStub({ annotations })` の FreeText の形（`contentsObj`・`defaultAppearanceData`・`rotation`）、`settingsAPI.setUi` の `annotFontSize` |
| `test/op-annotate.test.js`・`test/pdf-task.test.js` | `await`。FreeText の往復（下記） |
| `main.js` | `annotateScript` に `text:<page>:<x>x<y>:<文字>`（置く→打つ→確定）・`edit:<文字>`・`size:<pt>`・`drag:<dx>x<dy>`。結果に `texts`・`fontLoaded`・`importedTexts`（保存→開き直し後）・`fonts`（保存先の `/Type0` の数） |
| `docs/02`（1-3 の fontkit 行を「ワーカーが require」へ・2-3・第3章のツリー・現在地）・`docs/04`（4-3 追記・第3章の表）・`docs/05`・`docs/07`・`README.md` | 現在地 |

依存は増えない（fontkit は devDependencies 済み。`vendor/fontkit.umd.min.js` は `scripts/vendor.js` が既に複製している）。
`THIRD-PARTY-NOTICES.md` に Noto Sans JP の節が増える。

---

## テストの範囲

| 層 | 対象 |
|---|---|
| 依存なし | `worker/font-embed.js`（本物の TTF で `embedBundledFont` → `measure.encode('あ')` が 4 桁 hex、`width('あ', 12)` が 12、`embed()` 後に `/Type0` が 1 つ、text が無ければ埋めない、読めなければ `{ error }`、**奇数長のグリフを詰めた結果を読み直して全グリフが読める**）、`worker/free-text-appearance.js`（4 方向の `frameOf`、行割り、content の文字列、`da`、`/Rect` の伸ばし、定数の値）、`worker/op-annotate.js`（保存して読み直し: `/Subtype /FreeText`・`/DA`・`/Contents` が `FEFF` 始まりの hex・`/AP /N /Resources /Font /SigKJP`・`/Rotate`、3 個足してもフォント辞書は 1 組、text が無ければフォント無し、2 回目の保存で 1 組増える、抽出先にフォントごと付いていく、フォントが読めないときの `{ error }`）、`worker/annotation-remove.js`（既存テストを移す）、`renderer/free-text-geometry.js`（`rectFromOrigin`⇄`frameOrigin` の往復、harness の 4 回転 viewport で `screenAngle`、`boxOfLines`）、`renderer/annotation-state.js`（text の `validEntry`・`updateAnnot`・欄ごとの `sameAnnots`・kind 別の `toSaveSpec`）、`renderer/annotation-presets.js`＋`settings.js`（一致・既定・丸め） |
| jsdom | `free-text-editor.test.js`（置く→`input`→確定で `commitAnnots` が 1 回、Esc・Ctrl+Enter・枠の外、空で消える、`onPageReleased`→`onPageRendered` で下書きが生き残る、`isComposing` の Enter を無視）、`annotate-pointer.test.js`（押し離し・ダブルクリック・ドラッグ移動）、`annotate-text.test.js`（add／update／削除の振り分け、大きさ・色、`finishEditing`）、`free-text-shape.test.js`（SVG の `<text>` の位置と `transform`、`paint` の呼び出し）、`annotation-layer.test.js`・`annotation-props.test.js`・`annotation-import.test.js`（自分の FreeText を拾う／他は拾わない）・`viewer-controls.test.js`（入力欄の中では奪わない）・`page-render.test.js`（フック）・`annotate.test.js`（既存の追随。`toggleTool` はマークアップだけ）・`shell.test.js`・`print.test.js`・`save.test.js`／`extract.test.js`（先に確定） |
| 起動確認 | `SIGK_SMOKE_ANNOTATE`（例 `page:2,text:1:100x600:こんにちは,size:14,color:#d92c2c,drag:20x0,save`）で、置いた文字・大きさ・色・位置・dirty・履歴・保存後の `/Annots` と `/Type0` の数・開き直し後の `importedTexts`（`rotated.pdf` で `rotation: 90`）を JSON で出す。開発ツリーと配布物の両方 |

---

## 完了の判定

1. 注釈モードでレールの「テキスト」が押せ（図形・ペン・ノートは灰色）、右パネルに「文字の大きさ」の行が出る（モックのとおり）
2. テキストの道具で紙を押すと入力欄が出て、日本語を打って枠の外を押すと文字が置かれ、箱が文字に合わせて広がる
3. 置いた文字を押すと枠とプロパティ（本文・大きさ・色）が出て、大きさと色を変えられ、掴んで動かせ、ダブルクリックで直せ、Delete で消える
4. Ctrl+Z／Ctrl+Y で配置・編集・移動・削除が戻り、ページ編集と交互に行っても順に戻る。タブの点と「変更あり」が連動する
5. 上書き保存すると `/Annots` に `/Subtype /FreeText`・`/AP /N`（`/Resources /Font /SigKJP`）・`/Contents`（UTF-16BE）・`/DA` で書かれ、開き直しても同じ位置・大きさ・色で見える。自前のテキストは開き直したあとも選んで直せる
6. 保存先のフォントは、テキスト注釈のある保存につき `/Type0` が 1 組増え、無い保存では増えない
7. `/Rotate 90` のページ・ページ編集で回したページでも、置いた向きのまま上向きに読める（pdf.js・他のビューア）
8. 印刷のプレビューに未保存のテキストが映る。PDF→画像には映らない（注意書きのまま）
9. `npm test` が緑（`TZ=UTC` でも）。`npm run dist` の配布物でも `SIGK_SMOKE=1` と `SIGK_SMOKE_ANNOTATE` が通り、asar の中からフォントが読める
10. 配布物のサイズ増と保存時間の増分を「実装の記録」に残す
11. 保存した PDF を他のビューアで開き、日本語が同じ位置・大きさ・色で見える（**ユーザーの目視**）

### 人が目で確かめる手順

- 画面の見た目が `screenshots/phase4-free-text.png` と揃っていること。
- 日本語 IME で「にほんご」と打って変換・確定し、Enter で改行、枠の外を押して確定できること（変換中の Enter で確定されないこと）。
- 保存した PDF を他のビューアで開き、文字が同じ位置・大きさ・色で見え、豆腐や欠けが無いこと。
- 他のツールで付けたテキスト注釈（`/DA /Helv` など）が今までどおり見えていること。

---

## ユーザーの確定

### 着手前（2026-09-16。`docs/07` 決定34）

1. 塊①の目視（`spec-4-1` 判定10）はまだ → 持ち越し
2. 到達点は塊②まるごと（PR はユーザー指示待ち）

### モック（2026-09-16。`docs/07` 決定35）

3. モックのとおり（案のまま確定）: レールの「テキスト」を有効に・右パネルに「文字の大きさ」の行・紙の上の破線の入力欄と
   確定後の文字（`screenshots/phase4-free-text.png`）

### 事前調査後（2026-09-16。`docs/07` 決定35。10件とも起草者の推し。括弧内は採らなかった代替）

4. 論点1 フォントの入手と置き場: 公式配布の静的 TTF を `assets/fonts/` にコミット。TTF／OTF は事前調査 B の結果で TTF（npm 経由で `scripts/vendor.js` に足す）
5. 論点2 画面のフォント: 同じ Noto を `@font-face` で読む（OS フォントで代用）
6. 論点3 自分で付けたテキストは保存後も読み込んで直せる。`/DA` の `SigKJP` で見分ける（既存の FreeText はすべて表示のみ）
7. 論点4 保存ごとにサブセットが 1 つ増えることを許容し、増分の実測値を既知の限界に書く（`SigKJP` の注釈を全部読み直して 1 フォントに寄せる）
8. 論点5 クリックで置いて文字に合わせて自動で広がる。折り返し無し・Enter で改行（ドラッグで箱を描いて自動折り返し）
9. 論点6 枠の外を押す・Esc・Ctrl+Enter で確定。Enter は改行。空なら消える。IME 変換中の Enter／Esc は入力欄に任せる（Esc は編集前へ戻す）
10. 論点7 掴んでドラッグで動かせる。大きさの手動変更は入れない（移動は塊③へ送る）
11. 論点8 他のツールが作った FreeText は表示のみ（削除だけ可）
12. 論点9 文字の大きさはプリセット 14 段の `<select>`。既定 12pt。最後の値を `ui.annotFontSize` に覚える（自由入力）
13. 論点10 文字の色は黒・赤・青（下線と同じ 3 色）。既定 黒。`ui.annotColors.text` に覚える（他の組み合わせ）

### 起草者の判断で決めたもの

- `/AP /N` を必ず書く（塊①と同じ理由）。`Matrix` 無し・`BBox` ＝ `/Rect`・pdf.js と同じ回転の式（確定事項26）
- `/DA` のフォント名 `SigKJP`（確定事項25）。AcroForm の `/DR` には触らない（`/Fields` 必須の AcroForm を無から作らない）
- `/Contents` は UTF-16BE（確定事項25）。`/C`・`/DS`・`/RC`・`/IT`・`/Q`・`/QuadPoints` は書かない。`/Border [0 0 0]`
- サブセットのタグは乱数 6 大文字（規格の「同じファイルの別サブセットは別のタグ」）
- 行送り 1.25em・ベースライン 1.061em・余白 2pt（確定事項19）
- 未対応文字は豆腐のまま。右端をはみ出す箱は左へ寄せる。ワーカーは `/Rect` を右へ 1pt 伸ばす
- フォントが読めないときは、テキスト注釈のある保存だけ断る（確定事項22）
- 下書きは状態に持ち、枠が戻ったら再マウント（フォーカスは戻さない）（確定事項9）
- ダブルクリックか Enter で編集。textarea は破線・透明（確定事項5・10）
- テキストの道具を押したとき文字選択があっても作らない（確定事項3）
- 差し込んだページには「差し込んだページには保存後に付けられます」の帯（塊①と同じ）。暗号化 PDF は付けられるが保存は断る
- モジュールの切り方と名前（「足りない部品」）。起動確認の操作列

---

## 未確定のまま残すもの

| 項目 | 扱い |
|---|---|
| 配布物が約 5.2MB 増える | 受け入れる（`docs/02` 1-4 の前提どおり） |
| 保存のたびにサブセットが 1 組増え、編集・削除で古いフォントが孤児で残る | 既知の限界（確定事項24。1 組は数百バイト〜数十 KB）。肥大が問題になったら「`/DA` が `SigKJP` の注釈を全部読み直して 1 フォントに寄せる作り直し」を足す |
| 縦書き・自動折り返し | 非対応（横書き・Enter で改行のみ） |
| 未対応文字（絵文字・稀な漢字） | 豆腐になる。警告しない |
| 他のツールが作った FreeText | 表示のみ（pdf.js が描く。`/AP` が無ければ pdf.js の代替フォント）。選択・削除・編集はできない |
| 他のビューアで文字を編集すると | `/DR` にフォントが無いので、そのビューアの既定フォントで外観が作り直される（pdf.js の編集機能と同じ制約） |
| 編集中にズーム・スクロールで枠が捨てられる | 下書きは生き残るが、フォーカスは戻さない |
| 入力欄と確定後の SVG のベースラインの差 | 1px 級（SVG・印刷・ファイルは定数で一致。入力欄だけ Chromium 任せ） |
| 移動はドラッグのみ（変形無し・矢印キー無し） | 箱は文字に合わせて自動なので変形は不要 |
| `pdfFont.embedder.font`・`subset._addGlyph` への依存 | pdf-lib 1.17.1・fontkit 1.1.1 固定（どちらも凍結）。テストで見張る |
| 差し込んだページ・暗号化 PDF・サムネイル・PDF→画像 | 塊①と同じ |
