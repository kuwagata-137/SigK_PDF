(function (root) {
  'use strict';

  // 一覧の行をポインタで掴んで並べ替える（spec-2-1 確定事項15・spec-3-1 確定事項36）。
  //
  // 結合の一覧（tools-merge-list.js）から切り出し、変換の一覧（tools-convert-list.js）と
  // 共用する。page-grid.js と同じくポインタイベントで組む（HTML5 の draggable は jsdom に
  // 載らない）。落とす位置は、行の中心より上か下かで決める。
  //
  // 一覧ごとに attachRowDrag で結線する。状態は結線ごとに閉じており、2つの一覧が
  // 同じ文書で動いていても混ざらない。

  const DRAG_THRESHOLD = 4;

  function attachRowDrag({ doc, list, rowSelector, onDrop, isLocked = () => false }) {
    const drag = { pending: false, active: false, id: null, at: null, startY: 0, line: null };

    const rowNodes = () => [...list.querySelectorAll(rowSelector)];
    const rowById = (id) => list.querySelector(`${rowSelector}[data-id="${id}"]`);

    function dropIndexFor(y) {
      const nodes = rowNodes();
      let at = 0;
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (y >= rect.top + rect.height / 2)
          at += 1;
      }
      return Math.min(at, nodes.length);
    }

    function showLine(at) {
      if (drag.line === null) {
        drag.line = doc.createElement('div');
        drag.line.className = 'drop-line';
        list.append(drag.line);
      }
      const nodes = rowNodes();
      const anchor = nodes[Math.min(at, nodes.length - 1)];
      if (anchor === undefined)
        return;
      const top = at >= nodes.length ? anchor.offsetTop + anchor.offsetHeight : anchor.offsetTop;
      drag.line.style.left = '6px';
      drag.line.style.right = '6px';
      drag.line.style.height = '2px';
      drag.line.style.top = `${top - 1}px`;
    }

    function endDrag() {
      const node = drag.id === null ? null : rowById(drag.id);
      node?.classList.remove('dragging');
      drag.line?.remove();
      drag.line = null;
      drag.pending = false;
      drag.active = false;
      drag.id = null;
      drag.at = null;
    }

    function onPointerDown(event) {
      if (event.button !== 0 || isLocked() === true)
        return;
      const control = event.target?.closest?.('input, button');
      if (control !== null && control !== undefined)
        return;
      const node = event.target?.closest?.(rowSelector);
      if (node === null || node === undefined)
        return;
      drag.pending = true;
      drag.id = node.dataset.id;
      drag.startY = event.clientY;
    }

    function onPointerMove(event) {
      if (!drag.pending)
        return;
      if (!drag.active) {
        if (Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD)
          return;
        drag.active = true;
        rowById(drag.id)?.classList.add('dragging');
      }
      drag.at = dropIndexFor(event.clientY);
      showLine(drag.at);
    }

    function onPointerUp(event) {
      if (!drag.active) {
        drag.pending = false;
        drag.id = null;
        return;
      }
      const inside = list.contains(event.target);
      const { id, at } = drag;
      endDrag();
      if (inside && at !== null)
        onDrop(id, at);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape' && (drag.active || drag.pending)) {
        event.preventDefault();
        endDrag();
      }
    }

    list.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', onPointerUp);
    doc.addEventListener('keydown', onKeyDown);

    return {
      isDragging: () => drag.active,
      dropIndexFor,
      detach: () => {
        endDrag();
        list.removeEventListener('pointerdown', onPointerDown);
        doc.removeEventListener('pointermove', onPointerMove);
        doc.removeEventListener('pointerup', onPointerUp);
        doc.removeEventListener('keydown', onKeyDown);
      },
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.rowDrag = { DRAG_THRESHOLD, attachRowDrag };
})(typeof window !== 'undefined' ? window : globalThis);
