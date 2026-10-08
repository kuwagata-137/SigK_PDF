# 仕様書: Phase 5 塊② 「プログラムから開く」・既定のアプリ・アイコン

起草日: 2026-10-08
ステータス: **確定**（2026-10-08。着手の答えは `docs/07` 決定71〔計画の承認〕、事前調査後の論点 4 件は `docs/07` 決定72 で同日ユーザーが
決定。4 件とも起草者の推し。末尾「ユーザーの確定」を参照。残る細部は起草者の推しで書き、その一覧を「起草者の判断で決めたもの」に置いた）
ブランチ: `claude/phase-5-open-with`（`25493ec` から）
関連: `docs/05_開発ロードマップ.md` Phase 5（5-4・5-7）／`docs/01_製品要件定義.md` F-07-5／`docs/03_Windowsシェル統合設計.md` 1-1・1-3・2-1・
第4章・第5章 #9・第7章／`docs/spec-5-1-context-menu.md`（右クリックメニューと `build/installer.nsh` の作り。事前調査 B の別名のインストーラー）／
`docs/spec-4b-7b-help.md`（使い方の窓・メニュー「ヘルプ」）／`docs/04_UI設計.md` 第9章（アイコン）

この仕様書の「塊②」は Phase 5 の塊②を指す。

---

## 目的

SigK PDF を、Windows の「PDF を開くアプリ」として選べるようにする。今は次の 3 つが欠けている。

1. **「プログラムから開く」と既定のアプリ（F-07-5）**: `build/installer.nsh` は右クリックメニューのキーしか書いていない。PDF を右クリックして
   「プログラムから開く」を開いても SigK PDF は候補に出ず、Windows の「設定」→「アプリ」→「既定のアプリ」にも名前が無い。
2. **アプリのアイコン（5-7）**: アイコンのファイルが無く、exe・タスクバー・窓の左上・インストーラー・右クリックメニューの項目（`Icon`＝`<exe>,0`）は
   すべて Electron の既定の絵のまま。
3. **インストーラーの完了ページ**: 「その他のオプションを**表示**」は、日本語版 Windows 11 の項目名「その他のオプションを**確認**」と食い違う
   （`docs/07` 決定45 ⑤）。事前調査 I で、今の文が欄に入りきっていない見込みも分かった。

Windows 10 以降、アプリが自分で既定のアプリになることはできない（`docs/03` 1-3）。この塊では「選べるようにする」ところまでを作り、選ぶのは
本人が Windows の設定の画面で行う。

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| ProgID・`.pdf` の `OpenWithProgids`・`Applications\<exe>`・`Capabilities` と `RegisteredApplications` の登録と削除（`build/installer.nsh`） | `.pdf` の既定値（今の既定のアプリ）を書き換えること。インストーラーが既定のアプリを奪わない（`docs/03` 2-1） |
| アプリのアイコン（案B）と、PDF ファイルに出る紙の形の専用の絵。元の SVG・ICO を作る道具・出来上がりの ICO | 画像（PNG・JPEG など）の「プログラムから開く」。画像は右クリックの「PDF に変換」だけ（塊①） |
| アプリのメニュー「ヘルプ」の「既定のアプリの設定…」（Windows の設定の、SigK PDF のページを開く） | 既定のアプリかどうかを調べて、起動のたびに知らせること（論点3 で採らなかった） |
| 使い方の窓「画面とモード」の「エクスプローラーから」と、インストーラーの完了ページに一言 | 設定画面（Phase 6 の 6-2） |
| 完了ページの「確認」への直しと、欄の高さ | Windows 10 と既定の Windows 11 での見え方の目視（塊③） |

---

## 事前調査（2026-10-08・Windows 11 Pro 実機〔ビルド 26200.9457。25H2〕・Electron 44・electron-builder 26.15.3）

塊①の A0〜A4・B・C に続けて D〜I。台本は `~/.claude/plans/phase-5-2-probe/`（`e-build.ps1`・`e-check.ps1`・`AssocProbe.cs`・
`probe-installer.nsh`・`finish-measure.ps1`・`shot.js`）。

