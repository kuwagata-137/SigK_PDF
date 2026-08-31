# 仕様書: Phase 0 土台

- ステータス: **確定**（2026-08-29 制定 ／ 同日改訂）
- 改訂: `docs/07_開発計画の決定事項.md` の決定を反映（配信方式・pdf.js・テーマ・通信遮断）
- 関連: `docs/05_開発ロードマップ.md` Phase 0 ／ `docs/02_アーキテクチャ設計.md`
- 実装: `package.json`・`main.js`・`preload.js`・`errorlog.js`・`index.html`・`renderer/*`・`scripts/vendor.js`
- テスト: `test/harness.js`・`test/*.test.js`

## 目的

「空のウィンドウが出て、テストと CI が回り、インストーラーが作れる状態」を作る。PDF を扱う機能はこのフェーズでは入れない。土台の形（セキュリティ設定・モジュールの書き方・テストの回し方・CI）をここで確定させ、Phase 1 以降が同じ型で積めるようにする。

## 含めるもの / 含めないもの

| 含める | 含めない |
|---|---|
| ウィンドウ生成とアプリケーションメニュー | PDF の表示・読み書き |
| セキュリティ設定（`sandbox`・CSP・通信遮断・遷移拒否） | ファイルを開く／保存する IPC |
| デザイントークンと画面の骨組み（静的） | サムネイル・ページ操作・注釈 |
| ウィンドウ位置・サイズの保存と復元 | コマンドライン引数の解釈（Phase 1 へ前倒し） |
| エラーのローカルログ | ワーカー（`utilityProcess`）の起動（Phase 1） |
| `scripts/vendor.js`（同梱ライブラリの複製） | pdf.js・pdf-lib の呼び出し |
| テストハーネスと CI 2本 | |

ロードマップ「フェーズをまたいで機能を先取りしない」に従い、`preload.js` が公開するのは Phase 0 で実際に動く API だけとする。`pdfAPI`・`taskAPI`・`shellAPI` は該当フェーズで足す。中身のない API を先に並べない。

## 確定事項

