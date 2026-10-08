# SigK PDF Windows シェル統合設計

作成日: 2026-08-29（2026-09-28 改訂。Phase 5 塊①の実装と実測（`docs/spec-5-1-context-menu.md`）に合わせて、第1〜5章と第7章を書き直した。
2026-10-08 改訂。Phase 5 塊②（`docs/spec-5-2-open-with-icon.md`）に合わせて、1-1・1-3・2-1・第4章・第5章・第7章を書き直した）
関連: `docs/01_製品要件定義.md` F-07 / `docs/02_アーキテクチャ設計.md` 第2章・第7章 / `docs/spec-5-1-context-menu.md` / `docs/spec-5-2-open-with-icon.md` / `build/installer.nsh`

エクスプローラーの右クリックメニューからアプリの各機能へ直行させるための設計である。要件 F-07-1〜F-07-5 を実現する経路と、Windows 側の制約を先に整理する。

右クリックメニュー（F-07-1〜F-07-4）は Phase 5 塊①で実装した（2026-09-25。PR #25）。「プログラムから開く」と既定のアプリ（F-07-5。1-3・2-1）は塊②で実装した（2026-10-08）。採らなかった当初の案は、3-2 と第4章の末尾に経緯として短く残した。

---

## 1. 先に押さえるべき制約

### 1-1. Windows 11 では既定のメニューに出ない

Windows 11 はコンテキストメニューを刷新した。**レジストリに登録した従来型の項目（verb）は、Windows 11 では最初に出るメニューには現れず、「その他のオプションを確認」（Shift+F10 でも開く従来型メニュー）の下に入る。**

日本語版の項目名は「その他のオプションを確認」である（2026-09-28 に公開の解説記事で確かめた。実物は塊③で見る。**2026-10-08**: Windows のファイルから読み出して確かめた。`spec-5-3` 事前調査 M）。この文書とインストーラーの完了ページは 2026-09-28 まで「その他のオプションを表示」と書いていた。完了ページの文言は塊②で直した（2026-10-08。`docs/07` 決定45 ⑤）。

Windows 11 の最初のメニューに項目を出すには、アプリを MSIX またはスパースパッケージとして登録し、`IExplorerCommand` を実装した COM サーバーを持たせる必要がある。これは C++ による COM DLL の実装とパッケージ署名を伴い、Electron アプリの通常の配布形態（NSIS インストーラー）から大きく外れる。

したがって第1版は次のとおりとする。

- **第1版はレジストリ方式のみを実装する。** Windows 10 では従来どおりの右クリックメニューに出る。Windows 11 では「その他のオプションを確認」の下に出る。
- この挙動を**インストーラーの完了ページ**と `docs/インストールと使い方ガイド.md`（塊③）で知らせる。ユーザーが「メニューに出ない」と誤解するのを防ぐ。インストール前の説明ページは設けない（`docs/spec-5-1-context-menu.md` 確定事項31）。
- Windows 11 の最初のメニューへの対応は第2版以降の検討事項とする（第6章）。

塊①の実測に使ったPCには「従来型のメニューに戻す」設定が入っており、従来型の項目が最初のメニューに出る。Windows 10 と既定の Windows 11 での見え方は、塊③の実機確認で見る。**2026-10-08（塊③）**: このPCの設定は同じままなので、既定の
Windows 11 の最初のメニューの実物は見ていない。Windows 10 はパソコンが無く未確認（`docs/spec-5-3-device-check.md` No.25）。

### 1-2. 複数ファイル選択時は1ファイルにつき1回起動される

レジストリの `command` 方式では、シェルは選択されたファイル1つごとにコマンドを起動する。`%1` に入るのはそのファイル1つだけである。したがって「選択した PDF を結合」を素直に書くと、**5個選べばアプリが5回起動する。**`MultiSelectModel` を `Player` にしても 1 本には束ならない（事前調査 A1 で実測した）。

回避策は2つある。

| 方式 | 内容 | 判断 |
|---|---|---|
| COM ハンドラ（`DropTarget` / `IExecuteCommand`） | 1回の呼び出しですべてのパスを受け取れる。Windows が公式に用意した経路 | ネイティブ COM サーバーの実装が要る。第1版では採らない |
| 単一インスタンス＋束の印 | 2 本目以降は引数を 1 本目へ渡してすぐ終わる。1 本目は届くたびに画面へ渡し、同じ操作が短い間隔で続いたものに同じ「束」の印を付ける（3-2） | **第1版はこれを採った。**実装は Electron 側だけで完結する |

選ぶ数にも壁がある。項目に `MultiSelectModel` が無いと、16 個以上選んだときに項目そのものが出ない（しきい値は `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\MultipleInvokePromptMinimum`、既定値 15）。**PDF の入口（カスケードの親）と画像の項目に `MultiSelectModel=Player` を付けたので、何個選んでも出る**（事前調査 A1・A2、`docs/spec-5-1-context-menu.md` 確定事項26）。16 個以上を選ぶと「開く」「印刷」など Windows の既定の項目は消え、SigK PDF の入口がメニューの先頭に来る（2026-09-28 にこのPCで列挙して確かめた）。多すぎる分は、アプリの側の上限（結合・画像→PDF は 100 ファイル、タブは 20 枚）の帯で断る。

当初は「16 個以上では項目が出ないので、アプリを開いてから結合画面へ足す動線を案内する」としていた。2026-09-25 の事前調査 A2 で親の `Player` が効くと分かり、論点5 で改めた。

### 1-3. 既定のアプリはプログラムから設定できない

Windows 10 以降、拡張子の既定の関連付けをアプリ側から書き換えることはできない。インストーラーでレジストリを書いても、既定のアプリにはならない。

F-07-5 は次の形で満たす。塊②で実装した（2026-10-08。`docs/spec-5-2-open-with-icon.md`）。

