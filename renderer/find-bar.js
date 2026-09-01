(function (root) {
  'use strict';

  // 検索バー（spec-1-4 D）。ページビューの右上に浮かべる帯である。
  // 探す仕事そのものは renderer/find.js が持ち、ここは入力とボタンを結び、
  // ヒット数を出すだけにする。
  //
  // 置き場所が #view の「外」なのは、#view がスクロールする器だからである。
  // その中で position:absolute にすると中身と一緒に流れて画面外へ出る
  // （確定事項22。spec-1-2 確定事項20 と同じ理由）。

  let el = null;
  let win = null;
  let frame = 0;

  function find() {
    return root.SigK.find;
  }

  function isOpen() {
    return el !== null && el.bar.hidden === false;
  }

  // 打つたびに探し直すが、1フレームに1回へ間引く（確定事項26）。ページビューの
  // 描画と同じ作法である。
  function schedule() {
    if (frame !== 0)
      return;
    const raf = win.requestAnimationFrame ?? ((fn) => win.setTimeout(fn, 16));
    frame = raf(() => {
      frame = 0;
      find().run(el.input.value, { matchCase: el.bar.dataset.matchCase === 'on' });
    });
  }

  function setMatchCase(on) {
    el.bar.dataset.matchCase = on ? 'on' : 'off';
    el.caseBtn.classList.toggle('active', on);
    el.caseBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  // ヒット数の表示（確定事項24）。0件は --danger で出す。
  function render(view) {
    if (el === null)
      return false;
    el.count.classList.toggle('none', view.total === 0 && view.term.trim().length > 0 && !view.loading);

    if (view.loading)
      el.count.textContent = '検索中…';
    else if (view.term.trim().length === 0)
      el.count.textContent = '';
    else if (view.total === 0)
      el.count.textContent = '0 件';
    else
      el.count.textContent = `${view.current + 1} / ${view.total}`;
    return true;
  }

  // 前回の検索語を初期値にして開く（確定事項21・25）。入力欄は選択状態にする。
  function open({ restore = false } = {}) {
    if (el === null)
      return false;
    el.bar.hidden = false;

    const view = find().getState();
    setMatchCase(view.matchCase);
    el.input.value = view.term;
    render(view);

    if (!restore) {
      el.input.focus();
      el.input.select();
      // 語が残っていれば、開いた時点でその語を探し直す。
      if (view.term.trim().length > 0)
        find().run(view.term, { matchCase: view.matchCase });
    }
    return true;
  }

  // 閉じるとハイライトは消えるが、検索語は残る（確定事項21）。
  // silent は文書が閉じたときの後始末で、find.js から呼ばれる。
  function close({ silent = false } = {}) {
    if (el === null)
      return false;
    el.bar.hidden = true;
    el.count.textContent = '';
    el.count.classList.remove('none');
    if (!silent)
      find().dismiss();
    return true;
  }

  // F3 / Shift+F3 は閉じていても効く（確定事項25）。開いてから移動する。
  function step(delta) {
    if (el === null)
      return false;
    if (!isOpen())
      open();
    find().step(delta);
    return true;
  }

  function bind(doc) {
    el.input.addEventListener('input', schedule);
    el.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        find().step(event.shiftKey ? -1 : 1);
      }
    });
    el.caseBtn.addEventListener('click', () => {
      const next = el.bar.dataset.matchCase !== 'on';
      setMatchCase(next);
      find().run(el.input.value, { matchCase: next });
    });
    el.prev.addEventListener('click', () => find().step(-1));
    el.next.addEventListener('click', () => find().step(1));
    el.closeBtn.addEventListener('click', () => close());
    doc.getElementById('btn-find')?.addEventListener('click', () => {
      if (doc.getElementById('btn-find').getAttribute('aria-disabled') === 'true')
        return;
      if (isOpen())
        close();
      else
        open();
    });
  }

  function init(doc, window_) {
    if (window_.__sigkFindBarReady === true)
      return false;

    const bar = doc.getElementById('find-bar');
    const input = doc.getElementById('find-input');
    if (bar === null || input === null)
      return false;

    el = {
      doc,
      bar,
      input,
      count: doc.getElementById('find-count'),
      caseBtn: doc.getElementById('find-case'),
      prev: doc.getElementById('find-prev'),
      next: doc.getElementById('find-next'),
      closeBtn: doc.getElementById('find-close'),
    };
    if (Object.values(el).some((node) => node === null)) {
      el = null;
      return false;
    }
    win = window_;
    window_.__sigkFindBarReady = true;

    setMatchCase(false);
    bar.hidden = true;
    bind(doc);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.findBar = { init, open, close, step, render, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
