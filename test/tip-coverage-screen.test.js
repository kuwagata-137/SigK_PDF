'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// 説明の吹き出し（spec-2-5 J2・J3・J5・J14・J16）を、JS が作る要素（タブ・帯・サムネイルの上のボタン・右パネルの色の見本と線種・
// 「その他」の一覧・注釈一覧・最近使ったファイル・右の欄の行と出力先・「変換する画像」の帯・✂ の盤）も出した画面で照らす。
// index.html に最初から書いてある要素と、renderer の JS の書き方は tip-coverage.test.js が見る。
//
// walk は、どのモードとツールも 1 度ずつ回り、着いた所ごとに visit を呼ぶ。着いたことは、その所でしか出ない要素（probe）で確かめる。
// visit が返した困り事は、全部の所を回ってからまとめて比べる（残っている所を一度に並べて落とすため）。

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const IMG = 'C:\\photo\\p.png';
const SAVED = 'C:\\work\\新しい PDF 1.pdf';
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

// 1 ページ目に、本文の無いハイライトと、本文のある表示のみの直線（注釈一覧の行を出すため。annotation-list.test.js と同じ）。
const IMPORTED = {
  0: [
    { id: '12R', subtype: 'Highlight', rect: [48, 743, 232, 753], quadPoints: [48, 753, 232, 753, 48, 743, 232, 743], color: new Uint8ClampedArray([255, 228, 90]), opacity: 1 },
    { id: '17R', subtype: 'Line', rect: [298, 698, 502, 762], color: new Uint8ClampedArray([255, 0, 0]), contentsObj: { str: 'other line' }, titleObj: { str: '' }, lineCoordinates: [300, 700, 500, 760], lineEndings: ['None', 'None'] },
  ],
};

// ツールモードで回る順と、そのツールの画面でしか出ない要素。
const TOOL_PROBES = [
  ['merge', ['#strips .strip .strip-btn', '#merge-list .merge-pick']],
  ['split', ['#split-board-canvas .sb-cut', '#split-files .sb-file', '#split-folder:not(:empty)']],
  ['convert', ['#image-strip .img-item', '#image-strip .img-x']],
  ['toImage', ['#toimage-folder:not(:empty)']],
  ['watermark', ['#wm-colors .swatch']],
  ['flatten', ['#tools-list .tool-item.active[data-tool="flatten"]']],
];

// J2 の 6 か所（ページ編集のボタンは、左のパネルの下の 5 つとサムネイルの上の 3 つ。J16）。
const J2 = ['#rail .rail-item', '#toolbar .tb-btn, #toolbar .step', '#edit-bar .edit-tool', '#tools-list .tool-item', '#strips .strip .strip-btn', '#side-actions .act', '.thumb-tool'];

const plain = (value) => structuredClone(value);
const short = (node) => node.outerHTML.slice(0, 80);

async function settle(shell) {
  for (let i = 0; i < 6; i += 1)
    await shell.flush();
}

// 右端の hide 個の道具を「その他」の一覧へ隠す（edit-bar-more.test.js と同じ測り方）。
function hideRight(shell, hide) {
  const items = [...shell.document.getElementById('edit-bar').children].filter((node) => node.matches('.edit-sep, .edit-item:not(.edit-more)'));
  const children = items.map((node) => ({ width: node.classList.contains('edit-sep') ? 7 : 48, sep: node.classList.contains('edit-sep') }));
  const span = children.slice(0, children.length - hide).reduce((sum, child, index) => sum + child.width + (index > 0 ? 5 : 0), 0);
  shell.SigK.editBarOverflow.fit({ children, available: span + 5 + 48, gap: 5, padding: [0, 0], moreWidth: 48 });
}

