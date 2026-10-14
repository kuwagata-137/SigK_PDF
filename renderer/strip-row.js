(function (root) {
  'use strict';

  // 帯 1 本の DOM（spec-2-5 確定事項D2。見本 screenshots/strips2-merge.png）。並べ方と描く所は strip-view.js、押す処理は strip-input.js。
  //
  //   .strip[data-tab-id](.sel)(.failed)
  //     .strip-head … .strip-no・.fname・.count・.unsaved・.spacer・button.strip-btn[data-act=up|down|save|close]
  //     .strip-pages（横にスクロール）> .strip-page[data-page](.picked) > .sheet（canvas）＋ .cap
  //     p.strip-note（開けなかった理由）

  const BUTTONS = Object.freeze([
    { act: 'up', icon: 'chevronUp', label: '上へ' },
    { act: 'down', icon: 'chevronDown', label: '下へ' },
    { act: 'save', icon: 'floppy', label: '上書き保存' },
    { act: 'close', icon: 'close', label: '閉じる' },
  ]);

  function span(doc, className, text = '') {
    const node = doc.createElement('span');
    node.className = className;
    node.textContent = text;
    return node;
  }

  function button(doc, { act, icon, label }) {
    const node = doc.createElement('button');
    node.type = 'button';
    node.className = 'strip-btn';
    node.dataset.act = act;
    node.title = label;
    node.setAttribute('aria-label', label);
    // 帯そのものと同じく、キーボードのフォーカスは当てない（PR-2 の起草者の判断。帯の操作はマウス）。
    node.tabIndex = -1;
    if (root.SigK.icons?.has(icon))
      node.append(root.SigK.icons.create(doc, icon, { size: icon === 'floppy' ? 16 : 15, strokeWidth: 1.9 }));
    return node;
  }

  function create(doc, tabId) {
    const node = doc.createElement('div');
    node.className = 'strip';
    node.dataset.tabId = String(tabId);
    node.setAttribute('role', 'listitem');
    node.style.height = `${root.SigK.stripLayout.STRIP_HEIGHT}px`;
    const head = doc.createElement('div');
    head.className = 'strip-head';
    head.append(span(doc, 'strip-no'), span(doc, 'fname'), span(doc, 'count'), span(doc, 'unsaved', '保存していない変更あり'), span(doc, 'spacer'));
    head.append(...BUTTONS.map((entry) => button(doc, entry)));
    const pages = doc.createElement('div');
    pages.className = 'strip-pages';
    const note = doc.createElement('p');
    note.className = 'strip-note';
    note.hidden = true;
    node.append(head, pages, note);
    return node;
  }

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  // info は { no, name, pages, encrypted, failed, dirty, first, last, selected }。
  function updateHead(node, info) {
    const head = node.firstElementChild;
    node.classList.toggle('sel', info.selected);
    node.classList.toggle('failed', info.failed);
    node.setAttribute('aria-current', info.selected ? 'true' : 'false');
    head.querySelector('.strip-no').textContent = String(info.no);
    const name = head.querySelector('.fname');
    name.textContent = info.name;
    name.title = info.path ?? info.name;
    const count = head.querySelector('.count');
    count.textContent = info.failed ? '' : `${info.pages} ページ${info.encrypted ? '・パスワード付き' : ''}`;
    count.hidden = info.failed;
    head.querySelector('.unsaved').hidden = !info.dirty;
    setDisabled(head.querySelector('[data-act="up"]'), info.first);
    setDisabled(head.querySelector('[data-act="down"]'), info.last);
    // 開けなかった帯は保存できない（PR-2 の起草者の判断）。変更の無い帯は押しても何もしない。
    setDisabled(head.querySelector('[data-act="save"]'), info.failed);
  }

  // 紙のセルを sheets（strip-layout の row の sheets）の数と大きさにそろえる。描いた canvas は大きさが同じなら残す。
  function syncPages(node, sheets) {
    const pages = node.querySelector('.strip-pages');
    const doc = node.ownerDocument;
    while (pages.children.length > sheets.length)
      pages.lastElementChild.remove();
    while (pages.children.length < sheets.length) {
      const cell = doc.createElement('div');
      cell.className = 'strip-page';
      cell.dataset.page = String(pages.children.length);
      const sheet = doc.createElement('div');
      sheet.className = 'sheet';
      cell.append(sheet, span(doc, 'cap', String(pages.children.length + 1)));
      pages.append(cell);
    }
    sheets.forEach((size, index) => {
      const sheet = pages.children[index].firstElementChild;
      const width = `${size.width}px`;
      const height = `${size.height}px`;
      if (sheet.style.width !== width || sheet.style.height !== height) {
        sheet.style.width = width;
        sheet.style.height = height;
      }
    });
  }

  function pagesOf(node) {
    return node.querySelector('.strip-pages');
  }

  function sheetAt(node, index) {
    return pagesOf(node).children[index]?.firstElementChild ?? null;
  }

  function markPicked(node, indexes) {
    const picked = new Set(indexes);
    [...pagesOf(node).children].forEach((cell, index) => cell.classList.toggle('picked', picked.has(index)));
  }

  function showNote(node, text) {
    const note = node.querySelector('.strip-note');
    note.textContent = text ?? '';
    note.hidden = text === null || text === undefined || text === '';
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripRow = { BUTTONS, create, updateHead, syncPages, pagesOf, sheetAt, markPicked, showNote };
})(typeof window !== 'undefined' ? window : globalThis);
