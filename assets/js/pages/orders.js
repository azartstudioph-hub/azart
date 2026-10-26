// Сторінка «Замовлення»: вибір дії (створити / переглянути) та садочка.
import { mountLayout } from '../layout.js';
import { t } from '../i18n.js';
import { h, icon, buildUrl, $ } from '../util.js';
import { CONFIG } from '../config.js';

mountLayout({ active: 'orders' });
document.title = t('nav.orders') + ' — AZART';

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
      h('h1', { class: 'page-title' }, t('orders.title'))),
    h('div', { class: 'ocards' },
      card({ intent: 'create', iconName: 'plus', titleKey: 'orders.createTitle', descKey: 'orders.createDesc', primary: true }),
      card({ intent: 'view', iconName: 'eye', titleKey: 'orders.viewTitle', descKey: 'orders.viewDesc' }))));
