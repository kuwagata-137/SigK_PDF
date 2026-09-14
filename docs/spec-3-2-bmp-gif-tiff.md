# 仕様書: Phase 3 塊⑤ BMP／GIF／TIFF の取り込み

起草日: 2026-09-14
ステータス: **確定**（2026-09-14 確定。着手前の範囲4件と起草後の論点5件をユーザーが決定。いずれも起草者の推し。末尾「ユーザーの確定」を参照）
関連: `docs/05_開発ロードマップ.md` Phase 3／`docs/01_製品要件定義.md` F-04-1・F-02-5／
`docs/spec-3-1-image-to-pdf.md`（変換画面・`op-convert.js`・`image-page.js`。本書はその続き）／
`docs/spec-1-6-save.md`（差し込み・画像の形式判定 確定事項53〜62）／`docs/07_開発計画の決定事項.md` 決定18（同梱の区分）・決定29

---

## 目的

塊④ で「画像→PDF」の画面と経路ができたが、受けるのは JPEG／PNG だけである。pdf-lib が埋め込めるのが
その2形式だけで、BMP／GIF／TIFF は**画素へ展開してから PDF の画像オブジェクトにする層**が要るからである。
塊⑤ はその層を**ワーカーの中に純 JS で**作り、変換画面と差し込み（F-02-5）の両方で3形式を使えるようにする。
複数ページの TIFF（FAX・複合機のスキャン）は**全ページ**を PDF にする。これで F-04-1 が埋まり、
Phase 3 に残るのは塊⑥（PDF→画像）だけになる。

---

## 含めるもの / 含めないもの

| 含めるもの | 含めないもの |
|---|---|
| 変換画面で BMP／GIF／TIFF を受ける（選ぶ・ドロップ・`addFromLaunch`）。一覧に形式・画素数・ページ数 | EXIF の Orientation（ユーザー確定③。別の小さな塊、または常用の不満対応で） |
| 差し込み（F-02-5）でも3形式を受ける。複数ページ TIFF は PDF と同じくページ数ぶん | アニメ GIF の2枚目以降（先頭フレームだけ。起草者判断） |
| 複数ページ TIFF は全ページを変換（まとめる／画像ごと。ユーザー確定①） | TIFF の 16bit を 16bit のまま埋め込むこと（上位 8bit に落とす） |
| ワーカー内の純 JS デコード（ユーザー確定④）。utif（TIFF）・omggif（GIF）・自作（BMP） | Old JPEG（圧縮 6）・CCITT RLE（圧縮 2）・JBIG・JPEG 2000・LZMA・ZSTD・WebP 圧縮の TIFF、PlanarConfiguration 2、YCbCr の非圧縮、CIELab、浮動小数の TIFF（名指しで断る） |
| 画素列を pdf-lib の `/XObject /Image` に直接埋め込む層（`worker/pixel-image.js`） | BigTIFF（`II+\0`）、OS/2 の BMP（ヘッダー 12 バイト）、JPEG XR 圧縮の BMP |
| 2値 TIFF を 1bit のまま埋め込む（FAX 1枚 139MB → 4MB） | CCITT の伸長を PDF の `/CCITTFaxDecode` へ素通しすること（単一ストリップ限定の最適化。積み残し） |
| 透明度（透過 GIF・BMP の alpha・TIFF の ExtraSamples）は白で合成 | `/SMask` を作ること（PNG は pdf-lib の経路のまま保つ） |
| 告知（`THIRD-PARTY-NOTICES.md`・`docs/06`）と vendor 複製、fixture、起動確認 | 画素上限の形式別引き上げ（共通の 40M のまま。起草者判断） |

---

## 事前調査（2026-09-14・Windows 11 実機・Node 24 単体・scratchpad に `npm install`。検体は自作）

### A. TIFF: `utif` 3.1.0（MIT・Photopea）

自作の TIFF ライター（II／MM・ストリップ・無圧縮／PackBits／Deflate／LZW＋Predictor 2）と GDI+ で作った
CCITT 検体で `UTIF.decodeImage` を叩いた。

| 項目 | 結果 |
|---|---|
| 圧縮 | **1 無圧縮・3 G3・4 G4・5 LZW（Predictor 2 込み）・7 JPEG・8 Deflate・32773 PackBits が正しく伸長。**32946（Deflate の旧番号）は分岐に無いが、タグの値を 8 に付け替えれば同じ経路で伸長できる。**2（CCITT RLE）・6（Old JPEG）・34661 等は `log("Unknown compression")` を吐くだけで例外を投げず、ごみの画素を返す** → 呼ぶ前に自分で断る |
| `img.data` の並び | **ファイルに格納された packed のまま**（2値は 1bit/px、4bit グレー・4bit パレットも packed、RGB は interleaved、CMYK 4ch、RGBA 4ch）。16bit だけは MM でもリトルエンディアンへ揃えられる（下位・上位の順） |
| Photometric | `decodeImage` 自体は色を解釈しない。付属の `toRGBA8` は 4bit パレット・BlackIsZero の 4bit を誤るので**使わない**。色の解釈は自前で行い、gray／RGB／CMYK／パレットは PDF の色空間へそのまま渡す |
| 複数 IFD | `UTIF.decode` はページ数ぶんの IFD を返す（SubIFD・EXIF は各 IFD の子に入り、ページには数えない）。**次 IFD が自分を指す輪のある TIFF では無限ループしてヒープ 4GB で落ちる**（3秒で再現）。境界検査も無く、途中で切れたファイルでは `TypeError` |
| タイル | `t322〜325` を持つ画像を正しく組み立てる（8×8 タイル×4 で 13×7 を確認） |
| JPEG（7） | GDI+ の JPEG を1ストリップに入れた検体（Photometric 6／2 の両方）を伸長できる。内蔵の JPEG デコーダーは **pdf.js 由来の圧縮された JavaScript**（`_util.warn`・`JpegError` の痕跡。ファイルに出自の表記は無い）。pdf.js は同梱済み（Apache-2.0）なので告知は「構成部品」に1節足す |
| FillOrder 2 | CCITT（`fo` を渡す経路）では正しく読むが、**無圧縮・LZW・PackBits では反転しない**（生のコピー）。自前でビットを反転する |
| `require('pako')` | ファイル先頭で **top-level に** `require("pako")` し、使うのは Deflate の `pako.inflate` だけ。`vendor/utif.js` を素の `require` で読むと `vendor/node_modules/pako` が無く落ちる。**Node の `vm` で CommonJS のラッパー（`(function (exports, require, module, __filename, __dirname) {…})`）を組み、`require` に「`pako` なら `{ inflate: zlib.inflateSync }`」を返す差し替えを渡す**ローダーで解決した（pako を vendor に足さない。ASAR の中でも `fs.readFileSync` は効く） |
| `UTIF.decode` を使わない道 | `decodeImage(buffer, img)` が読むのは `img.tNNN`（256・257・258・259・262・266・273・277・278・279・284・317・320・322〜325・338・347）だけ。**自前の IFD 読みで同じ形の object を組んで渡せば、utif の無防備な IFD 走査を通らずに済む**（PackBits の検体で確認）。`ifds` 引数は RAW（Nikon・ARW）でしか使われない |
| 代替 `tiff` 7.1.3 | ESM only（`"type": "module"`）で fflate・iobuffer に依存し、CCITT 非対応。ワーカーは CommonJS で、FAX の TIFF が読めないのでは本末転倒 → 採らない |