| # | 論点 | 決定 |
|---|------|------|
| 1 | レンダラーのモジュール形式 | IIFE ＋ `window.SigK` 名前空間。ES Modules は使わない（`file://` の制約を避ける） |
| 2 | Node からのテスト | 各 IIFE の末尾を `typeof window !== 'undefined' ? window : globalThis` とし、`require()` して純関数を直接呼べるようにする |
| 3 | `sandbox` | `true`。preload から Node の API を使わない。`fs`・`path` はすべてメイン側 |
| 4 | CSP | `index.html` の `<meta http-equiv>` と `session` の両方に置く。二重にするのは、片方の書き漏れで穴が空くのを防ぐため。`'self'` が指すのは `app://` のオリジンである |
| 5 | 外部通信 | `webRequest.onBeforeRequest` で `app:` と `devtools:` 以外を拒否する。**`file:` も拒否する**——レンダラーはファイルを直接読まず、PDF のバイト列はメインが読んで IPC で渡すため、許す必要がない。自動更新も入れないので、アプリは一切通信しない |
| 6 | テーマ | **ライト固定。ダークモードは搭載しない**（ユーザー判断 2026-08-29。CheckListMaker とはここだけ仕様が異なる）。`<meta name="color-scheme" content="light">` を明示し、OS がダーク設定でもフォーム部品・スクロールバーが暗転しないようにする。なお `frame: true` のため、OS がダークのときウィンドウ枠だけは OS の色で描かれる |
| 7 | 設定の保存形式 | JSON 1ファイル。アトミック書き込み（一時ファイル → `rename`）。壊れていたら既定値で起動し、エラーログに残す |
| 8 | エラーログ | `<userData>/logs/error.log` に JSONL で追記。外部送信しない。CheckListMaker と同じ形 |
| 9 | `vendor/` の複製 | `postinstall` で実行。複製元が見つからなければ**エラーで落とす**（黙って進めると Phase 1 で原因の分からない失敗になる） |
| 10 | pdf.js のバージョン | `package.json` では **`^6` を指定する**（2026-08-31 更新。当初は `^4` としていた）。ES Modules が読めないのは `file://` の制約であり、`app://` では通常どおり動く（実測は `docs/07_開発計画の決定事項.md` 第1章）。したがって古い版に固定する理由がない。ただし **Phase 0 では読み込まない**。実際の統合は Phase 1 の塊①で行う |
| 11 | ウィンドウ枠 | OS 標準（`frame: true`）。独自のタイトルバーを描かない |
| 12 | 初期ウィンドウサイズ | 1280×800。最小 960×600。位置とサイズを設定に保存し、次回起動で復元する |
| 13 | lockfile | コミットしない（CheckListMaker と同じ運用）。CI は `npm install` を使う |
| 14 | レンダラーの配信方式 | `app://` スキーム。`protocol.registerSchemesAsPrivileged` で標準スキームとして登録し、`protocol.handle` でアプリ内のファイルを返す。`file://` は使わない。ES Modules が `file://` で実行されないため（`docs/07` 第1章）であり、副次的に origin・相対パス・Worker・CSP の扱いがすべて素直になる |
| 15 | Electron と electron-builder の版 | Electron は 44 系、electron-builder は 26 系（2026-08-31 追加）。当初は CheckListMaker に揃えて 31 系としていたが、Windows 実機で検証できるようになったため、古い版から始めて後で上げるより手戻りが少ないと判断した |
| 16 | `app://` のオリジン | `app://sigk`。**ホスト名を必ず付ける**。`app:///index.html` のようにホストが空だと Chromium に拒否されることがある。CSP の `'self'` が指すのはこのオリジンである |
| 17 | 同梱ライブラリの依存区分 | pdfjs-dist・pdf-lib・fontkit は **`devDependencies` に置く**（2026-08-31 追加）。実行時に `node_modules` から `require` することはなく、`vendor/` を作るための材料でしかない。`dependencies` に置くと electron-builder が `node_modules` を丸ごと同梱し、pdfjs-dist が引き込むネイティブモジュールまで配布物に入って約19MB 膨らむ（実測 126.3MB → 107.3MB） |
| 18 | `<meta>` の CSP | ヘッダとは1指令だけ異なる。`frame-ancestors` は `<meta>` で配ると仕様上無視され、Chromium が警告を出すため、`<meta>` 側からは外す（`CSP_META_STRING`）。効かない指令を書いて警告を残すより、ヘッダで確実に効かせるほうがよい。両者が1指令の差しかないことはテストで固定する |

## セキュリティ設定の内訳

`main.js` の `applySecurity()` に集約し、テストから検証できるようにする。

| 対象 | 設定 | 目的 |
|---|---|---|
| `webPreferences.contextIsolation` | `true` | レンダラーと preload の実行コンテキストを分ける |
| `webPreferences.nodeIntegration` | `false` | レンダラーから Node の API を触らせない |
| `webPreferences.sandbox` | `true` | レンダラープロセスを OS のサンドボックスに入れる |
| `webPreferences.webSecurity` | `true`（既定） | 同一生成元ポリシーを効かせる |
| `webContents.setWindowOpenHandler` | すべて `deny` | 新規ウィンドウを開かせない |
| `webContents` の `will-navigate` | アプリ外への遷移を `preventDefault` | 外部サイトへ飛ばさない |
| `session.webRequest.onBeforeRequest` | `app:` `devtools:` 以外を `cancel`（`file:` も含めて拒否） | PDF に埋め込まれた外部参照で通信させない |
| `webContents` の `will-frame-navigate` | iframe 内の遷移も `preventDefault` | `will-navigate` だけでは iframe を塞げない |
| `webContents` の `will-attach-webview` | `preventDefault` | webview を差し込ませない |
| `app.on('web-contents-created')` | 上記を新規 `webContents` にも適用 | 抜け道を作らない |
| CSP | `default-src 'self'` ほか | インラインスクリプトの実行を禁じる |

CSP は次のとおり。`style-src` に `'unsafe-inline'` を許すのは、レンダラーが要素の `style` 属性で色や位置を変えるためである。`script-src` にはインラインを許さない。

