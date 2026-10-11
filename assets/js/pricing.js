// Розрахунок вартості замовлення. Це дзеркало backend/Pricing.gs (сервер завжди
// перераховує суму сам). Паритет перевіряє tests/pricing.test.mjs.
import { FORMAT_PRINT, FORMAT_DIGITAL, FORMAT_BOTH, normSize, isPortraitAlbum } from './domain.js';

export function typeKey(type) {
  if (type === 'На фоні') return 'background';
  if (type === 'Репортаж') return 'reportage';
  if (type === 'Портрет') return 'portret';
  return null;
}

export function printPriceKey(type, size) {
  const key = typeKey(type);
  if (!key) return null;
  return key + normSize(size).replace('x', 'X') + 'Print';
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

export function printPrice(prices, type, size) {
  const k = printPriceKey(type, size);
  return k ? num(prices[k]) : 0;
}

/** База позиції: без подарунка та відсоткової знижки. */
export function baseItemPrice(prices, type, size, format, count) {
  const key = typeKey(type);
  if (!key) return 0;
  const cnt = Number(count) || 1;
  if (format === FORMAT_DIGITAL) return num(prices[key + 'Digital']) * cnt;
  if (format === FORMAT_PRINT) return printPrice(prices, type, size) * cnt;
  if (format === FORMAT_BOTH) return printPrice(prices, type, size) * cnt + num(prices.printAndDigitalExtra);
  return 0;
}

export function baseTotal(prices, items) {
  return items.reduce((s, it) => s + baseItemPrice(prices, it.photoType, it.photoSize, it.photoFormat, it.count), 0);
}

export function giftActive(prices, album, base) {
  if (!album || !album.discountEnabled) return false;
  const threshold = num(prices.discountThreshold);
  if (threshold <= 0) return false;
  return base >= threshold;
}

export function percentDiscount(prices, base) {
  const pairs = [
    [num(prices.discountPriceThreshold), num(prices.discountPercent)],
    [num(prices.discountPriceThreshold2), num(prices.discountPercent2)],
    [num(prices.discountPriceThreshold3), num(prices.discountPercent3)]
  ];
  let active = 0;
  for (const [th, p] of pairs) if (th > 0 && p > 0 && base >= th && p > active) active = p;
  return active;
}

/**
 * items: [{photoNumber, photoType, photoSize, photoFormat, count}] — лише заповнені рядки.
 * Повертає { items:[+price, savedFormat], baseTotal, gift, percent, fullSession, total, totalPhotos }.
 */
export function calcOrder(prices, album, items, isFullSession) {
  const base = baseTotal(prices, items);
  const gift = giftActive(prices, album, base);
  const percent = percentDiscount(prices, base);

  let sum = 0;
  let photos = 0;
  const out = items.map((it) => {
    const cnt = Number(it.count) || 1;
    let price = baseItemPrice(prices, it.photoType, it.photoSize, it.photoFormat, cnt);
    let savedFormat = it.photoFormat;
    if (gift && (it.photoFormat === FORMAT_PRINT || it.photoFormat === FORMAT_BOTH)) {
      if (typeKey(it.photoType)) price = printPrice(prices, it.photoType, it.photoSize) * cnt;
      if (it.photoFormat === FORMAT_PRINT) savedFormat = FORMAT_BOTH;
    }
    if (percent > 0) price = price * (1 - percent / 100);
    price = round2(price);
    sum += price;
    photos += cnt;
    return { ...it, count: cnt, price, savedFormat };
  });

  const sessionPrice = num(prices.portretSessionPrice);
  const fullSession = !!isFullSession && isPortraitAlbum(album) && sessionPrice > 0;
  return {
    items: out,
    baseTotal: round2(base),
    gift,
    percent,
    fullSession,
    total: fullSession ? sessionPrice : round2(sum),
    totalPhotos: photos
  };
}

/** Формат цін для UI: 1200 → «1 200», 36.5 → «36,5». group:false — без роздільника тисяч. */
export function formatMoney(n, { group = true } = {}) {
  const v = round2(num(n));
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const [int, frac] = s.split('.');
  return (group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') : int) + (frac ? ',' + frac : '');
}
