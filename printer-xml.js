'use strict';

// プリンターの印刷チケット（PrintTicketXML）と能力情報（PrintCapabilitiesXML）を読む（spec-7-7 確定事項C3）。
//
// どちらも Windows の Print Schema の XML で、Get-PrintConfiguration が返す。名前空間の接頭辞（psf・psk・ns0000 など）は
// ドライバーごとに変わり得るので、接頭辞を見ずに要素の名前と name 属性の後ろの部分で探す。
// main 側には DOMParser が無いので、正規表現で読む。ここは DOM に触らない純粋関数だけにして、試験で XML の見本を通す。
// 長さの単位は µm（マイクロメートル）。Print Schema の値をそのまま使う。

// 取得できない時の初期値（spec-7-7 確定事項C3）。A4・四辺 4.23 mm・片面・カラー。
const FALLBACK_MARGIN = 4230;

// ページ設定画面の用紙サイズの初期の一覧（プリンターから一覧を取得できない時に使う）。
const STANDARD_SIZES = [
  { id: 'psk:ISOA3', name: 'A3', width: 297000, height: 420000 },
  { id: 'psk:ISOA4', name: 'A4', width: 210000, height: 297000 },
  { id: 'psk:ISOA5', name: 'A5', width: 148000, height: 210000 },
  { id: 'psk:JISB4', name: 'B4 (JIS)', width: 257000, height: 364000 },
  { id: 'psk:JISB5', name: 'B5 (JIS)', width: 182000, height: 257000 },
  { id: 'psk:NorthAmericaLetter', name: 'レター', width: 215900, height: 279400 },
  { id: 'psk:NorthAmericaLegal', name: 'リーガル', width: 215900, height: 355600 },
  { id: 'psk:NorthAmericaTabloid', name: 'タブロイド', width: 279400, height: 431800 },
];

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameAttr = (local) => `name="(?:[^":]+:)?${escapeRe(local)}"`;

const VALUE_RE = /<(?:[\w.-]+:)?Value\b[^>]*>([^<]*)<\//;
const REF_RE = /^\s*<(?:[\w.-]+:)?ParameterRef\b[^>]*name="([^"]+)"/;

// 印刷チケットの ParameterInit の値（ユーザー定義サイズの幅と高さは、ここに入る）。
function parameterValue(whole, id) {
  const re = new RegExp(`<(?:[\\w.-]+:)?ParameterInit\\b[^>]*name="${escapeRe(id)}"[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?ParameterInit>`);
  const hit = re.exec(whole);
  const value = hit === null ? null : VALUE_RE.exec(hit[1]);
  return value === null ? null : value[1].trim();
}

// name 属性が local の要素の値。値は、その要素の直下の Value か、ParameterRef が指す ParameterInit にある。
// 次の name 属性より後ろは見ない（別の項目の値を拾わないため）。
function valueAfter(xml, local, from = 0, whole = xml) {
  const head = new RegExp(`${nameAttr(local)}[^>]*>`).exec(xml.slice(from));
  if (head === null)
    return null;
  const rest = xml.slice(from + head.index + head[0].length);
  const ref = REF_RE.exec(rest);
  if (ref !== null)
    return parameterValue(whole, ref[1]);
  const next = rest.search(/\bname="/);
  const value = VALUE_RE.exec(next < 0 ? rest : rest.slice(0, next));
  return value === null ? null : value[1].trim();
}

function numberAfter(xml, local, from = 0, whole = xml) {
  const text = valueAfter(xml, local, from, whole);
  const number = Number(text);
  return text === null || text === '' || !Number.isFinite(number) ? null : number;
}

// Feature の中身（次の Feature の閉じタグまで）。Option の中に Feature は入らないので、最短一致で足りる。
function featureBody(xml, local) {
  const re = new RegExp(`<(?:[\\w.-]+:)?Feature\\b[^>]*${nameAttr(local)}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?Feature>`);
  const hit = re.exec(xml);
  return hit === null ? null : hit[1];
}

// Feature の中の Option を、名前と中身の組にして返す。
function featureOptions(xml, local) {
  const body = featureBody(xml, local);
  if (body === null)
    return [];
  const options = [];
  const re = /<(?:[\w.-]+:)?Option\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?Option>)/g;
  for (let hit = re.exec(body); hit !== null; hit = re.exec(body)) {
    const name = /name="([^"]+)"/.exec(hit[1]);
    options.push({ id: name === null ? '' : name[1], body: hit[3] ?? '' });
  }
  return options;
}

const localName = (id) => String(id ?? '').replace(/^[^:]*:/, '');

const DUPLEX = { OneSided: 'simplex', TwoSidedLongEdge: 'longEdge', TwoSidedShortEdge: 'shortEdge' };

function duplexFromId(id) {
  return DUPLEX[localName(id)] ?? null;
}

