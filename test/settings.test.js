'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULTS,
  UI_MODES,
  SIDE_PANEL_MIN,
  SIDE_PANEL_MAX,
  isValidMode,
  pickUi,
  mergeUi,
  mergeDefaults,
  clampSidePanelWidth,
  clampWindowBounds,
  writeFileAtomic,
  createSettingsStore,
} = require('../settings.js');

// テストは既定で並列に走るため、各テストが自分専用のディレクトリを取る。
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-settings-'));
}

test('既定値はウィンドウ 1280x800・サイドパネルは開いた状態', () => {
  assert.equal(DEFAULTS.window.width, 1280);
  assert.equal(DEFAULTS.window.height, 800);
  assert.equal(DEFAULTS.sidePanel.open, true);
  assert.equal(DEFAULTS.mode, 'view');
});

test('mergeDefaults はオブジェクト以外を既定値に落とす', () => {
  for (const raw of [null, undefined, 42, 'text', [], true])
    assert.deepEqual(mergeDefaults(raw), DEFAULTS);
});

test('mergeDefaults は型の合わないキーを既定値に落とす', () => {
  const merged = mergeDefaults({
    window: { width: 'wide', height: 900, x: null, y: 'top', maximized: 'yes' },
    sidePanel: { open: 1, width: 300 },
    mode: 42,
  });

  assert.equal(merged.window.width, DEFAULTS.window.width);
  assert.equal(merged.window.height, 900);
  assert.equal(merged.window.y, null);
  assert.equal(merged.window.maximized, DEFAULTS.window.maximized);
  assert.equal(merged.sidePanel.open, DEFAULTS.sidePanel.open);
  assert.equal(merged.sidePanel.width, 300);
  assert.equal(merged.mode, DEFAULTS.mode);
});

test('mergeDefaults は未知のキーを捨てる', () => {
  const merged = mergeDefaults({ mode: 'pages', secretToken: 'x', window: { width: 1000, evil: true } });

  assert.equal('secretToken' in merged, false);
  assert.equal('evil' in merged.window, false);
  assert.equal(merged.mode, 'pages');
});

test('clampSidePanelWidth は 180〜420 に丸める', () => {
  assert.equal(clampSidePanelWidth(10), SIDE_PANEL_MIN);
  assert.equal(clampSidePanelWidth(SIDE_PANEL_MIN), SIDE_PANEL_MIN);
  assert.equal(clampSidePanelWidth(240), 240);
  assert.equal(clampSidePanelWidth(SIDE_PANEL_MAX), SIDE_PANEL_MAX);
  assert.equal(clampSidePanelWidth(9999), SIDE_PANEL_MAX);
  assert.equal(clampSidePanelWidth(Number.NaN), DEFAULTS.sidePanel.width);
});

test('clampWindowBounds は最小サイズを下回らせない', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];

  const bounds = clampWindowBounds({ width: 100, height: 100, x: 10, y: 10 }, areas);

  assert.equal(bounds.width, 960);
  assert.equal(bounds.height, 600);
});

test('clampWindowBounds は画面に残っている位置をそのまま返す', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];

  const bounds = clampWindowBounds({ width: 1280, height: 800, x: 100, y: 60 }, areas);

  assert.deepEqual(bounds, { width: 1280, height: 800, x: 100, y: 60 });
});

test('clampWindowBounds は画面外の位置を主ディスプレイの中央へ寄せる', () => {
  // モニタを外した後の起動を想定する。
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];

  const bounds = clampWindowBounds({ width: 1280, height: 800, x: 4000, y: 2000 }, areas);

  assert.equal(bounds.x, Math.round((1920 - 1280) / 2));
  assert.equal(bounds.y, Math.round((1040 - 800) / 2));
});

test('clampWindowBounds は作業領域が無ければ位置を捨てる', () => {
  const bounds = clampWindowBounds({ width: 1280, height: 800, x: 100, y: 60 }, []);

  assert.equal(bounds.x, null);
  assert.equal(bounds.y, null);
});

