import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, launchBrowser, newPage } from './helpers.mjs';

const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/wix', n);
const ALL = ['AlbumSettings.csv', 'Orders.csv', 'OrderItems.csv', 'PriceSettings.csv', 'GroupPhotoLibrary.csv'].map(fx);

// «Wix» для UrlFetchApp: група 2 недоступна (404), решта — маленький «JPEG»
const fetchStub = (url) => {
  if (/0002~mv2/.test(url)) return { getResponseCode: () => 404, getContent: () => [] };
  const bytes = new Array(32).fill(1); bytes[0] = -1; bytes[1] = -40; bytes[2] = -1;
  return { getResponseCode: () => 200, getContent: () => bytes };
};

let app, browser, token;
test.before(async () => {
  app = await startApp({ withSeed: false, gasOptions: { fetch: fetchStub } });
  token = app.gas.post({ action: 'login', password: 'admin' }).data.token;
  browser = await launchBrowser();
});
test.after(async () => { await browser.close(); await app.close(); });

const counts = () => {
  const ov = app.gas.post({ action: 'adminOverview', token }).data.albums;
  return { albums: ov.length, orders: ov.reduce((s, a) => s + a.orderCount, 0) };
};

test('без входу: пояснення й посилання на вхід, без вибору файлів', async () => {
  const page = await newPage(browser);
  await page.goto(`${app.url}/import.html`);
  await page.waitForSelector('.imp-need');
  assert.equal(await page.locator('.imp-file').count(), 0);
  assert.equal(await page.locator('.imp-need a').getAttribute('href'), 'admin.html');
  assert.deepEqual(page.errors, []);
});