### D. 今の `.pdf` の関連付け — **SigK PDF の関連付けは何も無い**

レジストリを読むだけで調べた。このPCの `.pdf` の既定のアプリ（`UserChoice` の `ProgId`）は別のアプリで、`HKCU\Software\Classes\Applications\SigK PDF.exe` も
無い。`HKCU\Software\Classes\.pdf` は既定値の無い空のキーで、その下に空の `OpenWithProgids` がある（Windows か、ほかのアプリが作ったもの）。
→ 塊②のインストーラーで常用の SigK PDF を入れ替えても、今の既定のアプリは変わらない。

### E. 別名のインストーラーで登録・上書き・削除 — **候補に出て、上書きで消えず、削除で元に戻る（空の `.pdf` のキーを除く）**

塊①の事前調査 B と同じ別名（`SIGK_SHELL_ID`＝`SigKProbe`・製品名「SigK PDF Probe」・入れ先は scratchpad）に、確定事項A の登録を足した試作の
`.nsh` で作った（`-WX` のまま 52 秒で通った。`${isUpdated}` と `WriteRegNone` が使える）。

- **入れる**: 16 秒。値 53 個がすべて期待どおり（`OpenWithProgids` は REG_NONE、`.pdf` の既定値は書かれない）。
- **「プログラムから開く」の候補**: エクスプローラーと同じ `SHAssocEnumHandlers('.pdf')` を窓を出さずに呼ぶと、「SigK PDF Probe」が名前・exe・
  アイコン（`<exe>,0`）とともに出て、**おすすめ（recommended）**に入った。`.png` では「すべて」の側にだけ出て、おすすめには入らない
  （`SupportedTypes` が `.pdf` だけのため。メモ帳などと同じ扱い）。
- **上書き**: 5 つのキーに目印の値を付けてから入れ直した（19 秒）。メニューのキー 2 つは目印が消え（消してから書く）、関連付けのキー 3 つ
  （ProgID・`Applications\<exe>`・`Capabilities`）は目印が残った。**古いアンインストーラーが `--updated` 付きで走っても、関連付けを消さない**
  ことを確かめた（確定事項A6）。
- **削除**: `--delete-app-data` 付きで 7 秒。`SystemFileAssociations`・Uninstall・`RegisteredApplications`・`Classes` の直下・`Applications` の直下は
  入れる前の控えと一致した。**違ったのは 1 つだけで、入れる前から有った空の `HKCU\Software\Classes\.pdf`（と空の `OpenWithProgids`）を、
  「空になったキーを消す」処理が消した。** → 本番ではこの 2 つを消さない（確定事項A5）。調査のあとで空のキーを作り直し、控えと完全一致を確かめた。
  常用の `%APPDATA%\SigK PDF` には触れていない。

### F. 既定のアプリの設定を開く URI

`ms-settings:defaultapps?registeredAppUser=<RegisteredApplications の値の名前>` で、設定の「既定のアプリ」の、そのアプリのページへ直に飛ぶ。
飛び先のページを出すには確定事項A3 の `RegisteredApplications` が要る。名前が見つからない版・登録が無いとき（開発ツリー）は、既定のアプリの
画面の頭が開く見込み（**未確認**）。設定の窓が出るので、実装のあとに本物の入口から 1 回だけ開き、ユーザーに見てもらう（完了判定10）。

### G. アイコンの作り方 — **SVG を Electron の offscreen 描画で PNG にし、PNG 入りの ICO に詰める**

アイコンの絵は自作の SVG にし（`.claude/CLAUDE.md` 付則A）、Electron の offscreen の窓に大きさごとに並べて描き、透明な地のまま切り出して
PNG にする（`docs/` の見本と同じ描き方）。ICO は「6 バイトの頭＋1 枚 16 バイトの目録＋PNG の中身」だけの形なので、依存を足さずに書く。
electron-builder は `win.icon` の ICO を exe・インストーラー・アンインストーラーに入れる（`NsisTarget.js:191`。`installerIcon` を書かなければアプリの
アイコンが使われる）。今は `default Electron icon is used reason=application icon is not set` と出ている。