- `HKCU\Software\Classes\Applications\SigK PDF.exe` を登録し、「プログラムから開く」の一覧に SigK PDF を出す。
- `.pdf` の `OpenWithProgids` に自前の ProgID を足し、選択肢として提示されるようにする。`spec-5-2` 事前調査 E で、Windows の API
  `SHAssocEnumHandlers('.pdf')` で候補を並べると「おすすめ」に入ることを確かめた（Microsoft の資料では、エクスプローラーの「プログラムから
  開く」もこの API と同じ情報を使う。本物の窓は塊③で見る。2026-10-08 の塊③では、本物の窓は `spec-5-3` の「あなたの画面で見る項目」⑤に回した）。
- `Capabilities` と `RegisteredApplications` を書き、Windows の「設定」→「アプリ」→「既定のアプリ」の一覧に名前を出す（決定72 ④）。
- アプリのメニュー「ヘルプ」→「既定のアプリの設定…」から `ms-settings:defaultapps?registeredAppUser=<製品名>` を開き、ユーザー自身に
  選んでもらう（SigK PDF の中の設定画面〔Phase 6 の 6-2 で作る〕がまだ無いので、メニューに置いた。決定72 ③）。Windows 11 ビルド 26200 で、
  この URI で設定の「既定のアプリ」のそのアプリのページへ直に飛ぶことを確かめた。

---

## 2. レジストリの設計

すべて `HKCU`（現在のユーザー）配下に書く。管理者権限を必要としないためで、`nsis.perMachine: false` と整合する。インストールの種類（自分だけ／全員）を選ぶページは出さず、自分だけに固定した（`build/installer.nsh` の `customInstallMode`。`docs/spec-5-1-context-menu.md` 確定事項30）。

キー名の `SigKPDF` は `build/installer.nsh` の `SIGK_SHELL_ID`、表示名の「SigK PDF」は `${PRODUCT_NAME}` から組む。下の `<exe>` は `$INSTDIR\SigK PDF.exe`（`$INSTDIR\${APP_EXECUTABLE_FILENAME}`）を表す。

### 2-1. ProgID と「プログラムから開く」

**塊②で実装した（2026-10-08。`docs/spec-5-2-open-with-icon.md` 確定事項A）。**`<doc>` は PDF ファイルの絵 `$INSTDIR\resources\pdf-file.ico`
（シェルは app.asar の中を読めないので、`extraResources` で出したもの。決定72 ②）。

```
HKCU\Software\Classes\SigKPDF.Document
    (既定)                     = "PDF 文書"
    \DefaultIcon\(既定)        = "<doc>"
    \shell\open\command\(既定) = "\"<exe>\" --open \"%1\""

HKCU\Software\Classes\.pdf\OpenWithProgids
    SigKPDF.Document           = (空の REG_NONE)

HKCU\Software\Classes\Applications\SigK PDF.exe
    FriendlyAppName            = "SigK PDF"
    \DefaultIcon\(既定)        = "<doc>"
    \shell\open\command\(既定) = "\"<exe>\" --open \"%1\""
    \SupportedTypes
        .pdf                   = ""

HKCU\Software\SigKPDF\Capabilities
    ApplicationName            = "SigK PDF"
    ApplicationDescription     = "PDF の閲覧・ページの編集・書き込み・結合・分割・変換"
    ApplicationIcon            = "<exe>,0"
    \FileAssociations
        .pdf                   = "SigKPDF.Document"

HKCU\Software\RegisteredApplications
    SigK PDF                   = "Software\SigKPDF\Capabilities"
```

`.pdf` キーの既定値は**書き換えない**。他のアプリが握っている既定の関連付けを、インストーラーが黙って奪わないためである。electron-builder の
`fileAssociations`（`FileAssociation.nsh`）はこの既定値を書き換えるので使わない。

当初の設計（2026-08-29〜09-28）は ProgID の `DefaultIcon` を `<exe>,0` とし、`Applications` に `DefaultIcon` を置かず、`Capabilities` と
`RegisteredApplications` を書かない形だった。論点（決定72 ②④）で改めた。

### 2-2. PDF に対するカスケードメニュー

「SigK PDF」という1つの入口の下に、開く・結合・分割の3項目を畳む。項目本体は別のキーに置き、`ExtendedSubCommandsKey` で参照する。

```
HKCU\Software\Classes\SystemFileAssociations\.pdf\shell\SigKPDF
    MUIVerb                    = "SigK PDF"
    Icon                       = "<exe>,0"
    MultiSelectModel           = "Player"
    ExtendedSubCommandsKey     = "SigKPDF.Menu"

HKCU\Software\Classes\SigKPDF.Menu\shell
    \01open
        MUIVerb                = "SigK PDF で開く"
        Icon                   = "<exe>,0"
        \command\(既定)        = "\"<exe>\" --open \"%1\""
    \02merge
        MUIVerb                = "選択した PDF を結合"
        \command\(既定)        = "\"<exe>\" --merge \"%1\""
    \03split
        MUIVerb                = "PDF を分割"
        \command\(既定)        = "\"<exe>\" --split \"%1\""
```

サブキー名を `01open` `02merge` `03split` としているのは、シェルがサブキーを名前順に並べるためである。表示名は `MUIVerb` で与える。

**`MultiSelectModel = "Player"` は親に付け、子には付けない。**事前調査 A2 で、子の `MultiSelectModel` は表示にも起動にも効かないこと、親に何も無いと 16 個以上で親ごと消えることが分かった。親に `Player` を付けると、16・20 個でもカスケードが出て子 3 つがそろう。`Player` を付けても呼び出しは 1 ファイルずつなので、束ねるのはアプリの側である（第3章）。子に `Single` を付けても効かないため、2 個以上選んでも「PDF を分割」は出る。そのときはアプリがファイル名の順の先頭 1 本を対象にする（3-3）。

当初の設計は子の `02merge` に `Player` を付け、親には付けていなかった。2026-09-25 の事前調査 A2 で改めた。

`SystemFileAssociations` の下に置く理由は、`.pdf` の既定のアプリが何であっても項目が出るためである。ProgID（`SigKPDF.Document`）の下に置くと、既定のアプリが SigK PDF になっているときしか出ない。

### 2-3. 画像に対する項目

画像は入口を畳まず、1項目だけ出す。

