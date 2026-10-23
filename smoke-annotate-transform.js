'use strict';

// 起動確認の大きさと向きの操作と結果の欄（spec-4b-2 の起動確認）。smoke-annotate.js が annotateScript に埋める。
//
// TRANSFORM_STEPS は smoke-annotate-steps.js の分岐の続き（else if の並び）で、埋め込む先のスクリプトにある
// SigK・name・arg・wait・pageNode・mouse を使う。操作は次のもの。
//   grab:x2y2:40x-20        選んでいる書き込みのつまみ（x1y1・x2y1・x1y2・x2y2・x1・x2・y1・y2・rotate・start・end、テキストの幅の left・right）を、
//                           表示の px で (40,-20) だけ引く（grab:x2y2:40x-20:shift で Shift を押したまま）。紙の外の
//                           つまみは #view で押す
//   angle:45                右パネルの回転の行の数値欄に打って Enter で確定する
//   angle-preset:90         回転の行の 0°・90°・180°・270° のボタンを押す
//   hover:0:125x700         紙の pt の点の上へマウスを動かし、道具・data-transform-cursor・その点の要素のカーソル（Chromium が
//                           計算した cursor）を window.__sigkSmokeHovers に控える（決定84 ①）
//   drag-at:0:125x700-145x700  今の道具のまま、紙の pt の点から点へ左でドラッグする（決定84 ④）
// TRANSFORM_REPORT は結果の transform の欄（選んでいる書き込みの形・出ているつまみ・紙の外のつまみ・回転の行・hover の控え）を組む文。
// 文字列の中には ` と ${ を書かない（テンプレートの中に埋めるため）。

const TRANSFORM_STEPS = `
    else if (name === 'grab') {
      const [id, delta, modifier] = arg.split(':');
      const [dx, dy] = delta.split('x').map(Number);
      const shown = SigK.annotationFrame.shown();
      const handle = shown?.shape?.handles.find((item) => item.id === id);
      if (handle) {
        const node = pageNode(shown.index);
        const base = node.getBoundingClientRect();
        const [sx, sy] = [base.left + handle.at[0], base.top + handle.at[1]];
        const shift = modifier === 'shift';
        const fire = (type, target, x, y) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, shiftKey: shift }));
        fire('mousedown', document.getElementById('view'), sx, sy);
        fire('mousemove', document.body, sx + dx / 2, sy + dy / 2);
        fire('mousemove', document.body, sx + dx, sy + dy);
        fire('mouseup', document.getElementById('view'), sx + dx, sy + dy);
      }
    } else if (name === 'angle') {
      const field = document.getElementById('props-angle');
      field.value = arg;
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    } else if (name === 'angle-preset') {
      document.querySelector('#props-angle-presets button[data-angle="' + arg + '"]')?.click();
    } else if (name === 'hover') {
      const [page, point] = arg.split(':');
      const [x, y] = point.split('x').map(Number);
      const [sx, sy] = screenPoint(Number(page), x, y);
      const target = document.elementFromPoint(sx, sy) ?? pageNode(Number(page));
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, buttons: 0 }));
      window.__sigkSmokeHovers = (window.__sigkSmokeHovers ?? []).concat([{
        at: arg, tool: SigK.annotate.getTool(), attr: document.documentElement.getAttribute('data-transform-cursor'), cursor: getComputedStyle(target).cursor,
      }]);
    } else if (name === 'drag-at') {
      const [page, span] = arg.split(':');
      const [from, to] = span.split('-').map((point) => point.split('x').map(Number));
      const [sx, sy] = screenPoint(Number(page), from[0], from[1]);
      const [ex, ey] = screenPoint(Number(page), to[0], to[1]);
      const target = document.elementFromPoint(sx, sy) ?? pageNode(Number(page));
      const fire = (type, node, px, py, buttons) => node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: px, clientY: py, button: 0, buttons }));
      fire('mousedown', target, sx, sy, 1);
      fire('mousemove', document.body, (sx + ex) / 2, (sy + ey) / 2, 1);
      fire('mousemove', document.body, ex, ey, 1);
      fire('mouseup', document.elementFromPoint(ex, ey) ?? target, ex, ey, 0);
      await wait(150);
    }
`;

const TRANSFORM_REPORT = `
  const transformReport = (() => {
    const shown = SigK.annotationFrame.shown();
    const entry = SigK.annotate.selectedEntry();
    const node = shown ? pageNode(shown.index) : null;
    const width = node ? node.clientWidth : 0;
    const height = node ? node.clientHeight : 0;
    const handles = shown?.shape?.handles ?? [];
    return {
      selected: entry === null ? null : { kind: entry.kind, rect: entry.rect.map(round), angle: entry.angle ?? 0, paths: entry.paths ?? null, readonly: entry.readonly === true },
      handles: handles.map((handle) => handle.id),
      handlesOutside: handles.filter((handle) => handle.at[0] < 0 || handle.at[1] < 0 || handle.at[0] > width || handle.at[1] > height).map((handle) => handle.id),
      frameLayer: document.querySelector('.annot-frame-layer') !== null && document.querySelector('.annot-frame-layer').parentNode === document.getElementById('view-pages'),
      angleRow: { visible: document.getElementById('props-angle-row').hidden === false, value: document.getElementById('props-angle').value, on: [...document.querySelectorAll('#props-angle-presets button.on')].map((button) => button.dataset.angle) },
      cursor: document.documentElement.getAttribute('data-transform-cursor'),
      hovers: window.__sigkSmokeHovers ?? [],
    };
  })();
`;

module.exports = { TRANSFORM_STEPS, TRANSFORM_REPORT };
