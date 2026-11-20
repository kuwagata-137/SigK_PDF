'use strict';

// 並びを変えた時に、新しい絵を描き終えるまで前の絵を表示する（docs/07 決定99 ②。2026-11-17 の不具合「回転などで白く点滅する」）。
// 前は viewer.applyPlan が全部のページ枠を作り直し（描き終えた canvas も外す）、thumbnails.setPlan が全部のサムネイル枠を作り直していたので、
// pdf.js が描き終えるまで、ページとサムネイルの白い背景だけが見えていた。今は、変更前の絵を同じページの新しい枠に置き（回転・トリミングは
// 変換して表示する）、新しい絵を描き終えたら入れ替える。挿入・貼り付けで新しく入るページは、並びに入れる前に描いておく。
// jsdom には 2D コンテキストが無いので、試験の中だけ「描ける」ことにして canvas を貼らせる（zoom-keep-picture.test.js と同じ作法）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const PHOTO = 'C:\\work\\photo.jpg';
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
// pdf.js の annotationMode の ENABLE_STORAGE。ページの表示域（page-render.js）だけが、この値で描く（サムネイルは指定しない）。
const ENABLE_STORAGE = 3;

// mode は 'pages'（ページ編集モード）か 'annot'（編集モード）か 'view'。どのファイルも pages ページ（A4）。
async function openShell(t, { mode = 'pages', pages = 5, ...options } = {}) {
  const pdfjs = createPdfjsStub({ sizes: Array.from({ length: pages }, () => A4) });
  const files = Object.fromEntries([A, B].map((filePath) => [filePath, makeSource({ path: filePath, size: 1024, mtimeMs: 1000 })]));
  const shell = await createShell({ pdfjs, files, ...options });
  t.after(() => shell.cleanup());
  shell.window.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  shell.window.HTMLCanvasElement.prototype.getContext = () => ({});
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  await settle(shell);
  return { shell, pdfjs };
}

// 描き直しは requestAnimationFrame の後で、pdf.js の待ちを何段か挟む。
async function settle(shell) {
  await shell.flush();
  await shell.flush();
  await shell.flush();
}

const frames = (shell) => [...shell.document.querySelectorAll('#view-pages .pdf-page')];
const sheets = (shell) => [...shell.document.querySelectorAll('#thumbs .thumb > .sheet')];
// 枠に表示している絵（描き終えた絵か、前の絵の箱の中の絵）。無ければ null。
const pictureOf = (node) => node?.querySelector(':scope > canvas, :scope > .pdf-held > canvas') ?? null;
const pictures = (nodes) => nodes.map(pictureOf);
// 前の絵の箱に当てた transform（箱に入っていなければ null）。
const transformOf = (canvas) => (canvas?.parentElement?.classList.contains('pdf-held') ? canvas.parentElement.style.transform : null);
const matrixOf = (canvas) => transformOf(canvas)?.match(/^matrix\((.*)\)$/)?.[1].split(',').map(Number) ?? null;
// 変換の a・b・c・d が expected とほぼ同じか（枠の寸法を整数に丸めた分だけ、1 から少しずれる）。
function assertLinear(canvas, expected, label) {
  const matrix = matrixOf(canvas);
  assert.ok(matrix !== null, `${label}: 前の絵に変換を適用していない`);
  matrix.slice(0, 4).forEach((value, at) => assert.ok(Math.abs(value - expected[at]) < 0.01, `${label}: 変換 ${matrix} が ${expected} と違う`));
  return matrix;
}
const thumbDraws = (pdfjs) => pdfjs.renderCalls.filter((call) => call.annotationMode === undefined).length;
const pageDraws = (pdfjs) => pdfjs.renderCalls.filter((call) => call.annotationMode === ENABLE_STORAGE).length;

// どの枠にも、絵は 1 枚まで（前の絵と新しい絵を重ねない）。
function assertOnePicture(shell, label) {
  for (const node of [...frames(shell), ...sheets(shell)])
    assert.ok(node.querySelectorAll('canvas').length <= 1, `${label}: 1 つの枠に絵が 2 枚ある`);
}

