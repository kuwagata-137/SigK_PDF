(function (root) {
  'use strict';

  // 画面の組み立ての入口。

  function fillIcons(doc) {
    for (const holder of doc.querySelectorAll('[data-icon]')) {
      const name = holder.dataset.icon;
      if (!root.SigK.icons.has(name))
        continue;
      const size = Number(holder.dataset.iconSize ?? 17);
      const strokeWidth = Number(holder.dataset.iconStroke ?? root.SigK.icons.DEFAULT_STROKE_WIDTH);
      holder.replaceChildren(root.SigK.icons.create(doc, name, { size, strokeWidth }));
    }
  }

  async function showAppVersion(doc) {
    const api = root.appInfoAPI;
    if (!api || api.available !== true)
      return null;
    try {
      const info = await api.get();
      if (!info || info.ok !== true)
        return null;
      root.SigK.shell.setStatus(doc, { version: `${info.name} ${info.version}` });
      return info;
    } catch {
      return null;
    }
  }

  function init(doc, win) {
    if (win.__sigkReady === true)
      return false;
    win.__sigkReady = true;

    root.SigK.log.install(win);
    fillIcons(doc);
    root.SigK.shell.init(doc);
    showAppVersion(doc);

    // テストから内部に触るための口。
    win.__test__ = {
      shell: root.SigK.shell,
      log: root.SigK.log,
      icons: root.SigK.icons,
      fillIcons: () => fillIcons(doc),
    };
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.app = { init, fillIcons };

  // jsdom はスクリプトを評価する時点で readyState が complete になっている。
  // DOMContentLoaded だけを待つ実装だと init が一度も走らない。
  if (typeof root.document !== 'undefined') {
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => init(root.document, root));
    else
      init(root.document, root);
  }
})(typeof window !== 'undefined' ? window : globalThis);