### B. GIF: `omggif` 1.0.10（MIT・Dean McNamee・依存なし）

| 項目 | 結果 |
|---|---|
| `GifReader` | 素の GIF・GIF87a・透過（透過画素は**書かずに飛ばす**ので、事前に白で埋めておけば白地になる）・インターレース・ローカルパレット・部分矩形のアニメ、すべて正しい。入力は `Uint8Array` で可 |
| 壊れたもの | 途中で切ると `Invalid block size` か `Frame index out of range` を投げる。フレーム 0 枚のファイルは投げないので `numFrames() === 0` を自分で見る |
| `GifWriter` | fixture に使える（グローバル／ローカルパレット・透過・複数フレーム）。**インターレースは書けない**（TODO のまま）が、行をインターレース順に並べ替えて書き、Image Descriptor のフラグ（`0x40`）を立てれば正しいインターレース GIF になる（`GifReader` で全画素一致を確認） |
| 12MP（256色） | 伸長 103ms・RSS +56MB（RGBA 48MB） |

### C. BMP: `bmp-js` 0.1.0 と `bmp-ts` 1.0.9 は誤りが多く、**自作**が現実的

自作の BMP ライターで 17 種の検体を作り、3実装で比べた。

| 検体 | bmp-js | bmp-ts（`toRGBA`） | 自作 |
|---|---|---|---|
| 24bit（下から／上から） | ✅ | ✅ | ✅ |
| 24bit・V4／V5 ヘッダー（108／124 バイト） | ❌ ごみ（ヘッダーの長さを見ない） | ✅ | ✅ |
| 画素の前に余白（`bfOffBits` を尊重） | ❌ | ❌ | ✅ |
| 32bit BI_RGB（4バイト目は予約で 0） | ✅（alpha 0 を返す。使うと全透明） | ✅（同左） | ✅（無視して不透明） |
| 32bit BITFIELDS＋alpha マスク | ❌ | ✅ alpha 付きで返す | ✅ 白で合成 |
| 32bit BITFIELDS・40 バイトヘッダー | ❌ 例外 | ✅ | ✅ |
| 16bit 555／565 | 5bit を 8bit に伸ばさない（最大 248） | 同左 | ✅（255 まで伸ばす） |
| 8／4／1bit パレット | ✅ | ❌ `toRGBA` でも並びが ABGR のまま | ✅ |
| RLE8／RLE4 | ❌ | ❌（添字の計算を誤る） | ✅ |
| 途中で切れたもの | `RangeError` | `RangeError` | 文言を返す |

どちらのライブラリも「V4 ヘッダーでごみ」「32bit で全透明」のような**白紙・ごみのページを黙って作る**誤りを持ち、
包んで直すより書くほうが短い。自作は 190 行（`worker/decode-bmp.js`）で、12MP 24bit を 96ms で展開する。
「ライブラリ優先」の規約に対する例外であり、理由は上の表である。

### D. 埋め込み方式: 画素列を直接 `/XObject /Image` にする

`PDFImage` のコンストラクタは embedder が `JpegEmbedder`／`PngEmbedder` のインスタンスであることを
`assertIs` で確かめる。**`PngEmbedder` は `{ width, height, bitsPerComponent }` を持つ object なら何でも受け取る**ので、
そのインスタンスを作って `embedIntoContext(context, ref)` だけを差し替え、`PDFImage.of(ref, doc, embedder)` →
`await image.embed()` とすれば、`page.drawImage` も2回目の `embed()`（no-op）も公開 API のまま通る。
`context.flateStream` は呼んだ時点で圧縮するので、画素は `embed()` の直後に手放せる。

pdf.js（`getOperatorList` → `page.objs`）で読み直し、DeviceRGB 8bit・DeviceGray 1bit（`/Decode [1 0]` の反転込み）・
`/Indexed` 4bit・DeviceCMYK 8bit・DeviceGray 8bit の**5種すべてが正しい画素に展開される**ことを確認した。

(b) PNG に再エンコードして `embedPng` に通す案（`upng-js` 追加）は、同じ 12MP で **3.3秒・RSS +129MB**（直接は 1.4秒）。
圧縮 → 展開 → 再圧縮の3度手間で、コードも依存も増える。採らない。

### E. 実測（12MP＝4000×3000、A4 600dpi＝4960×7016）

