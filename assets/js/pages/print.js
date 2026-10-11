// Друк замовлень бланка (або однієї групи): таблиця «клієнт → позиції» для друкарні. Лише для адміністратора.
// print.html?albumId=ID[&groupFolderId=ID&groupName=ТЕКСТ]
import { mountLayout } from '../layout.js';
import { t, tv } from '../i18n.js';
import { h, icon, params, buildUrl, fmtDateShort, $ } from '../util.js';
import { api, isAdminLoggedIn } from '../api.js';
import { loadInto } from '../ui.js';
import { sizeLabel } from '../domain.js';
import { formatMoney } from '../pricing.js';

mountLayout({ active: 'orders' });
document.title = t('print.title') + ' — AZART';

const q = params();
const albumId = q.get('albumId') || q.get('album') || '';
const groupId = q.get('groupFolderId') || q.get('group') || '';
const groupName = q.get('groupName') || '';

const app = $('#app');
const back = h('a', { class: 'back-link', href: 'orders.html' }, icon('arrowLeft', 18), h('span', null, t('print.back')));
const box = h('div', { class: 'prt-box' });
app.append(h('div', { class: 'container prt-wrap' }, back, box));

const money = (n) => `${formatMoney(n, { group: false })} ${t('common.currency')}`;

function sheet(album, orders, showComments) {
  const grand = orders.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  const head = h('tr', null,
    h('th', null, t('print.colName')),
    h('th', { class: 'prt-date' }, h('span', null, t('print.colDate'))),
    h('th', null, t('print.colPhoto')), h('th', null, t('print.colType')), h('th', null, t('print.colFormat')),
    h('th', null, t('print.colSize')), h('th', { class: 'prt-count' }, t('print.colCount')), h('th', null, t('print.colSum')));

  const rows = [];
  orders.forEach((o, idx) => {
    const parity = idx % 2 === 0 ? 'is-even' : 'is-odd';
    const comment = showComments ? String(o.comment || '').trim() : '';
    const span = Math.max(o.items.length, 1) + (comment ? 1 : 0);
    const lead = [
      h('td', { class: 'prt-name', rowspan: span }, o.clientName),
      h('td', { class: 'prt-date', rowspan: span }, h('span', null, fmtDateShort(o.createdAt)))
    ];
    const sum = h('td', { class: 'prt-sum', rowspan: span }, money(o.totalPrice));
    if (!o.items.length) {
      rows.push(h('tr', { class: `${parity} is-first` }, lead, h('td', { colspan: 5 }, t('print.noItems')), sum));
    } else {
      o.items.forEach((it, i) => {
        rows.push(h('tr', { class: `${parity}${i === 0 ? ' is-first' : ''}` },
          i === 0 ? lead : null,
          h('td', null, it.photoNumber), h('td', null, tv(it.photoType)), h('td', null, tv(it.photoFormat)),
          h('td', null, it.photoSize ? sizeLabel(it.photoSize) : '-'), h('td', { class: 'prt-count' }, String(it.count)),
          i === 0 ? sum : null));
      });
    }
    if (comment) rows.push(h('tr', { class: `${parity} prt-comment-row` }, h('td', { colspan: 5 }, h('b', null, t('print.comment') + ' '), comment)));
  });

  const title = [album.title, groupName].filter(Boolean).join(' · ');
  return h('div', { class: 'prt-paper' },
    h('div', { class: 'prt-meta' },
      h('h1', { class: 'prt-title' }, title),
      h('div', { class: 'prt-total' }, t('print.total') + ' ', h('span', null, money(grand)))),
    h('table', { class: 'prt-table' }, h('thead', null, head), h('tbody', null, rows)));
}

async function load() {
  if (!albumId) throw new Error(t('print.noAlbum'));
  const [{ album }, list] = await Promise.all([
    api('getAlbum', { id: albumId }),
    api('listOrdersFull', { albumId, ...(groupId ? { groupFolderId: groupId } : {}) })
  ]);
  // від старіших до новіших (як у Wix)
  const orders = [...list.orders].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return { album, orders };
}

if (!isAdminLoggedIn()) {
  box.append(h('div', { class: 'note note-warn' }, icon('lock', 20),
    h('div', null, t('groups.needLogin') + ' ', h('a', { href: 'admin.html', style: { fontWeight: 600 } }, t('groups.toAdmin')))));
} else {
  loadInto(box, load, ({ album, orders }) => {
    back.href = buildUrl('album-orders.html', { album: album.id, group: groupId, groupName });
    if (!orders.length) { box.append(h('div', { class: 'state' }, h('p', null, t('print.empty')))); return; }

    const commentsBox = h('input', { type: 'checkbox', id: 'prt-comments', checked: true });
    const holder = h('div');
    const paint = () => holder.replaceChildren(sheet(album, orders, commentsBox.checked));
    commentsBox.addEventListener('change', paint);
    const printBtn = h('button', { class: 'btn btn-primary btn-lg prt-btn', type: 'button' }, icon('printer', 20), h('span', null, t('print.button')));
    printBtn.addEventListener('click', () => window.print());
    box.append(
      h('div', { class: 'prt-toolbar' }, printBtn, h('label', { class: 'check prt-toggle', for: 'prt-comments' }, commentsBox, h('span', null, t('print.comments')))),
      holder);
    paint();
  });
}