```
HKCU\Software\Classes\SystemFileAssociations\<ext>\shell\SigKPDF.ToPdf
    MUIVerb                    = "PDF に変換（SigK PDF）"
    Icon                       = "<exe>,0"
    MultiSelectModel           = "Player"
    \command\(既定)            = "\"<exe>\" --to-pdf \"%1\""
```

`<ext>` は `.png` `.jpg` `.jpeg` `.bmp` `.gif` `.tif` `.tiff` の7つ。同じ内容を7回書く。この一覧は `launch-args.js` の `EXTENSIONS.toPdf`（起動引数で受ける拡張子）と `image-io.js` の `IMAGE_FILTERS`（変換画面のファイル選択）と同じで、3 か所の一致はテストが見張る。`Player` を付けたので何個選んでも出る（1・5・16・20 個で確かめた）。

表示名に「（SigK PDF）」を付けるのは、画像の右クリックメニューには他アプリの項目が並ぶため、どのアプリの機能かを示す必要があるからである。PDF 側はカスケードの親に「SigK PDF」と出るため、子項目には付けない。

---

## 3. コマンドライン引数と単一インスタンス

### 3-1. 引数の形

| 引数 | 起動元 | 動作 |
|---|---|---|
| `--open <path>` | 右クリック「SigK PDF で開く」（塊②で「プログラムから開く」・既定のアプリも） | タブで開く。束の最初で、ツールモードなら閲覧モードへ移る（ページ・注釈モードはそのまま）。タブが 20 枚あるときは新しいファイルを開かず、帯で知らせる |
| `--merge <path>` | 右クリック「選択した PDF を結合」 | ツールモードで結合を選び、一覧にファイル名の順で入れる |
| `--split <path>` | 右クリック「PDF を分割」 | ツールモードで分割を選び、束の中でファイル名の順の先頭 1 本を対象にする |
| `--to-pdf <path>` | 右クリック「PDF に変換」 | ツールモードで画像→PDF を選び、一覧にファイル名の順で入れる。受けるのは 2-3 の 7 拡張子で、`.pdf` は受けない |
| （引数なし） | スタートメニュー・デスクトップ | 起動画面（最近使ったファイル） |

引数を持たない裸のパスも `--open` として扱う。ドラッグ＆ドロップで exe にファイルを落とした場合に備える。開くのは PDF だけなので、画像を落としても受けない（`docs/spec-5-1-context-menu.md` 確定事項2）。

パスは `"%1"` で受けた文字列のまま使い、アプリの側で正規化しない。空白・`&`・`%`・全角空白・`,;`・絵文字を含む名前も、8.3 形式の短い名前で選んでも、長い名前のまま 1 文字も違わず argv の 1 要素として届いた（事前調査 C）。

### 3-2. 束ねる流れ

```
5 個の PDF を選んで「選択した PDF を結合」
        │
        ├─ プロセス1  --merge "A.pdf"   → 単一インスタンスのロックを取る。以後の受け皿になる
        ├─ プロセス2  --merge "B.pdf"   → ロックを取れず、引数を 1 へ渡して app.exit(0) で終わる
        ├─ プロセス3  --merge "C.pdf"   → 同上
        ├─ プロセス4  --merge "D.pdf"   → 同上
        └─ プロセス5  --merge "E.pdf"   → 同上
        │
        ▼
   プロセス1（main.js の queueLaunch）: 1 件ずつ解釈し、束の印を付けて、待たずに画面へ渡す
        merge  A.pdf  batch { id: 1, first: true }
        merge  C.pdf  batch { id: 1, first: false }   ← 届く順は選んだ順と限らない
        merge  B.pdf  batch { id: 1, first: false }
        …
        │
        ▼
   画面（renderer/launch.js）: 届いた順に 1 件ずつ当てる。
        結合の一覧では、同じ束の行がファイル名の順（A・B・C・D・E）に並ぶ
```

**束の印。**`launch-batch.js` の `createLaunchBatcher` が、メインに届いた時刻で束を決める。直前の要求と意図が同じで、間隔が `BATCH_WINDOW_MS`（W＝2000ms）以下なら同じ束、それ以外は新しい束にする。画面へは `{ intent, paths, batch: { id, first } }` を送る。`id` は 1 から数える整数、`first` は束の最初の要求だけ真。時計は `performance.now()` を使う（`Date.now()` は OS の時刻合わせで戻ることがある）。1 本目のプロセス自身の引数も同じ経路を通り、届いた時刻は `start()` の時点になる。

**W＝2000ms の根拠。**事前調査 A3（Windows 11 実機。平らな `Player` の項目を `IContextMenu` から呼び、N＝3〜20 を未起動・起動済みで各 5 回）では、取りこぼしは 0 件、隣り合う到着の最大間隔は全 50 回で 362ms だった。W はその 3 倍（1,086ms）より長く取った。間隔は直前の要求から測るので、束全体の長さ（20 個で最大 1.8 秒）は W を超えてよい。2 秒を超えて間が空いた同じ操作は別の束になる。

**待たずに渡す。**W は束ねる判定にだけ使い、画面へ渡すのは待たない。静まるのを待ってまとめると、1 ファイルを選んだだけでも W だけ待たせるためである（論点1）。画面の準備が済む前に届いた要求は、今までどおりメインで溜めておく（3-3）。

**2 本目以降のプロセスは `app.exit(0)` で終わる。**`app.quit()` は Chromium の準備を待ってから終わるので、10 個選ぶと 10 本が約 2 秒ずつ残った（事前調査 A4 の中央値 2,067ms）。`app.exit(0)` にすると約 0.6 秒になる。引数の転送は `requestSingleInstanceLock` の中で済んでいるので、先に終わっても取りこぼさない（10 本×3 回とも全件が届いた）。ロックを取る位置を `main.js` の先頭へ出しても約 20ms しか縮まないので、位置は動かしていない。

**パスの順序は保証されない。**事前調査 A3 では 50 回中 8 回で順序が崩れ、末尾へ飛ぶこともあった。エクスプローラーの並び順を再現する手立ては無いので、結合と画像→PDF は束の行をファイル名の順に並べ、そう並べたことを帯で知らせる（3-3）。

