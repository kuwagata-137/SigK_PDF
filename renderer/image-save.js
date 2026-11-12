(function (root) {
  'use strict';

  // 画像のタブの［上書き保存］と［名前を付けて保存］（spec-7-1 確定事項B1〜B6）。save.js の overwrite・saveAs が、画像のタブのときにここへ回す。
  //
  // 画像として書くときは、image-render.js が書き込みを焼き込んだ 1 枚を描き、imageAPI.write（main.js の image:write → image-io.js の
  // writeImage）が書く。走らせる枠は save.runLocal（通知バー・中止・二重起動の防止を PDF の保存と同じ枠に載せる）。書けたら、PDF の保存と
  // 同じくタブを保存先へ移して開き直す（save.finishSaved）。PDF を選んだときは、書き込みを注釈のまま PDF の保存の経路で書く（writePdf）。

  const MULTI_PAGE = 'ページが 2 ページ以上あるので、PDF で保存します。';

  function viewer() {
    return root.SigK.viewer;
  }

  function banner() {
    return root.SigK.viewBanner;
  }

  function tab() {
    return root.SigK.imageTab;
  }

  function save() {
    return root.SigK.save;
  }

  function pathKey(filePath) {
    return String(filePath).replace(/\//g, '\\').toLowerCase();
  }

  function baseName(filePath) {
    return String(filePath).split(/[\\/]/).pop();
  }

  function activeTabId() {
    return root.SigK.tabs?.list().find((info) => info.active)?.id ?? null;
  }

  function makesBackup() {
    return root.SigK.preferences?.current().backupBeforeOverwrite === true;
  }

  // 窓の間にタブが替わっていたら、別のタブの中身を書かない（save.js の saveAs と同じ）。
  function stillShowing(file) {
    if (viewer().getState().file === file)
      return true;
    banner().show('保存の途中でタブが替わったので、保存を取りやめました。もう一度押してください。', { tone: 'warn' });
    return false;
  }

  // 描いて書く 1 往復。{ ok, signature } / { changed } / { canceled } / { error }。
  function writeOnce(target, format, { makeBackup, expect }) {
    return save().runLocal({
      label: '保存',
      run: async ({ canceled }) => {
        const drawn = await root.SigK.imageRender.render(root.document, format);
        if (drawn.ok !== true)
          return drawn;
        if (canceled())
          return { canceled: true };
        const written = await root.imageAPI.write(target, drawn.bytes, { makeBackup, expect });
        return written ?? { error: '画像を書き込めませんでした。' };
      },
    });
  }

  // 画像として書く。開いたあとでほかのアプリが書き換えていたら、PDF と同じ確認の窓を出して、照合を外して書き直す（確定事項B1）。
  async function writeImage({ file, target, format, makeBackup, expect }) {
    const tabId = activeTabId();
    const name = baseName(target);
    let result = await writeOnce(target, format, { makeBackup, expect });
    if (result?.changed === true) {
      if ((await root.SigK.confirmOverwrite.ask({ name })) !== true) {
        banner().show('保存を取りやめました。', { tone: 'info' });
        return { canceled: true };
      }
      if (!stillShowing(file))
        return { changed: true };
      result = await writeOnce(target, format, { makeBackup, expect: null });
    }
    if (result?.canceled === true) {
      banner().show('保存を中止しましたが、元のファイルは変更していません。', { tone: 'info' });
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '保存できませんでした。');
      return result ?? { error: '保存できませんでした。' };
    }
    await save().finishSaved({ tabId, source: file.path, target, name, result });
    banner().show('保存しました。', { autoHideMs: 2500, tone: 'info' });
    return result;
  }

  // 焼き込んで上書きしてよいかを聞く（確定事項B6）。確認の窓で「次回から表示しない」を選んでいたら、聞かずに進める（spec-7-4 確定事項CF2）。
  async function confirmBurn(file, backup) {
    if (!root.SigK.confirmImageSave.shouldAsk())
      return true;
    if ((await root.SigK.confirmImageSave.ask({ name: file.name, backup })) === true)
      return true;
    banner().show('保存を取りやめました。', { tone: 'info' });
    return false;
  }

  // ［上書き保存］。PNG・JPEG で 1 ページなら確認のうえ同じ形式で書く。書けない形式・ページが 1 枚でないときは名前を付けて保存へ（確定事項B1・B3）。
  async function overwrite({ writePdf }) {
    const file = viewer().getState().file;
    if (!viewer().isDirty())
      return { ok: true, unchanged: true };
    const format = tab().overwriteFormatOf(file);
    if (format === null || !tab().canWriteImage(viewer().getPlan().length))
      return saveAs({ writePdf });
    const backup = makesBackup();
    if (!(await confirmBurn(file, backup)) || !stillShowing(file))
      return { canceled: true };
    return writeImage({ file, target: file.path, format, makeBackup: backup, expect: save().signatureOf(file) });
  }

  // ［名前を付けて保存］。PNG・JPEG・PDF から選ぶ（確定事項B2）。
  async function saveAs({ writePdf }) {
    const file = viewer().getState().file;
    const formats = tab().saveFormatsOf(file, viewer().getPlan().length);
    if (formats.length === 1)
      banner().show(MULTI_PAGE, { tone: 'warn' });
    const defaultPath = tab().defaultPathFor(file.path, formats[0]);
    const initialPath = await root.SigK.preferences?.resolvePath(defaultPath) ?? defaultPath;
    if (!stillShowing(file))
      return { changed: true };
    const picked = await root.pdfAPI.pickSavePath({ defaultPath: initialPath, formats });
    if (picked?.canceled === true)
      return { canceled: true };
    if (typeof picked?.path !== 'string')
      return { error: picked?.error ?? '保存先を決められませんでした。' };
    const refused = root.SigK.outputTarget.refusalForSaveAs(picked.path);
    if (refused !== null) {
      banner().show(refused);
      return { error: refused };
    }
    if (!stillShowing(file))
      return { changed: true };
    if (picked.format === 'pdf')
      return writePdf({ target: picked.path, name: baseName(picked.path) });
    // 開いている画像そのものを選んだら、上書き保存と同じに扱う（確認の窓と控え。確定事項B2）。
    if (pathKey(picked.path) === pathKey(file.path)) {
      const backup = makesBackup();
      if (!(await confirmBurn(file, backup)) || !stillShowing(file))
        return { canceled: true };
      return writeImage({ file, target: picked.path, format: picked.format, makeBackup: backup, expect: save().signatureOf(file) });
    }
    // 別のファイルは元の画像を変えないので確認しない。同名の置き換えは OS の保存の窓が聞いている。
    return writeImage({ file, target: picked.path, format: picked.format, makeBackup: false, expect: null });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageSave = { MULTI_PAGE, overwrite, saveAs };
})(typeof window !== 'undefined' ? window : globalThis);