**`file:` を拒否することの帰結**（2026-08-31 追記）。`app://` の応答を Electron 公式の例に
ならって `net.fetch(pathToFileURL(p))` で組み立ててはならない。`net.fetch` はセッションを
経由するため、自分で仕掛けた `file:` の遮断に自分で引っかかる。症状は原因表示のない
白画面で、たどり着くのに時間がかかる。`protocol.handle` の中では `fs.promises.readFile`
で直接読むこと。asar の中身も Electron が `fs` にパッチを当てているため読める。

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

## テストの範囲

| ファイル | 検証する内容 |
|---|---|
| `test/settings.test.js` | 設定の読み書き、壊れた JSON からの復帰、アトミック書き込み、既定値 |
| `test/errorlog.test.js` | JSONL の追記、サイズ上限での切り詰め、書き込み失敗時に例外を投げないこと |
| `test/security.test.js` | `buildWebPreferences()` の値、`isAllowedRequest()` の判定、CSP 文字列の内容、`resolveAppPath()` がアプリのフォルダの外を指さないこと |
| `test/vendor.test.js` | `planVendorCopy()` が返す複製計画。複製元が無いときにエラーになること |
| `test/shell.test.js` | jsdom で `index.html` を起動し、骨組みの DOM が組み上がること |

`test/shell.test.js` は jsdom を要する。それ以外は Node の標準機能だけで動かす。
**その理由は環境の制約ではない**（2026-08-31 改訂）。テストの起動を短く保ち、依存の
増減がテストの成否に影響する範囲を1本に閉じ込めるためである。

`security-policy.js` を `main.js` から切り出しているのは、`main.js` が `require('electron')`
を含み `node --test` から読み込めないためである。判定の純関数だけを別ファイルに置く。

`test/harness.js` は CheckListMaker から移植したものではなく、新規に書き起こしている
（`docs/07` 第1章 #5 の訂正を参照）。jsdom は構築直後の `readyState` が `'loading'` で
`DOMContentLoaded` は次のティックで発火するため、ハーネスはこれを待ってから返す。

## 完了の判定

- [x] `npm install` で `vendor/` が揃う（手元）
- [x] `npm start` でウィンドウが出て、`app://` から画面が読み込まれる（手元。`SIGK_SMOKE=1` で機械的に判定）
- [x] `npm test` が緑（手元。61件）
- [x] `npm run dist` で NSIS インストーラーが生成される（手元）
- [x] GitHub Actions の2本が通り、インストーラーが Artifact に出る
- [x] `THIRD-PARTY-NOTICES.md` に依存分のライセンスが入っている（同梱8件。`scripts/notices.js` が生成）

## 検証をどこで回すか

**2026-08-31 改訂。** この節はかつて「開発環境が Linux コンテナで `registry.npmjs.org` が
403 のため、依存を要する検証はすべて GitHub Actions に回す」と書かれていた。その前提は
現在当てはまらない。開発環境は Windows 11 実機（Node 24.12.0 ／ npm 11.19.1）であり、
npm レジストリへ到達できる。

したがって**手元を第一の検証の場とする**。`npm install`・`npm test`・`npm start`・
`npm run dist` をすべて手元で実行して確かめてから push する。GitHub Actions は、
依存を新規に解決するクリーンな環境でも同じ結果になることの担保と、インストーラーを
Artifact として取り出す経路を担う。

| 確認 | 手段 |
|---|---|
| 依存を要しないテスト | `npm test`（`node --test`） |
| jsdom を要するテスト（`test/shell.test.js`） | `npm test` |
| Electron の起動と `app://` の動作 | `npm start`。`SIGK_SMOKE=1` を付けると、読み込んだ URL・画面の状態・寸法・コンソールのエラーを標準出力へ書いて終了する |
| 画面の寸法と配色 | `SIGK_SMOKE=1` の出力（`getBoundingClientRect` と `getComputedStyle` の実測値）。`SIGK_SMOKE_SHOT=<path>` でスクリーンショットも保存できる |
| インストーラーの生成 | `npm run dist`（NSIS） |
| クリーンな環境での再現性 | GitHub Actions（`test.yml`・`build-windows.yml`） |

jsdom は CSS を解釈せず `getBoundingClientRect()` がすべて 0 を返す。したがって
**寸法や配色の検証をテストに書いてはならない**。それは `npm start` の実測で担保する。