// 描き終えた後は、前の絵の箱が残らず、描いた枠には新しい絵が 1 枚だけある。
function assertSettled(shell, label) {
  assert.equal(shell.document.querySelectorAll('.pdf-held').length, 0, `${label}: 描き終えた後も前の絵が残っている`);
  assertOnePicture(shell, label);
}

// 操作の前に絵があった枠の数（試験の前提）。ページの表示域で 2 枚以上、サムネイルで 4 枚以上を描いていること。
function assertDrawn(shell) {
  assert.ok(pictures(frames(shell)).filter(Boolean).length >= 2, '操作の前にページを 2 枚以上描いていない（試験の前提が崩れた）');
  assert.ok(pictures(sheets(shell)).filter(Boolean).length >= 4, '操作の前にサムネイルを 4 枚以上描いていない（試験の前提が崩れた）');
}

test('右回転の直後、回したページは前の絵を回転して表示し、ほかのページは同じ絵を新しい枠に表示する', async (t) => {
  const { shell } = await openShell(t);
  assertDrawn(shell);
  const oldFrames = frames(shell);
  const before = pictures(oldFrames);
  const thumbs = pictures(sheets(shell));

  assert.equal(shell.SigK.pageActions.rotate(90, [0]), true);

  assert.notEqual(frames(shell)[0], oldFrames[0], 'ページ枠を作り直していない（試験の前提が崩れた）');
  assert.deepEqual(pictures(frames(shell)), before, '回転の直後に、ページの表示域の前の絵が消えた（白い背景が見える）');
  assert.deepEqual(pictures(sheets(shell)), thumbs, '回転の直後に、サムネイルの前の絵が消えた');
  // 90 度回した変換（x' = -y + e、y' = x）。回していないページの絵は、変換せずに枠いっぱいに伸ばすか、そのまま移す。
  assertLinear(before[0], [0, 1, -1, 0], '回したページ');
  assertLinear(thumbs[0], [0, 1, -1, 0], '回したページのサムネイル');
  assert.equal(transformOf(before[1]) ?? '', '', '回していないページの絵に変換を適用した');
  assertOnePicture(shell, '回転の直後');

  await settle(shell);
  assertSettled(shell, '回転');
  assert.notEqual(pictureOf(frames(shell)[0]), before[0], '回したページを描き直していない');
  assert.notEqual(pictureOf(sheets(shell)[0]), thumbs[0], '回したページのサムネイルを描き直していない');
});

test('サムネイルは、見た目（回転・トリミング・モザイク）が同じページを描き直さない', async (t) => {
  const { shell, pdfjs } = await openShell(t);
  assertDrawn(shell);
  const thumbs = pictures(sheets(shell));
  const draws = thumbDraws(pdfjs);

  // 並べ替え（ドラッグと同じ経路）: 1 ページ目を 4 ページ目の前へ。どのページも見た目は変わらない。
  assert.equal(shell.SigK.pageTransfer.move([0], 3), true);
  await settle(shell);

  assert.equal(thumbDraws(pdfjs), draws, '並べ替えで、見た目が同じページのサムネイルを描き直した');
  assert.deepEqual(pictures(sheets(shell)), [thumbs[1], thumbs[2], thumbs[0], thumbs[3], thumbs[4]]);
  assertSettled(shell, '並べ替え');

  // 回転では、回したページのサムネイルだけを描き直す。
  shell.SigK.pageActions.rotate(90, [1]);
  await settle(shell);
  assert.equal(thumbDraws(pdfjs), draws + 1, '回したページのサムネイルだけを描き直していない');
});

test('並べ替えの直後、同じページの絵を新しい位置の枠に表示する（位置ではなくページで対応させる）', async (t) => {
  const { shell } = await openShell(t);
  const before = pictures(frames(shell));

  shell.SigK.pageTransfer.move([0], 3);

  const after = pictures(frames(shell));
  // 並びは 2・3・1・4・5 ページ目の順番になる。前に描いていたページの絵だけを比べる。
  [1, 2, 0, 3, 4].forEach((from, at) => {
    if (before[from] !== null && after[at] !== null)
      assert.equal(after[at], before[from], `${at + 1} 番目の枠に、違うページの絵がある`);
  });
  assert.equal(after[0], before[1], '1 番目の枠に 2 ページ目の絵が無い');
  assertOnePicture(shell, '並べ替えの直後');
});

