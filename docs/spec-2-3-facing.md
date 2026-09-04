# 仕様書: Phase 2 塊③ 見開き表示

起草日: 2026-09-04
ステータス: **確定**（論点4件は起草前にユーザーが決定。末尾「ユーザーの確定」を参照。残る細部は起草者の推しで
書き、その一覧を「起草者の判断で決めたもの」に置いた）
関連: `docs/05_開発ロードマップ.md` Phase 2（2-6）／`docs/01_製品要件定義.md` F-01-1 後半／`docs/04_UI設計.md`
第3章（ツールバー）・第9章（アイコン）／`docs/spec-1-1-viewer.md`（連続スクロール・ズーム・ページ移動・
`layoutPages`）／`docs/spec-1-3-reading.md`（UI 状態の永続化 `settings:getUi`／`setUi`）／
`docs/spec-1-5-page-edit.md`（`applyPlan`）／`docs/07_開発計画の決定事項.md` 決定24・28

---

## 目的

閲覧モードのページビューは、Phase 1 塊① から縦1列の連続スクロールだけである。F-01-1 の後半「単ページ／見開き
表示の切り替え」は、レイアウト計算とページモードの選択表示に波及するとして塊① から外し（`spec-1-1` 確定事項12）、
2026-09-03 のユーザー判断で Phase 2 の末尾に置いた（決定24）。塊③ で **2ページを横に並べる表示**を足し、
Phase 2 を終える。

---

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| ツールバーの「見開き」トグルと、ページビューの2列配置（1-2, 3-4 で固定） | 表紙を単独にする組み方（1 / 2-3 / 4-5）。既知の限界 |
| 見開き中の「幅に合わせる」「全体」の再定義（2枚＋間隔で合わせる） | 右綴じ（`/ViewerPreferences /Direction R2L`）。既知の限界 |
| 見開き単位の前後移動と、現在ページの扱い | サムネイル・ページモードのグリッドの2列化（別物。閲覧の1列・ページモードの多列はそのまま） |
| 選択を `settings.json` に覚える（アプリ全体の設定） | 文書ごとに覚えること |
| 起動確認 `SIGK_SMOKE_FACING` | 見開き用のキー割り当て（塊③ では足さない。ボタンだけ） |

---

## 事前調査（2026-09-04・コードの読み取りのみ。実測は要らなかった）

見開きは **`renderer/viewer-layout.js` の `layoutPages` と fit の計算に閉じる。**`spec-1-5` の見通し
「ページビュー側の2列化は `layoutPages` の話に閉じる」は正しかった。

| 影響 | 根拠 |
|---|---|
| **触る**: `layoutPages` の `left`／`top`、`fitWidthZoom`／`fitPageZoom` | 縦1列・1ページ分の幅しか見ていない |
| **触る**: `viewer.js` の `applyLayout`・`fitZoomFor`・`nextPage`／`prevPage`、`page-render.js` の `update` | 見開きの状態を渡す／2ページ単位で動かす／現在ページの補正 |
| **触らない**: テキストレイヤー・検索ハイライト・サムネイルのジャンプ・印刷 | いずれも `.pdf-page` の枠寸法か `goToPage` だけを見ていて、`left` や順序に依存しない（`page-render.js` の `renderPage`、`find.js` の `reveal`、`thumbnails.js` の `onClick`、`print.js` の `renderPageImage`） |
| **触らない**: `visibleRange`・`scrollTopForPage`・`renderTargets` | 縦方向だけで判定する。行の `top` が正しければそのまま動く |
| 落とし穴: `currentPageIndex` は同じ `top`／`height` なら若い番号を採る | 見開きでは常に左が勝つ。右ページを指定した直後にスクロール更新で左へ戻ってしまう（確定事項13 で補正） |
| 設定の永続化 | `settings.js` の `DEFAULTS`／`mergeDefaults`／`pickUi`／`mergeUi`、`shell.js` の `persist`／`applyUi`、`app.js` の `restoreUi` にキーを1つ足す形。`test/settings.test.js` が既存キーを見張っている |

---

## 確定事項