test('writeFileAtomic は一時ファイルを残さない', () => {
  const dir = makeTempDir();
  const target = path.join(dir, 'settings.json');

  writeFileAtomic(target, '{"a":1}');
  writeFileAtomic(target, '{"a":2}');

  assert.equal(fs.readFileSync(target, 'utf8'), '{"a":2}');
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('初回起動では設定ファイルが無くても既定値を返す', () => {
  const store = createSettingsStore({ dir: makeTempDir() });

  assert.deepEqual(store.load(), DEFAULTS);
});

test('保存した設定は次のストアで読み戻せる', () => {
  const dir = makeTempDir();
  const store = createSettingsStore({ dir });
  store.load();
  store.set({ mode: 'pages', window: { width: 1400, height: 900, x: 20, y: 30, maximized: true } });

  assert.equal(store.save(), true);

  const reopened = createSettingsStore({ dir });
  const loaded = reopened.load();
  assert.equal(loaded.mode, 'pages');
  assert.equal(loaded.window.width, 1400);
  assert.equal(loaded.window.maximized, true);
});

test('BOM 付きで保存された設定も読める', () => {
  const dir = makeTempDir();
  const content = `﻿${JSON.stringify({ mode: 'pages', sidePanel: { open: false, width: 300 } })}`;
  fs.writeFileSync(path.join(dir, 'settings.json'), content, 'utf8');
  const reported = [];
  const store = createSettingsStore({ dir, onError: (entry) => reported.push(entry) });

  const loaded = store.load();

  assert.equal(loaded.mode, 'pages');
  assert.equal(loaded.sidePanel.open, false);
  assert.deepEqual(reported, [], 'BOM を壊れたファイルとして扱ってはいけない');
});

test('壊れた JSON では例外を投げず、既定値で起動して onError を呼ぶ', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ this is not json', 'utf8');
  const reported = [];
  const store = createSettingsStore({ dir, onError: (entry) => reported.push(entry) });

  const loaded = store.load();

  assert.deepEqual(loaded, DEFAULTS);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].level, 'warn');
  assert.equal(reported[0].context.filePath, store.filePath);
});

test('createSettingsStore は dir が無いと落ちる', () => {
  assert.throws(() => createSettingsStore({}), /dir/);
});

// ---- 最近使ったファイル（spec-1-2 確定事項8） ----

test('既定では履歴が空である', () => {
  assert.deepEqual(DEFAULTS.recent, []);
  assert.deepEqual(mergeDefaults({}).recent, []);
});

test('mergeDefaults は履歴の壊れた入力を落とす', () => {
  assert.deepEqual(mergeDefaults({ recent: 'nope' }).recent, []);
  assert.deepEqual(mergeDefaults({ recent: null }).recent, []);
  assert.deepEqual(mergeDefaults({ recent: [null, 7, {}] }).recent, []);
});

test('mergeDefaults は履歴の重複を畳み、10件で切る', () => {
  const many = Array.from({ length: 14 }, (_unused, i) => ({ path: `C:\\work\\${i}.pdf` }));
  const merged = mergeDefaults({ recent: [...many, { path: 'C:/WORK/0.PDF' }] });

  assert.equal(merged.recent.length, 10);
  assert.equal(merged.recent[0].path, 'C:\\work\\0.pdf');
  assert.equal(merged.recent[0].name, '0.pdf');
});

test('履歴はファイルに保存され、読み直せる', () => {
  const dir = makeTempDir();
  const store = createSettingsStore({ dir });

  store.load();
  store.set({ recent: [{ path: 'C:\\work\\a.pdf', name: 'a.pdf', openedAt: '2026-08-31T00:00:00.000Z' }] });
  assert.equal(store.save(), true);

  const reopened = createSettingsStore({ dir });
  const loaded = reopened.load();
  assert.equal(loaded.recent.length, 1);
  assert.equal(loaded.recent[0].path, 'C:\\work\\a.pdf');
  assert.equal(loaded.recent[0].openedAt, '2026-08-31T00:00:00.000Z');
});

