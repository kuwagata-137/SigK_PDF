(function (root) {
  'use strict';

  // 使い方の窓の中身から DOM を組む（spec-4b-7b 確定事項B1・D3）。窓の開け閉めは help-dialog.js。
  // 中身（help-content.js）の文の [キー] は <kbd> にする。innerHTML は使わず、createElement と textContent で組む
  // （中身に < や & があっても要素にならない）。

  const KEY = /\[([^[\]]+)\]/g;

  // 文を文字と <kbd> の並びにする。[Ctrl]+[Z] は Ctrl と Z の 2 つの <kbd> を「+」でつなぐ。
  function appendInline(doc, parent, value) {
    const text = String(value);
    let last = 0;
    for (const match of text.matchAll(KEY)) {
      if (match.index > last)
        parent.append(doc.createTextNode(text.slice(last, match.index)));
      const kbd = doc.createElement('kbd');
      kbd.textContent = match[1];
      parent.append(kbd);
      last = match.index + match[0].length;
    }
    if (last < text.length)
      parent.append(doc.createTextNode(text.slice(last)));
    return parent;
  }

  function element(doc, tag, text = null, className = null) {
    const node = doc.createElement(tag);
    if (className !== null)
      node.className = className;
    return text === null ? node : appendInline(doc, node, text);
  }

  // 表。先頭の行を見出し（th）にする。
  function table(doc, rows) {
    const [head, ...body] = rows;
    const node = doc.createElement('table');
    const thead = node.appendChild(doc.createElement('thead'));
    const headRow = thead.appendChild(doc.createElement('tr'));
    for (const cell of head)
      headRow.append(element(doc, 'th', cell));
    const tbody = node.appendChild(doc.createElement('tbody'));
    for (const row of body) {
      const tr = tbody.appendChild(doc.createElement('tr'));
      for (const cell of row)
        tr.append(element(doc, 'td', cell));
    }
    return node;
  }

  function block(doc, data) {
    const nodes = [];
    if (data.h)
      nodes.push(element(doc, 'h4', data.h));
    if (data.items) {
      const list = doc.createElement('ul');
      for (const item of data.items)
        list.append(element(doc, 'li', item));
      nodes.push(list);
    }
    if (data.table)
      nodes.push(table(doc, data.table));
    return nodes;
  }

  // 1 つの節の本文（題・導入・見出し・箇条書き・表）。
  function section(doc, data) {
    const nodes = [element(doc, 'h3', data.title)];
    if (data.lead)
      nodes.push(element(doc, 'p', data.lead, 'help-lead'));
    for (const each of data.blocks)
      nodes.push(...block(doc, each));
    return nodes;
  }

  // 目次（グループの見出しと、節のボタン）。ボタンは data-section に節の id を持つ。
  function nav(doc, content) {
    const nodes = [];
    for (const group of content.GROUPS) {
      nodes.push(element(doc, 'div', group.label, 'help-grp'));
      for (const data of content.SECTIONS.filter((each) => each.group === group.id)) {
        const button = element(doc, 'button', data.title, 'help-item');
        button.type = 'button';
        button.dataset.section = data.id;
        nodes.push(button);
      }
    }
    return nodes;
  }

  // 窓の中を組む（spec-4b-7b 確定事項B1・B8）。題・目次・13 節の本文。本文の節は隠しておき、help-dialog.js が出し分ける。
  function fill(doc, dialog, content) {
    const title = dialog.querySelector('#help-title');
    if (title !== null)
      title.textContent = content.TITLE;
    dialog.querySelector('.help-nav')?.replaceChildren(...nav(doc, content));
    const sections = content.SECTIONS.map((data) => {
      const node = doc.createElement('section');
      node.className = 'help-section';
      node.dataset.section = data.id;
      node.hidden = true;
      node.append(...section(doc, data));
      return node;
    });
    dialog.querySelector('.help-body')?.replaceChildren(...sections);
    return dialog;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.helpRender = { appendInline, section, nav, fill };
})(typeof window !== 'undefined' ? window : globalThis);
