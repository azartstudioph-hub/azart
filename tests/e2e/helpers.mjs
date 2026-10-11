// Спільні утиліти для e2e-тестів: запуск dev-сервера з емульованим бекендом і браузера Playwright.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* шукаємо глобально */ }
  const globalRoot = execSync('npm root -g').toString().trim();
  return createRequire(globalRoot + '/').call ? createRequire(globalRoot + '/')('playwright') : null;
}

export async function startApp(opts = {}) {
  const { start } = require('../../dev/server.js');
  return start({ port: 0, quiet: true, ...opts });
}

export async function launchBrowser() {
  const { chromium } = loadPlaywright();
  const exe = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
  const args = ['--no-sandbox'];
  try { return await chromium.launch(exe ? { executablePath: exe, args } : { args }); } catch (e) { return chromium.launch({ args }); }
}

/** Новий контекст: блокуємо зовнішні запити (шрифти) і збираємо помилки сторінки. */
export async function newPage(browser, { width = 1300, height = 900, dark = false, lang = 'uk', admin = null, mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, colorScheme: dark ? 'dark' : 'light',
    hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(([l, tok]) => {
    try {
      localStorage.setItem('azart_lang', l);
      if (tok) localStorage.setItem('azart_admin_token', JSON.stringify({ token: tok, expiresAt: Date.now() + 3600e3 }));
    } catch (e) { /* ignore */ }
  }, [lang, admin]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts\./.test(m.text())) errors.push('console: ' + m.text()); });
  page.errors = errors;
  return page;
}
