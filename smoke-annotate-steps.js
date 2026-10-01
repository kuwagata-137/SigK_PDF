'use strict';

// 起動確認の注釈の経路の、操作ごとの分岐（smoke-annotate.js の annotateScript のループに埋める文）。
// 2,000 行を超えた main.js から移した（spec-4b-1a 確定事項36。中身は変えていない）。操作の一覧は smoke-annotate.js の冒頭にある。
//
// 埋め込む先のスクリプトにある SigK・name・arg・wait・round・pageNode・viewportOf・screenPoint・mouse・
// typeAndCommit・typeContents・saveResult を使う。

const STEPS = `
    if (name === 'page') {
      SigK.viewer.goToPage(Number(arg) - 1);
      await wait(500);
    } else if (name === 'select') {
      const [page, range] = arg.split(':');
      const [from, to] = range.split('-').map(Number);
      // テキストレイヤーが貼られるまで待つ（描画は非同期）。
      let spans = [];
      for (let tries = 0; tries < 40 && spans.length <= to; tries += 1) {
        spans = [...(pageNode(Number(page))?.querySelectorAll('.textLayer span') ?? [])];
        if (spans.length <= to)
          await wait(100);
      }
      const r = document.createRange();
      r.setStart(spans[from].firstChild, 0);
      r.setEnd(spans[to].firstChild, spans[to].textContent.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } else if (name === 'highlight' || name === 'underline' || name === 'strikeout') {
      SigK.annotate.toggleTool(name);
    } else if (name === 'color') {
      SigK.annotate.setColor(arg);
    } else if (name === 'click') {
      const [page, point] = arg.split(':');
      const [x, y] = point.split('x').map(Number);
      const [sx, sy] = screenPoint(Number(page), x, y);
      for (const type of ['mousedown', 'mouseup'])
        mouse(type, pageNode(Number(page)), sx, sy);
    } else if (name === 'tool') {
      SigK.annotate.setTool(arg === '' ? null : arg);
    } else if (name === 'text' || name === 'draft') {
      const [page, point, ...words] = arg.split(':');
      const [x, y] = point.split('x').map(Number);
      SigK.annotate.setTool('text');
      const [sx, sy] = screenPoint(Number(page), x, y);
      for (const type of ['mousedown', 'mouseup'])
        mouse(type, pageNode(Number(page)), sx, sy);
      await wait(150);
      await typeAndCommit(words.join(':'), { commit: name === 'text' });
    } else if (name === 'edit') {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await wait(150);
      await typeAndCommit(arg);
    } else if (name === 'size') {
      SigK.annotate.setFontSize(Number(arg));
    } else if (name === 'width') {
      SigK.annotate.setLineWidth(Number(arg));
    } else if (name === 'note') {
      const [page, point, ...words] = arg.split(':');
      const [x, y] = point.split('x').map(Number);
      SigK.annotate.setTool('note');
      const [sx, sy] = screenPoint(Number(page), x, y);
      for (const type of ['mousedown', 'mouseup'])
        mouse(type, pageNode(Number(page)), sx, sy);
      await wait(150);
      if (words.length > 0)
        await typeContents(words.join(':'));
    } else if (name === 'contents') {
      await typeContents(arg);
    } else if (name === 'opacity') {
      SigK.annotate.setOpacity(Number(arg) / 100);
    } else if (name === 'author') {
      const field = document.getElementById('props-author');
      field.value = arg;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (name === 'list') {
      // 編集モードの左は既定でサムネイル（spec-4b-1a 確定事項17）。一覧を出してから押す。
      if (SigK.shell.getEditSide() !== 'list') {
        document.querySelector('#side-switch button[data-side="list"]').click();
        await wait(200);
      }
      const row = document.querySelectorAll('#annot-rows .annot-row')[Number(arg) - 1];
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await wait(500);
    } else if (name === 'shape') {
      const [kind, page, span] = arg.split(':');
      const [from, to] = span.split('-').map((point) => point.split('x').map(Number));
      SigK.annotate.setTool('shape');
      SigK.annotate.setShapeKind(kind);
      const [sx, sy] = screenPoint(Number(page), from[0], from[1]);
      const [ex, ey] = screenPoint(Number(page), to[0], to[1]);
      mouse('mousedown', pageNode(Number(page)), sx, sy);
      mouse('mousemove', document.body, (sx + ex) / 2, (sy + ey) / 2);
      mouse('mousemove', document.body, ex, ey);
      mouse('mouseup', pageNode(Number(page)), ex, ey);
    } else if (name === 'pen') {
      const [page, points] = arg.split(':');
      const path = points.split(';').map((point) => point.split('x').map(Number));
      SigK.annotate.setTool('pen');
      const screen = path.map(([x, y]) => screenPoint(Number(page), x, y));
      mouse('mousedown', pageNode(Number(page)), screen[0][0], screen[0][1]);
      for (const [x, y] of screen.slice(1))
        mouse('mousemove', document.body, x, y);
      mouse('mouseup', pageNode(Number(page)), screen.at(-1)[0], screen.at(-1)[1]);
    } else if (name === 'drag') {
      const [dx, dy] = arg.split('x').map(Number);
      const entry = SigK.annotate.primaryEntry();
      const index = SigK.viewer.getPlan().findIndex((page) => page.src === entry.src);
      const scale = viewportOf(index).scale;
      let grab;
      if (entry.kind === 'text') {
        // 箱の左上から少し内側を掴む。
        const [ox, oy] = SigK.freeTextGeometry.frameOrigin(entry.rect, entry.rotation);
        const [sx, sy] = screenPoint(index, ox, oy);
        grab = [sx + 3 * scale, sy + 3 * scale];
      } else if (entry.kind === 'note') {
        // 付箋は画面の箱の真ん中を掴む（倍率に依らず一定の大きさ。spec-4-4 確定事項11）。
        const box = SigK.noteGraphics.boxOf(entry, viewportOf(index));
        const base = pageNode(index).getBoundingClientRect();
        grab = [base.left + box.x + box.width / 2, base.top + box.y + box.height / 2];
      } else {
        // 図形は線の上（矩形・楕円は箱の内側でよい。直線・矢印・ペンは最初の点）を掴む。
        const at = entry.paths ? entry.paths[0][0] : [(entry.rect[0] + entry.rect[2]) / 2, (entry.rect[1] + entry.rect[3]) / 2];
        grab = screenPoint(index, at[0], at[1]);
      }
      const [ox, oy] = viewportOf(index).convertToPdfPoint(grab[0] - pageNode(index).getBoundingClientRect().left, grab[1] - pageNode(index).getBoundingClientRect().top);
      const [ex, ey] = screenPoint(index, ox + dx, oy + dy);
      mouse('mousedown', pageNode(index), grab[0], grab[1]);
      mouse('mousemove', document.body, ex, ey);
      mouse('mouseup', pageNode(index), ex, ey);
    } else if (name === 'rotate') {
      SigK.pageEdit.rotate(90, [Number(arg)]);
      await wait(300);
    } else if (name === 'delete') {
      SigK.annotate.remove();
    } else if (name === 'esc') {
      SigK.annotate.escape();
    } else if (name === 'undo') {
      SigK.pageEdit.undo();
    } else if (name === 'redo') {
      SigK.pageEdit.redo();
    } else if (name === 'bar') {
      // 道具の段のボタン（spec-4b-1a 確定事項1〜5）。図形は種類で、ほかは道具の名前で引く。
      const shapes = ['arrow', 'line', 'square', 'circle'];
      const selector = shapes.includes(arg) ? '#edit-bar .edit-tool[data-shape="' + arg + '"]' : '#edit-bar .edit-tool[data-tool="' + arg + '"]:not([data-shape])';
      document.querySelector(selector)?.click();
    } else if (name === 'side') {
      document.querySelector('#side-switch button[data-side="' + arg + '"]')?.click();
      await wait(300);
    } else if (name === 'wait-details') {
      // 読み込み（辞書の読み戻しを含む。spec-4b-1a 確定事項30）が終わり、映し終えるまで待つ。
      await SigK.annotationImport.settled();
      await wait(300);
    } else if (name === 'save') {
      const started = performance.now();
      saveResult = await SigK.save.saveActive();
      saveResult.ms = round(performance.now() - started);
      await wait(800);
    }
`;

module.exports = { STEPS };
