'use strict';

// Node だけでは作れない検体（spec-3-2 事前調査 F）。Windows の GDI+（System.Drawing）で
// 1回だけ作り、base64 で置く。CI（ubuntu）でも同じバイト列で回る。
//
// 中身はどれも「左上の三角が黒」の 64×48（x + y < 64 の画素が黒）。CCITT の検体は
// WhiteIsZero（Photometric 0）で、1 が黒である。JPEG は 32×24 で、左半分が赤・
// 右下が青・右上が白（RGB の位置関係を見るため）。
//
// 作り直すときは PowerShell で次を実行する（Compression: 4 = G4、3 = G3）。
//
//   Add-Type -AssemblyName System.Drawing
//   $bmp = New-Object System.Drawing.Bitmap(64, 48, [System.Drawing.Imaging.PixelFormat]::Format1bppIndexed)
//   $rect = New-Object System.Drawing.Rectangle(0, 0, 64, 48)
//   $data = $bmp.LockBits($rect, 'WriteOnly', $bmp.PixelFormat)
//   $bytes = New-Object byte[] ($data.Stride * 48)
//   for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = 0xFF }          # 白で埋める
//   for ($y = 0; $y -lt 48; $y++) { for ($x = 0; $x -lt 64; $x++) {
//     if ($x + $y -lt 64) { $i = $y * $data.Stride + ($x -shr 3); $bytes[$i] = $bytes[$i] -band (-bnot (0x80 -shr ($x -band 7))) } } }
//   [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
//   $bmp.UnlockBits($data)
//   $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/tiff' }
//   $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
//   $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Compression, [long]4)
//   $bmp.Save('g4.tif', $codec, $params)
//   [Convert]::ToBase64String([IO.File]::ReadAllBytes('g4.tif'))
//
// JPEG は `New-Object System.Drawing.Bitmap(32, 24)` に FillRectangle で赤（0,0,16,24）と
// 青（16,12,16,12）を描き、`ImageFormat.Jpeg`（品質 90）で保存したものである。

const WIDTH = 64;
const HEIGHT = 48;

// CCITT G4（圧縮 4）・224 バイト・単一ストリップ・600dpi
const G4_TIFF = Buffer.from(
  'SUkqAC4AAAAmoHhvWta1rWta1rWta1rWta1rWta1rWta1rWta1rWta1ABABAAA0A/gAEAAEAAAAA'
  + 'AAAAAAEEAAEAAABAAAAAAQEEAAEAAAAwAAAAAgEDAAEAAAABAAAAAwEDAAEAAAAEAAAABgEDAAEA'
  + 'AAAAAAAAEQEEAAEAAAAIAAAAFQEDAAEAAAABAAAAFgEEAAEAAAAwAAAAFwEEAAEAAAAlAAAAGgEF'
  + 'AAEAAADQAAAAGwEFAAEAAADYAAAAKAEDAAEAAAACAAAAAAAAAMAnCQDoAwAAwCcJAOgDAAA=',
  'base64',
);

// CCITT G3（圧縮 3）・422 バイト
const G3_TIFF = Buffer.from(
  'SUkqAPQAAAAAE1A8NwATUGccAE1BmcAE1BagAE1AssAE1ArwAE1BZ4AE1BY8AE1AomACagT0ABNQ'
  + 'ODgAmoG6AATUCQgAE1BTDABNQUtAATUGXUAE1BkqABNQV6wATUFZOACagqjAATUFQQACahtlwATU'
  + 'NoGACag2hAATUGxQACahrqwATUNYmACahqpAATUNQwACahpgQAJqGkBgAmoNY0ACag1DYAJqDSJA'
  + 'AmoNAmACahmigAJqGYKgAmoZYsACahlC4AJqBgoABNQLlIAJqCgqABNQblYAJqGwsABNQ0FoAJqG'
  + 'cEABNQIBQATUGAoAEAEAEA0A/gAEAAEAAAAAAAAAAAEEAAEAAABAAAAAAQEEAAEAAAAwAAAAAgED'
  + 'AAEAAAABAAAAAwEDAAEAAAADAAAABgEDAAEAAAAAAAAAEQEEAAEAAAAIAAAAFQEDAAEAAAABAAAA'
  + 'FgEEAAEAAAAwAAAAFwEEAAEAAADsAAAAGgEFAAEAAACWAQAAGwEFAAEAAACeAQAAKAEDAAEAAAAC'
  + 'AAAAAAAAAMAnCQDoAwAAwCcJAOgDAAA=',
  'base64',
);

// ベースライン JPEG（32×24・YCbCr 4:2:0・707 バイト）。JPEG 圧縮の TIFF の1ストリップに使う。
const JPEG_32X24 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAQCAwMDAgQDAwMEBAQEBQkGBQUFBQsICAYJDQsNDQ0L'
  + 'DAwOEBQRDg8TDwwMEhgSExUWFxcXDhEZGxkWGhQWFxb/2wBDAQQEBAUFBQoGBgoWDwwPFhYWFhYW'
  + 'FhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhb/wAARCAAYACADASIA'
  + 'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA'
  + 'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3'
  + 'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm'
  + 'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA'
  + 'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx'
  + 'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK'
  + 'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3'
  + 'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxeiii'
  + 'vyk/v4/Waivh3/h4j/1R/wD8ub/7lo/4eI/9Uf8A/Lm/+5a/pb/iF3F//QJ/5PT/APkz/Pb67h/5'
  + 'vwZ890UUV/NJ/oSeQ0UUV/qof5rn/9k=',
  'base64',
);

// 検体と同じ「左上の三角が黒」を packed 1bit（1 = 黒）で作る。伸長結果との突き合わせに使う。
function triangleBits(width = WIDTH, height = HEIGHT) {
  const rowBytes = Math.ceil(width / 8);
  const rows = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (x + y < width)
        rows[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return rows;
}

module.exports = { WIDTH, HEIGHT, G4_TIFF, G3_TIFF, JPEG_32X24, triangleBits };
