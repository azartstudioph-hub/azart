// Розбір CSV із Wix та пакети для importData (чиста логіка) + наскрізна перевірка з емульованим бекендом.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  readCsv, detectKind, parseAlbums, parseOrders, parseItems, parsePrices, parseGroupPhotos,
  wixImageToUrl, checkConsistency, buildBatches, mergeStats, PRICE_KEYS, chunk
} from '../assets/js/wix-import.js';

const require = createRequire(import.meta.url);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/wix');
const read = (n) => readCsv(fs.readFileSync(path.join(dir, n), 'utf8'));

function loadAll() {
  const files = { albums: read('AlbumSettings.csv'), orders: read('Orders.csv'), items: read('OrderItems.csv'), prices: read('PriceSettings.csv'), groupPhotos: read('GroupPhotoLibrary.csv') };
  return {
    files,
    albums: parseAlbums(files.albums.rows), orders: parseOrders(files.orders.rows), items: parseItems(files.items.rows),
    prices: parsePrices(files.prices.rows), groupPhotos: parseGroupPhotos(files.groupPhotos.rows)
  };
}

test('detectKind: кожен файл розпізнається за колонками', () => {
  const k = loadAll().files;
  assert.deepEqual(Object.entries(k).map(([key, v]) => [key, v.kind]), [
    ['albums', 'albums'], ['orders', 'orders'], ['items', 'items'], ['prices', 'prices'], ['groupPhotos', 'groupPhotos']
  ]);
  assert.equal(detectKind(['foo', 'bar']), null);
  assert.equal(readCsv('').kind, null);
});

test('parseAlbums: JSON-списки, кирилична «х», діапазони, дедлайн, папка, прапорець подарунка', () => {
  const { list } = loadAll().albums;
  assert.equal(list.length, 3);
  const [a1, a2, a3] = list;
  assert.deepEqual(a1.types, ['Репортаж', 'На фоні']);
  assert.deepEqual(a1.sizes, ['10x15', '15x21', '20x30', '30x45']);
  assert.equal(a1.deadline, '2026-04-20');
  assert.equal(a1.driveFolderId, '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123');
  assert.equal(a1.discountEnabled, true);
  assert.equal(a1.discountKnown, true);
  assert.equal(a1.createdAt, '2026-03-01T10:00:00Z');
  // два правильні діапазони, третій (5 > 2) відкинуто з поміткою; назва групи нормалізована, але регістр збережено
  assert.deepEqual(a1.typeRanges, [
    { from: 1, to: 100, type: 'На фоні', group: 'група 1' },
    { from: 101, to: 200, type: 'Репортаж', group: 'Група 1' }
  ]);
  assert.ok(a1.notes.includes('badRange'));
  assert.deepEqual(a1.problems, []);
  assert.equal(a1.kindergarten, '', 'у Wix садочок для бланка не зберігався');

  assert.deepEqual(a2.types, ['Портрет']);
  assert.equal(a2.discountEnabled, false);
  assert.equal(a2.discountKnown, false, 'порожнє значення Wix ≠ «вимкнено»');
  assert.ok(a2.notes.includes('shortFolder'));

  assert.ok(a3.problems.includes('noTypes'));
  assert.deepEqual(a3.formats, ['Друковані', 'Електронні', 'Друковані + електронні'], 'порожній формат → усі');
  assert.ok(a3.notes.includes('defaultFormats') && a3.notes.includes('noFolder'));
});

test('parseOrders: статус, групи, коментар без <p>, багаторядкове ім\'я, повна сесія', () => {
  const { list, warnings } = loadAll().orders;
  assert.equal(list.length, 7);
  const o1 = list[0];
  assert.equal(o1.clientName, 'Тестова Олена');
  assert.equal(o1.groupName, 'Група 1', 'подвійний пробіл прибрано');
  assert.equal(o1.comment, 'Матовий папір');
  assert.equal(o1.phone, '0950000001');
  assert.equal(o1.createdAt, '2026-03-10T08:00:00Z');
  assert.equal(o1.isFullSession, false);
  assert.equal(list[2].clientName, 'Зразок, Марія (другий рядок)');
  assert.equal(list[2].isFullSession, true);
  assert.equal(list[2].comment, 'Коментар, з комою');
  assert.equal(list[4].status, 'Нове', 'невідомий статус → Нове');
  assert.ok(warnings.some((w) => w.key === 'ordersBadStatus'));
});

