(function (root) {
  'use strict';

  // ［開いているタブから選ぶ ▾］の一覧（spec-2-2b 確定事項F1〜F7。見本 screenshots/phase2-2b-07-tab-menu.png）。
  //
  // 分割・PDF→画像・透かし・フラット化の対象の欄が使う（source-picker.js の bindTabMenu）。押すと、タブで開いている PDF を
  // タブの並び順でボタンの下に出し、選んだタブの PDF を対象にする。開いている一覧は 1 つだけで、ボタンの親の中に組む。
  // キーは edit-bar-more.js と同じ作法: ボタンで ↓（Enter・Space は押すのと同じ）で開き、↑↓ で行を移り（端で反対の端へ）、
  // Home・End、Enter・Space で選び、Esc で閉じてボタンへ戻る。Tab・一覧の外を押す・窓が非活性になる・窓の大きさが変わる、で閉じる。
  // Esc は escape-order.js の順でも閉じる（フォーカスが一覧の外にあるとき）。

  const EMPTY = 'タブで開いている PDF はありません';
  const MARK_ACTIVE = '選んでいるタブ';
  const MARK_DIRTY = '未保存の編集あり';

  let current = null;   // 開いている一覧 { button, menu, onChoose }
  const watched = new WeakSet();

  const isOpen = () => current !== null;
  const rows = () => (current === null ? [] : [...current.menu.querySelectorAll('.tab-menu-row')]);

  // 閉じる。restoreFocus ならボタンへフォーカスを戻す。開いていなければ false。
  function close({ restoreFocus = false } = {}) {
    if (current === null)
      return false;
    const { button, menu } = current;
    current = null;
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus)
      button.focus();
    return true;
  }

  function span(doc, className, text) {
    const node = doc.createElement('span');
    node.className = className;
    node.textContent = text;
    return node;
  }

  function rowOf(doc, choice) {
    const row = doc.createElement('button');
    row.type = 'button';
    row.className = 'tab-menu-row';
    row.setAttribute('role', 'menuitem');
    row.tabIndex = -1;
    row.title = choice.path;
    row.classList.toggle('on', choice.active);
    if (root.SigK.icons?.has('modeView'))
      row.append(root.SigK.icons.create(doc, 'modeView', { size: 14 }));
    row.append(span(doc, 'name', choice.name));
    if (choice.dirty)
      row.append(span(doc, 'dot', ''));
    const mark = [choice.active ? MARK_ACTIVE : null, choice.dirty ? MARK_DIRTY : null].filter(Boolean).join('・');
    if (mark !== '')
      row.append(span(doc, 'mark', mark));
    row.addEventListener('click', () => pick(choice.id));
    return row;
  }

  function pick(id) {
    const chosen = current;
    close({ restoreFocus: true });
    chosen?.onChoose(id);
  }

  function openFor({ button, choices, onChoose }) {
    const doc = button.ownerDocument;
    const menu = doc.createElement('div');
    menu.className = 'tab-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'タブで開いている PDF');
    menu.tabIndex = -1;
    const list = choices();
    menu.append(...(list.length === 0 ? [span(doc, 'tab-menu-empty', EMPTY)] : list.map((choice) => rowOf(doc, choice))));
    menu.style.top = `${button.offsetTop + button.offsetHeight + 4}px`;
    menu.style.left = `${button.offsetLeft}px`;
    menu.addEventListener('keydown', onMenuKey);
    button.after(menu);
    current = { button, menu, onChoose };
    button.setAttribute('aria-expanded', 'true');
    (menu.querySelector('.tab-menu-row.on') ?? menu.querySelector('.tab-menu-row') ?? menu).focus();
  }

  // 一覧の中のキー。扱ったキーは文書のキー（Esc の順・ページ送り）へ流さない。
  function onMenuKey(event) {
    if (event.key === 'Tab') {
      close();
      return;
    }
    const list = rows();
    const at = list.indexOf(event.target);
    const moveTo = (index) => list.length > 0 && list[(index + list.length) % list.length].focus();
    const actions = {
      ArrowDown: () => moveTo(at + 1),
      ArrowUp: () => moveTo(at < 0 ? list.length - 1 : at - 1),
      Home: () => moveTo(0),
      End: () => moveTo(list.length - 1),
      Enter: () => at >= 0 && list[at].click(),
      ' ': () => at >= 0 && list[at].click(),
      Escape: () => close({ restoreFocus: true }),
    };
    const action = actions[event.key];
    if (action === undefined)
      return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  // 一覧と押したボタンの外を押したら閉じる。窓が非活性になる・大きさが変わる、でも閉じる。文書ごとに 1 回だけ付ける。
  function watch(doc) {
    if (watched.has(doc))
      return;
    watched.add(doc);
    doc.addEventListener('mousedown', (event) => {
      if (current !== null && !current.menu.contains(event.target) && !current.button.contains(event.target))
        close();
    }, true);
    doc.defaultView?.addEventListener('blur', () => close());
    doc.defaultView?.addEventListener('resize', () => close());
  }

  // choices() は { id, name, path, active, dirty } の並び、onChoose(id) は選んだタブを対象にする口。
  // isLocked() が真の間（実行中で押せない）は開かない。
  function attach({ button, choices, onChoose, isLocked = () => false }) {
    if (button === null || button === undefined)
      return false;
    watch(button.ownerDocument);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    const openHere = () => {
      close();
      openFor({ button, choices, onChoose });
    };
    button.addEventListener('click', () => {
      if (current?.button === button) {
        close();
        return;
      }
      if (!isLocked())
        openHere();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' || isLocked())
        return;
      event.preventDefault();
      if (current?.button !== button)
        openHere();
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tabMenu = { EMPTY, attach, close, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
