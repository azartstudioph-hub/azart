// Імпорт даних із Wix: розбір CSV-експорту колекцій і підготовка пакетів для дії importData.
// Модуль «чистий» (без DOM), тому його можна перевіряти в Node: tests/wix-import.test.mjs.
//
// Файли Wix (Content Manager → колекція → Export → CSV):
//   AlbumSettings.csv, Orders.csv, OrderItems.csv, PriceSettings.csv, GroupPhotoLibrary.csv
import { parseCsvObjects } from './csv.js';
import { TYPES, FORMATS, STATUSES, SIZES, normSize, cleanGroupName, parseDriveFolderId } from './domain.js';

export const KINDS = ['albums', 'orders', 'items', 'prices', 'groupPhotos'];

/** Канонічні ключі цін (збігаються з backend/Pricing.gs). Wix писав розмір з малою «x» — зіставляємо без урахування регістру. */
export const PRICE_KEYS = [
  ...['background', 'reportage', 'portret'].flatMap((t) => ['10X15', '15X21', '20X30', '30X45'].map((s) => `${t}${s}Print`)),
  'backgroundDigital', 'reportageDigital', 'portretDigital', 'printAndDigitalExtra',
  'discountThreshold', 'discountPriceThreshold', 'discountPercent',
  'discountPriceThreshold2', 'discountPercent2', 'discountPriceThreshold3', 'discountPercent3',
  'portretSessionPrice'
];

const lower = (s) => String(s).trim().toLowerCase();
const naturalCmp = (a, b) => String(a).localeCompare(String(b), 'uk', { numeric: true, sensitivity: 'base' });

/** Який це файл — за назвами колонок. */
export function detectKind(headers) {
  const h = new Set(headers.map(lower));
  if (h.has('orderid') && h.has('photonumber')) return 'items';
  if (h.has('groupkeyword') && h.has('photourl')) return 'groupPhotos';
  if (h.has('printanddigitalextra') || h.has('portretsessionprice')) return 'prices';
  if (h.has('clientname') && h.has('albumid')) return 'orders';
  if (h.has('drivefolderid') || (h.has('deadline') && h.has('type') && h.has('size'))) return 'albums';
  return null;
}

/** Текст CSV → { kind, rows } (kind = null, якщо файл не впізнано). */
export function readCsv(text) {
  const rows = parseCsvObjects(String(text || ''));
  const headers = rows.length ? Object.keys(rows[0]) : firstLine(text);
  return { kind: detectKind(headers), rows };
}

function firstLine(text) {
  const line = String(text || '').replace(/^﻿/, '').split(/\r?\n/, 1)[0] || '';
  return line.split(',').map((s) => s.replace(/^"|"$/g, ''));
}

const val = (row, name) => {
  if (row[name] !== undefined) return row[name];
  const k = Object.keys(row).find((x) => lower(x) === lower(name));
  return k === undefined ? '' : row[k];
};
const str = (v) => String(v === null || v === undefined ? '' : v).trim();
const num = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v) : '');

function jsonList(v) {
  const s = str(v);
  if (!s) return [];
  if (s[0] === '[') {
    try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(str).filter(Boolean) : []; } catch (e) { return []; }
  }
  return s.split(',').map(str).filter(Boolean);
}

