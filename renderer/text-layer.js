(function (root) {
  'use strict';

  // pdf.js の TextLayer を包む層（spec-1-3 確定事項17）。
  //
  // canvas に描いた絵の上へ、透明な文字を PDF の座標どおりに重ねる。これで
  // 文字をなぞって選べるようになり、Ctrl+C でコピーできる（確定事項23。
  // コピーはブラウザ既定に任せ、独自の実装を持たない）。
  //
  // 文字の位置・回転・横方向の伸縮を PDF の座標から合わせる処理は自前で書けば
  // 必ずずれるため、pdf.js の TextLayer をそのまま使う。ここが持つのは
  // 「いつ作って、いつ捨てるか」と、CSS 変数の面倒だけである。

  function textLayerClass() {
    return root.SigK.pdfjs?.lib?.TextLayer ?? null;
  }

  function available() {
    return textLayerClass() !== null;
  }

  // TextLayer の内部が呼ぶ setLayerDimensions() は、寸法を
  // round(down, var(--total-scale-factor) * Npx, var(--scale-round-x)) という
  // 式として書き込む。3つの変数が未定義だと式が無効になり、テキストレイヤーの
  // 寸法が 0 のままになる（確定事項19）。継承させたいので .pdf-page へ置く。
  //
  // 倍率は CSS ピクセル基準（zoom × 96/72）である。canvas の解像度に掛ける
  // devicePixelRatio は入れない。入れると文字が紙の何倍もの大きさで並ぶ。
  function setScaleVariables(node, zoom) {
    const layout = root.SigK.viewerLayout;
    node.style.setProperty('--total-scale-factor', String(zoom * layout.CSS_UNITS));
    node.style.setProperty('--scale-round-x', '1px');
    node.style.setProperty('--scale-round-y', '1px');
  }

  // ページ1枚分のテキストレイヤーを作る。返す handle は canvas と同じ寿命で、
  // 捨てるときは cancel() を呼ぶ（確定事項21）。
  //
  // viewport は CSS ピクセル基準のものを渡すこと。canvas 用の（devicePixelRatio
  // を掛けた）viewport を渡すと、文字だけが拡大されて紙からはみ出す。
  async function render({ doc, page, viewport }) {
    const TextLayerClass = textLayerClass();
    if (TextLayerClass === null)
      return null;

    const textContentSource = await page.getTextContent();
    const node = doc.createElement('div');
    node.className = 'textLayer';

    const layer = new TextLayerClass({ textContentSource, container: node, viewport });
    let canceled = false;

    // cancel() は render() が返した promise を必ず reject する。捨てた
    // ものの後始末で「拾われなかった拒否」を出さないよう、ここで吸う。
    // 捨てたのでない失敗は、呼び出し側が記録できるように通す。
    const done = layer.render().catch((error) => {
      if (canceled)
        return;
      throw error;
    });

    return {
      node,
      done,
      // 描いた viewport（CSS ピクセル基準・回転込み）。注釈が選択範囲の矩形を
      // pt へ戻すのに使う（spec-4-1 確定事項11）。
      viewport,
      textDivs: () => layer.textDivs,
      // span と1対1で並ぶ、その span の元の文字列（spec-1-4 確定事項14）。
      // 検索のハイライトは span の中身を組み替えるため、元へ戻すのに要る。
      textItems: () => layer.textContentItemsStr,
      // span と1対1で並ぶ元の item（transform・width・fontName）と、フォントごとの
      // ascent/descent。四角の縦の範囲をフォントから決めるのに要る（spec-4-1
      // 確定事項12）。空文字の item（hasEOL だけのもの）も span を持つので、
      // str を持つ item を素通しにすれば並びが合う（事前調査 D）。
      items: () => (textContentSource.items ?? []).filter((item) => item.str !== undefined),
      styles: () => textContentSource.styles ?? {},
      cancel() {
        canceled = true;
        layer.cancel();
      },
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.textLayer = { available, setScaleVariables, render };
})(typeof window !== 'undefined' ? window : globalThis);
