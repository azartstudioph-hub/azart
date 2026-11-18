import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('вхід через Google: без пароля; чужий акаунт — відмова; ваш — панель; вихід', async () => {
  const page = await newPage(browser);
  await page.goto(`${app.url}/admin.html`);
  await page.waitForSelector('.adm-login');
  assert.equal(await page.locator('input[type=password]').count(), 0, 'поля пароля більше немає');
  await page.waitForSelector('.dev-gsi-btn');

  // чужий акаунт Google
  await page.evaluate(() => localStorage.setItem('dev_google_email', 'stranger@example.com'));
  await page.click('.dev-gsi-btn');
  await page.waitForSelector('.gsi-msg:not([hidden])');
  assert.match(await page.locator('.gsi-msg').textContent(), /не має доступу адміністратора/);
  assert.equal(await page.locator('.adm-card').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('azart_admin_token')), null);

  // акаунт власника
  await page.evaluate(() => localStorage.setItem('dev_google_email', 'azartstudioph@gmail.com'));
  await page.click('.dev-gsi-btn');
  await page.waitForSelector('.adm-card');
  assert.equal(await page.locator('.adm-card').count(), albumsApi().length);

  await page.reload();
  await page.waitForSelector('.adm-card');                 // токен збережено
  await page.click('button.adm-link:has-text("Вийти")');
  await page.waitForSelector('.adm-login');
  assert.deepEqual(page.errors.filter((e) => !/401|403|UNAUTH|FORBIDDEN/.test(e)), []);
});