// --- 画面の見た目（spec-1-3 確定事項31〜35） ---

test('未知のモードは既定へ落ちる', () => {
  assert.equal(mergeDefaults({ mode: 'pages' }).mode, 'pages');
  assert.equal(mergeDefaults({ mode: 'zzz' }).mode, DEFAULTS.mode);
  assert.equal(mergeDefaults({ mode: 42 }).mode, DEFAULTS.mode);
  assert.equal(mergeDefaults({}).mode, DEFAULTS.mode);
});

test('範囲外のサイドパネル幅は上下限で止まる', () => {
  assert.equal(mergeDefaults({ sidePanel: { width: 10 } }).sidePanel.width, SIDE_PANEL_MIN);
  assert.equal(mergeDefaults({ sidePanel: { width: 9999 } }).sidePanel.width, SIDE_PANEL_MAX);
  assert.equal(mergeDefaults({ sidePanel: { width: '240' } }).sidePanel.width, DEFAULTS.sidePanel.width);
  assert.equal(mergeDefaults({ sidePanel: { open: 'yes' } }).sidePanel.open, DEFAULTS.sidePanel.open);
});

// レンダラーへ渡すのは画面の見た目の設定だけである。ウィンドウの位置や履歴は渡さない。
const DEFAULT_COLORS = { highlight: '#ffd966', underline: '#c00000', strikeout: '#c00000', text: '#222a35', shape: '#c00000', pen: '#c00000', note: '#ffd966' };
// 図形の塗り・線なし・線種の既定（spec-4b-1b 確定事項23〜25）。
const DEFAULT_SHAPE_STYLE = { annotFills: { shape: null }, annotStrokeNone: { shape: false }, annotLineStyles: { shape: 'solid' } };
const DEFAULT_OPACITY = { text: 1, shape: 1, pen: 1, note: 1 };

test('pickUi はモードとサイドパネルと編集モードの左と注釈の色・塗り・線なし・線種・文字の大きさ・線の太さ・図形の種類・不透明度・作成者だけを取り出す', () => {
  const ui = pickUi(mergeDefaults({ mode: 'tools', sidePanel: { open: false, width: 300 }, recent: [] }));

  assert.deepEqual(ui, { mode: 'tools', pageLayout: 'single', editSide: 'thumbs', sidePanel: { open: false, width: 300 }, annotColors: DEFAULT_COLORS, ...DEFAULT_SHAPE_STYLE, annotFontSize: 12, annotLineWidth: 2, annotShapeKind: 'square', annotOpacity: DEFAULT_OPACITY, annotAuthor: '' });
  // 色の移し替えの印はメインだけが使い、レンダラーへは渡さない（spec-4b-1b 確定事項15）。
  assert.equal('annotPaletteVersion' in ui, false);
});

// { sidePanel: { open: false } } を送っただけで幅が既定へ戻る、を防ぐ。
test('mergeUi は入れ子をキー単位で重ねる', () => {
  const current = { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 300 }, annotColors: DEFAULT_COLORS, annotFontSize: 12, annotLineWidth: 2, annotShapeKind: 'square', annotOpacity: DEFAULT_OPACITY, annotAuthor: '' };

  assert.deepEqual(mergeUi(current, { sidePanel: { open: false } }), {
    mode: 'view',
    pageLayout: 'single',
    editSide: 'thumbs',
    sidePanel: { open: false, width: 300 },
    annotColors: DEFAULT_COLORS,
    ...DEFAULT_SHAPE_STYLE,
    annotFontSize: 12,
    annotLineWidth: 2,
    annotShapeKind: 'square',
    annotOpacity: DEFAULT_OPACITY,
    annotAuthor: '',
  });
  assert.deepEqual(mergeUi(current, { mode: 'annot' }), {
    mode: 'annot',
    pageLayout: 'single',
    editSide: 'thumbs',
    sidePanel: { open: true, width: 300 },
    annotColors: DEFAULT_COLORS,
    ...DEFAULT_SHAPE_STYLE,
    annotFontSize: 12,
    annotLineWidth: 2,
    annotShapeKind: 'square',
    annotOpacity: DEFAULT_OPACITY,
    annotAuthor: '',
  });
  // 使えない値は現在値のまま。何も送らなくても壊れない。
  assert.deepEqual(mergeUi(current, { mode: 'zzz', sidePanel: { width: 9999 } }), {
    mode: 'view',
    pageLayout: 'single',
    editSide: 'thumbs',
    sidePanel: { open: true, width: SIDE_PANEL_MAX },
    annotColors: DEFAULT_COLORS,
    ...DEFAULT_SHAPE_STYLE,
    annotFontSize: 12,
    annotLineWidth: 2,
    annotShapeKind: 'square',
    annotOpacity: DEFAULT_OPACITY,
    annotAuthor: '',
  });
  assert.deepEqual(mergeUi(current, null), { ...current, editSide: 'thumbs', ...DEFAULT_SHAPE_STYLE });
});

