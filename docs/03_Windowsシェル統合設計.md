# SigK PDF Windows シェル統合設計

作成日: 2026-08-29
関連: `docs/01_製品要件定義.md` F-07 / `docs/02_アーキテクチャ設計.md` 第2章・第7章

エクスプローラーの右クリックメニューからアプリの各機能へ直行させるための設計である。要件 F-07-1〜F-07-5 を実現する経路と、Windows 側の制約を先に整理する。

---

## 1. 先に押さえるべき制約

### 1-1. Windows 11 では既定のメニューに出ない

Windows 11 はコンテキストメニューを刷新した。**レジストリに登録した従来型の項目（verb）は、Windows 11 では最初に出るメニューには現れず、「その他のオプションを表示」（Shift+F10 でも開く従来型メニュー）の下に入る。**

Windows 11 の最初のメニューに項目を出すには、アプリを MSIX またはスパースパッケージとして登録し、`IExplorerCommand` を実装した COM サーバーを持たせる必要がある。これは C++ による COM DLL の実装とパッケージ署名を伴い、Electron アプリの通常の配布形態（NSIS インストーラー）から大きく外れる。

したがって第1版は次のとおりとする。

- **第1版はレジストリ方式のみを実装する。** Windows 10 では従来どおりの右クリックメニューに出る。Windows 11 では「その他のオプションを表示」の下に出る。
- この挙動をインストーラーの説明画面と `docs/インストールと使い方ガイド.md` に明記する。ユーザーが「メニューに出ない」と誤解するのを防ぐ。
- Windows 11 の最初のメニューへの対応は第2版以降の検討事項とする（第6章）。

### 1-2. 複数ファイル選択時は1ファイルにつき1回起動される

レジストリの `command` 方式では、シェルは選択されたファイル1つごとにコマンドを起動する。`%1` に入るのはそのファイル1つだけである。したがって「選択した複数の PDF を結合」を素直に書くと、**5個選べばアプリが5回起動する。**

回避策は2つある。

| 方式 | 内容 | 判断 |
|---|---|---|
| COM ハンドラ（`DropTarget` / `IExecuteCommand`） | 1回の呼び出しですべてのパスを受け取れる。Windows が公式に用意した経路 | ネイティブ COM サーバーの実装が要る。第1版では採らない |
| 単一インスタンス＋引数の集約 | アプリ側で2回目以降の起動を1つ目に転送し、短時間の起動をまとめて1件の要求として扱う | **第1版はこれを採る。** 追加の実装は Electron 側だけで完結する |

あわせて、Windows は選択数が一定を超えると項目自体を出さなくなる。しきい値は `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\MultipleInvokePromptMinimum` で、既定値は 15 である。**16個以上を選んだときは右クリックメニューに項目が出ない**ため、その場合はアプリを開いてから結合画面へファイルを追加する動線を案内する。

### 1-3. 既定のアプリはプログラムから設定できない

Windows 10 以降、拡張子の既定の関連付けをアプリ側から書き換えることはできない。インストーラーでレジストリを書いても、既定のアプリにはならない。

F-07-5 は次の形で満たす。

- `HKCU\Software\Classes\Applications\SigK PDF.exe` を登録し、「プログラムから開く」の一覧に SigK PDF を出す。
- `.pdf` の `OpenWithProgids` に自前の ProgID を足し、選択肢として提示されるようにする。
- アプリ内の設定画面から `ms-settings:defaultapps` を開き、ユーザー自身に選んでもらう。

---

## 2. レジストリの設計

すべて `HKCU`（現在のユーザー）配下に書く。管理者権限を必要としないためで、`nsis.perMachine: false` と整合する。

### 2-1. ProgID と「プログラムから開く」

```
HKCU\Software\Classes\SigKPDF.Document
    (既定)                     = "PDF 文書"
    \DefaultIcon\(既定)        = "$INSTDIR\SigK PDF.exe,0"
    \shell\open\command\(既定) = "\"$INSTDIR\SigK PDF.exe\" --open \"%1\""

HKCU\Software\Classes\.pdf\OpenWithProgids
    SigKPDF.Document           = (空の REG_NONE)

HKCU\Software\Classes\Applications\SigK PDF.exe
    FriendlyAppName            = "SigK PDF"
    \shell\open\command\(既定) = "\"$INSTDIR\SigK PDF.exe\" --open \"%1\""
    \SupportedTypes
        .pdf                   = ""
```

