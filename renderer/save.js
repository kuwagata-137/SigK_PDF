(function (root) {
  'use strict';

  // 保存の指揮（spec-1-6 確定事項6〜9・23〜30）。
  //
  // 実際に書くのはワーカーである。ここは「何を、どこへ、どう書くか」を組み立て、
  // 進捗を通知バーへ流し、終わったあとの画面の後始末をする層に徹する。
  //
  // taskId をこちらで採番するのは、run() の完了を待たずに中止を押させるため
  // である。メイン側が採番すると「まだ id を知らないのに中止したい」が起こる。

  // holds は、保存の入口から開き直しの終わりまで枠を押さえている数（holding）。
  const state = { seq: 0, running: null, holds: 0 };

  function viewer() {
    return root.SigK.viewer;
  }

  function banner() {
    return root.SigK.viewBanner;
  }

  function tabs() {
    return root.SigK.tabs;
  }

  // モザイクのページを画像にする層（spec-4b-6b）。読み込まれていなければ、モザイクは無いものとして扱う。
  function mosaicSave() {
    return root.SigK.mosaicSave ?? { prepare: async () => ({ ok: true, mosaics: [] }) };
  }

  function isBusy() {
    return state.running !== null || state.holds > 0;
  }

  // いま走っているものの名で断る。保存中に保存を押せば「いま保存しています」、
  // PDF→画像の最中なら「いま画像にしています」になる。
  function busyReason() {
    return `いま${state.running?.label ?? '保存'}しています。`;
  }

  // runTask・runLocal の断り。busy を添えるのは、後回しにできる処理（フラット化の数え）が「断られた」と「失敗した」を見分けるため。
  function refusal() {
    return { error: busyReason(), busy: true };
  }

  // 保存の入口から開き直しの終わりまで、枠を押さえる（点検の直し）。モザイクの確かめ・ワーカー・開き直しの間に枠が空くと、
  // 帯を押して別のタブを前に出せたり（開き直しがそのタブの文書を差し替える）、フラット化の数えが保存と同時に走ったり
  // （走っている処理の記録を上書きする）する。押さえている間に保存自身が回す runTask・runLocal は通す（断るのは走っている処理が
  // あるときだけ）。ほかの入口（ツール・抽出・挿入・数え）は、走らせる前に isBusy を見る。
  async function holding(work) {
    state.holds += 1;
    syncButtons();
    try {
      return await work();
    } finally {
      state.holds -= 1;
      syncButtons();
    }
  }

  function activeTab() {
    return tabs()?.list().find((info) => info.active) ?? null;
  }

  // ツールバーの［上書き保存］と［名前を付けて保存］（id → 押したときの処理。spec-2-5 確定事項B4）。
  // viewer-controls.js の DOCUMENT_CONTROLS には入れない（押すたびに窓が 2 回出る）。
  const SAVE_BUTTONS = { 'btn-save': () => saveActive(), 'btn-save-as': () => saveAsActive() };

  // 保存中は保存・名前を付けて保存・閉じる・終了を塞ぐ（確定事項9）。
  // タブをまたいだ同時保存は別プロセスなので干渉しないが、第1版では
  // 「映しているタブを保存する」1本しか入口が無いため、まとめて塞ぐ。
  // ツールモードでも押せる（2026-10-14 の決定。spec-2-1 確定事項4 を改めた）。保存するのは映しているタブである。
  function syncButtons(doc) {
    const target = doc ?? state.doc;
    if (target === undefined || target === null)
      return;
    const disabled = String(!viewer().getState().open || isBusy());
    for (const id of Object.keys(SAVE_BUTTONS))
      target.getElementById(id)?.setAttribute('aria-disabled', disabled);
    // 抽出もワーカーを回すので、保存中は一緒に塞ぐ。押せる・押せないを持つのは
    // page-edit.js（サイドパネルの操作列の持ち主）である。
    root.SigK.pageEdit?.syncActions();
    // ツールの［実行…］も、走っている間は押せない（各ツールの canRun）。押せる・押せないを持つのは各ツールの
    // 画面なので、見えているツールの画面を描き直してもらう（計画外の直し）。
    root.SigK.tools?.renderShown?.();
  }

  // 保存できない文書か（確定事項12・70）。パスワードを聞いて開いた文書を
  // `ignoreEncryption` で保存するとファイルが壊れる（実測E）ので、**成功した
  // ように見せてはならない**。閲覧・検索・印刷・ページ編集はできる。
  //
  // ワーカー側にも同じ判定がある（確定事項11）。あちらは防具で、こちらは
  // 「押す前から分かっていることを、押す前に伝える」ためのものである。
  function unsaveableReason() {
    return viewer()?.getState().file?.encrypted === true
      ? 'パスワードで保護された PDF は保存できません。'
      : null;
  }

  // ページモードに入った時点で伝えておく（確定事項70）。編集はできるので、
  // ひとしきり並べ替えたあとで初めて知るのでは遅い。
  function warnIfUnsaveable() {
    const reason = unsaveableReason();
    if (reason !== null)
      banner().show(reason);
    return reason;
  }

  // Windows のパスとして同じファイルかを比べる鍵（大文字小文字と区切りの字をそろえる。output-target.js と同じ）。
  function pathKey(filePath) {
    return String(filePath).replace(/\//g, '\\').toLowerCase();
  }

  function signatureOf(file) {
    if (file === null || file === undefined || file.mtimeMs === null || file.mtimeMs === undefined)
      return null;
    return { size: file.size, mtimeMs: file.mtimeMs };
  }

  // 押した瞬間から出す（確定事項7）。1秒を超えたら出す形にすると、出るか
  // 出ないかが文書によって変わり、中止を狙って押せない。
  function showRunning(label, taskId) {
    banner().show(`${label}しています`, {
      autoHideMs: 0,
      tone: 'info',
      action: { label: '中止', onClick: () => root.taskAPI?.cancel(taskId) },
    });
  }

  function onProgress(progress) {
    if (state.running === null || progress?.taskId !== state.running.taskId)
      return;
    // 最後に届いた進捗。中止したときに「何本まで書けたか」を分割が読む
    // （spec-2-2 確定事項25）。
    state.progress = progress;
    // 段の中で進むもの（結合）はファイル単位で出す（spec-2-1 確定事項22）。
    // 変換はページ単位で、ワーカーが unit を添える（spec-3-2 確定事項21）。
    const count = Number.isInteger(progress.done) && Number.isInteger(progress.of)
      ? `${progress.done} / ${progress.of} ${progress.unit ?? 'ファイル'}`
      : `${progress.step}/${progress.total}`;
    banner().show(`${state.running.label}しています（${count}）`, {
      autoHideMs: 0,
      tone: 'info',
      action: { label: '中止', onClick: () => root.taskAPI?.cancel(progress.taskId) },
    });
  }

  // ワーカーを1回だけ回す。**spec はそのままワーカーへ渡す。**
  //
  // 抽出（extract.js）と挿入（insert.js）もここを通す。走らせる枠は1つしかなく、
  // 進捗の通知バー・中止・二重起動の防止を分けて持つと必ずずれるためである（確定事項9）。
  // ここが持つのは「回している間の画面」だけで、何を頼むかは呼び出し側が決める。
  async function runTask({ label, ...spec }) {
    const api = root.taskAPI;
    if (api?.available !== true)
      return { error: '保存の機能を使えません。' };
    // 同時に回すと、走っている処理の記録を上書きする（点検の直し）。
    if (state.running !== null)
      return refusal();

    state.seq += 1;
    const taskId = `save-${state.seq}`;
    state.running = { taskId, label };
    state.progress = null;
    syncButtons();
    showRunning(label, taskId);

    try {
      return await api.run(taskId, spec);
    } finally {
      state.running = null;
      syncButtons();
    }
  }

  // レンダラーの中で回す処理の枠（spec-3-3 確定事項17）。
  //
  // PDF→画像は pdf.js の描画をレンダラーで行い、ワーカーを使わない。それでも
  // 通知バー・中止・二重起動の防止は runTask と同じ枠に載せる。走らせる枠を 2 つ持つと
  // 必ずずれる（確定事項9）。違いは中止の仕方だけで、ワーカーの kill ではなく旗を
  // 立て、run の中のループが旗を見て抜ける。
  //
  // run({ report, canceled }) は { ok, ... } / { canceled: true } / { error } を返す。
  //   report(done, of, unit) … 通知バーを「<label>しています（done / of unit）」に書き直す。
  //                            最後の値は lastProgress() から読める（中止までに書けた数）。
  //   canceled()             … 中止が押されたか。
  async function runLocal({ label, run }) {
    // 保存が押さえている間に、保存自身がモザイクのページを画像にする（mosaic-save.js）ので、押さえは見ない（holding）。
    if (state.running !== null)
      return refusal();

    state.seq += 1;
    const taskId = `local-${state.seq}`;
    const flags = { canceled: false };
    state.running = { taskId, label, local: true };
    state.progress = null;
    syncButtons();

    const cancelAction = { label: '中止', onClick: () => { flags.canceled = true; } };
    banner().show(`${label}しています`, { autoHideMs: 0, tone: 'info', action: cancelAction });
    const report = (done, of, unit = 'ページ') => {
      if (state.running?.taskId !== taskId)
        return;
      state.progress = { taskId, phase: 'write', done, of, unit };
      banner().show(`${label}しています（${done} / ${of} ${unit}）`, { autoHideMs: 0, tone: 'info', action: cancelAction });
    };

    try {
      const result = await run({ report, canceled: () => flags.canceled });
      return result ?? { error: `${label}できませんでした。` };
    } catch (error) {
      return { error: error?.message ?? String(error) };
    } finally {
      state.running = null;
      syncButtons();
    }
  }

  // 保存でワーカーへ渡す形（docs/02 2-3）。差し込みの控えも一緒に渡す
  // （確定事項65。plan の { insert } がこの配列の番号を指す）。注釈は
  // 「ファイルとの差分」{ add, remove } で渡す（spec-4-1 確定事項22）。モザイクのページの画像と、前の控えを消すかも渡す
  // （spec-4b-6b 確定事項20・23。mosaic-save.js）。パスのある文書は開いたときの元のファイルの印（expectSource）も渡し、ワーカーが
  // 読む前に照らす（spec-6-1 確定事項C-2。書き換えられていたら opened-source.js が開いたときの中身でやり直す）。
  function saveSpec({ source, target, makeBackup, expect, mosaics = [], dropBackup = false }) {
    return {
      kind: 'save',
      source,
      // 名前の無い帯（source が null）の中身と、帯から写したページは、バイト列を鍵ごとに渡す（spec-2-5 確定事項I4・I5）。
      sourceCopy: viewer().getState().file?.copy ?? null,
      copies: viewer().getCopies(),
      pages: viewer().getPlan(),
      inserts: viewer().getInserts(),
      // 新しい形のテキストは画面で決めた行を添える（spec-4b-4a 確定事項I1）。
      annotations: root.SigK.annotationState.toSaveSpec(viewer().getAnnotations(), { layoutOf: root.SigK.freeTextMetrics.layoutOfEntry }),
      target,
      makeBackup,
      expect,
      mosaics,
      dropBackup,
      expectSource: typeof source === 'string' ? signatureOf(viewer().getState().file) : null,
    };
  }

  // 保存したタブの文書を開き直す。開き直しは映しているタブの文書を差し替えるので、保存の途中で別のタブへ移っていたら、
  // 保存したタブへ戻してから開き直す（点検の直し）。開き直している間に移されたら（viewer.reopen が false）、戻してもう一度。
  // 保存したタブを閉じられた・戻せなかったら null（基準も更新しない。別のタブの基準を書き換えないため）。
  async function reopenSaved(tabId, args) {
    for (let tries = 0; tries < 3; tries += 1) {
      if (tabId !== null && activeTab()?.id !== tabId && tabs().activate(tabId) !== true)
        return null;
      const reopened = await viewer().reopen(args);
      if (reopened || tabId === null || activeTab()?.id === tabId)
        return reopened;
    }
    return null;
  }

  // 保存の1往復。ほかのアプリで書き換えられていたら、開いたときの中身で書き直す（spec-6-1 タスク C。opened-source.js）。
  async function writeTo({ source, target, makeBackup, name, label = '保存', mosaics = [], dropBackup = false }) {
    const file = viewer().getState().file;
    // 保存するタブと中身は、ここで控える（聞き直しの窓の間に別のタブへ移っても、同じものを書いて、同じタブを開き直す。点検の直し）。
    const tabId = activeTab()?.id ?? null;
    // 行き先の照合は元のファイルへ書くときだけ（確定事項21。spec-6-1 確定事項C-1。別のファイルは OS の保存の窓が置き換えを聞いている）。
    // 元へ書くときは、ほかのアプリの書き換えが消えるので、開いたときの中身で書き直す前に聞く（C-4）。
    const self = typeof source === 'string' && pathKey(source) === pathKey(target);
    const spec = saveSpec({ source, target, makeBackup, expect: self ? signatureOf(file) : null, mosaics, dropBackup });
    const ask = async () => !self || root.SigK.confirmOverwrite.ask({ name: file?.name ?? null });
    const result = await root.SigK.openedSource.run({ ...spec, label }, { ask });
    if (result?.declined === true) {
      // 自分で「やめる」を選んだので赤く塗らない（決定49）。
      banner().show('保存を取りやめました。', { tone: 'info' });
      return { canceled: true };
    }

    if (result?.canceled === true) {
      // 自分で止めたので赤く塗らない（決定49）。
      banner().show('保存を中止しましたが、元のファイルは変更していません。', { tone: 'info' });
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '保存できませんでした。');
      return result ?? { error: '保存できませんでした。' };
    }

    // 保存先を開き直す（spec-4-1 確定事項20。spec-1-6 確定事項29 を改めた）。
    // 画面は空にせず、倍率と位置を保ったまま文書だけ差し替える。開き直さないと
    // 2 回目の保存でワーカーが保存先を読んで plan をもう一度当ててしまう。
    // 読み直せなかったときは従来どおり基準だけを更新する（次の保存で気づける）。
    const moved = target !== source;
    if (moved && tabId !== null)
      await tabs().rename(tabId, { path: target, name });
    const reopened = await reopenSaved(tabId, { path: moved ? target : null, name: moved ? name : null });
    if (reopened === false) {
      viewer().markSaved({
        path: moved ? target : null,
        name: moved ? name : null,
        signature: result.signature ?? null,
      });
    }
    // 前の控えを消せなかったら、保存は成功のまま黄色の通知バーで知らせる（spec-4b-6b 確定事項23）。
    if (result.backupLeft === true) {
      banner().show('保存しましたが、控えのファイル（.bak）を消せませんでした。元の内容が残っているので、手で消してください。', { autoHideMs: 0, tone: 'warn' });
      return result;
    }
    // 成功は失敗ではないので赤く塗らない（確定事項6・30、決定48）。通知バーの既定の色は失敗の赤である。
    banner().show('保存しました。', { autoHideMs: 2500, tone: 'info' });
    return result;
  }

  // 上書き保存（Ctrl+S）。どのモードでも、映しているタブを保存する（ツールモードでも。2026-10-14 の決定。
  // spec-2-1 確定事項4・5 を改めた）。閉じる・終えるときの確認の「保存」（confirm-discard.js）もここを通る。
  async function saveActive() {
    if (isBusy())
      return { error: busyReason() };
    return holding(overwrite);
  }

  async function overwrite() {
    // 入力中のテキストは確定してから書く（spec-4-2 確定事項8）。
    root.SigK.annotate?.finishEditing();

    const view = viewer().getState();
    if (!view.open)
      return { error: '文書が開かれていません。' };
    // 名前の無い帯（新しい帯）は、上書きする先が無いので名前を付けて保存へ回す（spec-2-5 確定事項I4・D5）。
    if (view.file?.untitled === true)
      return saveAs();
    const blocked = warnIfUnsaveable();
    if (blocked !== null)
      return { error: blocked };
    // dirty でなければ何もしない（確定事項24）。押せはするが、書く理由がない。
    if (!viewer().isDirty())
      return { ok: true, unchanged: true };
    // モザイクがあれば、確認を出してページを画像にする（spec-4b-6b 確定事項18・19）。
    const mosaic = await mosaicSave().prepare({ mode: 'overwrite', name: view.file.name });
    if (mosaic.ok !== true)
      return mosaic;
    const mosaicked = mosaic.mosaics.length > 0;

    return writeTo({
      source: view.file.path,
      target: view.file.path,
      // 上書きのときだけ .bak を作る（確定事項18・20）。モザイクを含むときは作らず、前の控えも消す（決定64 ⑧）。
      makeBackup: !mosaicked,
      dropBackup: mosaicked,
      mosaics: mosaic.mosaics,
      name: view.file.name,
    });
  }

  // 名前を付けて保存の窓の既定。名前の無い帯は、引き始めた帯のファイルと同じフォルダの「新しい PDF 1.pdf」（spec-2-5 PR-4 の起草者の判断 I-h）。
  function defaultPathFor(file) {
    if (file?.untitled !== true)
      return file?.path;
    const name = `${file.name}.pdf`;
    return typeof file.folder === 'string' && file.folder !== '' ? `${file.folder}\\${name}` : name;
  }

  // 名前を付けて保存（Ctrl+Shift+S・ツールバーの［名前を付けて保存］）。dirty でなくても押せる（確定事項24）。
  async function saveAsActive() {
    if (isBusy())
      return { error: busyReason() };
    return holding(saveAs);
  }

  async function saveAs() {
    root.SigK.annotate?.finishEditing();

    const view = viewer().getState();
    if (!view.open)
      return { error: '文書が開かれていません。' };
    const blocked = warnIfUnsaveable();
    if (blocked !== null)
      return { error: blocked };

    const picked = await root.pdfAPI.pickSavePath({ defaultPath: defaultPathFor(view.file) });
    if (picked?.canceled === true)
      return { canceled: true };
    if (typeof picked?.path !== 'string')
      return { error: picked?.error ?? '保存先を決められませんでした。' };
    // 別のタブで開いているファイルへは保存しない（確定事項97）。保存するとこのタブが
    // そこへ移り（確定事項26）、同じパスのタブが 2 枚になるため。
    const refused = root.SigK.outputTarget.refusalForSaveAs(picked.path);
    if (refused !== null) {
      banner().show(refused);
      return { error: refused };
    }

    const name = picked.path.split(/[\\/]/).pop();
    // 開いているファイル自身を選んだら、モザイクの確認と控えは上書き保存と同じに扱う（元のファイルが変わり、前の控えに元の内容が残るため。
    // コードの点検で直した）。
    const self = pathKey(picked.path) === pathKey(view.file.path);
    // モザイクがあれば、確認を出してページを画像にする（spec-4b-6b 確定事項18・19。元のファイルは変えない）。
    const mosaic = await mosaicSave().prepare({ mode: self ? 'overwrite' : 'saveAs', name, sourceName: view.file.name });
    if (mosaic.ok !== true)
      return mosaic;

    return writeTo({
      source: view.file.path,
      target: picked.path,
      // 元ファイルを触らないので退避は要らない（確定事項18）。
      makeBackup: false,
      dropBackup: self && mosaic.mosaics.length > 0,
      mosaics: mosaic.mosaics,
      name,
    });
  }

  function init(doc, win) {
    if (win.__sigkSaveReady === true)
      return false;
    win.__sigkSaveReady = true;
    state.doc = doc;

    // ［保存］［名前を付けて保存］の押し下げは文書で受ける。ボタンが後から足されても同じ口で効く。
    doc.addEventListener('click', (event) => {
      const button = event.target?.closest?.('#btn-save, #btn-save-as');
      if (button === null || button === undefined || button.getAttribute('aria-disabled') === 'true')
        return;
      SAVE_BUTTONS[button.id]();
    });

    root.taskAPI?.onProgress?.(onProgress);
    // メニューと Ctrl+S / Ctrl+Shift+S から届く合図（確定事項23・39）。窓が開いている間は後ろの文書を保存しない（spec-4b-7a 点検の直し）。
    root.pdfAPI?.onSaveRequest?.((mode) => {
      if (doc.querySelector('dialog[open]') !== null)
        return;
      if (mode === 'saveAs')
        saveAsActive();
      else
        saveActive();
    });

    syncButtons(doc);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.save = { init, isBusy, holding, runTask, runLocal, saveActive, saveAsActive, signatureOf, syncButtons, unsaveableReason, warnIfUnsaveable, lastProgress: () => state.progress ?? null };
})(typeof window !== 'undefined' ? window : globalThis);