### H. アイコンを使う場所

| 場所 | 出る絵 | 出し方 |
|---|---|---|
| exe・タスクバー・スタートメニュー・デスクトップのショートカット・「アプリと機能」 | アプリ（案B） | electron-builder が exe に入れる（`win.icon`） |
| インストーラー・アンインストーラーの exe と窓 | アプリ | 同上（既定でアプリのアイコン） |
| 窓の左上・開発ツリーの `electron .` のタスクバー | アプリ | `BrowserWindow` の `icon`（配布物では exe の絵が先に使われる） |
| 右クリックメニューの「SigK PDF」「SigK PDF で開く」「PDF に変換（SigK PDF）」 | アプリ | `Icon`＝`<exe>,0`（塊①のまま） |
| 「プログラムから開く」・設定の既定のアプリの一覧 | アプリ | `<exe>,0`（`ApplicationIcon`） |
| SigK PDF を既定にしたときの、エクスプローラーの PDF ファイル | **紙の形の専用の絵** | ProgID と `Applications\<exe>` の `DefaultIcon`＝`$INSTDIR\resources\pdf-file.ico` |
| バージョン情報の窓 | アプリ | `dialog.showMessageBox` の `icon` |

### I. 完了ページの文の欄 — **今の文は 6 行で、5 行の欄に入りきらない**

electron-builder は「完了後に起動」のチェックボックス（`MUI_FINISHPAGE_RUN`）を置くので、文の欄は高さ 40 ダイアログ単位
（`Modern UI 2/Pages/Finish.nsh` の `MUI_FINISHPAGE_TEXT_HEIGHT_BUTTONS`）になる。日本語のインストーラーの字体（ＭＳ Ｐゴシック 9pt。
`Japanese.nlf`）で換算すると、幅 292px・高さ 60px（12px の行で 5 行）。`MUI_FINISHPAGE_TEXT_LARGE` を定義すると 60 単位（90px・7.5 行）に
広がり、チェックボックスはその下へずれる。窓を出さずに `TextRenderer` で折り返して測った。

| 文 | 行数 | 40 単位 | 60 単位 |
|---|---|---|---|
| 塊①の今の文（「表示」） | 6 | 入らない | 入る |
| 「確認」に直し、既定のアプリの一言を足し、「ウィザードを閉じるには…」も残す | 10 | 入らない | 入らない |
| 同上から「ウィザードを閉じるには…」を除く（**採用**） | 7 | 入らない | 入る |
| 同上で「SigK PDF のメニュー」と書く | 8 | 入らない | 入らない |

→ **塊①の今の完了ページは、最後の「ウィザードを閉じるには [完了] を押してください。」が欄の外で切れている見込み**（測っただけで、実物の画面は
見ていない。判定12 は塊③）。この塊で欄を広げ、文を 7 行にする（確定事項D）。

---

## 確定事項

### A. 登録（`build/installer.nsh`。決定72 ④・事前調査 E）

キー名は塊①と同じく `SIGK_SHELL_ID` から組み、`<exe>` は `$INSTDIR\${APP_EXECUTABLE_FILENAME}`、`<doc>` は `$INSTDIR\resources\pdf-file.ico`。
すべて `HKCU` に、REG_SZ で書く（`OpenWithProgids` の値だけ REG_NONE）。