| 入力 | デコード | 埋め込み（flate） | 合計 | 出力 |
|---|---|---|---|---|
| BMP 24bit 36MB（ノイズ状の中身） | 54ms | 1308ms | **1.4秒** | 24MB（中身がノイズなので縮まない。写真なら数 MB） |
| GIF 256色 2.1MB | 141ms | 233ms | **0.4秒** | 0.2MB |
| TIFF RGB LZW 16MB | 191ms | 638ms | **0.8秒** | 2.0MB |
| **TIFF 2値 G4 A4 600dpi** 0.7MB | 1036ms | 44ms | **1.1秒** | **63KB**（1bit のまま。RGBA に展開すると 139MB を圧縮することになる） |

RSS の増分は 12MP RGB で 36MB（画素列）＋圧縮の作業域。塊④ の PNG（RGBA 48MB を `save()` まで抱える）より軽い。
「まとめる」の上限 100 ページ・`docs/01` の 1.5GB を割る心配は無い。

### F. fixture の作り方

| 形式 | 純 Node で作れるか |
|---|---|
| BMP 全種 | ✅ 自作ライター（`test/fixtures/images.js` の `makeBmp`。1／4／8／16／24／32bit、RLE、上から、V4／V5、余白） |
| GIF | ✅ `vendor/omggif.js` の `GifWriter`（＋インターレースの並べ替え） |
| TIFF 無圧縮／PackBits／Deflate／LZW／複数ページ／MM／タイル | ✅ 自作ライター（`test/fixtures/tiff.js`。PackBits と LZW のエンコーダー込みで約 150 行） |
| **TIFF CCITT G3／G4** | ❌ Node だけでは作れない。**Windows の GDI+**（`System.Drawing`、PowerShell 20 行）で 64×48 の検体を1回作り（G4 224 バイト・G3 422 バイト）、**base64 で `test/fixtures/ccitt.js` に置く**。生成スクリプトはコメントに残す。CI（ubuntu）でも同じバイト列で回る |
| TIFF JPEG（7） | GDI+ の 32×24 JPEG（707 バイト）を1ストリップに入れる。JPEG も base64 で同じファイルに置く |

### G. ライセンス

utif・omggif はともに MIT。`findCopyleft` の該当なし。utif の内蔵 JPEG デコーダー（pdf.js 由来・Apache-2.0）は
`BUNDLED_COMPONENTS` に1節足し、pdf.js の LICENSE を掲げる。BMP は自作なので告知は要らない。

---

## 確定事項

### A. 形式の判定（`worker/image-format.js`・`worker/tiff-directory.js`）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 受ける形式 | 変換: PNG・JPEG・**BMP・GIF・TIFF**。差し込み: それに PDF。判定は先頭バイト（`spec-1-6` 確定事項53）。TIFF は `II*\0` と `MM\0*` の両方。BigTIFF・WebP・HEIC は既定拒否のまま |
| 2 | 文言 | `describeFormat` から GIF／BMP の名指しを外し、既定は「対応していない形式です。PNG・JPEG・BMP・GIF・TIFF・PDF を選んでください。」。`describeImageFormat` は「PDF は画像ではありません。PNG・JPEG・BMP・GIF・TIFF を選んでください。」と「対応していない形式です。PNG・JPEG・BMP・GIF・TIFF を選んでください。」（「まだ」は外す） |
| 3 | 寸法 | `imageSize(kind, bytes, { frame })` を3形式に広げる。GIF は Logical Screen Descriptor（6〜9 バイト目）、BMP は `BITMAPINFOHEADER`（高さは絶対値）、TIFF は IFD の 256／257（`frame` 番目のページ） |
| 4 | TIFF の IFD 読み | 新設 `worker/tiff-directory.js` の `readTiffDirectory(bytes)` → `{ ok, littleEndian, pages: [ifd…] }`。**必要なタグだけ**（256・257・258・259・262・266・273・277・278・279・284・317・320・322〜325・338・347・254）を utif と同じ `tNNN` キーで持つ。訪れたオフセットを覚えて**輪を断つ**、オフセットが範囲外なら `{ error, incomplete: true }`（先頭 64KB では届かないことがある → `image-io.js` の全体読み直しに乗る）。NewSubfileType（254）が縮小画像（bit 0）か透明マスク（bit 2）の IFD はページに数えない。ページが 0 なら断る |
| 5 | TIFF の対応範囲の判定 | `tiff-directory.js` の `checkTiffSupport(ifd)` → `null` か文言。圧縮は 1・3・4・5・7・8・32773・32946 だけ。**それ以外は名指しで断る**（「この TIFF には対応していません（圧縮方式: 旧 JPEG）。」。名前を持つのは 2 CCITT RLE・6 旧 JPEG・9／10 T.85／T.43・34661 JBIG・34712 JPEG 2000・34925 LZMA・50000 ZSTD・50001 WebP、それ以外は番号）。Photometric は 0・1・2・3・5（6 は圧縮 7 のときだけ）。PlanarConfiguration 2、bps が 1・2・4・8・16 以外、パレットの 16bit、SamplesPerPixel が色空間と合わない（gray に 2ch 以上、RGB に 5ch 以上、CMYK に 5ch 以上）ものは「この TIFF には対応していません（色の形式）。」 |
| 6 | `inspectImageBytes` の戻り | `{ ok, kind, width, height, pages, frames: [{ width, height }…] }`。TIFF 以外は `pages: 1`。TIFF は**全ページ**を確かめ、1ページでも対応外・画素上限超えなら断る（`frames` はページ順） |
| 7 | 画素上限 | **共通の `MAX_PIXELS`（40M）のまま。**2値でもワーカーは軽いが、pdf.js が描くときに RGBA へ展開する（A4 600dpi で 139MB）ので、上限の根拠は閲覧側にある |

### B. デコード（`worker/decode-bmp.js`・`worker/decode-gif.js`・`worker/decode-tiff.js`・`worker/image-decode.js`）