// jsdom は大きさを計算しないので、✂ の盤の器の幅と帯の画面の高さを与える（split-board.test.js と同じ）。
function sizeBoard(shell, { width = 640, height = 500 } = {}) {
  const scroll = shell.document.getElementById('split-board-scroll');
  const strips = shell.document.getElementById('strips');
  const canvas = shell.document.getElementById('split-board-canvas');
  Object.defineProperty(scroll, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(strips, 'clientHeight', { configurable: true, get: () => height });
  strips.getBoundingClientRect = () => ({ top: 0, left: 0, right: width, bottom: height, width, height });
  canvas.getBoundingClientRect = () => ({ top: -strips.scrollTop, left: 0, right: width, bottom: height, width, height });
}

// 文書なし → タブ 2 枚 → ページ編集 → 編集 → ツール 6 つ。visit(shell, label) が返した困り事（文字の並び）を、所の名前を付けて集めて返す。
async function walk(t, visit) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }), [B]: makeSource({ path: B, name: 'b.pdf' }) },
    recent: [{ path: A, name: 'a.pdf' }],
    imageInfos: { [IMG]: { kind: 'png', width: 1200, height: 800 } },
  });
  t.after(() => shell.cleanup());
  const { SigK, document } = shell;
  const problems = new Set();
  const at = async (label, probes) => {
    await settle(shell);
    for (const probe of probes)
      assert.ok(document.querySelector(probe) !== null, `${label}: ${probe} が出ていない`);
    for (const problem of visit(shell, label))
      problems.add(`${label}: ${problem}`);
  };
  await at('閲覧（文書なし）', ['#view-recent .recent-item']);
  SigK.shell.setMode(document, 'tools');
  SigK.tools.select('merge');
  await at('ツール（帯なし）', ['#strip-drop-recent .row']);
  SigK.shell.setMode(document, 'view');
  await SigK.tabs.openPath(A);
  await SigK.tabs.openPath(B);
  await at('閲覧（タブ 2 枚）', ['.tab .x']);
  SigK.shell.setMode(document, 'pages');
  await at('ページ編集', ['#thumbs .thumb-tool']);
  document.querySelector('#thumbs .thumb-tool[data-tool="rotateRight"]').click();
  await at('ページ編集（保存していない変更あり）', ['.tab .dirty']);
  await walkEdit(shell, at);
  SigK.shell.setMode(document, 'tools');
  sizeBoard(shell);
  for (const [tool, probes] of TOOL_PROBES) {
    SigK.tools.select(tool);
    if (tool === 'convert')
      await SigK.toolsConvert.addPaths([IMG]);
    await at(`ツール（${tool}）`, probes);
    assert.equal(SigK.toolPane.shown(), tool);
  }
  return [...problems];
}

// 編集モード: 四角を持つ（線種）→ 色の見本を開く → 「その他」の一覧を開く → 注釈一覧に切り替える。
async function walkEdit(shell, at) {
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'annot');
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  await at('編集（四角）', ['#props-style button[data-style]']);
  document.getElementById('props-color').click();
  await at('編集（色の見本）', ['#color-pop:not([hidden]) .cell']);
  SigK.colorPopover.close();
  hideRight(shell, 5);
  document.getElementById('edit-more').click();
  await at('編集（その他の一覧）', ['#edit-more-menu:not([hidden]) .edit-more-row']);
  SigK.editBarMore.close();
  SigK.shell.setEditSide(document, 'list');
  await at('編集（注釈一覧）', ['#annot-rows .annot-row']);
}

// 文字を打つ欄（J17。ページ番号・検索の欄・範囲の欄など）。説明の吹き出しを出さない。
const TEXT_FIELDS = 'input:not([type]), input[type="text"], input[type="number"], input[type="search"], textarea, [contenteditable="true"]';

test('どのモードとツールでも、画面の要素に title が無く、data-tip の要素はどれも説明を持ち、文字を打つ欄には出ない（J17）', async (t) => {
  const problems = await walk(t, ({ SigK, document }) => [
    ...[...document.body.querySelectorAll('[title]')].map((node) => `title が残る ${short(node)}`),
    ...[...document.querySelectorAll('[data-tip]')].filter((node) => !SigK.tipContent.resolve(node)?.name).map((node) => `名前を引けない ${short(node)}`),
    ...[...document.querySelectorAll(TEXT_FIELDS)].filter((node) => SigK.tipRules.targetOf(node) !== null).map((node) => `文字を打つ欄に出る ${short(node)}`),
  ]);
  assert.deepEqual(problems, []);
});

test('J2 の 6 か所の要素は、どれも data-tip を持つ', async (t) => {
  const found = new Map(J2.map((selector) => [selector, 0]));
  const problems = await walk(t, ({ document }) => J2.flatMap((selector) => {
    const nodes = [...document.querySelectorAll(selector)];
    found.set(selector, found.get(selector) + nodes.length);
    return nodes.filter((node) => !node.dataset.tip).map((node) => `${selector} に data-tip が無い ${short(node)}`);
  }));
  assert.deepEqual(problems, []);
  assert.deepEqual([...found].filter(([, count]) => count === 0).map(([selector]) => selector), [], 'どの所でも出なかった');
});

