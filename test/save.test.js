'use strict';

// 保存の指揮の層のテスト（spec-1-6 確定事項6〜9・21・23〜30）。
//
// 実際に書くのはワーカーで、その中身は test/pdf-task.test.js が見ている。
// ここは「何を、どこへ、どう頼むか」と「終わったあとの画面」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

async function withOpenDocument(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  return shell;
}

// 並べ替えて未保存にする。
function edit(SigK) {
  const original = SigK.viewer.getPlan();
  SigK.viewer.applyPlan(SigK.pagePlan.movePages(original, [0], 2).plan);
  return original;
}

// レンダラー（jsdom）側で作られた値は、Node 側のオブジェクトとは realm が違う。
// deepEqual は「構造は同じだが同一の型ではない」と言って落ちるので、
// 素の値へ写してから比べる。
const plain = (value) => structuredClone(value);

const okResult = (over = {}) => ({ ok: true, path: A, backup: `${A}.bak`, signature: { size: 2048, mtimeMs: 2000 }, ...over });

test('保存ボタンは文書が無ければ押せない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());

  assert.equal(shell.document.getElementById('btn-save').getAttribute('aria-disabled'), 'true');
});

test('文書を開くと保存ボタンが押せるようになる', async (t) => {
  const shell = await withOpenDocument(t);

  assert.equal(shell.document.getElementById('btn-save').getAttribute('aria-disabled'), 'false');
});

test('上書き保存は、いまの並びと元のパスをワーカーへ渡す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });
  edit(shell.SigK);
  const edited = plain(shell.SigK.viewer.getPlan());

  const result = await shell.SigK.save.saveActive();
  assert.equal(result.ok, true);

  assert.equal(shell.taskCalls.length, 1);
  const { spec } = shell.taskCalls[0];
  assert.equal(spec.source, A);
  assert.equal(spec.target, A, '上書きなので行き先は同じ');
  // 上書きのときだけ .bak を作る（確定事項18・20）。
  assert.equal(spec.makeBackup, true);
  // 開いたときのサイズと更新時刻を控えて渡す（確定事項21）。
  assert.deepEqual(spec.expect, { size: 1024, mtimeMs: 1000 });
  assert.deepEqual(spec.pages, edited);
  // 注釈は「ファイルとの差分」で渡す（spec-4-1 確定事項22）。編集していなければ空。
  assert.deepEqual(spec.annotations, { add: [], remove: [] });
  assert.equal(spec.ops, undefined, 'ops は誰も読まなかったので送らない');
});

// 保存に成功したら保存先を開き直す（spec-4-1 確定事項20。spec-1-6 確定事項27〜29 を改めた）。
test('保存に成功すると保存先を開き直し、並びは連番へ戻り、履歴は空になる', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });
  edit(shell.SigK);
  // 履歴に積む経路（commit）も通しておく。
  shell.SigK.pageEdit.rotate(90, [0]);
  shell.SigK.viewer.setZoom(1.5);
  assert.equal(shell.SigK.pageEdit.canUndo(), true);
  const before = shell.pdfjs.documents.length;

  await shell.SigK.save.saveActive();
  await shell.flush();

  // 新しい文書が開かれ、前の文書は畳まれている。
  assert.equal(shell.pdfjs.documents.length, before + 1);
  assert.equal(shell.pdfjs.documents[before - 1].destroyed, true);
  assert.deepEqual(plain(shell.SigK.viewer.getPlan()), [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }, { src: 2, rotate: 0 }]);
  assert.equal(shell.SigK.viewer.isDirty(), false);
  assert.equal(shell.SigK.pageEdit.canUndo(), false, '保存前へは戻れない');
  // 倍率は保つ。
  assert.equal(shell.SigK.viewer.getState().zoom, 1.5);
});

test('保存に成功すると未保存でなくなる', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });
  edit(shell.SigK);
  assert.equal(shell.SigK.viewer.isDirty(), true);

  await shell.SigK.save.saveActive();

  assert.equal(shell.SigK.viewer.isDirty(), false);
  assert.match(shell.SigK.viewBanner.text(), /保存しました/);
});

