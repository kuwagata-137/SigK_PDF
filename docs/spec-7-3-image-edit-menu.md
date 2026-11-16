# 画像の右クリックの「画像を編集する」（第2版 7-3）の仕様と記録

作成: 2026-11-12。作業ブランチ `claude/image-edit-menu`（`origin/main` = `dd12a64` から）。
決定の元: `docs/07_開発計画の決定事項.md` 決定88。質問 IE1・IE2 の図は、会話の中に表示しただけで、ファイルには残していない。

## 目的

ユーザーの依頼（2026-11-12）による。

> 画像ファイルを右クリックしたときに表示されるシェルコンテキストメニューに「画像を編集する」を追加して、編集モードで開くようにしたいです。
> このとき複数の画像を選択した状態でアプリが開いたら、タブ分けでこれらの画像が開くようにしたいです。

版 1.1.0 までに、画像をタブで開いて編集モードで書き込み、画像のまま保存する機能（7-1。`docs/spec-7-1-image-edit.md`）ができている。
ただし入口はツールバーの［開く］・ドロップ・Ctrl+O だけで、エクスプローラーから画像を編集する入口が無かった。決定86 ② で
「右クリックの「SigK PDF で編集」は別の PR」と後回しにしていた入口を、ここで足す。

「プログラムから開く」の一覧に画像で SigK PDF を出すこと（spec-7-1 の既知の限界）は、依頼に入っていないので扱わない。

## 事前調査（2026-11-12）

今ある仕組みで、そのまま使えるものと、足すものを分けた。

| 仕組み | 今の形 | 今回 |
|---|---|---|
| 右クリックの項目 | 画像 7 拡張子に「PDF に変換（SigK PDF）」（`build/installer.nsh` の `sigkWriteImageVerb`。`SystemFileAssociations\<ext>\shell\SigKPDF.ToPdf`・`MultiSelectModel=Player`） | 同じマクロに `SigKPDF.EditImage` を足す |
| 起動引数 | 意図は `--open`・`--merge`・`--split`・`--to-pdf` の 4 つ（`launch-args.js` の `INTENTS`）。`--open` は PDF と画像を受け、モードを変えない（決定80 ⑤） | `--edit-image` を足す |
| 複数選んだとき | Windows はファイル 1 つにつき 1 本のプロセスを起こす（`Player` でも束ならない。`docs/03` 1-2）。2 本目以降は 1 本目へ引数を渡して終わり、1 本目が束の印を付けて画面へ渡す（`launch-batch.js`） | そのまま使う |
| タブで開く | `renderer/launch.js` の `openTabs` が、届いた順番で 1 本ずつタブで開く（上限 20・通知バーは束に 1 回） | そのまま使う |
| 画像を開く | どの経路でも、画像はワーカーで PDF に組み立てられてタブで開く（spec-7-1 確定事項A4） | そのまま使う |
| モードの切り替え | `SigK.shell.setMode(doc, mode)`。切り替えたモードは設定に覚える。起動の要求で束の最初にモードを替える前例は `convert-intake.js` の `addFromLaunch`（ツールモードへ） | 同じ形で編集モード（`annot`）へ替える |

## 確定事項

| 番号 | 決まったこと | 根拠 |
|---|---|---|
| IE1 | 画像の右クリックメニューの 1 段目に「画像を編集する（SigK PDF）」を置き、今ある「PDF に変換（SigK PDF）」と並べる。親の項目にはまとめない | 質問 IE1 の答え「案A アプリ名併記（推奨）」。別案は、親の「SigK PDF」の下にまとめる案（1 手間増え、「PDF に変換」の場所も変わる）と、アプリの名前を付けない案（ほかのアプリの項目と並ぶと、どのアプリが開くか分からない） |
| IE2 | 版を 1.2.0 にする | 質問 IE2 の答え「案A 1.2.0（推奨）」。別案は 1.1.1 |
| C1 | 起動引数のスイッチは `--edit-image`、意図の名前は `editImage`。受けるのは画像 7 拡張子だけで、PDF と画像を混ぜて選んだときに届く PDF は捨てる | Claude の案。`--to-pdf` と同じ扱い |
| C2 | 束の最初の要求でだけ編集モード（`annot`）へ切り替え、そのあと 1 枚ずつタブで開く。同じ束の 2 件目以降ではモードを替えない（束が届いている間に使う人がモードを替えても引き戻さない） | Claude の案。`convert-intake.js` の `addFromLaunch` と同じ形。`docs/03` 3-3 の「同じ束の 2 件目以降では画面を切り替えない」と同じ |
| C3 | タブは届いた順番で並べる。名前の順番に並べ直さない | Claude の案。「SigK PDF で開く」（`open`）と同じ。届く順番はエクスプローラーの並びと限らない（`docs/03` 3-2） |
| C4 | 切り替えたモードは今までどおり設定に覚えるので、次にアプリを起動したときも編集モードで始まる | 今の `shell.setMode` の動き（ツールモードへの切り替えも同じ） |
| C5 | Windows 11 では「その他のオプションを確認」の中に出る | 決定44 ⑦。最初のメニューへの対応は第2版の検討事項（`docs/03` 第6章 #1） |