test('アイコンだけの data-tip の要素は aria-label を持つ', async (t) => {
  const seen = new Set();
  const problems = await walk(t, ({ document }) => {
    const iconOnly = [...document.querySelectorAll('[data-tip]')].filter((node) => node.textContent.trim() === '');
    iconOnly.forEach((node) => seen.add(node.className));
    return iconOnly.filter((node) => !node.getAttribute('aria-label')).map((node) => `aria-label が無い ${short(node)}`);
  });
  assert.deepEqual(problems, []);
  // 帯のボタン・サムネイルの上のボタン・✂・タブの × と点・画像の × を含む。
  for (const className of ['strip-btn', 'thumb-tool', 'sb-cut', 'x', 'dirty', 'img-x'])
    assert.ok([...seen].some((name) => name.split(' ').includes(className)), `${className} を見ていない`);
});

// 所ごとに控える要素。選ぶ式だけなら、鍵 text の要素は { name, desc }、ほかは鍵（文の表の鍵）で控える。
// [選ぶ式, 読み方] なら、読み方で読んだ値を控える。
const ariaLabel = (node) => node.getAttribute('aria-label');
const FACTS = {
  '閲覧（文書なし）': { recent: '#view-recent .recent-item' },
  '閲覧（タブ 2 枚）': { tabs: '#tabbar .tab', close: '#tabbar .tab .x' },
  'ページ編集（保存していない変更あり）': {
    thumb: '#thumbs .thumb[data-page="1"] .thumb-tool', thumbLabel: ['#thumbs .thumb[data-page="1"] .thumb-tool', ariaLabel], dirty: '#tabbar .tab .dirty',
  },
  '編集（四角）': { style: '#props-style button[data-style]' },
  'ツール（merge）': { strip: '#strips .strip .strip-head .strip-btn', fname: '#strips .strip .fname', merge: '#merge-list .merge-pick .fname' },
  'ツール（split）': { file: '#split-files .sb-file', folder: '#split-folder', cut: '#split-board-canvas .sb-cut' },
  'ツール（convert）': {
    image: '#image-strip .img-item', off: '#image-strip .img-x',
    names: ['#image-strip .img-item', (node) => [node.querySelector('.img-x').getAttribute('aria-label'), node.querySelector('.cap').textContent]],
  },
  'ツール（toImage）': { folder: '#toimage-folder' },
  'ツール（watermark）': { color: '#wm-colors .swatch' },
};

test('JS が作る要素の説明の吹き出しは、文の表の鍵か、ファイル名とフルパスなどの文（spec-2-5 J5・J15・J16）', async (t) => {
  const seen = {};
  await walk(t, ({ SigK, document }, label) => {
    const tipOf = (node) => (node.dataset.tip === 'text' ? plain(SigK.tipContent.resolve(node)) : node.dataset.tip);
    const facts = Object.entries(FACTS[label] ?? {}).map(([name, fact]) => {
      const [selector, read] = Array.isArray(fact) ? fact : [fact, tipOf];
      return [name, [...document.querySelectorAll(selector)].map(read)];
    });
    seen[label] = Object.fromEntries(facts);
    return [];
  });
  const file = (name, desc) => ({ name, desc });
  assert.deepEqual(seen['閲覧（文書なし）'], { recent: [file('a.pdf', A)] });
  assert.deepEqual(seen['閲覧（タブ 2 枚）'], { tabs: [file('a.pdf', A), file('b.pdf', B)], close: ['tab.close', 'tab.close'] });
  assert.deepEqual(seen['ページ編集（保存していない変更あり）'], {
    thumb: ['thumb.rotateLeft', 'thumb.rotateRight', 'thumb.delete'], thumbLabel: ['左に回す', '右に回す', 'このページを削除'], dirty: ['tab.dirty'],
  }, 'サムネイルの上の 3 つの読み上げの名前は、説明の吹き出しの名前（J16 の呼び名）');
  assert.deepEqual(seen['編集（四角）'], { style: ['style.solid', 'style.dashed', 'style.cloudy'] });
  const buttons = ['strip.up', 'strip.down', 'strip.save', 'strip.close'];
  assert.deepEqual(seen['ツール（merge）'], { strip: [...buttons, ...buttons], fname: [file('a.pdf', A), file('b.pdf', B)], merge: [file('a.pdf', A), file('b.pdf', B)] });
  assert.deepEqual(seen['ツール（split）'], {
    file: [file('b_001.pdf', 'クリックすると、このファイルの箱へ移ります。')], folder: [file('出力先のフォルダ', 'C:\\work')], cut: ['split.cut', 'split.cut'],
  });
  const [image] = seen['ツール（convert）'].image;
  assert.equal(image.name, 'p.png');
  assert.match(image.desc, /^C:\\photo\\p\.png\n1200×800・PNG\nこの紙: /);
  assert.deepEqual(seen['ツール（convert）'].off, ['image.remove']);
  assert.deepEqual(seen['ツール（convert）'].names, [['「p.png」を外す', 'p.png']], '画像の名前は、説明の吹き出し・× の読み上げ・名札で同じ');
  assert.deepEqual(seen['ツール（toImage）'], { folder: [file('出力先のフォルダ', 'C:\\work')] });
  assert.deepEqual(seen['ツール（watermark）'], { color: ['灰', '赤', '青', '黒'].map((name) => file(name, '')) });
});