| # | キー（`HKCU\` の下） | 値（名前＝データ） |
|---|---|---|
| A1 | `Software\Classes\SigKPDF.Document` | （既定）＝`PDF 文書` |
| | `…\DefaultIcon` | （既定）＝`<doc>` |
| | `…\shell\open\command` | （既定）＝`"<exe>" --open "%1"` |
| A2 | `Software\Classes\.pdf\OpenWithProgids` | `SigKPDF.Document`＝（空の REG_NONE） |
| A3 | `Software\Classes\Applications\SigK PDF.exe` | `FriendlyAppName`＝`SigK PDF` |
| | `…\DefaultIcon` | （既定）＝`<doc>` |
| | `…\shell\open\command` | （既定）＝`"<exe>" --open "%1"` |
| | `…\SupportedTypes` | `.pdf`＝（空の文字列） |
| A4 | `Software\SigKPDF\Capabilities` | `ApplicationName`＝`SigK PDF`・`ApplicationDescription`＝`PDF の閲覧・ページの編集・書き込み・結合・分割・変換`・`ApplicationIcon`＝`<exe>,0` |
| | `…\FileAssociations` | `.pdf`＝`SigKPDF.Document` |
| | `Software\RegisteredApplications` | `SigK PDF`＝`Software\SigKPDF\Capabilities` |

- **A5 消すとき**: A1・A3・`Software\SigKPDF` はキーごと消す。A2 は自分の値だけを消し、A4 の `RegisteredApplications` も自分の値だけを消す。
  **`.pdf`・`.pdf\OpenWithProgids`・`Applications`・`RegisteredApplications` は、空になっても消さない**（Windows やほかのアプリが前から作っている
  ことが多く、このPCにも空の `.pdf` が有った〔事前調査 E〕。空のキーは関連付けに何も効かない）。`Software\SigKPDF` は自分のキーなので、
  空なら消す（`sigkPruneEmptyKey`）。
- **A6 上書きインストール**: 関連付け（A1〜A4）は、書く前に消さず上書きだけにする。アンインストールでは `${ifNot} ${isUpdated}` のときだけ消す
  （上書きインストールでは古いアンインストーラーが `--updated` 付きで走る）。上書きの途中で ProgID が消える時間を作らず、SigK PDF を既定に
  選んでいた人の選択を守るため。メニューのキー（塊①）は今までどおり消してから書く。
- **A7 `.pdf` の既定値には書かない。**electron-builder の `fileAssociations`（`FileAssociation.nsh:66`）は `Software\Classes\.pdf` の既定値を
  書き換えるので使わない。
- **A8** 書いた後と消した後の `SHChangeNotify(SHCNE_ASSOCCHANGED)` は塊①のまま（1 回ずつ）。
- **A9** 塊①の確定事項29（マクロと define だけ・`Var`・`Function` を置かない）を守る。

### B. アイコン（決定72 ①②・事前調査 G・H）

- **B1 アプリのアイコンは案B**（角の丸い青い四角に白い紙。紙に文字の行 2 本と青いペンの線）。青は画面の `--primary`（`#2f6feb`）を上下の
  濃淡にしたもの。見本は `screenshots/phase5-2-icon-candidates.png`。
- **B2 PDF ファイルの絵は紙の形の専用の絵**（白い紙・右上の折れ・文字の行 3 本、下にアプリの印を小さく）。
- **B3 大きさ**: ICO に 16・20・24・32・40・48・64・256px を入れる（100〜250% の表示倍率で Windows が選ぶ大きさ）。どれも 32 ビット（透明の地）の PNG。
  16〜24px は、ペンの線と文字の行を省いた形を別に描く（小さいと線が潰れて汚れに見えるため。見本で確かめる）。
- **B4 ファイルの置き場所**: 元の絵は `build/icon-app.svg`・`build/icon-app-small.svg`・`build/icon-pdf-file.svg`（配布物に入れない）。出来上がりは
  `assets/icon.ico`（アプリ。`build.files` の `assets/**` で app.asar にも入り、`BrowserWindow` が読む）と `build/pdf-file.ico`（PDF ファイル。
  `build.extraResources` で `resources\pdf-file.ico` へ写す。シェルは app.asar の中を読めないため）。
- **B5 作る道具**: `scripts/build-icons.js`（Electron で動かす。`npm run icons`）。SVG を offscreen の窓に大きさごとに並べて 1 回描き、切り出して
  ICO に詰める。ICO の読み書きは `scripts/ico-file.js`（`packIco`・`readIco`。テストが出来上がりの ICO を読むのにも使う）。ICO はリポジトリに
  置き、ビルドのたびには作らない（ビルドステップを置かない方針。`.claude/CLAUDE.md` 付則A）。
