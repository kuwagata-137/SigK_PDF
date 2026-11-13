(function (root) {
  'use strict';

  // 印刷の送り出し（docs/spec-7-7-print-dialog.md・質問 PR1・PR3 ④）。
  //
  // シートの画像を #print-area に並べ、@page を用紙の大きさ・余白 0 にして、printAPI.print（silent）を用紙サイズごとに呼ぶ。
  // 用紙は縦で送る（横のシートは画像を回してある）。用紙がプリンターの既定と同じ時は、用紙を指定しない（メイン側が
  // usePrinterDefaultPageSize を使う）。部数が 2 部以上・部単位で、用紙サイズで印刷を分けた時は、1 部ずつ全部を送る
  // （部の中のページの順を保つため）。

  // 読み込みが終わるのを load で待つ。decode() は使わない（#print-area は画面では display:none で、decode() の解決が
  // 不定に遅れる。2026-09-01 の実測。spec-1-4）。
  function whenLoaded(img) {
    if (img.complete)
      return Promise.resolve(true);
    return new Promise((resolve) => {
      img.addEventListener('load', () => resolve(true), { once: true });
      // 1 枚描けなかったからといって全体を落とさない。白紙で出るほうがまだよい。
      img.addEventListener('error', () => resolve(false), { once: true });
    });
  }

  async function waitForImages(area) {
    const results = await Promise.all([...area.querySelectorAll('img')].map(whenLoaded));
    return results.filter(Boolean).length;
  }

  function setPageStyle(doc, paper) {
    let style = doc.getElementById('print-page-style');
    if (style === null) {
      style = doc.createElement('style');
      style.id = 'print-page-style';
      doc.head.append(style);
    }
    const width = paper.width / 1000;
    const height = paper.height / 1000;
    style.textContent = `@media print{@page{size:${width}mm ${height}mm;margin:0}`
      + `.print-page{width:${width}mm;height:${height}mm}.print-page img{width:100%;height:100%;max-width:none;max-height:none}}`;
  }

  // 1 回の印刷の分の画像を並べる。並べた枚数を返す。
  function fillArea(doc, area, job) {
    const nodes = job.images.filter((image) => image.url !== null).map((image) => {
      const holder = doc.createElement('div');
      holder.className = 'print-page';
      const img = doc.createElement('img');
      img.src = image.url;
      holder.append(img);
      return holder;
    });
    area.replaceChildren(...nodes);
    setPageStyle(doc, job.paper);
    return nodes.length;
  }

  function sendOrder(jobs, { copies = 1, collate = true }) {
    if (jobs.length <= 1 || copies <= 1 || !collate)
      return jobs.map((job) => ({ job, copies }));
    const order = [];
    for (let copy = 0; copy < copies; copy += 1) {
      for (const job of jobs)
        order.push({ job, copies: 1 });
    }
    return order;
  }

  function samePaper(a, b) {
    return a !== null && b !== null && a !== undefined && b !== undefined && a.width === b.width && a.height === b.height;
  }

  // options は { deviceName, copies, collate, color, duplexMode, defaultPaper }。
  function printOptions(job, copies, options) {
    const base = {
      silent: true,
      deviceName: options.deviceName,
      copies,
      collate: options.collate !== false,
      color: options.color !== false,
      duplexMode: options.duplexMode ?? 'simplex',
      landscape: false,
    };
    return samePaper(job.paper, options.defaultPaper) ? base : { ...base, pageSize: { width: job.paper.width, height: job.paper.height } };
  }

  // 送る。onSend(index, total) は送る前に呼ぶ（進行状況画面）。isAlive() が false になったら、次の印刷を送らない。
  async function send(doc, area, jobs, options, { onSend = () => {}, isAlive = () => true } = {}) {
    const api = root.printAPI;
    if (!api || api.available !== true)
      return { ok: false, reason: '印刷機能を使用できません。' };
    const order = sendOrder(jobs, options);
    try {
      for (let index = 0; index < order.length; index += 1) {
        if (!isAlive())
          return { canceled: true };
        onSend(index, order.length);
        fillArea(doc, area, order[index].job);
        await waitForImages(area);
        if (!isAlive())
          return { canceled: true };
        let result = null;
        try {
          result = await api.print(printOptions(order[index].job, order[index].copies, options));
        } catch (error) {
          result = { ok: false, reason: error?.message ?? String(error) };
        }
        if (result?.ok !== true)
          return result ?? { ok: false };
      }
      return { ok: true, sent: order.length };
    } finally {
      area.replaceChildren();
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printSend = { setPageStyle, fillArea, waitForImages, sendOrder, printOptions, send };
})(typeof window !== 'undefined' ? window : globalThis);
