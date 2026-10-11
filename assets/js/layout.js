// Спільна шапка та футер сайту. Кожна сторінка викликає mountLayout().
import { h, icon } from './util.js';
import { CONFIG } from './config.js';
import { t, getLang, setLang, applyI18n } from './i18n.js';
import { initTheme, getMode, cycleMode } from './theme.js';

const NAV = [
  { id: 'home', href: 'index.html', key: 'nav.home' },
  { id: 'orders', href: 'orders.html', key: 'nav.orders' },
  { id: 'prices', href: 'prices.html', key: 'nav.prices' }
];

function themeButton() {
  const labels = { system: 'theme.system', light: 'theme.light', dark: 'theme.dark' };
  const icons = { system: 'auto', light: 'sun', dark: 'moon' };
  const btn = h('button', { class: 'theme-btn', type: 'button' });
  const paint = () => {
    const m = getMode();
    btn.replaceChildren(icon(icons[m], 18));
    btn.title = t(labels[m]);
    btn.setAttribute('aria-label', t(labels[m]));
  };
  btn.addEventListener('click', () => { cycleMode(); paint(); });
  paint();
  return btn;
}

function langToggle() {
  const cur = getLang();
  return h('div', { class: 'lang', role: 'group', 'aria-label': 'Language' },
    ['uk', 'en'].map((l) => h('button', {
      type: 'button', class: 'lang-btn' + (cur === l ? ' is-active' : ''),
      'aria-pressed': cur === l ? 'true' : 'false', onclick: () => { if (l !== cur) setLang(l); }
    }, l.toUpperCase())));
}

/** Тема + мова — використовується в усіх варіантах шапки. */
function headerTools() {
  return h('div', { class: 'header-tools' }, themeButton(), langToggle());
}

export function buildHeader(active) {
  return h('header', { class: 'site-header' },
    h('div', { class: 'site-header-inner' },
      h('a', { class: 'logo', href: 'index.html', 'aria-label': 'AZART' }, 'AZART'),
      h('nav', { class: 'nav', 'aria-label': 'Main' },
        NAV.map((n) => h('a', { class: 'nav-link' + (n.id === active ? ' is-active' : ''), href: n.href, 'aria-current': n.id === active ? 'page' : null }, t(n.key)))),
      headerTools()));
}

/**
 * Проста шапка для робочих сторінок (форма, галерея): «← назад» зліва, назва бланка по центру.
 * Повертає { el, titleEl }, щоб сторінка могла підставити назву після завантаження.
 */
export function buildBareHeader({ backHref, backKey, title = '' }) {
  const titleEl = h('h1', { class: 'bare-title' }, title);
  const el = h('header', { class: 'site-header bare-header' },
    h('div', { class: 'bare-header-inner' },
      h('a', { class: 'back-link', href: backHref }, icon('arrowLeft', 18), h('span', null, t(backKey))),
      titleEl,
      headerTools()));
  return { el, titleEl };
}

export function buildFooter() {
  const c = CONFIG.CONTACT;
  const sched = CONFIG.SCHEDULE[getLang()] || CONFIG.SCHEDULE.uk;
  const viber = h('a', { class: 'social', href: c.viber, 'aria-label': 'Viber', title: 'Viber' });
  viber.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3C7.6 3 4 6 4 10.5c0 2.5 1.1 4.4 2.8 5.6V21l3.1-2.2c.7.1 1.4.2 2.1.2 4.4 0 8-3 8-7.5S16.4 3 12 3z"/><path d="M9.4 8.2c-.4-.3-.9-.1-1.2.3-.5.8-.2 1.8.5 2.9 1 1.6 2.2 2.7 3.7 3.3 1 .4 1.9.2 2.5-.4.3-.4.3-.8-.1-1.1l-.9-.7c-.3-.2-.6-.1-.8.2l-.3.3c-.9-.4-1.7-1.2-2.2-2.2l.3-.3c.3-.3.4-.6.1-.9z"/><path d="M13.3 6.8c1.5.2 2.6 1.3 2.8 2.8M13.2 8.7c.7.1 1.2.6 1.3 1.3"/></svg>';
  const tg = h('a', { class: 'social social-tg', href: c.telegram, target: '_blank', rel: 'noopener', 'aria-label': 'Telegram', title: 'Telegram' });
  tg.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M5.5 11.8l11.3-4.4c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.5.8-1 .5l-2.8-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-2.9 5.2-4.7c.2-.2 0-.3-.3-.1l-6.5 4.1-2.8-.9c-.6-.2-.6-.6.1-.9z" fill="var(--bg)"/></svg>';
  return h('footer', { class: 'site-footer' },
    h('div', { class: 'site-footer-inner' },
      h('div', { class: 'footer-copy' }, `© ${new Date().getFullYear()} AZART`),
      h('div', { class: 'footer-schedule' }, h('span', null, t('footer.schedule') + ' '), h('span', { class: 'footer-schedule-val' }, sched)),
      h('div', { class: 'footer-contacts' },
        h('span', { class: 'footer-contacts-label' }, t('footer.contacts')),
        h('a', { class: 'footer-phone', href: 'tel:' + c.phone }, c.phoneLabel),
        viber, tg)));
}

/**
 * mountLayout({ active: 'home'|'orders'|'prices'|null, header: true, footer: true })
 * Шукає #site-header і #site-footer у сторінці; якщо немає — створює на початку/в кінці body.
 */
export function mountLayout({ active = null, header = true, footer = true } = {}) {
  initTheme();
  if (header) {
    const host = document.getElementById('site-header');
    const el = buildHeader(active);
    if (host) host.replaceWith(el); else document.body.prepend(el);
  }
  if (footer) {
    const host = document.getElementById('site-footer');
    const el = buildFooter();
    if (host) host.replaceWith(el); else document.body.appendChild(el);
  }
  applyI18n();
}

/** Верхня смужка для сторінок без загальної шапки (форма замовлення, галерея тощо). */
export function backLink(href, labelKey) {
  return h('a', { class: 'back-link', href }, icon('arrowLeft', 18), h('span', null, t(labelKey)));
}

/** Те саме, що mountLayout, але з простою шапкою (buildBareHeader). Повертає { titleEl }. */
export function mountBareLayout({ backHref, backKey, title = '', footer = true }) {
  initTheme();
  const { el, titleEl } = buildBareHeader({ backHref, backKey, title });
  const host = document.getElementById('site-header');
  if (host) host.replaceWith(el); else document.body.prepend(el);
  if (footer) {
    const fh = document.getElementById('site-footer');
    const fe = buildFooter();
    if (fh) fh.replaceWith(fe); else document.body.appendChild(fe);
  }
  applyI18n();
  return { titleEl };
}