test('削除の直後は後ろのページの絵を前に詰め、取り消しで戻ったページには削除する前の絵（控え）を表示する', async (t) => {
  const { shell } = await openShell(t);
  const before = pictures(frames(shell));
  assert.ok(before[0] !== null && before[1] !== null, '1・2 ページ目を描いていない（試験の前提が崩れた）');

  assert.equal(shell.SigK.pageActions.remove([0]), true);
  assert.equal(pictureOf(frames(shell)[0]), before[1], '削除の直後に、2 ページ目の絵を詰めた枠に表示していない');
  assertOnePicture(shell, '削除の直後');
  await settle(shell);
  assertSettled(shell, '削除');
  const shifted = pictureOf(frames(shell)[0]);

  assert.equal(shell.SigK.pageEdit.undo(), true);
  assert.equal(pictureOf(frames(shell)[0]), before[0], '取り消しで戻ったページに、削除する前の絵が無い');
  assert.equal(pictureOf(frames(shell)[1]), shifted, '取り消しの直後に、2 ページ目の絵が消えた');
  assertOnePicture(shell, '削除の取り消しの直後');
  await settle(shell);
  assertSettled(shell, '削除の取り消し');

  assert.equal(shell.SigK.pageEdit.redo(), true);
  assert.ok(pictureOf(frames(shell)[0]) !== null, 'やり直しの直後に、詰めた枠の絵が無い');
  await settle(shell);
  assertSettled(shell, '削除のやり直し');
});

test('切り取りと貼り付けの直後も白い枠を表示せず、貼り付けたページには先に描いた絵を表示する', async (t) => {
  const copied = { ok: true, bytes: new Uint8Array(PDF), pages: 1, sizes: [{ ...A4 }] };
  const { shell } = await openShell(t, { taskResults: [copied] });
  const list = shell.SigK.pageListTarget.thumbs();
  const before = pictures(frames(shell));

  const cut = await shell.SigK.pageListCommands.cut(list, [0]);
  assert.equal(cut.ok, true);
  assert.equal(pictureOf(frames(shell)[0]), before[1], '切り取りの直後に、2 ページ目の絵を詰めた枠に表示していない');
  await settle(shell);
  assertSettled(shell, '切り取り');

  const pasted = await shell.SigK.pageListCommands.paste(list, 0);
  assert.equal(pasted.ok, true);
  assert.equal(shell.SigK.viewer.getPlan()[0].insert, 0, '先頭に貼り付けていない');
  // 貼り付けたページは前の並びに無いので、並びに入れる前に描いた絵を表示する。
  assert.ok(pictureOf(frames(shell)[0]) !== null, '貼り付けた直後に、そのページの枠が白い');
  assert.ok(pictureOf(sheets(shell)[0]) !== null, '貼り付けた直後に、そのページのサムネイルが白い');
  assert.ok(pictureOf(frames(shell)[1]) !== null, '貼り付けた直後に、後ろのページの枠が白い');
  assertOnePicture(shell, '貼り付けの直後');
  await settle(shell);
  assertSettled(shell, '貼り付け');
});

// ［挿入］で写真を 1 ページ差し込む一式（insert.test.js と同じ形）。
function withPhoto() {
  return {
    insertSourceResults: [{ path: PHOTO }],
    taskResults: [{ ok: true, bytes: new Uint8Array(PDF), pages: [{ width: A4.width, height: A4.height }], kind: 'jpeg' }],
  };
}