| # | 項目 | 決定 |
|---|---|---|
| 8 | 共通の戻り | `pixels = { width, height, colorSpace: 'gray' \| 'rgb' \| 'cmyk' \| 'indexed', bitsPerComponent: 1 \| 2 \| 4 \| 8, bytes, palette?, inverted? }`。`bytes` は PDF の画像ストリームに**そのまま入る並び**（行は packed、行末はバイト境界）。`palette` は `indexed` のときの RGB 列（`Uint8Array`、3×色数）。`inverted` は WhiteIsZero（`/Decode [1 0]` にする） |
| 9 | 入口 | `image-decode.js` の `decodeImage(kind, bytes, { frame = 0 })` → `{ ok, pixels }` か `{ error }`、`frameCount(kind, bytes)`。png／jpeg は来ない（`image-page.js` が pdf-lib へ渡す） |
| 10 | BMP | 自作（事前調査 C）。1／4／8bit は `indexed`（RLE4／RLE8 込み）、16／24／32bit は `rgb`。BITFIELDS のマスクは V4 以上のヘッダー内か、40 バイトヘッダー直後から読む。**32bit BI_RGB の4バイト目は無視**、alpha マスクがあるときだけ白で合成。高さが負なら上から。`bfOffBits` を尊重。ヘッダーが 40 バイト未満（OS/2）、JPEG／PNG 圧縮（4／5）は「この BMP には対応していません（圧縮か色深度）。」 |
| 11 | GIF | `omggif` の `GifReader`。**先頭フレームだけ**。論理画面の大きさで RGBA を白（255）で埋めてから `decodeAndBlitFrameRGBA(0)` → 透過画素は白のまま → RGB へ詰めて `rgb`。`numFrames() === 0` と例外は「画像を読み込めませんでした。ファイルが壊れている可能性があります。」 |
| 12 | TIFF | `readTiffDirectory` の IFD を `UTIF.decodeImage(buffer, ifd)` に渡す（`UTIF.decode` は使わない。確定事項4）。32946 は `t259` を 8 に付け替えてから渡す。伸長後の `img.data` を Photometric・bps・SamplesPerPixel で解釈する: 0／1 の 1ch は `gray`（bps 1・2・4・8 はそのまま、16 は上位バイト）、0 なら `inverted`。2 の 3ch は `rgb`、4ch は ExtraSamples が 1（乗算済み）／2（未乗算）なら白で合成、0（未指定）なら4番目を捨てる。3 は `indexed`（ColorMap の上位 8bit）。5 の 4ch は `cmyk`。**FillOrder 2 で圧縮が CCITT でないときはビットを反転する** |
| 13 | utif の読み込み | `worker/vendor-loader.js` の `loadCommonJs(file, { require: overrides })`。`fs.readFileSync` → CommonJS のラッパー文字列 → `vm.runInThisContext` → `require` に差し替えを渡す。utif には `{ pako: { inflate: (src) => new Uint8Array(zlib.inflateSync(src)) } }`。`decode-tiff.js` が**最初に使うときに1回だけ**読む（起動時の負担を増やさない）。`omggif` は素の `require(vendor/omggif.js)` で足りる |
| 14 | 壊れたファイル | デコーダーの例外はすべて握り、「画像を読み込めませんでした。ファイルが壊れている可能性があります。」に揃える（`spec-1-6` 確定事項56 と同じ作法。`e.message` で分岐しない） |

### C. 埋め込み（`worker/pixel-image.js`）

| # | 項目 | 決定 |
|---|---|---|
| 15 | `embedPixels(doc, pixels, tools)` | `tools.PngEmbedder` のインスタンスを `{ width, height, bitsPerComponent }` で作り、`embedIntoContext` を差し替えて `PDFImage.of(doc.context.nextRef(), doc, embedder)` → **その場で `await image.embed()`**（差し込みの経路は `save()` が自動で embed しない）。戻りは `PDFImage`（`page.drawImage` がそのまま使える） |
| 16 | 辞書 | `/Type /XObject /Subtype /Image /Width /Height /BitsPerComponent`、`/ColorSpace` は `gray` → `/DeviceGray`、`rgb` → `/DeviceRGB`、`cmyk` → `/DeviceCMYK`、`indexed` → `[/Indexed /DeviceRGB hival <パレットの16進>]`（`PDFHexString`）。`inverted` なら `/Decode [1 0]`。`context.flateStream` で圧縮 |
| 17 | 透明度 | `/SMask` は作らない。透過は各デコーダーが白で合成する（`spec-1-6` 確定事項62 の「白い紙を敷く」と同じ見え方。PNG だけは pdf-lib の経路で `/SMask` が残るが、白い紙の上では見え方が同じ） |
| 18 | `TOOLS` | `worker/pdf-task.js` の `TOOLS` に `PDFImage`・`PngEmbedder` を足す |

### D. 紙に載せる・変換（`worker/image-page.js`・`worker/op-convert.js`・`worker/pdf-task.js`）

| # | 項目 | 決定 |
|---|---|---|
| 19 | `embedImage(doc, loaded, tools, { frame })` | png／jpeg は従来どおり `embedPng`／`embedJpg`。bmp／gif／tiff は `decodeImage(kind, bytes, { frame })` → `embedPixels`。寸法と画素上限は従来どおり**埋め込む前**に `imageSize(kind, bytes, { frame })` で読む。`placeImage(doc, loaded, box, tools, { frame })` も同じく |
| 20 | 1ファイル＝1エントリ | `images: [{ path, name, layouts: [layout…], target? }]`。`layouts` はページ数ぶん（TIFF 以外は1つ）。`convertToSingle` は**ページ単位**で `makePage(doc, entry, frame)` → `addPage` → `embed()`。`bytes` はそのファイルの全ページを載せてから手放す |
| 21 | 進捗 | `apply` を**ページ単位**で刻む（`advance('apply', donePages, totalPages, 'ページ')`）。帯は「変換しています（3 / 12 ページ）」。`task-runner.js` → `save.js` の `onProgress` に `unit` を通し、無ければ従来の「ファイル」 |
| 22 | 画像ごと | 1ファイル → 1本（複数ページ TIFF は N ページの1本）。`runConvertEach` の戻り `pages` は本ごとのページ数 |
| 23 | 戻り | `runConvertSingle` の `pages` は総ページ数、`inputs` はファイル数（帯「N ファイルを変換しました（M ページ）」はそのまま） |

