(function (root) {
  'use strict';

  // 文書を開き、ページを縦に並べ、見えている範囲だけを描く層。
  // 配置と倍率の計算は viewer-layout.js（純関数）に置き、ここは DOM と
  // pdf.js の呼び出しだけを担う。ツールバーとキー操作の結線は
  // viewer-controls.js にある。
  //
  // 「いま何を描き、何を捨てるか」は page-render.js へ切り出した
  // （spec-1-3 確定事項29）。ここに残るのは文書の開閉・セッションの退避と
  // 復元・倍率・ページ移動である。
  //
  // 画面に映すのは常に1文書だけである。タブの束を持つのは tabs.js の役目で、
  // ここは detach()／attach() で「いま映しているもの」を差し替える口を出す。
  // 非アクティブなタブが canvas を持ち続けないのは、この境界のおかげである
  // （spec-1-2 確定事項1）。

  const EMPTY_MESSAGE = '文書が開かれていません';

  const state = {
    doc: null,
    file: null,
    // 元ファイルのページ寸法（回転を当てる前）。plan から sizes を作り直すのに
    // 使うので、編集しても書き換えない（spec-1-5 確定事項45）。
    basePages: [],
    // 編集後の並び。要素は { src, rotate }（確定事項1）。編集していない状態も
    // これで表す。表示・印刷・保存はすべてこの配列だけを見る。
    plan: [],
    // 最後に保存した並び。未保存かどうかは「plan がこれと違うこと」で決める
    // （spec-1-6 確定事項27）。開いた直後は plan と同じ（＝連番）である。
    //
    // plan を連番へ振り直す形にはできない。state.doc は保存前のファイルを開いた
    // pdf.js の文書のままで（確定事項29 で開き直さないと決めている）、
    // getPage() が plan[n-1].src で引くため、振り直すと表示と中身がずれる。
    savedPlan: [],
    // 差し込んだページの控え（spec-1-6 確定事項93）。要素は
    // { path, page, size, doc }（doc は差し込むページだけを持つ pdf.js の文書）。
    // plan の { insert } がこの配列の番号を指す。
    //
    // 一度足したものは plan から外れても消さない。undo で外れたぶんを redo で
    // 戻せるようにするためで、番号がずれないことのほうが大事である。
    inserts: [],
    // plan から導いた、いま画面に出ている寸法。pageCount はこの長さである。
    sizes: [],
    layout: { pages: [], contentWidth: 0, totalHeight: 0 },
    zoom: 1,
    fit: 'width',
    current: 0,
    rendered: new Map(),
    // 文書やズームが変わったら、飛んでいる描画をすべて捨てるための世代番号。
    token: 0,
    frame: 0,
    // 直前の open() が「パスワードの入力を取りやめて終わった」かどうか
    // （spec-1-6 確定事項68）。失敗と区別するのは、取りやめではタブを
    // 作らないためである（理由を出す場所が要らない）。
    openCanceled: false,
  };

  let el = null;

  // 描画ライフサイクルは page-render.js が持つ。状態と要素はこちらのものを
  // 貸す（複製を持たせると「捨てたはずのページが復活する」食い違いが出る）。
  // el は init() で差し替わるので、値ではなく取り出す関数を渡す。
  const render = root.SigK.pageRender.create({
    state,
    el: () => el,
    report: (error, context) => report(error, context),
    getState: () => getState(),
    syncPage: () => syncPage(),
  });

  function layout() {
    return root.SigK.viewerLayout;
  }

  function controls() {
    return root.SigK.viewerControls;
  }

  // 現在ページが変わったことを、それを映しているものへ伝える。ツールバーの
  // ページ番号と、サムネイルの枠が同じ合図で動く（spec-1-3 確定事項6・11）。
  function syncPage() {
    controls()?.syncPage(el.doc, getState());
    root.SigK.thumbnails?.setCurrent(state.current);
  }

  function getState() {
    return {
      open: state.doc !== null,
      file: state.file,
      pageCount: state.sizes.length,
      current: state.current,
      zoom: state.zoom,
      fit: state.fit,
      contentWidth: state.layout.contentWidth,
      totalHeight: state.layout.totalHeight,
      rendered: [...state.rendered.keys()].sort((a, b) => a - b),
    };
  }

  // pdf.js のページを借りる口。検索の全ページ取り出し（spec-1-4 確定事項2）と
  // 印刷の 150dpi 描画（同31）が使う。文書そのものを渡さないのは、破棄の
  // 責任をこことタブ層に閉じたままにするためである。
  //
  // 表示上の番号から元ファイルのページを引く（spec-1-5 確定事項44）。この写像が
  // あるおかげで、検索も印刷も編集後の並びを自動的に見ることになる。
  function getPage(number) {
    if (state.doc === null || number < 1 || number > state.plan.length)
      return Promise.resolve(null);
    // 差し込んだページは別の文書から来る（spec-1-6 確定事項93）。
    const source = root.SigK.pagePlan.sourceOf(state.plan, number - 1, state);
    return source === null ? Promise.resolve(null) : source.doc.getPage(source.number);
  }

  // そのページに当てる回転。元ページの /Rotate に plan の相対角度を足した
  // 絶対値で、getViewport({ rotation }) にそのまま渡せる（確定事項39）。
  // pdf.js が 360 で剰余するので、ここで丸め直す必要はない。
  function viewportRotation(number, page) {
    return (page?.rotate ?? 0) + (state.plan[number - 1]?.rotate ?? 0);
  }

  // 差し込んだページを控える（spec-1-6 確定事項93）。戻り値は plan に書く番号で、
  // 呼び出し側（insert.js）が `{ insert: <番号>, rotate: 0 }` として並びへ入れる。
  //
  // entries は { path, page, size, doc } の並び。1つの PDF から複数ページを
  // 差し込むと、同じ doc を指す控えが複数できる。
  function addInserts(entries) {
    const first = state.inserts.length;
    state.inserts.push(...entries);
    return entries.map((_entry, index) => first + index);
  }

  // いま画面に出ている寸法（plan の回転を当てたあと）。差し込むページの紙の
  // 大きさを決めるのに使う（確定事項95）。
  function getSizes() {
    return state.sizes.map((size) => ({ width: size.width, height: size.height }));
  }

  // 保存のときワーカーへ渡す形。pdf.js の文書は渡さない（IPC を越えられない）。
  function getInserts() {
    return state.inserts.map(({ path, page, size }) => ({ path, page, size }));
  }

  // 元ファイルのページ数。plan が初期値と一致するか（＝未保存か）を
  // 判定するのに要る（確定事項6）。
  function getBasePageCount() {
    return state.basePages.length;
  }

  function getPlan() {
    return root.SigK.pagePlan.clonePlan(state.plan);
  }

  function isDirty() {
    if (state.doc === null)
      return false;
    return !root.SigK.pagePlan.samePlan(state.plan, state.savedPlan);
  }

  // 保存が成功したら、いまの並びを「保存済み」の基準にする（確定事項27）。
  // 以後はここから動いたときだけ未保存になる。元に戻す履歴は捨てない（確定事項28）
  // ので、Ctrl+Z で戻せば再び未保存になる。
  // 名前を付けて保存ではファイルそのものが移る（確定事項26）ので、
  // 名前・パス・署名も一緒に差し替えられるようにしてある。
  function markSaved({ path: nextPath = null, name = null, signature = null } = {}) {
    if (state.doc === null)
      return false;
    state.savedPlan = root.SigK.pagePlan.clonePlan(state.plan);

    if (nextPath !== null)
      state.file.path = nextPath;
    if (name !== null)
      state.file.name = name;
    if (signature !== null) {
      state.file.size = signature.size ?? state.file.size;
      state.file.mtimeMs = signature.mtimeMs ?? state.file.mtimeMs;
    }
    if (nextPath !== null || name !== null || signature !== null) {
      root.SigK.shell.setStatus(el.doc, {
        file: state.file.name,
        size: root.SigK.shell.formatFileSize(state.file.size),
      });
    }

    syncDirty();
    return true;
  }

  // plan から画面上の寸法を作り直す。回転が 90/270 のときは幅と高さを
  // 入れ替える（確定事項45）。pageCount は sizes の長さなので、これだけで
  // ページ番号入力・Home/End・印刷範囲・検索の走査本数がすべて追従する。
  function sizesFromPlan(plan) {
    return plan.map((page) => {
      const base = (Number.isInteger(page.insert)
        ? state.inserts[page.insert]?.size
        : state.basePages[page.src]) ?? { width: 0, height: 0 };
      const swapped = page.rotate === 90 || page.rotate === 270;
      return swapped
        ? { width: base.height, height: base.width }
        : { width: base.width, height: base.height };
    });
  }

  // ステータスバーのページ数。塊③-b までは open() で1回書くだけで、以後どこも
  // 更新していなかった（確定事項46 が直す取りこぼし）。
  function syncStatusPages() {
    root.SigK.shell.setStatus(el.doc, { pages: `${state.sizes.length} ページ` });
  }

  // 未保存の印（確定事項49）。ステータスバーの「変更あり」と、タブの点。
  // 編集のたび・文書を開くたび・タブを移るたびに呼ぶ。
  function syncDirty() {
    const mark = el.doc.getElementById('status-dirty');
    if (mark !== null)
      mark.hidden = !isDirty();
    root.SigK.tabs?.render();

    // メインは「未保存があるか」だけを知っていれば、終了時に確認が要るかを
    // 判断できる（確定事項56）。無ければ従来どおり素通りで閉じられる。
    const tabs = root.SigK.tabs;
    const count = tabs === undefined
      ? (isDirty() ? 1 : 0)
      : tabs.list().filter((info) => tabs.isDirty(info.id)).length;
    root.appCloseAPI?.setDirty?.(count);
  }

  // 編集後の並びを画面へ映す（確定事項43）。ページビュー・ページ番号・
  // サムネイル・印刷のすべてがここを通った結果を見る。
  //
  // 映さないと「サイドパネルだけが新しい並び、中央と印刷は元のまま」という
  // 二重状態になり、塊⑤ の保存が正しいかを目で確かめられない。
  function applyPlan(nextPlan) {
    if (state.doc === null)
      return false;

    state.plan = root.SigK.pagePlan.clonePlan(nextPlan);
    state.sizes = sizesFromPlan(state.plan);
    state.current = Math.min(state.sizes.length - 1, Math.max(0, state.current));

    // 並びも寸法も変わる。飛んでいる描画ごと捨てて枠から作り直す。
    state.token += 1;
    render.releaseAll();
    buildPages();
    applyLayout();

    // 検索結果は捨てる（確定事項47）。matches はページ index とページ内
    // オフセットを持つため、並べ替えなら付け替えられても削除では直せない。
    // 半分だけ正しいハイライトは、無いより悪い。
    root.SigK.find?.clear();

    root.SigK.thumbnails?.setPlan(state.plan, state.sizes, state.inserts);
    syncStatusPages();
    syncDirty();
    controls()?.syncAll(el.doc, getState());
    render.scheduleUpdate();
    return true;
  }

  // いま描いてあるページのテキストレイヤー。検索のハイライトが span を借りる
  // （spec-1-4 確定事項14）。描いていなければ null。
  function getTextLayer(index) {
    return state.rendered.get(index)?.text ?? null;
  }

  function report(error, context = {}) {
    root.SigK.log.report({
      level: 'error',
      message: error?.message ?? String(error),
      stack: error?.stack,
      context: { source: 'viewer', ...context },
    });
  }

  // 失敗はページビューにその場で出す。ダイアログで画面を塞がない（spec-1-1 確定事項16）。
  // 文言は #view-message、出し入れは器の #view-empty で行う。器には最近使った
  // ファイルの一覧も入るため、textContent で丸ごと書き換えてはいけない。
  // 出し先は「文書が映っているか」で決まる（spec-1-2 確定事項20）。
  // 映っていれば上端の帯へ。全面に出すと読んでいる文書が隠れる。
  // 映っていなければ空の表示の文言そのものを差し替える。
  function setMessage(text) {
    if (state.doc !== null) {
      root.SigK.viewBanner.show(text);
      return;
    }
    el.message.textContent = text;
    el.empty.hidden = false;
  }

  // いま出ている文言。tabs.js が失敗の理由をタブへ控えるのに使う。
  function getMessage() {
    return el.message.textContent;
  }

  function setDocumentOpen(open) {
    el.doc.documentElement.setAttribute('data-doc', open ? 'open' : 'empty');
    el.empty.hidden = open;
    el.pages.hidden = !open;
    // 文書が無ければ保存も無い（確定事項24）。
    root.SigK.save?.syncButtons(el.doc);
  }

  // ---- レイアウト ----

  function buildPages() {
    const nodes = state.sizes.map((_size, index) => {
      const node = el.doc.createElement('div');
      node.className = 'pdf-page';
      node.dataset.page = String(index + 1);
      return node;
    });
    el.pageNodes = nodes;
    el.pages.replaceChildren(...nodes);
  }

  function applyLayout() {
    const next = layout().layoutPages({ sizes: state.sizes, zoom: state.zoom });
    state.layout = next;
    el.pages.style.width = `${next.contentWidth}px`;
    el.pages.style.height = `${next.totalHeight}px`;

    for (const page of next.pages) {
      const node = el.pageNodes[page.index];
      node.style.top = `${page.top}px`;
      node.style.left = `${page.left}px`;
      node.style.width = `${page.width}px`;
      node.style.height = `${page.height}px`;
      // テキストレイヤーが寸法の計算に読む変数。倍率と一緒に動くので、
      // ページ枠の寸法を書くこの場所で揃えて置く（spec-1-3 確定事項19）。
      root.SigK.textLayer?.setScaleVariables(node, state.zoom);
    }
  }

  // ---- 倍率 ----

  function setZoom(zoom, { fit = null } = {}) {
    const next = layout().clampZoom(zoom);
    const changed = next !== state.zoom;
    state.zoom = next;
    state.fit = fit;

    if (state.doc !== null && changed) {
      // 倍率が変われば canvas の解像度も変わる。飛んでいる描画ごと捨てる。
      state.token += 1;
      render.releaseAll();
      applyLayout();
      goToPage(state.current);
    }
    controls()?.syncZoom(el.doc, getState());
    render.scheduleUpdate();
    return state.zoom;
  }

  function fitZoomFor(mode) {
    const size = state.sizes[state.current] ?? state.sizes[0];
    if (size === undefined)
      return state.zoom;
    const viewportWidth = el.view.clientWidth;
    const viewportHeight = el.view.clientHeight;
    if (mode === 'page')
      return layout().fitPageZoom({ pageWidth: size.width, pageHeight: size.height, viewportWidth, viewportHeight });
    return layout().fitWidthZoom({ pageWidth: size.width, viewportWidth });
  }

  function applyFit(mode) {
    return setZoom(fitZoomFor(mode), { fit: mode });
  }

  // ウィンドウやサイドパネルの幅が変わったとき、追従中だけ計算し直す。
  function refit() {
    if (state.doc === null)
      return;
    if (state.fit === null) {
      render.scheduleUpdate();
      return;
    }
    applyFit(state.fit);
  }

  // ---- ページ移動 ----

  function goToPage(index) {
    if (state.doc === null)
      return state.current;
    const target = Math.min(state.sizes.length - 1, Math.max(0, index));
    el.view.scrollTop = layout().scrollTopForPage({ pages: state.layout.pages, index: target });
    state.current = target;
    syncPage();
    render.scheduleUpdate();
    return target;
  }

  // ---- 文書 ----

  // 画面を空に戻す。pdf.js の文書は破棄しない（持ち主は tabs.js かもしれない）。
  function resetView() {
    state.token += 1;
    render.releaseAll();
    // 別の文書に移るのだから、前の文書について出した帯は用済みである。
    root.SigK.viewBanner.hide();
    state.doc = null;
    state.file = null;
    state.basePages = [];
    state.plan = [];
    state.savedPlan = [];
    state.inserts = [];
    state.sizes = [];
    state.layout = { pages: [], contentWidth: 0, totalHeight: 0 };
    state.current = 0;
    el.pageNodes = [];
    el.pages.replaceChildren();
    root.SigK.thumbnails?.clear();
    // 検索の状態も選択も文書に属する。持ち越すぶんは detach() が先に控えている。
    root.SigK.find?.clear();
    root.SigK.pageGrid?.clearSelection();
    root.SigK.pageEdit?.restore(null);
    setDocumentOpen(false);
    setMessage(EMPTY_MESSAGE);
    root.SigK.shell.setStatus(el.doc, { file: '文書なし', pages: '–', size: '–' });
    const mark = el.doc.getElementById('status-dirty');
    if (mark !== null)
      mark.hidden = true;
    controls()?.syncAll(el.doc, getState());
  }

  // 映すのをやめ、続きから読むために要るものだけを持ち出す（spec-1-2 確定事項2）。
  // 文書は破棄しないので、attach() で元どおりに戻せる。
  function detach() {
    const session = state.doc === null ? null : {
      doc: state.doc,
      file: state.file,
      // 編集内容はタブごとに持つ（確定事項7）。タブを切り替えても残る。
      basePages: state.basePages,
      plan: state.plan,
      savedPlan: state.savedPlan,
      inserts: state.inserts,
      sizes: state.sizes,
      zoom: state.zoom,
      fit: state.fit,
      current: state.current,
      scrollTop: el.view.scrollTop,
      // canvas は持ち越さない。持ち越すのは見ていた場所だけである
      // （spec-1-3 確定事項13）。
      thumbScrollTop: root.SigK.thumbnails?.getScrollTop() ?? 0,
      // 検索語・取り出した本文・ヒット一覧はタブごとに持つ（spec-1-4 確定事項
      // 3・27）。canvas と違って軽く、タブを戻すたびに読み直す理由がない。
      find: root.SigK.find?.capture() ?? null,
      // 選択も履歴もタブごとである（spec-1-5 確定事項11・14）。
      grid: root.SigK.pageGrid?.capture() ?? null,
      edit: root.SigK.pageEdit?.capture() ?? null,
    };
    resetView();
    return session;
  }

  function attach(session) {
    if (session === null || session === undefined || session.doc === undefined)
      return false;

    // tabs.js は必ず detach してから渡す。ここに何か残っているのは呼び出し側の
    // 不具合であり、黙って捨てると pdf.js の文書が宙に浮く。記録して破棄する。
    if (state.doc !== null) {
      report(new Error('attach: 前の文書が畳まれていません'), { file: state.file?.name });
      close();
    }

    state.token += 1;
    state.doc = session.doc;
    state.file = session.file;
    state.basePages = session.basePages ?? session.sizes;
    state.plan = session.plan ?? root.SigK.pagePlan.createPlan(session.sizes.length);
    state.savedPlan = session.savedPlan ?? root.SigK.pagePlan.createPlan(session.sizes.length);
    state.inserts = session.inserts ?? [];
    state.sizes = session.sizes;
    state.zoom = session.zoom;
    state.fit = session.fit;
    state.current = session.current;

    buildPages();
    setDocumentOpen(true);
    applyLayout();
    root.SigK.thumbnails?.setDocument({
      doc: state.doc,
      sizes: state.sizes,
      plan: state.plan,
      inserts: state.inserts,
      current: state.current,
      scrollTop: session.thumbScrollTop ?? 0,
    });
    el.view.scrollTop = session.scrollTop ?? 0;
    syncDirty();
    root.SigK.find?.restore(session.find);
    // 枠が並んだあとで印を付け直す。順番を逆にすると付ける先が無い。
    root.SigK.pageGrid?.restore(session.grid);
    root.SigK.pageEdit?.restore(session.edit);
    root.SigK.shell.setStatus(el.doc, {
      file: session.file.name,
      pages: `${state.sizes.length} ページ`,
      size: root.SigK.shell.formatFileSize(session.file.size),
    });
    controls()?.syncAll(el.doc, getState());
    render.scheduleUpdate();
    return true;
  }

  function close() {
    destroySession(detach());
  }

  // 映していないタブを閉じるときの後始末。
  //
  // 差し込んだページの文書も畳む（確定事項93）。複数ページの PDF を差し込むと
  // 同じ文書を複数の控えが指すので、実体ごとに1回だけ呼ぶ。
  function destroySession(session) {
    session?.doc?.destroy?.();
    const seen = new Set();
    for (const added of session?.inserts ?? []) {
      if (added?.doc === undefined || added?.doc === null || seen.has(added.doc))
        continue;
      seen.add(added.doc);
      added.doc.destroy?.();
    }
  }

  // 文書情報（F-01-7）が読む。pdf.js の生の戻り値をそのまま渡し、
  // 人が読む形への整形は doc-info.js が持つ。
  function getMetadata() {
    if (state.doc === null)
      return Promise.resolve(null);
    return state.doc.getMetadata();
  }

  // 全ページの寸法を先に集める。スクロールバーの長さが最初から正しくなり、
  // 読み進めるたびに位置が跳ねるのを防げる（spec-1-1 確定事項9）。
  //
  // ここで集めるのは**元ファイルの並びの寸法**である（state.basePages）。
  // 画面に出す寸法は plan を当てた sizesFromPlan() のほうで、編集のたびに
  // 作り直す（spec-1-5 確定事項45）。
  async function collectSizes(doc) {
    const sizes = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push({ width: viewport.width, height: viewport.height });
    }
    return sizes;
  }

  function describeOpenFailure(error) {
    // パスワードは聞けるようになった（確定事項66）。ここへ来るのは、聞いた
    // うえで開けなかったときだけである。
    if (error?.name === 'PasswordException')
      return 'パスワードが違うため、この PDF を開けませんでした。';
    if (error?.name === 'InvalidPDFException')
      return 'PDF として読めませんでした。ファイルが壊れている可能性があります。';
    return 'この PDF を開けませんでした。';
  }

  // pdf.js がパスワードを聞いてくる口を繋ぐ（確定事項66〜68）。
  //
  // 間違えると同じ口が code = 2 でもう一度呼ばれるので、**何度でも聞き直せる**
  // （確定事項67）。取りやめは Error を渡すと promise が reject する（確定事項68）。
  // 戻り値の asked は「一度でも聞かれたか」で、保存を断る判断に使う（確定事項70）。
  function attachPasswordPrompt(task, source) {
    const outcome = { asked: false };
    task.onPassword = (updatePassword, code) => {
      outcome.asked = true;
      const prompt = root.SigK.passwordPrompt;
      if (prompt === undefined) {
        updatePassword(new Error('パスワードを聞けません'));
        return;
      }
      prompt
        .ask({ name: source?.name ?? null, retry: code === prompt.INCORRECT_PASSWORD })
        .then((value) => {
          if (value === null) {
            state.openCanceled = true;
            // Error を渡すと promise が reject する。取りやめの合図である。
            updatePassword(new Error('パスワードの入力を取りやめました'));
            return;
          }
          updatePassword(value);
        });
    };
    return outcome;
  }

  // 直前の open() が取りやめで終わったか（確定事項68）。tabs.js が
  // 「タブを作らずに戻す」を決めるのに使う。
  function openCanceled() {
    return state.openCanceled;
  }

  async function open(source) {
    if (source?.error !== undefined) {
      setMessage(source.error);
      return false;
    }
    if (root.SigK.pdfjs?.available !== true) {
      setMessage('PDF の表示機能を読み込めませんでした。');
      return false;
    }

    close();
    state.token += 1;
    state.openCanceled = false;
    const token = state.token;
    setMessage('読み込んでいます…');

    try {
      const task = root.SigK.pdfjs.getDocument({ data: source.bytes });
      // パスワードを聞く口は getDocument() の**直後**に代入する（確定事項66）。
      // await してからでは、pdf.js が先に呼びに来て取りこぼす。
      const encrypted = attachPasswordPrompt(task, source);
      const doc = await task.promise;
      const sizes = await collectSizes(doc);
      if (token !== state.token) {
        doc.destroy?.();
        return false;
      }

      state.doc = doc;
      state.file = {
        path: source.path,
        name: source.name,
        size: source.size,
        // 保存の直前に外部での書き換えを見分けるための控え（確定事項21）。
        mtimeMs: source.mtimeMs ?? null,
        // パスワードを聞いて開いた文書は保存できない（確定事項12・70）。
        // 閲覧・検索・印刷・ページ編集はできる。
        encrypted: encrypted.asked,
      };
      state.basePages = sizes;
      // 開いた時点の plan は 0..N-1 の連番である（確定事項5）。編集していない
      // 状態も plan で表し、特別扱いを作らない。
      state.plan = root.SigK.pagePlan.createPlan(sizes.length);
      // 開いた直後は、ファイルの中身と画面の並びが一致している。
      state.savedPlan = root.SigK.pagePlan.clonePlan(state.plan);
      state.inserts = [];
      state.sizes = sizesFromPlan(state.plan);
      state.current = 0;
      // 履歴は文書ごとに作り直す。前の文書の世代が残っていると、Ctrl+Z で
      // 別の文書の並びへ戻ってしまう（確定事項11）。
      root.SigK.pageEdit?.reset(state.plan);

      buildPages();
      setDocumentOpen(true);
      root.SigK.thumbnails?.setDocument({
        doc, sizes: state.sizes, plan: state.plan, inserts: state.inserts, current: 0, scrollTop: 0,
      });
      // ここで一度置いておく。applyFit の中の setZoom は倍率が変わったときしか
      // 配置し直さないため、2つ目の文書が1つ目と同じ倍率になると（同じ紙の
      // 大きさなら普通に起こる）ページの位置と寸法が空のまま残ってしまう。
      applyLayout();
      // 用紙サイズを知らなくても読める幅で出す（spec-1-1 確定事項8）。
      applyFit('width');
      el.view.scrollTop = 0;
      root.SigK.shell.setStatus(el.doc, {
        file: source.name,
        // doc.numPages ではなく、いま映している並びの長さを出す。編集すると
        // ここが動く（確定事項46）。
        pages: `${state.sizes.length} ページ`,
        size: root.SigK.shell.formatFileSize(source.size),
      });
      syncDirty();
      controls()?.syncAll(el.doc, getState());
      return true;
    } catch (error) {
      setMessage(describeOpenFailure(error));
      report(error, { path: source?.path });
      return false;
    }
  }

  // 開く経路は tabs.js に1本だけ持たせる（spec-1-2 確定事項18）。ここは
  // タブ層が居ないとき（ビューア単体のテスト）のための素の経路として残す。
  async function openViaDialog() {
    if (root.SigK.tabs !== undefined)
      return root.SigK.tabs.openViaDialog();

    const api = root.pdfAPI;
    if (!api || api.available !== true) {
      setMessage('ファイルを開く機能が使えません。');
      return false;
    }
    const result = await api.open();
    if (result?.canceled === true)
      return false;
    return open(result);
  }

  function init(doc, win) {
    if (win.__sigkViewerReady === true)
      return false;

    el = {
      doc,
      view: doc.getElementById('view'),
      pages: doc.getElementById('view-pages'),
      empty: doc.getElementById('view-empty'),
      message: doc.getElementById('view-message'),
      pageNodes: [],
    };
    if (el.view === null || el.pages === null || el.empty === null || el.message === null) {
      el = null;
      return false;
    }
    win.__sigkViewerReady = true;

    el.view.addEventListener('scroll', render.scheduleUpdate);
    win.addEventListener('resize', refit);
    setDocumentOpen(false);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewer = {
    EMPTY_MESSAGE,
    init,
    open,
    openViaDialog,
    close,
    detach,
    attach,
    destroySession,
    getMetadata,
    getPage,
    viewportRotation,
    getPlan,
    applyPlan,
    openCanceled,
    addInserts,
    getInserts,
    getSizes,
    isDirty,
    markSaved,
    getBasePageCount,
    getTextLayer,
    setMessage,
    getMessage,
    getState,
    setZoom,
    applyFit,
    refit,
    goToPage,
    zoomIn: () => setZoom(layout().nextZoom(state.zoom)),
    zoomOut: () => setZoom(layout().prevZoom(state.zoom)),
    actualSize: () => setZoom(1),
    nextPage: () => goToPage(state.current + 1),
    prevPage: () => goToPage(state.current - 1),
    firstPage: () => goToPage(0),
    lastPage: () => goToPage(state.sizes.length - 1),
  };
})(typeof window !== 'undefined' ? window : globalThis);
