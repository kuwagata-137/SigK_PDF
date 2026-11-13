(function (root) {
  'use strict';

  // コピー・切り取りしたページの中身（spec-7-5 確定事項M4）。Windows のクリップボードには入れず、アプリの中だけで持つ。
  //
  // ［コピー］［切り取り］を押した時点の内容（保存していない並べ替え・回転・トリミング・書き込みを含む）を、ワーカーで PDF のバイト列にして持つ
  // （page-copy-build.js の build。開かずにバイト列だけ）。貼り付けのたびに、そのバイト列を新しい写しとして pdf.js で開き直す（reopen）。
  // バイト列を持つので、元の帯を閉じても・編集しても貼り付けられ、何度でも貼り付けられる。新しくコピー・切り取りすると置き換わり、
  // アプリを終了すると消える。

  const state = {
    // { bytes, sizes } か null。
    held: null,
    // 写しを作っている途中か（その間はメニューを出さず、キーも何もしない。P2）。
    building: false,
  };

  function has() {
    return state.held !== null;
  }

  function count() {
    return state.held?.sizes.length ?? 0;
  }

  function isBusy() {
    return state.building;
  }

  // indices（映しているタブの並びの位置）のページの写しを作って持つ。keep() が false を返したら（作っている途中にページの並びが
  // 変わったなど）、持たずに { canceled: true } を返す。戻り値は build と同じ形（{ ok, bytes, sizes } / { error } / { canceled }）。
  async function capture(indices, { keep = () => true } = {}) {
    state.building = true;
    try {
      const built = await root.SigK.pageCopyBuild.build(indices, { open: false });
      if (built.ok !== true)
        return built;
      if (!keep())
        return { canceled: true };
      state.held = { bytes: built.bytes, sizes: built.sizes };
      return built;
    } finally {
      state.building = false;
    }
  }

  // 貼り付ける写し（{ ok, copy, bytes, sizes, doc } か { error }）。持っていなければ null。
  async function open() {
    if (state.held === null)
      return null;
    return root.SigK.pageCopyBuild.reopen(state.held.bytes, state.held.sizes);
  }

  function clear() {
    state.held = null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageClipboard = { has, count, isBusy, capture, open, clear };
})(typeof window !== 'undefined' ? window : globalThis);