// 編集モードの左に出すもの（spec-4b-1a 確定事項17）。既定はサムネイルで、使えない値は今の値か既定へ落ちる。
test('editSide は thumbs か list だけを受け取り、既定は thumbs', () => {
  const { EDIT_SIDES } = require('../settings.js');
  require('../renderer/shell.js');
  assert.deepEqual(EDIT_SIDES, [...globalThis.SigK.shell.EDIT_SIDES]);
  assert.equal(DEFAULTS.editSide, 'thumbs');
  assert.equal(mergeDefaults({ editSide: 'list' }).editSide, 'list');
  assert.equal(mergeDefaults({ editSide: 'grid' }).editSide, 'thumbs');
  const current = { mode: 'annot', pageLayout: 'single', editSide: 'list', sidePanel: { open: true, width: 300 } };
  assert.equal(mergeUi(current, { editSide: 'thumbs' }).editSide, 'thumbs');
  assert.equal(mergeUi(current, { editSide: 7 }).editSide, 'list');
  assert.equal(mergeUi({ mode: 'view', sidePanel: { open: true, width: 300 } }, {}).editSide, 'thumbs', '古い settings.json でも落ちない');
  assert.equal(pickUi(mergeDefaults({ editSide: 'list' })).editSide, 'list');
});

// 注釈の色（spec-4-1 確定事項33・34、spec-4b-1b 確定事項22）。パレットから選ぶので #rrggbb なら何でも受け取り、小文字にそろえる。
test('annotColors は種類ごとに #rrggbb の色を受け取る', () => {
  assert.deepEqual(mergeDefaults({}).annotColors, DEFAULT_COLORS);
  assert.deepEqual(mergeDefaults({ annotPaletteVersion: 1, annotColors: { highlight: '#A9CE91', underline: 'red', strikeout: 5, text: '#123456' } }).annotColors,
    { ...DEFAULT_COLORS, highlight: '#a9ce91', text: '#123456' });
  assert.deepEqual(mergeDefaults({ annotColors: 'x' }).annotColors, DEFAULT_COLORS);

  const current = { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 300 }, annotColors: { ...DEFAULT_COLORS, highlight: '#8faadc' } };
  // 種類ごとに重ねる。下線だけ送っても、ハイライトの色は現在値のまま。
  assert.deepEqual(mergeUi(current, { annotColors: { underline: '#4472c4' } }).annotColors,
    { ...DEFAULT_COLORS, highlight: '#8faadc', underline: '#4472c4' });
  // どの道具もパレットの色と「その他の色…」の色を使える（spec-4b-1b 論点2）。
  assert.equal(mergeUi(current, { annotColors: { text: '#ffd966' } }).annotColors.text, '#ffd966');
  // 図形とペンは同じ経路で、別々に覚える（spec-4-3 確定事項19）。
  assert.equal(mergeUi(current, { annotColors: { shape: '#00b050' } }).annotColors.shape, '#00b050');
  assert.equal(mergeUi(current, { annotColors: { shape: '#00b050' } }).annotColors.pen, '#c00000');
  // 色でなければ今の値のまま。
  assert.equal(mergeUi(current, { annotColors: { pen: 'blue' } }).annotColors.pen, '#c00000');
  // 古い settings.json（annotColors が無い）から来た current でも落ちない。
  assert.deepEqual(mergeUi({ mode: 'view', sidePanel: { open: true, width: 300 } }, {}).annotColors, DEFAULT_COLORS);
});