`.pdf` キーの既定値は**書き換えない**。他のアプリが握っている既定の関連付けを、インストーラーが黙って奪わないためである。

### 2-2. PDF に対するカスケードメニュー

「SigK PDF」という1つの入口の下に、開く・結合・分割の3項目を畳む。項目本体は別のキーに置き、`ExtendedSubCommandsKey` で参照する。

```
HKCU\Software\Classes\SystemFileAssociations\.pdf\shell\SigKPDF
    MUIVerb                    = "SigK PDF"
    Icon                       = "$INSTDIR\SigK PDF.exe,0"
    ExtendedSubCommandsKey     = "SigKPDF.Menu"

HKCU\Software\Classes\SigKPDF.Menu\shell
    \01open
        MUIVerb                = "SigK PDF で開く"
        Icon                   = "$INSTDIR\SigK PDF.exe,0"
        \command\(既定)        = "\"$INSTDIR\SigK PDF.exe\" --open \"%1\""
    \02merge
        MUIVerb                = "選択した PDF を結合"
        MultiSelectModel       = "Player"
        \command\(既定)        = "\"$INSTDIR\SigK PDF.exe\" --merge \"%1\""
    \03split
        MUIVerb                = "PDF を分割"
        \command\(既定)        = "\"$INSTDIR\SigK PDF.exe\" --split \"%1\""
```

サブキー名を `01open` `02merge` `03split` としているのは、シェルがサブキーを名前順に並べるためである。表示名は `MUIVerb` で与える。

`02merge` の `MultiSelectModel = "Player"` は、複数選択時にシェルへ「まとめて扱う種類の動詞である」と伝える指定である。ただし 1-2 のとおり `command` 方式では実際の呼び出しは1ファイルずつになるため、**この指定だけでは集約されない。**集約はアプリ側で行う（第3章）。

`SystemFileAssociations` の下に置く理由は、`.pdf` の既定のアプリが何であっても項目が出るためである。ProgID（`SigKPDF.Document`）の下に置くと、既定のアプリが SigK PDF になっているときしか出ない。

### 2-3. 画像に対する項目

画像は入口を畳まず、1項目だけ出す。

```
HKCU\Software\Classes\SystemFileAssociations\<ext>\shell\SigKPDF.ToPdf
    MUIVerb                    = "PDF に変換（SigK PDF）"
    Icon                       = "$INSTDIR\SigK PDF.exe,0"
    MultiSelectModel           = "Player"
    \command\(既定)            = "\"$INSTDIR\SigK PDF.exe\" --to-pdf \"%1\""
```

`<ext>` は `.jpg` `.jpeg` `.png` `.bmp` `.gif` `.tif` `.tiff` の7つ。同じ内容を7回書く。

表示名に「（SigK PDF）」を付けるのは、画像の右クリックメニューには他アプリの項目が並ぶため、どのアプリの機能かを示す必要があるからである。PDF 側はカスケードの親に「SigK PDF」と出るため、子項目には付けない。

---

## 3. コマンドライン引数と単一インスタンス

### 3-1. 引数の形

| 引数 | 起動元 | 動作 |
|---|---|---|
| `--open <path>` | 右クリック「SigK PDF で開く」、「プログラムから開く」、既定のアプリ | 閲覧画面で開く |
| `--merge <path>` | 右クリック「選択した PDF を結合」 | 結合画面を開き、渡されたファイルを一覧に入れる |
| `--split <path>` | 右クリック「PDF を分割」 | 分割画面を開く |
| `--to-pdf <path>` | 右クリック「PDF に変換」 | 画像→PDF 変換画面を開き、渡された画像を一覧に入れる |
| （引数なし） | スタートメニュー・デスクトップ | 起動画面（最近使ったファイル） |

引数を持たない裸のパスも `--open` として扱う。ドラッグ＆ドロップで exe にファイルを落とした場合に備える。

### 3-2. 集約の流れ

