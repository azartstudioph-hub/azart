// Перегляд одного замовлення.
// order.html?id=ID[&key=СЕКРЕТ] — телефон і коментар бачить адміністратор або власник посилання з ключем.
// Адміністратор додатково може скопіювати «стрічку номерів» для пошуку фото і видалити замовлення.
import { mountLayout } from '../layout.js';
import { t, tv } from '../i18n.js';
import { h, icon, params, buildUrl, copyText, $ } from '../util.js';
import { api, errorText, logout } from '../api.js';
import { loadInto } from '../ui.js';
import { formatMoney } from '../pricing.js';
import { sizeLabel } from '../domain.js';
import { confirmDialog, toast } from '../modal.js';

mountLayout({ active: 'orders' });

const q = params();
const orderId = q.get('id') || '';
const key = q.get('key') || '';

const money = (n) => `${formatMoney(n)} ${t('common.currency')}`;

const app = $('#app');
const back = h('a', { class: 'back-link', href: 'orders.html' }, icon('arrowLeft', 18), h('span', null, t('order.backList')));
const box = h('div', { class: 'ord-box' });
app.append(h('div', { class: 'container ord-wrap' },
  back,
  h('header', { class: 'ord-head' },
    h('h1', { class: 'ord-title' }, t('order.title')),
    h('p', { class: 'ord-sub' }, t('order.sub'))),
  box));

function table(order) {
  const showPrice = !order.isFullSession;
  const head = h('tr', null,
    h('th', null, t('order.colPhoto')),
    h('th', null, t('order.colType')),
    h('th', null, t('order.colSize')),
    h('th', null, t('order.colFormat')),
    h('th', null, t('order.colCount')),
    showPrice ? h('th', null, t('order.colPrice')) : null);
  const rows = order.items.map((i) => h('tr', null,
    h('td', { class: 'ord-photo', 'data-label': t('order.colPhoto') }, i.photoNumber || '—'),
    h('td', { 'data-label': t('order.colType') }, tv(i.photoType) || '—'),
    h('td', { 'data-label': t('order.colSize') }, i.photoSize ? sizeLabel(i.photoSize) : '—'),
    h('td', { class: 'ord-format', 'data-label': t('order.colFormat') }, tv(i.photoFormat) || '—'),
    h('td', { 'data-label': t('order.colCount') }, String(i.count)),
    showPrice ? h('td', { class: 'ord-price', 'data-label': t('order.colPrice') }, money(i.price)) : null));
  return h('div', { class: 'ord-table-wrap' },
    order.items.length
      ? h('table', { class: 'ord-table' }, h('thead', null, head), h('tbody', null, rows))
      : h('div', { class: 'state' }, h('p', null, t('order.noItems'))));
}

/** Нижня панель адміністратора: «стрічка номерів» для пошуку фото в провіднику. */
function searchBar(order) {
  const numbers = [];
  order.items.forEach((i) => {
    const n = String(i.photoNumber || '').trim();
    if (n && !numbers.includes(n)) numbers.push(n);
  });
  const str = numbers.join(' OR ');
  const out = h('button', { class: 'ord-search-out', type: 'button', hidden: true, title: t('order.copyHint') });
  const copy = async () => {
    if (await copyText(str)) toast(t('order.copied'), 'success', 1800);
    else toast(t('order.copyFail'), 'error', 5000);
  };
  const make = h('button', { class: 'btn btn-primary ord-search-btn', type: 'button' }, t('order.makeSearch'));
  make.addEventListener('click', () => {
    out.hidden = false;
    if (!numbers.length) { out.textContent = t('order.noNumbers'); out.disabled = true; return; }
    out.textContent = str;
    copy();
  });
  out.addEventListener('click', () => { if (numbers.length) copy(); });
  return h('div', { class: 'ord-bar' }, make, out);
}

function sideCard(order, admin, canSeeAll) {
  const comment = String(order.comment || '').replace(/<\/?p>/gi, '').trim();
  const commentText = comment || (order.commentHidden ? t('order.commentHidden') : '-');
  return h('aside', { class: 'ord-card' },
    h('div', { class: 'ord-label' }, t('order.customer')),
    h('div', { class: 'ord-name' }, order.clientName || '-'),
    h('hr', { class: 'ord-hr' }),
    h('div', { class: 'ord-facts' },
      order.groupName ? h('div', { class: 'ord-fact' }, h('div', { class: 'ord-label' }, t('order.group')), h('div', { class: 'ord-val' }, order.groupName)) : null,
      h('div', { class: 'ord-fact' }, h('div', { class: 'ord-label' }, t('order.phone')), h('div', { class: 'ord-val' }, order.phone || '-')),
      h('div', { class: 'ord-fact' }, h('div', { class: 'ord-label' }, t('order.photos')), h('div', { class: 'ord-val' }, String(order.totalPhotos)))),
    h('div', { class: 'ord-total' },
      h('span', null, t('order.total')),
      h('b', null, money(order.totalPrice))),
    order.isFullSession ? h('div', { class: 'ord-session' }, icon('camera', 18), h('span', null, t('order.fullSession'))) : null,
    h('div', { class: 'ord-label ord-label-comment' }, t('order.comment')),
    h('div', { class: 'ord-comment' + (comment ? '' : ' is-empty') }, commentText),
    !canSeeAll ? h('p', { class: 'ord-privacy' }, icon('lock', 15), h('span', null, t('order.privacy'))) : null);
}

async function load() {
  if (!orderId) throw new Error(t('order.noId'));
  return api('getOrder', { id: orderId, ...(key ? { key } : {}) });
}

loadInto(box, load, ({ order, album }) => {
  const admin = !!order.admin;
  if (!admin) logout();
  document.title = `${order.clientName || t('order.title')} — AZART`;

  // «назад» — до списку замовлень тієї ж групи
  if (album) {
    back.href = buildUrl('album-orders.html', { album: album.id, group: order.groupFolderId, groupName: order.groupName });
  }

  box.append(h('div', { class: 'ord-grid' }, table(order), sideCard(order, admin, order.canSeeAll)));

  if (admin) {
    const bar = searchBar(order);
    const del = h('button', { class: 'btn btn-ghost btn-sm ord-delete', type: 'button' }, icon('trash', 16), h('span', null, t('order.delete')));
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: t('order.deleteTitle'), text: t('order.deleteText', { name: order.clientName }),
        confirmText: t('common.delete'), danger: true
      });
      if (!ok) return;
      del.disabled = true;
      try {
        await api('deleteOrder', { id: order.id }, { retries: 0 });
        toast(t('order.deleted'), 'success', 1800);
        setTimeout(() => { location.href = back.href; }, 500);
      } catch (e) {
        del.disabled = false;
        toast(errorText(e), 'error', 6000);
      }
    });
    box.append(bar, h('div', { class: 'ord-admin-foot' }, del));
  }
});