// 通知バーの既定の色は失敗の赤（--danger）である。成功は失敗ではないので、進捗と同じ
// 知らせの色で出す（spec-1-6 確定事項6・30）。
test('保存に成功した知らせは、失敗の赤ではなく知らせの色で出す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });
  edit(shell.SigK);

  await shell.SigK.save.saveActive();

  assert.equal(shell.SigK.viewBanner.text(), '保存しました。');
  assert.equal(shell.document.getElementById('view-banner').getAttribute('data-tone'), 'info');
});

test('編集していなければ、上書き保存は何もしない', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });

  const result = await shell.SigK.save.saveActive();
  assert.deepEqual(plain(result), { ok: true, unchanged: true });
  assert.equal(shell.taskCalls.length, 0, 'ワーカーを起こさない');
});

test('文書を開いていなければ保存しない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());

  assert.match((await shell.SigK.save.saveActive()).error, /開かれていません/);
  assert.match((await shell.SigK.save.saveAsActive()).error, /開かれていません/);
});

test('名前を付けて保存は行き先を選ばせ、.bak を作らない', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult({ path: B })],
    savePathResults: [{ path: B }],
  });

  const result = await shell.SigK.save.saveAsActive();
  assert.equal(result.ok, true);

  assert.deepEqual(shell.savePathCalls[0], { defaultPath: A }, '元の場所を既定にする');
  const { spec } = shell.taskCalls[0];
  assert.equal(spec.source, A, '読むのは元のファイル');
  assert.equal(spec.target, B);
  // 元ファイルを触らないので退避は要らない（確定事項18）。
  assert.equal(spec.makeBackup, false);
});

test('名前を付けて保存すると、タブが新しいファイルへ移る', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult({ path: B })],
    savePathResults: [{ path: B }],
  });

  await shell.SigK.save.saveAsActive();
  await shell.flush();

  const tab = shell.SigK.tabs.list().find((info) => info.active);
  assert.equal(tab.path, B, '以後の上書き保存は新しいほうへ行く（確定事項26）');
  assert.equal(tab.name, 'b.pdf');
  assert.equal(shell.SigK.viewer.getState().file.path, B);
  // 最近使ったファイルにも新しいほうを載せる。
  assert.ok(shell.recentCalls.some((call) => call.kind === 'add' && call.entry.path === B));
});

test('保存先を選ばなければ何も起きない', async (t) => {
  const shell = await withOpenDocument(t, { savePathResults: [{ canceled: true }] });

  assert.deepEqual(plain(await shell.SigK.save.saveAsActive()), { canceled: true });
  assert.equal(shell.taskCalls.length, 0);
});

test('名前を付けて保存の保存先が別のタブで開いていれば、何も書かずに通知バーで断る（確定事項97）', async (t) => {
  // 保存するとこのタブが保存先へ移る（確定事項26）ので、同じパスのタブが 2 枚になってしまう。
  const shell = await withOpenDocument(t, {
    files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }), [B]: makeSource({ path: B }) },
    savePathResults: [{ path: 'c:/work/B.PDF' }],
  });
  await shell.SigK.tabs.openPath(B);
  await shell.SigK.tabs.openPath(A);
  await shell.flush();

  const result = await shell.SigK.save.saveAsActive();
  assert.equal(result.error, '保存先のファイルは別のタブで開いているので、そのタブを閉じるか、別の名前を選んでください。');
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(shell.SigK.viewBanner.text(), result.error);
  assert.deepEqual(plain(shell.SigK.tabs.list().map((tab) => tab.path)), [A, B]);
});

test('名前を付けて保存で映しているファイル自身を選ぶのは断らない', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult()],
    savePathResults: [{ path: A }],
  });

  const result = await shell.SigK.save.saveAsActive();
  assert.equal(result.ok, true);
  assert.equal(shell.taskCalls[0].spec.target, A);
});

