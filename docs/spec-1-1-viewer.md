# 仕様書: Phase 1 塊① 表示の最小

- ステータス: **確定**（2026-08-31 制定）
- 関連: `docs/05_開発ロードマップ.md` Phase 1 塊① ／ `docs/02_アーキテクチャ設計.md` ／ `docs/spec-0-foundation.md`
- 対応要件: F-01-1（連続スクロール）／F-01-2（ズーム）／F-01-3（ページ移動）／F-06-1（開く。ダイアログ経路のみ）
- 実装: `file-io.js`・`main.js`・`preload.js`・`index.html`・`renderer/pdfjs-bridge.mjs`・`renderer/viewer.js`・`renderer/viewer-layout.js`
- テスト: `test/viewer-layout.test.js`・`test/file-io.test.js`・`test/shell.test.js`・`test/fixtures/build.js`

## 目的

**PDF を開いて読める**状態を作る。塊①を Phase 1 の先頭に置くのは、`app://` と pdf.js の統合が
実際に動くかを最初に確かめ、駄目なら配信方式（`docs/07` 決定2）を早期に見直せるようにするため
である（`docs/05` 第43行）。

## 含めるもの / 含めないもの

| 含める | 含めない |
|---|---|
| pdf.js の読み込みと文書の展開 | サムネイル・検索・テキスト選択・印刷（塊③） |
| ページの連続スクロール表示 | 見開き表示（確定事項12） |
| ズーム（25〜400%・幅に合わせる・全体表示） | ドラッグ＆ドロップ・タブ・最近使ったファイル・文書情報（塊②） |
| ページ移動（前後・番号入力・先頭/末尾） | ページ編集・`ops`・undo/redo（塊④） |
| 「開く」ダイアログ（確定事項10） | 保存・ワーカー・`.bak`（塊⑤） |
| | パスワード付き PDF の解錠（塊⑤。確定事項15） |

## 確定事項