### A. 切り替え（ユーザー確定③）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 操作 | ツールバーに **トグル1つ**「見開き」（`#btn-facing`）。`#btn-fit-page`（全体）の直後・`.spacer` の手前。押している間は「幅」「全体」と同じ `.active` で見せる |
| 2 | 押せる条件 | 文書が開いているとき（`viewer-controls.js` の `DOCUMENT_CONTROLS` に足す）。文書が無いときは押せないが、覚えた設定の復元は文書が無くても効く（確定事項5） |
| 3 | 状態の持ち主 | `shell.js` が `pageLayout: 'single' \| 'facing'` を持ち、`<html data-layout="...">` に映す。`shell.setPageLayout(doc, layout)` が `viewer.setFacing(layout === 'facing')` を呼び、`persist({ pageLayout })` で覚える。ビューアは `state.facing`（boolean）を持ち、配置だけを担う |
| 4 | 切り替えた瞬間 | 現在ページを保ったまま配置し直す（`applyLayout` → `goToPage(state.current)`）。「幅に合わせる」「全体」で追従中（`state.fit !== null`）なら、**その場で倍率を計算し直す**（2枚に合わせるので倍率は約半分になる）。追従していなければ倍率はそのまま |
| 5 | 永続化 | `settings.json` の `pageLayout`（既定 `'single'`）。`pickUi` がレンダラーへ渡し、`mergeUi` が部分更新を受ける。`app.js` の `restoreUi` が `shell.applyUi(doc, { pageLayout })` で当てる（`restoring` 中は書き戻さない）。**アプリ全体の設定**で、タブ（文書）ごとには持たない。`detach()`／`attach()` のセッションにも入れない |
| 6 | 起動時 | 覚えた値で立ち上がる。文書を開く前に `viewer.setFacing` が済んでいるので、最初の `applyFit('width')` から見開き基準になる |

### B. 配置（`layoutPages`・ユーザー確定①）

| # | 項目 | 決定 |
|---|---|---|
| 7 | 組み方 | 行 = `[2k, 2k+1]`（0 始まり）。**1-2, 3-4 で固定**。ページ数が奇数なら末尾は**左に単独** |
| 8 | 引数 | `layoutPages({ sizes, zoom, facing = false })`。`facing: false` の返り値は従来と完全に同じ（回帰テストで固定） |
| 9 | 縦 | 行の高さ = 組の2枚の高いほう。2枚の `top` は同じ（上揃え）。行と行の間隔は `PAGE_GAP`（16px）、上下の余白は `PAGE_MARGIN`（18px）で従来どおり |
| 10 | 横 | **綴じ目を基準に置く。**左半分の幅 `leftHalf` = 左に置くページの幅の最大、右半分 `rightHalf` = 右に置くページの幅の最大。`contentWidth = leftHalf + FACING_GAP + rightHalf`（右に置くページが1枚も無い＝1ページの文書なら `leftHalf` だけ）。左ページは `left = leftHalf − width`（綴じ目へ右寄せ）、右ページは `left = leftHalf + FACING_GAP`（綴じ目から左寄せ）。幅の違うページが混ざっても綴じ目が一直線に通る |
| 11 | 2枚の間隔 | `FACING_GAP = PAGE_GAP`（16px）。モック（`screenshots/phase2-facing.png`）で見て、詰めなくても組として読めると判断した |
| 12 | 描く枚数 | `renderTargets` の `ahead` を、見開きでは 2 にする（1 だと隣の行の半分しか先読みしない）。`MAX_RENDERED`（8）は変えない。可視2行（4枚）＋前後2枚ずつで足りる |

### C. 現在ページと移動（ユーザー確定②）

| # | 項目 | 決定 |
|---|---|---|
| 13 | 現在ページ | `currentPageIndex` は変えない（同じ行なら左が勝つ）。`page-render.js` の `update` で、**算出した現在ページと `state.current` が同じ組なら `state.current` を保つ**。番号入力・サムネイル・検索で右ページを指定した直後に、左の番号へ戻らないため。組が変わったら従来どおり算出値（＝左）に置き換える |
| 14 | 組の判定 | `viewer-layout.js` に `spreadStart(index, facing)`（見開きなら `index − index % 2`、単ページなら `index`）を置く。純関数 |
| 15 | ◀ ▶・PageUp／PageDown | **見開き単位で動く。**`nextPage` は `goToPage(spreadStart(current) + 2)`、`prevPage` は `goToPage(spreadStart(current) − 2)`。端は `goToPage` が丸める。単ページでは従来どおり ±1 |
| 16 | 番号入力・Home／End・サムネイル・検索 | すべて `goToPage(index)` 経由で、変えない。`scrollTopForPage` は行の `top` を返すので、右ページを指定しても組の先頭へスクロールする。`state.current` はその番号のまま（確定事項13 が守る） |
| 17 | 表示 | ツールバーの「3 / 24」は `state.current + 1` のまま（範囲表示にはしない） |

### D. 倍率

