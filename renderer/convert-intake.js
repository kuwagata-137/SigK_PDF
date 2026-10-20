(function (root) {
  'use strict';

  // 画像→PDF の画像を足す所（spec-3-1 確定事項1・2・4〜7・9、spec-5-1 確定事項9・16〜19・21、spec-2-5 確定事項H7）。
  //
  // 画像の並び（state.rows）と設定は tools-convert.js が持ち、create(host) で受け取る。
  // host は { state, changed, redraw, clear, dirOf, doc }（doc は init のあとに決まるので関数で受ける）。

  const banner = () => root.SigK.viewBanner;
  const plan = () => root.SigK.convertPlan;
  const intake = () => root.SigK.launchIntake;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  // 読むのは tool-source.js の inspectImage（メインの image-io.js が先頭バイトだけ見る）。文言の続き「外してください」はこちらで足す。
  async function inspect(filePath) {
    const info = await root.SigK.toolSource.inspectImage(filePath);
    return info.ok === true ? info : { error: `${info.error}。外してください` };
  }

  const validPaths = (paths) => (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
  const limitMessage = () => `変換できるのは ${plan().MAX_INPUTS} ファイルまでです。`;

  function applyInfo(row, info) {
    row.pending = false;
    if (info.error !== undefined) {
      row.blocked = info.error;
      return;
    }
    Object.assign(row, { kind: info.kind, width: info.width, height: info.height, pages: info.pages ?? 1, name: info.name });
    row.frames = info.frames ?? [{ width: info.width, height: info.height }];
  }

  function create(host) {
    const { state } = host;
    let launchBatch = null;
    const batches = () => (launchBatch ??= intake().createBatchTracker());

    function newRow(filePath, batch) {
      state.seq += 1;
      return { id: `convert-${state.seq}`, path: filePath, name: baseName(filePath), kind: null, width: null, height: null, pages: 1, frames: null, blocked: null, pending: true, batch };
    }

    // batch を渡すと、右クリックの束の画像として、同じ束の中でファイル名の順の位置へ入れる（spec-5-1 確定事項16。結合と同じ）。
    // 渡さなければ末尾へ足す。足したら画像の帯に枠を付ける（spec-2-5 確定事項H7）。
    async function addPaths(paths, { batch = null, limitNotice = true } = {}) {
      // 実行中・保存中は足さない（並びが実行した中身と食い違う。点検で見つけた。受け口の［ファイルを選ぶ…］・ドロップから届く）。
      if (state.running || root.SigK.save?.isBusy() === true) {
        banner().show('変換の実行中は、画像を足せません。終わってから足してください。', { tone: 'warn' });
        return [];
      }
      const incoming = validPaths(paths);
      const room = plan().MAX_INPUTS - state.rows.length;
      if (incoming.length > room && limitNotice)
        banner().show(limitMessage());
      const added = incoming.slice(0, Math.max(0, room)).map((filePath) => newRow(filePath, batch));
      for (const row of added)
        state.rows.splice(batch === null ? state.rows.length : intake().insertAt(state.rows, batch, row.path), 0, row);
      if (added.length === 0)
        return [];
      // 出力フォルダーの既定は先頭画像の場所。ユーザーが変えたあとは追従しない（確定事項20）。設定の窓の「ファイルを書き出すときの、
      // 最初のフォルダ」に従う（spec-6-1 確定事項E-5。決定81 ⑨）。
      if (!state.folderTouched)
        state.folder = root.SigK.preferences?.initialFolder(host.dirOf(state.rows[0].path)) ?? host.dirOf(state.rows[0].path);
      host.changed({ rowsChanged: true });
      root.SigK.imageStrip?.select();
      await Promise.all(added.map(async (row) => applyInfo(row, await inspect(row.path))));
      host.redraw();
      return added.map((row) => row.id);
    }

    // `--to-pdf` の受け口（確定事項2・9・spec-5-1 確定事項9・16〜19・21）。結合の addFromLaunch と同じ決まりで、束の最初でだけ
    // 画面を切り替え、束の画像をファイル名の順に並べる。
    async function addFromLaunch(paths, { batch } = {}) {
      const { id, starts } = batches().enter(batch);
      if (starts) {
        root.SigK.shell.setMode(host.doc(), 'tools');
        root.SigK.tools.select('convert');
        if (intake().planIntake({ count: state.rows.length, executed: state.executed }) === 'replace')
          host.clear();
      }
      const incoming = validPaths(paths);
      const overflow = incoming.length > plan().MAX_INPUTS - state.rows.length;
      const ids = await addPaths(incoming, { batch: id, limitNotice: false });
      if (state.rows.filter((row) => row.batch === id).length >= 2 && batches().once('note'))
        banner().show(intake().NOTE_NAME_ORDER, { tone: 'warn' });   // 注意・お知らせは黄色（決定49）
      if (overflow && batches().once('limit'))
        banner().show(limitMessage());
      return ids;
    }

    return { addPaths, addFromLaunch };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.convertIntake = { create };
})(typeof window !== 'undefined' ? window : globalThis);