test('parseItems: позиції впорядковано за номером фото в межах замовлення; невідомі значення очищено', () => {
  const { list, warnings } = loadAll().items;
  const o = loadAll().orders.list[0];
  const mine = list.filter((i) => i.orderId === o.id);
  assert.deepEqual(mine.map((i) => i.photoNumber), ['IMG_0101.JPG', 'IMG_0102.JPG', 'IMG_0103.JPG', 'IMG_0109.JPG', 'IMG_0110.JPG']);
  assert.deepEqual(mine.map((i) => i.position), [1, 2, 3, 4, 5]);
  assert.equal(mine[0].photoSize, '15x21');
  assert.equal(mine[2].photoSize, '');
  const bad = list.find((i) => i.photoNumber === 'IMG_0501.JPG');
  assert.equal(bad.photoType, '');
  assert.equal(bad.photoFormat, '');
  assert.ok(warnings.some((w) => w.key === 'itemsBadValue'));
  const portrait = list.find((i) => i.photoNumber === 'IMG_0301.JPG');
  assert.equal(portrait.price, 0, 'порожня ціна → 0');
});

test('parsePrices: ключі з малою «x» зіставляються з канонічними; усі 24 знайдено', () => {
  const p = loadAll().prices;
  assert.equal(PRICE_KEYS.length, 24);
  assert.equal(p.found, 24);
  assert.deepEqual(p.missing, []);
  assert.equal(p.values.background10X15Print, 60);
  assert.equal(p.values.portret30X45Print, 150);
  assert.equal(p.values.discountPercent3, 20);
  assert.equal(p.values.portretSessionPrice, 1000);
  const partial = parsePrices([{ 'Title': '', background10x15Print: '55', 'Updated Date': '2026-01-01T00:00:00Z' }]);
  assert.equal(partial.found, 1);
  assert.equal(partial.missing.length, 23);
  assert.equal(partial.warnings[0].key, 'pricesMissing');
});

test('parseGroupPhotos: wix:image → https, "група 5" → "Група 5", дублі та порожні відкинуто', () => {
  assert.equal(wixImageToUrl('wix:image://v1/ba1941_920a~mv2.jpg/%D0%B3.jpg#originWidth=1'), 'https://static.wixstatic.com/media/ba1941_920a~mv2.jpg');
  assert.equal(wixImageToUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(wixImageToUrl('ftp://nope'), '');
  assert.equal(wixImageToUrl(''), '');
  const { list, warnings } = loadAll().groupPhotos;
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((g) => g.groupName), ['Група 1', 'Група 2', 'Група 5', 'Група 3']);
  assert.equal(list[0].photoUrl, 'https://static.wixstatic.com/media/fixture_00000000000000000000000000000001~mv2.jpg');
  assert.equal(list[3].kindergarten, 'Сад 1');
  assert.ok(warnings.some((w) => w.key === 'photosBad'));
});

test('checkConsistency: сироти й розбіжності сум', () => {
  const all = loadAll();
  const c = checkConsistency({ albums: all.albums.list, orders: all.orders.list, items: all.items.list });
  assert.equal(c.orphanOrders, 1, 'замовлення з невідомим бланком');
  assert.equal(c.orphanItems, 1, 'позиція з невідомим замовленням');
  assert.equal(c.noItems, 1, 'замовлення без позицій');
  assert.ok(c.mismatch >= 1);
});