> **2026-09-01 訂正（塊⑤ の事前調査で実測した）。当初のコード例（下の経緯）の引数の読み方には誤りがあった。**
>
> **`second-instance` に届く `argv` は並べ替えられる。**Electron は
> `[exe, ...スイッチ..., ...位置引数...]` の順に組み替えたうえ、
> **`--allow-file-access-from-files` を必ず1つ差し込む**（`disableHardwareAcceleration()` を
> 呼んでいれば `--disable-gpu` も入る）。その結果 `--open` と、その直後にあったはずの
> パスが**隣り合わなくなる**。「スイッチの次の要素が値」という素朴な `parseArgs` は、
> パスとして `--allow-file-access-from-files` を掴む。開発時はさらに、位置引数の先頭へ
> アプリのディレクトリが割り込む。
>
> 正しい形は、**スイッチ集合と位置引数集合を分けて処理する**ことである。
> 詳細と決定は `docs/spec-1-6-save.md` 確定事項72〜80 にある。要点は3つ。
>
> - `argv.slice(1)` で固定する（`argv[0]` が実行ファイルなのは全パターンで共通）。
>   `app.isPackaged` による切り替えは `process.argv` には効くが `second-instance` には効かない。
> - 意図はスイッチ側から取り、パスは位置引数側から取る。`--open=<path>` の形なら
>   1トークンのまま届くので壊れない。
> - パスは「絶対パス・拡張子が意図に合う・実在するファイル」の3条件で絞る。
>   開発時に紛れ込むアプリのディレクトリは3つ目で落ちる。
>
> **`app.commandLine` は引数解釈に使えない。**1つ目のプロセス自身の起動引数しか保持せず、
> 2つ目以降の引数は反映されない（実測）。
>
> **`requestSingleInstanceLock(payload)` の `additionalData`（`second-instance` の第4引数）は
> 順序を保ったまま届く。**2つ目のプロセスが自分で解釈した結果を載せる経路として使える。
>
> **2026-09-02 実装済み。**正しい形は `launch-args.js` の `parseLaunchArgs(argv, { isFile })` に
> ある（純関数・`test/launch-args.test.js`）。保持と受け渡しは `main.js` の `queueLaunch` /
> `sendLaunch` と `renderer/launch.js` にある。

**経緯（2026-09-28 に書き直す前の 3-2）。**当初は、引数を受け取るたびにタイマーを引き直し、静まってから「A〜E を結合」という 1 件の要求にまとめて渡す集約を考え、コード例に `PENDING_WINDOW_MS = 400` を置いていた。2026-09-01 に Node から 10 本を同時に起こして測ると、隣の到着の最大間隔は最大 975ms で、400ms では 1 つの操作が複数の要求に割れた（シェルは 1 本ずつ順に起こすので、事前調査 A3 の値はこれより小さい）。2026-09-25 の論点1 で、1 ファイルでも待たせる集約そのものを採らず、届くたびに渡して束の印を付ける方式にした（`docs/07` 決定44）。受け取った順に並べる案も、順序が保証されないため名前の順に改めた（論点2）。

### 3-3. レンダラー側の受け口

```js
// preload.js（抜粋）
contextBridge.exposeInMainWorld('shellAPI', {
  available: true,
  // { intent: 'open'|'merge'|'split'|'toPdf', paths: string[], batch: { id, first } }
  onLaunch: (callback) => {
    ipcRenderer.removeAllListeners('shell:launch');
    ipcRenderer.on('shell:launch', (_event, request) => callback(request));
  },
  ready: () => ipcRenderer.send('shell:ready'),
  // エクスプローラーでそのファイルを選択した状態で開く（spec-2-2 確定事項30）
  showInFolder: (filePath) => ipcRenderer.invoke('shell:showInFolder', filePath),
});
```

当初の例にあった、Windows の「既定のアプリ」設定画面を開く口（`openDefaultAppsSettings`。F-07-5）は、塊②で足さないことにした（2026-10-08）。
入口はアプリのメニュー「ヘルプ」→「既定のアプリの設定…」で、`main.js` が `default-apps-link.js` を通して `shell.openExternal` で開くので、
画面との口は要らない（`spec-5-2` 確定事項C1・C2）。

ウィンドウの生成が終わる前に `shell:launch` を送ると取りこぼす。レンダラー側の初期化完了を `shell:ready` でメインへ知らせ、それまでの要求はメイン側で保持する。

**2026-09-01 追記（実測）。この保持は必須である。ただし理由は「読み込みが終わる前だから」
ではなく「レンダラーがまだ購読していないから」である。**`contextBridge` で公開した
`onLaunch` をレンダラーが呼んだ時点で購読が始まるこのアプリの形では、**`did-finish-load` で
送った分まで消えた**（7通中5通）。`did-finish-load` を合図にしても間に合わない。
また10プロセス同時起動では、最初の `second-instance` が 163〜168ms で届くのに対し
レンダラーの準備は約 690ms かかるため、**多重起動時の要求は必ず準備前に届く**。

**起動直後の順番。**`renderer/app.js` は、前回の見た目の復元（`restoreUi`）が返るのを待ってから `launch.init`（購読と `ready`）を呼ぶ。逆の順だと、溜まっていた要求で切り替えたモードを、後から返る復元が保存されたモードへ戻してしまった（`docs/spec-5-1-context-menu.md` 確定事項14）。

`renderer/launch.js` は、要求を届いた順に 1 件ずつ当てる。前の要求が終わってから次へ進む（一覧の行がファイルを読み終えるのを待つ）。当て先と画面の側の決まりは次のとおりである（確定事項8〜21）。