- **B6** `package.json` の `build.win.icon`＝`assets/icon.ico`。`main.js` の `BrowserWindow` の `icon` と、バージョン情報の窓の `icon` に同じ ICO を使う。

### C. 既定のアプリの入口（決定72 ③④・事前調査 F）

- **C1** アプリのメニュー「ヘルプ」を「使い方」「既定のアプリの設定…」「（区切り）」「バージョン情報」の順にする。
- **C2** 「既定のアプリの設定…」を押すと、`ms-settings:defaultapps?registeredAppUser=<アプリの名前>` を `shell.openExternal` で開く。アプリの名前は
  `app.getName()`（製品名。インストーラーの `RegisteredApplications` の値の名前 `${PRODUCT_NAME}` と同じ）を URI の決まりで符号化する。
  URI は新しいモジュール `default-apps-link.js` が組む（main.js は単体テストが無いため）。開けなかったときはエラーのログに残す（窓は出さない）。
- **C3** 使い方の窓「画面とモード」の「エクスプローラーから」に 1 項目足す:
  「PDF をダブルクリックしたときに SigK PDF で開くには、メニュー「ヘルプ」→「既定のアプリの設定…」で Windows の設定を開き、SigK PDF を
  選びます。PDF を右クリックして「プログラムから開く」から選ぶこともできます。」
  ⑦-b の仕様書の付録を書き出し直す（`help-appendix-apply.js`）。

### D. インストーラーの完了ページ（決定45 ⑤・決定72 ③・事前調査 I）

- **D1** 文（／は空行）: 「`${PRODUCT_NAME}` のインストールが完了しました。／PDF と画像の右クリックメニューから使えます。Windows 11 では
  「その他のオプションを確認」の中にあります。／PDF をダブルクリックで開くアプリにするには、メニュー「ヘルプ」→「既定のアプリの設定…」から
  選んでください。」（7 行）
- **D2** `MUI_FINISHPAGE_TEXT_LARGE` を定義して文の欄を 60 単位（7.5 行）にする。「完了後に起動」のチェックボックスは欄の下に残る。
- **D3** 塊①の文の「ウィザードを閉じるには [完了] を押してください。」は除く（入りきらないため。決定44 ⑦の文から変えた。起草者の判断）。

### E. 起動確認（開発ツリーと配布物。窓は出さない）

- **E1** 起動確認の報告に `appShell` を足す: メニュー「ヘルプ」の項目の名前の並び・`assets/icon.ico` を `nativeImage` で読めたか（大きさ）。
  配布物では app.asar の中から読めることを確かめる。
- **E2** 配布物の `resources\pdf-file.ico` があり、exe からアイコンを取り出すと案B の絵であることを、窓を出さずに確かめる（PowerShell の
  `ExtractAssociatedIcon` で PNG にして見る）。
- **E3** 実装後のコードで別名のインストーラーを作り直し、事前調査 E と同じ確かめ（値・候補・上書き・削除と控えの突き合わせ）を通す。DefaultIcon が
  `resources\pdf-file.ico` を指し、そのファイルが実在することも見る。

## 足りない部品

### 新しいモジュール

| モジュール | 役目 | テスト |
|---|---|---|
| `default-apps-link.js` | 既定のアプリの設定を開く URI を組む（C2） | `test/default-apps-link.test.js` |
| `scripts/ico-file.js` | ICO の読み書き（B5） | `test/ico-file.test.js`（詰めて読み戻す・壊れた頭を断る）、`test/app-icon.test.js`（出来上がりの 2 つの ICO の大きさと PNG の中身） |
| `scripts/build-icons.js` | SVG → PNG → ICO（B5。Electron で動かす手回しの道具） | 出来上がりを `test/app-icon.test.js` が見る |

### 既存への追記