/** wix:image://v1/ID~mv2.jpg/назва.jpg#… → https://static.wixstatic.com/media/ID~mv2.jpg */
export function wixImageToUrl(v) {
  const s = str(v);
  if (/^https:\/\/\S+$/.test(s)) return s;
  const m = /^wix:image:\/\/v1\/([^/#?\s]+)/.exec(s);
  return m ? `https://static.wixstatic.com/media/${m[1]}` : '';
}

const capitalize = (s) => (s ? s[0].toLocaleUpperCase('uk') + s.slice(1) : s);

// ---------------------------------------------------------------------------
// Бланки
// ---------------------------------------------------------------------------
export function parseAlbums(rows) {
  const warnings = [];
  const list = [];
  rows.forEach((r, idx) => {
    const id = str(val(r, 'ID'));
    const title = str(val(r, 'Title')).replace(/\s+/g, ' ');
    const notes = [];     // зауваження (бланк усе одно можна імпортувати)
    const problems = [];  // помилки (бланк неможливо імпортувати)
    if (!/^[\w-]{1,64}$/.test(id)) problems.push('noId');
    if (!title) problems.push('noTitle');

    const types = jsonList(val(r, 'type')).filter((x) => TYPES.includes(x));
    if (!types.length) problems.push('noTypes');
    if (types.includes('Портрет') && types.length > 1) problems.push('portretMixed');

    let sizes = [...new Set(jsonList(val(r, 'size')).map(normSize).filter((x) => SIZES.includes(x)))];
    if (!sizes.length) { sizes = [...SIZES]; notes.push('defaultSizes'); }
    let formats = jsonList(val(r, 'format')).filter((x) => FORMATS.includes(x));
    if (!formats.length) { formats = [...FORMATS]; notes.push('defaultFormats'); }

    let typeRanges = [];
    const rawRanges = str(val(r, 'typeRangesJson'));
    if (rawRanges) {
      try {
        const parsed = JSON.parse(rawRanges);
        (Array.isArray(parsed) ? parsed : []).forEach((x) => {
          const from = Math.floor(Number(x && x.from)), to = Math.floor(Number(x && x.to));
          if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || !types.includes(x.type)) { notes.push('badRange'); return; }
          typeRanges.push({ from, to, type: x.type, group: cleanGroupName(x.group || '') });
        });
      } catch (e) { notes.push('badRange'); typeRanges = []; }
    }

    const d = str(val(r, 'deadline')).slice(0, 10);
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';

    let folder = str(val(r, 'driveFolderId'));
    if (folder && !/^[\w-]+$/.test(folder)) {
      const parsed = parseDriveFolderId(folder);
      if (parsed) folder = parsed; else { notes.push('badFolder'); folder = ''; }
    }
    if (folder && folder.length < 20) notes.push('shortFolder');
    if (!folder) notes.push('noFolder');

    const rawDiscount = lower(val(r, 'discountEnabled'));
    list.push({
      id, title, kindergarten: str(val(r, 'kindergarten')), deadline, driveFolderId: folder,
      types, sizes, formats, typeRanges,
      discountEnabled: rawDiscount === 'true',
      discountKnown: rawDiscount === 'true' || rawDiscount === 'false',
      createdAt: isoDate(val(r, 'Created Date')),
      notes: [...new Set(notes)], problems, line: idx + 2
    });
  });
  const seen = new Set();
  list.forEach((a) => {
    if (a.id && seen.has(a.id)) { a.problems.push('dupId'); warnings.push({ key: 'dupAlbum', vars: { title: a.title } }); }
    seen.add(a.id);
  });
  return { list, warnings };
}

// ---------------------------------------------------------------------------
// Замовлення та позиції
// ---------------------------------------------------------------------------
function cleanComment(v) {
  return str(v).replace(/<\/p>\s*<p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?p>/gi, '').trim();
}

export function parseOrders(rows) {
  const warnings = [];
  const list = [];
  let noId = 0;
  rows.forEach((r) => {
    const id = str(val(r, 'ID'));
    if (!/^[\w-]{1,64}$/.test(id)) { noId++; return; }
    list.push({
      id, albumId: str(val(r, 'albumId')),
      clientName: str(val(r, 'clientName')).replace(/\s+/g, ' '),
      phone: str(val(r, 'phoneNumber')),
      comment: cleanComment(val(r, 'comment')),
      status: STATUSES[0],
      groupFolderId: str(val(r, 'groupFolderId')),
      groupName: cleanGroupName(val(r, 'groupName')),
      createdAt: isoDate(val(r, 'Created Date')) || isoDate(val(r, 'createdDate')),
      totalPrice: num(val(r, 'totalPrice')),
      totalPhotos: Math.max(0, Math.floor(num(val(r, 'totalPhotos')))),
      isFullSession: lower(val(r, 'isFullSession')) === 'true'
    });
  });
  if (noId) warnings.push({ key: 'ordersNoId', vars: { n: noId } });
  return { list, warnings };
}

/**
 * Позиції замовлень. Експорт Wix відсортований за випадковим ID, тому початковий порядок рядків
 * усередині замовлення втрачено: впорядковуємо їх за номером фото (стабільно й передбачувано).
 */
export function parseItems(rows) {
  const warnings = [];
  const raw = [];
  let noId = 0;
  rows.forEach((r, idx) => {
    const id = str(val(r, 'ID'));
    const orderId = str(val(r, 'orderId'));
    if (!/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(orderId)) { noId++; return; }
    const type = str(val(r, 'photoType'));
    const format = str(val(r, 'photoFormat'));
    raw.push({
      idx, id, orderId, photoNumber: str(val(r, 'photoNumber')),
      photoType: TYPES.includes(type) ? type : '',
      photoSize: normSize(val(r, 'photoSize')),
      photoFormat: FORMATS.includes(format) ? format : '',
      price: num(val(r, 'price')), count: Math.max(1, Math.floor(num(val(r, 'count'))) || 1)
    });
  });
  const byOrder = new Map();
  raw.forEach((it) => { if (!byOrder.has(it.orderId)) byOrder.set(it.orderId, []); byOrder.get(it.orderId).push(it); });
  const list = [];
  byOrder.forEach((arr) => {
    arr.sort((a, b) => naturalCmp(a.photoNumber, b.photoNumber) || a.idx - b.idx);
    arr.forEach((it, i) => { list.push({ ...it, position: i + 1, idx: undefined }); });
  });
  if (noId) warnings.push({ key: 'itemsNoId', vars: { n: noId } });
  const bad = raw.filter((it) => !it.photoType || !it.photoFormat).length;
  if (bad) warnings.push({ key: 'itemsBadValue', vars: { n: bad } });
  return { list, warnings };
}

// ---------------------------------------------------------------------------
// Ціни та фото груп
// ---------------------------------------------------------------------------
export function parsePrices(rows) {
  const warnings = [];
  if (!rows.length) return { values: {}, found: 0, missing: [...PRICE_KEYS], warnings };
  // кілька рядків — беремо найновіший за «Updated Date»
  const row = rows.slice().sort((a, b) => str(val(b, 'Updated Date')).localeCompare(str(val(a, 'Updated Date'))))[0];
  const byLower = new Map(Object.keys(row).map((k) => [lower(k), k]));
  const values = {};
  const missing = [];
  PRICE_KEYS.forEach((key) => {
    const src = byLower.get(lower(key));
    const raw = src === undefined ? '' : str(row[src]);
    if (raw === '' || !Number.isFinite(Number(raw.replace(',', '.')))) { missing.push(key); return; }
    values[key] = num(raw);
  });
  if (missing.length) warnings.push({ key: 'pricesMissing', vars: { n: missing.length, list: missing.join(', ') } });
  return { values, found: Object.keys(values).length, missing, warnings };
}

export function parseGroupPhotos(rows) {
  const warnings = [];
  const byKey = new Map();
  let bad = 0, dups = 0;
  rows.forEach((r) => {
    const kindergarten = str(val(r, 'kindergarten'));
    const groupName = capitalize(cleanGroupName(val(r, 'groupKeyword')));
    const photoUrl = wixImageToUrl(val(r, 'photoUrl'));
    if (!kindergarten || !groupName || !photoUrl) { bad++; return; }
    const key = `${kindergarten}|${groupName.toLowerCase()}`;
    if (byKey.has(key)) dups++;
    byKey.set(key, { kindergarten, groupName, photoUrl });
  });
  if (bad) warnings.push({ key: 'photosBad', vars: { n: bad } });
  if (dups) warnings.push({ key: 'photosDup', vars: { n: dups } });
  return { list: [...byKey.values()], warnings };
}

// ---------------------------------------------------------------------------
// Звірка й пакети
// ---------------------------------------------------------------------------

/** Кількість замовлень на бланк (для підказок у таблиці бланків). */
export function countOrdersByAlbum(orders) {
  const m = new Map();
  orders.forEach((o) => m.set(o.albumId, (m.get(o.albumId) || 0) + 1));
  return m;
}

/** Зв'язки між файлами: замовлення без бланка, позиції без замовлення, розбіжності сум. */
export function checkConsistency({ albums = [], orders = [], items = [] }) {
  const albumIds = new Set(albums.map((a) => a.id));
  const orderIds = new Set(orders.map((o) => o.id));
  const orphanOrders = orders.filter((o) => !albumIds.has(o.albumId));
  const orphanItems = items.filter((i) => !orderIds.has(i.orderId));
  const sums = new Map();
  items.forEach((i) => sums.set(i.orderId, (sums.get(i.orderId) || 0) + i.price));
  const mismatch = orders.filter((o) => !o.isFullSession && sums.has(o.id) && Math.round(sums.get(o.id)) !== Math.round(o.totalPrice));
  const noItems = orders.filter((o) => !sums.has(o.id));
  return { orphanOrders: orphanOrders.length, orphanItems: orphanItems.length, mismatch: mismatch.length, noItems: noItems.length };
}

export const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * Готує послідовність викликів importData.
 * choices: { albums: { [id]: { include, kindergarten, discountEnabled } }, importPrices: bool }
 */
export function buildBatches(parsed, choices, { orderChunk = 300, itemChunk = 600 } = {}) {
  const albumChoice = (a) => (choices.albums && choices.albums[a.id]) || {};
  const chosen = (parsed.albums || []).filter((a) => !a.problems.length && albumChoice(a).include !== false);
  const albumIds = new Set(chosen.map((a) => a.id));
  const albums = chosen.map((a) => {
    const c = albumChoice(a);
    return {
      id: a.id, title: a.title, kindergarten: c.kindergarten || a.kindergarten, deadline: a.deadline,
      driveFolderId: a.driveFolderId, types: a.types, sizes: a.sizes, formats: a.formats, typeRanges: a.typeRanges,
      discountEnabled: !!(c.discountEnabled !== undefined ? c.discountEnabled : a.discountEnabled),
      createdAt: a.createdAt
    };
  });
  const orders = (parsed.orders || []).filter((o) => albumIds.has(o.albumId));
  const orderIds = new Set(orders.map((o) => o.id));
  const items = (parsed.items || []).filter((i) => orderIds.has(i.orderId));
  const groupPhotos = parsed.groupPhotos || [];

  const first = { albums, groupPhotos };
  if (choices.importPrices && parsed.prices && Object.keys(parsed.prices).length) first.prices = parsed.prices;

  const batches = [{ kind: 'base', count: albums.length + groupPhotos.length, data: first }];
  chunk(orders, orderChunk).forEach((c) => batches.push({ kind: 'orders', count: c.length, data: { orders: c } }));
  chunk(items, itemChunk).forEach((c) => batches.push({ kind: 'items', count: c.length, data: { items: c } }));

  return {
    batches,
    totals: { albums: albums.length, orders: orders.length, items: items.length, groupPhotos: groupPhotos.length, prices: first.prices ? Object.keys(first.prices).length : 0 },
    skipped: { orders: (parsed.orders || []).length - orders.length, items: (parsed.items || []).length - items.length }
  };
}

/** Складає статистику кількох викликів importData в одну. */
export function mergeStats(total, s) {
  const out = total || { albums: { added: 0, updated: 0 }, orders: { added: 0, updated: 0 }, items: { added: 0, updated: 0 }, groupPhotos: { added: 0, updated: 0 }, prices: 0, warnings: [] };
  ['albums', 'orders', 'items', 'groupPhotos'].forEach((k) => {
    out[k].added += (s[k] && s[k].added) || 0;
    out[k].updated += (s[k] && s[k].updated) || 0;
  });
  out.prices += s.prices || 0;
  out.warnings.push(...(s.warnings || []));
  return out;
}
