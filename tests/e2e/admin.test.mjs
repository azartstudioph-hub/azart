import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, launchBrowser, newPage } from './helpers.mjs';

let app, browser;
test.before(async () => { app = await startApp(); browser = await launchBrowser(); });
test.after(async () => { await browser.close(); await app.close(); });

const tok = () => app.seeded.token;
const post = (body) => app.gas.post({ token: tok(), ...body });
const albumsApi = () => post({ action: 'adminOverview' }).data.albums;
const byTitle = (t) => albumsApi().find((a) => a.title === t);

async function adminPage(opts = {}) {
  const page = await newPage(browser, { admin: tok(), ...opts });
  await page.goto(`${app.url}/admin.html`);
  await page.waitForSelector('.adm-card');
  return page;
}
const card = (page, title) => page.locator('.adm-card', { has: page.locator('.adm-card-title', { hasText: title }) });

test('вхід: неправильний пароль → помилка; правильний → панель; вихід', async () => {
  const page = await newPage(browser);
  await page.goto(`${app.url}/admin.html`);
  await page.waitForSelector('.adm-login');
  await page.fill('#adm-pass', 'wrong');
  await page.click('.adm-login button[type=submit]');
  await page.waitForSelector('#adm-err:not([hidden])');
  assert.match(await page.locator('#adm-err').textContent(), /Невірний пароль/);
  assert.equal(await page.locator('.adm-card').count(), 0);

  await page.fill('#adm-pass', 'admin');
  await page.click('.adm-login button[type=submit]');
  await page.waitForSelector('.adm-card');
  assert.equal(await page.locator('.adm-card').count(), albumsApi().length);

  await page.reload();
  await page.waitForSelector('.adm-card');                 // токен збережено
  await page.click('button.adm-link:has-text("Вийти")');                  // «Вийти»
  await page.waitForSelector('.adm-login');
  assert.deepEqual(page.errors.filter((e) => !/401|UNAUTH/.test(e)), []);
});

test('застарілий / підроблений токен веде на сторінку входу', async () => {
  const page = await newPage(browser, { admin: 'garbage.token' });
  await page.goto(`${app.url}/admin.html`);
  await page.waitForSelector('.adm-login');
  assert.equal(await page.evaluate(() => localStorage.getItem('azart_admin_token')), null);
});

test('панель: підсумки, лічильники, посилання «Відкрити» (з групами / без)', async () => {
  const page = await adminPage();
  const albums = albumsApi();
  const orders = albums.reduce((s, a) => s + a.orderCount, 0);
  const txt = await page.locator('.adm-summary').textContent();
  assert.ok(txt.includes(`${albums.length} бланки`) || txt.includes(`${albums.length} бланків`), txt);
  assert.ok(txt.includes(String(orders)), txt);
  assert.equal((await card(page, 'Новорічне свято').locator('.adm-count').textContent()).trim(), '3');
  assert.match(await card(page, 'Новорічне свято').locator('.adm-card-title').textContent(), /\(Сад 7\)/);

  // бланк із групами → вибір групи (режим адміністратора)
  await card(page, 'Новорічне свято').locator('.adm-open').click();
  await page.waitForURL(/groups\.html\?album=.+intent=admin/);
  // бланк без груп → одразу список замовлень
  await page.goto(`${app.url}/admin.html`);
  await page.waitForSelector('.adm-card');
  await card(page, 'Випускний').locator('.adm-open').click();
  await page.waitForURL(/album-orders\.html\?album=/);
});