- `build/installer.nsh`: 確定事項A・D。
- `package.json`: `build.win.icon`・`build.extraResources`・`build.files` に `default-apps-link.js`・`scripts` に `icons`。
- `main.js`: メニュー（C1・C2）・`BrowserWindow` の `icon`・バージョン情報の `icon`・起動確認の `appShell`（E1）。
- `renderer/help-content.js`: C3。
- テスト: `test/installer-nsh.test.js`（下の「テストの範囲」）、`test/dist-files.test.js`（`win.icon` と `extraResources` の元が在る）。
- 文書: `docs/03`（1-1・1-3・2-1・4-1・4-2・第5章 #9・第7章）、`docs/01` F-07-5 の注記、`docs/02` のモジュール一覧、`docs/04`（メニュー・第9章に
  アプリのアイコン）、`docs/05` Phase 5、`docs/07`（決定・次の手順・積み残しの「完了ページ」の行）、README、`docs/spec-4b-7b-help.md` の付録。

## テストの範囲

- `test/installer-nsh.test.js`（塊①の 14 本を直して足す）:
  - 完了ページに「その他のオプションを確認」があり「表示」が無い。`MUI_FINISHPAGE_TEXT_LARGE` が定義されている。「既定のアプリの設定…」の名前が
    `main.js` のメニューと一致する。
  - 関連付けの書きと消しが対応する（A1・A3・Capabilities はキーごと、A2・RegisteredApplications は値ごと）。
  - `Software\Classes\.pdf` の既定値に書かない。`.pdf`・`.pdf\OpenWithProgids`・`Applications`・`RegisteredApplications` を消さない（Prune の対象にしない）。
  - 関連付けの消しは `customUnInstall` の `${ifNot} ${isUpdated}` の中だけで、`customInstall` では関連付けを消さない。
  - `DefaultIcon` は `$INSTDIR\resources\pdf-file.ico`、`ApplicationIcon` は `<exe>,0`。`RegisteredApplications` の値が `Capabilities` のキーを指す。
  - HKCU だけ・`Var`・`Function` が無い・キー名を `SIGK_SHELL_ID` から組む（塊①のまま）。
- `test/default-apps-link.test.js`: 名前の符号化（空白・日本語・`&`）、名前が無いときは `ms-settings:defaultapps` だけ。
- `test/ico-file.test.js`・`test/app-icon.test.js`: B3 の大きさがそろう、PNG の頭と幅・高さが目録と一致、色の型が透明あり（6）。
- `test/dist-files.test.js`: `build.win.icon` と `build.extraResources` の元のファイルが在る。

## 完了の判定

| # | 判定 | 確かめ方 |
|---|---|---|
| 1 | インストーラーが A の値を書き、`.pdf` の既定値に書かない | `installer-nsh` のテスト。別名のインストーラーで値を照合（E3） |
| 2 | 「プログラムから開く」の候補に出る（おすすめ） | 別名のインストーラーで `SHAssocEnumHandlers('.pdf')`（E3） |
| 3 | 上書きインストールで関連付けが消えない。アンインストールで消え、控えと一致する | 別名のインストーラーの目印と控え（E3） |
| 4 | 完了ページが「確認」で、7 行の文が広げた欄に入る | `installer-nsh` のテスト。事前調査 I の測り方 |
| 5 | アプリのアイコンが案B で、ICO に B3 の大きさがそろう | `app-icon` のテスト。`npm run dist` のログに「default Electron icon」が出ない。exe から取り出した絵（E2） |
| 6 | PDF ファイルの絵が `resources\pdf-file.ico` にあり、DefaultIcon が指す | 配布物のファイル。別名のインストーラーで実在を確かめる（E3） |
| 7 | メニュー「ヘルプ」に「既定のアプリの設定…」があり、押すと C2 の URI を開く | `default-apps-link` のテスト。起動確認の `appShell`（E1） |
| 8 | 使い方の窓に C3 の項目がある | `help-content` のテスト。付録の書き出し |
| 9 | `npm test` の fail 0（`TZ=UTC` も）、開発ツリーと配布物の起動確認が通る | 実行の記録 |
| 10 | 既定のアプリの設定の、SigK PDF のページが開く（**ユーザーの目視**） | 別名のインストーラーを入れた状態で、別名のアプリのメニューから開く |

