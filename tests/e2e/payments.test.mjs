// Оплата карткою (через імітацію LiqPay з dev-сервера), готівка, позначка «Оплачено», друк, сторінки умов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, launchBrowser, newPage } from './helpers.mjs';

let app, browser;
test.before(async () => { app = await startApp({ payments: 'test' }); browser = await launchBrowser(); });
test.after(async () => { await browser.close(); await app.close(); });

const tok = () => app.seeded.token;
const a3 = () => app.seeded.albums.a3.id;
const fullOrders = (albumId) => app.gas.post({ action: 'listOrdersFull', token: tok(), albumId }).data.orders;

/** Оформлює портретне замовлення через галерею й форму; повертає сторінку з вікном «Замовлення оформлене». */
async function placeOrder(name) {
  const page = await newPage(browser);
  await page.goto(`${app.url}/gallery.html?album=${a3()}&group=DEMO_PG1&groupName=${encodeURIComponent('Група 1')}`);
  await page.waitForSelector('.gtile');
  await page.locator('.gsel-btn').nth(2).click();
  await page.click('#confirm');
  await page.waitForSelector('.rrow');
  await page.locator('.rrow').first().locator('select[data-field="format"]').selectOption('Електронні');
  await page.fill('#customerName', name);
  await page.fill('#customerPhone', '0501234567');
  await page.click('.fsubmit');
  await page.waitForSelector('.osuccess .paychoice');
  return page;
}