| # | 項目 | 決定 |
|---|---|---|
| 18 | 幅に合わせる | 見開きでは **現在の組の（左幅＋右幅）＋`FACING_GAP`** を視野の幅に合わせる。`fitWidthZoom({ pageWidth, viewportWidth, gap = 0 })` に `gap` を足し、`pageWidth` に2枚の幅の和（PDF 単位）を渡す。末尾の単独ページでも組の幅は「2枚ぶん」で計算する（同じ文書内でページを送るたびに倍率が跳ねないため。ただし組に1枚しか無いときはその1枚の幅を2倍して見なす） |
| 19 | 全体 | 見開きでは組の高さの高いほうも見る。`fitPageZoom({ pageWidth, pageHeight, viewportWidth, viewportHeight, gap })` |
| 20 | 組の寸法 | `viewer-layout.js` に `spreadSize(sizes, index, facing)` → `{ width, height }`（PDF 単位。見開きなら組の2枚の幅の和と高さの最大、1枚しか無い組は幅を2倍）。`viewer.js` の `fitZoomFor` がこれを使う |
| 21 | 段送り・100% | 変えない。`＋`／`−`／Ctrl+0 は従来どおり |

### E. 他への影響

| # | 項目 | 決定 |
|---|---|---|
| 22 | ページ編集 | `applyPlan` は `applyLayout` を通るので、回転・削除・並べ替えのあとも見開きのまま並び直る。コードの変更は不要 |
| 23 | サムネイル・ページモードのグリッド | 変えない。閲覧の1列（`spec-1-3`）・ページモードの多列（`spec-1-5`）は見開きと無関係 |
| 24 | テキストレイヤー・検索・印刷 | 変えない（事前調査） |
| 25 | タブ | 見開きはアプリ全体の設定なので、タブを移っても変わらない。`attach()` の `applyLayout` が `state.facing` を見る |
| 26 | ツールモード | ページビューは隠れるだけなので影響なし。ボタンは文書が開いていれば押せるが、押しても見えるのは閲覧に戻ってから |

### F. 意匠

| # | 項目 | 決定 |
|---|---|---|
| 27 | ボタン | `<div class="tb-btn" id="btn-facing" aria-disabled="true" title="見開き表示（2ページを並べる）"><span data-icon="facing"></span>見開き</div>` |
| 28 | アイコン | `assets/icons.js` に `facing`：2枚の紙が横に並ぶ（`rect` 2つ）。自作のインライン SVG。`docs/04` 第9章の一覧に追記済み |
| 29 | モック | `_mockup_facing.html` を描画し `screenshots/phase2-facing.png` に残した（2026-09-04）。モック本体は実装着手時に削除 |

### G. 起動確認

| # | 項目 | 決定 |
|---|---|---|
| 30 | `SIGK_SMOKE_FACING=1` | `SIGK_SMOKE_PDF` と一緒に使う。起動時の `pageLayout` を控え、見開きへ切り替え → 1・2ページ目の `top` が同じで `left` が異なること、末尾（奇数なら）が左に単独なこと、倍率が2枚基準になったこと、`nextPage` で 2 進むこと、`goToPage(3)`（4ページ目）のあと描画更新を挟んでも `current` が 3 のままなこと、`settingsAPI.getUi()` に `pageLayout: 'facing'` が残ること、ボタンに `.active` が付くことを報告する。最後に**起動時の値へ戻す**（起動確認が利用者の設定を書き換えたままにしない） |
| 31 | 配布物 | `npm run dist` の `dist/win-unpacked` でも同じ起動確認を通す（`docs/05`「検証をどこで回すか」） |

---

## 足りない部品

新しいファイルは作らない（`package.json` の `build.files` は変えない。`test/dist-files.test.js` で確認）。

| ファイル | 追記・変更 |
|---|---|
| `renderer/viewer-layout.js` | `FACING_GAP`、`layoutPages` の `facing`、`spreadStart`、`spreadSize`、`fitWidthZoom`／`fitPageZoom` の `gap` |
| `renderer/viewer.js` | `state.facing`、`setFacing`／`isFacing`、`getState().facing`、`applyLayout`・`fitZoomFor`・`nextPage`／`prevPage` の見開き対応 |
| `renderer/page-render.js` | `update` で同じ組なら `state.current` を保つ。`ahead` を見開きで 2 |
| `renderer/viewer-controls.js` | `btn-facing` を `DOCUMENT_CONTROLS`・`bindClick`・`.active` の同期に |
| `renderer/shell.js` | `setPageLayout`、`applyUi` の `pageLayout` |
| `renderer/app.js` | `restoreUi` で `pageLayout` を運ぶ |
| `settings.js` | `pageLayout` を `DEFAULTS`／`mergeDefaults`／`pickUi`／`mergeUi` に。`PAGE_LAYOUTS = ['single', 'facing']` |
| `index.html` | ボタン |
| `assets/icons.js` | `facing` |
| `main.js` | 起動確認 `SIGK_SMOKE_FACING` |
| `test/harness.js` | `settingsAPI` のスタブが `pageLayout` を受ける・返す |
| `docs/02_アーキテクチャ設計.md` | 設定キーの記述（`settings:getUi` が返すもの） |