test('進捗は通知バーに段の番号つきで出て、中止ボタンが付く', async (t) => {
  // 進捗を見るあいだ run を待たせる。
  let release = null;
  const shell = await withOpenDocument(t);
  shell.window.taskAPI.run = (taskId, spec) => {
    shell.taskCalls.push({ taskId, spec });
    return new Promise((resolve) => { release = () => resolve(okResult()); });
  };
  edit(shell.SigK);

  const promise = shell.SigK.save.saveActive();
  await shell.flush();

  assert.match(shell.SigK.viewBanner.text(), /保存しています/);
  const taskId = shell.taskCalls[0].taskId;
  shell.fireProgress({ taskId, phase: 'save', label: '書き出しています', step: 4, total: 5 });
  assert.match(shell.SigK.viewBanner.text(), /4\/5/);

  const cancel = shell.SigK.viewBanner.action();
  assert.notEqual(cancel, null, '中止を押す場所が要る（確定事項8）');
  cancel.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(shell.taskCancels, [taskId]);

  release();
  await promise;
});

test('別のタスクの進捗は混ざらない', async (t) => {
  const shell = await withOpenDocument(t);

  shell.fireProgress({ taskId: 'よそのタスク', phase: 'save', step: 4, total: 5 });
  assert.equal(shell.SigK.viewBanner.isVisible(), false);
});

test('保存中は保存ボタンを押せない', async (t) => {
  let release = null;
  const shell = await withOpenDocument(t);
  shell.window.taskAPI.run = () => new Promise((resolve) => { release = () => resolve(okResult()); });
  edit(shell.SigK);

  const promise = shell.SigK.save.saveActive();
  await shell.flush();
  assert.equal(shell.SigK.save.isBusy(), true);
  assert.equal(shell.document.getElementById('btn-save').getAttribute('aria-disabled'), 'true');
  assert.match((await shell.SigK.save.saveActive()).error, /いま保存しています/);

  release();
  await promise;
  assert.equal(shell.SigK.save.isBusy(), false);
  assert.equal(shell.document.getElementById('btn-save').getAttribute('aria-disabled'), 'false');
});

// 保存の入口から開き直しの終わりまで枠を押さえる（点検の直し）。ワーカーが終わってから開き直すまでの間に枠が空くと、
// 帯を押して別のタブを前に出せ、開き直しがそのタブの文書を差し替えてしまう。
test('保存は入口から開き直しの終わりまで isBusy で、その間はほかの処理を走らせない', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });
  const { SigK, window } = shell;
  edit(SigK);
  const read = window.pdfAPI.read;
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  window.pdfAPI.read = (filePath) => gate.then(() => read(filePath));

  const saving = SigK.save.saveActive();
  assert.equal(SigK.save.isBusy(), true, '押した瞬間から押さえる（モザイクの確かめの前）');
  for (let index = 0; index < 4; index += 1)
    await shell.flush();
  assert.equal(shell.taskCalls.length, 1, 'ワーカーは終わり、開き直しの読み込みを待っている');
  assert.equal(SigK.save.isBusy(), true, '開き直している間も押さえる');
  assert.equal(shell.document.getElementById('btn-save').getAttribute('aria-disabled'), 'true');

  release();
  assert.equal((await saving).ok, true);
  assert.equal(SigK.save.isBusy(), false);
  assert.equal(SigK.viewer.isDirty(), false);
});

test('保存の途中で別のタブへ移っても、開き直すのは保存したタブで、移った先のタブの中身は変わらない（点検の直し）', async (t) => {
  const shell = await withOpenDocument(t, { files: { [A]: makeSource({ path: A, mtimeMs: 1000 }), [B]: makeSource({ path: B, mtimeMs: 1000 }) } });
  const { SigK, window } = shell;
  await SigK.tabs.openPath(B);
  const [tabA, tabB] = SigK.tabs.list().map((tab) => tab.id);
  edit(SigK);   // B を未保存にする
  const docB = SigK.tabs.peek(tabB).doc;
  SigK.tabs.activate(tabA);
  edit(SigK);
  let release = null;
  window.taskAPI.run = () => new Promise((resolve) => { release = () => resolve(okResult()); });

  const saving = SigK.save.saveActive();
  await shell.flush();
  SigK.tabs.activate(tabB);   // タブの列で B へ移った
  release();
  assert.equal((await saving).ok, true);

  assert.equal(SigK.tabs.activeId(), tabA, '開き直すために保存したタブへ戻る');
  assert.equal(SigK.tabs.isDirty(tabA), false);
  assert.equal(SigK.tabs.isDirty(tabB), true, '移った先のタブの編集は残る');
  assert.equal(SigK.tabs.peek(tabB).doc, docB, '移った先のタブの文書は差し替えない');
  assert.equal(SigK.tabs.peek(tabB).file.path, B);
});

