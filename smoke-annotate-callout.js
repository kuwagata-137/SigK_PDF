'use strict';

// 起動確認の吹き出しの操作と結果の欄（spec-4b-4b の起動確認）。smoke-annotate.js が annotateScript に埋める。
//
// CALLOUT_STEPS は smoke-annotate-steps.js の分岐の続き（else if の並び）で、埋め込む先のスクリプトにある SigK・name・arg・wait・
// screenPoint・mouse・pageNode・typeAndCommit を使う。操作は次のもの。
//   callout:0:100x700:本文|2行目   吹き出しの道具でページ 0 の pt (100,700) に置いて打ち、Esc で確定する（| は改行）
//   callout-draft:0:100x700:打ちかけ  同じく置いて打つが確定しない（画面写真用。入力欄と輪郭が残る）
//   click-tail:2                     選んでいる吹き出しの選択を外し、しっぽの先から根元へ 2pt 寄った点を押して離す（しっぽの当たり）
// しっぽの先のつまみは grab:tip:40x-20（Shift は grab:tip:40x-20:shift。smoke-annotate-transform.js）で引く。
// CALLOUT_REPORT は結果の callout の欄（自前の吹き出し・入力中の輪郭・選んだ吹き出しのつまみ・右パネルの見出しとヒント・次に付ける値）
// を組む文。文字列の中には ` と ${ を書かない（テンプレートの中に埋めるため）。

const CALLOUT_STEPS = `
    else if (name === 'callout' || name === 'callout-draft') {
      const [page, point, ...words] = arg.split(':');
      const [x, y] = point.split('x').map(Number);
      SigK.annotate.setTool('callout');
      const [sx, sy] = screenPoint(Number(page), x, y);
      for (const type of ['mousedown', 'mouseup'])
        mouse(type, pageNode(Number(page)), sx, sy);
      await wait(150);
      await typeAndCommit(words.join(':'), { commit: name === 'callout' });
    } else if (name === 'click-tail') {
      const entry = SigK.annotate.selectedEntry();
      if (entry !== null && Array.isArray(entry.tip)) {
        const index = SigK.viewer.getPlan().findIndex((page) => page.src === entry.src);
        const tip = SigK.calloutTail.tipOnPaper(entry);
        const center = SigK.shapeRotation.centerOf(entry.rect);
        const toward = Math.hypot(center[0] - tip[0], center[1] - tip[1]);
        const by = Number(arg) || 2;
        const point = [tip[0] + ((center[0] - tip[0]) / toward) * by, tip[1] + ((center[1] - tip[1]) / toward) * by];
        SigK.annotate.select(null);
        SigK.annotate.setTool('select');
        const [sx, sy] = screenPoint(index, point[0], point[1]);
        for (const type of ['mousedown', 'mouseup'])
          mouse(type, pageNode(index), sx, sy);
      }
    }
`;

const CALLOUT_REPORT = `
  const calloutReport = (() => {
    const all = [...SigK.viewer.getAnnotations().added, ...Object.values(SigK.viewer.getImported()).flat()];
    const callouts = all.filter((entry) => entry.kind === 'text' && Array.isArray(entry.tip)).map((entry) => ({
      key: entry.ref ?? entry.id, text: entry.text, rect: entry.rect.map(round), tip: entry.tip.map(round), angle: entry.angle ?? 0,
      tipOnPaper: SigK.calloutTail.tipOnPaper(entry).map(round), color: entry.color, fill: entry.fill ?? null, borderColor: entry.borderColor ?? null,
      borderWidth: entry.borderWidth ?? null, fontSize: entry.fontSize, opacity: entry.opacity, readonly: entry.readonly === true,
    }));
    const outline = document.querySelector('svg.callout-editor-outline');
    const selected = SigK.annotate.selectedEntry();
    const drawn = selected === null ? null : document.querySelector('[data-annot="' + (selected.ref ?? selected.id) + '"]');
    return {
      callouts,
      othersReadonly: all.filter((entry) => entry.readonly === true && entry.subtype === 'FreeText').length,
      editorOutline: outline === null ? null : { path: outline.querySelector('path')?.getAttribute('d')?.length ?? 0, transform: outline.style.transform, background: document.querySelector('textarea.free-text-editor')?.style.background ?? null },
      selectedIsCallout: selected !== null && Array.isArray(selected.tip),
      drawnPaths: drawn === null ? 0 : drawn.querySelectorAll('path.free-text-callout').length,
      kindLabel: document.getElementById('props-kind').textContent,
      hint: document.getElementById('props-hint').textContent,
      nextStyle: SigK.annotate.getTextStyle('callout'),
      nextColor: SigK.annotate.getColors().callout,
    };
  })();
`;

module.exports = { CALLOUT_STEPS, CALLOUT_REPORT };