test('головна: кнопка «Сторінка адміністратора» бачить лише адміністратор', async () => {
  const guest = await newPage(browser);
  await guest.goto(`${app.url}/index.html`);
  await guest.waitForSelector('.site-header');
  assert.equal(await guest.locator('#home-admin').isVisible(), false);
  assert.equal(await guest.locator('.admin-link:visible').count(), 0);

  const admin = await newPage(browser, { admin: tok() });
  await admin.goto(`${app.url}/index.html`);
  await admin.waitForSelector('#home-admin:not([hidden])');
  assert.equal(await admin.locator('.admin-link').getAttribute('href'), 'admin.html');
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

/** Папка свята на «комп'ютері»: { 'Група 1/Репортаж': [1, 40], … } → тимчасовий каталог із порожніми файлами. */
function makeEventFolder(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azart-scan-'));
  // кирилиця всередині — як у житті; корінь латиницею, бо Playwright не передає папку з кириличною назвою
  const ev = path.join(root, 'Autumn');
  for (const [dir, [from, to, ext = 'JPG']] of Object.entries(layout)) {
    fs.mkdirSync(path.join(ev, dir), { recursive: true });
    for (let n = from; n <= to; n++) fs.writeFileSync(path.join(ev, dir, `IMG_${String(n).padStart(4, '0')}.${ext}`), '');
  }
  fs.writeFileSync(path.join(ev, 'Thumbs.db'), '');
  return { root, ev };
}

test('діапазони з папки: типи за підпапками, групи з Drive, «Скасувати» повертає як було', async () => {
  const { root, ev } = makeEventFolder({
    'гр 1/Репортаж': [1, 30], 'гр 1/Фон': [31, 45],
    'Група 2/Репортаж': [100, 120], 'Група 2/Фон': [121, 140], 'Група 2/Портрет': [141, 142],
    'Молодша/Фон': [200, 205]
  });
  try {
    const page = await adminPage();
    await page.click('.adm-top-btn >> nth=1');
    await page.waitForSelector('.bm-card');
    const chk = (v) => page.locator(`input[name=type][value="${v}"]`);
    await chk('На фоні').uncheck();          // лишаємо тільки «Репортаж» — «Фон» має увімкнутися сам
    await page.fill('#bm-title', 'Свято з папки');
    await page.fill('#bm-drive', 'DEMO_GROUPS');

    // «Скасувати» після сканування повертає і діапазони, і типи
    await page.click('.bm-bar .btn-outline');
    await page.waitForSelector('.bm-scan');
    await page.setInputFiles('.bm-scan-input', ev);
    await page.waitForSelector('.bm-scan-status.is-ok');
    assert.equal(await chk('На фоні').isChecked(), true);
    await page.click('.bm-ranges-actions .btn-outline-danger');
    await page.waitForSelector('.bm-card');
    assert.equal(await chk('На фоні').isChecked(), false);
    assert.match(await page.locator('.bm-bar .btn-outline').textContent(), /Додати діапазон/);

    // тепер по-справжньому
    await page.click('.bm-bar .btn-outline');
    await page.waitForSelector('.bm-scan');
    assert.equal(await page.locator('.bm-scan-report').isHidden(), true, 'старий звіт не лишається');
    await page.setInputFiles('.bm-scan-input', ev);
    await page.waitForSelector('.bm-scan-status.is-ok');
    assert.match(await page.locator('.bm-scan-status').textContent(), /Готово: 92 фото → 5 діапазонів/);
    const report = await page.locator('.bm-scan-report').textContent();
    assert.match(report, /увімкнено тип «На фоні»/);
    assert.match(report, /Група 1: Репортаж 30, На фоні 15 → 2 діапазони/);
    assert.match(report, /«Портрет»: 2 фото пропущено/);
    assert.match(report, /Молодша.*такої групи немає на Google Диску/);
    const rows = page.locator('.bm-range');
    assert.equal(await rows.count(), 5);
    assert.equal(await rows.nth(0).locator('input').nth(2).inputValue(), 'Група 1');

    await page.click('.bm-ranges-actions .btn-outline');
    await page.waitForSelector('.bm-card');
    assert.match(await page.locator('.bm-bar .btn-outline').textContent(), /Діапазони \(5\)/);
    await page.fill('#bm-deadline', '2030-06-01');
    await page.click('.bm-bar .btn-primary');
    await page.waitForSelector('.adm-card-title:has-text("Свято з папки")');
    const saved = byTitle('Свято з папки');
    assert.deepEqual(saved.types, ['Репортаж', 'На фоні']);
    assert.deepEqual(saved.typeRanges.map((r) => [r.group, r.from, r.to, r.type]), [
      ['Група 1', 1, 30, 'Репортаж'], ['Група 1', 31, 45, 'На фоні'],
      ['Група 2', 100, 120, 'Репортаж'], ['Група 2', 121, 140, 'На фоні'],
      ['Молодша', 200, 205, 'На фоні']
    ]);
    assert.deepEqual(page.errors, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('діапазони з папки: перетягування з Провідника (папки читаються частинами)', async () => {
  const page = await adminPage();
  await page.click('.adm-top-btn >> nth=1');
  await page.waitForSelector('.bm-card');
  await page.fill('#bm-drive', 'DEMO_GROUPS');
  await page.click('.bm-bar .btn-outline');
  await page.waitForSelector('.bm-scan');
  // справжнє перетягування папки Playwright не вміє, тож імітуємо FileSystemEntry, як їх дає Chrome:
  // readEntries віддає вміст частинами по 100, а потім порожній масив
  const drop = (tree) => page.evaluate((tree) => {
    const entry = (name, node) => typeof node === 'number'
      ? { name, isFile: true, isDirectory: false }
      : {
          name, isFile: false, isDirectory: true,
          createReader() {
            const all = Object.entries(node).map(([k, v]) => entry(k, v));
            let i = 0;
            return { readEntries(ok) { setTimeout(() => { ok(all.slice(i, i + 100)); i += 100; }); } };
          }
        };
    const items = Object.entries(tree).map(([k, v]) => ({ kind: 'file', webkitGetAsEntry: () => entry(k, v) }));
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], items } });
    document.querySelector('.bm-scan').dispatchEvent(ev);
  }, tree);
  const pics = (from, to) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [`DSC_${from + i}.jpg`, 1]));
  await drop({ 'Свято': { 'Група 3': { 'Репортаж': pics(1, 250), 'Фон': pics(251, 260) } } });
  await page.waitForSelector('.bm-scan-status.is-ok');
  assert.match(await page.locator('.bm-scan-status').textContent(), /260 фото → 2 діапазони/);
  assert.equal(await page.locator('.bm-range').count(), 2);
  assert.equal(await page.locator('.bm-range >> nth=0').locator('input').nth(1).inputValue(), '250');

  // окремі файли замість папки — підказка
  await drop({ 'IMG_1.JPG': 1 });
  assert.match(await page.locator('.bm-scan-status.is-bad').textContent(), /папку, а не окремі файли/);
  // папка без підпапок типу
  await drop({ 'Свято': { 'Група 3': pics(1, 5) } });
  await page.waitForSelector('.bm-scan-status.is-bad:has-text("Не знайдено")');
  assert.equal(await page.locator('.bm-range').count(), 2, 'невдале сканування не чіпає діапазони');
  assert.deepEqual(page.errors, []);
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

test('програма обробки фото: кнопка, підказка коли не запущена, відкриття коли запущена', async () => {
  const page = await adminPage();
  const btn = page.locator('.pa-btn');
  assert.equal(await btn.count(), 1, 'кнопка є в рядку посилань');
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });

  // програма не запущена → підказка, індикатор гасне
  await page.context().route('http://127.0.0.1:8765/api/ping', (r) => r.abort());
  await btn.click();
  await page.waitForSelector('.pa-help');
  assert.match(await page.locator('.pa-dot').getAttribute('class'), /is-off/);
  assert.deepEqual(await page.evaluate(() => window.__opened), [], 'нічого не відкрилось');

  // вказуємо адресу, за якою програма відповідає
  await page.context().route('http://127.0.0.1:9100/api/ping', (r) => r.fulfill({
    status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ app: 'azart-photo', version: 1 })
  }));
  await page.fill('.pa-help input', 'http://127.0.0.1:9100');
  await page.click('.pa-help button:has-text("Перевірити")');
  await page.waitForSelector('.pa-help', { state: 'detached' });
  assert.deepEqual(await page.evaluate(() => window.__opened), ['http://127.0.0.1:9100/']);
  assert.equal(await page.evaluate(() => localStorage.getItem('azart_photo_app_url')), 'http://127.0.0.1:9100/');

  // далі кнопка відкриває одразу, без підказки
  await btn.click();
  await page.waitForFunction(() => window.__opened.length === 2);
  assert.equal(await page.locator('.pa-help').count(), 0);
  assert.match(await page.locator('.pa-dot').getAttribute('class'), /is-on/);

  assert.deepEqual(page.errors, []);
  await page.close();
});