test('［挿入］の直後、入れたページには先に描いた絵を表示し、ほかのページは前の絵を表示する', async (t) => {
  const { shell, pdfjs } = await openShell(t, withPhoto());
  const before = pictures(frames(shell));
  shell.SigK.pageGrid.setSelection([0]);
  const draws = pageDraws(pdfjs);

  const result = await shell.SigK.insert.run();

  assert.equal(result.ok, true);
  assert.equal(shell.SigK.viewer.getPlan()[0].insert, 0, '先頭に差し込んでいない');
  assert.ok(pageDraws(pdfjs) > draws, '入れる前に描いていない');
  const inserted = pictureOf(frames(shell)[0]);
  assert.ok(inserted !== null, '入れた直後に、入れたページの枠が白い');
  assert.ok(!before.includes(inserted), '入れたページの枠に、ほかのページの絵がある');
  assert.ok(pictureOf(sheets(shell)[0]) !== null, '入れた直後に、入れたページのサムネイルが白い');
  assert.equal(pictureOf(frames(shell)[1]), before[0], '入れた直後に、元の 1 ページ目の絵を後ろの枠に移していない');
  assertOnePicture(shell, '挿入の直後');

  await settle(shell);
  assertSettled(shell, '挿入');
  // 取り消し・やり直しでも、入れたページの絵（控え）を表示する。
  shell.SigK.pageEdit.undo();
  assertOnePicture(shell, '挿入の取り消しの直後');
  await settle(shell);
  shell.SigK.pageEdit.redo();
  assert.ok(pictureOf(frames(shell)[0]) !== null, 'やり直しの直後に、入れたページの枠が白い');
  await settle(shell);
  assertSettled(shell, '挿入のやり直し');
});

test('入れる前に描く時間が上限（500 ms）を過ぎたら、描画を取り消して、今までどおり入れる', async (t) => {
  const { shell, pdfjs } = await openShell(t, withPhoto());
  // 差し込む文書（次に開く文書）のページは、描き終わらないことにする。
  let cancelled = 0;
  const open = pdfjs.getDocument;
  pdfjs.getDocument = (options) => {
    const task = open(options);
    task.promise = task.promise.then((doc) => {
      const getPage = doc.getPage.bind(doc);
      doc.getPage = async (number) => ({
        ...(await getPage(number)),
        render: () => ({ promise: new Promise(() => {}), cancel: () => { cancelled += 1; } }),
      });
      return doc;
    });
    return task;
  };
  shell.SigK.pageGrid.setSelection([0]);

  const started = Date.now();
  const result = await shell.SigK.insert.run();
  const elapsed = Date.now() - started;

  assert.equal(result.ok, true);
  assert.equal(shell.SigK.viewer.getPlan()[0].insert, 0, '時間の上限を過ぎた後に差し込んでいない');
  assert.ok(elapsed >= 450 && elapsed < 3000, `差し込むまでの時間が上限と合わない: ${elapsed} ms`);
  assert.ok(cancelled >= 1, '時間の上限を過ぎた描画を取り消していない');
  assert.equal(pictureOf(frames(shell)[0]), null, '描けなかったページに、ほかのページの絵がある');
});

test('トリミングの直後は前の絵を切った範囲に合わせ、取り消しでは切る前の絵（控え）で余白まで覆う', async (t) => {
  const { shell } = await openShell(t, { mode: 'annot' });
  const original = pictureOf(frames(shell)[0]);
  assert.ok(original !== null, '1 ページ目を描いていない（試験の前提が崩れた）');

  assert.equal(shell.SigK.trimCommit.apply(0, [100, 200, 400, 600], 'page').count, 1);
  assert.equal(pictureOf(frames(shell)[0]), original, 'トリミングの直後に、前の絵が消えた');
  // 切った範囲の左上が枠の左上に来るように、前の絵を左上へずらす（大きさは変えない）。
  const [, , , , e, f] = assertLinear(original, [1, 0, 0, 1], 'トリミング');
  assert.ok(e < 0 && f < 0, `前の絵をずらしていない: ${e}, ${f}`);
  await settle(shell);
  assertSettled(shell, 'トリミング');
  const cropped = pictureOf(frames(shell)[0]);

  // 取り消し: 切った後の絵（切った範囲だけ）ではなく、切る前の絵を、変換せずに表示する。
  assert.equal(shell.SigK.pageEdit.undo(), true);
  assert.equal(pictureOf(frames(shell)[0]), original, 'トリミングの取り消しで、切る前の絵を表示していない（余白が白くなる）');
  assert.equal(transformOf(original), '', '切る前の絵に変換を適用した');
  assert.equal(original.parentElement.style.width, '100%');
  await settle(shell);
  assertSettled(shell, 'トリミングの取り消し');

  // やり直し: 切った後の絵を表示する。
  assert.equal(shell.SigK.pageEdit.redo(), true);
  assert.equal(pictureOf(frames(shell)[0]), cropped, 'トリミングのやり直しで、切った後の絵を表示していない');
  await settle(shell);
  assertSettled(shell, 'トリミングのやり直し');
});

