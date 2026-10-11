// Сторінка садочка: список бланків (свят). intent=create → створення замовлення, intent=view → перегляд.
import { mountLayout } from '../layout.js';
import { t, getLang } from '../i18n.js';
import { h, icon, params, buildUrl, fmtDateLong, $ } from '../util.js';
import { api, errorText } from '../api.js';
import { loadInto } from '../ui.js';
import { getGroups } from '../drive.js';
import { toast } from '../modal.js';
import { CONFIG } from '../config.js';

mountLayout({ active: 'orders' });

const q = params();
const sad = q.get('sad') || CONFIG.KINDERGARTENS[0];
const intent = q.get('intent') === 'view' ? 'view' : 'create';
document.title = `${sad} — AZART`;

/** Куди вести після натискання «Відкрити». */
async function resolveTarget(album) {
  const page = intent === 'view' ? 'album-orders.html' : 'form.html';
  const direct = buildUrl(page, { album: album.id });
  if (!album.driveFolderId) return direct;
  try {
    const groups = await getGroups(album.driveFolderId);
    if (groups.length > 0) return buildUrl('groups.html', { album: album.id, intent });
  } catch (e) {
    // Не вдалося прочитати Drive: у режимі створення відкриваємо форму (як у Wix).
    if (intent === 'view') throw e;
  }
  return direct;
}

function albumCard(album) {
  const closed = !album.open;
  const blocked = closed && intent === 'create';
  const deadlineText = album.deadline
    ? t(closed ? 'blanks.deadlineClosed' : 'blanks.deadline', { date: fmtDateLong(album.deadline, getLang()) })
    : t('blanks.noDeadline');
  const tip = t(closed ? 'blanks.statusClosed' : 'blanks.statusOpen');
  const btn = h('button', { class: 'btn btn-dark btn-block bcard-open', type: 'button', disabled: blocked }, t('common.open'));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const label = btn.textContent;
    btn.replaceChildren(h('span', { class: 'spin' }));
    try {
      location.href = await resolveTarget(album);
    } catch (e) {
      toast(errorText(e), 'error', 6000);
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  return h('article', { class: 'bcard' },
    h('span', { class: 'bdot ' + (closed ? 'is-closed' : 'is-open'), role: 'img', tabindex: '0', 'aria-label': tip, title: tip }),
    h('h2', { class: 'bcard-title' }, album.title),
    h('div', { class: 'bcard-deadline' }, icon('calendar', 18), h('span', null, deadlineText)),
    btn);
}

const app = $('#app');
const box = h('div', { class: 'blanks' });
app.append(
  h('div', { class: 'container blanks-top' },
    h('a', { class: 'back-link', href: 'orders.html' }, icon('arrowLeft', 18), h('span', null, t('blanks.back'))),
    h('header', { class: 'page-head blanks-head' },
      h('h1', { class: 'page-title' }, sad), h('p', { class: 'page-sub' }, t('blanks.pick')))),
  h('div', { class: 'container blanks-wrap' }, box));

loadInto(box, () => api('listAlbums', { kindergarten: sad }), ({ albums }) => {
  if (!albums.length) {
    box.append(h('p', { class: 'state' }, t('blanks.empty')));
    return;
  }
  box.append(h('div', { class: 'bgrid' }, albums.map(albumCard)));
});
