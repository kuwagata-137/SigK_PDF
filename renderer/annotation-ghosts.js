(function (root) {
  'use strict';

  // Ctrl＋ドラッグで写しを作っている間の、写しの絵（spec-4b-3a 確定事項G2。モック screenshots/phase4b-3-copy.png）。
  //
  // 元の書き込みの <g> を cloneNode して、同じ層の最後（最前面）に足し、引いた分だけ translate する。写しの <g> からは
  // data-annot を外す（掴む側が元の <g> を data-annot で引くので、写しを拾わないように）。層が描き直されて外れたら、
  // isShown が偽になり、掴む側が show し直す。

  let ghosts = [];

  function clear() {
    for (const ghost of ghosts)
      ghost.remove();
    ghosts = [];
  }

  function show(groups) {
    clear();
    ghosts = groups.filter((group) => group.parentNode !== null).map((group) => {
      const ghost = group.cloneNode(true);
      ghost.removeAttribute('data-annot');
      ghost.classList.add('annot-ghost');
      ghost.style.transform = '';
      group.parentNode.append(ghost);
      return ghost;
    });
    return ghosts.length;
  }

  function translate(dx, dy) {
    const transform = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px)`;
    for (const ghost of ghosts)
      ghost.style.transform = transform;
  }

  function isShown() {
    return ghosts.length > 0 && ghosts.every((ghost) => ghost.isConnected === true);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationGhosts = { show, translate, clear, isShown, count: () => ghosts.length };
})(typeof window !== 'undefined' ? window : globalThis);