### E. 差し込み（`worker/op-insert.js`・`file-io.js`）

| # | 項目 | 決定 |
|---|---|---|
| 24 | 受け入れ | `loadSource` は `isSupported` に従う（3形式が通る）。画像は `{ ok, kind, bytes, frames }`（`frameCount`） |
| 25 | プレビュー | `buildPreview` の `count` は PDF ならページ数、画像なら `frames`。各ページを `placeImage(…, { frame: index })` で組む。`renderer/insert.js` は既にページ配列を汎用に扱う（`page: index`）ので変えない |
| 26 | 本番 | `prepareInserts` は画像でも `spec.page` を `frame` として渡す。範囲外は「差し込む画像にそのページがありません。」 |
| 27 | フィルター | `INSERT_FILTERS` と `IMAGE_FILTERS` に `bmp`・`gif`・`tif`・`tiff` |

### F. 画面（`renderer/*`・`image-io.js`）

| # | 項目 | 決定 |
|---|---|---|
| 28 | `inspectImage` | `{ ok, path, name, size, kind, width, height, pages, frames }`。`tool-source.js` は素通し |
| 29 | 一覧の行 | 形式の列に `BMP`・`GIF`・`TIFF`。ページが 2 以上なら画素数の列に「 ・ 3 ページ」を添える（画素数は先頭ページ）。「この紙」は先頭ページの計画 |
| 30 | 計画 | `planConvert` は行ごとに `frames` の各ページへ `planPage` を引き、`pages: [[layout…]…]`（行 × ページ）と `totalPages` を返す。**合計ページ数が `MAX_INPUTS`（100）を超えたら `ready: false` と「100 ページまでです」**（ファイル数の先出しの上限は従来どおり 100） |
| 31 | 出力の例 | まとめる: `photo.pdf（12 ページ）` の数は総ページ数。画像ごと: `a.pdf … l.pdf（12 ファイル）` は従来どおり |
| 32 | `stem` | 拡張子の正規表現に `bmp`・`gif`・`tif`・`tiff` |
| 33 | ドロップ | `file-drop.js` の拡張子判定に3形式。文言「画像ファイルではありません。PNG・JPEG・BMP・GIF・TIFF を落としてください。」 |
| 34 | 起動確認 | `SIGK_SMOKE_CONVERT` は拡張子を見ないのでそのまま3形式を受ける。fixture の `image-*.bmp/gif/tif` を渡す |

### G. 同梱と告知

| # | 項目 | 決定 |
|---|---|---|
| 35 | 依存 | `devDependencies` に `utif ^3.1.0`・`omggif ^1.0.10`（決定18。pako は pdf-lib 経由で既にある）。`VENDOR_MANIFEST` に `UTIF.js → vendor/utif.js`・`omggif.js → vendor/omggif.js` |
| 36 | 告知 | `BUNDLED` に utif・omggif、`BUNDLED_COMPONENTS` に「JPEG デコーダー（utif 内蔵・pdf.js 由来・Apache-2.0）」（pdf.js の LICENSE を掲げる）。`docs/06` 第4章の表にも足す |

---

## 足りない部品

### 新しいモジュール

| ファイル | 役目 | 依存 |
|---|---|---|
| `worker/tiff-directory.js` | `readTiffDirectory`・`checkTiffSupport`・`tiffFrameSize` | なし |
| `worker/decode-bmp.js` | `decodeBmp`・`bmpSize` | なし |
| `worker/decode-gif.js` | `decodeGif`・`gifSize` | vendor/omggif |
| `worker/decode-tiff.js` | `decodeTiff`（utif の遅延読み込み・色の解釈・FillOrder） | vendor/utif（ローダー経由） |
| `worker/vendor-loader.js` | `loadCommonJs(file, { require })` | なし |
| `worker/image-decode.js` | `decodeImage(kind, bytes, { frame })`・`frameCount` | 上の4つ |
| `worker/pixel-image.js` | `embedPixels(doc, pixels, tools)` | pdf-lib（tools 経由） |
| `test/fixtures/tiff.js` | `makeTiff`・`packBits`・`lzwEncode` | zlib |
| `test/fixtures/ccitt.js` | G4／G3／JPEG の検体（base64）と生成手順 | なし |

### 既存への追記

| ファイル | 追記 |
|---|---|
| `worker/image-format.js` | TIFF の署名、`SUPPORTED`／`IMAGE_KINDS` に3形式、`imageSize` の3形式、`inspectImageBytes` の `pages`／`frames`、文言 |
| `worker/image-page.js` | `embedImage`／`placeImage` に `tools`・`frame` |
| `worker/op-convert.js` | `layouts`・ページ単位の進捗・`unit` |
| `worker/op-insert.js` | `frames`・`buildPreview` の `count`・`prepareInserts` の `frame` |
| `worker/pdf-task.js` | `TOOLS`、`convertEntries` の `layouts`、`runConvertEach` の `pages` |
| `task-runner.js` / `renderer/save.js` | 進捗の `unit` |
| `image-io.js` / `file-io.js` | フィルター、`inspectImage` の `pages`／`frames` |
| `renderer/convert-plan.js` | `stem`、`planConvert` の行×ページ、`totalPages`、上限 |
| `renderer/tools-convert.js` / `-list.js` / `-view.js` | `frames`・`layouts`、行の「N ページ」、出力の例 |
| `renderer/file-drop.js` / `renderer/tool-source.js` | 拡張子と文言、素通し |
| `test/harness.js` | `inspectImage` のスタブに `pages`／`frames` |
| `test/fixtures/images.js` / `build.js` / `.gitignore` | `makeBmp`・`makeGif`、ディスク検体、`*.bmp`／`*.gif`／`*.tif` |
| `package.json` / `scripts/vendor.js` / `scripts/notices.js` / `THIRD-PARTY-NOTICES.md` / `docs/06` | 依存・複製・告知 |
| `docs/02` | 1-3 の vendor 表、第4章のモジュール図、preload API 表、現在地 |

