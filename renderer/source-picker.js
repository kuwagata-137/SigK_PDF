(function (root) {
  'use strict';

  // 1 つのファイルを対象にするツールの「対象」の欄（spec-4-5 確定事項34。論点11）。
  // 分割・PDF→画像・透かし・フラット化が同じ部品を使う。分割（spec-2-2 確定事項1〜6）と
  // PDF→画像（spec-3-3 確定事項1〜5）に同じ写しがあったものを、振る舞いを変えずに寄せた。
  //
  // 対象は { path, name, pageCount, blocked, note, pending, ...画面ごとの欄 }。画面ごとの欄は
  // inspect の結果から fieldsOf で取り出して載せる（PDF→画像の sizes など）。読んでいる間に
  // 差し替えられたら古い結果は捨てる。未保存のタブを対象にすることは止めず、注意だけ出す。

  const NOTE_UNSAVED = '未保存の編集は反映されません';
  const NOTE_FIRST_ONLY = '1つ目のファイルだけを対象にしました。';

  const banner = () => root.SigK.viewBanner;
  const tabs = () => root.SigK.tabs;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  // 配列の欄は 1 段だけ写す（呼んだ側が書き換えても中身が変わらないように）。
  function copyOf(source) {
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
  }

  //   inspect(path)        … tool-source.js の inspectPdf など。{ pageCount, name, ... } か { reason, error }
  //   pick({ defaultPath }) … 1 本選ぶダイアログ。{ path } / { canceled }。使えなければ null を返す
  //   dirtyMessage         … 未保存のタブを対象にしたときの帯の文言
  //   emptyFields・fieldsOf … 画面ごとの欄の初期値と、inspect の結果からの取り出し方
  //   onSelect(path)       … 対象が決まった直後（読む前）。出力フォルダーの既定を決めるのに使う
  //   onChange()           … 描き直しの合図
  function create({ inspect, pick, dirtyMessage, emptyFields = {}, fieldsOf = () => ({}), onSelect = () => {}, onChange = () => {} }) {
    let current = null;

    const source = () => (current === null ? null : copyOf(current));

    async function setSource(filePath, { dirty = false } = {}) {
      if (typeof filePath !== 'string' || filePath === '')
        return false;
      const next = { path: filePath, name: baseName(filePath), pageCount: null, ...emptyFields, blocked: null, note: dirty ? NOTE_UNSAVED : null, pending: true };
      current = next;
      onSelect(filePath);
      onChange();

      const info = await inspect(filePath);
      if (current !== next)
        return false;   // 読んでいる間に差し替えられた
      next.pending = false;
      if (info.reason !== undefined)
        next.blocked = `${info.error}。選び直してください`;
      else {
        next.pageCount = info.pageCount;
        Object.assign(next, fieldsOf(info));
        next.name = info.name;
      }
      onChange();
      return true;
    }

    async function useOpenTab() {
      const open = tabs()?.list() ?? [];
      const active = open.find((tab) => tab.active) ?? open[0];
      if (active === undefined || typeof active.path !== 'string') {
        banner().show('開いているファイルがありません。');
        return false;
      }
      const dirty = tabs().isDirty(active.id) === true;
      const ok = await setSource(active.path, { dirty });
      if (dirty)
        banner().show(dirtyMessage, { tone: 'warn' });   // 注意・お知らせは黄色（決定49）
      return ok;
    }

    async function pickFile() {
      const picked = await pick({ defaultPath: current?.path });
      if (picked === null || picked?.canceled === true || typeof picked?.path !== 'string')
        return false;
      return setSource(picked.path);
    }

    // ドロップと起動引数の受け口。対象は 1 つなので先頭だけ使う。
    async function addPaths(paths) {
      const incoming = (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
      if (incoming.length === 0)
        return false;
      const ok = await setSource(incoming[0]);
      if (incoming.length > 1)
        banner().show(NOTE_FIRST_ONLY, { tone: 'warn' });
      return ok;
    }

    return { source, setSource, useOpenTab, pickFile, addPaths };
  }

  // 「対象」の欄を描く。elements は { file, name, pages, note, empty }。
  function render(elements, src) {
    elements.file.hidden = src === null;
    elements.empty.hidden = src !== null;
    if (src === null)
      return;
    elements.name.textContent = src.name;
    elements.file.title = src.path;
    elements.pages.textContent = src.pending ? '…' : (src.pageCount === null ? '' : `${src.pageCount} ページ`);
    elements.file.classList.toggle('blocked', src.blocked !== null);
    const note = src.blocked ?? src.note;
    elements.note.textContent = note ?? '';
    elements.note.hidden = note === null || note === undefined;
    elements.note.classList.toggle('error', src.blocked !== null);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.sourcePicker = { NOTE_UNSAVED, NOTE_FIRST_ONLY, create, render };
})(typeof window !== 'undefined' ? window : globalThis);