// 今までの候補の色は、読み込むときに 1 回だけパレットの色へ移る（spec-4b-1b 確定事項15）。保存すると印が残り、
// 次に読んだときは移さない。
test('古い settings.json の候補の色は、読み込むときに 1 回だけパレットの色へ移る', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ mode: 'annot', annotColors: { highlight: '#8ce99a', shape: '#2c5cd9', pen: '#123456', note: '#ffa8c8' } }));
  const store = createSettingsStore({ dir });
  const loaded = store.load();
  assert.equal(loaded.annotColors.highlight, '#a9ce91');
  assert.equal(loaded.annotColors.shape, '#4472c4');
  assert.equal(loaded.annotColors.pen, '#123456', '自分で選んだ色はそのまま');
  assert.equal(loaded.annotColors.note, '#ffa8c8', '桃はそのまま');
  assert.equal(loaded.annotPaletteVersion, 1);
  // 移したあとに今までの候補と同じ色を選び直しても、次の読み込みでは移さない。
  store.set(mergeUi(pickUi(store.get()), { annotColors: { shape: '#2c5cd9' } }));
  assert.equal(store.get().annotPaletteVersion, 1);
  assert.equal(store.save(), true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).annotPaletteVersion, 1);
  const reopened = createSettingsStore({ dir }).load();
  assert.equal(reopened.annotColors.shape, '#2c5cd9');
  assert.equal(reopened.annotColors.highlight, '#a9ce91');
});

// 図形の塗り・線なし・線種（spec-4b-1b 確定事項23〜25）。線と塗りを両方なしにはできない。
test('annotFills・annotStrokeNone・annotLineStyles は図形の値を受け取り、種類ごとに重ねる', () => {
  assert.deepEqual(mergeDefaults({}).annotFills, { shape: null });
  assert.deepEqual(mergeDefaults({ annotFills: { shape: '#FFD966' }, annotStrokeNone: { shape: true }, annotLineStyles: { shape: 'dashed' } }),
    { ...mergeDefaults({}), annotFills: { shape: '#ffd966' }, annotStrokeNone: { shape: true }, annotLineStyles: { shape: 'dashed' } });
  assert.deepEqual(mergeDefaults({ annotStrokeNone: { shape: true } }).annotStrokeNone, { shape: false }, '塗りが無ければ線は消せない');
  const current = { mode: 'annot', pageLayout: 'single', sidePanel: { open: true, width: 300 }, annotFills: { shape: '#ffd966' }, annotStrokeNone: { shape: true }, annotLineStyles: { shape: 'cloudy' } };
  assert.deepEqual(mergeUi(current, { annotLineStyles: { shape: 'dashed' } }).annotLineStyles, { shape: 'dashed' });
  assert.deepEqual(mergeUi(current, { annotLineStyles: { shape: 'wavy' } }).annotLineStyles, { shape: 'cloudy' });
  assert.deepEqual(mergeUi(current, { annotFills: { shape: null } }).annotStrokeNone, { shape: false });
  assert.deepEqual(mergeUi(current, {}).annotStrokeNone, { shape: true });
});