### fixture

| ファイル | 中身 | 用途 |
|---|---|---|
| `image-rgb.bmp` | 640×480・24bit・下から | 変換・差し込み・起動確認 |
| `image-palette.gif` | 320×200・16色・透過あり | 白地の確認 |
| `image-pages.tif` | 3ページ（640×480 RGB LZW／320×240 gray8 PackBits／64×48 2値 無圧縮 WhiteIsZero） | 複数ページ・ページごとの紙・画像ごと |
| `image-fax.tif` | 64×48・G4（`ccitt.js` の base64） | CCITT・1bit のまま埋め込み |

---

## テストの範囲

| 層 | 対象 |
|---|---|
| 依存なし | `image-format.js`（両エンディアンの署名・3形式の寸法・`pages`／`frames`・`incomplete`・文言）、`tiff-directory.js`（II／MM・複数 IFD・輪・範囲外・縮小画像の除外・`checkTiffSupport` の各文言）、`decode-bmp.js`（事前調査 C の 17 種＋途中で切れたもの）、`vendor-loader.js`（差し替えた `require` が効く）、`convert-plan.js`（行×ページ・`totalPages`・上限・`stem`） |
| vendor 依存 | `decode-gif.js`（パレット・透過が白・インターレース・アニメの先頭・0フレーム・途中切れ）、`decode-tiff.js`（無圧縮／PackBits／Deflate 8・32946／LZW＋Predictor／G4／G3／JPEG／WhiteIsZero／gray4／gray16／パレット4・8／RGBA／CMYK／複数ページ／MM／タイル／FillOrder 2／非対応の圧縮と色の形式の文言）、`pixel-image.js`（辞書の中身・`/Indexed`・`/Decode`・pdf-lib で読み直し・2回目の `embed()` が無害）、`image-page.js`（3形式と `frame`）、`op-convert.js`（3ページ TIFF → 3ページ・進捗が 3 刻み・`each` で1本3ページ）、`op-insert.js`（3形式のプレビューと本番・複数ページ・範囲外）、`pdf-task.js`（`layouts`・`unit`・`pages`） |
| jsdom | `tools-convert.test.js`（3形式のラベル・「3 ページ」・出力の例の総ページ数・101 ページで実行不可）、`file-drop.test.js`、`image-io.test.js`（フィルター・`pages`）、`insert.test.js`（TIFF 3ページ → 3枚） |
| 起動確認 | 開発ツリーと配布物で `SIGK_SMOKE=1`・`SIGK_SMOKE_CONVERT=<bmp;gif;tif>`（single／each／cancel）。変換した PDF をタブで開いて pdf.js が描く。`_STAY=1` で `screenshots/phase3-formats-app.png` |
| 実測 | 事前調査 E を実装後の経路で再測し、下の「実測」に記録 |
| 告知 | `npm run notices` が GPL／AGPL 無しで通り、utif・omggif と構成部品が載る |

---

## 完了の判定

1. 変換画面に BMP／GIF／TIFF が入り、形式・画素数・ページ数（2 以上のとき）が出て、実行できる
2. 複数ページ TIFF が全ページ変換される（まとめる: 総ページ数、画像ごと: 1本に N ページ）。帯の進捗はページ単位
3. 差し込みで3形式が入り、複数ページ TIFF はページ数ぶん差し込まれる（プレビューも本番も）
4. 透過 GIF に白地が敷かれ、2値 TIFF（WhiteIsZero・BlackIsZero）の白黒が正しい。1bit のまま埋め込まれている（G4 A4 600dpi が 100KB 以下）
5. 非対応の圧縮・色の形式・壊れたファイルは名指しの文言で断られ、行に印が付く
6. 12MP の BMP／GIF／TIFF が各 2 秒以内、A4 600dpi G4 が 2 秒以内。RSS の増分が 1 枚ぶんに収まる
7. `npm test` が緑、`npm run dist` の配布物でも `SIGK_SMOKE=1` と `SIGK_SMOKE_CONVERT` が通る。`THIRD-PARTY-NOTICES.md` に utif・omggif と構成部品が載る
8. 変換した PDF を他のビューアで開き、白黒・色・透過が正しい（ユーザー目視）

### 人が目で確かめる手順

- 実物の FAX／複合機の TIFF（複数ページ・G4）を変換し、他のビューアでページ数と白黒を確かめること。
- 実物の GIF（透過あり）と BMP（Windows の「ペイント」保存）を変換し、白地と色を確かめること。
- `screenshots/phase3-formats-app.png` で一覧の「TIFF ・ 3 ページ」の見た目を確かめること。

---

## ユーザーの確定

### 着手前（2026-09-14・4件とも起草者の推し）

| # | 論点 | 確定 | 推しの根拠 |
|---|---|---|---|
| ① | 複数ページ TIFF | **全ページを変換する** | FAX・複合機の TIFF は複数ページが普通で、先頭だけでは使い物にならない。一覧の行に「3 ページ」と出し、出力の例のページ数にも数える |
| ② | 差し込み（F-02-5） | **差し込みにも広げる** | 同じ `embedImage` を通るので、広げないほうが不自然。複数ページ TIFF は PDF と同じくページ数ぶん |
| ③ | EXIF Orientation | **含めない** | 形式の追加とは別の論点。別の小さな塊、または常用の不満対応で |
| ④ | デコードの場所 | **ワーカーで純 JS ライブラリ** | 差し込みと共用でき、`node --test` だけで検証できる。Chromium の canvas は TIFF を読めない |