| # | 論点 | 決定 |
|---|------|------|
| 1 | ESM の入口 | `renderer/pdfjs-bridge.mjs` **1本だけ**を `<script type="module">` で読む。`vendor/pdf.mjs` を `import` し、設定済みの入口を `window.SigK.pdfjs` に載せて `sigk:pdfjs-ready` を発火する。以降のレンダラーは従来どおり IIFE で、pdf.js に直接 `import` しない（`docs/02` 1-3） |
| 2 | module スクリプトの実行順 | module は defer 相当で、すべての classic スクリプトの後・`DOMContentLoaded` の前に走る。したがって `renderer/app.js` の初期化時点で `SigK.pdfjs` は揃っている。それでも `viewer.js` は `sigk:pdfjs-ready` を待てる形にしておく（読み込み順の変更で静かに壊れないようにするため） |
| 3 | CSP | `script-src` に **`'wasm-unsafe-eval'` を足す**。pdfjs-dist 6 は画像デコードと色管理を WebAssembly で持ち、Chromium はこの語が無いと `WebAssembly.instantiate` を拒否する。許すのは WebAssembly のコンパイルだけで `eval()` は許さない（`'unsafe-eval'` とは別の指令である）。読む `.wasm` は `vendor/` へ自分で複製したものだけで、`app:` 以外の要求は `webRequest` が遮断済みである。足す語がこの1つだけであることをテストで固定する |
| 4 | `vendor/` へ足すもの | `wasm/jbig2.wasm`・`wasm/openjpeg.wasm`・`wasm/qcms_bg.wasm`・`wasm/jbig2_nowasm_fallback.js`・`wasm/openjpeg_nowasm_fallback.js`・`iccs/`。**`quickjs-eval.wasm` と `quickjs-eval.js` は複製しない。**これは PDF に埋め込まれた JavaScript を実行するサンドボックスであり、`docs/02` 第6章が閉じると決めた経路そのものである |
| 5 | `getDocument` のオプション | `isEvalSupported: false`（`docs/02` 第6章）。`cMapUrl`・`cMapPacked: true`・`standardFontDataUrl`・`wasmUrl`・`iccUrl` はすべて `vendor/` 配下の `app://` URL を指す。外部 URL は一切書かない |
| 6 | 100% の定義 | **96/72 倍**（≒1.3333）を 100% とする。PDF の座標は 1/72 インチ単位、画面の CSS ピクセルは 1/96 インチ単位であり、pdf.js の `scale: 1` は 72dpi 相当で表示すると小さすぎる。利用者に見せる倍率と pdf.js へ渡す `scale` を分け、`scale = zoom × 96/72` で変換する |
| 7 | ズームの段階 | 25・33・50・67・75・100・125・150・175・200・250・300・400（%）。下限 25%・上限 400%（F-01-2）。`＋`／`−` はこの段階を1つずつ動く。段の間の値（幅に合わせる の結果など）から押した場合は、その値より大きい／小さい最も近い段へ動く |
| 8 | 既定の表示倍率 | 文書を開いた直後は**「幅に合わせる」**。用紙サイズを知らなくても読める幅で出るためである。ウィンドウやサイドパネルの幅が変わると追従して再計算する。`＋`／`−`／`100%` を押した時点で追従をやめる |
| 9 | 描画の範囲 | 可視ページとその前後1ページだけを描く。同時に持つ canvas は最大8枚とし、範囲外は破棄して枠だけ残す。**`IntersectionObserver` は使わない**。位置の算出を純関数（`renderer/viewer-layout.js`）に閉じてテストできるようにするためであり、jsdom に `IntersectionObserver` が無いという事情も併せて避けられる。スクロールと寸法変更は `requestAnimationFrame` で1フレームに1回へ間引く |
| 10 | 「開く」経路 | ダイアログ（`pdf:open`）とパス指定（`pdf:read`）を塊①に含める。**開く手段が1つも無いと表示を確認できず、「終われば何かが新しくできる」という PR の単位（`docs/07` 決定7）を満たさない**ためである。ドラッグ＆ドロップ・タブ・最近使ったファイル・文書情報は塊②に残す |
| 11 | 開ける文書の数 | 1つ。2つ目を開くと1つ目を置き換える。タブバーは Phase 0 のまま無効の見た目を保ち、できないことをできるように見せない |
| 12 | 見開き表示 | **塊①では作らない。**レイアウト計算とページモードの選択表示に波及する。常用開始（`docs/07` 決定5）に必須ではないため、Phase 1 の完了時に実使用の不満を見てから位置を決める |
| 13 | ページ移動（F-01-3） | 塊①に含める。この要件は5つの塊のどこにも割り当てられていなかった（取りこぼし）。連続スクロールを作れば現在ページの算出は必然的に要るため、前後移動と番号入力を足す差分は小さい |
| 14 | 読み込むファイルの上限 | 200MB（`docs/01` 第2章の想定上限）。超えるものは読まずに `{ error }` を返す。黙って固まるより、理由を出して断るほうがよい |
| 15 | パスワード付き PDF | 塊①では**開かない**。pdf.js の `PasswordException` を捉え、「パスワードが設定されています。この版では開けません」と画面に出す。解錠は塊⑤（F-06-6） |
| 16 | 失敗したときの見せ方 | ページビューにその場でメッセージを出す。ダイアログで塞がない。詳細（スタック・パス）は `appLogAPI` 経由でローカルのエラーログへ送る（`spec-0` 確定事項8） |
| 17 | canvas の解像度 | `devicePixelRatio` を掛けた実解像度で描き、CSS 側は論理サイズを指定する。高 DPI で字が滲まないようにするため。倍率は 3 で頭打ちにする（メモリのため） |
| 18 | ページ番号の入力欄 | Phase 0 の `<b id="page-current">` を `<input id="page-current">` に替える。F-01-3 のページ番号入力に要るため。範囲外の値は現在ページへ戻す |

## 画面の動き

