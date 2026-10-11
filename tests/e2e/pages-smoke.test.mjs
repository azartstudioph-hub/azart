import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, launchBrowser, newPage } from './helpers.mjs';

let app, browser;
test.before(async () => { app = await startApp(); browser = await launchBrowser(); });
test.after(async () => { await browser.close(); await app.close(); });

const a = (k) => app.seeded.albums[k].id;

test('сторінка груп: картка групи має власний вигляд (регресія конфлікту .gcard)', async () => {
  const page = await newPage(browser, { width: 1300 });
  await page.goto(`${app.url}/groups.html?album=${a('a1')}&intent=view`);
  await page.waitForSelector('.gcard');
  const st = await page.locator('.gcard').first().evaluate((el) => {
    const c = getComputedStyle(el);
    return { radius: parseFloat(c.borderTopLeftRadius), overflow: c.overflow, display: c.display };
  });
  assert.ok(st.radius >= 24, JSON.stringify(st));
  assert.equal(st.overflow, 'visible');
  assert.equal(st.display, 'flex');
});

const PAGES = [
  ['index.html', '#app'],
  ['orders.html', '.ocard'],
  ['prices.html', '.prices-card, .pcard, table, .state'],
  ['blanks.html?sad=' + encodeURIComponent('Сад 7') + '&intent=view', '.state, .bcard, .blank-card, article'],
];

for (const [url, sel] of PAGES) {
  test(`без помилок у консолі та без горизонтальної прокрутки: ${url.split('?')[0]}`, async () => {
    for (const [w, mobile] of [[1280, false], [375, true]]) {
      const page = await newPage(browser, { width: w, height: 800, mobile });
      await page.goto(`${app.url}/${url}`);
      await page.waitForSelector(sel, { timeout: 8000 });
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `${url} @${w}: overflow ${over}`);
      assert.deepEqual(page.errors, [], url);
      await page.context().close();
    }
  });
}
