import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { veloCalc } = require('./velo-reference.js');
const { createGas } = require('../dev/gas-emulator.js');
const P = await import('../assets/js/pricing.js');
const { TYPES, SIZES, FORMATS } = await import('../assets/js/domain.js');
const { parseCsvObjects } = await import('../assets/js/csv.js');

const PRICES = {
  background10X15Print: 60, background15X21Print: 90, background20X30Print: 150, background30X45Print: 200,
  reportage10X15Print: 40, reportage15X21Print: 60, reportage20X30Print: 100, reportage30X45Print: 150,
  portret10X15Print: 60, portret15X21Print: 80, portret20X30Print: 120, portret30X45Print: 150,
  backgroundDigital: 60, reportageDigital: 40, portretDigital: 60, printAndDigitalExtra: 10,
  discountThreshold: 600, discountPriceThreshold: 1000, discountPercent: 10,
  discountPriceThreshold2: 1500, discountPercent2: 15, discountPriceThreshold3: 2000, discountPercent3: 20,
  portretSessionPrice: 1000
};

// Лінійний конгруентний генератор — тест відтворюваний.
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

function randomItems(portrait) {
  const n = 1 + Math.floor(rnd() * 14);
  return Array.from({ length: n }, (_, i) => {
    const format = pick(FORMATS);
    return {
      photoNumber: 'IMG_' + (1000 + i) + '.JPG',
      photoType: portrait ? 'Портрет' : pick(['Репортаж', 'На фоні']),
      photoSize: format === 'Електронні' ? '' : pick(SIZES),
      photoFormat: format,
      count: format === 'Електронні' ? 1 : 1 + Math.floor(rnd() * 10)
    };
  });
}

const gas = createGas();
gas.run('setup');

test('нова логіка цін = дослівна логіка Wix (випадкові замовлення)', () => {
  for (let iter = 0; iter < 3000; iter++) {
    const portrait = rnd() < 0.25;
    const album = { types: portrait ? ['Портрет'] : ['Репортаж', 'На фоні'], discountEnabled: rnd() < 0.6 };
    const items = randomItems(portrait);
    const full = portrait && rnd() < 0.5;
    const prices = { ...PRICES };
    if (rnd() < 0.3) { prices.discountThreshold = Math.floor(rnd() * 800); prices.discountPriceThreshold = Math.floor(rnd() * 900); }

    // еталон працює з кириличною «х» у розмірах, як у Wix
    const veloItems = items.map((i) => ({ ...i, photoSize: i.photoSize.replace('x', 'х') }));
    const ref = veloCalc({
      priceSettings: { ...prices }, currentAlbum: album, orderItems: veloItems,
      isFullSession: full, portraitSessionPrice: prices.portretSessionPrice
    });

    const client = P.calcOrder(prices, album, items, full);
    assert.equal(client.total, ref.total, 'client total, iter ' + iter);
    assert.equal(client.gift, ref.gift);
    assert.equal(client.percent, ref.percent);
    client.items.forEach((it, i) => assert.equal(it.price, ref.items[i].price, 'client item ' + i + ' iter ' + iter));

    const server = gas.ctx.calcOrder_(prices, album, items, full);
    assert.equal(server.total, ref.total, 'server total, iter ' + iter);
    server.items.forEach((it, i) => {
      assert.equal(it.price, ref.items[i].price, 'server item ' + i);
      assert.equal(it.savedFormat, client.items[i].savedFormat);
    });
  }
});

test('приклад з реального замовлення: Репортаж 15х21 «Друковані + електронні» = 70', () => {
  const r = P.calcOrder(PRICES, { types: ['Репортаж'] }, [
    { photoNumber: 'IMG_5301.JPG', photoType: 'Репортаж', photoSize: '15х21', photoFormat: 'Друковані + електронні', count: 1 }
  ], false);
  assert.equal(r.total, 70);
});