```
5個の PDF を選んで「選択した PDF を結合」
        │
        ├─ プロセス1  --merge "A.pdf"   → 単一インスタンスのロックを取得。以後の受け皿になる
        ├─ プロセス2  --merge "B.pdf"   → ロックを取れず、引数をプロセス1へ転送して即終了
        ├─ プロセス3  --merge "C.pdf"   → 同上
        ├─ プロセス4  --merge "D.pdf"   → 同上
        └─ プロセス5  --merge "E.pdf"   → 同上
        │
        ▼
   プロセス1: 受け取るたびにタイマーを引き直し、
             静まってから「A〜E を結合」という1件の要求としてレンダラーへ渡す
```

```js
// main.js — 起動要求の集約
'use strict';

const PENDING_WINDOW_MS = 400; // 最後の引数受信からこの時間が空いたら確定させる

let pending = null;   // { intent: 'merge'|'toPdf'|'open'|'split', paths: string[] }
let pendingTimer = null;

function queueLaunchRequest(argv) {
  const req = parseArgs(argv); // → { intent, path } / null
  if (!req) return;

  // 種類が変わったら、溜まっている分を先に確定させる（別操作が混ざらないように）
  if (pending && pending.intent !== req.intent) flushLaunchRequest();

  if (!pending) pending = { intent: req.intent, paths: [] };
  if (req.path && !pending.paths.includes(req.path)) pending.paths.push(req.path);

  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushLaunchRequest, PENDING_WINDOW_MS);
}

function flushLaunchRequest() {
  clearTimeout(pendingTimer);
  pendingTimer = null;
  if (!pending) return;
  const req = pending;
  pending = null;
  // 単一選択の結合・変換は、ファイルを足せる状態で画面だけ開く
  sendToRenderer('shell:launch', req);
}

// 2つ目以降のプロセスは起動せず、引数だけを最初のプロセスへ渡して終了する
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    queueLaunchRequest(argv);
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();
    queueLaunchRequest(process.argv); // 1つ目のプロセス自身の引数も同じ経路に載せる
  });
}
```

> **2026-09-01 訂正（塊⑤ の事前調査で実測した）。上のコード例には誤りがある。**
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


`PENDING_WINDOW_MS = 400` という値は**実測に基づかない初期値である**。シェルが5個のプロセスを起動し終えるまでの間隔を実機で計測し、Phase 5 で確定させる。短すぎると分裂し（結合画面が2枚開く）、長すぎると単一ファイルの起動が待たされて遅く感じる。

**2026-09-01 追記（塊⑤ の事前調査）。実測すると 400ms では足りない。**10プロセスを同時に
起動したときの「隣り合う到着の最大間隔」は 194／257／159／432／543／716／**975** ms で、
7回中4回が 400ms を超えた（N=5 では 23／35ms、起動済みなら最大 133ms）。**取りこぼしは0件**
だったので、失われるのではなく**1つの操作が複数の要求に割れる**。Phase 5 でこの値を確定させる
ときは、400 から出発しないこと。なおパスの順序が保証されないことも実測で裏づけた
（N=10 の7回のうち1回で7番目と8番目が入れ替わった）。

`paths` の順序は、シェルがプロセスを起動する順に依存する。**エクスプローラー上の並び順どおりになる保証はない。**結合画面では受け取った順に一覧へ並べたうえで、ユーザーが並べ替えられるようにする（F-03-1）。この点は画面上に注記を出す。

### 3-3. レンダラー側の受け口

```js
contextBridge.exposeInMainWorld('shellAPI', {
  available: true,
  // 起動要求 { intent: 'open'|'merge'|'split'|'toPdf', paths: string[] }
  onLaunch: (cb) => {
    ipcRenderer.removeAllListeners('shell:launch');
    ipcRenderer.on('shell:launch', (_e, req) => cb(req));
  },
  // Windows の「既定のアプリ」設定画面を開く（F-07-5）
  openDefaultAppsSettings: () => ipcRenderer.invoke('shell:openDefaultApps'),
});
```

ウィンドウの生成が終わる前に `shell:launch` を送ると取りこぼす。レンダラー側の初期化完了を `shell:ready` でメインへ知らせ、それまでの要求はメイン側で保持する。

**2026-09-01 追記（実測）。この保持は必須である。ただし理由は「読み込みが終わる前だから」
ではなく「レンダラーがまだ購読していないから」である。**`contextBridge` で公開した
`onLaunch` をレンダラーが呼んだ時点で購読が始まる本アプリの形では、**`did-finish-load` で
送った分まで消えた**（7通中5通）。`did-finish-load` を合図にしても間に合わない。
また10プロセス同時起動では、最初の `second-instance` が 163〜168ms で届くのに対し
レンダラーの準備は約 690ms かかるため、**多重起動時の要求は必ず準備前に届く**。

