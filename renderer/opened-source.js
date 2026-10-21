(function (root) {
  'use strict';

  // 開いたあとでほかのアプリがファイルを書き換えたときの、保存・名前を付けて保存・抽出・帯のページを写すの元（spec-6-1 タスク C。決定81 ①）。
  //
  // ワーカーは書き出すたびに、元のファイルと差し込んだファイルをディスクから読み直す。画面の並び・書き込みの削除の参照・モザイクの画像は
  // 開いたときの中身を、差し込んだページは差し込んだときの中身を前提にしているので、ワーカーは読む前に印（大きさと更新時刻）を照らし、
  // 書き換えられていたら何もせず知らせる（元は { sourceChanged }、行き先の照合の食い違いは { changed }、差し込んだファイルは { insertChanged }）。
  // そのときだけ、pdf.js が持っているバイト列（getData()。元は開いた文書、差し込みは下見の文書）を写しにしてやり直す（確定事項C-3・C-8）。
  // ふだんは今のとおりディスクから読み、バイト列を送らない（決定81 ⑩の答えの選択肢に書いたとおり）。

  const KEY = 'opened';

  function unreadable(label, { insert = false } = {}) {
    return insert
      ? `差し込んだあとで差し込んだファイルがほかのアプリで書き換えられていて、差し込んだときの中身も読み出せなかったので、${label}できませんでした。元のファイルは変更していません。`
      : `開いたあとで元のファイルがほかのアプリで書き換えられていて、開いたときの中身も読み出せなかったので、${label}できませんでした。元のファイルは変更していません。`;
  }

  // 元のファイル（か行き先）が書き換えられていたか。差し込んだファイルだけのときは含めない（確認の窓を出すかを分ける）。
  function isSourceChanged(result) {
    return result?.sourceChanged === true || result?.changed === true;
  }

  function isChanged(result) {
    return isSourceChanged(result) || result?.insertChanged === true;
  }

  // pdf.js の文書のバイト列を読む。読めなければ、どちら（元 'source' か差し込み 'insert'）が読めなかったかを添えて投げる（文を選ぶため。点検の直し M-3）。
  async function readData(doc, part) {
    try {
      return await doc.getData();
    } catch (error) {
      throw Object.assign(new Error('開いたとき・差し込んだときの中身を読み出せませんでした'), { part, cause: error });
    }
  }

  // 並びにあるファイルの差し込みを、下見の文書のバイト列の写しに替える。1 つの文書（同じ下見の複数ページ）は 1 回だけ読む。
  async function snapshotInserts(spec, entries, copies) {
    const used = new Set((spec.pages ?? []).filter((page) => Number.isInteger(page?.insert)).map((page) => page.insert));
    const keys = new Map();
    const inserts = [];
    for (const [index, insert] of (spec.inserts ?? []).entries()) {
      const doc = entries[index]?.doc;
      if (!used.has(index) || typeof insert?.path !== 'string' || doc === undefined || doc === null) {
        inserts.push(insert);
        continue;
      }
      if (!keys.has(doc)) {
        const key = `${KEY}-insert-${keys.size + 1}`;
        copies[key] = await readData(doc, 'insert');
        keys.set(doc, key);
      }
      inserts.push({ copy: keys.get(doc), page: insert.page, size: insert.size });
    }
    return inserts;
  }

  // 書き換えられていた分を写しにした spec。パスのある元は開いたときの中身に、ファイルの差し込みは差し込んだときの中身に替える。
  // 行き先の照合（expect）は、確認の窓で了承を得たとき（asked）だけ外す（点検の直し M-2）。
  async function snapshotSpec(spec, session, asked) {
    const copies = { ...spec.copies };
    const redo = { ...spec, copies, expect: asked ? null : spec.expect ?? null, expectSource: null };
    if (typeof spec.source === 'string') {
      copies[KEY] = await readData(session.doc, 'source');
      redo.sourceCopy = KEY;
    }
    redo.inserts = await snapshotInserts(spec, session.inserts, copies);
    return redo;
  }

  // spec を回し、書き換えられていたら、開いたとき・差し込んだときの中身でもう一度回す。元のファイル（か行き先）が書き換えられていたときは、
  // その前に ask() を呼び、true でなければ { declined: true }。差し込みだけのやり直しで元が書き換えられていたら（{ changed }）、そこで聞く。
  // 読む文書は回す前に控える（確認の窓の間に別のタブへ移っても、回したタブから読む）。spec は label を含めて save.runTask へ渡す形。
  // 1 回目からやり直しまで保存の枠を押さえる（間にほかの保存・抽出・写すを入れない。点検の直し M-1）。
  function run(spec, { ask = async () => true } = {}) {
    return root.SigK.save.holding(() => runHeld(spec, ask));
  }

  async function runHeld(spec, ask) {
    const peeked = root.SigK.viewer.peek();
    const session = { doc: peeked?.doc ?? null, inserts: [...(peeked?.inserts ?? [])] };
    const result = await root.SigK.save.runTask(spec);
    if (!isChanged(result))
      return result;
    const asked = isSourceChanged(result);
    if (asked && (await ask()) !== true)
      return { declined: true };
    let redo;
    try {
      redo = await snapshotSpec(spec, session, asked);
    } catch (error) {
      root.SigK.log?.warn('opened-source', error.message, error.cause ?? error, { label: spec.label, part: error.part });
      return { error: unreadable(spec.label, { insert: error.part === 'insert' }) };
    }
    const next = await root.SigK.save.runTask(redo);
    if (asked || !isSourceChanged(next))
      return next;
    if ((await ask()) !== true)
      return { declined: true };
    return root.SigK.save.runTask({ ...redo, expect: null });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.openedSource = { KEY, isChanged, run, unreadable };
})(typeof window !== 'undefined' ? window : globalThis);