test('подарунок: «Друковані» зберігаються як «Друковані + електронні»', () => {
  const items = [
    { photoNumber: 'a', photoType: 'На фоні', photoSize: '30x45', photoFormat: 'Друковані', count: 3 },
    { photoNumber: 'b', photoType: 'На фоні', photoSize: '', photoFormat: 'Електронні', count: 1 }
  ];
  const r = P.calcOrder(PRICES, { types: ['На фоні'], discountEnabled: true }, items, false);
  assert.equal(r.gift, true);
  assert.equal(r.items[0].savedFormat, 'Друковані + електронні');
  assert.equal(r.items[0].price, 600);
  assert.equal(r.items[1].price, 60);
  const off = P.calcOrder(PRICES, { types: ['На фоні'], discountEnabled: false }, items, false);
  assert.equal(off.gift, false);
  assert.equal(off.items[0].savedFormat, 'Друковані');
});

test('портрет: «Вся фотосесія» = фіксована ціна', () => {
  const items = [{ photoNumber: 'p', photoType: 'Портрет', photoSize: '10x15', photoFormat: 'Друковані', count: 1 }];
  const r = P.calcOrder(PRICES, { types: ['Портрет'] }, items, true);
  assert.equal(r.total, 1000);
  assert.equal(r.fullSession, true);
  // у непортретному бланку прапорець ігнорується
  const r2 = P.calcOrder(PRICES, { types: ['Репортаж'] }, items.map((i) => ({ ...i, photoType: 'Репортаж' })), true);
  assert.equal(r2.fullSession, false);
});

test('форматування грошей', () => {
  assert.equal(P.formatMoney(2830), '2 830');
  assert.equal(P.formatMoney(36.5), '36,5');
  assert.equal(P.formatMoney(0), '0');
});

// ---------------------------------------------------------------------------
// Реальні дані Wix (якщо доступні): перераховуємо збережені замовлення.
// ---------------------------------------------------------------------------
const WIX = process.env.WIX_DATA_DIR || '/root/.claude/uploads/f4661c74-16a3-59fd-b33a-d29143b33926';
const find = (suffix) => fs.existsSync(WIX) ? fs.readdirSync(WIX).find((f) => f.endsWith(suffix)) : null;
const hasWix = find('-Orders.csv') && find('-OrderItems.csv') && find('-PriceSettings.csv') && find('-AlbumSettings.csv');

test('реальні замовлення з Wix перераховуються до тих самих сум', { skip: !hasWix && 'немає CSV Wix (WIX_DATA_DIR)' }, () => {
  const read = (s) => parseCsvObjects(fs.readFileSync(path.join(WIX, find(s)), 'utf8'));
  const orders = read('-Orders.csv');
  const items = read('-OrderItems.csv');
  const ps = read('-PriceSettings.csv')[0];
  const prices = {};
  for (const [k, v] of Object.entries(ps)) {
    if (/Print$|Digital$|^printAnd|^discount|SessionPrice$/.test(k)) prices[k.replace(/(\d+)x(\d+)Print$/, '$1X$2Print')] = Number(v);
  }
  assert.equal(prices.reportage15X21Print, 60);
  assert.equal(orders.length, 13);

  let checked = 0, itemsChecked = 0;
  const mismatches = [];
  for (const o of orders) {
    const its = items.filter((i) => i.orderId === o.ID).map((i) => ({
      photoNumber: i.photoNumber, photoType: i.photoType, photoSize: i.photoSize, photoFormat: i.photoFormat, count: Number(i.count) || 1, stored: Number(i.price)
    }));
    const calc = P.calcOrder(prices, { types: ['Репортаж', 'На фоні', 'Портрет'], discountEnabled: true }, its, o.isFullSession === 'true');
    checked++;
    calc.items.forEach((c, i) => { itemsChecked++; if (Math.abs(c.price - its[i].stored) > 0.005) mismatches.push(`позиція ${c.photoNumber}: ${c.price} ≠ ${its[i].stored}`); });
    if (Math.abs(calc.total - Number(o.totalPrice)) > 0.005) mismatches.push(`замовлення ${o.clientName}: ${calc.total} ≠ ${o.totalPrice}`);
  }
  console.log(`  перевірено замовлень: ${checked}, позицій: ${itemsChecked}, розбіжностей: ${mismatches.length}`);
  if (mismatches.length) console.log('  ' + mismatches.join('\n  '));
  assert.equal(mismatches.length, 0);
});
