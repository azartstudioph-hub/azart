import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, launchBrowser, newPage } from './helpers.mjs';

let app, browser;
test.before(async () => { app = await startApp(); browser = await launchBrowser(); });
test.after(async () => { await browser.close(); await app.close(); });

const albumId = (k) => app.seeded.albums[k].id;
const adminOrders = (id) => {
  const r = app.gas.post({ action: 'listOrdersFull', token: app.seeded.token, albumId: id });
  assert.ok(r.ok, JSON.stringify(r));
  return r.data.orders;
};

test('галерея → форма → відправка: ціни, подарунок, збереження в таблиці', async () => {
  const page = await newPage(browser);
  const a1 = albumId('a1');
  await page.goto(`${app.url}/gallery.html?album=${a1}&group=DEMO_G1&groupName=${encodeURIComponent('Група 1')}`);
  await page.waitForSelector('.gtile');
  const btns = page.locator('.gsel-btn');
  await btns.nth(0).click();
  await btns.nth(1).click();
  await btns.nth(2).click();
  assert.equal(await page.locator('#n').textContent(), '3');
  await page.click('#confirm');
  await page.waitForURL(/form\.html/);
  await page.waitForSelector('.rrow');

  // три картки; тип визначено автоматично за діапазоном і заблоковано
  assert.equal(await page.locator('.rrow').count(), 3);
  const typeSel = page.locator('.rrow').first().locator('select[data-field="type"]');
  assert.equal(await typeSel.inputValue(), 'На фоні');
  assert.ok(await typeSel.isDisabled());

  // «Однаковий формат» → перший вибір застосовується до всіх і галочка скидається
  await page.check('#sameFormatToggle');
  await page.locator('.rrow').first().locator('select[data-field="format"]').selectOption('Друковані');
  for (let i = 0; i < 3; i++) assert.equal(await page.locator('.rrow').nth(i).locator('select[data-field="format"]').inputValue(), 'Друковані');
  assert.equal(await page.isChecked('#sameFormatToggle'), false);
  await page.check('#sameSizeToggle');
  await page.locator('.rrow').first().locator('select[data-field="size"]').selectOption('10x15');
  for (let i = 0; i < 3; i++) assert.equal(await page.locator('.rrow').nth(i).locator('select[data-field="size"]').inputValue(), '10x15');
  assert.match(await page.locator('.fsum-total-val').textContent(), /180/);

  // рядок 2 → «Електронні»: розмір/кількість блокуються; рядок 3: 30x45 × 3
  const r2 = page.locator('.rrow').nth(1);
  await r2.locator('select[data-field="format"]').selectOption('Електронні');
  assert.ok(await r2.locator('select[data-field="size"]').isDisabled());
  assert.ok(await r2.locator('select[data-field="count"]').isDisabled());
  assert.equal(await r2.locator('select[data-field="size"]').inputValue(), '');
  const r3 = page.locator('.rrow').nth(2);
  await r3.locator('select[data-field="size"]').selectOption('30x45');
  await r3.locator('select[data-field="count"]').selectOption('3');
  // 60 (друк) + 60 (електрон.) + 600 (3×200) = 720 ≥ 600 → подарунок; < 1000 → без відсотка
  assert.match(await page.locator('.fsum-total-val').textContent(), /720/);
  assert.equal(await page.locator('.fdiscount').isVisible(), true);
  assert.match(await page.locator('.fdiscount').textContent(), /безкоштовно/);
  assert.equal(await page.locator('.fsum-row b').nth(0).textContent(), '3');
  assert.equal(await page.locator('.fsum-row b').nth(1).textContent(), '5'); // 1 + 1 + 3

  // валідація клієнтських полів
  await page.fill('#customerName', 'Тестова Олена');
  await page.fill('#customerPhone', '12');
  await page.fill('#orderComment', 'Тестовий коментар');
  await page.click('.fsubmit');
  await page.waitForSelector('#customerPhone.is-invalid');
  assert.equal(await page.locator('.modal').count(), 0);

  await page.fill('#customerPhone', '095 000 00 01');
  await page.click('.fsubmit');
  await page.waitForSelector('.osuccess');
  assert.match(await page.locator('.osuccess-sum').textContent(), /720/);

  const orders = adminOrders(a1);
  const o = orders.find((x) => x.clientName === 'Тестова Олена');
  assert.ok(o, 'замовлення збережено');
  assert.equal(o.totalPrice, 720);
  assert.equal(o.phone, '095 000 00 01');
  assert.equal(o.groupName, 'Група 1');
  assert.equal(o.comment, 'Тестовий коментар');
  assert.equal(o.items.length, 3);
  assert.equal(o.items[0].photoFormat, 'Друковані + електронні'); // подарунок: друковані → друковані + електронні
  assert.equal(o.items[1].photoFormat, 'Електронні');
  assert.equal(o.items[2].count, 3);
  // чернетку очищено
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('photoSelection_')));
  assert.deepEqual(left, []);
  assert.deepEqual(page.errors, []);
});

