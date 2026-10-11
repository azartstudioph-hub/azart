import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, launchBrowser, newPage } from './helpers.mjs';

let app, browser;
test.before(async () => { app = await startApp(); browser = await launchBrowser(); });
test.after(async () => { await browser.close(); await app.close(); });

const albumId = (k) => app.seeded.albums[k].id;
const full = (id, extra = {}) => {
  const r = app.gas.post({ action: 'listOrdersFull', token: app.seeded.token, albumId: id, ...extra });
  assert.ok(r.ok, JSON.stringify(r));
  return r.data.orders;
};

test('список замовлень: адмін бачить суму, друк і статуси; відвідувач — ні', async () => {
  const a1 = albumId('a1');
  const orders = full(a1);
  const sum = orders.reduce((s, o) => s + o.totalPrice, 0);

  const admin = await newPage(browser, { admin: app.seeded.token });
  await admin.goto(`${app.url}/album-orders.html?album=${a1}`);
  await admin.waitForSelector('.aord-card');
  assert.equal(await admin.locator('.aord-card').count(), orders.length);
  assert.equal(await admin.locator('.aord-chip b').first().textContent(), String(orders.length));
  const totalTxt = (await admin.locator('.aord-chip-total b').textContent()).replace(/\s/g, '');
  assert.equal(totalTxt, `${sum}грн`);
  assert.match(await admin.locator('.aord-print').getAttribute('href'), /^print\.html\?albumId=/);
  assert.ok(await admin.locator('.aord-card .badge').count() >= 1);
  assert.deepEqual(admin.errors, []);

  const guest = await newPage(browser);
  await guest.goto(`${app.url}/album-orders.html?album=${a1}`);
  await guest.waitForSelector('.aord-card');
  assert.equal(await guest.locator('.aord-chip-total').count(), 0);
  assert.equal(await guest.locator('.aord-print').count(), 0);
  assert.equal(await guest.locator('.aord-card .badge').count(), 0);
  assert.deepEqual(guest.errors, []);
});

test('список замовлень: фільтр по групі, ініціали, порожній стан, посилання', async () => {
  const a1 = albumId('a1');
  const page = await newPage(browser);
  await page.goto(`${app.url}/album-orders.html?album=${a1}&group=DEMO_G1&groupName=${encodeURIComponent('Група 1')}`);
  await page.waitForSelector('.aord-card');
  assert.equal(await page.locator('.aord-card').count(), 2);
  assert.match(await page.locator('.page-sub').textContent(), /Група 1/);
  assert.equal((await page.locator('.aord-ava').first().textContent()).length, 2);
  assert.match(await page.locator('.aord-open').first().getAttribute('href'), /^order\.html\?id=/);
  assert.match(await page.locator('.back-link').getAttribute('href'), /^groups\.html\?album=.+intent=view/);

  const none = await newPage(browser);
  await none.goto(`${app.url}/album-orders.html?album=${a1}&group=NOPE`);
  await none.waitForSelector('.aord-chip');
  assert.equal(await none.locator('.aord-card').count(), 0);
  assert.ok(await none.locator('.state').isVisible());
});

test('перегляд замовлення: таблиця, приховані телефон і коментар без ключа', async () => {
  const a1 = albumId('a1');
  const o = full(a1).find((x) => x.comment);
  const page = await newPage(browser);
  await page.goto(`${app.url}/order.html?id=${o.id}`);
  await page.waitForSelector('.ord-grid');
  assert.equal(await page.locator('.ord-table tbody tr').count(), o.items.length);
  assert.equal(await page.locator('.ord-table th').count(), 6);
  const phone = await page.locator('.ord-facts .ord-val').nth(1).textContent();
  assert.ok(phone.includes('•') && phone !== o.phone, phone);
  assert.ok(!(await page.locator('.ord-comment').textContent()).includes(o.comment));
  assert.equal(await page.locator('.ord-status-select').count(), 0);
  assert.equal(await page.locator('.ord-bar').count(), 0);
  assert.ok(await page.locator('.ord-privacy').isVisible());
  assert.deepEqual(page.errors, []);
});

