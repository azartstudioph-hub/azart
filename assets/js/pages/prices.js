// Публічна сторінка «Ціни».
import { mountLayout } from '../layout.js';
import { t } from '../i18n.js';
import { h, icon, $ } from '../util.js';
import { api } from '../api.js';
import { loadInto } from '../ui.js';
import { formatMoney } from '../pricing.js';
import { SIZES } from '../domain.js';

mountLayout({ active: 'prices' });
document.title = t('nav.prices') + ' — AZART';

const money = (v) => `${formatMoney(v, { group: false })} ${t('common.currency')}`;

function pricesTable(p) {
  const rows = [
    ['prices.rowBackground', 'background'],
    ['prices.rowReportage', 'reportage'],
    ['prices.rowPortrait', 'portret']
  ];
  return h('div', { class: 'ptable-wrap' },
    h('table', { class: 'ptable' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, t('prices.colType')),
        SIZES.map((s) => h('th', { scope: 'col' }, s)),
        h('th', { scope: 'col' }, t('prices.colDigital')))),
      h('tbody', null, rows.map(([labelKey, key]) => h('tr', null,
        h('th', { scope: 'row', class: 'ptype' }, t(labelKey)),
        SIZES.map((s) => h('td', null, money(p[key + s.replace('x', 'X') + 'Print']))),
        h('td', null, money(p[key + 'Digital'])))))));
}

function discountCards(p) {
  const tiers = [];
  if (Number(p.discountThreshold) > 0) tiers.push({ amount: p.discountThreshold, text: t('prices.gift') });
  [['discountPriceThreshold', 'discountPercent'], ['discountPriceThreshold2', 'discountPercent2'], ['discountPriceThreshold3', 'discountPercent3']]
    .forEach(([a, pc]) => { if (Number(p[a]) > 0 && Number(p[pc]) > 0) tiers.push({ amount: p[a], text: t('prices.discount', { n: formatMoney(p[pc]) }) }); });
  tiers.sort((a, b) => a.amount - b.amount);
  return h('div', { class: 'tiers' }, tiers.map((tier, i) => h('div', { class: 'tier' },
    h('div', { class: 'tier-bars', 'aria-hidden': 'true' }, [0, 1, 2, 3].map((n) => h('span', { class: n <= i ? 'on' : '' }))),
    h('div', { class: 'tier-from' }, t('prices.from')),
    h('div', { class: 'tier-amount' }, money(tier.amount)),
    h('div', { class: 'tier-text' }, tier.text))));
}

const app = $('#app');
const box = h('div', { class: 'container prices-wrap' });
app.append(box);

loadInto(box, () => api('getPrices'), ({ prices: p }) => {
  box.append(
    h('header', { class: 'prices-head' }, h('h1', null, t('prices.title')), h('p', null, t('prices.sub'))),
    pricesTable(p),
    h('div', { class: 'pnote' }, h('span', { class: 'pnote-ico' }, icon('monitor', 22)), h('p', null, t('prices.extra', { n: formatMoney(p.printAndDigitalExtra) }))),
    h('section', { class: 'prices-disc' },
      h('h2', null, t('prices.discTitle')), h('p', { class: 'muted' }, t('prices.discSub')), discountCards(p)));
});