test('чернетка переживає перезавантаження; видалена картка знімається з вибору в галереї', async () => {
  const page = await newPage(browser);
  const a1 = albumId('a1');
  const q = `album=${a1}&group=DEMO_G2&groupName=${encodeURIComponent('Група 2')}`;
  await page.goto(`${app.url}/gallery.html?${q}`);
  await page.waitForSelector('.gtile');
  await page.locator('.gsel-btn').nth(0).click();
  await page.locator('.gsel-btn').nth(1).click();
  await page.click('#confirm');
  await page.waitForSelector('.rrow');
  await page.fill('#customerName', 'Чернетка Тест');
  await page.locator('.rrow').first().locator('select[data-field="format"]').selectOption('Електронні');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('.rrow');
  assert.equal(await page.inputValue('#customerName'), 'Чернетка Тест');
  assert.equal(await page.locator('.rrow').count(), 2);
  assert.equal(await page.locator('.rrow').first().locator('select[data-field="format"]').inputValue(), 'Електронні');

  // видаляємо першу картку → у галереї це фото вже не вибране
  await page.locator('.rrow').first().locator('[data-act="remove"]').click();
  assert.equal(await page.locator('.rrow').count(), 1);
  await page.click('.rtool .rbtn-help'); // відкриває інструкцію — перевіряємо, що модалка працює
  await page.waitForSelector('.modal');
  await page.keyboard.press('Escape');
  await page.click('.fright .btn-primary');
  await page.waitForSelector('.gtile');
  assert.equal(await page.locator('#n').textContent(), '1');

  // «Скинути вибір» і повернення — рядків немає, дані клієнта на місці
  await page.click('#reset');
  await page.click('#back');
  await page.waitForSelector('.rrow');
  assert.equal(await page.locator('.rrow').count(), 1);
  assert.equal(await page.inputValue('#customerName'), 'Чернетка Тест');
  assert.equal(await page.locator('.rrow-badge + .rrow-thumb .rrow-nophoto').count(), 1);
});

test('портретний бланк: «Вся фотосесія» фіксує суму й ховає ціни', async () => {
  const page = await newPage(browser);
  const a3 = albumId('a3');
  await page.goto(`${app.url}/gallery.html?album=${a3}&group=DEMO_PG1&groupName=${encodeURIComponent('Група 1')}`);
  await page.waitForSelector('.gtile');
  await page.locator('.gsel-btn').nth(0).click();
  await page.locator('.gsel-btn').nth(1).click();
  await page.click('#confirm');
  await page.waitForSelector('.rrow');
  assert.equal(await page.locator('select[data-field="type"]').count(), 0, 'у портретному бланку немає вибору типу');
  await page.check('#sameFormatToggle');
  await page.locator('.rrow').first().locator('select[data-field="format"]').selectOption('Електронні');
  await page.check('#fullSessionToggle');
  assert.match(await page.locator('.fsum-total-val').textContent(), /1[\s ]?000/);
  assert.equal(await page.locator('.rrow-price').count(), 0);
  assert.equal(await page.locator('.rsession-note').isVisible(), true);
  await page.fill('#customerName', 'Портрет Сесія');
  await page.fill('#customerPhone', '+380 63 725 01 65');
  await page.click('.fsubmit');
  await page.waitForSelector('.osuccess');
  const o = adminOrders(a3).find((x) => x.clientName === 'Портрет Сесія');
  assert.ok(o);
  assert.equal(o.isFullSession, true);
  assert.equal(o.totalPrice, 1000);
  assert.equal(o.items.length, 2);
  assert.deepEqual(page.errors, []);
});

test('завершений бланк: відправка заблокована, перегляд фото ще доступний', async () => {
  const page = await newPage(browser);
  const a4 = albumId('a4');
  await page.goto(`${app.url}/form.html?album=${a4}`);
  await page.waitForSelector('.fsubmit');
  assert.ok(await page.locator('.fsubmit').isDisabled());
  assert.equal(await page.locator('.fright .btn-primary').isEnabled(), true);
});

test('англійська версія: немає «сирих» ключів перекладу', async () => {
  const page = await newPage(browser, { lang: 'en' });
  const a1 = albumId('a1');
  for (const url of [`form.html?album=${a1}`, `gallery.html?album=${a1}&group=DEMO_G1`]) {
    await page.goto(`${app.url}/${url}`);
    await page.waitForSelector('.fsubmit, .gtile');
    const text = await page.evaluate(() => document.body.innerText);
    assert.doesNotMatch(text, /\b(form|gallery|viewer|common|err)\.[a-zA-Z]+/, url);
  }
  assert.deepEqual(page.errors, []);
});

test('мобільний екран: немає горизонтальної прокрутки', async () => {
  const page = await newPage(browser, { width: 390, height: 800, mobile: true });
  const a1 = albumId('a1');
  for (const url of [`form.html?album=${a1}&group=DEMO_G1&groupName=${encodeURIComponent('Група 1')}`, `gallery.html?album=${a1}&group=DEMO_G1`]) {
    await page.goto(`${app.url}/${url}`);
    await page.waitForSelector('.fsubmit, .gtile');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `${url}: горизонтальне переповнення ${over}px`);
  }
});