| 操作 | 結果 |
|---|---|
| ツールバー「開く」／メニュー ファイル > 開く（Ctrl+O） | ダイアログ。選ぶと1ページ目から表示。倍率は「幅に合わせる」 |
| `＋` `−` | 確定事項7 の段を1つ動く。追従は解除 |
| 「幅」 | 幅に合わせる。以後ウィンドウ幅に追従 |
| 「全体」 | 1ページ全体が入る倍率。以後ウィンドウの寸法に追従 |
| `◀` `▶` | 前／次のページの先頭へスクロール |
| ページ番号の入力 → Enter | そのページの先頭へスクロール |
| Home / End | 先頭／末尾のページへ |
| スクロール | 現在ページの表示が追従して変わる |

ステータスバーには ファイル名 ／ ページ数 ／ ファイルサイズ を出す（`renderer/shell.js` の
`setStatus()` を使う）。

## テストの範囲

| ファイル | 検証する内容 |
|---|---|
| `test/viewer-layout.test.js` | ズームの丸めと段送り、幅／全体に合わせる倍率、ページの配置と総高さ、スクロール位置からの可視範囲と現在ページ、描画対象の決定、ページ先頭へのスクロール位置 |
| `test/file-io.test.js` | ダイアログのキャンセル、拡張子の弾き、上限超過、読み込み失敗時に `{ error }` を返し例外を投げないこと |
| `test/shell.test.js` | pdf.js のスタブで文書を1つ開き、ページの枠が数どおり並び、ページ移動とズームが状態に反映されること |
| `test/security.test.js` | `script-src` に足したのが `'wasm-unsafe-eval'` の1語だけであること、`.icc` の content-type |
| `test/vendor.test.js` | wasm と iccs が複製計画に入り、`quickjs-eval` が**入っていない**こと |

`test/harness.js` は `type="module"` のスクリプトを評価しない（`import` で落ちるため）。
代わりに `window.SigK.pdfjs` へスタブを差し込む口を設ける（`docs/02` 8章「pdf.js はスタブに
差し替える」の具体化）。

fixture は `test/fixtures/build.js` が pdf-lib で生成する（`docs/07` 決定10）。
バイナリはリポジトリに置かず、`pretest` で作る。

## 完了の判定

- [x] `npm install` で `vendor/wasm/` と `vendor/iccs/` が揃い、`quickjs-eval` が入っていない（配布物の asar でも確認）
- [x] `npm test` が緑（124件）
- [x] `npm start` で fixture の PDF を開き、連続スクロール・ズーム・ページ移動が動く
- [x] `SIGK_SMOKE=1` の出力でコンソールエラーが0件（CSP 違反はここに出る）
- [x] `npm run dist` で NSIS インストーラーが生成される

### 実測（2026-08-31。1280×800・`SIGK_SMOKE_PDF` 付きの `npm start`）

| 見たもの | 結果 |
|---|---|
| `WebAssembly.compile` | `ok`。`'wasm-unsafe-eval'` が効いている。この語が無いと拒否されるため、CSP の変更を直接確かめられる |
| ページビューの内寸 | 950px（`scrollbar-gutter: stable` により、文書の有無で変わらない） |
| 幅に合わせた倍率 | 1.118。紙の幅 887px ＋ 左右の余白 24px×2 = 935px = `clientWidth` と一致 |
| 紙の位置 | 上端がビューの 18px 下（`PAGE_MARGIN`）、左端が 24px 右（`SIDE_MARGIN`）。純関数の計算と一致 |
| 40ページの文書 | 開いた直後の canvas は2枚。20ページ目へ飛ぶと `[17,18,19,20]` の4枚に入れ替わり、1ページ目の canvas は捨てられた |
| 90 度回転したページ | `getViewport` が回転を含んだ寸法を返し、幅の広いページに合わせて器が広がった。縦のページはその中で中央に寄った |
| コンソールのエラー | 0件（4つの検証用 PDF すべて） |

pdf.js の描画そのもの（canvas に何が描かれたか）は jsdom では確かめられない。
`npm start` のスクリーンショット（`screenshots/phase1-viewer.png`）で担保する。