test('перегляд замовлення: власник з ключем бачить усе, але не може змінити статус', async () => {
  const a1 = albumId('a1');
  const res = app.gas.post({
    action: 'createOrder', requestId: 'own' + Date.now().toString(36) + 'abcdef',
    order: { albumId: a1, groupFolderId: 'DEMO_G2', groupName: 'Група 2', clientName: 'Тест Власник', phone: '0501234567', comment: 'мій коментар',
      items: [{ photoNumber: 'IMG_5701.JPG', photoType: 'Репортаж', photoSize: '15x21', photoFormat: 'Друковані', count: 1 }] }
  });
  assert.ok(res.ok, JSON.stringify(res));
  const { id, secret } = res.data;
  const page = await newPage(browser);
  await page.goto(`${app.url}/order.html?id=${id}&key=${secret}`);
  await page.waitForSelector('.ord-grid');
  assert.equal(await page.locator('.ord-facts .ord-val').nth(1).textContent(), '0501234567');
  assert.equal(await page.locator('.ord-comment').textContent(), 'мій коментар');
  assert.equal(await page.locator('.ord-privacy').count(), 0);
  assert.equal(await page.locator('.ord-status-select').count(), 0);
  // неправильний ключ → як без ключа
  const bad = await newPage(browser);
  await bad.goto(`${app.url}/order.html?id=${id}&key=wrong`);
  await bad.waitForSelector('.ord-grid');
  assert.ok((await bad.locator('.ord-facts .ord-val').nth(1).textContent()).includes('•'));
});

test('адмін: зміна статусу, стрічка номерів, видалення замовлення', async () => {
  const a1 = albumId('a1');
  const o = full(a1).find((x) => x.items.length === 2);
  const page = await newPage(browser, { admin: app.seeded.token });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.goto(`${app.url}/order.html?id=${o.id}`);
  await page.waitForSelector('.ord-grid');
  assert.equal(await page.locator('.ord-facts .ord-val').nth(1).textContent(), o.phone);

  await page.selectOption('.ord-status-select', 'В роботі');
  await page.click('.ord-status-row .btn');
  await page.waitForSelector('.ord-saved:not([hidden])');
  assert.equal(full(a1).find((x) => x.id === o.id).status, 'В роботі');
  await page.waitForSelector('.ord-saved', { state: 'hidden', timeout: 4000 });

  assert.equal(await page.locator('.ord-search-out').isVisible(), false);
  await page.click('.ord-search-btn');
  const expected = o.items.map((i) => i.photoNumber).join(' OR ');
  assert.equal((await page.locator('.ord-search-out').textContent()).trim(), expected);

  await page.click('.ord-delete');
  await page.click('.modal .btn-danger');
  await page.waitForURL(/album-orders\.html/);
  assert.ok(!full(a1).some((x) => x.id === o.id));
  assert.deepEqual(page.errors, []);
});

test('повна фотосесія: колонка «Ціна» прихована, є позначка', async () => {
  const o = full(albumId('a3')).find((x) => x.isFullSession);
  const page = await newPage(browser, { admin: app.seeded.token });
  await page.goto(`${app.url}/order.html?id=${o.id}`);
  await page.waitForSelector('.ord-grid');
  assert.equal(await page.locator('.ord-table th').count(), 5);
  assert.ok(await page.locator('.ord-session').isVisible());
});

test('помилки: немає id, невідоме замовлення; англійська без сирих ключів', async () => {
  const p1 = await newPage(browser);
  await p1.goto(`${app.url}/order.html`);
  await p1.waitForSelector('.state-error');
  const p2 = await newPage(browser);
  await p2.goto(`${app.url}/order.html?id=nope`);
  await p2.waitForSelector('.state-error');

  const en = await newPage(browser, { lang: 'en', admin: app.seeded.token });
  const o = full(albumId('a1'))[0];
  await en.goto(`${app.url}/order.html?id=${o.id}`);
  await en.waitForSelector('.ord-grid');
  const txt = await en.locator('body').innerText();
  assert.ok(!/\b(order|aorders|common|form)\.[a-z]/i.test(txt.replace(/\.(JPG|jpg)/g, '')), txt.slice(0, 300));
  assert.match(txt, /Your order/);
  await en.goto(`${app.url}/album-orders.html?album=${albumId('a1')}`);
  await en.waitForSelector('.aord-card');
  assert.match(await en.locator('body').innerText(), /Client orders/);
});

test('мобільний вигляд без горизонтального переповнення', async () => {
  const o = full(albumId('a1'))[0];
  for (const url of [`order.html?id=${o.id}`, `album-orders.html?album=${albumId('a1')}`]) {
    const page = await newPage(browser, { width: 360, height: 740, mobile: true, admin: app.seeded.token });
    await page.goto(`${app.url}/${url}`);
    await page.waitForSelector('.ord-grid, .aord-card');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `${url}: overflow ${over}`);
  }
});