test('створення бланка: перевірки, «Портрет» виключає інші типи, діапазони, дублікат', async () => {
  const page = await adminPage();
  await page.click('.adm-top-btn >> nth=1');
  await page.waitForSelector('.bm-card');

  // порожня назва
  await page.click('.bm-bar .btn-primary');
  assert.match(await page.locator('.bm-err:not([hidden])').first().textContent(), /назву/);

  // взаємовиключність типів
  const chk = (v) => page.locator(`input[name=type][value="${v}"]`);
  await chk('Портрет').check();
  assert.equal(await chk('Репортаж').isChecked(), false);
  assert.equal(await chk('На фоні').isChecked(), false);
  await chk('На фоні').check();
  assert.equal(await chk('Портрет').isChecked(), false);
  await chk('Репортаж').check();

  // без Drive
  await page.fill('#bm-title', '  Весняне   свято ');
  await page.click('.bm-bar .btn-primary');
  assert.match(await page.locator('.bm-err:not([hidden])').first().textContent(), /Google Drive/);

  // перевірка папки через mock Drive
  await page.fill('#bm-drive', 'https://drive.google.com/drive/folders/DEMO_FLAT?usp=sharing');
  await page.click('.bm-drive-row .btn');
  await page.waitForSelector('.bm-drive-status.is-ok');
  assert.match(await page.locator('.bm-drive-status').textContent(), /Груп: 0, фото в основній папці: [1-9]/);

  // діапазони: перетин → помилка, виправлення → ок
  await page.click('.bm-bar .btn-outline');
  await page.waitForSelector('.bm-range');
  await page.click('.bm-ranges-top .btn-outline >> nth=0'); // «Додати діапазон +»
  const rows = page.locator('.bm-range');
  assert.equal(await rows.count(), 2);
  const fill = async (i, from, to, type) => {
    const r = rows.nth(i);
    await r.locator('input').nth(0).fill(String(from));
    await r.locator('input').nth(1).fill(String(to));
    await r.locator('select').selectOption(type);
  };
  await fill(0, 1, 100, 'На фоні');
  await fill(1, 100, 200, 'Репортаж');
  await page.click('.bm-ranges-actions .btn-outline');
  assert.match(await page.locator('.bm-screen:not([hidden]) .bm-err:not([hidden])').textContent(), /перетинаються у головній папці: 1-100 і 100-200/);
  await fill(1, 101, 200, 'Репортаж');
  await page.click('.bm-ranges-actions .btn-outline');
  await page.waitForSelector('.bm-card');
  assert.match(await page.locator('.bm-bar .btn-outline').textContent(), /Діапазони \(2\)/);

  await page.fill('#bm-deadline', '2030-05-20');
  await page.click('.bm-bar .btn-primary');
  await page.waitForSelector('.adm-card-title:has-text("Весняне свято")');

  const saved = byTitle('Весняне свято');
  assert.ok(saved);
  assert.deepEqual(saved.types, ['Репортаж', 'На фоні']);
  assert.equal(saved.driveFolderId, 'DEMO_FLAT');
  assert.equal(saved.deadline, '2030-05-20');
  assert.equal(saved.kindergarten, 'Сад 1');
  assert.equal(saved.discountEnabled, true);
  assert.deepEqual(saved.typeRanges.map((r) => [r.from, r.to, r.type]), [[1, 100, 'На фоні'], [101, 200, 'Репортаж']]);
  // нова картка першою (найновіші зверху)
  assert.match(await page.locator('.adm-card-title').first().textContent(), /Весняне свято/);

  // дублікат (регістр і пробіли не мають значення)
  await page.click('.adm-top-btn >> nth=1');
  await page.waitForSelector('.bm-card');
  await page.fill('#bm-title', 'ВЕСНЯНЕ  СВЯТО');
  await page.fill('#bm-drive', 'DEMO_FLAT');
  await page.click('.bm-bar .btn-primary');
  await page.waitForSelector('.bm-err:not([hidden])');
  assert.match(await page.locator('.bm-err:not([hidden])').first().textContent(), /вже існує/);
  assert.equal(albumsApi().filter((a) => /весняне/i.test(a.title)).length, 1);
  assert.deepEqual(page.errors.filter((e) => !/409|DUPLICATE/.test(e)), []);
});

