; 右クリックメニュー（塊①）と、「プログラムから開く」・既定のアプリの選択肢（塊②）の登録と削除
; （docs/spec-5-1-context-menu.md 確定事項22〜31・docs/spec-5-2-open-with-icon.md 確定事項A・D・docs/03 第2章・第4章）。
;
; electron-builder はこのファイルを、インストーラーとアンインストーラーの両方のスクリプトの
; 頭（MUI2.nsh より前）で取り込み、makensis を -WX（警告はエラー）で走らせる。
; だからここにはマクロと define だけを置き、Var・Function は置かない。
;
; 書くのは HKCU だけ（管理者の権限が要らない）。.pdf の既定値（今の既定のアプリ）には書かない。
; キー名は SIGK_SHELL_ID から組む。実機での確認に使う別名のインストーラーは、ここを SigKProbe に替えて同じファイルを読む。

!ifndef SIGK_SHELL_ID
  !define SIGK_SHELL_ID "SigKPDF"
!endif

; PDF ファイルの絵（spec-5-2 確定事項B2・B4）。シェルは app.asar の中を読めないので、extraResources で resources へ出したものを指す。
!define SIGK_PDF_FILE_ICON "$INSTDIR\resources\pdf-file.ico"

; Windows 11 では、従来型の項目は「その他のオプションを確認」の中に入る。完了ページで知らせる（spec-5-1 論点7・spec-5-2 確定事項D）。
; 文言だけを替え、「完了後に起動」は残す（customFinishPage はページごと差し替えてしまう）。
; 「完了後に起動」があると文の欄は 5 行分しかないので、7.5 行分に広げる（spec-5-2 事前調査 I。文は 7 行）。
!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_TEXT "${PRODUCT_NAME} のインストールが完了しました。$\r$\n$\r$\nPDF と画像の右クリックメニューから使えます。Windows 11 では「その他のオプションを確認」の中にあります。$\r$\n$\r$\nPDF をダブルクリックで開くアプリにするには、メニュー「ヘルプ」→「既定のアプリの設定…」から選んでください。"
  !define MUI_FINISHPAGE_TEXT_LARGE
!endif

; 画像 1 つの拡張子に「PDF に変換」を書く。何個選んでも出すよう Player を付ける（論点5）。
!macro sigkWriteImageVerb EXT
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\${SIGK_SHELL_ID}.ToPdf" "MUIVerb" "PDF に変換（${PRODUCT_NAME}）"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\${SIGK_SHELL_ID}.ToPdf" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\${SIGK_SHELL_ID}.ToPdf" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\${SIGK_SHELL_ID}.ToPdf\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --to-pdf "%1"'
!macroend

; 子も値も無いキーだけを消す。ほかのアプリが同じ親キーに書いたものは巻き込まない。
; 同梱の NSIS 3.0.4.1 には DeleteRegKey の /ifnosubkeys・/ifnovalues が無いので、自分で確かめる。
; 既定値だけがあるキーは EnumRegValue が "" を返してもエラーにならないので、残る。
!macro sigkPruneEmptyKey KEY
  Push $R0
  Push $R1
  ClearErrors
  EnumRegKey $R0 HKCU "${KEY}" 0
  ${If} $R0 == ""
    ClearErrors
    EnumRegValue $R1 HKCU "${KEY}" 0
    ${If} ${Errors}
      DeleteRegKey HKCU "${KEY}"
    ${EndIf}
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

!macro sigkRemoveImageVerb EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\${SIGK_SHELL_ID}.ToPdf"
  !insertmacro sigkPruneEmptyKey "Software\Classes\SystemFileAssociations\${EXT}\shell"
  !insertmacro sigkPruneEmptyKey "Software\Classes\SystemFileAssociations\${EXT}"
!macroend

; 右クリックメニューのキーを全部消す。インストール（書く前）とアンインストールの両方から呼ぶ。
!macro sigkRemoveMenus
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\${SIGK_SHELL_ID}"
  DeleteRegKey HKCU "Software\Classes\${SIGK_SHELL_ID}.Menu"
  !insertmacro sigkPruneEmptyKey "Software\Classes\SystemFileAssociations\.pdf\shell"
  !insertmacro sigkPruneEmptyKey "Software\Classes\SystemFileAssociations\.pdf"
  !insertmacro sigkRemoveImageVerb ".png"
  !insertmacro sigkRemoveImageVerb ".jpg"
  !insertmacro sigkRemoveImageVerb ".jpeg"
  !insertmacro sigkRemoveImageVerb ".bmp"
  !insertmacro sigkRemoveImageVerb ".gif"
  !insertmacro sigkRemoveImageVerb ".tif"
  !insertmacro sigkRemoveImageVerb ".tiff"
!macroend