| 意図 | 当て先 | 決まり |
|---|---|---|
| `open` | タブ | 束の最初で、ツールモードなら閲覧モードへ移る。1 本ずつ順に開く。タブが 20 枚あるときは新しいファイルを開かず、帯「タブが多すぎます。20 個まで開けます。使わないタブを閉じてください。」を束につき 1 回出す（すでに開いているファイルは、そのタブを前へ出す） |
| `merge` | `toolsMerge.addFromLaunch` | 束の最初でツールモードにして結合を選ぶ。束の行は同じ束の行の中でファイル名の順になる位置へ入れる。束の行が 2 つになったら帯「ファイル名の順に並べました。エクスプローラーの並びと違うときは、ドラッグで入れ替えてください。」を束につき 1 回出す。束の最初で一覧が**実行済み**なら空にしてから入れ、それ以外は後ろに足す。100 ファイルを超えた分は入れず、帯を束につき 1 回出す |
| `toPdf` | `toolsConvert.addFromLaunch` | 結合と同じ。上限の帯は「変換できるのは 100 ファイルまでです。」 |
| `split` | `toolsSplit.useFromLaunch` | 束の最初でツールモードにして分割を選ぶ。ファイル名の順の先頭 1 本を対象にし、後から届いたパスが前なら差し替える。束の 2 本目が届いたら帯「1つ目のファイルだけを対象にしました。」を束につき 1 回出す |

- 名前は `renderer/launch-intake.js` の `compareNames` で比べる（`Intl.Collator('ja', { numeric: true, sensitivity: 'base' })`。同じならパス全体。`2.pdf` は `10.pdf` より前）。
- **実行済み**は「最後の実行が成功し、その後に一覧を変えていない」こと。足す・外す・並べ替える・範囲を変える・すべて外すで消え、中止・失敗では付かない。画像→PDF の用紙・出力の設定は一覧ではないので、変えても消えない（確定事項18）。
- 同じ束の 2 件目以降では画面を切り替えない。束が届いている間にユーザーが画面を移っても引き戻さない。
- アプリの中で足した行（ファイルを選ぶ・開いているファイル・ドロップ）は束に入らず、注記も出さない。

**手が空いていなければ当てずに預かる**（論点4）。6 つの道具（結合・分割・画像→PDF・PDF→画像・透かし・フラット化）のどれかの `run()` の途中、保存やツールの処理の途中（`save.isBusy()`）、画面のダイアログ（`<dialog>`）が開いている間は、250ms（`HOLD_POLL_MS`）ごとに見て、空いたら届いた順に当てる。`run()` は保存ダイアログ・同名の 3 択・確認・書いた後の始末の間も実行中と数える（確定事項12）。結合と画像→PDF は保存ダイアログから戻ってから一覧を読むので、その間に束が入ると出力に混ざるためである。

---

## 4. インストーラー（NSIS）

electron-builder が `build/installer.nsh` を取り込む（`package.json` の `nsis.include`。書かなくても取り込まれるが、在りかを設定に残した）。`customInstall` / `customUnInstall` マクロが、それぞれインストール時・アンインストール時に呼ばれる。**書き方の正は `build/installer.nsh` である。**ここには書くキーと値と、書き方の決まりだけを置く。

### 4-1. 書くキーと値