function createOrderApi(name) {
  const r = app.gas.post({ action: 'createOrder', requestId: 'e2epay' + Math.random().toString(36).slice(2, 12), order: {
    albumId: a3(), groupFolderId: 'DEMO_PG1', groupName: 'Група 1', clientName: name, phone: '0507654321',
    items: [{ photoNumber: '7105.JPG', photoType: 'Портрет', photoSize: '15x21', photoFormat: 'Друковані', count: 1 }]
  } });
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

test('після оформлення: «карткою зараз» → сторінка оплати → назад «Оплачено»', async () => {
  const page = await placeOrder('Картка Тестова');
  assert.match(await page.locator('.paychoice-test').textContent(), /Тестовий режим/);
  await page.click('.paychoice-card');
  await page.waitForURL(/__liqpay\/api\/3\/checkout/);
  assert.match(await page.locator('.sum').textContent(), /UAH/);
  await page.click('button[value=pay]');
  await page.waitForURL(/order\.html\?.*pay=1/);
  await page.waitForSelector('.ord-pay-result.note-ok');
  assert.match(await page.locator('.ord-pay .paid-badge').textContent(), /Оплачено/);
  assert.equal(await page.locator('.ord-pay-btn').count(), 0);
  const o = fullOrders(a3()).find((x) => x.clientName === 'Картка Тестова');
  assert.equal(o.paid, true);
  assert.deepEqual(page.errors, []);
});

test('«готівкою пізніше»: сторінка оплати не відкривається, позначки немає; оплатити можна пізніше', async () => {
  const page = await placeOrder('Готівка Тестова');
  await page.click('.paychoice-cash');
  await page.waitForSelector('.osuccess-cash');
  assert.equal(await page.locator('.paychoice').count(), 0);
  assert.ok(!/liqpay/.test(page.url()));
  await page.click('.osuccess .btn-primary');
  await page.waitForURL(/order\.html/);
  await page.waitForSelector('.ord-card');
  assert.equal(await page.locator('.paid-badge').count(), 0);
  assert.equal(await page.locator('.ord-pay-btn').count(), 1, 'передумали — можна оплатити карткою');
  const o = app.gas.post({ action: 'getOrder', token: tok(), id: new URL(page.url()).searchParams.get('id') }).data.order;
  assert.equal(o.payMethod, 'cash');
  assert.equal(o.paid, false);
  assert.deepEqual(page.errors, []);
});

test('повідомлення від LiqPay загубилось — сайт сам перевіряє статус; помилка оплати — зрозуміле повідомлення', async () => {
  const lost = createOrderApi('Загублене Повідомлення');
  let page = await newPage(browser);
  await page.goto(`${app.url}/order.html?id=${lost.id}&key=${lost.secret}`);
  await page.click('.ord-pay-btn');
  await page.waitForURL(/__liqpay/);
  await page.click('button[value=silent]');
  await page.waitForSelector('.ord-pay-result.note-ok', { timeout: 15000 });
  assert.equal(await page.locator('.ord-pay .paid-badge').count(), 1);

  const failed = createOrderApi('Невдала Оплата');
  page = await newPage(browser);
  await page.goto(`${app.url}/order.html?id=${failed.id}&key=${failed.secret}`);
  await page.click('.ord-pay-btn');
  await page.waitForURL(/__liqpay/);
  await page.click('button[value=fail]');
  await page.waitForSelector('.ord-pay-result.note-warn', { timeout: 15000 });
  assert.match(await page.locator('.ord-pay-result').textContent(), /не пройшла/);
  assert.equal(await page.locator('.ord-pay-btn').count(), 1, 'можна спробувати ще раз');
  assert.deepEqual(page.errors, []);
});

test('адмін: «Оплачено» у списку замовлень і в таблиці друку; заголовок друку — садочок, свято, група', async () => {
  const paid = createOrderApi('Друк Оплачений');
  const cash = createOrderApi('Друк Готівка');
  const page0 = await newPage(browser);
  await page0.goto(`${app.url}/order.html?id=${paid.id}&key=${paid.secret}`);
  await page0.click('.ord-pay-btn');
  await page0.waitForURL(/__liqpay/);
  await page0.click('button[value=pay]');
  await page0.waitForSelector('.ord-pay-result.note-ok');

  const page = await newPage(browser, { admin: tok() });
  await page.goto(`${app.url}/album-orders.html?album=${a3()}&group=DEMO_PG1&groupName=${encodeURIComponent('Група 1')}`);
  await page.waitForSelector('.aord-card');
  const cardOf = (n) => page.locator('.aord-card', { has: page.locator('.aord-name', { hasText: n }) });
  assert.equal(await cardOf('Друк Оплачений').locator('.paid-badge').count(), 1);
  assert.equal(await cardOf('Друк Готівка').locator('.paid-badge').count(), 0);

  await page.goto(`${app.url}/print.html?albumId=${a3()}&groupFolderId=DEMO_PG1&groupName=${encodeURIComponent('Група 1')}`);
  await page.waitForSelector('.prt-table');
  assert.equal(await page.locator('.prt-kg').textContent(), 'Садочок 7');
  assert.equal(await page.locator('.prt-title').textContent(), 'Садочок 7 · Портрети · Група 1');
  const sumOf = (n) => page.locator('tr', { has: page.locator('.prt-name', { hasText: n }) }).locator('.prt-sum');
  assert.match(await sumOf('Друк Оплачений').textContent(), /Оплачено/);
  assert.doesNotMatch(await sumOf('Друк Готівка').textContent(), /Оплачено/);
  assert.deepEqual(page.errors, []);

  // відвідувач без ключа не бачить, хто оплатив
  const guest = await newPage(browser);
  await guest.goto(`${app.url}/album-orders.html?album=${a3()}&group=DEMO_PG1`);
  await guest.waitForSelector('.aord-card');
  assert.equal(await guest.locator('.paid-badge').count(), 0);
  void cash;
});

test('сторінки умов: посилання у футері, дані ФОП із параметрів сайту, підказка адміністратору', async () => {
  const admin = await newPage(browser, { admin: tok() });
  await admin.goto(`${app.url}/oferta.html`);
  await admin.waitForSelector('.legal-sec');
  assert.equal(await admin.locator('.legal-admin').count(), 1, 'адміністратору — що не заповнено');
  assert.ok(await admin.locator('.legal-missing').count() > 0);
  assert.equal(await admin.locator('.footer-legal a').count(), 5);

  const r = app.gas.post({ action: 'saveSettings', token: tok(), settings: { fopName: 'ФОП Тестовий Тест Тестович', fopTaxId: '1234567890', fopAddress: 'м. Тест, вул. Тестова, 1', fopEmail: 'test@example.com', deliveryDays: '10' } });
  assert.ok(r.ok);
  for (const p of ['oferta', 'payment', 'returns', 'privacy', 'contacts']) {
    const page = await newPage(browser);
    await page.goto(`${app.url}/${p}.html`);
    await page.waitForSelector('.legal-sec');
    assert.equal(await page.locator('.legal-missing').count(), 0, p);
    assert.equal(await page.locator('.legal-nav a.is-active').count(), 1);
    assert.deepEqual(page.errors, [], p);
  }
  const page = await newPage(browser);
  await page.goto(`${app.url}/oferta.html`);
  await page.waitForSelector('.legal-details');
  const text = await page.locator('.legal-body').textContent();
  assert.match(text, /ФОП Тестовий Тест Тестович/);
  assert.match(text, /1234567890/);
  assert.match(text, /протягом 10 робочих днів/);
});

test('параметри сайту: режим оплати й дані ФОП зберігаються з адмінки', async () => {
  const page = await newPage(browser, { admin: tok() });
  await page.goto(`${app.url}/admin.html`);
  await page.waitForSelector('.adm-card');
  await page.getByText('Параметри сайту').click();
  await page.waitForSelector('input[name=cardPayments]');
  assert.equal(await page.locator('input[name=cardPayments][value=test]').isChecked(), true);
  await page.fill('#set-fopEmail', 'не-пошта');
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').last().textContent(), /електронна адреса/);
  await page.fill('#set-fopEmail', 'studio@example.com');
  await page.check('input[name=cardPayments][value=off]');
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.modal', { state: 'detached' });
  const s = app.gas.post({ action: 'getSettings', token: tok() }).data.settings;
  assert.equal(s.cardPayments, 'off');
  assert.equal(s.fopEmail, 'studio@example.com');
  // вимкнули — після оформлення вибору оплати немає
  assert.equal(app.gas.post({ action: 'siteInfo' }).data.payments.card, false);
  app.gas.post({ action: 'saveSettings', token: tok(), settings: { cardPayments: 'test' } });
});
