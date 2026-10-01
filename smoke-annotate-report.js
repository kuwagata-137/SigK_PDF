'use strict';

// 起動確認の注釈の経路の、結果を組む部分（smoke-annotate.js の annotateScript の末尾に埋める文）。
// 2,000 行を超えた main.js から移した（spec-4b-1a 確定事項36。中身は変えていない）。
//
// 埋め込む先のスクリプトにある SigK・pageNode・viewportOf・round・editorNode・importedBefore・
// applied・saveResult・zoomBefore・zoomAfter を使う。

const REPORT = `
  // 回転したページで、span の横位置が item の横位置と合っているか（確定事項31）。
  // 見えているページのうち、テキストレイヤーのあるものを 1 つずつ見る。
  const alignment = [];
  for (const index of SigK.viewer.getState().rendered) {
    const handle = SigK.viewer.getTextLayer(index);
    const node = pageNode(index);
    if (!handle || !node)
      continue;
    const items = handle.items();
    const divs = handle.textDivs();
    const k = items.findIndex((item) => item.str && item.str.length > 3 && item.transform);
    if (k < 0 || !divs[k] || !divs[k].isConnected)
      continue;
    const base = node.getBoundingClientRect();
    const rect = divs[k].getBoundingClientRect();
    const corners = [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]]
      .map(([x, y]) => handle.viewport.convertToPdfPoint(x - base.left, y - base.top));
    const xs = corners.map((p) => p[0]);
    alignment.push({
      page: index + 1,
      rotation: handle.viewport.rotation,
      spanX: [round(Math.min(...xs)), round(Math.max(...xs))],
      itemX: [round(items[k].transform[4]), round(items[k].transform[4] + items[k].width)],
    });
  }

  const annots = SigK.viewer.getAnnotations();
  const importedEntries = Object.values(SigK.viewer.getImported()).flat();
  return {
    applied,
    importedBefore,
    importedAfter: importedEntries.length,
    added: annots.added.map((entry) => ({ src: entry.src, kind: entry.kind, color: entry.color, quads: entry.quads.length, rect: entry.rect.map(round), text: entry.text.slice(0, 20) })),
    // テキスト（spec-4-2 の完了判定）。置いたもの、読み込んだもの、フォントの先読み、入力欄の残り。
    texts: annots.added.filter((entry) => entry.kind === 'text').map((entry) => ({ src: entry.src, text: entry.text, fontSize: entry.fontSize, rotation: entry.rotation, color: entry.color, rect: entry.rect.map(round) })),
    importedTexts: importedEntries.filter((entry) => entry.kind === 'text').map((entry) => ({ ref: entry.ref, src: entry.src, text: entry.text, fontSize: entry.fontSize, rotation: entry.rotation, color: entry.color, rect: entry.rect.map(round) })),
    fontLoaded: SigK.freeTextShape.isLoaded(),
    editing: editorNode() !== null,
    textShapes: [...document.querySelectorAll('.annot-layer')].map((svg) => svg.querySelectorAll('g[data-kind="text"] text').length),
    propsSize: document.getElementById('props-size').value,
    propsSizeVisible: document.getElementById('props-size-row').hidden === false,
    removed: annots.removed,
    dirty: SigK.viewer.isDirty(),
    history: SigK.pageEdit.getHistoryState(),
    tool: SigK.annotate.getTool(),
    selected: SigK.annotate.getSelected(),
    shapes: [...document.querySelectorAll('.annot-layer')].map((svg) => svg.querySelectorAll('polygon, line').length),
    // 図形・ペン（spec-4-3 の完了判定）。描いたもの、読み込んだもの、右パネルの太さと種類。
    drawn: annots.added.filter((entry) => entry.lineWidth !== undefined).map((entry) => ({ src: entry.src, kind: entry.kind, color: entry.color, lineWidth: entry.lineWidth, rect: entry.rect.map(round), points: entry.paths ? entry.paths[0].length : null })),
    importedShapes: importedEntries.filter((entry) => entry.lineWidth !== undefined).map((entry) => ({ ref: entry.ref, src: entry.src, kind: entry.kind, color: entry.color, lineWidth: entry.lineWidth, rect: entry.rect.map(round), points: entry.paths ? entry.paths[0].length : null })),
    shapeGroups: [...document.querySelectorAll('.annot-layer')].map((svg) => svg.querySelectorAll('g.shape').length),
    propsWidth: document.getElementById('props-width').value,
    propsWidthVisible: document.getElementById('props-width-row').hidden === false,
    // 道具の段（spec-4b-1a 確定事項1〜6・39）。見えているか・ボタンの数・押している道具（図形は種類）。
    editBar: {
      visible: getComputedStyle(document.getElementById('edit-bar')).display !== 'none',
      buttons: document.querySelectorAll('#edit-bar .edit-tool').length,
      pressed: [...document.querySelectorAll('#edit-bar .edit-tool.active')].map((el) => el.dataset.shape ?? el.dataset.tool),
    },
    // ノート・不透明度・一覧（spec-4-4 の完了判定）。置いたもの、読み込んだもの（表示のみを含む）、一覧の行、右パネル。
    notes: annots.added.filter((entry) => entry.kind === 'note').map((entry) => ({ src: entry.src, text: entry.text, author: entry.author, color: entry.color, opacity: entry.opacity, rect: entry.rect.map(round) })),
    importedNotes: importedEntries.filter((entry) => entry.kind === 'note').map((entry) => ({ ref: entry.ref, src: entry.src, text: entry.text, author: entry.author, color: entry.color, rect: entry.rect.map(round) })),
    readonly: importedEntries.filter((entry) => entry.readonly === true).map((entry) => ({ ref: entry.ref, src: entry.src, subtype: entry.subtype })),
    opacities: annots.added.map((entry) => entry.opacity),
    noteGroups: [...document.querySelectorAll('.annot-layer')].map((svg) => svg.querySelectorAll('g[data-kind="note"] g.note').length),
    listRows: [...document.querySelectorAll('#annot-rows .annot-row')].map((row) => [row.dataset.key, row.querySelector('.pg').textContent, row.querySelector('.tx').textContent, row.classList.contains('on'), row.classList.contains('readonly')]),
    listVisible: document.getElementById('annot-list').hidden === false,
    // 編集モードの左に出しているもの（spec-4b-1a 確定事項15〜17・39）と、描いたサムネイルの数。
    sideView: SigK.shell.getEditSide(),
    // 読み込んだものの見た目（spec-4b-1a 確定事項24〜27・39）。不透明度・線幅・表示のみの見分けと、参照の形。
    importedStyles: importedEntries.map((entry) => ({ ref: entry.ref, src: entry.src, kind: entry.kind, subtype: entry.subtype ?? null, color: entry.color, opacity: entry.opacity, lineWidth: entry.lineWidth ?? null, readonly: entry.readonly === true })),
    // 最後に辞書の読み戻しの口を呼んだ様子（呼んだか・頼んだ件数・答えの件数・ms・理由）。
    details: SigK.annotationDetails.lastRequest(),
    // 見た目（spec-4b-1b の完了判定 2〜7）。描いたもの・読み込んだものの線・塗り・線種・破線の倍数・雲形の強さ・太さ・不透明度。
    styles: annots.added.filter((entry) => entry.lineWidth !== undefined).map((entry) => ({ id: entry.id, kind: entry.kind, color: entry.color, fill: entry.fill ?? null, lineStyle: entry.lineStyle ?? 'solid', dash: entry.dash ?? null, cloudIntensity: entry.cloudIntensity ?? null, lineWidth: entry.lineWidth, opacity: entry.opacity, rect: entry.rect.map(round), angle: entry.angle ?? 0 })),
    importedLooks: importedEntries.filter((entry) => entry.lineWidth !== undefined || entry.readonly === true).map((entry) => ({ ref: entry.ref, kind: entry.kind, subtype: entry.subtype ?? null, color: entry.color, fill: entry.fill ?? null, lineStyle: entry.lineStyle ?? 'solid', dash: entry.dash ?? null, cloudIntensity: entry.cloudIntensity ?? null, lineWidth: entry.lineWidth ?? null, opacity: entry.opacity, readonly: entry.readonly === true, rect: entry.rect.map(round), angle: entry.angle ?? 0 })),
    // 大きさと向き（spec-4b-2 の起動確認。smoke-annotate-transform.js の TRANSFORM_REPORT）。
    transform: transformReport,
    // 選択と複数選択（spec-4b-3a の起動確認。smoke-annotate-select.js の SELECT_REPORT）。
    selection: selectReport,
    // 右パネルの見た目の行（出している行・色の行の見出し・チップの値・押している線種・太さと不透明度・ヒント）。
    propsRows: {
      shown: ['color', 'fill', 'style', 'width', 'size', 'opacity'].filter((row) => !document.getElementById('props-' + row + '-row').hidden),
      colorLabel: document.getElementById('props-color-label').textContent,
      color: document.getElementById('props-color-name').textContent,
      fill: document.getElementById('props-fill-name').textContent,
      style: [...document.querySelectorAll('#props-style button.on')].map((button) => button.dataset.style),
      width: document.getElementById('props-width').value,
      opacity: document.getElementById('props-opacity').value,
      hint: document.getElementById('props-hint').textContent,
    },
    // パレットの窓（開いているか・見出し・印の付いた色・色の数・［なし］・位置と、右パネルの左端）。
    popover: (() => {
      const pop = document.getElementById('color-pop');
      const box = pop.getBoundingClientRect();
      const none = pop.querySelector('.foot .none');
      return {
        open: !pop.hidden, title: pop.querySelector('.ttl')?.textContent ?? null, marked: [...pop.querySelectorAll('.cell.on')].map((cell) => cell.dataset.color),
        cells: pop.querySelectorAll('.cell').length, none: none === null ? null : { hidden: none.hidden, label: none.textContent, disabled: none.getAttribute('aria-disabled') === 'true' },
        box: { left: round(box.left), top: round(box.top), width: round(box.width), height: round(box.height) }, propsLeft: round(document.getElementById('props').getBoundingClientRect().left),
      };
    })(),
    // 編集モードへ入る前と後の倍率と表示域（spec-4b-1a 確定事項19・39）。
    zoom: { before: zoomBefore, after: zoomAfter },
    sideThumbs: document.querySelectorAll('#thumbs .thumb').length,
    propsContents: document.getElementById('props-contents').value,
    propsContentsVisible: document.getElementById('props-contents-row').hidden === false,
    propsAuthor: document.getElementById('props-author').value,
    propsAuthorVisible: document.getElementById('props-author-row').hidden === false,
    propsOpacity: document.getElementById('props-opacity').value,
    propsOpacityVisible: document.getElementById('props-opacity-row').hidden === false,
    drafts: document.querySelectorAll('.annot-draft').length,
    frames: document.querySelectorAll('.annot-frame').length,
    propsKind: document.getElementById('props-kind').textContent,
    propsVisible: getComputedStyle(document.getElementById('props')).display !== 'none',
    railItems: [...document.querySelectorAll('#rail .lbl')].map((el) => el.textContent),
    banner: SigK.viewBanner.text(),
    save: saveResult,
    alignment,
  };
`;

module.exports = { REPORT };