test('файли, вибір садочка, перевірка, імпорт, перенесення фото, повторний імпорт', async () => {
  const page = await newPage(browser, { admin: token });
  await page.goto(`${app.url}/import.html`);
  await page.waitForSelector('.imp-file', { state: 'attached' });
  assert.equal(await page.locator('.imp-start').isDisabled(), true);
  assert.match(await page.locator('.imp-why').textContent(), /хоча б один файл/);

  // невідомий файл — повідомлення, нічого не додається
  await page.setInputFiles('.imp-file', { name: 'other.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') });
  await page.waitForSelector('.toast');
  assert.equal(await page.locator('.imp-slot.is-ok').count(), 0);

  await page.setInputFiles('.imp-file', ALL);
  await page.waitForFunction(() => document.querySelectorAll('.imp-slot.is-ok').length === 5);
  assert.equal(await page.locator('.imp-album').count(), 3);

  // третій бланк без типів — не можна імпортувати
  const bad = page.locator('.imp-album', { hasText: 'Без типів' });
  assert.equal(await bad.locator('input[type=checkbox]').first().isDisabled(), true);
  assert.match(await bad.textContent(), /не вказано типи фото/);
  // прапорець подарунка: з файлу true → увімкнено; порожнє → вимкнено з поясненням
  const first = page.locator('.imp-album', { hasText: 'Весняне свято' });
  assert.equal(await first.locator('.imp-gift input').isChecked(), true);
  assert.match(await first.textContent(), /частину діапазонів типів відкинуто/);
  const second = page.locator('.imp-album', { hasText: 'Портрети' });
  assert.equal(await second.locator('.imp-gift input').isChecked(), false);
  assert.match(await second.textContent(), /У Wix значення порожнє/);

  // поки садочок не обрано — імпорт заблоковано
  assert.equal(await page.locator('.imp-start').isDisabled(), true);
  assert.match(await page.locator('.imp-why').textContent(), /садочок/);

  // підсумки й перевірка зв'язків
  assert.equal(await page.locator('[data-sum=orders] .imp-sum-val').textContent(), '5');
  assert.equal(await page.locator('[data-sum=items] .imp-sum-val').textContent(), '10');
  assert.equal(await page.locator('[data-sum=prices] .imp-sum-val').textContent(), '24');
  assert.match(await page.locator('.imp-checks').textContent(), /Замовлень, бланка яких немає у файлі/);

  await page.selectOption('.imp-bulk-select', 'Сад 7');
  await page.click('.imp-bulk .btn');
  assert.equal(await page.locator('.imp-start').isDisabled(), false);

  // виключаємо бланк «Портрети» → його замовлення не рахуються
  await second.locator('.imp-inc input').uncheck();
  assert.equal(await page.locator('[data-sum=orders] .imp-sum-val').textContent(), '4');
  await second.locator('.imp-inc input').check();
  assert.equal(await page.locator('[data-sum=orders] .imp-sum-val').textContent(), '5');

  await page.click('.imp-start');
  await page.waitForSelector('.imp-done', { timeout: 20000 });
  const res = await page.locator('.imp-res').textContent();
  assert.match(res, /Бланки.*додано 2/);
  assert.match(res, /Замовлення.*додано 5/);
  assert.match(res, /Позиції замовлень.*додано 10/);
  assert.match(res, /Фото груп.*додано 4/);
  assert.match(res, /значень: 24/);
  // фото: дві перенесено, одна (404) — у списку невдалих
  assert.match(await page.locator('.imp-warns').first().textContent(), /Не вдалося перенести фото груп: 1/);
  assert.equal(await page.locator('button', { hasText: 'Продовжити перенесення фото' }).count(), 1);

  assert.deepEqual(counts(), { albums: 2, orders: 5 });
  const photos = app.gas.post({ action: 'listGroupPhotos', kindergarten: 'Сад 7' }).data.photos;
  assert.match(photos['група 1'], /drive\.google\.com\/thumbnail/);
  assert.match(photos['група 5'], /drive\.google\.com\/thumbnail/);
  assert.match(photos['група 2'], /wixstatic\.com/);
  const prices = app.gas.post({ action: 'getPrices' }).data.prices;
  assert.equal(prices.portret15X21Print, 80);
  assert.equal(prices.discountPercent2, 15);

  // адмінка бачить імпортований бланк із потрібним садочком і прапорцем подарунка
  const albums = app.gas.post({ action: 'adminOverview', token }).data.albums;
  const spring = albums.find((a) => a.title === 'Весняне свято');
  assert.equal(spring.kindergarten, 'Сад 7');
  assert.equal(spring.discountEnabled, true);
  assert.equal(albums.find((a) => a.title === 'Портрети').discountEnabled, false);

  // повторний імпорт: нічого не дублюється
  await page.reload();
  await page.setInputFiles('.imp-file', ALL);
  await page.waitForFunction(() => document.querySelectorAll('.imp-slot.is-ok').length === 5);
  await page.selectOption('.imp-bulk-select', 'Сад 7');
  await page.click('.imp-bulk .btn');
  await page.click('.imp-start');
  await page.waitForSelector('.imp-done', { timeout: 20000 });
  assert.match(await page.locator('.imp-res').textContent(), /Замовлення.*оновлено 5/);
  assert.deepEqual(counts(), { albums: 2, orders: 5 });
  assert.deepEqual(page.errors, []);
});

test('англійська та мобільна версія: немає сирих ключів і горизонтальної прокрутки', async () => {
  const page = await newPage(browser, { admin: token, lang: 'en', width: 390, height: 800, mobile: true });
  await page.goto(`${app.url}/import.html`);
  await page.waitForSelector('.imp-file', { state: 'attached' });
  await page.setInputFiles('.imp-file', ALL);
  await page.waitForFunction(() => document.querySelectorAll('.imp-slot.is-ok').length === 5);
  const text = await page.evaluate(() => document.body.innerText);
  assert.doesNotMatch(text, /\bimp\.[a-zA-Z.]+/);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `горизонтальне переповнення ${over}px`);
  assert.deepEqual(page.errors, []);
});
