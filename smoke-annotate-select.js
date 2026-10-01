'use strict';

// 起動確認の選択と複数選択の操作と結果の欄（spec-4b-3a の起動確認。確定事項N）と、ハンドと右ボタンの操作と結果の欄
// （spec-4b-3b 確定事項H）。smoke-annotate.js が annotateScript に埋める。
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
//   pan:0x-200                    ハンドで、表示の真ん中から表示の px で (0,-200) だけ引く（spec-4b-3b）
//   context:0:150x650             紙の pt の点で右を押して離し、contextmenu を投げる
//   menu:delete                   右クリックのメニューの項目を押す
//   chord:0:100x700-200x600       左で押して途中まで動かし、右を押して離し（contextmenu も）、さらに動かしてから左を離す
//   wheel:0:300x400:+1            紙の pt の点でホイールを 1 目盛り回す（+1 は上＝拡大、-1 は下＝縮小）。:ctrl で Ctrl を押したまま
// 道具は bar:select・bar:hand で持つ（smoke-annotate-steps.js の bar）。引く前後のスクロール量・回す前後の倍率と、マウスの下の
// 紙の点のずれ（anchorDrift。ページの枠の割合で測るので、描き直しを待たない）は window.__sigkSmokeHand に控える。
// SELECT_REPORT は結果の selection の欄（選択・枠・つまみ・一覧・残骸・右パネル・メニュー・道具・スクロール・倍率）を組む文。
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
    } else if (name === 'pan') {
      const [dx, dy] = arg.split('x').map(Number);
      const view = document.getElementById('view');
      const box = view.getBoundingClientRect();
      const cx = box.left + view.clientWidth / 2;
      const cy = box.top + view.clientHeight / 2;
      const target = document.elementFromPoint(cx, cy) ?? view;
      const hand = (window.__sigkSmokeHand = window.__sigkSmokeHand ?? {});
      hand.scroll = { before: [view.scrollLeft, view.scrollTop] };
      const fire = (type, node, x, y, buttons) => node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
      fire('mousedown', target, cx, cy, 1);
      hand.panning = document.documentElement.hasAttribute('data-panning');
      fire('mousemove', document.body, cx + dx / 2, cy + dy / 2, 1);
      fire('mousemove', document.body, cx + dx, cy + dy, 1);
      fire('mouseup', target, cx + dx, cy + dy, 0);
      hand.scroll.after = [view.scrollLeft, view.scrollTop];
      await wait(300);
    } else if (name === 'context') {
      const [page, point] = arg.split(':');
      const [x, y] = point.split('x').map(Number);
      const [sx, sy] = screenPoint(Number(page), x, y);
      const node = pageNode(Number(page));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 2, buttons: 2 }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 2, buttons: 0 }));
      node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 2 }));
      await wait(150);
      // 右クリックの直後のメニューの状態（結果の欄は最後の状態しか見ないので、ここで控える）。
      const box = document.getElementById('annot-menu').getBoundingClientRect();
      const hand = (window.__sigkSmokeHand = window.__sigkSmokeHand ?? {});
      hand.contexts = (hand.contexts ?? []).concat([{
        at: [round(sx), round(sy)],
        open: SigK.annotationMenu.isOpen(),
        pos: [round(box.left), round(box.top)],
        inside: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
        tool: SigK.annotate.getTool(),
        selected: SigK.annotate.getSelection().length,
      }]);
    } else if (name === 'menu') {
      document.querySelector('#annot-menu [data-action="' + arg + '"]')?.click();
    } else if (name === 'chord') {
      const [page, span] = arg.split(':');
      const [from, to] = span.split('-').map((point) => point.split('x').map(Number));
      const [sx, sy] = screenPoint(Number(page), from[0], from[1]);
      const [ex, ey] = screenPoint(Number(page), to[0], to[1]);
      const node = pageNode(Number(page));
      const fire = (type, target, x, y, button, buttons) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons }));
      fire('mousedown', node, sx, sy, 0, 1);
      fire('mousemove', document.body, (sx + ex) / 2, (sy + ey) / 2, 0, 1);
      fire('mousemove', document.body, ex, ey, 0, 1);
      const hand = (window.__sigkSmokeHand = window.__sigkSmokeHand ?? {});
      const chord = { toolBefore: SigK.annotate.getTool(), drawing: SigK.annotatePointer.isDrawing(), dragging: SigK.annotatePointer.isDragging() };
      fire('mousedown', node, ex, ey, 2, 3);
      chord.chording = SigK.annotateRightButton.isChording();
      chord.drawingAfter = SigK.annotatePointer.isDrawing();
      chord.toolAfter = SigK.annotate.getTool();
      fire('mouseup', node, ex, ey, 2, 1);
      node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ex, clientY: ey, button: 2 }));
      fire('mousemove', document.body, ex + 20, ey + 20, 0, 1);
      fire('mouseup', node, ex + 20, ey + 20, 0, 0);
      chord.chordUntilUp = SigK.annotateRightButton.isChording();
      hand.chords = (hand.chords ?? []).concat([chord]);
      await wait(150);
    } else if (name === 'wheel') {
      const [page, point, direction, modifier] = arg.split(':');
      const [x, y] = point.split('x').map(Number);
      const [sx, sy] = screenPoint(Number(page), x, y);
      const node = pageNode(Number(page));
      const box = node.getBoundingClientRect();
      const fx = (sx - box.left) / box.width;
      const fy = (sy - box.top) / box.height;
      const before = SigK.viewer.getState().zoom;
      node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, deltaY: Number(direction) > 0 ? -100 : 100, deltaMode: 0, ctrlKey: modifier === 'ctrl' }));
      const moved = pageNode(Number(page)).getBoundingClientRect();
      const hand = (window.__sigkSmokeHand = window.__sigkSmokeHand ?? {});
      const view = document.getElementById('view');
      hand.zooms = (hand.zooms ?? []).concat([{
        before: round(before),
        after: round(SigK.viewer.getState().zoom),
        anchorDrift: [round(moved.left + fx * moved.width - sx), round(moved.top + fy * moved.height - sy)],
        // 紙の幅が表示域より狭いと横は中央寄せになり、横のずれは避けられない（確定事項C4 の「寄せられるところまで」）。
        wider: view.scrollWidth > view.clientWidth,
      }]);
      await wait(400);
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
      // ハンドと右ボタン（spec-4b-3b 確定事項H）。
      tools: { tool: SigK.annotate.getTool(), base: SigK.annotateTools.getBase() },
      menu: (() => {
        const el = document.getElementById('annot-menu');
        const box = el.getBoundingClientRect();
        return {
          open: SigK.annotationMenu.isOpen(),
          items: [...el.querySelectorAll('[role="menuitem"] .label')].map((node) => node.textContent),
          pos: [round(box.left), round(box.top)],
          inside: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
        };
      })(),
      hand: window.__sigkSmokeHand ?? null,
      panning: document.documentElement.hasAttribute('data-panning'),
      chordUntilUp: SigK.annotateRightButton.isChording(),
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
