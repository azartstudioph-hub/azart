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
import { getPhotos, thumbUrl, fallbackThumbUrl } from '../drive.js';
import { openViewer } from '../viewer.js';

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

/** Ключ для зіставлення «номер фото в замовленні» ↔ «файл у папці»: без розширення, без урахування регістру. */
const photoKey = (name) => String(name || '').trim().replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase();

function table(order) {
  const showPrice = !order.isFullSession;
  const thumbs = [];
  const head = h('tr', null,
    h('th', null, t('order.colPhoto')),
    h('th', null, t('order.colType')),
    h('th', null, t('order.colSize')),
    h('th', null, t('order.colFormat')),
    h('th', null, t('order.colCount')),
    showPrice ? h('th', null, t('order.colPrice')) : null);
  const rows = order.items.map((i) => {
    let thumb = null;
    if (photoKey(i.photoNumber)) {
      thumb = h('button', { class: 'ord-thumb is-loading', type: 'button', disabled: true, 'aria-label': t('form.openPhoto') + ': ' + i.photoNumber });
      thumbs.push({ key: photoKey(i.photoNumber), btn: thumb });
    }
    return h('tr', null,
      h('td', { class: 'ord-photo', 'data-label': t('order.colPhoto') },
        h('div', { class: 'ord-pcell' }, thumb, h('span', { class: 'ord-pnum' }, i.photoNumber || '—'))),
      h('td', { 'data-label': t('order.colType') }, tv(i.photoType) || '—'),
      h('td', { 'data-label': t('order.colSize') }, i.photoSize ? sizeLabel(i.photoSize) : '—'),
      h('td', { class: 'ord-format', 'data-label': t('order.colFormat') }, tv(i.photoFormat) || '—'),
      h('td', { 'data-label': t('order.colCount') }, String(i.count)),
      showPrice ? h('td', { class: 'ord-price', 'data-label': t('order.colPrice') }, money(i.price)) : null);
  });
  const node = h('div', { class: 'ord-table-wrap' },
    order.items.length
      ? h('table', { class: 'ord-table' }, h('thead', null, head), h('tbody', null, rows))
      : h('div', { class: 'state' }, h('p', null, t('order.noItems'))));
  return { node, thumbs };
}

/** Підвантажує мініатюри з папки Google Диска групи (або бланка). Збій не ламає сторінку: лишаються заглушки. */
async function fillThumbs(order, album, thumbs) {
  const markMissing = (th) => {
    th.btn.classList.remove('is-loading');
    th.btn.classList.add('is-missing');
    th.btn.replaceChildren(icon('camera', 22));
    th.btn.title = t('order.thumbMissing');
  };
  if (!thumbs.length) return;
  let photos = [];
  try {
    let folderId = order.groupFolderId || '';
    if (!folderId && album) folderId = (await api('getAlbum', { id: album.id })).album.driveFolderId || '';
    if (folderId) photos = await getPhotos(folderId);
  } catch (e) { photos = []; }

  const byKey = new Map();
  photos.forEach((p) => { const k = photoKey(p.name); if (!byKey.has(k)) byKey.set(k, p); });

  // у переглядачі гортаються лише знайдені фото замовлення (без повторів, у порядку таблиці)
  const list = [];
  const indexOf = new Map();
  thumbs.forEach((th) => {
    const p = byKey.get(th.key);
    if (p && !indexOf.has(p.id)) { indexOf.set(p.id, list.length); list.push(p); }
  });

  thumbs.forEach((th) => {
    const p = byKey.get(th.key);
    if (!p) { markMissing(th); return; }
    const img = h('img', { alt: p.name, loading: 'lazy', decoding: 'async', draggable: 'false' });
    let fell = false;
    img.addEventListener('error', () => {
      if (!fell) { fell = true; img.src = fallbackThumbUrl(p, 320); } else markMissing(th);
    });
    img.addEventListener('load', () => th.btn.classList.remove('is-loading'));
    img.src = thumbUrl(p, 320);
    th.btn.replaceChildren(img);
    th.btn.disabled = false;
    th.btn.addEventListener('click', () => openViewer({ photos: list, index: indexOf.get(p.id) }));
  });
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

  const tbl = table(order);
  box.append(h('div', { class: 'ord-grid' }, tbl.node, sideCard(order, admin, order.canSeeAll)));
  fillThumbs(order, album, tbl.thumbs);

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
