(function (root) {
  'use strict';

  // 道具の段の「その他」の一覧（spec-4b-5b 確定事項26〜28。見本 screenshots/phase4b-5b-more.png）。
  //
  // 「その他」を押すと、隠している道具（edit-bar-overflow.js）の一覧を「その他」の下に開く。一覧の道具を押すと段のボタンを押したのと
  // 同じ（edit-bar.js が道具を持つ・離す）で、一覧は閉じる。押している道具が隠れていれば「その他」を押している印（青）にする。
  // キーボードは、「その他」で ↓（Enter・Space は押すのと同じ）で開き、↑↓ で行を移り（端で反対の端へ）、Home・End、Enter・Space で
  // 選び、Esc で閉じて「その他」へ戻る。Tab・一覧の外を押す・段の大きさが変わる、で閉じる。Esc は annotate-cancel.js の順の先頭でも閉じる。

  let el = null;

  function overflow() {
    return root.SigK.editBarOverflow;
  }

  function isOpen() {
    return el !== null && el.menu.hidden === false;
  }

  function rows() {
    return [...el.menu.querySelectorAll('.edit-more-row')];
  }

  // 「その他」の押している印。押している道具が隠れているとき。
  function syncPressed() {
    if (el === null)
      return false;
    const on = overflow().hiddenButtons().some((button) => button.classList.contains('active'));
    el.button.classList.toggle('active', on);
    el.button.setAttribute('aria-pressed', on ? 'true' : 'false');
    return on;
  }

  function rowOf(button) {
    const row = el.doc.createElement('button');
    row.type = 'button';
    row.className = 'edit-more-row';
    row.setAttribute('role', 'menuitem');
    row.tabIndex = -1;
    const icon = button.querySelector('svg');
    if (icon !== null)
      row.append(icon.cloneNode(true));
    const name = el.doc.createElement('span');
    name.textContent = button.title;
    row.append(name);
    row.classList.toggle('active', button.classList.contains('active'));
    row.addEventListener('click', (event) => pick(button, { byMouse: event.detail > 0 }));
    return row;
  }

  // 一覧を「その他」の右端にそろえて下に出す。
  function place() {
    const right = el.bar.clientWidth - (el.item.offsetLeft + el.item.offsetWidth);
    el.menu.style.right = `${Math.max(0, right)}px`;
  }

  function open() {
    const buttons = overflow().hiddenButtons();
    if (el === null || buttons.length === 0)
      return false;
    el.menu.replaceChildren(...buttons.map(rowOf));
    place();
    el.menu.hidden = false;
    el.button.setAttribute('aria-expanded', 'true');
    const list = rows();
    (list.find((row) => row.classList.contains('active')) ?? list[0]).focus();
    return true;
  }

  // 閉じる。restoreFocus なら「その他」へフォーカスを戻す。開いていなければ false。
  function close({ restoreFocus = false } = {}) {
    if (!isOpen())
      return false;
    el.menu.hidden = true;
    el.menu.replaceChildren();
    el.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus)
      el.button.focus();
    return true;
  }

  // 一覧の道具を選ぶ。キーボード（Enter・Space）で選んだときは「その他」へフォーカスを戻し、続けてキーで操作できるようにする。
  // マウスで選んだときは戻さない（計画外の直し③。段のボタンをマウスで押したときと同じ。edit-bar.js の leaveIfMouse）。行は
  // 閉じると消えるので、フォーカスは文書へ移る。
  function pick(button, { byMouse = false } = {}) {
    close();
    button.click();
    if (!byMouse)
      el.button.focus();
  }

  // 一覧の中のキー。扱ったキーは文書のキー（Delete・Enter で書き込みを消す・直す）へ流さない。
  function onMenuKey(event) {
    const list = rows();
    const at = list.indexOf(el.doc.activeElement);
    const moveTo = (index) => list[(index + list.length) % list.length].focus();
    const actions = {
      ArrowDown: () => moveTo(at + 1),
      ArrowUp: () => moveTo(at < 0 ? list.length - 1 : at - 1),
      Home: () => moveTo(0),
      End: () => moveTo(list.length - 1),
      Enter: () => at >= 0 && list[at].click(),
      ' ': () => at >= 0 && list[at].click(),
      Escape: () => close({ restoreFocus: true }),
    };
    if (event.key === 'Tab') {
      close();
      return;
    }
    const action = actions[event.key];
    if (action === undefined)
      return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  function init(doc, win) {
    if (win.__sigkEditBarMoreReady === true)
      return false;
    const bar = doc.getElementById('edit-bar');
    const button = doc.getElementById('edit-more');
    const menu = doc.getElementById('edit-more-menu');
    if (bar === null || button === null || menu === null)
      return false;
    win.__sigkEditBarMoreReady = true;
    el = { doc, bar, button, menu, item: button.closest('.edit-item') };
    // 開いたときは一覧の行へ移る。マウスで押して閉じたときは「その他」にフォーカスを残さない（計画外の直し③）。
    button.addEventListener('click', (event) => {
      if (!isOpen()) {
        open();
        return;
      }
      close();
      root.SigK.editBar?.leaveIfMouse(event, button);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && open())
        event.preventDefault();
    });
    menu.addEventListener('keydown', onMenuKey);
    // 一覧と「その他」の外を押したら閉じる。
    doc.addEventListener('mousedown', (event) => {
      if (isOpen() && !menu.contains(event.target) && !button.contains(event.target))
        close();
    }, true);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.editBarMore = { init, open, close, isOpen, syncPressed };
})(typeof window !== 'undefined' ? window : globalThis);
