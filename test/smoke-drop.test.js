'use strict';

// 起動確認 SIGK_SMOKE_DROP（spec-1-2 確定事項6、spec-2-5 の起動確認）。本物のドロップ（debugger の Input.dispatchDragEvent）は
// 実機でしか動かないので、ここはパスの読み取り・落とす点・送るコマンドの形と、落としたあとの式が jsdom の画面で内部 API から
// 埋まることを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

const { DROP_POINT, dropPaths, dropPointFor, dispatchDrop, resultScript } = require('../smoke-drop.js');
const { createShell, makeSource } = require('./harness.js');

test('; で区切った複数のパスを、空の項目を飛ばして絶対パスにする', () => {
  const cwd = path.resolve('/work');
  assert.deepEqual(dropPaths(' a.pdf ; ;b.pdf', cwd), [path.resolve(cwd, 'a.pdf'), path.resolve(cwd, 'b.pdf')]);
  assert.deepEqual(dropPaths(path.resolve(cwd, 'c.pdf'), cwd), [path.resolve(cwd, 'c.pdf')]);
  assert.deepEqual(dropPaths(undefined, cwd), []);
});

test('落とす点は窓の真ん中あたりで、小さい窓（960×600）でも窓の中に収める', () => {
  assert.deepEqual(dropPointFor({ width: 1280, height: 800 }), DROP_POINT);
  assert.deepEqual(dropPointFor({ width: 960, height: 600 }), { x: 576, y: 360 });
  assert.deepEqual(dropPointFor(null), DROP_POINT);
});

test('複数のファイルは 1 回のドロップでまとめて落とし、終わったら debugger を外す', async () => {
  const sent = [];
  let attached = false;
  const win = {
    getContentBounds: () => ({ width: 960, height: 600 }),
    webContents: {
      debugger: {
        attach: () => { attached = true; },
        detach: () => { attached = false; },
        sendCommand: async (name, params) => { sent.push([name, params]); },
      },
    },
  };
  await dispatchDrop(win, ['C:\\a.pdf', 'C:\\b.pdf']);
  assert.deepEqual(sent.map(([, params]) => params.type), ['dragEnter', 'dragOver', 'drop']);
  for (const [name, params] of sent) {
    assert.equal(name, 'Input.dispatchDragEvent');
    assert.deepEqual(params.data.files, ['C:\\a.pdf', 'C:\\b.pdf']);
    assert.deepEqual([params.x, params.y], [576, 360]);
  }
  assert.equal(attached, false);
});

test('落としたあとの式は式として読め、画面で評価するとタブ・モード・映している文書を内部 API から控える', async (t) => {
  for (const wait of [0, 2000, 12.7, -5, 'x'])
    assert.doesNotThrow(() => new vm.Script(resultScript(wait)));
  assert.match(resultScript(12.7), /setTimeout\(resolve, 13\)/);
  assert.match(resultScript(-5), /setTimeout\(resolve, 0\)/);

  const A = 'C:\\work\\a.pdf';
  const B = 'C:\\work\\b.pdf';
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }), [B]: makeSource({ path: B, name: 'b.pdf' }) } });
  t.after(() => shell.cleanup());
  shell.SigK.shell.setMode(shell.document, 'tools');
  await shell.SigK.tabs.openPath(A);
  await shell.SigK.tabs.openPath(B);
  await shell.flush();
  const report = structuredClone(await shell.window.eval(resultScript(0)));
  assert.equal(report.tabCount, 2);
  assert.deepEqual(report.names, ['a.pdf', 'b.pdf']);
  assert.equal(report.mode, 'tools', 'ツールモードで開いてもツールモードにとどまる（決定80 ⑤）');
  assert.equal(report.openedName, 'b.pdf');
  assert.equal(report.overlayHidden, true);
});
