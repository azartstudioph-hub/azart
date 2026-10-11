// Список замовлень бланка (за потреби — однієї групи).
// Усі бачать імена й суми карток; загальну суму, кнопку «Друкувати» та статуси бачить лише адміністратор.
import { mountLayout } from '../layout.js';
import { t, tv } from '../i18n.js';
import { h, icon, params, buildUrl, initials, debounce, $ } from '../util.js';
import { api, logout } from '../api.js';
import { loadInto } from '../ui.js';
import { formatMoney } from '../pricing.js';

mountLayout({ active: 'orders' });

const q = params();
const albumId = q.get('album') || '';
const groupId = q.get('group') || '';
const groupName = q.get('groupName') || '';

const money = (n) => `${formatMoney(n)} ${t('common.currency')}`;
const STATUS_CLASS = { 'Нове': 'badge-new', 'В роботі': 'badge-work', 'Готово': 'badge-done' };

const app = $('#app');
const back = h('a', { class: 'back-link', href: 'orders.html' }, icon('arrowLeft', 18), h('span', null, t('blanks.back')));
const titleEl = h('h1', { class: 'page-title' }, '…');
const subEl = h('p', { class: 'page-sub small' }, t('aorders.sub') + (groupName ? ' · ' + groupName : ''));
const box = h('div', { class: 'aord-box' });
app.append(h('div', { class: 'container aord-wrap' },
  back,
  h('header', { class: 'page-head aord-head' }, titleEl, subEl),
  box));

function orderCard(o, admin) {
  return h('article', { class: 'aord-card' },
    h('div', { class: 'aord-who' },
      h('span', { class: 'aord-ava', 'aria-hidden': 'true' }, initials(o.clientName)),
      h('h2', { class: 'aord-name' }, o.clientName || '—')),
    h('div', { class: 'aord-mid' },
      h('div', { class: 'aord-sum' }, money(o.totalPrice)),
      admin && o.status ? h('span', { class: 'badge ' + (STATUS_CLASS[o.status] || 'badge-new') }, tv(o.status)) : null),
    h('a', { class: 'btn btn-primary btn-block aord-open', href: buildUrl('order.html', { id: o.id }) }, t('aorders.open')));
}

async function load() {
  if (!albumId) throw new Error(t('aorders.noAlbum'));
  const [{ album }, list] = await Promise.all([
    api('getAlbum', { id: albumId }),
    api('listOrders', { albumId, ...(groupId ? { groupFolderId: groupId } : {}) })
  ]);
  return { album, orders: list.orders || [], admin: !!list.admin };
}

loadInto(box, load, ({ album, orders, admin }) => {
  // токен міг застаріти на сервері — тоді поводимось як із відвідувачем
  if (!admin) logout();
  titleEl.textContent = album.title;
  document.title = `${album.title} — AZART`;

  // «назад»: до вибору групи, якщо вона була, інакше — до списку бланків / адмін-панелі
  if (groupId) back.href = buildUrl('groups.html', { album: album.id, intent: admin ? 'admin' : 'view' });
  else back.href = admin ? 'admin.html' : buildUrl('blanks.html', { sad: album.kindergarten, intent: 'view' });

  const total = orders.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  const chips = h('div', { class: 'aord-chips' },
    h('div', { class: 'aord-chip' }, h('span', null, t('aorders.count')), h('b', null, String(orders.length))),
    admin ? h('div', { class: 'aord-chip aord-chip-total' }, h('span', null, t('aorders.total')), h('b', null, money(total))) : null);
  const tools = h('div', { class: 'aord-tools' }, chips);
  if (admin) {
    tools.append(h('a', {
      class: 'btn btn-ghost aord-print',
      href: buildUrl('print.html', { albumId: album.id, groupFolderId: groupId, groupName })
    }, icon('printer', 20), h('span', null, t('aorders.print'))));
  }
  box.append(tools);

  if (!orders.length) {
    box.append(h('div', { class: 'state' }, h('p', null, t('aorders.none'))));
    return;
  }

  const grid = h('div', { class: 'aord-grid' });
  const none = h('div', { class: 'state', hidden: true }, h('p', null, t('aorders.noMatch')));
  const paint = (needle) => {
    const n = needle.trim().toLowerCase();
    const shown = n ? orders.filter((o) => String(o.clientName || '').toLowerCase().includes(n)) : orders;
    grid.replaceChildren(...shown.map((o) => orderCard(o, admin)));
    none.hidden = shown.length > 0;
  };
  if (orders.length > 8) {
    const input = h('input', { class: 'input aord-search-input', type: 'search', placeholder: t('aorders.search'), 'aria-label': t('aorders.search'), autocomplete: 'off' });
    input.addEventListener('input', debounce(() => paint(input.value), 120));
    tools.append(h('label', { class: 'aord-search' }, icon('search', 18), input));
  }
  paint('');
  box.append(grid, none);
});
