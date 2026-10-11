// Вибір групи. intent: create (створення замовлення), view (перегляд), admin (керування, фото груп).
import { mountLayout } from '../layout.js';
import { t } from '../i18n.js';
import { h, icon, params, buildUrl, $ } from '../util.js';
import { api, errorText, isAdminLoggedIn } from '../api.js';
import { loadInto } from '../ui.js';
import { getGroups } from '../drive.js';
import { toast } from '../modal.js';
import { CONFIG } from '../config.js';
import { compareGroups, groupKey, cleanGroupName } from '../domain.js';
import { fileToJpegBase64 } from '../image.js';

mountLayout({ active: null });

const q = params();
const albumId = q.get('album') || '';
const wanted = q.get('intent');
const intent = wanted === 'view' ? 'view' : wanted === 'admin' ? 'admin' : 'create';
const admin = intent === 'admin' && isAdminLoggedIn();

const app = $('#app');
const head = h('header', { class: 'page-head groups-head' }, h('h1', { class: 'page-title' }, '…'), h('p', { class: 'page-sub' }, t('groups.pick')));
const toolbar = h('div', { class: 'groups-tools' });
const box = h('div', { class: 'groups-box' });
const backHref = intent === 'admin' ? 'admin.html' : 'orders.html';
app.append(h('div', { class: 'container groups-wrap' },
  h('a', { class: 'back-link', href: backHref }, icon('arrowLeft', 18), h('span', null, t('blanks.back'))),
  head, toolbar, box));

function openUrl(album, g) {
  const page = intent === 'create' ? 'form.html' : 'album-orders.html';
  return buildUrl(page, { album: album.id, group: g.id, groupName: g.name });
}

function groupCard(album, g, photos, counts, state) {
  const key = groupKey(g.name);
  const img = h('img', { class: 'gcard-img', alt: g.name, loading: 'lazy', hidden: !photos[key] });
  if (photos[key]) img.src = photos[key];
  const placeholder = admin ? h('div', { class: 'gcard-img gcard-empty', hidden: !!photos[key] }, icon('image', 28), h('span', null, t('groups.noPhoto'))) : null;
  const count = h('div', { class: 'gcard-count' }, t('groups.orders', { n: counts[g.id] === undefined ? 0 : counts[g.id] }));

  let upload = null;
  if (admin) {
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', tabindex: '-1' });
    const label = h('span', null, t('groups.upload'));
    const btn = h('button', { class: 'gcard-upload', type: 'button' }, icon('plus', 15), label);
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast(t('groups.badFile'), 'error'); return; }
      btn.disabled = true;
      label.textContent = t('groups.uploading');
      try {
        const data = await fileToJpegBase64(file);
        const r = await api('uploadGroupPhoto', { kindergarten: album.kindergarten, groupName: cleanGroupName(g.name), data }, { timeout: 90000, retries: 0 });
        photos[key] = r.photoUrl;
        img.src = r.photoUrl; img.hidden = false;
        if (placeholder) placeholder.hidden = true;
        toast(t('groups.uploaded'), 'success');
      } catch (e) {
        toast(e && e.message === 'BAD_TYPE' ? t('groups.badFile') : errorText(e), 'error', 6000);
      } finally {
        btn.disabled = false;
        label.textContent = t('groups.upload');
      }
    });
    upload = [btn, input];
  }

  return h('article', { class: 'gcard' },
    h('div', { class: 'gcard-top' }, h('h2', { class: 'gcard-title' }, g.name), upload),
    admin ? h('div', { class: 'gcard-media' }, img, placeholder) : (photos[key] ? h('div', { class: 'gcard-media' }, img) : null),
    h('a', { class: 'btn btn-primary btn-block gcard-open', href: openUrl(album, g) }, t('common.open')),
    count);
}

async function load() {
  if (!albumId) throw new Error(t('groups.noAlbum'));
  const { album } = await api('getAlbum', { id: albumId });
  if (!album.driveFolderId) return { album, groups: [], photos: {}, counts: {} };
  const [groups, lib, cnt] = await Promise.all([
    getGroups(album.driveFolderId, { fresh: true }),
    api('listGroupPhotos', { kindergarten: album.kindergarten }).catch(() => ({ photos: {} })),
    api('groupOrderCounts', { albumId }).catch(() => ({ counts: {} }))
  ]);
  return { album, groups, photos: lib.photos || {}, counts: cnt.counts || {} };
}

loadInto(box, load, ({ album, groups, photos, counts }) => {
  head.querySelector('h1').textContent = album.title;
  document.title = `${album.title} — AZART`;
  if (intent === 'admin' && !admin) {
    box.append(h('div', { class: 'note note-warn' }, icon('lock', 20),
      h('div', null, t('groups.needLogin') + ' ', h('a', { href: 'admin.html', style: { fontWeight: 600 } }, t('groups.toAdmin')))));
    return;
  }
  if (admin) {
    toolbar.append(h('a', { class: 'btn btn-ghost btn-sm', href: buildUrl(CONFIG.SORTER_URL, { albumId: album.id }), target: '_blank', rel: 'noopener' }, t('groups.sorter')));
  }
  if (!groups.length) {
    box.append(h('div', { class: 'state' },
      h('p', null, t('groups.none')),
      h('a', { class: 'btn btn-primary', style: { marginTop: '16px' }, href: intent === 'create' ? buildUrl('form.html', { album: album.id }) : buildUrl('album-orders.html', { album: album.id }) }, t('common.open'))));
    return;
  }
  const sorted = [...groups].sort((a, b) => compareGroups(a.name, b.name));
  box.append(h('div', { class: 'ggrid' }, sorted.map((g) => groupCard(album, g, photos, counts))));
});
