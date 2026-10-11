// Сторінка «Замовлення»: вибір дії (створити / переглянути) та садочка.
import { mountLayout } from '../layout.js';
import { t } from '../i18n.js';
import { h, icon, buildUrl, $ } from '../util.js';
import { CONFIG } from '../config.js';

mountLayout({ active: 'orders' });
document.title = t('nav.orders') + ' — AZART';

function stepItem(n, key) {
  return h('li', { class: 'ostep' },
    h('span', { class: 'ostep-n' }, String(n)),
    h('span', { class: 'ostep-t' }, t(key)));
}

function card({ intent, iconName, titleKey, descKey, primary }) {
  return h('section', { class: 'ocard' + (primary ? ' is-primary' : ''), 'aria-labelledby': 'oc-' + intent },
    h('div', { class: 'ocard-head' },
      h('span', { class: 'ocard-ico' + (primary ? ' is-blue' : '') }, icon(iconName, 26)),
      h('div', null,
        h('h2', { class: 'ocard-title', id: 'oc-' + intent }, t(titleKey)),
        h('p', { class: 'ocard-desc' }, t(descKey)))),
    h('ul', { class: 'ocard-list' },
      CONFIG.KINDERGARTENS.map((kg) => h('li', null,
        h('a', { class: 'ocard-row', href: buildUrl('blanks.html', { sad: kg, intent }) },
          h('span', null, kg), icon('arrowRight', 18))))));
}

$('#app').append(
  h('div', { class: 'container container-sm' },
    h('header', { class: 'page-head orders-head' },
      h('h1', { class: 'page-title' }, t('orders.title')),
      h('p', { class: 'page-sub small' }, t('orders.sub'))),
    h('ol', { class: 'osteps' }, stepItem(1, 'orders.s1'), stepItem(2, 'orders.s2'), stepItem(3, 'orders.s3')),
    h('div', { class: 'ocards' },
      card({ intent: 'create', iconName: 'plus', titleKey: 'orders.createTitle', descKey: 'orders.createDesc', primary: true }),
      card({ intent: 'view', iconName: 'eye', titleKey: 'orders.viewTitle', descKey: 'orders.viewDesc' }))));
