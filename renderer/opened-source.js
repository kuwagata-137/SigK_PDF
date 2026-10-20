(function (root) {
  'use strict';

  // 開いたあとでほかのアプリが元のファイルを書き換えたときの、保存・名前を付けて保存・抽出・帯のページを写すの元（spec-6-1 タスク C。決定81 ①）。
  //
  // ワーカーは書き出すたびに元のファイルをディスクから読み直す。画面の並び・書き込みの削除の参照・モザイクの画像は開いたときの中身を
  // 前提にしているので、ワーカーは読む前に元の印（大きさと更新時刻）を照らし、書き換えられていたら何もせず { sourceChanged: true } を返す
  // （行き先の照合に食い違ったときは { changed: true }）。そのときだけ、pdf.js が持っている開いたときのバイト列（getData()）を鍵 'opened' の
  // 写しで渡してやり直す（確定事項C-3）。ふだんは今のとおりディスクから読み、バイト列を送らない（決定81 ⑩の答えの選択肢に書いたとおり）。

  const KEY = 'opened';

  function unreadable(label) {
    return `開いたあとで元のファイルがほかのアプリで書き換えられていて、開いたときの中身も読み出せなかったので、${label}できませんでした。元のファイルは変更していません。`;
  }

  // ワーカーが書き換えを知らせたか。
  function isChanged(result) {
    return result?.sourceChanged === true || result?.changed === true;
  }

  // spec を回し、書き換えられていたら ask() が true を返したときだけ、開いたときの中身でもう一度回す。ask() が true でなければ { declined: true }。
  // 読む文書は回す前に控える（確認の窓の間に別のタブへ移っても、回したタブの文書から読む）。spec は label を含めて save.runTask へ渡す形。
  async function run(spec, { ask = async () => true } = {}) {
    const doc = root.SigK.viewer.peek()?.doc ?? null;
    const result = await root.SigK.save.runTask(spec);
    if (!isChanged(result))
      return result;
    if ((await ask()) !== true)
      return { declined: true };
    let bytes;
    try {
      bytes = await doc.getData();
    } catch (error) {
      root.SigK.log?.warn('opened-source', '開いたときの中身を読み出せませんでした', error, { label: spec.label });
      return { error: unreadable(spec.label) };
    }
    return root.SigK.save.runTask({ ...spec, sourceCopy: KEY, copies: { ...spec.copies, [KEY]: bytes }, expect: null, expectSource: null });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.openedSource = { KEY, isChanged, run, unreadable };
})(typeof window !== 'undefined' ? window : globalThis);