test('редагування бланка: поля заповнені, зміни зберігаються', async () => {
  const page = await adminPage();
  const before = byTitle('Новорічне свято');
  await card(page, 'Новорічне свято').locator('.adm-ib >> nth=0').click();
  await page.waitForSelector('.bm-card');
  assert.equal(await page.inputValue('#bm-title'), 'Новорічне свято');
  assert.equal(await page.inputValue('#bm-drive'), before.driveFolderId);
  assert.equal(await page.inputValue('#bm-deadline'), before.deadline);
  assert.equal(await page.locator('input[name=kindergarten][value="Сад 7"]').isChecked(), true);
  assert.equal(await page.locator('#bm-discount').isChecked(), before.discountEnabled);
  assert.match(await page.locator('.bm-bar .btn-outline').textContent(), new RegExp(`Діапазони \\(${before.typeRanges.length}\\)`));
  assert.match(await page.locator('.bm-bar .btn-primary').textContent(), /Зберегти зміни/);

  await page.fill('#bm-title', 'Новорічне свято 2');
  await page.locator('input[name=size][value="30x45"]').uncheck();
  await page.locator('#bm-discount').uncheck();
  await page.click('.bm-bar .btn-primary');
  await page.waitForSelector('.adm-card-title:has-text("Новорічне свято 2")');
  const after = byTitle('Новорічне свято 2');
  assert.equal(after.id, before.id);
  assert.deepEqual(after.sizes, ['10x15', '15x21', '20x30']);
  assert.equal(after.discountEnabled, false);
  assert.equal(after.typeRanges.length, before.typeRanges.length);
  assert.equal(after.orderCount, before.orderCount);
  // повернути назву
  post({ action: 'saveAlbum', album: { id: before.id, title: before.title, kindergarten: before.kindergarten, deadline: before.deadline, driveFolderId: before.driveFolderId, types: before.types, sizes: before.sizes, formats: before.formats, typeRanges: before.typeRanges, discountEnabled: before.discountEnabled } });
});

test('видалення бланка: підтвердження, замовлення зникають', async () => {
  const created = post({ action: 'saveAlbum', album: { title: 'Для видалення', kindergarten: 'Сад 1', types: ['Репортаж'], sizes: ['10x15'], formats: ['Друковані'], deadline: '2031-01-01', driveFolderId: 'DEMO_FLAT', typeRanges: [], discountEnabled: false } }).data.album;
  const o = app.gas.post({ action: 'createOrder', requestId: 'del' + Date.now().toString(36) + 'xyzxyz', order: { albumId: created.id, clientName: 'Тест Видалення', phone: '0501112233', groupFolderId: '', groupName: '', items: [{ photoNumber: '1.JPG', photoType: 'Репортаж', photoSize: '10x15', photoFormat: 'Друковані', count: 1 }] } });
  assert.ok(o.ok, JSON.stringify(o));

  const page = await adminPage();
  assert.equal((await card(page, 'Для видалення').locator('.adm-count').textContent()).trim(), '1');
  await card(page, 'Для видалення').locator('.adm-ib-del').click();
  await page.waitForSelector('.modal');
  assert.match(await page.locator('.modal-text').textContent(), /Видалити бланк "Для видалення"\? Будуть також видалені всі замовлення\./);
  await page.click('.modal .btn-ghost');                     // «Скасувати»
  await page.waitForSelector('.modal', { state: 'detached' });
  assert.ok(byTitle('Для видалення'));

  await card(page, 'Для видалення').locator('.adm-ib-del').click();
  await page.click('.modal .btn-danger');
  await page.waitForSelector('.adm-card-title:has-text("Для видалення")', { state: 'detached' });
  assert.equal(byTitle('Для видалення'), undefined);
  assert.equal(post({ action: 'listOrdersFull', albumId: created.id }).data.orders.length, 0);
});

test('ціни: редактор зберігає, публічна сторінка показує нові значення', async () => {
  const page = await adminPage();
  await page.click('.adm-top-btn >> nth=0');
  await page.waitForSelector('.pe-table');
  assert.equal(await page.inputValue('#pe-backgroundDigital'), '60');
  await page.fill('#pe-backgroundDigital', '65');
  await page.fill('#pe-portretSessionPrice', '1200');
  await page.click('.pe-save');
  await page.waitForSelector('.pe-msg:has-text("Ціни збережено")');
  const p = app.gas.post({ action: 'getPrices' }).data.prices;
  assert.equal(p.backgroundDigital, 65);
  assert.equal(p.portretSessionPrice, 1200);
  assert.equal(p.reportage10X15Print, 40);                  // решта не змінилась

  const pub = await newPage(browser);
  await pub.goto(`${app.url}/prices.html`);
  await pub.waitForSelector('.ptable');
  assert.match(await pub.locator('.ptable').textContent(), /65\s*грн/);

  // відкат
  post({ action: 'savePrices', prices: { backgroundDigital: 60, portretSessionPrice: 1000 } });
});