| キー（`HKCU\Software\Classes\` の下） | 値（名前＝データ） |
|---|---|
| `SystemFileAssociations\.pdf\shell\SigKPDF` | `MUIVerb`＝`SigK PDF`・`Icon`＝`<exe>,0`・`MultiSelectModel`＝`Player`・`ExtendedSubCommandsKey`＝`SigKPDF.Menu` |
| `SigKPDF.Menu\shell\01open` | `MUIVerb`＝`SigK PDF で開く`・`Icon`＝`<exe>,0` |
| `SigKPDF.Menu\shell\01open\command` | （既定）＝`"<exe>" --open "%1"` |
| `SigKPDF.Menu\shell\02merge` | `MUIVerb`＝`選択した PDF を結合` |
| `SigKPDF.Menu\shell\02merge\command` | （既定）＝`"<exe>" --merge "%1"` |
| `SigKPDF.Menu\shell\03split` | `MUIVerb`＝`PDF を分割` |
| `SigKPDF.Menu\shell\03split\command` | （既定）＝`"<exe>" --split "%1"` |
| `SystemFileAssociations\<ext>\shell\SigKPDF.ToPdf` | `MUIVerb`＝`PDF に変換（SigK PDF）`・`Icon`＝`<exe>,0`・`MultiSelectModel`＝`Player` |
| `SystemFileAssociations\<ext>\shell\SigKPDF.ToPdf\command` | （既定）＝`"<exe>" --to-pdf "%1"` |
| `SigKPDF.Document` | （既定）＝`PDF 文書` |
| `SigKPDF.Document\DefaultIcon` | （既定）＝`<doc>` |
| `SigKPDF.Document\shell\open\command` | （既定）＝`"<exe>" --open "%1"` |
| `.pdf\OpenWithProgids` | `SigKPDF.Document`＝（空の **REG_NONE**） |
| `Applications\SigK PDF.exe` | `FriendlyAppName`＝`SigK PDF` |
| `Applications\SigK PDF.exe\DefaultIcon` | （既定）＝`<doc>` |
| `Applications\SigK PDF.exe\shell\open\command` | （既定）＝`"<exe>" --open "%1"` |
| `Applications\SigK PDF.exe\SupportedTypes` | `.pdf`＝（空の文字列） |
| （`HKCU\Software\` の下）`SigKPDF\Capabilities` | `ApplicationName`＝`SigK PDF`・`ApplicationDescription`＝`PDF の閲覧・ページの編集・書き込み・結合・分割・変換`・`ApplicationIcon`＝`<exe>,0` |
| （`HKCU\Software\` の下）`SigKPDF\Capabilities\FileAssociations` | `.pdf`＝`SigKPDF.Document` |
| （`HKCU\Software\` の下）`RegisteredApplications` | `SigK PDF`＝`Software\SigKPDF\Capabilities` |

右クリックメニューの値はすべて REG_SZ で、PDF が 11 個、画像が 4 個×7 拡張子＝28 個、合わせて 39 個になる。塊②の関連付けの値は 13 個
（`OpenWithProgids` の 1 個だけ REG_NONE）で、全部で 52 個。`<exe>`・`<ext>`・`<doc>` は第2章のとおり。`.pdf` の既定値には書かない。

### 4-2. 書き方の決まり

- **メニューは書く前に消す。**`customInstall` は、書く前に右クリックメニューのキーを全部消す（`sigkRemoveMenus`）。上書きインストールでは古いアンインストーラーが `customUnInstall` で先に消しているが、古い版の残りがあっても二重にならないようにするためである。
- **関連付けは書く前に消さず、上書きインストールでは消さない（塊②）。**ProgID・`Applications`・`Capabilities` などは上書きだけで書き（`sigkWriteAssoc`）、`customUnInstall` では、引数に `/KEEP_APP_DATA` も `--updated` も無いときだけ消す（`sigkRemoveAssoc`）。上書きインストールでは、新しいインストーラーが古いアンインストーラーを `/S /KEEP_APP_DATA` に `--updated`（インストーラーを `--delete-app-data` 付きで起こしたときは `--delete-app-data`）を付けて走らせる（electron-builder の `installUtil.nsh`）ので、そのときは残す。「アプリと機能」から外すときは、どちらも付かない。ProgID が途中で消える時間を作らず、SigK PDF を既定に選んでいた人の選択を守るためである（`spec-5-2` 確定事項A6。事前調査 E と完了判定3 で、目印を付けた関連付けのキーが、普通の上書きでも `--delete-app-data` の上書きでも残ることを確かめた）。キーの名前を変えたり値を減らしたりする版では、古いほうを `customInstall` で消す。消すときは、自分のキーはキーごと、`.pdf\OpenWithProgids` と `RegisteredApplications` は自分の値だけを消す。
- **空になった親キーは、子も値も無いときだけ消す。**`SystemFileAssociations` の `.pdf`・各拡張子と、それぞれの `shell` は、ほかのアプリも書く場所である。同梱の NSIS 3.0.4.1 には `DeleteRegKey` の `/ifnosubkeys`・`/ifnovalues` が無いので、`EnumRegKey`・`EnumRegValue` で確かめてから消す（`sigkPruneEmptyKey`）。**ただし `Classes\.pdf`・`.pdf\OpenWithProgids`・`Classes\Applications`・`RegisteredApplications` は、空になっても消さない**（塊②。Windows やほかのアプリが前から作っていることが多い。`spec-5-2` 事前調査 E で、前から有った空の `Classes\.pdf` を消してしまうことが分かった。空のキーは関連付けに何も効かない）。自分の `Software\SigKPDF` は空なら消す。`SIGK_SHELL_ID` が空だと `.pdf\shell` ごと消してしまうので、空ならビルドを止める（`!error`）。
- **シェルへ知らせる。**書いた後と消した後に `System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'` を呼ぶ。`0x08000000` は `SHCNE_ASSOCCHANGED`（関連付けが変わった）で、エクスプローラーを再起動しなくてもメニューに出る。後ろ 2 つの引数はポインター（`LPCVOID`）なので `p` 型で渡す。
- **マクロと define だけで書く。**`.nsh` はインストーラーとアンインストーラーの両方のスクリプトの頭（`MUI2.nsh` より前）に取り込まれ、makensis は `-WX`（警告はエラー）で走る。`Var`・`Function` を置くと、使わない側で警告になる（事前調査 B）。
- **自分だけに固定する。**`customInstallMode` で `$isForceCurrentInstall` を 1 にし、インストールの種類を選ぶページを出さない（論点6）。インストール先は選べる。テンプレートは小文字の `customInstallmode` で確かめるが、NSIS のマクロ名は大文字と小文字を区別しないので差し込まれる（事前調査 B5）。
- **完了ページで知らせる。**`MUI_FINISHPAGE_TEXT` を先に define して文言だけ替える（論点7）。`customFinishPage` はページごと差し替えて「完了後に起動」まで消すので使わない。文言は「`<製品名>` のインストールが完了しました。／PDF と画像の右クリックメニューから使えます。Windows 11 では「その他のオプションを確認」の中にあります。／PDF をダブルクリックで開くアプリにするには、メニュー「ヘルプ」→「既定のアプリの設定…」から選んでください。」（／は空行。塊②で「表示」を「確認」に直し〔決定45 ⑤〕、既定のアプリの入口を足した〔決定72 ③〕。塊③で、行末に「「」がぶら下がらないよう「…使えます。」と「…アプリにするには、」のあとで改行した〔決定75 ④〕）。「完了後に起動」のチェックボックスがあると文の欄は 5 行分しかなく、塊①の文（6 行）は最後の「ウィザードを閉じるには [完了] を押してください。」が切れていた見込みなので、`MUI_FINISHPAGE_TEXT_LARGE` で欄を 7.5 行分に広げ、その 1 文を除いて 7 行にした（`spec-5-2` 事前調査 I。字体から換算して測った。実物の画面は塊③）。インストーラーは Windows の言語で出るが、完了ページの文言だけは日本語のまま出る。
- **アンインストールでは設定を残す。**消すのはメニューのキー、関連付けのキーと値（上書きインストールのときは残す）、インストール先だけで、設定（`%APPDATA%\SigK PDF` の最近使ったファイル・窓の位置・ログ）は残し、確認も出さない（論点8）。`--delete-app-data` を渡したときだけ設定も消える（electron-builder の既定のまま）。**ユーザーが編集した PDF は消さない。**
- **自動更新の足場を外す。**`package.json` に `publish: null`・`nsis.packElevateHelper: false` を書き、配布物から `app-update.yml`・`elevate.exe` を外した（`docs/07` 決定9。事前調査 B2）。

`test/installer-nsh.test.js`（13 本。右クリックメニューと書き方の決まり）と `test/installer-assoc.test.js`（5 本。関連付けと完了ページ）が、`.nsh` の中身を静的に見張る（`.nsh` を読む部品は `test/installer-nsh-parse.js`）。書いたキーと値をすべて消すこと、書く命令は `WriteRegStr`・`WriteRegNone` だけであること、HKCU だけに書くこと、拡張子の一覧が `launch-args.js`・`image-io.js` と一致すること、スイッチと項目の対応、引用符付きの `"%1"`、キー名を `SIGK_SHELL_ID` から組むこと、`Var`・`Function` が無いこと、`SHChangeNotify` を両方で呼ぶこと、`.pdf` の既定値に書かず `.pdf` に書くのは `OpenWithProgids` の自分の値だけであること、関連付けを消す行が上書きでは走らない枠の中だけにあること（消している先で見分ける）、消す値は自分が書いた組だけであること、共有のキーを空でも消さないこと、関連付けの値の表、完了ページの文と欄、などである。わざと 5 通り壊して落ちることを確かめた。