// 文字の大きさ（spec-4-2 確定事項21・34）。プリセットに無い値は既定へ落ちる。
test('annotFontSize はプリセットの大きさだけを受け取る', () => {
  assert.equal(DEFAULTS.annotFontSize, 12);
  assert.equal(mergeDefaults({}).annotFontSize, 12);
  assert.equal(mergeDefaults({ annotFontSize: 10.5 }).annotFontSize, 10.5);
  assert.equal(mergeDefaults({ annotFontSize: 13 }).annotFontSize, 12);
  assert.equal(mergeDefaults({ annotFontSize: '14' }).annotFontSize, 12);

  const current = { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 300 }, annotColors: DEFAULT_COLORS, annotFontSize: 14 };
  assert.equal(mergeUi(current, { annotFontSize: 24 }).annotFontSize, 24);
  assert.equal(mergeUi(current, { annotFontSize: 25 }).annotFontSize, 14);
  assert.equal(mergeUi(current, {}).annotFontSize, 14);
  // 古い settings.json（annotFontSize が無い）から来た current でも落ちない。
  assert.equal(mergeUi({ mode: 'view', sidePanel: { open: true, width: 300 } }, {}).annotFontSize, 12);
});

// プロセスが違うので import できない。ずれると、レンダラーで選べる色・大きさ・太さ・不透明度が設定側で弾かれる（またはその逆）。
test('注釈の既定と文字の大きさ・太さ・不透明度の範囲が renderer/annotation-presets.js と一致する', () => {
  require('../renderer/annotation-presets.js');
  const presets = globalThis.SigK.annotationPresets;
  const { ANNOT_FONT_SIZES, ANNOT_LINE_WIDTH_MIN, ANNOT_LINE_WIDTH_MAX, ANNOT_OPACITY_MIN, ANNOT_SHAPE_KINDS } = require('../settings.js');

  assert.deepEqual(DEFAULTS.annotColors, presets.DEFAULT_COLORS);
  assert.deepEqual(ANNOT_FONT_SIZES, presets.FONT_SIZES);
  assert.equal(DEFAULTS.annotFontSize, presets.DEFAULT_FONT_SIZE);
  assert.equal(ANNOT_LINE_WIDTH_MIN, presets.LINE_WIDTH_MIN);
  assert.equal(ANNOT_LINE_WIDTH_MAX, presets.LINE_WIDTH_MAX);
  assert.equal(DEFAULTS.annotLineWidth, presets.DEFAULT_LINE_WIDTH);
  assert.deepEqual(ANNOT_SHAPE_KINDS, presets.SHAPE_KINDS);
  assert.equal(DEFAULTS.annotShapeKind, presets.DEFAULT_SHAPE_KIND);
  assert.equal(ANNOT_OPACITY_MIN, presets.OPACITY_MIN);
  assert.deepEqual(DEFAULTS.annotOpacity, presets.DEFAULT_OPACITIES);
  assert.deepEqual(Object.keys(DEFAULTS.annotOpacity), presets.OPACITY_TOOLS);
});

// 不透明度は道具ごとに 0.1〜1 を受け取り、小数 2 桁にそろえる（spec-4-4 確定事項21、spec-4b-1b 確定事項27）。
test('annotOpacity は道具ごとに 0.1〜1 の値を受け取る', () => {
  assert.deepEqual(DEFAULTS.annotOpacity, DEFAULT_OPACITY);
  assert.deepEqual(mergeDefaults({}).annotOpacity, DEFAULT_OPACITY);
  assert.deepEqual(mergeDefaults({ annotOpacity: { shape: 0.5, note: 0.6, text: '1', pen: 0.05 } }).annotOpacity,
    { text: 1, shape: 0.5, pen: 1, note: 0.6 });
  assert.deepEqual(mergeDefaults({ annotOpacity: 0.5 }).annotOpacity, DEFAULT_OPACITY);

  const current = { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 300 }, annotColors: DEFAULT_COLORS, annotOpacity: { ...DEFAULT_OPACITY, shape: 0.75 } };
  // 1 つだけ送っても他は戻らない（色と同じ）。
  assert.deepEqual(mergeUi(current, { annotOpacity: { pen: 0.25 } }).annotOpacity, { text: 1, shape: 0.75, pen: 0.25, note: 1 });
  assert.deepEqual(mergeUi(current, { annotOpacity: { shape: 0.35 } }).annotOpacity, { ...current.annotOpacity, shape: 0.35 });
  assert.deepEqual(mergeUi(current, { annotOpacity: { shape: 1.5 } }).annotOpacity, current.annotOpacity);
  assert.deepEqual(mergeUi(current, { annotOpacity: { highlight: 0.5 } }).annotOpacity, current.annotOpacity);
  assert.deepEqual(mergeUi(current, {}).annotOpacity, current.annotOpacity);
  // 古い settings.json（annotOpacity が無い）から来た current でも落ちない。
  assert.deepEqual(mergeUi({ mode: 'view', sidePanel: { open: true, width: 300 } }, {}).annotOpacity, DEFAULT_OPACITY);
});

