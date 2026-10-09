(function (root) {
  'use strict';

  // 分割の盤の要素を組む（spec-2-2b 確定事項C1・C2・C6・第 I 章。見本 screenshots/phase2-2b-02-start.png ほか）。
  //
  // 箱（見出しに番号・ファイル名・ページ・書き出さない札・［前のファイルとつなげる］）、ページ（紙の枠・番号・選んだ印・
  // 書き出さない札）、ページの間の ✂ を、split-board-layout.js が決めた位置（rect）に置いて返すだけ。どれを組むかと、
  // 押したときの振る舞いは split-board-view.js と split-board-input.js が持つ。

  const MAX_DPR = 2;

  const rangeText = (first, last) => root.SigK.toolsSplitView.rangeText(first, last);

  function node(doc, tag, className, text) {
    const created = doc.createElement(tag);
    if (className)
      created.className = className;
    if (text !== undefined)
      created.textContent = text;
    return created;
  }

  function place(target, rect) {
    Object.assign(target.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    return target;
  }

  // 箱の中の書き出さないページの札（第 I 章）。3 枚までは番号、4 枚からは枚数。
  function skipChip(box, skipped) {
    const pages = [];
    for (let page = box.start; page <= box.end; page += 1) {
      if (skipped.has(page))
        pages.push(page + 1);
    }
    return pages.length <= 3 ? `${pages.join('・')} ページは書き出さない` : `書き出さないページ ${pages.length} 枚`;
  }

  // names は番号順のファイル名、skipped は書き出さないページの Set。
  function box(doc, rect, info, names, skipped) {
    const dead = info.file === null;
    const element = place(node(doc, 'div', dead ? 'sb-box dead' : 'sb-box'), rect);
    element.classList.toggle('narrow', rect.narrow === true);
    element.dataset.box = String(info.index);
    const head = node(doc, 'div', 'sb-head');
    const no = node(doc, 'span', 'sb-no', dead ? '－' : String(info.file));
    no.classList.toggle('even', !dead && info.file % 2 === 0);
    head.append(no, node(doc, 'span', 'fname', dead ? '書き出さない' : names[info.file - 1]));
    if (!dead)
      head.append(node(doc, 'span', 'range', rangeText(info.first, info.last)));
    // 狭い箱は見出しの 2 行目に入りきらないので札を出さない（ページの上の「書き出さない」と右の一覧で分かる）。
    if (!dead && info.skippedCount > 0 && rect.narrow !== true)
      head.append(node(doc, 'span', 'chip', skipChip(info, skipped)));
    head.append(node(doc, 'span', 'spacer'));
    if (info.index > 0) {
      const join = node(doc, 'button', 'sb-join', '前のファイルとつなげる');
      join.type = 'button';
      join.dataset.join = String(info.index);
      head.append(join);
    }
    element.append(head);
    return element;
  }

  // 描けた canvas を紙の枠に入れる。canvas の画素は devicePixelRatio 倍なので、見た目の大きさに戻す。
  function fitCanvas(sheet, canvas) {
    if (canvas === null || canvas === undefined)
      return;
    const ratio = Math.min(sheet.ownerDocument.defaultView?.devicePixelRatio || 1, MAX_DPR);
    canvas.style.width = `${canvas.width / ratio}px`;
    canvas.style.height = `${canvas.height / ratio}px`;
    sheet.replaceChildren(canvas);
  }

  // flags は { selected, skipped, current }。canvas は描けていれば入れる。
  function page(doc, rect, cell, index, flags, canvas) {
    const element = place(node(doc, 'div', 'sb-page'), rect);
    element.dataset.page = String(index);
    element.classList.toggle('sel', flags.selected);
    element.classList.toggle('skip', flags.skipped);
    element.classList.toggle('current', flags.current);
    const sheet = node(doc, 'div', 'sb-sheet');
    Object.assign(sheet.style, { width: `${cell.sheetWidth}px`, height: `${cell.sheetHeight}px` });
    fitCanvas(sheet, canvas);
    element.append(sheet, node(doc, 'span', 'cap', String(index + 1)));
    if (flags.skipped)
      element.append(node(doc, 'span', 'tag', '書き出さない'));
    return element;
  }

  // index のページの前で切る ✂（確定事項C1）。キーでは押さない（確定事項G3。範囲を選んで［この範囲を 1 つのファイルにする］で同じことができる）。
  function cut(doc, rect, cell, index) {
    const button = place(node(doc, 'button', 'sb-cut'), rect);
    button.type = 'button';
    button.tabIndex = -1;
    button.dataset.cut = String(index);
    button.title = 'ここで分ける';
    button.setAttribute('aria-label', 'ここで分ける');
    button.style.paddingTop = `${3 + cell.sheetHeight / 2 - 11}px`;
    const scissors = node(doc, 'span', 's');
    if (root.SigK.icons?.has('cut'))
      scissors.append(root.SigK.icons.create(doc, 'cut', { size: 15, strokeWidth: 1.9 }));
    const tip = node(doc, 'span', 'tip', 'ここで分ける');
    tip.style.top = `${3 + cell.sheetHeight / 2 + 16}px`;
    button.append(scissors, tip);
    return button;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitBoardNodes = { box, page, cut, fitCanvas };
})(typeof window !== 'undefined' ? window : globalThis);