---

## ユーザーの確定

### 着手（2026-10-08。`docs/07` 決定71）

計画の承認。到達点は塊②の作業ブランチへの push まで。PR は 1 本。レジストリへ書く直前に声をかけ、常用の SigK PDF には触らない。

### 事前調査後（2026-10-08。`docs/07` 決定72。4 件とも起草者の推し）

| # | 論点 | 確定（括弧内は採らなかった案） |
|---|---|---|
| ① | アプリのアイコンの絵柄 | **案B 青い札に紙とペン**（案A 紙に K：PDF ファイルの絵と似て見える／案C 重ねた紙とマーカー：24px 以下で潰れる） |
| ② | SigK PDF を既定にしたときの PDF ファイルの絵 | **紙の形の専用の絵**（アプリの絵そのまま：ファイルとアプリのショートカットが同じ絵になる） |
| ③ | 既定のアプリの入口 | **メニュー「ヘルプ」＋使い方の窓＋完了ページ**（メニューだけ／起動のたびの帯：選ばない人に毎回出る） |
| ④ | 設定の「既定のアプリ」の一覧に名前を出す | **出す**（出さない：拡張子の行から探すことになり、入口から直に飛べない） |

### 起草者の判断で決めたもの

- 関連付けは上書きインストールで消さない（A6）。`.pdf`・`.pdf\OpenWithProgids`・`Applications`・`RegisteredApplications` は空でも消さない（A5）。
- ProgID の表示名は `PDF 文書`、`ApplicationDescription` は A4 の文。
- 完了ページの文から「ウィザードを閉じるには…」を除き、欄を広げた（D2・D3）。
- メニューの名前は「既定のアプリの設定…」（押すと Windows の設定が開くだけで、押しただけでは既定にならないため「〜に設定」とは書かない）。
- 16〜24px は省いた形を別に描く（B3）。ICO は依存を足さずに書く（B5）。
- `Applications\<exe>` の `DefaultIcon` も PDF ファイルの絵にする（「プログラムから開く」で選ばれたときにも同じ絵が出るように）。

## 既知の限界

- **アンインストールすると、SigK PDF を既定に選んでいた人の `.pdf` は既定のアプリが無い状態になる**（ProgID が消えるため。次に PDF を開くと
  Windows が選び直しを聞く）。Windows の決まりで、アプリが前の既定のアプリへ戻すことはできない。
- 設定の画面の飛び先（事前調査 F）は Windows 11 ビルド 26200 で確かめる（完了判定10）。Windows 10 と古い Windows 11 での飛び先は塊③。
- 完了ページの行数は字体の換算で測ったもので、実物の画面は塊③の判定12 で見る。
- `.png` などの「プログラムから開く」の「すべて」の一覧にも SigK PDF が出る（事前調査 E。`Applications` に登録したアプリはそうなる）。
  選ぶと SigK PDF が起動するが、画像は開かない（`--open` は PDF だけを受ける）。

---

## 実装の記録（2026-10-08・`claude/phase-5-open-with` ブランチ）

`25493ec`（PR #43 のマージ）から切った。手順0 `f5d31c8` → 仕様書 `5a0fcb1` → c1 `a4b8fa8`（アイコンの SVG・ICO・作る道具）→ c2 `bc2470c`
（既定のアプリの入口・窓とバージョン情報のアイコン・起動確認の `appShell`）→ c3 `b761d87`（インストーラー）→ c4 `ecc7482`（使い方の窓）→
文書 → 点検の直し → 仕上げの文書。テストは 2,770 → 2,784 件（`TZ=UTC` でも緑）。インストーラーは 118,640,442 バイト（⑦-b の 118,577,525 から
+62,917）。調べるための台本は `~/.claude/plans/phase-5-2-probe/`。

### 仕様書から足したこと・変えたこと（起草者の判断）

