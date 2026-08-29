# 仕様書: Phase 0 土台

- ステータス: **確定**（2026-08-29）
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
| ダークモードの切り替えと保存 | コマンドライン引数の解釈（Phase 5） |
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
| 4 | CSP | `index.html` の `<meta http-equiv>` と `session` の両方に置く。二重にするのは、片方の書き漏れで穴が空くのを防ぐため |
| 5 | 外部通信 | `webRequest.onBeforeRequest` で `file:` と `devtools:` 以外を拒否する。アプリは通信しない |
| 6 | テーマ | ライト／ダーク／OS に合わせる の3択。既定は「OS に合わせる」。`<userData>/settings.json` に保存する |
| 7 | 設定の保存形式 | JSON 1ファイル。アトミック書き込み（一時ファイル → `rename`）。壊れていたら既定値で起動し、エラーログに残す |
| 8 | エラーログ | `<userData>/logs/error.log` に JSONL で追記。外部送信しない。CheckListMaker と同じ形 |
| 9 | `vendor/` の複製 | `postinstall` で実行。複製元が見つからなければ**エラーで落とす**（黙って進めると Phase 1 で原因の分からない失敗になる） |
| 10 | pdf.js のバージョン | `package.json` では `^4` を指定する。ES Modules 配布が `file://` で読めるかは Phase 1 の先頭で確認し、駄目なら3系へ落とす。**Phase 0 では読み込まない** |
| 11 | ウィンドウ枠 | OS 標準（`frame: true`）。独自のタイトルバーを描かない |
| 12 | 初期ウィンドウサイズ | 1280×800。最小 960×600。位置とサイズを設定に保存し、次回起動で復元する |
| 13 | lockfile | コミットしない（CheckListMaker と同じ運用）。CI は `npm install` を使う |

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
| `session.webRequest.onBeforeRequest` | `file:` `devtools:` 以外を `cancel` | PDF に埋め込まれた外部参照で通信させない |
| `app.on('web-contents-created')` | 上記を新規 `webContents` にも適用 | 抜け道を作らない |
| CSP | `default-src 'self'` ほか | インラインスクリプトの実行を禁じる |

CSP は次のとおり。`style-src` に `'unsafe-inline'` を許すのは、レンダラーが要素の `style` 属性で色や位置を変えるためである。`script-src` にはインラインを許さない。

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
| `test/security.test.js` | `buildWebPreferences()` の値、`isAllowedRequest()` の判定、CSP 文字列の内容 |
| `test/vendor.test.js` | `planVendorCopy()` が返す複製計画。複製元が無いときにエラーになること |
| `test/shell.test.js` | jsdom で `index.html` を起動し、骨組みの DOM とテーマ切り替えが動くこと |

`test/shell.test.js` は jsdom を要する。それ以外は Node の標準機能だけで動くようにし、依存が入らない環境でも回るようにする。

## 完了の判定

- [ ] `npm install` で `vendor/` が揃う
- [ ] `npm start` でウィンドウが出て、ダークモードが切り替わる
- [ ] `npm test` が緑
- [ ] `npm run dist` で NSIS インストーラーが生成される
- [ ] GitHub Actions の2本が通り、インストーラーが Artifact に出る
- [ ] `THIRD-PARTY-NOTICES.md` に依存分のライセンスが入っている

## この環境で確認できないこと

開発環境が Linux コンテナであり、かつ npm レジストリがネットワークの許可リストに入っていないため、次は**この環境では確認できない**。GitHub Actions 上での確認に回す。

- `npm install`（レジストリへ到達できない）
- `npm start`（Electron のバイナリを取得できない）
- `npm run dist`（同上。かつ NSIS は Windows で動く）
- jsdom を要するテスト（`test/shell.test.js`）

依存を必要としないテストは、この環境でも `node --test` で回せる。
