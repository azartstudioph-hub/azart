import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, launchBrowser, newPage } from './helpers.mjs';

let app, browser;
test.before(async () => { app = await startApp(); browser = await launchBrowser(); });
test.after(async () => { await browser.close(); await app.close(); });

test('сортувальник: із токеном підключається автоматично, показує бланки й групи', async () => {
  const page = await newPage(browser, { admin: app.seeded.token });
  const a1 = app.seeded.albums.a1.id;
  await page.goto(`${app.url}/sorter/index.html?albumId=${a1}`);
  await page.waitForFunction(() => document.querySelectorAll('#album option').length >= 3);
  assert.equal(await page.locator('#loginRow').isHidden(), true);
  assert.equal(await page.inputValue('#album'), a1, 'бланк вибрано з параметра albumId');
  await page.click('#loadOrders');
  await page.waitForSelector('#groups .g');
  assert.ok((await page.locator('#groups .g').count()) >= 2, 'групи з замовленнями');
  assert.match(await page.locator('#m2').textContent(), /Замовників: \d+/);
  assert.deepEqual(page.errors, []);
});

test('сортувальник: без токена просить пароль, неправильний пароль — помилка, правильний — підключає', async () => {
  const page = await newPage(browser);
  await page.goto(`${app.url}/sorter/index.html`);
  await page.waitForSelector('#loginRow:not([hidden])');
  await page.fill('#pw', 'wrong');
  await page.click('#connect');
  await page.waitForFunction(() => document.querySelector('#m1').classList.contains('err'));
  await page.fill('#pw', 'admin');
  await page.click('#connect');
  await page.waitForFunction(() => document.querySelectorAll('#album option').length >= 3);
  assert.equal(await page.locator('#loginRow').isHidden(), true);
  assert.deepEqual(page.errors.filter((e) => !/401|403|UNAUTHORIZED/.test(e)), []);
});
