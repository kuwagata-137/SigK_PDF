'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

require('../renderer/viewer-layout.js');

// 倍率の既定値とズーム段階（spec-7-6 確定事項ZV1・ZV2・ZS1〜ZS3・ZT1〜ZT3。docs/07 決定93）。

const PDF = 'C:\\work\\a.pdf';
const IMG = 'C:\\work\\shot.png';
const viewerLayout = () => globalThis.SigK.viewerLayout;

async function open(t, filePath, { sizes, image = null, viewport = { width: 900, height: 700 } } = {}) {
  const source = { ...makeSource({ path: filePath }), ...(image === null ? {} : { image }) };
  const shell = await createShell({ files: { [filePath]: source }, pdfjs: createPdfjsStub({ sizes }), viewport });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(filePath);
  await shell.flush();
  return shell;
}

test('ズーム段階は 33〜100% を 10% 刻みにし、25% 以下と 100% より上は今のまま（ZS1）', () => {
  const { ZOOM_STEPS, nextZoom, prevZoom } = viewerLayout();
  assert.deepEqual(ZOOM_STEPS.map((step) => Math.round(step * 100)),
    [10, 15, 20, 25, 33, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300, 400, 500, 600, 800, 1000]);
  const ladder = [0.33];
  while (ladder.at(-1) < 1)
    ladder.push(nextZoom(ladder.at(-1)));
  assert.deepEqual(ladder.map((zoom) => Math.round(zoom * 100)), [33, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(prevZoom(0.6), 0.5);
  assert.equal(nextZoom(1.37), 1.5, '段に無い倍率からは、最も近い上の段へ動く');
  assert.equal(prevZoom(1.37), 1.25);
});

test('PDF は大きなページでも 100% で開く（ZV1）', async (t) => {
  const shell = await open(t, PDF, { sizes: [{ width: 1191, height: 1684 }] });
  const state = shell.SigK.viewer.getState();
  assert.equal(state.zoom, 1);
  assert.equal(state.fit, null);
  assert.equal(shell.document.getElementById('zoom-value').value, '100%');
  assert.equal(shell.document.getElementById('btn-fit-width').classList.contains('active'), false);
});

test('画像は、100% でページ表示からはみ出すときだけ［全体］で開く（ZV2）', async (t) => {
  const big = await open(t, IMG, { sizes: [{ width: 4032, height: 3024 }], image: { kind: 'jpeg', frames: [{ width: 4032, height: 3024 }] } });
  const bigState = big.SigK.viewer.getState();
  assert.equal(bigState.fit, 'page');
  assert.ok(bigState.zoom < 0.2, `写真は全体が収まる倍率: ${bigState.zoom}`);
  assert.equal(big.document.getElementById('btn-fit-page').classList.contains('active'), true);

  const small = await open(t, IMG, { sizes: [{ width: 480, height: 300 }], image: { kind: 'png', frames: [{ width: 480, height: 300 }] } });
  const smallState = small.SigK.viewer.getState();
  assert.equal(smallState.zoom, 1);
  assert.equal(smallState.fit, null);
});

test('ツールモードの 100% は前の 200% の大きさ。表示する倍率は 50〜300% のまま、段は 100% 以下を 10% 刻み（ZT1・ZT2・ZS3）', async (t) => {
  const shell = await open(t, PDF, { sizes: [{ width: 595.28, height: 841.89 }] });
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'tools');
  await shell.flush();
  assert.equal(SigK.toolsZoom.get(), 1);
  assert.equal(SigK.toolsZoom.scale(), 2);
  assert.deepEqual(Array.from(SigK.toolsZoom.STEPS, (step) => Math.round(step * 100)), [50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300]);
  assert.equal(document.documentElement.style.getPropertyValue('--paper-zoom'), '2');
  const sheet = document.querySelector('#strips .strip .strip-page .sheet');
  assert.equal(sheet.style.height, '208px', '帯のページの高さは 104px の 2 倍');
  assert.equal(SigK.stripLayout.limit(SigK.stripLayout.zoom()), 40, '描く枚数の上限は画面上の大きさで数える（160÷2²）');

  SigK.toolsZoom.set(0.5);
  assert.equal(SigK.toolsZoom.scale(), 1);
  assert.equal(document.querySelector('#strips .strip .strip-page .sheet').style.height, '104px', '50% は前の 100% の大きさ');
});
