// Сторінки для платіжного сервісу й покупців: оферта, оплата і доставка, повернення, конфіденційність, контакти.
// Яку сторінку показати — з атрибута <body data-legal="oferta">.
import { mountLayout } from '../layout.js';
import { t, getLang } from '../i18n.js';
import { h, icon, $ } from '../util.js';
import { api, isAdminLoggedIn } from '../api.js';
import { CONFIG } from '../config.js';
import { LEGAL_PAGES, LEGAL_ORDER, LEGAL_FILES } from '../legal-texts.js';

const page = document.body.dataset.legal || 'oferta';
const def = LEGAL_PAGES[page] || LEGAL_PAGES.oferta;
mountLayout({ active: null });
document.title = def.title + ' — AZART';

const app = $('#app');
const body = h('div', { class: 'legal-body' }, h('div', { class: 'state', role: 'status' }, h('div', { class: 'spin' })));
const nav = h('nav', { class: 'legal-nav', 'aria-label': t('legal.nav') },
  LEGAL_ORDER.map((k) => h('a', { href: LEGAL_FILES[k], class: k === page ? 'is-active' : '', 'aria-current': k === page ? 'page' : null }, LEGAL_PAGES[k].title)));
app.append(h('div', { class: 'container legal-wrap' },
  h('header', { class: 'page-head legal-head' }, h('h1', { class: 'page-title' }, def.title)),
  getLang() === 'en' ? h('p', { class: 'legal-lang' }, t('legal.ukOnly')) : null,
  nav, body));

function render(biz) {
  const c = CONFIG.CONTACT || {};
  const values = {
    site: location.host || 'AZART',
    name: biz.name, taxId: biz.taxId, address: biz.address, email: biz.email
  };
  const missing = [];
  const part = (x) => {
    if (typeof x === 'string') return x;
    const v = values[x.v];
    if (v) return h('span', { class: 'legal-val' }, v);
    if (!missing.includes(x.v)) missing.push(x.v);
    return h('span', { class: 'legal-missing' }, t('legal.missing'));
  };
  const para = (p) => h('p', null, (Array.isArray(p) ? p : [p]).map(part));
  const row = (label, value, href) => h('div', { class: 'legal-row' },
    h('dt', null, label),
    h('dd', null, value ? (href ? h('a', { href }, value) : value) : part({ v: label })));
  const details = (withSchedule) => h('dl', { class: 'legal-details' },
    h('div', { class: 'legal-row' }, h('dt', null, 'Виконавець'), h('dd', null, part({ v: 'name' }))),
    h('div', { class: 'legal-row' }, h('dt', null, 'РНОКПП'), h('dd', null, part({ v: 'taxId' }))),
    h('div', { class: 'legal-row' }, h('dt', null, 'Адреса'), h('dd', null, part({ v: 'address' }))),
    row('Телефон', c.phoneLabel, c.phone ? 'tel:' + c.phone : null),
    h('div', { class: 'legal-row' }, h('dt', null, 'Email'), h('dd', null, values.email ? h('a', { href: 'mailto:' + values.email }, values.email) : part({ v: 'email' }))),
    c.viber || c.telegram ? h('div', { class: 'legal-row' }, h('dt', null, 'Месенджери'), h('dd', null,
      c.viber ? h('a', { href: c.viber }, 'Viber') : null, c.viber && c.telegram ? ' · ' : null,
      c.telegram ? h('a', { href: c.telegram, target: '_blank', rel: 'noopener' }, 'Telegram') : null)) : null,
    withSchedule && CONFIG.SCHEDULE ? row('Графік роботи', CONFIG.SCHEDULE.uk) : null);

  const out = [];
  if (def.lead) out.push(h('p', { class: 'legal-lead' }, def.lead.map(part)));
  def.sections.forEach((s) => {
    out.push(h('section', { class: 'legal-sec' },
      h('h2', null, s.h),
      (s.p || []).map(para),
      s.details ? details(!!s.schedule) : null));
  });
  if (page === 'payment' || page === 'oferta') {
    out.push(h('div', { class: 'legal-cards', 'aria-label': t('legal.cards') },
      ['Visa', 'Mastercard', 'LiqPay'].map((n) => h('span', { class: 'legal-card' }, n))));
  }
  // адміністратору — підказка, які дані ще не заповнені
  if (missing.length && isAdminLoggedIn()) {
    out.unshift(h('div', { class: 'note note-warn legal-admin' }, icon('info', 20),
      h('div', null, t('legal.adminMissing'), ' ', h('a', { href: 'admin.html' }, t('legal.toSettings')))));
  }
  body.replaceChildren(...out);
}

api('siteInfo', {}, { retries: 1 })
  .then((r) => render((r && r.business) || {}))
  .catch(() => render({}));
