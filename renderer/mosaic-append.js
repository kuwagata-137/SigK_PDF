(function (root) {
  'use strict';

  // モザイクを 1 つ追加しただけのページの絵に、追加した範囲だけを塗る処理の順番と確認（決定99 ①）。ページの表示域（page-render.js）と
  // サムネイル（thumbnails.js）が共有する。塗る処理そのものは mosaic-region.js の paintAppended。
  //
  // - 続けて配置した時は、同じページへの塗りを順番に実行する（前の塗りが終わるまで、次の塗りを始めない）。
  // - 塗る前に、その絵がまだ枠に表示されていて、描いた時の並びの要素が塗る前の並びの要素と同じかを確認する。違えば、今の並びで描いた
  //   絵でない限り、今までどおり描き直す。
  // - 塗っている途中で倍率変更・取り消し・並びの変更が入ったら（owner.watch が返す関数が false）、塗った結果を書き込まず、記録も
  //   更新しない（新しい状態の絵は、その変更をした処理が描く）。
  //
  // owner の口:
  //   drawn(index)           今の並びと倍率で描き終えた絵 { canvas, viewport, page, plan }。無ければ null（drawnPicture・drawnThumb）
  //   current(index)         今の並びの要素
  //   watch(index, drawn)    塗った結果を書き込んでよい間 true を返す関数（呼んだ時の token と、枠に表示している絵を控えて比べる）
  //   paint(index, drawn, mosaic, alive)  mosaic の末尾の範囲だけを塗る。書き込めたら true（mosaicRegion.paintAppended）
  //   finish(index, plan)    塗り終えた後の処理（markDrawn。ページの表示域では、テキストレイヤーの作り直しも）。promise を返してよい
  //   redraw(index)          今までどおり描き直す（keepPicture で手放し、描画を予約する）
  //   report(error, index)   失敗の記録

  function samePlan(a, b) {
    return root.SigK.pagePlan.samePlan([a], [b]);
  }

  function create(owner) {
    // ページ位置 → そのページの塗りの順番（最後に予約した塗りの promise）。
    const queues = new Map();

    // index のページの並びの要素が before から after に変わった時、追加した範囲だけを塗る処理を予約する。予約したら true。
    // false なら、呼ぶ側が今までどおり描き直す（追加ではない・描き終えた絵が無い・絵の並びが before でない・塗れない）。
    function append(index, before, after) {
      if (root.SigK.pageMosaic.appendedItem(before, after) === null)
        return false;
      const queued = queues.get(index);
      if (queued === undefined && !ready(owner.drawn(index), before))
        return false;
      const task = (queued ?? Promise.resolve()).then(() => paintOne(index, before, after));
      queues.set(index, task);
      task.then(() => {
        if (queues.get(index) === task)
          queues.delete(index);
      });
      return true;
    }

    function ready(drawn, before) {
      return drawn !== null && root.SigK.mosaicRegion.canPaint(drawn.canvas) && samePlan(drawn.plan, before);
    }

    async function paintOne(index, before, after) {
      const drawn = owner.drawn(index);
      // 描き終えた絵が無い（描いている途中・倍率変更の後など）か、絵の並びが before でなければ、今の並びで描いた絵でない限り、今までどおり
      // 描き直す（描いている途中の絵は、どの並びのモザイクを塗るか分からないので、描き直して今の並びにそろえる）。
      if (drawn === null || !samePlan(drawn.plan, before)) {
        if (drawn === null || !samePlan(drawn.plan, owner.current(index)))
          owner.redraw(index);
        return;
      }
      const alive = owner.watch(index, drawn);
      try {
        if (await owner.paint(index, drawn, after.mosaic, alive)) {
          if (alive())
            await owner.finish(index, after);
        } else if (alive()) {
          owner.redraw(index);
        }
      } catch (error) {
        // 倍率変更・並びの変更で取り消された描画は、失敗ではない。
        if (!alive())
          return;
        owner.report(error, index);
        owner.redraw(index);
      }
    }

    return { append, pending: (index) => queues.has(index) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.mosaicAppend = { create };
})(typeof window !== 'undefined' ? window : globalThis);
