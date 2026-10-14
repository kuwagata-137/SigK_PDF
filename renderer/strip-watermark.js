(function (root) {
  'use strict';

  // 透かしを選んでいる間、選んでいる帯の透かしを入れるページに、透かしを薄く重ねて見せる（spec-2-5 確定事項E3。見本
  // screenshots/strips2-watermark.png）。絵と置き方はプレビュー（watermark-preview.js の markOf）と保存（watermark-geometry.js）と同じ。
  //
  // 重ねる先は帯の紙（.sheet）の上の svg.strip-wm。置き方はファイルのページ（basePages の view・rotate）で決めるので、保存していない
  // 回転があっても回したまま重ねる近似になる（既知の限界）。差し込んだページには重ねない（ファイルのページではないため）。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const tool = () => root.SigK.toolsWatermark;
  const geometry = () => root.SigK.watermarkGeometry;

  function fmt(value) {
    return String(Math.round(value * 1000) / 1000);
  }

  // 透かしを選んでいて、帯の画面が出ているか。
  function active() {
    return root.SigK.tools?.isToolsMode() === true && root.SigK.tools.selected() === 'watermark' && root.SigK.strips?.isShown() === true;
  }

  function clear(doc) {
    doc.querySelectorAll('#strips .strip-wm').forEach((node) => node.remove());
  }

  function overlayFor(doc, base, mark, settings) {
    const width = base.width;
    const height = base.height;
    const view = Array.isArray(base.view) ? base.view : [0, 0, width, height];
    const placed = geometry().displayPlacementOf({ box: view, rotate: base.rotate ?? 0, width: mark.width, height: mark.height, angle: settings.angle, size: settings.size, position: settings.position });
    if (placed === null)
      return null;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'strip-wm');
    svg.setAttribute('viewBox', `0 0 ${fmt(width)} ${fmt(height)}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('transform', `translate(${fmt(placed.cx)} ${fmt(placed.cy)}) rotate(${fmt(-placed.angle)}) scale(${fmt(placed.scale)})`);
    group.append(mark.node);
    svg.append(group);
    return svg;
  }

  // 重ね直す。帯を組み直したとき・紙を描いたとき・透かしの設定を変えたとき・ツールを替えたときに呼ばれる。重ねた数を返す。
  function decorate() {
    const doc = root.document;
    if (doc === undefined || doc.getElementById('strips') === null)
      return 0;
    clear(doc);
    const src = active() ? tool().source() : null;
    if (src === null || src.blocked !== null)
      return 0;
    const settings = tool().settings();
    const resolved = root.SigK.watermarkPlan.targetPages(settings, src.pageCount);
    const node = root.SigK.strips.rowNode(src.tabId);
    const view = root.SigK.tabs.peek(src.tabId);
    if (!Array.isArray(resolved.pages) || node === null || view?.plan === undefined)
      return 0;
    const targets = new Set(resolved.pages);
    let count = 0;
    view.plan.forEach((entry, index) => {
      const sheet = Number.isInteger(entry.src) && targets.has(entry.src) ? root.SigK.stripRow.sheetAt(node, index) : null;
      const mark = sheet === null ? null : root.SigK.watermarkPreview.markOf(settings, tool().image());
      const overlay = mark === null ? null : overlayFor(doc, view.basePages[entry.src], mark, settings);
      if (overlay === null)
        return;
      sheet.append(overlay);
      count += 1;
    });
    return count;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripWatermark = { decorate, active };
})(typeof window !== 'undefined' ? window : globalThis);