ツールモードから来ても、先に編集モードへ移すので、開いた画像は帯ではなくタブになり、選んでいたツールにも渡さない。
タブが 20 枚あるときは開かず、通知バーを束につき 1 回出す（`open` と同じ）。

## 変えたもの

| ファイル | 中身 |
|---|---|
| `launch-args.js` | `INTENTS` に `'--edit-image': 'editImage'`、`EXTENSIONS.editImage` に画像 7 拡張子 |
| `renderer/launch.js` | `editImages`（束の最初で `setMode('annot')`、そのあと `openTabs`）と、`APPLY.editImage` |
| `preload.js`・`smoke-launch.js` | 意図の一覧のコメント |
| `build/installer.nsh` | `sigkWriteImageVerb` に `SigKPDF.EditImage` の 4 つの値（`MUIVerb`「画像を編集する（${PRODUCT_NAME}）」・`Icon`・`MultiSelectModel`「Player」・`command`「`"<exe>" --edit-image "%1"`」）、`sigkRemoveImageVerb` で消す |
| `package.json` | 版 1.2.0 |
| `renderer/help-content.js` | 使い方の窓の右クリックメニューの説明 |
| 文書 | `docs/03`（2-3・3-1・3-3・4-1・第5章 #12）、`docs/07`（決定88・次の手順 136・決定86 ② の追記）、`docs/05`（第2版の節）、使い方ガイド（2 章の版・4 章・7 章の版・9 章）、`README.md` |

## テストの範囲

| テスト | 見ること |
|---|---|
| `test/launch-args.test.js` | `--edit-image` と画像 2 つで `{ intent: 'editImage', paths }`。PDF を混ぜても PDF は入らない。並べ替えられた argv でも読める。`EXTENSIONS.editImage` と `EXTENSIONS.toPdf` が同じ |
| `test/launch.test.js` | 閲覧モード・ツールモードから束を渡すと編集モードになり、タブが届いた順番で開く。画像→PDF へ渡さない。束の 2 件目ではモードを替えない。前回をツールモードで閉じていても、起動直後の要求で編集モードになる（前回の見た目の復元に戻されない） |
| `test/smoke-launch.test.js` | 起動確認の報告が、編集モードと画像のタブを返す |
| `test/installer-nsh.test.js` | 画像の拡張子が 2 つの項目とも 7 つ、`.EditImage` のコマンドは `--edit-image`、コマンドの数は 3＋7×2＋2、`Player`、表示名、書いたものを全部消す |

## 実装の記録

作りは `aa306e5`（起動引数・画面の受け口・インストーラー・テスト）、`4f4c957`（版 1.2.0）、`b2f25d9`（使い方の窓と文書）。

### 確かめたこと（2026-11-12、Windows 11 の実機）

- 試験は 3,497 件から 3,503 件になり、ふだんの時刻でも `TZ=UTC` でも fail 0。新しく足した `test/launch.test.js` の 4 件は、
  `renderer/launch.js` の変更を外すと 4 件とも落ちることを確かめた。
- 窓を出さない起動確認（`SIGK_SMOKE=1 SIGK_SMOKE_HIDDEN=1 SIGK_SMOKE_LAUNCH=5000`・scratchpad の `--user-data-dir`）で、
  1 本目を `--edit-image 写真1.png` で起こし、2 秒後に 2 本目を `--edit-image 写真2.png` で起こした。2 本目は 1 本目へ渡して終わり（終了コード 0）、
  1 本目の報告はモード `annot`・タブ 2 枚（写真1.png・写真2.png）・映している画像 写真2.png・problems 0 件・窓は隠れたまま（62 fps）だった。
- `npm run dist` で `dist\SigK PDF Setup 1.2.0.exe`（118,804,802 バイト。SHA-256 `1F463E5DCEA3D416DC0925D691C040259F5E7FE399425C389FC5BAEC0AFDED26`）を作った。

- 2026-11-12、ユーザーの了承（「入れてよい」）を得て、常用の SigK PDF（1.1.0）を 1.2.0 で上書きした。PowerShell のツールから `/S` で入れ、
  28 秒・終了コード 0。入れたあと、7 つの拡張子すべてで `SigKPDF.EditImage` の 4 つの値（`MUIVerb`「画像を編集する（SigK PDF）」・`Icon`・
  `MultiSelectModel`「Player」・`command`「`"…\SigK PDF.exe" --edit-image "%1"`」）と `SigKPDF.ToPdf` がそろっていることを読み出して確かめた。
  PDF の右クリック（`SigKPDF` の入口と `SigKPDF.Menu` の 3 項目）と関連付け（`SigKPDF.Document`・`Capabilities`・`RegisteredApplications`）も残っていた。
  インストールされているアプリの一覧の名前は「SigK PDF 1.2.0」、入った exe の版は 1.2.0.0。

- 2026-11-12、ユーザーが自分の画面で、画像を 2 つ選んで右クリックし、「その他のオプションを確認」→「画像を編集する（SigK PDF）」を押した。
  ユーザーの答えは「開いた」（`docs/03` 第5章 #12）。