- **見本からの絵の直し**: 見本の案B は、ペンの線の右端が紙の外へ少しはみ出していた。線を短くして紙の中に収めた。PDF ファイルの絵は、32px で
  紙の縁が薄かったので、縁の線を 6 から 8 に太くした。見本は `screenshots/phase5-2-icon-app.png`・`phase5-2-icon-pdf-file.png`。
- **アイコンを作る道具の守り**: SVG のコメントに `--`（ハイフン 2 つ）を書いて SVG ごと読めなくなり、壊れた画像の印が ICO に入りかけた。
  道具は、全部の絵を読めたかと、切り出しに色の付いた画素があるかを確かめてから詰め、だめなら止まる。テスト（`app-icon`）もコメントの `--` を見張る。
- **offscreen の描き方**: 絵を読み終えた直後・描き直しの直後には、空や透明の 1 枚が届くことがあった（どちらも試して見た）。読み終えて 800ms 待ってから
  描き直させ、頁の大きさの 1 枚を受け取る。画面の倍率と色の管理は 1 と sRGB に固定した。
- **インストーラーのテストのコマンドの数**: 関連付けの open のコマンド 2 つ（ProgID・`Applications`）が増えたので、数え方を直した。

### 完了の判定の結果

| # | 判定 | 結果 | 証拠 |
|---|---|---|---|
| 1 | インストーラーが A の値を書き、`.pdf` の既定値に書かない | ✅ | `installer-nsh` のテスト 16 本。別名のインストーラー（本物の `installer.nsh`）で値 52 個が一致、`.pdf` の既定値は書かれない |
| 2 | 「プログラムから開く」の候補に出る（おすすめ） | ✅ | 別名で `SHAssocEnumHandlers('.pdf')` に「SigK PDF Probe」がおすすめとして出た |
| 3 | 上書きインストールで関連付けが消えない。アンインストールで消え、控えと一致する | ✅ | 目印を付けて入れ直すと、関連付けのキー 3 つの目印は残り、メニューのキーの目印は消えた。`--delete-app-data` 付きで外すと 5 つの控えが完全一致（前から有った空の `.pdf` も残った） |
| 4 | 完了ページが「確認」で、7 行の文が広げた欄に入る | ✅ | `installer-nsh` のテスト。事前調査 I の測り方で 84px（欄は 90px） |
| 5 | アプリのアイコンが案B で、ICO に B3 の大きさがそろう | ✅ | `app-icon` のテスト。`npm run dist` に「default Electron icon」が出ない。配布物の exe とインストーラーから 16・32・48・256px を取り出して案B を確かめた |
| 6 | PDF ファイルの絵が `resources\pdf-file.ico` にあり、DefaultIcon が指す | ✅ | 配布物の `resources` に 13,753 バイト。別名で DefaultIcon の指すファイルの実在を確かめた |
| 7 | メニュー「ヘルプ」に「既定のアプリの設定…」があり、押すと C2 の URI を開く | ✅ | `default-apps-link` のテスト。起動確認の `appShell`（開発ツリーと配布物）で「使い方／既定のアプリの設定…／-／バージョン情報」、アイコン 256px を読めた |
| 8 | 使い方の窓に C3 の項目がある | ✅ | `help-content` のテスト。spec-4b-7b の付録を書き出し直した |
| 9 | `npm test` の fail 0（`TZ=UTC` も）、開発ツリーと配布物の起動確認が通る | ✅ | 2,784 件 fail 0（`TZ=UTC` も）。起動確認は problems なし |
| 10 | 既定のアプリの設定の、SigK PDF のページが開く（ユーザーの目視） | ✅ | 別名を入れた状態で `ms-settings:defaultapps?registeredAppUser=SigK%20PDF%20Probe` を開くと、「アプリ › 既定のアプリ › SigK PDF Probe」のページで「.pdf」の行が出た（ユーザーの了承を得て、開いていた設定の窓で開いた。`screenshots/phase5-2-default-apps-page.png`。名前とメールは切り落とした）。このPCの `.pdf` の既定のアプリは、調べる前とあとで変わっていない |