別名のインストーラー（`SIGK_SHELL_ID` を `SigKProbe`、製品名を「SigK PDF Probe」にして同じファイルを読んだもの）で実測した（2026-09-25）。ビルドは `-WX` のまま 67 秒で通り、無人インストールは 13 秒で値 39 個が文字単位で一致した。目印の値と古い子キー `99stale` を足してから入れ直すと、どちらも消えて 1 回目の直後と完全に一致した（上書きは 17 秒）。アンインストールは 6 秒で、`SystemFileAssociations`・Uninstall・HKCU 直下のキー名の 3 つがインストール前の控えと完全に一致し、空になった親キーも消えた。2026-09-28 に `--delete-app-data` 付きで外したとき（8 秒）も、控えと一致した。

塊②の登録を足したあとも、同じ別名で実測した（2026-10-08。数と秒は `spec-5-2` の実装の記録の「実測」）。値 52 個が一致し、DefaultIcon が指す `resources\pdf-file.ico` が実在し、`.pdf` の既定値は書かれなかった。`SHAssocEnumHandlers('.pdf')` に「SigK PDF Probe」がおすすめとして出た。目印を付けて入れ直すと、メニューのキーの目印は消え、関連付けのキーの目印は残った（普通の上書きでも、インストーラーを `--delete-app-data` 付きで起こした上書きでも）。アンインストールのあと、入れる前の控え 5 つ（`SystemFileAssociations`・Uninstall・`Classes\.pdf`・`RegisteredApplications` の書き出しと、`Software`・`Classes`・`Applications` の直下のキー名）と完全に一致した。

**経緯（2026-09-28 に書き直す前の第4章）。**当初は `.nsh` の全文を例として載せていた。その例は ProgID・`OpenWithProgids`・`Applications` の登録（塊②）まで含み、`MultiSelectModel` は子の `02merge` にだけ付け、`SHChangeNotify` の後ろ 2 つの引数を `i` 型で渡し、アンインストーラーの確認画面で設定を消すかを選ばせる形だった。事前調査と論点5〜8 で改めた。写しは実物とずれていくので、載せるのをやめた。

---

## 5. 実機での確認手順

自動テストの対象外であるため（`docs/02_アーキテクチャ設計.md` 第8章）、手順書で確認する。Windows 10 と Windows 11 の両方で、塊③で通す。

**2026-10-08（塊③）: Windows 11（25H2）で通した。**本物のインストーラーで常用の SigK PDF を上書きし、#1・#6・#8 の出方は `IContextMenu` の列挙で、
#2〜#5・#7・#8 の呼び出しは別名のインストーラー「SigK PDF Probe」で、#10・#11 は本物のアンインストールと入れ直しで確かめた（#9 の本物の窓と
既定の切り替えを除いて、11 項目とも期待どおり。#1 のうち、既定の Windows 11 の最初のメニューの実物は、このPCの設定のため見ていない）。Windows 10 はパソコンが無いので通していない（`docs/07` 決定73 ①）。結果は
`docs/spec-5-3-device-check.md` の「`docs/03` 第5章の 11 項目」の表、#9 の残りの手順は同じ仕様書の「あなたの画面で見る項目」⑤⑥。

塊①では、このPC（Windows 11・従来型のメニュー）で別名のインストーラーを使って一部を先に確かめた。#4・#5・#7 に当たる呼び出し（結合 3 個・20 個、画像→PDF 5 個）は `CtxProbe`（エクスプローラーと同じ `IContextMenu` の経路）で、#6・#8 に当たる出方は列挙とユーザーの目視で見た（`docs/spec-5-1-context-menu.md` の完了判定9〜11）。

| # | 確認内容 | 期待する結果 |
|---|---|---|
| 1 | インストール直後に PDF を右クリック | 「SigK PDF」の入口が出る。Windows 11 では「その他のオプションを確認」の下 |
| 2 | 「SigK PDF で開く」 | アプリが起動し、そのファイルが閲覧画面に出る |
| 3 | 既にアプリを開いた状態で 2 を実行 | 新しいウィンドウは増えず、既存ウィンドウの新しいタブで開く |
| 4 | PDF を3個選んで「選択した PDF を結合」 | ウィンドウが1つだけ開き、結合画面に3件すべてがファイル名の順に並ぶ |
| 5 | PDF を10個選んで同上 | 10件すべてが並ぶ。プロセスが複数残っていないことをタスクマネージャーで確認 |
| 6 | PDF を16個選んで右クリック | 「SigK PDF」の入口と子 3 つが出る（親に `Player` を付けた。1-2）。「開く」「印刷」などは消える |
| 7 | 画像を5個選んで「PDF に変換」 | 変換画面に5件が並ぶ |
| 8 | PDF と画像を混ぜて選択して右クリック | 右クリックしたファイルの種類の項目だけが出る（PDF なら入口、画像なら「PDF に変換」）。呼ぶと、種類の合わないファイルは起動引数の拡張子の絞りで落ちる |
| 9 | 「プログラムから開く」と既定のアプリ | 一覧に SigK PDF が出る。メニュー「ヘルプ」→「既定のアプリの設定…」で設定の SigK PDF のページが開き、「.pdf」を SigK PDF に切り替えると、PDF のダブルクリックで開き、エクスプローラーの PDF に紙の形の絵が出る（塊②。このPCでは、別名で候補と設定のページまでを先に確かめた。`spec-5-2` 完了判定2・10） |
| 10 | アンインストール | 右クリックメニューから項目が消える。`regedit` で、4-1 のキーのうち SigK PDF だけのもの（`SigKPDF.Menu`・`SigKPDF.Document`・`Applications\SigK PDF.exe`・`Software\SigKPDF`・`SystemFileAssociations` の下の `SigKPDF`・`SigKPDF.ToPdf`）が残っていないこと。`.pdf\OpenWithProgids` と `RegisteredApplications` は SigK PDF の値だけが消え、キーは残ること（塊②。`spec-5-2` 確定事項A5）。`SystemFileAssociations` の空になった親キーは残らない |
| 11 | インストール → アンインストール → 再インストール | 項目が二重に出ない |