test('buildBatches: враховує вибір, пропускає сироти й бланки з помилками, ділить на частини', () => {
  const all = loadAll();
  const [a1, a2, a3] = all.albums.list;
  const parsed = { albums: all.albums.list, orders: all.orders.list, items: all.items.list, groupPhotos: all.groupPhotos.list, prices: all.prices.values };
  const choices = { albums: { [a1.id]: { include: true, kindergarten: 'Сад 7', discountEnabled: true }, [a2.id]: { include: true, kindergarten: 'Сад 1' }, [a3.id]: { include: true, kindergarten: 'Сад 1' } }, importPrices: true };
  const r = buildBatches(parsed, choices, { orderChunk: 2, itemChunk: 5 });
  assert.equal(r.totals.albums, 2, 'бланк без типів не потрапив');
  assert.equal(r.totals.orders, 5, '7 − сирота − замовлення бланка з помилкою');
  assert.equal(r.skipped.orders, 2);
  assert.equal(r.batches[0].kind, 'base');
  assert.equal(r.batches[0].data.albums[0].kindergarten, 'Сад 7');
  assert.equal(r.batches[0].data.albums[0].discountEnabled, true);
  assert.equal(r.batches[0].data.albums[1].discountEnabled, false);
  assert.ok(r.batches[0].data.prices);
  assert.ok(r.batches.filter((b) => b.kind === 'orders').every((b) => b.data.orders.length <= 2));
  assert.ok(r.batches.filter((b) => b.kind === 'items').every((b) => b.data.items.length <= 5));
  // без цін / виключений бланк
  const r2 = buildBatches(parsed, { albums: { [a1.id]: { include: false, kindergarten: 'Сад 7' }, [a2.id]: { include: true, kindergarten: 'Сад 1' } }, importPrices: false });
  assert.equal(r2.totals.albums, 1);
  assert.equal(r2.batches[0].data.prices, undefined);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('PRICE_KEYS збігаються з ключами цін бекенду', () => {
  const { createGas } = require('../dev/gas-emulator.js');
  const gas = createGas();
  gas.props.ADMIN_PASSWORD = 'admin';
  gas.run('setup');
  const r = gas.post({ action: 'getPrices' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(Object.keys(r.data.prices).sort(), [...PRICE_KEYS].sort());
});

test('наскрізно: пакети → importData у емульованому бекенді; повторний імпорт нічого не дублює', () => {
  const { createGas } = require('../dev/gas-emulator.js');
  const gas = createGas();
  gas.props.ADMIN_PASSWORD = 'admin';
  gas.run('setup');
  const token = gas.post({ action: 'login', password: 'admin' }).data.token;

  const all = loadAll();
  const [a1, a2] = all.albums.list;
  const parsed = { albums: all.albums.list, orders: all.orders.list, items: all.items.list, groupPhotos: all.groupPhotos.list, prices: all.prices.values };
  const choices = { albums: { [a1.id]: { include: true, kindergarten: 'Сад 7', discountEnabled: true }, [a2.id]: { include: true, kindergarten: 'Сад 7' } }, importPrices: true };
  const run = () => {
    let total = null;
    const { batches } = buildBatches(parsed, choices, { orderChunk: 2, itemChunk: 4 });
    for (const b of batches) {
      const r = gas.post({ action: 'importData', token, data: b.data });
      assert.ok(r.ok, JSON.stringify(r));
      total = mergeStats(total, r.data);
    }
    return total;
  };
  const s1 = run();
  assert.deepEqual([s1.albums.added, s1.orders.added, s1.items.added, s1.groupPhotos.added, s1.prices], [2, 5, 10, 4, 24]);
  assert.deepEqual(s1.warnings, []);

  const ov = gas.post({ action: 'adminOverview', token }).data.albums;
  assert.equal(ov.find((a) => a.id === a1.id).orderCount, 4);
  assert.equal(ov.find((a) => a.id === a2.id).orderCount, 1);

  const full = gas.post({ action: 'listOrdersFull', token, albumId: a1.id }).data.orders;
  const o1 = full.find((o) => o.clientName === 'Тестова Олена');
  assert.equal(o1.groupName, 'Група 1');
  assert.deepEqual(o1.items.map((i) => i.photoNumber), ['IMG_0101.JPG', 'IMG_0102.JPG', 'IMG_0103.JPG', 'IMG_0109.JPG', 'IMG_0110.JPG']);
  assert.equal(o1.items[0].photoSize, '15x21');
  assert.equal(o1.totalPrice, 720);

  const s2 = run();
  assert.deepEqual([s2.albums.added, s2.orders.added, s2.items.added, s2.groupPhotos.added], [0, 0, 0, 0], 'повторний імпорт — лише оновлення');
  assert.equal(s2.albums.updated, 2);
  assert.equal(gas.post({ action: 'listOrdersFull', token, albumId: a1.id }).data.orders.length, 4);
});