---

## 4. インストーラー（NSIS）

electron-builder の `nsis.include` で `build/installer.nsh` を差し込む。`customInstall` / `customUnInstall` マクロが、それぞれインストール時・アンインストール時に呼ばれる。

```nsis
; build/installer.nsh — 右クリックメニューの登録と削除

!macro RegisterImageVerb EXT
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\SigKPDF.ToPdf" \
    "MUIVerb" "PDF に変換（SigK PDF）"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\SigKPDF.ToPdf" \
    "Icon" "$INSTDIR\SigK PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\SigKPDF.ToPdf" \
    "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\SigKPDF.ToPdf\command" \
    "" '"$INSTDIR\SigK PDF.exe" --to-pdf "%1"'
!macroend

!macro customInstall
  ; ── ProgID と「プログラムから開く」──────────────────────────
  WriteRegStr HKCU "Software\Classes\SigKPDF.Document" "" "PDF 文書"
  WriteRegStr HKCU "Software\Classes\SigKPDF.Document\DefaultIcon" "" "$INSTDIR\SigK PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SigKPDF.Document\shell\open\command" "" \
    '"$INSTDIR\SigK PDF.exe" --open "%1"'
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "SigKPDF.Document" ""
  WriteRegStr HKCU "Software\Classes\Applications\SigK PDF.exe" "FriendlyAppName" "SigK PDF"
  WriteRegStr HKCU "Software\Classes\Applications\SigK PDF.exe\shell\open\command" "" \
    '"$INSTDIR\SigK PDF.exe" --open "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\SigK PDF.exe\SupportedTypes" ".pdf" ""

  ; ── PDF のカスケードメニュー ─────────────────────────────
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SigKPDF" \
    "MUIVerb" "SigK PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SigKPDF" \
    "Icon" "$INSTDIR\SigK PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SigKPDF" \
    "ExtendedSubCommandsKey" "SigKPDF.Menu"

  WriteRegStr HKCU "Software\Classes\SigKPDF.Menu\shell\01open" "MUIVerb" "SigK PDF で開く"
  WriteRegStr HKCU "Software\Classes\SigKPDF.Menu\shell\01open" "Icon" "$INSTDIR\SigK PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SigKPDF.Menu\shell\01open\command" "" \
    '"$INSTDIR\SigK PDF.exe" --open "%1"'

  WriteRegStr HKCU "Software\Classes\SigKPDF.Menu\shell\02merge" "MUIVerb" "選択した PDF を結合"
  WriteRegStr HKCU "Software\Classes\SigKPDF.Menu\shell\02merge" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SigKPDF.Menu\shell\02merge\command" "" \
    '"$INSTDIR\SigK PDF.exe" --merge "%1"'

  WriteRegStr HKCU "Software\Classes\SigKPDF.Menu\shell\03split" "MUIVerb" "PDF を分割"
  WriteRegStr HKCU "Software\Classes\SigKPDF.Menu\shell\03split\command" "" \
    '"$INSTDIR\SigK PDF.exe" --split "%1"'

  ; ── 画像 → PDF ────────────────────────────────────────────
  !insertmacro RegisterImageVerb ".jpg"
  !insertmacro RegisterImageVerb ".jpeg"
  !insertmacro RegisterImageVerb ".png"
  !insertmacro RegisterImageVerb ".bmp"
  !insertmacro RegisterImageVerb ".gif"
  !insertmacro RegisterImageVerb ".tif"
  !insertmacro RegisterImageVerb ".tiff"

  ; シェルに関連付けの変更を通知する（再起動なしでメニューへ反映させる）
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro UnregisterImageVerb EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\SigKPDF.ToPdf"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SigKPDF"
  DeleteRegKey HKCU "Software\Classes\SigKPDF.Menu"
  DeleteRegKey HKCU "Software\Classes\SigKPDF.Document"
  DeleteRegKey HKCU "Software\Classes\Applications\SigK PDF.exe"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "SigKPDF.Document"

  !insertmacro UnregisterImageVerb ".jpg"
  !insertmacro UnregisterImageVerb ".jpeg"
  !insertmacro UnregisterImageVerb ".png"
  !insertmacro UnregisterImageVerb ".bmp"
  !insertmacro UnregisterImageVerb ".gif"
  !insertmacro UnregisterImageVerb ".tif"
  !insertmacro UnregisterImageVerb ".tiff"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
```