### 起草後（2026-09-14・事前調査を踏まえて AskUserQuestion で5件。すべて起草者の推しで確定）

| # | 論点 | 確定 | 推しの根拠 |
|---|---|---|---|
| 1 | ライブラリ | **TIFF は utif、GIF は omggif、BMP は自作。utif の pako は zlib の差し替えローダーで解決** | 事前調査 A〜C。BMP は両ライブラリに白紙・ごみの誤りがある |
| 2 | 埋め込み方式 | **画素列を直接 `/XObject /Image`** | 事前調査 D。PNG 再エンコードの 2.3 倍速く、依存が増えない |
| 3 | 2値 TIFF | **1bit のまま（`/DeviceGray` 1bit＋`/Decode`）。画素上限は共通の 40M のまま** | 事前調査 E。出力 63KB。上限は閲覧側の展開が根拠 |
| 4 | CCITT の fixture | **GDI+ で1回作り base64 で置く（生成手順を添える）** | 自作 G4 エンコーダーは横モードだけでも 150 行を超え、目視だけでは回帰が守れない |
| 5 | TIFF の圧縮の範囲 | **1・3・4・5・7・8・32773・32946。それ以外は名指しで断る** | utif が投げずにごみを返す分岐は自分で塞ぐ。Old JPEG は仕様上も非推奨 |

### 起草者の判断で決めたもの

- アニメ GIF は先頭フレーム（確定事項11）。透過は白で合成し `/SMask` は作らない（確定事項17）。
- 上限 100 は**ページ**で数える（確定事項30。メモリの根拠がページ単位のため）。
- TIFF の各ページに個別の紙（確定事項30。ページごとに `planPage`。向き「自動」がページごとに効く）。
- 縮小画像・透明マスクの IFD はページに数えない（確定事項4）。
- 16bit は上位 8bit に落とす。CMYK は `/DeviceCMYK` にそのまま（確定事項12・16）。
- `describeFormat`／`describeImageFormat` の名指し（GIF・BMP）を外し「まだ」を消す（確定事項2）。
- BMP の自作は「ライブラリ優先」の例外（事前調査 C に根拠）。

---

## 未確定のまま残すもの

| 項目 | 扱い |
|---|---|
| CCITT の素通し（`/CCITTFaxDecode`） | 単一ストリップの G4 なら伸長せずに入れられ（63KB → 約 50KB、1.0 秒 → 0 秒）、pdf.js も描ける。複数ストリップでは使えないので経路が2本になる。FAX の大量変換で不満が出たら足す |
| EXIF の Orientation | 塊④ から持ち越し。TIFF の Orientation タグ（274）も同じ扱い（読まない。既知の限界） |
| 16bit のまま埋め込む | PDF 1.5 の 16bit 画像は pdf.js が描けるが、検体が乏しい。要望が出てから |
| DPI（TIFF の 282／283、BMP の解像度） | 「画像サイズに合わせる」の換算に足す候補（`spec-3-1` と同じ扱い） |
| YCbCr の非圧縮 TIFF・CIELab | 断る。要望が出てから |
| `pdf-task.js` の分割 | 460 行。`runMerge`／`runSplit`／`runConvert` を `worker/tool-tasks.js` へ移す整理は塊⑤ の外（`spec-3-1` から持ち越し） |

---

## 実装の記録（2026-09-14・`claude/phase-3-image-formats` ブランチ）

確定事項1〜36 をそのまま実装した。仕様書から変えた点・足した点は次のとおり。

| 項目 | 仕様書 | 実装 | 理由 |
|---|---|---|---|
| JPEG のマーカー走査 | `image-format.js` に置いたまま | `worker/jpeg-frame.js` へ切り出し（`jpegStartOfFrame`・`isProgressiveJpeg`・`jpegSize`）。`image-format.js` は re-export で公開を保つ | 3形式を足すと `image-format.js` が 200 行を超えた |
| 差し込みの注釈の掃除 | `op-insert.js` に置いたまま | `worker/inserted-annotations.js` へ切り出し（`cleanInsertedPage`）。`op-insert.js` は re-export | 3形式と複数ページを受けて 225 行になった |
| BMP のパレット | `indexed`（bpc は 8） | 無圧縮の 1／4／8bit は**行の詰め物を外して packed のまま** `indexed`（bpc 1／4／8）。RLE だけ 8bit のインデックス列 | 展開しないぶん速く小さい。PDF の `/Indexed` は bpc 1・2・4・8 を受ける |
| `layouts` の受け口 | `images: [{ layouts }]` | `pdf-task.js` の `convertEntries` は塊④ までの `layout`（1つ）も受ける。画面と起動確認は `layouts` へ移した | 古い spec が来ても落ちない |
| 一覧のページ数 | 画素数の列に「 ・ 3 ページ」 | そのとおり。列幅を 92px → 150px にし折り返さない（`4960×7016 ・ 3 ページ` まで入る） | 実機で 2 行に折れた（`screenshots/phase3-formats-app.png` の撮り直し前） |
| 画面の説明文 | — | 「JPEG・PNG・BMP・GIF・TIFF を PDF にします。」に改めた（`index.html`） | 実機のスクリーンショットで気づいた |
| `save()` の出力の複製 | — | `runConvertSingle`／`runConvertEach` の `Buffer.from(output)` を、複製しない `Buffer.from(output.buffer, …)` に | 12MP × 10 の実測で RSS の頂点が +627MB → +502MB に下がった（下の「実測」） |
| ページ数の食い違い | — | 一覧に入れたときのページ数より実物が少なければ「「a.tif」画像のページ数が一覧に入れたときと違います。もう一度足してください。」で全体を止める。多ければ先頭だけを載せる | 一覧に入れたあとでファイルが差し替えられることがある |
| `frameCount` | `image-decode.js` に置く | そのとおり。ただし `op-insert.js` は PNG／JPEG を 1 と即答し、3形式だけ `frameCount` へ回す | PNG／JPEG は `image-decode.js` に来ない（確定事項9） |