test('✂ の盤の ✂ は、説明の吹き出しの位置の基準を ✂ の丸にし、中に小さな黒い札を作らない（J15）', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.flush();
  sizeBoard(shell);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('split');
  await shell.SigK.tabs.openPath(A);
  await settle(shell);
  const cuts = [...shell.document.querySelectorAll('#split-board-canvas .sb-cut')];
  assert.equal(cuts.length, 2);
  assert.deepEqual(cuts.map((cut) => shell.SigK.tipView.anchorOf(cut).className), ['s', 's']);
  assert.deepEqual(cuts.map((cut) => cut.querySelector('.tip')), [null, null]);
  assert.deepEqual(cuts.map((cut) => [cut.dataset.tip, cut.getAttribute('aria-label')]), [['split.cut', 'ここで分ける'], ['split.cut', 'ここで分ける']]);
});

const copied = (pages = 1) => ({ ok: true, bytes: new Uint8Array(PDF), pages, sizes: Array.from({ length: pages }, () => ({ ...A4 })) });

test('名前の無い帯のフロッピーは名前を付けて保存の文、名前が付くとファイル名の入った上書き保存の文', async (t) => {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }), [SAVED]: makeSource({ path: SAVED }) },
    taskResults: [copied(1), { ok: true, path: SAVED, signature: { size: 9, mtimeMs: 9 } }],
    savePathResults: [{ path: SAVED }],
  });
  t.after(() => shell.cleanup());
  const { SigK, document } = shell;
  await shell.flush();
  await SigK.tabs.openPath(A);
  SigK.shell.setMode(document, 'tools');
  SigK.tools.select('merge');
  await settle(shell);
  // 帯 1 のページを受け口に落としたのと同じ（strip-drag の落とす先の「新しい帯」はこの口を呼ぶ）。
  assert.equal((await SigK.pageTransfer.toNewStrip([0])).ok, true);
  await settle(shell);
  const id = SigK.tabs.activeId();
  const head = () => document.querySelector(`#strips .strip[data-tab-id="${id}"] .strip-head`);
  const floppy = () => head().querySelector('.strip-btn[data-act="save"]');
  const tip = (node) => plain(SigK.tipContent.resolve(node));
  const tab = () => document.querySelector(`#tabbar .tab[data-tab-id="${id}"]`);

  assert.equal(floppy().dataset.tip, 'strip.saveAs');
  assert.equal(tip(floppy()).name, '名前を付けて保存');
  assert.equal(floppy().getAttribute('aria-label'), '名前を付けて保存', '読み上げの名前も説明の吹き出しの名前にそろえる');
  assert.deepEqual(tip(head().querySelector('.fname')), { name: '新しい PDF 1', desc: 'まだファイルになっていない新しい帯です。' });
  assert.deepEqual(tip(tab()), { name: '新しい PDF 1', desc: 'まだファイルになっていない新しい PDF です。' });
  const mergeName = () => document.querySelector(`#merge-list .merge-pick[data-tab-id="${id}"] .fname`);
  assert.deepEqual(tip(mergeName()), { name: '新しい PDF 1', desc: 'まだファイルになっていない新しい帯です。' }, '結合の欄のファイル名は帯と同じ説明');

  await SigK.save.saveActive();
  await settle(shell);
  assert.equal(SigK.tabs.isDirty(id), false, '保存すると普通の帯になる');
  assert.equal(floppy().dataset.tip, 'strip.save');
  assert.equal(floppy().getAttribute('aria-label'), '上書き保存');
  assert.deepEqual(tip(floppy()), {
    name: '上書き保存', desc: 'この帯のファイル（新しい PDF 1.pdf）に、今の変更を書き込みます。元の中身は「新しい PDF 1.pdf.bak」として残ります。',
    keys: ['Ctrl+S'], keysNote: '選んでいる帯',
  });
  assert.deepEqual(tip(head().querySelector('.fname')), { name: '新しい PDF 1.pdf', desc: SAVED });
  assert.deepEqual(tip(tab()), { name: '新しい PDF 1.pdf', desc: SAVED });
  assert.deepEqual(tip(mergeName()), { name: '新しい PDF 1.pdf', desc: SAVED });
});