`SHChangeNotify` に渡している `0x08000000` は `SHCNE_ASSOCCHANGED`（関連付けが変わったことの通知）である。これを呼ばないと、エクスプローラーを再起動するまでメニューに反映されないことがある。

`.pdf\OpenWithProgids` は値の削除にとどめる。キーごと消すと、他のアプリが登録した ProgID まで巻き添えになる。

アンインストール時に**ユーザーが編集した PDF を消してはならない。**削除するのは上記レジストリとインストール先のみとする。設定（`<userData>`）を消すかどうかはアンインストーラーの確認画面でユーザーに選ばせる。

---

## 5. 実機での確認手順

自動テストの対象外であるため（`docs/02_アーキテクチャ設計.md` 第8章）、手順書で確認する。Windows 10 と Windows 11 の両方で通す。

| # | 確認内容 | 期待する結果 |
|---|---|---|
| 1 | インストール直後に PDF を右クリック | 「SigK PDF」の入口が出る。Windows 11 では「その他のオプションを表示」の下 |
| 2 | 「SigK PDF で開く」 | アプリが起動し、そのファイルが閲覧画面に出る |
| 3 | 既にアプリを開いた状態で 2 を実行 | 新しいウィンドウは増えず、既存ウィンドウの新しいタブで開く |
| 4 | PDF を3個選んで「選択した PDF を結合」 | ウィンドウが1つだけ開き、結合画面に3件すべてが並ぶ |
| 5 | PDF を10個選んで同上 | 10件すべてが並ぶ。プロセスが複数残っていないことをタスクマネージャーで確認 |
| 6 | PDF を16個選んで右クリック | 項目が出ない（1-2 のしきい値）。ガイドに記載した挙動と一致すること |
| 7 | 画像を5個選んで「PDF に変換」 | 変換画面に5件が並ぶ |
| 8 | PDF と画像を混ぜて選択して右クリック | PDF 用・画像用いずれの項目も出ない（`SystemFileAssociations` の仕様どおり） |
| 9 | 「プログラムから開く」 | 一覧に SigK PDF が出る |
| 10 | アンインストール | 右クリックメニューから項目が消える。`regedit` で 4章の各キーが残っていないこと |
| 11 | インストール → アンインストール → 再インストール | 項目が二重に出ない |

確認結果は `docs/spec-5-shell-integration-result.md` に記録する。

---

## 6. 第2版以降の検討事項

| # | 事項 | 補足 |
|---|---|---|
| 1 | Windows 11 の新しいコンテキストメニューへの対応 | スパースパッケージ＋`IExplorerCommand` の COM サーバーが要る。実装量が大きく、パッケージ署名も伴うため、第1版の完成後に費用対効果を判断する |
| 2 | COM ハンドラによる複数ファイルの一括受け取り | 3-2 のデバウンス集約が実機で不安定だった場合の代替。`DropTarget` を実装すればパスの順序も選択順で確定する |
| 3 | フォルダの右クリックからの一括処理 | 「このフォルダの PDF をすべて結合」など。`Directory\shell` に登録する |
| 4 | ジャンプリスト | タスクバーのアイコン右クリックに最近使ったファイルを出す |

---

## 7. この文書の確度について

| 記述 | 確度 |
|---|---|
| Windows 11 の新メニューには MSIX/スパースパッケージと `IExplorerCommand` が要ること | Microsoft の公開仕様に基づく |
| `ExtendedSubCommandsKey` によるカスケードメニューの構成 | Microsoft の公開仕様に基づく |
| `MultipleInvokePromptMinimum` の既定値が 15 であること | Windows の既定値として広く知られた値。実機で確認する |
| `MultiSelectModel = "Player"` だけでは `command` 方式の集約が効かないこと | 仕様の読みに基づく判断。**実機で確認する** |
| `PENDING_WINDOW_MS = 400` | **実測に基づかない初期値。**Phase 5 で計測して確定する |
| 引数として渡されるパスの順序がエクスプローラーの並び順と一致しないこと | プロセス起動順に依存するための推定。**実機で確認する** |