### 完了判定の結果

| # | 判定 | 結果 |
|---|---|---|
| 1 | 変換画面に3形式が入り、形式・画素数・ページ数（2 以上のとき）が出て、実行できる | ✅ jsdom（`test/tools-convert.test.js`）・起動確認（`rows` に `bmp`／`gif`／`tiff`、`pixels` に `640×480 ・ 3 ページ`） |
| 2 | 複数ページ TIFF が全ページ変換される（まとめる: 総ページ数、画像ごと: 1本に N ページ）。帯の進捗はページ単位 | ✅ `test/op-convert.test.js`（3ページ → 3ページ・進捗 `1/4 … 4/4 ページ`・`each` で `pages: [2, 1]`）・起動確認（4ファイル → 6ページ、`each` で `pages: [1, 1, 3, 1]`） |
| 3 | 差し込みで3形式が入り、複数ページ TIFF はページ数ぶん（プレビューも本番も） | ✅ `test/op-insert.test.js`（`buildPreview` が 2 ページ・`page: 2` で3ページ目・範囲外は文言）・`test/insert.test.js`（画面の控えが `page: 0, 1, 2`） |
| 4 | 透過 GIF に白地、2値 TIFF の白黒が正しい。1bit のまま埋め込まれる（G4 A4 600dpi が 100KB 以下） | ✅ `test/decode-gif.test.js`・`test/decode-tiff.test.js`・`test/pixel-image.test.js`（`/BitsPerComponent 1`・`/Decode [1 0]`）。A4 600dpi G4 の出力 0.1MB（下の「実測」）。実機の描画は `scratchpad` のスクリーンショットで GIF の市松の透過が白、G4 の三角が黒、CMYK の4色、4bit パレットの縞を確認 |
| 5 | 非対応の圧縮・色の形式・壊れたファイルは名指しの文言で断られ、行に印が付く | ✅ `test/tiff-directory.test.js`（圧縮 2・6・34712・99999、色の形式 10 通り）・`test/decode-bmp.test.js`・`test/image-format.test.js`（2ページ目が旧 JPEG なら一覧で断る） |
| 6 | 12MP の3形式が各 2 秒以内、A4 600dpi G4 が 2 秒以内。RSS の増分が 1 枚ぶんに収まる | ✅ 時間は下の「実測」（1.3〜1.8 秒・1.1 秒）。**RSS は 1 枚ぶんに収まるが「1 枚ぶん」が出力の大きさに比例する**（下の注記） |
| 7 | `npm test` 緑、配布物で `SIGK_SMOKE=1` と `SIGK_SMOKE_CONVERT` が通る。告知が揃う | ✅ 974 件（908 → 974）。配布物で `single`（6 ページ・`problems: []`）と `each`（4 本・3 択の確認あり）。`THIRD-PARTY-NOTICES.md` に utif・omggif・JPEG デコーダーの節、`findCopyleft` の該当なし |
| 8 | 他のビューアで開いて白黒・色・透過が正しい | ⏳ **ユーザーの目視待ち。**pdf-lib で読み直した検証と、pdf.js（アプリ内）の描画は通っている |

### 実測（Windows 11 実機・Node 24 単体・`runConvert` の経路・写真に近い中身の 12MP＝4000×3000）

| 入力 | 大きさ | 時間 | 出力 |
|---|---|---|---|
| BMP 24bit | 34.3MB | 1.3 秒 | 21.0MB |
| GIF 256色 | 6.7MB | 1.4 秒 | 4.6MB |
| TIFF RGB LZW | 44.4MB | 1.8 秒 | 21.0MB |
| **TIFF 2値 G4 A4 600dpi**（4960×7016） | 0.7MB | 1.1 秒（伸長が 1.0 秒） | **0.1MB** |
| TIFF RGB LZW **× 10 をまとめる** | 444MB | 17.9 秒 | 209.8MB。RSS の頂点 **+502MB**（複製を外す前は +627MB） |

> **RSS の注記（積み残し）。**写真のような中身は Flate で縮まず、12MP で 1 ページ 21MB になる。pdf-lib は
> 圧縮済みのストリームを `save()` まで全部抱え、`save()` で1本に組むので、**RSS の頂点は出力の 2.5 倍近く**
> になる。100 ページの上限いっぱいなら出力 2GB・RSS 5GB になり得て、`docs/01` の 1.5GB を割る。これは
> 塊④ の PNG も同じで（塊④ の実測は単色の PNG だったので現れなかった）、JPEG だけは元のバイト列を
> そのまま入れるので小さい。pdf-lib の作りによるもので、直すなら「まとめる」を画像ごとの一時ファイルに
> 分けて後で結合する、あるいは大きな画像のときは上限を下げる、のどちらかになる。常用の不満を見てから決める。

起動確認の中止（`_CANCEL=1`）は、fixture の 12 ファイル 24 ページが 0.66 秒で終わってしまい、中止の
押下が完了のあとになった（`ok: true`・24 ページ）。中止の経路そのものは塊④ から変えていない。

> 起動確認を Git Bash から回すときは `SIGK_SMOKE_CONVERT` に**絶対パスを `;` で並べない**（`spec-3-1` と同じ）。
> scratchpad の検体のような絶対パスを 1 つだけ渡すときは `MSYS_NO_PATHCONV=1` を付ける。

### 人が目で確かめる手順（残り）

- 実物の FAX／複合機の TIFF（複数ページ・G4）を変換し、他のビューアでページ数と白黒を確かめること（判定8）。
- 実物の GIF（透過あり）と BMP（Windows の「ペイント」保存）を変換し、白地と色を確かめること。
- `screenshots/phase3-formats-app.png` で一覧の「640×480 ・ 3 ページ」の見た目を確かめること。
