'use strict';

// 起動確認 SIGK_SMOKE_KEYS の画面側の式（spec-4b-7a 確定事項J）。smoke-keys.js が executeJavaScript で流す。
// どれも即時関数の式で、JSON にできる値を返す。紙の座標（pt）は、起動確認の annotate と同じく pdf.js の viewport で画面の座標にする。

const PAGE_HELPERS = `
  const SigK = window.SigK;
  const pageNode = (index) => document.querySelector('.pdf-page[data-page="' + (index + 1) + '"]');
  const viewportOf = (index) => SigK.freeTextEditor.pageOf(index)?.viewport ?? SigK.viewer.getTextLayer(index)?.viewport;
  const screenPoint = (index, x, y) => {
    const base = pageNode(index).getBoundingClientRect();
    const [cx, cy] = viewportOf(index).convertToViewportPoint(x, y);
    return [Math.round(base.left + cx), Math.round(base.top + cy)];
  };`;

// 紙の座標 pt を画面の座標 [x, y] にする。
function pointScript(page, x, y) {
  return `(() => {${PAGE_HELPERS}
  return screenPoint(${Number(page)}, ${Number(x)}, ${Number(y)});
})()`;
}

// 要素の箱 { left, top, width, height }。無ければ null。
function boxScript(id) {
  return `(() => {
  const node = document.getElementById(${JSON.stringify(String(id))});
  if (node === null)
    return null;
  node.scrollIntoView({ block: 'center' });
  const box = node.getBoundingClientRect();
  return { left: box.left, top: box.top, width: box.width, height: box.height };
})()`;
}

// サムネイルの中心 [x, y]（ページ編集モード）。
function thumbScript(index) {
  return `(() => {
  const node = document.querySelectorAll('#thumbs .thumb')[${Number(index)}];
  if (node === undefined)
    return null;
  const box = node.getBoundingClientRect();
  return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)];
})()`;
}

// 図形を合成のマウスで描く（起動確認の annotate の shape と同じ）。
function shapeScript(kind, page, from, to) {
  return `(async () => {${PAGE_HELPERS}
  const mouse = (type, target, [x, y]) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === 'mouseup' ? 0 : 1 }));
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind(${JSON.stringify(String(kind))});
  const start = screenPoint(${Number(page)}, ${Number(from[0])}, ${Number(from[1])});
  const end = screenPoint(${Number(page)}, ${Number(to[0])}, ${Number(to[1])});
  mouse('mousedown', pageNode(${Number(page)}), start);
  mouse('mousemove', document.body, end);
  mouse('mouseup', pageNode(${Number(page)}), end);
  await new Promise((resolve) => setTimeout(resolve, 200));
  return SigK.viewer.getAnnotations().added.length;
})()`;
}

// 画面の操作。name は smoke-keys.js の操作の名前、arg はその引数（文字列）。
const ACTIONS = {
  mode: (arg) => `SigK.shell.setMode(document, ${JSON.stringify(arg)})`,
  tool: (arg) => `SigK.annotate.setTool(${arg === 'none' ? 'null' : JSON.stringify(arg)})`,
  find: (arg) => `(SigK.findBar.open(), (() => { const input = document.getElementById('find-input'); input.value = ${JSON.stringify(arg)}; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); })())`,
  dialog: (arg) => (arg === 'print' ? 'SigK.print.open()' : 'SigK.docInfo.open(document)'),
  'print-prepare': () => `(window.__smokeKeysPrint = 'pending', SigK.print.prepare({ mode: 'all' }).then((r) => { window.__smokeKeysPrint = { ok: r.ok === true, canceled: r.canceled === true, pages: r.pages?.length ?? null }; }), true)`,
  focus: (arg) => (arg === 'none' ? 'document.activeElement?.blur()' : `document.getElementById(${JSON.stringify(arg)})?.focus()`),
  'select-pages': (arg) => {
    const [a, b] = arg.split('-').map(Number);
    return `SigK.pageGrid.setSelection(Array.from({ length: ${b - a + 1} }, (_, i) => ${a} + i))`;
  },
  'select-text': (arg) => `(() => { const span = document.querySelector('.pdf-page[data-page="${Number(arg) + 1}"] .textLayer span'); if (span === null) return false; const range = document.createRange(); range.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(range); return true; })()`,
  zoom: (arg) => `SigK.viewer.setZoom(${Number(arg)})`,
  facing: (arg) => `SigK.shell.setPageLayout(document, ${JSON.stringify(arg === 'on' ? 'facing' : 'single')})`,
  fit: (arg) => `SigK.viewer.applyFit(${JSON.stringify(arg)})`,
  scroll: (arg) => `(() => { const view = document.getElementById('view'); view.scrollTop = Math.round((view.scrollHeight - view.clientHeight) * ${Number(arg)}); return view.scrollTop; })()`,
};

function actionScript(name, arg) {
  const body = ACTIONS[name]?.(String(arg ?? ''));
  return body === undefined ? null : `(async () => { const SigK = window.SigK; const value = await (${body}); return value === undefined ? null : value; })()`;
}

// 様子を控える（state）。
const stateScript = `(() => {
  const SigK = window.SigK;
  const view = document.getElementById('view');
  const viewBox = view.getBoundingClientRect();
  const pages = [...document.querySelectorAll('.pdf-page')];
  const visible = pages.filter((page) => { const box = page.getBoundingClientRect(); return box.height > 0 && box.bottom > viewBox.top && box.top < viewBox.bottom; });
  const value = (id) => document.getElementById(id)?.value ?? null;
  const selection = window.getSelection();
  const state = SigK.viewer.getState();
  return {
    dialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.id),
    find: SigK.findBar.isOpen(),
    focus: document.activeElement?.id || document.activeElement?.tagName || null,
    mode: document.documentElement.getAttribute('data-mode'),
    tool: SigK.annotate.getTool(),
    annotSelected: SigK.annotate.getSelection().length,
    annotCount: SigK.viewer.getAnnotations().added.length,
    annotRects: SigK.viewer.getAnnotations().added.slice(0, 3).map((entry) => (entry.rect ?? []).map((value) => Math.round(value))),
    drawing: SigK.annotateDraw.isDrawing(),
    pending: SigK.annotatePress.isPending(),
    preview: SigK.annotatePreview.isActive(),
    sliderHeld: SigK.propsRange.isHeld(),
    pageSelected: SigK.pageGrid.getSelection().length,
    pageDragging: SigK.pageGrid.isDragging(),
    textSelected: selection.rangeCount > 0 && !selection.isCollapsed,
    fields: { width: value('props-width'), opacity: value('props-opacity'), opacityRange: value('props-opacity-range'), page: value('page-current') },
    current: state.current,
    scrollTop: Math.round(view.scrollTop),
    zoom: document.getElementById('zoom-value')?.textContent ?? null,
    facing: state.facing,
    visible: visible.length,
    visibleDrawn: visible.filter((page) => page.querySelector('canvas') !== null).length,
    print: { busy: SigK.print.isBusy(), result: window.__smokeKeysPrint ?? null },
    history: SigK.pageEdit.getHistoryState().at,
  };
})()`;

module.exports = { pointScript, boxScript, thumbScript, shapeScript, actionScript, stateScript, ACTION_NAMES: Object.keys(ACTIONS) };
