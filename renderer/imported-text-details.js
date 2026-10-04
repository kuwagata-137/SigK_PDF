(function (root) {
  'use strict';

  // 読み込んだ自前のテキストに、注釈の辞書を直に読む口の答えを当てる純粋層（spec-4b-4a 確定事項J2〜J4、spec-4b-4b 確定事項I3）。DOM に触れない
  // （字の送り幅と紙の長さは外から受ける）。annotation-details.js の applyDetails がテキストについてここを呼ぶ。
  //
  // /DS のある自前のテキストは新しい形として組む。太字・斜体・文字の色は /DS（色が無ければ pdf.js の色）、箱は /Rect のまま
  // （今までの形のように 1pt を引かない）。幅の形（自動か固定か）は決まりの欄に書けないので、箱の幅から見分ける（J3）。
  // /DS の無いものは今までの形のまま。口がまるごと答えなかったとき・その注釈の答えが無いとき・/DS を読めないとき（暗号化）・
  // 幅を見分けられないときは null を返し、表示のみにする（太字や幅が分からないまま直すと、開いた時点で見た目が変わるため。J4）。

  // 自動とみなす、中身の幅と最長行の幅の差（pt）。箱は 0.01pt に丸めて保存するので、その丸めを許す。
  const AUTO_TOLERANCE = 0.011;

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function sameLines(a, b) {
    return a.length === b.length && a.every((line, index) => line === b[index]);
  }

  // 中身の幅 content を自動の幅と見るか（J3）。本文を自動の幅で折った行が content で折った行と同じで、content が最長行の幅と
  // AUTO_TOLERANCE 以内なら自動。content で折るときも AUTO_TOLERANCE を足す（自動の箱は最長行を 0.01pt に丸めて保存するので、
  // content が最長行よりわずかに狭いことがある）。戻り値は { auto, longest（自動の幅で折った最長行の幅 pt） }。
  // advanceOf(unit, bold) は字の送り幅（em）。固定の幅を決める側（free-text-metrics.js の keepFixed）も同じ見分けを使う。
  function judgeWidth(entry, content, { advanceOf, pageLength = null }) {
    const layout = root.SigK.freeTextLayout;
    const wrap = root.SigK.freeTextWrap;
    const advance = (unit) => advanceOf(unit, entry.bold === true) * entry.fontSize;
    const autoLines = wrap.wrapLines(entry.text, layout.autoWidthOf(entry, pageLength), advance);
    const longest = autoLines.reduce((max, line) => Math.max(max, wrap.widthOf(line, advance)), 0);
    const auto = Math.abs(content - longest) <= AUTO_TOLERANCE && sameLines(autoLines, wrap.wrapLines(entry.text, content + AUTO_TOLERANCE, advance));
    return { auto, longest };
  }

  // 幅の形（J3）。中身の幅 w ＝ 箱の幅 − 余白（− 斜体の分）を judgeWidth で見て、自動なら 'auto'、そうでなければ w の固定。
  // w が正でなければ null。
  function widthOf(entry, options) {
    const box = root.SigK.freeTextGeometry.frameSize(entry.rect, entry.rotation);
    const content = round(box.width - root.SigK.freeTextLayout.insetOf(entry).horizontal);
    if (!(content > 0))
      return null;
    return judgeWidth(entry, content, options).auto ? 'auto' : content;
  }

  // 塗りと枠線（確定事項J2）。塗りは /C（灰・CMYK も RGB に直す）、枠線は /BS /W が 0 より大きければ /DA の色と /W。
  function decorOf(detail, textColor) {
    const decor = {};
    const fill = root.SigK.importedValues.hexOfComponents(detail.stroke);
    if (fill !== null)
      decor.fill = fill;
    if (Number.isFinite(detail.borderWidth) && detail.borderWidth > 0) {
      decor.borderColor = detail.daColor ?? textColor;
      decor.borderWidth = detail.borderWidth;
    }
    return decor;
  }

  // 回したテキスト（spec-4b-4b 確定事項I3）。口が外観から読んだ回す前の箱と角度を当て、4 隅は回した四角にする（pdf.js の /Rect は
  // 回した外接なので使わない）。回っていなければそのまま。
  function withRotation(entry, rotation) {
    if (rotation === null || rotation === undefined)
      return entry;
    const turn = root.SigK.shapeRotation;
    return { ...entry, rect: [...rotation.box], angle: rotation.angle, quads: [turn.quadOf(rotation.box, rotation.angle)] };
  }

  // 1 件に当てる。今までの形はそのまま、新しい形は組み直した entry、表示のみにするなら null。
  // pageLengthOf(src, rotation) は文字の向きに沿った紙の長さ（pt。分からなければ null）。回転を読めない（'skewed'）もの、
  // 回っているのに /DS の無いもの（今までの形は回さない。確定事項A2）も表示のみ。
  function withTextDetails(entry, detail, { answered = true, advanceOf = null, pageLengthOf = null } = {}) {
    if (!answered || detail === undefined || detail === null || detail.defaultStyle === 'unreadable' || detail.rotation === 'skewed')
      return null;
    const style = detail.defaultStyle;
    const rotation = detail.rotation ?? null;
    if (style === null || style === undefined)
      return rotation === null ? entry : null;
    if (typeof advanceOf !== 'function')
      return null;
    const next = { ...withRotation(entry, rotation), color: style.color ?? entry.color, ...decorOf(detail, entry.color) };
    if (style.bold === true)
      next.bold = true;
    if (style.italic === true)
      next.italic = true;
    const pageLength = typeof pageLengthOf === 'function' ? pageLengthOf(entry.src, entry.rotation) : null;
    const width = widthOf(next, { advanceOf, pageLength });
    return width === null ? null : { ...next, width };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.importedTextDetails = { AUTO_TOLERANCE, judgeWidth, widthOf, withTextDetails };
})(typeof window !== 'undefined' ? window : globalThis);