test('параметри сайту: скорочення імен у публічному списку', async () => {
  const page = await adminPage();
  await page.click('button.adm-link:has-text("Параметри сайту")');
  await page.waitForSelector('.set');
  await page.locator('input[name=publicNameMode][value=short]').check();
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.modal', { state: 'detached' });
  assert.equal(post({ action: 'getSettings' }).data.settings.publicNameMode, 'short');

  const guest = await newPage(browser);
  await guest.goto(`${app.url}/album-orders.html?album=${app.seeded.albums.a1.id}`);
  await guest.waitForSelector('.aord-card');
  const names = await guest.locator('.aord-name').allTextContents();
  assert.ok(names.every((n) => /^\S+ \S\.$/.test(n.trim())), names.join('|'));

  post({ action: 'saveSettings', settings: { publicNameMode: 'full' } });
});

test('адмін-панель: англійська без сирих ключів, мобільний без переповнення', async () => {
  const en = await adminPage({ lang: 'en' });
  const txt = await en.locator('body').innerText();
  assert.match(txt, /Your forms/);
  assert.ok(!/\b(admin|blank|pe|set|ranges)\.[a-zA-Z]+/.test(txt), txt.slice(0, 400));
  await en.click('.adm-top-btn >> nth=1');
  await en.waitForSelector('.bm-card');
  assert.match(await en.locator('.modal').innerText(), /Photo type \*/);

  const m = await adminPage({ width: 360, height: 740, mobile: true });
  assert.ok((await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await m.click('.adm-top-btn >> nth=1');
  await m.waitForSelector('.bm-card');
  assert.ok((await m.evaluate(() => document.querySelector('.modal').scrollWidth - document.querySelector('.modal').clientWidth)) <= 0);
});

test('друк: лише для адміністратора; від старих до нових; сума; коментарі вмикаються й вимикаються', async () => {
  const a1 = app.seeded.albums.a1.id;
  const guest = await newPage(browser);
  await guest.goto(`${app.url}/print.html?albumId=${a1}`);
  await guest.waitForSelector('.note-warn');
  assert.equal(await guest.locator('.prt-table').count(), 0);

  const orders = post({ action: 'listOrdersFull', albumId: a1 }).data.orders;
  const page = await newPage(browser, { admin: tok() });
  await page.goto(`${app.url}/print.html?albumId=${a1}`);
  await page.waitForSelector('.prt-table');
  const names = await page.locator('.prt-name').allTextContents();
  const expected = [...orders].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((o) => o.clientName);
  assert.deepEqual(names, expected);
  const sum = orders.reduce((s, o) => s + o.totalPrice, 0);
  assert.match((await page.locator('.prt-total span').textContent()).replace(/\s/g, ''), new RegExp(`^${sum}грн$`));
  const itemRows = orders.reduce((s, o) => s + o.items.length, 0);
  assert.equal(await page.locator('.prt-table tbody tr:not(.prt-comment-row)').count(), itemRows);
  assert.equal(await page.locator('.prt-comment-row').count(), orders.filter((o) => o.comment).length);
  await page.uncheck('#prt-comments');
  assert.equal(await page.locator('.prt-comment-row').count(), 0);

  // фільтр по групі
  await page.goto(`${app.url}/print.html?albumId=${a1}&groupFolderId=DEMO_G2&groupName=${encodeURIComponent('Група 2')}`);
  await page.waitForSelector('.prt-table');
  assert.equal(await page.locator('.prt-name').count(), orders.filter((o) => o.groupFolderId === 'DEMO_G2').length);
  assert.match(await page.locator('.prt-title').textContent(), /Група 2/);

  // у режимі друку шапка, підвал і кнопка приховані
  await page.emulateMedia({ media: 'print' });
  for (const sel of ['.site-header', '.site-footer', '.prt-toolbar']) assert.equal(await page.locator(sel).isVisible(), false, sel);
  assert.equal(await page.locator('.prt-table').isVisible(), true);
  assert.deepEqual(page.errors, []);
});