---

## テストの範囲

| 層 | 対象 |
|---|---|
| 依存なし | `viewer-layout.js`：`facing: false` の回帰、組の `top` 一致と `left` の振り分け、奇数末尾の左単独、幅の違う組で綴じ目が揃う、1ページの文書、`spreadStart`、`spreadSize`、`gap` 付きの fit。`settings.js`：`pageLayout` の既定・不正値・`pickUi`・`mergeUi` |
| jsdom | `viewer.test.js`：ボタンで切り替わり `.active` が付く、DOM の `top`／`left` が `layoutPages({ facing: true })` と一致、切り替えで「幅に合わせる」が2枚基準に再計算、◀ ▶ が2ページ動く、右ページを指定して描画更新後も `current` が保たれる、`applyPlan` 後も見開き、タブを移っても見開きのまま。`shell.test.js`：`pageLayout` の復元と保存（復元時は書き戻さない） |
| 起動確認 | `SIGK_SMOKE_FACING=1`。開発ツリーと配布物の両方 |

---

## 完了の判定

1. ツールバーの「見開き」で単ページ⇄見開きが切り替わり、押している間 `.active`。文書が無いときは押せない
2. 見開きで 1-2, 3-4 が同じ高さに並び、奇数の末尾は左に単独。「幅に合わせる」で2枚が視野の幅に収まる
3. ◀ ▶・PageUp／PageDown で2ページ動く。番号入力で右ページを指定しても、その番号の表示が保たれる
4. ページモードで回転・削除したあとも見開きのまま並び直る
5. 選択が `settings.json` に残り、再起動しても同じ表示で開く
6. 検索の移動・サムネイルのクリック・印刷が、見開きでも従来どおり動く
7. `npm test` が緑で、`npm run dist` の配布物でも `SIGK_SMOKE=1` と `SIGK_SMOKE_FACING=1` が通る
8. 見た目がモック（`screenshots/phase2-facing.png`）と揃っている（人の目）

### 人が目で確かめる手順

- 実機で `many-pages.pdf`（40ページ）を開き、「見開き」を押す。2列に並び、倍率が約半分になり、スクロールが滑らかなこと。
- `rotated.pdf` をページモードで1枚回してから閲覧へ戻し、回した紙が組の中で上揃えになっていること。
- `three-pages.pdf` で末尾の3ページ目が左に単独で置かれること。
- 検索でヒットが右ページにあるとき、そのページ番号が表示され、左へ戻らないこと。

---

## ユーザーの確定（2026-09-04）

起草前に AskUserQuestion で4件を聞き、すべて起草者の推しで確定した（`docs/07` 決定28）。

| # | 論点 | 確定 | 推しの根拠 |
|---|---|---|---|
| ① | 2ページの組み方 | **1-2, 3-4 で固定** | 対象は横書きの業務文書で、綴じを前提にしない。表紙の概念を持たず UI もボタン1つで済む。表紙単独は要望が出たら足す |
| ② | 前後移動と現在ページ | **見開き単位で動き、現在は左のページ番号** | 1ページ単位だと画面が動かない押下が交互に起きる。範囲表示は入力欄の扱いを別に決める必要がある |
| ③ | 状態を覚える | **覚える**（アプリ全体の設定） | `mode`・`sidePanel` と同じ経路で、毎回押し直す手間が無い |
| ④ | 綴じ方向 | **第1版は左→右で固定** | 右綴じの PDF を扱う頻度は低い。要望が出てから足す |

### 起草者の判断で決めたもの

- 2枚の間隔は縦と同じ 16px（確定事項11）。
- 配置は綴じ目基準（確定事項10）。行ごとの中央寄せにはしない。
- 「幅に合わせる」は末尾の単独ページでも2枚ぶんで計算する（確定事項18）。
- 先読みは見開きで 2（確定事項12）。
- キー割り当ては足さない。ツールバーのボタンだけ。
- 状態の持ち主は `shell.js`、配置は `viewer.js`（確定事項3）。

---

## 未確定のまま残すもの（既知の限界）

| 項目 | 扱い |
|---|---|
| 表紙を単独にする組み方 | 入れない。要望が出たら「表紙を分ける」トグルを足す（ユーザー確定①） |
| 右綴じ | 入れない。`/Direction R2L` を読む案は要望が出てから（ユーザー確定④） |
| 幅の違うページが混ざる文書 | 綴じ目基準なので、狭いページの外側に余白ができる。仕様どおりの帰結 |
| 回転したページと横スクロール | `spec-1-5` の既知の限界のまま。見開きでは2枚ぶん広くなるので出やすくなる |
| 見開きのキー割り当て | 入れない。要望が出たら決める |