test('編集モードの［右回転］の直後も、前の絵を回転して表示する', async (t) => {
  const { shell } = await openShell(t, { mode: 'annot' });
  const before = pictureOf(frames(shell)[0]);

  assert.equal(shell.SigK.pageActions.rotateCurrent(90), true);
  assert.equal(pictureOf(frames(shell)[0]), before);
  assertLinear(before, [0, 1, -1, 0], '編集モードの回転');
  await settle(shell);
  assertSettled(shell, '編集モードの回転');

  // 取り消しの直後は、回す前の絵（控え）を変換せずに表示する。
  const turned = pictureOf(frames(shell)[0]);
  shell.SigK.pageEdit.undo();
  assert.equal(pictureOf(frames(shell)[0]), before, '回転の取り消しで、回す前の絵を表示していない');
  assert.equal(transformOf(before), '', '回す前の絵に変換を適用した');
  assert.notEqual(pictureOf(frames(shell)[0]), turned);
  await settle(shell);
  assertSettled(shell, '回転の取り消し');
});

test('上書き保存の後に開き直した時も、同じ位置で寸法が同じページは、前の絵を枠いっぱいに表示する', async (t) => {
  const { shell } = await openShell(t, { mode: 'view' });
  const before = pictures(frames(shell));
  const thumbs = pictures(sheets(shell));

  assert.equal(await shell.SigK.viewer.reopen(), true);

  assert.deepEqual(pictures(frames(shell)), before, '開き直した直後に、前の絵が消えた');
  assert.deepEqual(pictures(sheets(shell)), thumbs, '開き直した直後に、サムネイルの前の絵が消えた');
  assert.equal(before[0].parentElement.style.width, '100%');
  await settle(shell);
  assertSettled(shell, '開き直し');
});

test('タブを移った時は控えを破棄する（取り消しで戻ったページに、前のタブで控えた絵を表示しない）', async (t) => {
  const { shell } = await openShell(t);
  const first = shell.SigK.tabs.activeId();
  shell.SigK.pageActions.remove([0]);
  await settle(shell);

  await shell.SigK.tabs.openPath(B);
  await settle(shell);
  shell.SigK.tabs.activate(first);
  await settle(shell);

  shell.SigK.pageEdit.undo();
  assert.equal(pictureOf(frames(shell)[0]), null, 'タブを移る前に控えた絵を表示した');
  assert.ok(pictureOf(frames(shell)[1]) !== null, '取り消しの直後に、2 ページ目の絵が消えた');
});

test('drawnPicture・drawnThumb は、今の並びと倍率で描き終えた絵だけを返す', async (t) => {
  const { shell } = await openShell(t, { mode: 'view' });
  const { viewer, thumbnails } = shell.SigK;
  const drawn = viewer.drawnPicture(0);
  assert.equal(drawn.canvas, pictureOf(frames(shell)[0]));
  assert.ok(drawn.viewport.width > 0 && drawn.page.pageNumber === 1);
  assert.deepEqual(structuredClone(drawn.plan), { src: 0, rotate: 0 });
  assert.equal(thumbnails.drawnThumb(0).canvas, pictureOf(sheets(shell)[0]));

  // 前の絵を表示している間（倍率を変えた直後・回転の直後）は返さない。
  viewer.setZoom(2);
  assert.equal(viewer.drawnPicture(0), null);
  await settle(shell);
  assert.equal(viewer.drawnPicture(0).canvas, pictureOf(frames(shell)[0]));
  viewer.applyPlan(shell.SigK.pagePlan.rotatePages(viewer.getPlan(), [0], 90));
  assert.equal(viewer.drawnPicture(0), null);
  assert.equal(thumbnails.drawnThumb(0), null);
  await settle(shell);
  assert.equal(viewer.drawnPicture(0).plan.rotate, 90);
  assert.equal(thumbnails.drawnThumb(0).plan.rotate, 90);
});