// 作成者は文字列を前後の空白を落として 100 文字まで。空は「OS のユーザー名を使う」の印（spec-4-4 確定事項39）。
test('annotAuthor は文字列だけを受け取り、空を許す', () => {
  assert.equal(DEFAULTS.annotAuthor, '');
  assert.equal(mergeDefaults({}).annotAuthor, '');
  assert.equal(mergeDefaults({ annotAuthor: '  山田 太郎 ' }).annotAuthor, '山田 太郎');
  assert.equal(mergeDefaults({ annotAuthor: 42 }).annotAuthor, '');
  assert.equal(mergeDefaults({ annotAuthor: 'a'.repeat(120) }).annotAuthor, 'a'.repeat(100));

  const current = { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 300 }, annotColors: DEFAULT_COLORS, annotAuthor: '総務' };
  assert.equal(mergeUi(current, { annotAuthor: '経理' }).annotAuthor, '経理');
  assert.equal(mergeUi(current, { annotAuthor: '' }).annotAuthor, '');
  assert.equal(mergeUi(current, { annotAuthor: 7 }).annotAuthor, '総務');
  assert.equal(mergeUi(current, {}).annotAuthor, '総務');
  assert.equal(mergeUi({ mode: 'view', sidePanel: { open: true, width: 300 } }, {}).annotAuthor, '');
});

test('fillAuthor は空の作成者だけを OS のユーザー名で埋める', () => {
  const { fillAuthor } = require('../settings.js');
  assert.equal(fillAuthor({ mode: 'view', annotAuthor: '' }, 'h.user').annotAuthor, 'h.user');
  assert.equal(fillAuthor({ mode: 'view', annotAuthor: '総務' }, 'h.user').annotAuthor, '総務');
  assert.equal(fillAuthor({ mode: 'view' }, ' h.user ').annotAuthor, 'h.user');
  assert.equal(fillAuthor({ mode: 'view', annotAuthor: '' }, undefined).annotAuthor, '');
  const ui = { mode: 'view', annotAuthor: '' };
  fillAuthor(ui, 'x');
  assert.equal(ui.annotAuthor, '', '元は変えない');
});