// 印刷チケット: 今の用紙・両面・カラー。
function readTicket(xml) {
  const text = String(xml ?? '');
  const media = featureOptions(text, 'PageMediaSize')[0] ?? null;
  const width = media === null ? null : numberAfter(media.body, 'MediaSizeWidth', 0, text);
  const height = media === null ? null : numberAfter(media.body, 'MediaSizeHeight', 0, text);
  const duplex = featureOptions(text, 'JobDuplexAllDocumentsContiguously')[0]
    ?? featureOptions(text, 'DocumentDuplex')[0] ?? null;
  const color = featureOptions(text, 'PageOutputColor')[0] ?? null;
  return {
    paper: media !== null && width > 0 && height > 0 ? { id: media.id, width, height } : null,
    duplex: duplex === null ? null : duplexFromId(duplex.id),
    color: color === null ? null : localName(color.id) === 'Color',
  };
}

// 能力情報: 印刷可能領域・用紙サイズ一覧・両面とカラーの可否。
function readCapabilities(xml) {
  const text = String(xml ?? '');
  const at = text.search(new RegExp(nameAttr('PageImageableSize')));
  let imageable = null;
  if (at >= 0) {
    const pick = (local) => numberAfter(text, local, at);
    const area = { x: pick('OriginWidth'), y: pick('OriginHeight'), width: pick('ExtentWidth'), height: pick('ExtentHeight') };
    const paper = { width: pick('ImageableSizeWidth'), height: pick('ImageableSizeHeight') };
    if (Object.values(area).every((v) => Number.isFinite(v)) && area.width > 0 && area.height > 0)
      imageable = { ...area, paperWidth: paper.width, paperHeight: paper.height };
  }
  const sizes = featureOptions(text, 'PageMediaSize').map((option) => ({
    id: option.id,
    name: valueAfter(option.body, 'DisplayName') || localName(option.id),
    width: numberAfter(option.body, 'MediaSizeWidth'),
    height: numberAfter(option.body, 'MediaSizeHeight'),
  })).filter((size) => size.width > 0 && size.height > 0);
  const duplexIds = featureOptions(text, 'JobDuplexAllDocumentsContiguously').map((o) => duplexFromId(o.id));
  const colorIds = featureOptions(text, 'PageOutputColor').map((o) => localName(o.id));
  return {
    imageable,
    paperSizes: sizes,
    duplexSupported: duplexIds.includes('longEdge') || duplexIds.includes('shortEdge'),
    colorSupported: colorIds.length === 0 || colorIds.includes('Color'),
  };
}

// 印刷可能領域を、用紙の大きさの中に収める。能力情報が別の用紙の値だった時は、四辺の余白だけを借りる。
function fitImageable(paper, imageable) {
  const fallback = { x: FALLBACK_MARGIN, y: FALLBACK_MARGIN, width: paper.width - 2 * FALLBACK_MARGIN, height: paper.height - 2 * FALLBACK_MARGIN };
  if (imageable === null)
    return fallback;
  const sameSize = imageable.paperWidth === paper.width && imageable.paperHeight === paper.height;
  if (sameSize)
    return { x: imageable.x, y: imageable.y, width: imageable.width, height: imageable.height };
  const right = Math.max(0, (imageable.paperWidth ?? paper.width) - imageable.x - imageable.width);
  const bottom = Math.max(0, (imageable.paperHeight ?? paper.height) - imageable.y - imageable.height);
  const width = paper.width - imageable.x - right;
  const height = paper.height - imageable.y - bottom;
  return width > 0 && height > 0 ? { x: imageable.x, y: imageable.y, width, height } : fallback;
}

// Get-PrintConfiguration の結果から、印刷画面が使う形にまとめる。
function buildConfig(raw) {
  const ticket = readTicket(raw?.ticket);
  const caps = readCapabilities(raw?.caps);
  const list = caps.paperSizes.length > 0 ? caps.paperSizes : STANDARD_SIZES;
  const known = ticket.paper === null ? null : list.find((size) => size.id === ticket.paper.id);
  const paper = ticket.paper === null
    ? { ...STANDARD_SIZES[1] }
    : { id: ticket.paper.id, name: known?.name ?? localName(ticket.paper.id), width: ticket.paper.width, height: ticket.paper.height };
  const duplexMode = ticket.duplex ?? duplexFromId(`psk:${raw?.duplexingMode ?? ''}`) ?? 'simplex';
  return {
    ok: true,
    source: ticket.paper === null ? 'fallback' : 'printer',
    paper,
    imageable: fitImageable(paper, caps.imageable),
    duplex: { supported: caps.duplexSupported || duplexMode !== 'simplex', mode: duplexMode },
    color: { supported: caps.colorSupported, value: ticket.color ?? (raw?.color !== false) },
    collate: raw?.collate !== false,
    paperSizes: list,
  };
}

function fallbackConfig(reason = null) {
  const paper = { ...STANDARD_SIZES[1] };
  return {
    ok: false, source: 'fallback', reason, paper,
    imageable: fitImageable(paper, null),
    duplex: { supported: true, mode: 'simplex' },
    color: { supported: true, value: true },
    collate: true,
    paperSizes: STANDARD_SIZES,
  };
}

module.exports = { FALLBACK_MARGIN, STANDARD_SIZES, readTicket, readCapabilities, fitImageable, buildConfig, fallbackConfig };
