// Сторінка адміністратора: вхід за паролем і список бланків («Ваші бланки»).
import { mountLayout } from '../layout.js';
import { t, plural, getLang } from '../i18n.js';
import { h, icon, buildUrl, fmtDateLong, $ } from '../util.js';
import { api, errorText, logout, isAdminLoggedIn, ApiError } from '../api.js';
import { mountGoogleLogin } from '../google-login.js';
import { loadingState, errorState } from '../ui.js';
import { getGroups } from '../drive.js';
import { toast, confirmDialog } from '../modal.js';
import { openBlankModal } from '../admin/blank-modal.js';
import { openPricesModal } from '../admin/prices-modal.js';
import { openSettingsModal } from '../admin/settings-modal.js';

mountLayout({ active: null });
document.title = t('admin.title') + ' — AZART';

const app = $('#app');
const root = h('div', { class: 'container adm-wrap' });
app.append(root);

// ------------------------------------------------------------------ вхід (через Google)
function showLogin() {
  const host = h('div', { class: 'adm-google' });
  const card = h('div', { class: 'adm-login' },
    h('span', { class: 'adm-lock' }, icon('lock', 26)),
    h('h1', { class: 'adm-login-title' }, t('admin.loginTitle')),
    h('p', { class: 'adm-login-sub' }, t('admin.loginSubGoogle')),
    host,
    h('a', { class: 'adm-home', href: 'index.html' }, t('admin.backHome')));
  root.replaceChildren(h('div', { class: 'adm-login-wrap' }, card));
  mountGoogleLogin(host, { onSuccess: boot });
}

// ------------------------------------------------------------------ панель
async function openAlbum(album, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spin' }));
  try {
    let target = buildUrl('album-orders.html', { album: album.id });
    if (album.driveFolderId) {
      try {
        const groups = await getGroups(album.driveFolderId, { fresh: true });
        if (groups.length) target = buildUrl('groups.html', { album: album.id, intent: 'admin' });
      } catch (e) {
        toast(t('admin.driveWarn'), 'warn', 5000);
        await new Promise((r) => setTimeout(r, 900));
      }
    }
    location.href = target;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function deadlineLine(album) {
  if (!album.deadline) return h('span', { class: 'adm-dl' }, t('admin.noDeadline'));
  const date = fmtDateLong(album.deadline, getLang());
  return h('span', { class: 'adm-dl ' + (album.open ? 'is-open' : 'is-closed') },
    h('i', { class: 'adm-dot', 'aria-hidden': 'true' }), t(album.open ? 'admin.deadlineOpen' : 'admin.deadlineClosed', { date }));
}

function dashboard(data) {
  let { albums } = data;
  let prices = data.prices;

  const summary = h('p', { class: 'adm-summary' });
  const grid = h('div', { class: 'adm-grid' });
  const empty = h('p', { class: 'state', hidden: true }, t('admin.none'));

  function paintSummary() {
    const orders = albums.reduce((s, a) => s + a.orderCount, 0);
    summary.replaceChildren(
      h('b', null, plural('admin.albums', albums.length)), ` ${t('admin.and')} `,
      h('b', null, plural('admin.orders', orders)), ` ${t('admin.total')}`);
  }

  function card(album) {
    const openBtn = h('button', { class: 'btn btn-primary adm-open', type: 'button' }, t('common.open'));
    openBtn.addEventListener('click', () => openAlbum(album, openBtn));
    const editBtn = h('button', { class: 'adm-ib', type: 'button', title: t('admin.edit'), 'aria-label': t('admin.edit') }, icon('gear', 20));
    const delBtn = h('button', { class: 'adm-ib adm-ib-del', type: 'button', title: t('admin.delete'), 'aria-label': t('admin.delete') }, icon('trash', 20));
    editBtn.addEventListener('click', async () => {
      const saved = await openBlankModal({ album, prices });
      if (saved) {
        Object.assign(album, saved);
        toast(t('admin.saved'), 'success');
        paintGrid();
      }
    });
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: t('admin.deleteTitle'), text: t('admin.deleteText', { title: album.title }),
        confirmText: t('common.delete'), danger: true
      });
      if (!ok) return;
      delBtn.disabled = true;
      try {
        await api('deleteAlbum', { id: album.id }, { retries: 0, timeout: 90000 });
        albums = albums.filter((a) => a.id !== album.id);
        toast(t('admin.deleted'), 'success');
        paintGrid();
        paintSummary();
      } catch (e) {
        delBtn.disabled = false;
        toast(errorText(e), 'error', 6000);
      }
    });
    return h('article', { class: 'adm-card' },
      h('h2', { class: 'adm-card-title' }, `${album.title}${album.kindergarten ? ` (${album.kindergarten})` : ''}`),
      deadlineLine(album),
      h('div', { class: 'adm-count' }, String(album.orderCount)),
      h('div', { class: 'adm-count-label' }, plural('admin.orderWord', album.orderCount)),
      h('div', { class: 'adm-actions' }, openBtn, editBtn, delBtn));
  }

  function paintGrid() {
    grid.replaceChildren(...albums.map(card));
    empty.hidden = albums.length > 0;
  }

  const pricesBtn = h('button', { class: 'btn btn-primary adm-top-btn', type: 'button' }, icon('gear', 18), h('span', null, t('admin.prices')));
  pricesBtn.addEventListener('click', async () => {
    const saved = await openPricesModal(prices);
    if (saved) prices = saved;
  });
  const createBtn = h('button', { class: 'btn btn-primary adm-top-btn', type: 'button' }, icon('plus', 18), h('span', null, t('admin.create')));
  createBtn.addEventListener('click', async () => {
    const created = await openBlankModal({ album: null, prices });
    if (created) {
      albums = [{ ...created, orderCount: 0 }, ...albums];
      toast(t('admin.saved'), 'success');
      paintGrid();
      paintSummary();
    }
  });
  const settingsBtn = h('button', { class: 'adm-link', type: 'button' }, t('admin.settings'));
  settingsBtn.addEventListener('click', () => openSettingsModal());
  const importLink = h('a', { class: 'adm-link', href: 'import.html' }, icon('upload', 16), h('span', null, t('imp.link')));
  const outBtn = h('button', { class: 'adm-link', type: 'button' }, icon('logout', 16), h('span', null, t('admin.logout')));
  outBtn.addEventListener('click', () => { logout(); location.reload(); });

  paintSummary();
  paintGrid();
  root.replaceChildren(
    h('div', { class: 'adm-top' },
      h('div', null, h('h1', { class: 'adm-title' }, t('admin.title')), summary),
      h('div', { class: 'adm-top-actions' }, pricesBtn, createBtn)),
    h('div', { class: 'adm-sub' }, settingsBtn, importLink, outBtn),
    grid, empty);
}

async function load() {
  const [overview, p] = await Promise.all([api('adminOverview'), api('getPrices')]);
  return { albums: overview.albums, prices: p.prices };
}

async function boot() {
  if (!isAdminLoggedIn()) { showLogin(); return; }
  root.replaceChildren(loadingState());
  try {
    dashboard(await load());
  } catch (e) {
    // сервер відхилив токен (застарів / змінено пароль) — api() вже очистив його
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') { showLogin(); return; }
    root.replaceChildren(errorState(e, boot));
  }
}

boot();