~~確認結果は `docs/spec-5-shell-integration-result.md` に記録する。~~ **2026-10-08 訂正**: 結果は `docs/spec-5-3-device-check.md` に記録した
（記録が仕様書と別のファイルに分かれると、行き先の追記が二重になるため。`spec-5-3` 起草者の判断）。

---

## 6. 第2版以降の検討事項

| # | 事項 | 補足 |
|---|---|---|
| 1 | Windows 11 の新しいコンテキストメニューへの対応 | スパースパッケージ＋`IExplorerCommand` の COM サーバーが要る。実装量が大きく、パッケージ署名も伴うため、第1版の完成後に費用対効果を判断する |
| 2 | COM ハンドラによる複数ファイルの一括受け取り | 3-2 の束の印で足りなくなった場合の代替（2 秒を超えて間が空くと別の束になる）。`DropTarget` を実装すればパスの順序も選択順で確定する |
| 3 | フォルダの右クリックからの一括処理 | 「このフォルダの PDF をすべて結合」など。`Directory\shell` に登録する |
| 4 | ジャンプリスト | タスクバーのアイコン右クリックに最近使ったファイルを出す。`spec-1-2` 確定事項7 は「Phase 5 で入れる」としていたが、2026-09-28 にこの表の第2版へ揃えた |

---

## 7. この文書の確度について

| 記述 | 確度 |
|---|---|
| Windows 11 の新メニューには MSIX/スパースパッケージと `IExplorerCommand` が要ること | Microsoft の公開仕様に基づく |
| `ExtendedSubCommandsKey` によるカスケードメニューの構成 | 実測した（事前調査 A2・S8。日本語の `MUIVerb` もそのまま出る） |
| 項目に `MultiSelectModel` が無いと 16 個以上で出ないこと（`MultipleInvokePromptMinimum` の既定値 15） | 実測した（事前調査 A1。このPCは値が未設定＝既定） |
| `MultiSelectModel = "Player"` でも呼び出しは 1 ファイル 1 プロセスであること | 実測した（事前調査 A1・A2） |
| 子の `MultiSelectModel` が効かず、親の `Player` で 16 個以上でも出ること | 実測した（事前調査 A2・S8。2026-09-28 に列挙とユーザーの目視でも確かめた） |
| 束ねる窓 W＝2000ms | 隣の到着の最大間隔 362ms（事前調査 A3）から決めた。測ったのは 20 個まで |
| 引数として渡されるパスの順序がエクスプローラーの並び順と一致しないこと | 実測した（50 回中 8 回で崩れた。事前調査 A3） |
| `"%1"` で扱いにくい名前も 1 文字も違わず届くこと | 実測した（事前調査 C） |
| 日本語版 Windows 11 の項目名が「その他のオプションを確認」であること | 公開の解説記事で確かめた（2026-09-28）。**2026-10-08（塊③）**: Windows のファイル（`Windows.UI.FileExplorer.dll.mui`）から「その他のオプションを確認(&W)」を読み出した（`spec-5-3` 事前調査 M）。メニューの実物はこのPCの設定（従来型に戻す）のため見ていない |
| Windows 10 と既定の Windows 11 での見え方 | **未確認。**塊③の実機確認で見る。**2026-10-08（塊③）**: 項目の並びは `IContextMenu` の列挙で確かめた。既定の Windows 11 の最初のメニューの実物と Windows 10 は、まだ未確認（`spec-5-3` No.25） |
| `OpenWithProgids`・`Applications` の登録で「プログラムから開く」の候補（おすすめ）に出ること | API（`SHAssocEnumHandlers`）で並べると、候補の「おすすめ」に入った（`spec-5-2` 事前調査 E）。エクスプローラーの本物の窓は塊③で見る。**2026-10-08（塊③）**: 本物の入れ物でも、おすすめに入った（Adobe Acrobat・Microsoft Edge・Google Chrome・PDF24 と並ぶ）。本物の窓は「あなたの画面で見る項目」⑤で未確認 |
| 上書きインストールで関連付けが消えず、アンインストールで控えに戻ること | 実測した（`spec-5-2` 事前調査 E・完了判定3。インストーラーを `--delete-app-data` 付きで起こした上書きも） |
| 「.pdf」を SigK PDF に切り替えたあとのダブルクリックと、PDF ファイルの絵 | **未確認。**このPCの既定のアプリは今のまま（ユーザーの指示）にしてあり、切り替えていない。塊③の第5章 #9 で見る。**2026-10-08（塊③）**: 塊③でも切り替えていない（決定73 ③）。絵そのものは本物の入れ物から取り出して確かめた。切り替えの手順は `spec-5-3` の「あなたの画面で見る項目」⑥ |
| 登録の無い名前で `ms-settings:defaultapps?registeredAppUser=` を開いたときの飛び先 | **未確認**（既定のアプリの画面の頭が開く見込み）。塊③でも見ていない（`spec-5-3` No.28） |
| `ms-settings:defaultapps?registeredAppUser=<名前>` で、設定の既定のアプリの、そのアプリのページへ飛ぶこと | Windows 11 ビルド 26200 で実測した（`spec-5-2` 完了判定10）。Windows 10 と古い Windows 11 は塊③。**2026-10-08（塊③）**: Windows 10 と古い Windows 11 のパソコンが無いので未確認（`spec-5-3` No.28） |
| 完了ページの文の欄の行数（5 行・広げて 7.5 行） | 字体（ＭＳ Ｐゴシック 9pt）から換算して測った（`spec-5-2` 事前調査 I）。実物の画面は塊③。**2026-10-08（塊③）**: 実物の画面で、7 行が欄（341×90px）に収まることを確かめた（`spec-5-3` No.24） |