test('runTask・runLocal は、走っている処理があれば断り、busy を添える（点検の直し）', async (t) => {
  const shell = await withOpenDocument(t);
  let done = null;
  const local = shell.SigK.save.runLocal({ label: '画像に', run: () => new Promise((resolve) => { done = () => resolve({ ok: true }); }) });
  await shell.flush();

  const refused = await shell.SigK.save.runTask({ kind: 'flatten-preview', label: '書き込みを確認', source: A });
  assert.deepEqual(plain(refused), { error: 'いま画像にしています。', busy: true });
  assert.equal(shell.taskCalls.length, 0, 'ワーカーへは渡さない');
  done();
  await local;
});

test('中止したら、そのことを通知バーに出す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ canceled: true }] });
  edit(shell.SigK);

  assert.deepEqual(await shell.SigK.save.saveActive(), { canceled: true });
  assert.match(shell.SigK.viewBanner.text(), /中止しました/);
  assert.match(shell.SigK.viewBanner.text(), /元のファイルは変更していません/);
  // 自分で止めたので、失敗の赤ではなく青で出す（決定49）。
  assert.equal(shell.document.getElementById('view-banner').getAttribute('data-tone'), 'info');
  assert.equal(shell.SigK.viewer.isDirty(), true, '書いていないので未保存のままである');
});

test('失敗したら、ワーカーの文言をそのまま通知バーに出す', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ error: 'パスワードで保護された PDF は保存できません。' }],
  });
  edit(shell.SigK);

  const result = await shell.SigK.save.saveActive();
  assert.match(result.error, /パスワードで保護された/);
  assert.match(shell.SigK.viewBanner.text(), /パスワードで保護された/);
  assert.equal(shell.SigK.viewer.isDirty(), true);
});

test('外から書き換えられていたら聞き、了承すれば照合を外してもう一度書く', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ changed: true, current: { size: 9, mtimeMs: 9 } }, okResult()],
  });
  edit(shell.SigK);

  const promise = shell.SigK.save.saveActive();
  await shell.flush();

  assert.equal(shell.SigK.confirmOverwrite.isOpen(), true);
  assert.match(shell.document.getElementById('confirm-overwrite-text').textContent, /a\.pdf/);
  shell.document.getElementById('confirm-overwrite-ok').click();

  assert.equal((await promise).ok, true);
  assert.equal(shell.taskCalls.length, 2);
  assert.deepEqual(shell.taskCalls[0].spec.expect, { size: 1024, mtimeMs: 1000 });
  assert.equal(shell.taskCalls[1].spec.expect, null, '了承されたので照合を外す');
});

test('外から書き換えられていて、取りやめたら書かない', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ changed: true, current: { size: 9, mtimeMs: 9 } }],
  });
  edit(shell.SigK);

  const promise = shell.SigK.save.saveActive();
  await shell.flush();
  shell.document.getElementById('confirm-overwrite-cancel').click();

  assert.deepEqual(plain(await promise), { canceled: true });
  assert.equal(shell.taskCalls.length, 1);
  assert.equal(shell.SigK.viewBanner.text(), '保存を取りやめました。');
  // 確認で自分が「やめる」を選んだので、失敗の赤ではなく青で出す（決定49）。
  assert.equal(shell.document.getElementById('view-banner').getAttribute('data-tone'), 'info');
  assert.equal(shell.SigK.viewer.isDirty(), true);
});

test('メニューの合図から保存できる', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult(), okResult({ path: B })],
    savePathResults: [{ path: B }],
  });
  edit(shell.SigK);

  shell.fireSaveRequest('save');
  await shell.flush();
  assert.equal(shell.taskCalls[0].spec.target, A);

  edit(shell.SigK);
  shell.fireSaveRequest('saveAs');
  await shell.flush();
  assert.equal(shell.taskCalls[1].spec.target, B);
});

