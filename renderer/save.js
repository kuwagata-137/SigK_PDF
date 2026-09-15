(function (root) {
  'use strict';

  // 保存の指揮（spec-1-6 確定事項6〜9・23〜30）。
  //
  // 実際に書くのはワーカーである。ここは「何を、どこへ、どう書くか」を組み立て、
  // 進捗を帯へ流し、終わったあとの画面の後始末をする層に徹する。
  //
  // taskId をこちらで採番するのは、run() の完了を待たずに中止を押させるため
  // である。メイン側が採番すると「まだ id を知らないのに中止したい」が起こる。

  const state = { seq: 0, running: null };

  function viewer() {
    return root.SigK.viewer;
  }

  function banner() {
    return root.SigK.viewBanner;
  }

  function tabs() {
    return root.SigK.tabs;
  }

  function isBusy() {
    return state.running !== null;
  }

  // いま走っているものの名で断る。保存中に保存を押せば「いま保存しています」、
  // PDF→画像の最中なら「いま画像にしています」になる。
  function busyReason() {
    return `いま${state.running?.label ?? '保存'}しています。`;
  }

  function activeTab() {
    return tabs()?.list().find((info) => info.active) ?? null;
  }

  // 保存中は保存・名前を付けて保存・閉じる・終了を塞ぐ（確定事項9）。
  // タブをまたいだ同時保存は別プロセスなので干渉しないが、第1版では
  // 「映しているタブを保存する」1本しか入口が無いため、まとめて塞ぐ。
  function syncButtons(doc) {
    const target = doc ?? state.doc;
    if (target === undefined || target === null)
      return;
    const open = viewer().getState().open;
    // ツールモードでは押せない（spec-2-1 確定事項4）。保存は文書ではなく画面の話で、
    // ツールモードの画面には保存するものが無い。
    const toolsMode = target.documentElement?.getAttribute('data-mode') === 'tools';
    const button = target.getElementById('btn-save');
    if (button !== null)
      button.setAttribute('aria-disabled', String(!open || isBusy() || toolsMode));
    // 抽出もワーカーを回すので、保存中は一緒に塞ぐ。押せる・押せないを持つのは
    // page-edit.js（サイドパネルの操作列の持ち主）である。
    root.SigK.pageEdit?.syncActions();
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
  // 進捗の帯・中止・二重起動の防止を分けて持つと必ずずれるためである（確定事項9）。
  // ここが持つのは「回している間の画面」だけで、何を頼むかは呼び出し側が決める。
  async function runTask({ label, ...spec }) {
    const api = root.taskAPI;
    if (api?.available !== true)
      return { error: '保存の機能を使えません。' };

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
  // 帯・中止・二重起動の防止は runTask と同じ枠に載せる。走らせる枠を 2 つ持つと
  // 必ずずれる（確定事項9）。違いは中止の仕方だけで、ワーカーの kill ではなく旗を
  // 立て、run の中のループが旗を見て抜ける。
  //
  // run({ report, canceled }) は { ok, ... } / { canceled: true } / { error } を返す。
  //   report(done, of, unit) … 帯を「<label>しています（done / of unit）」に書き直す。
  //                            最後の値は lastProgress() から読める（中止までに書けた数）。
  //   canceled()             … 中止が押されたか。
  async function runLocal({ label, run }) {
    if (isBusy())
      return { error: busyReason() };

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
  // 「ファイルとの差分」{ add, remove } で渡す（spec-4-1 確定事項22）。
  function saveSpec({ source, target, makeBackup, expect }) {
    return {
      kind: 'save',
      source,
      pages: viewer().getPlan(),
      inserts: viewer().getInserts(),
      annotations: root.SigK.annotationState.toSaveSpec(viewer().getAnnotations()),
      target,
      makeBackup,
      expect,
    };
  }

  // 保存の1往復。外部で書き換えられていたら聞き直す（確定事項21）。
  async function writeTo({ source, target, makeBackup, name, label = '保存' }) {
    const file = viewer().getState().file;
    let result = await runTask({ ...saveSpec({ source, target, makeBackup, expect: signatureOf(file) }), label });

    if (result?.changed === true) {
      const ok = await root.SigK.confirmOverwrite.ask({ name: file?.name ?? null });
      if (!ok) {
        banner().show('保存を取りやめました。');
        return { canceled: true };
      }
      // 了承されたので、照合を外してもう一度回す。
      result = await runTask({ ...saveSpec({ source, target, makeBackup, expect: null }), label });
    }

    if (result?.canceled === true) {
      banner().show('保存を中止しました。元のファイルは変更していません。');
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
    if (moved) {
      const tab = activeTab();
      if (tab !== null)
        await tabs().rename(tab.id, { path: target, name });
    }
    const reopened = await viewer().reopen({ path: moved ? target : null, name: moved ? name : null });
    if (!reopened) {
      viewer().markSaved({
        path: moved ? target : null,
        name: moved ? name : null,
        signature: result.signature ?? null,
      });
    }
    banner().show('保存しました。', 2500);
    return result;
  }

  // ツールモードでは Ctrl+S / Ctrl+Shift+S も効かせない（spec-2-1 確定事項4・5）。
  // メニューの accelerator はモードを知らないので、ここで止める。
  function inToolsMode() {
    return state.doc?.documentElement?.getAttribute('data-mode') === 'tools';
  }

  // 上書き保存（Ctrl+S）。
  async function saveActive() {
    if (isBusy())
      return { error: busyReason() };
    if (inToolsMode())
      return { error: 'ツールモードでは保存できません。' };

    const view = viewer().getState();
    if (!view.open)
      return { error: '文書が開かれていません。' };
    const blocked = warnIfUnsaveable();
    if (blocked !== null)
      return { error: blocked };
    // dirty でなければ何もしない（確定事項24）。押せはするが、書く理由がない。
    if (!viewer().isDirty())
      return { ok: true, unchanged: true };

    return writeTo({
      source: view.file.path,
      target: view.file.path,
      // 上書きのときだけ .bak を作る（確定事項18・20）。
      makeBackup: true,
      name: view.file.name,
    });
  }

  // 名前を付けて保存（Ctrl+Shift+S）。dirty でなくても押せる（確定事項24）。
  async function saveAsActive() {
    if (isBusy())
      return { error: busyReason() };
    if (inToolsMode())
      return { error: 'ツールモードでは保存できません。' };

    const view = viewer().getState();
    if (!view.open)
      return { error: '文書が開かれていません。' };
    const blocked = warnIfUnsaveable();
    if (blocked !== null)
      return { error: blocked };

    const picked = await root.pdfAPI.pickSavePath({ defaultPath: view.file.path });
    if (picked?.canceled === true)
      return { canceled: true };
    if (typeof picked?.path !== 'string')
      return { error: picked?.error ?? '保存先を決められませんでした。' };

    return writeTo({
      source: view.file.path,
      target: picked.path,
      // 元ファイルを触らないので退避は要らない（確定事項18）。
      makeBackup: false,
      name: picked.path.split(/[\\/]/).pop(),
    });
  }

  function init(doc, win) {
    if (win.__sigkSaveReady === true)
      return false;
    win.__sigkSaveReady = true;
    state.doc = doc;

    doc.getElementById('btn-save')?.addEventListener('click', () => {
      if (doc.getElementById('btn-save').getAttribute('aria-disabled') !== 'true')
        saveActive();
    });

    root.taskAPI?.onProgress?.(onProgress);
    // メニューと Ctrl+S / Ctrl+Shift+S から届く合図（確定事項23・39）。
    root.pdfAPI?.onSaveRequest?.((mode) => (mode === 'saveAs' ? saveAsActive() : saveActive()));

    syncButtons(doc);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.save = { init, isBusy, runTask, runLocal, saveActive, saveAsActive, syncButtons, unsaveableReason, warnIfUnsaveable, lastProgress: () => state.progress ?? null };
})(typeof window !== 'undefined' ? window : globalThis);
