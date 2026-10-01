'use strict';

// 起動確認の選択と複数選択の操作と結果の欄（spec-4b-3a の起動確認。確定事項N）。smoke-annotate.js が annotateScript に埋める。
//
// SELECT_STEPS は smoke-annotate-steps.js の分岐の続き（else if の並び）で、埋め込む先のスクリプトにある
// SigK・name・arg・wait・pageNode・screenPoint を使う。操作は次のもの（座標は紙の pt）。
//   ctrl-click:0:150x700          Ctrl を押したまま、その点を押して離す
//   marquee:0:80x720-420x580      「選択」の道具で、その範囲を引く（:add を付けると Shift を押して始める＝足す）
//   move:20x0                     主を掴んで、選んでいる全部を紙の pt で (20,0) だけ動かす。:shift は Shift を押したまま、
//                                 :ctrl は Ctrl を押したまま（写し）、:ctrl-late は途中で Ctrl を押す、:ctrl-off は Ctrl で
//                                 始めて途中で離す
//   list-ctrl:2・list-shift:3      注釈一覧の 2 行目を Ctrl／3 行目を Shift で押す
//   key:Backspace                 そのキーを投げる
// 道具は bar:select で持つ（smoke-annotate-steps.js の bar）。
// SELECT_REPORT は結果の selection の欄（選択・枠・つまみ・一覧・残骸・右パネル）を組む文。
// 文字列の中には ` と ${ を書かない（テンプレートの中に埋めるため）。

const SELECT_STEPS = `
    else if (name === 'ctrl-click') {
      const [page, point] = arg.split(':');
      const [x, y] = point.split('x').map(Number);
      const [sx, sy] = screenPoint(Number(page), x, y);
      for (const type of ['mousedown', 'mouseup'])
        pageNode(Number(page)).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: sx, clientY: sy, ctrlKey: true }));
    } else if (name === 'marquee') {
      const [page, span, mode] = arg.split(':');
      const [from, to] = span.split('-').map((point) => point.split('x').map(Number));
      if (SigK.annotate.getTool() !== 'select')
        SigK.annotate.setTool('select');
      const [sx, sy] = screenPoint(Number(page), from[0], from[1]);
      const [ex, ey] = screenPoint(Number(page), to[0], to[1]);
      const shiftKey = mode === 'add';
      const fire = (type, target, x, y) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, shiftKey }));
      fire('mousedown', pageNode(Number(page)), sx, sy);
      fire('mousemove', document.body, (sx + ex) / 2, (sy + ey) / 2);
      fire('mousemove', document.body, ex, ey);
      fire('mouseup', pageNode(Number(page)), ex, ey);
    } else if (name === 'move') {
      const [delta, mode] = arg.split(':');
      const [dx, dy] = delta.split('x').map(Number);
      const entry = SigK.annotate.primaryEntry();
      const index = SigK.viewer.getPlan().findIndex((page) => page.src === entry.src);
      // 掴むのは箱の真ん中（四角・丸の内側。直線・矢印・ペンは最初の点）。つまみは四隅と辺の中点なので外れる。
      const at = entry.paths ? entry.paths[0][0] : [(entry.rect[0] + entry.rect[2]) / 2, (entry.rect[1] + entry.rect[3]) / 2];
      const [sx, sy] = screenPoint(index, at[0], at[1]);
      const [ex, ey] = screenPoint(index, at[0] + dx, at[1] + dy);
      const startCtrl = mode === 'ctrl' || mode === 'ctrl-off';
      const endCtrl = mode === 'ctrl' || mode === 'ctrl-late';
      const shiftKey = mode === 'shift';
      const fire = (type, target, x, y, ctrlKey) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ctrlKey, shiftKey }));
      fire('mousedown', pageNode(index), sx, sy, startCtrl);
      fire('mousemove', document.body, (sx + ex) / 2, (sy + ey) / 2, startCtrl);
      if (mode === 'ctrl-late')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }));
      if (mode === 'ctrl-off')
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
      fire('mousemove', document.body, ex, ey, endCtrl);
      fire('mouseup', pageNode(index), ex, ey, endCtrl);
    } else if (name === 'list-ctrl' || name === 'list-shift') {
      if (SigK.shell.getEditSide() !== 'list') {
        document.querySelector('#side-switch button[data-side="list"]').click();
        await wait(200);
      }
      const row = document.querySelectorAll('#annot-rows .annot-row')[Number(arg) - 1];
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: name === 'list-ctrl', shiftKey: name === 'list-shift' }));
      await wait(300);
    } else if (name === 'key') {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: arg, bubbles: true, cancelable: true }));
    }
`;

const SELECT_REPORT = `
  const selectReport = (() => {
    const keys = SigK.annotate.getSelection();
    const primary = SigK.annotate.primaryEntry();
    const shownRows = ['color', 'fill', 'style', 'width', 'opacity', 'angle', 'size', 'page', 'text']
      .filter((row) => document.getElementById('props-' + row + '-row')?.hidden === false);
    return {
      keys,
      sole: SigK.annotate.getSelected(),
      primary: SigK.annotate.primaryKey(),
      page: primary === null ? null : primary.src + 1,
      kinds: SigK.annotate.selectedEntries().map((entry) => entry.kind),
      tool: SigK.annotate.getTool(),
      frames: document.querySelectorAll('.annot-frame-layer .annot-frame-group').length,
      handles: document.querySelectorAll('.annot-frame-layer .annot-handle').length,
      listOn: [...document.querySelectorAll('#annot-rows .annot-row.on')].map((row) => row.dataset.key),
      marquee: document.querySelectorAll('.annot-marquee').length,
      ghosts: document.querySelectorAll('.annot-ghost').length,
      cursor: document.documentElement.getAttribute('data-transform-cursor'),
      propsMulti: {
        title: document.getElementById('props-kind').textContent,
        rows: shownRows,
        mixed: ['color', 'fill'].filter((row) => shownRows.includes(row) && document.getElementById('props-' + row + '-name')?.textContent === '混在'),
        width: { value: document.getElementById('props-width').value, placeholder: document.getElementById('props-width').placeholder },
        hint: document.getElementById('props-hint').textContent,
      },
    };
  })();
`;

module.exports = { SELECT_STEPS, SELECT_REPORT };