test('保存したあと、2回目の上書きは開き直したファイルの署名で照合し、並びを二重に当てない', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult(), okResult()] });
  edit(shell.SigK);
  // 書き直されたファイルを装う。開き直しがこれを読む。
  shell.files[A] = makeSource({ path: A, name: 'a.pdf', size: 2048, mtimeMs: 2000 });
  await shell.SigK.save.saveActive();
  await shell.flush();

  // もう一度編集して保存する。並びは連番から始まるので、前の並べ替えは混ざらない
  // （spec-4-1 事前調査 F の不具合の再現が緑になること）。
  shell.SigK.viewer.applyPlan(shell.SigK.pagePlan.rotatePages(shell.SigK.viewer.getPlan(), [0], 90));
  await shell.SigK.save.saveActive();

  assert.deepEqual(shell.taskCalls[1].spec.expect, { size: 2048, mtimeMs: 2000 }, '書いた直後の署名で照合する');
  assert.deepEqual(shell.taskCalls[1].spec.pages, [{ src: 0, rotate: 90 }, { src: 1, rotate: 0 }, { src: 2, rotate: 0 }]);
});

// ---- レンダラーの中で回す枠（spec-3-3 確定事項17）----

test('runLocal は通知バーと中止を出し、走っている間は isBusy になる', async (t) => {
  const shell = await withOpenDocument(t);
  let release = null;
  let seen = null;

  const promise = shell.SigK.save.runLocal({
    label: '画像に',
    run: (frame) => new Promise((resolve) => {
      seen = frame;
      release = () => resolve({ ok: true, written: 3 });
    }),
  });
  await shell.flush();

  assert.equal(shell.SigK.save.isBusy(), true);
  assert.match(shell.SigK.viewBanner.text(), /画像にしています/);
  assert.equal(shell.SigK.viewBanner.action()?.textContent, '中止');
  assert.match((await shell.SigK.save.saveActive()).error, /いま画像にしています/);

  // 進捗はページ単位で通知バーに出て、最後の値は lastProgress から読める。
  seen.report(3, 12);
  assert.match(shell.SigK.viewBanner.text(), /画像にしています（3 \/ 12 ページ）/);
  assert.deepEqual(plain(shell.SigK.save.lastProgress()), { taskId: 'local-1', phase: 'write', done: 3, of: 12, unit: 'ページ' });

  // 中止はワーカーの kill ではなく旗である。
  assert.equal(seen.canceled(), false);
  shell.SigK.viewBanner.action().dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.equal(seen.canceled(), true);
  assert.deepEqual(shell.taskCancels, [], 'taskAPI.cancel は呼ばない');

  release();
  assert.deepEqual(plain(await promise), { ok: true, written: 3 });
  assert.equal(shell.SigK.save.isBusy(), false);
});

test('runLocal はワーカーのタスクと同時には走らず、逆も同じ', async (t) => {
  const shell = await withOpenDocument(t);
  let release = null;
  shell.window.taskAPI.run = () => new Promise((resolve) => { release = () => resolve(okResult()); });
  edit(shell.SigK);

  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  assert.match((await shell.SigK.save.runLocal({ label: '画像に', run: async () => ({ ok: true }) })).error, /いま保存しています/);
  release();
  await saving;

  let done = null;
  const local = shell.SigK.save.runLocal({ label: '画像に', run: () => new Promise((resolve) => { done = () => resolve({ ok: true }); }) });
  await shell.flush();
  assert.match((await shell.SigK.save.runLocal({ label: '画像に', run: async () => ({ ok: true }) })).error, /いま画像にしています/);
  done();
  await local;
});

test('runLocal は run が投げても枠を戻し、理由を返す', async (t) => {
  const shell = await withOpenDocument(t);

  const result = await shell.SigK.save.runLocal({ label: '画像に', run: async () => { throw new Error('描けない'); } });

  assert.deepEqual(plain(result), { error: '描けない' });
  assert.equal(shell.SigK.save.isBusy(), false);
});