// 線の太さは 1〜40 の整数（spec-4b-1b 確定事項26）、図形の種類は 4 つのどれか。
test('annotLineWidth は 1〜40 の整数、annotShapeKind は図形の 4 種を受け取る', () => {
  assert.equal(DEFAULTS.annotLineWidth, 2);
  assert.equal(DEFAULTS.annotShapeKind, 'square');
  assert.equal(mergeDefaults({}).annotLineWidth, 2);
  assert.equal(mergeDefaults({ annotLineWidth: 5 }).annotLineWidth, 5);
  assert.equal(mergeDefaults({ annotLineWidth: 17 }).annotLineWidth, 17);
  assert.equal(mergeDefaults({ annotLineWidth: 41 }).annotLineWidth, 2);
  assert.equal(mergeDefaults({ annotLineWidth: 2.5 }).annotLineWidth, 2);
  assert.equal(mergeDefaults({ annotLineWidth: '3' }).annotLineWidth, 2);
  assert.equal(mergeDefaults({}).annotShapeKind, 'square');
  assert.equal(mergeDefaults({ annotShapeKind: 'arrow' }).annotShapeKind, 'arrow');
  assert.equal(mergeDefaults({ annotShapeKind: 'ink' }).annotShapeKind, 'square');
  assert.equal(mergeDefaults({ annotShapeKind: 7 }).annotShapeKind, 'square');

  const current = { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 300 }, annotColors: DEFAULT_COLORS, annotFontSize: 12, annotLineWidth: 3, annotShapeKind: 'circle' };
  assert.equal(mergeUi(current, { annotLineWidth: 8 }).annotLineWidth, 8);
  assert.equal(mergeUi(current, { annotLineWidth: 40 }).annotLineWidth, 40);
  assert.equal(mergeUi(current, { annotLineWidth: 0 }).annotLineWidth, 3);
  assert.equal(mergeUi(current, {}).annotLineWidth, 3);
  assert.equal(mergeUi(current, { annotShapeKind: 'line' }).annotShapeKind, 'line');
  assert.equal(mergeUi(current, { annotShapeKind: 'pen' }).annotShapeKind, 'circle');
  assert.equal(mergeUi(current, {}).annotShapeKind, 'circle');
  // 古い settings.json（2 つとも無い）から来た current でも落ちない。
  assert.equal(mergeUi({ mode: 'view', sidePanel: { open: true, width: 300 } }, {}).annotLineWidth, 2);
  assert.equal(mergeUi({ mode: 'view', sidePanel: { open: true, width: 300 } }, {}).annotShapeKind, 'square');
});

// プロセスが違うので import できない。並びがずれると、レンダラーで選べる
// モードが設定側で弾かれる（またはその逆）。
test('モードの一覧が renderer/shell.js と一致する', () => {
  require('../renderer/shell.js');

  assert.deepEqual(UI_MODES, globalThis.SigK.shell.MODES);
  assert.equal(isValidMode('view'), true);
  assert.equal(isValidMode('zzz'), false);
});

test('サイドパネルの上下限が renderer/shell.js と一致する', () => {
  require('../renderer/shell.js');

  assert.equal(SIDE_PANEL_MIN, globalThis.SigK.shell.SIDE_PANEL_MIN);
  assert.equal(SIDE_PANEL_MAX, globalThis.SigK.shell.SIDE_PANEL_MAX);
  assert.equal(clampSidePanelWidth(9999), globalThis.SigK.shell.clampSidePanelWidth(9999));
});

// ---- 見開きの永続化（spec-2-3 確定事項5） ----

test('pageLayout は single が既定で、不正な値は既定へ落ちる', () => {
  assert.equal(DEFAULTS.pageLayout, 'single');
  assert.deepEqual(require('../settings.js').PAGE_LAYOUTS, ['single', 'facing']);
  assert.equal(mergeDefaults({ pageLayout: 'facing' }).pageLayout, 'facing');
  assert.equal(mergeDefaults({ pageLayout: 'double' }).pageLayout, 'single');
  assert.equal(mergeDefaults({ pageLayout: 1 }).pageLayout, 'single');
  assert.equal(mergeDefaults({}).pageLayout, 'single');
});

test('pickUi と mergeUi は pageLayout を運ぶ', () => {
  const ui = pickUi(mergeDefaults({ mode: 'view', pageLayout: 'facing', sidePanel: { open: true, width: 240 } }));
  assert.equal(ui.pageLayout, 'facing');

  const current = { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 300 } };
  assert.equal(mergeUi(current, { pageLayout: 'facing' }).pageLayout, 'facing');
  // ほかのキーだけの更新では変わらない。使えない値も現在値のまま。
  assert.equal(mergeUi(current, { mode: 'pages' }).pageLayout, 'single');
  assert.equal(mergeUi(current, { pageLayout: 'zzz' }).pageLayout, 'single');
  // 古い settings.json（pageLayout が無い）から来た current でも落ちない。
  assert.equal(mergeUi({ mode: 'view', sidePanel: { open: true, width: 300 } }, {}).pageLayout, 'single');
});