; 「プログラムから開く」と既定のアプリの選択肢（spec-5-2 確定事項A1〜A4・docs/03 2-1）。
; 書く前に消さず、上書きだけにする（上書きインストールの途中で ProgID が消える時間を作らない。確定事項A6）。
!macro sigkWriteAssoc
  ; A1 ProgID。SigK PDF を既定に選んだ PDF は、この絵とコマンドで開く。
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Document" "" "PDF 文書"
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Document\DefaultIcon" "" "${SIGK_PDF_FILE_ICON}"
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Document\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open "%1"'
  ; A2 .pdf の「プログラムから開く」の候補に足す。.pdf の既定値は書き換えない。
  WriteRegNone HKCU "Software\Classes\.pdf\OpenWithProgids" "${SIGK_SHELL_ID}.Document"
  ; A3 exe の名前での登録。「別のプログラムを選択」で選ばれたときにも同じ絵とコマンドになるように。
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\DefaultIcon" "" "${SIGK_PDF_FILE_ICON}"
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  ; A4 設定の「既定のアプリ」の一覧に名前を出す。メニューの「既定のアプリの設定…」は、この値の名前でページを開く。
  WriteRegStr HKCU "Software\${SIGK_SHELL_ID}\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\${SIGK_SHELL_ID}\Capabilities" "ApplicationDescription" "PDF の閲覧・ページの編集・書き込み・結合・分割・変換"
  WriteRegStr HKCU "Software\${SIGK_SHELL_ID}\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\${SIGK_SHELL_ID}\Capabilities\FileAssociations" ".pdf" "${SIGK_SHELL_ID}.Document"
  WriteRegStr HKCU "Software\RegisteredApplications" "${PRODUCT_NAME}" "Software\${SIGK_SHELL_ID}\Capabilities"
!macroend

; 自分のキーと値だけを消す（確定事項A5）。.pdf・.pdf\OpenWithProgids・Applications・RegisteredApplications は
; 空になっても消さない（Windows やほかのアプリが前から作っていることが多い。空のキーは関連付けに効かない）。
!macro sigkRemoveAssoc
  DeleteRegValue HKCU "Software\RegisteredApplications" "${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\${SIGK_SHELL_ID}\Capabilities"
  !insertmacro sigkPruneEmptyKey "Software\${SIGK_SHELL_ID}"
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "${SIGK_SHELL_ID}.Document"
  DeleteRegKey HKCU "Software\Classes\${SIGK_SHELL_ID}.Document"
!macroend

!macro customInstall
  ; 上書きインストールでは、古いアンインストーラーが customUnInstall で先にメニューを消している。
  ; 古い版の残りがあっても二重にならないよう、メニューは消してから書く。
  !insertmacro sigkRemoveMenus

  ; PDF: 入口を 1 つにして、開く・結合・分割を畳む（docs/03 2-2）。
  ; 子の MultiSelectModel は効かず、親に何も無いと 16 個以上で親ごと消える（事前調査 A2）。
  ; 何個選んでも出すよう、親に Player を付ける（論点5）。
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\${SIGK_SHELL_ID}" "MUIVerb" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\${SIGK_SHELL_ID}" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\${SIGK_SHELL_ID}" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\${SIGK_SHELL_ID}" "ExtendedSubCommandsKey" "${SIGK_SHELL_ID}.Menu"

  ; 子のキー名の数字は並び順（シェルはキー名の順に並べる）。表示名は MUIVerb。
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Menu\shell\01open" "MUIVerb" "${PRODUCT_NAME} で開く"
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Menu\shell\01open" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Menu\shell\01open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open "%1"'
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Menu\shell\02merge" "MUIVerb" "選択した PDF を結合"
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Menu\shell\02merge\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --merge "%1"'
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Menu\shell\03split" "MUIVerb" "PDF を分割"
  WriteRegStr HKCU "Software\Classes\${SIGK_SHELL_ID}.Menu\shell\03split\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --split "%1"'

  ; 画像: 入口を畳まず 1 項目だけ出す（docs/03 2-3）。拡張子は image-io.js・launch-args.js の一覧と同じ 7 つ。
  !insertmacro sigkWriteImageVerb ".png"
  !insertmacro sigkWriteImageVerb ".jpg"
  !insertmacro sigkWriteImageVerb ".jpeg"
  !insertmacro sigkWriteImageVerb ".bmp"
  !insertmacro sigkWriteImageVerb ".gif"
  !insertmacro sigkWriteImageVerb ".tif"
  !insertmacro sigkWriteImageVerb ".tiff"

  !insertmacro sigkWriteAssoc

  ; 関連付けが変わったことをシェルに知らせる（SHCNE_ASSOCCHANGED）。エクスプローラーの再起動は要らない。
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; メニューは毎回消す。関連付けは、上書きインストール（古いアンインストーラーが --updated 付きで走る）では残す
; （ProgID が消えると、SigK PDF を既定に選んでいた人の選択が外れるおそれがある。spec-5-2 確定事項A6）。
; 設定（%APPDATA%）は残し、確認も出さない（論点8）。
!macro customUnInstall
  !insertmacro sigkRemoveMenus
  ${ifNot} ${isUpdated}
    !insertmacro sigkRemoveAssoc
  ${endIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; インストールの種類（自分だけ／全員）を選ぶページを出さず、自分だけに固定する（論点6）。
; テンプレートは !ifmacrodef customInstallmode（小文字の m）で確かめるが、NSIS のマクロ名は
; 大文字と小文字を区別しないので、この綴りで差し込まれる（事前調査 B5）。
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
