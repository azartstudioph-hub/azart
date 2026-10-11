// Галерея: вибір фото з папки Google Drive (бланк або група).
// URL: gallery.html?album=ID[&group=FOLDER_ID&groupName=Назва]
// Вибір одразу зберігається в чернетці замовлення (localStorage), форма підхоплює його при поверненні.
import { initTheme } from '../theme.js';
import { t, applyI18n } from '../i18n.js';
import { h, icon, params, buildUrl, $, clamp, store, debounce } from '../util.js';
import { api, ApiError } from '../api.js';
import { getPhotos, thumbUrl, fallbackThumbUrl } from '../drive.js';
import { draftKey, loadDraft, saveDraft, clearSelection } from '../draft.js';
import { openViewer } from '../viewer.js';
import { toast } from '../modal.js';
import { loadingState, errorState } from '../ui.js';

initTheme();

const q = params();
const albumId = q.get('album') || '';
const groupFolderId = q.get('group') || '';
const groupName = q.get('groupName') || '';

const PHOTOS_PER_BATCH = 100;
const GAP = 12;
const PANEL_KEY = 'azartGalleryPanel';
const MOBILE_PANEL_KEY = 'azartGalleryMobilePanel';

const root = $('#app');

async function boot() {
  root.replaceChildren(loadingState(t('gallery.loading')));
  try {
    if (!albumId) throw new Error(t('gallery.noAlbum'));
    const { album } = await api('getAlbum', { id: albumId });
    const folderId = groupFolderId || album.driveFolderId;
    if (!folderId) throw new Error(t('gallery.noFolder'));
    document.title = `${album.title} — AZART`;
    const photos = await getPhotos(folderId);
    start(album, photos);
  } catch (e) {
    const msg = e instanceof ApiError ? e : (e && e.message) || t('err.generic');
    root.replaceChildren(h('div', { class: 'container', style: { paddingTop: '40px' } },
      errorState(msg, boot),
      h('div', { style: { textAlign: 'center', marginTop: '10px' } },
        h('a', { class: 'btn btn-ghost', href: buildUrl('form.html', { album: albumId, group: groupFolderId, groupName }) }, t('gallery.back')))));
  }
}

function start(album, drivePhotos) {
  const key = draftKey(album.id, groupFolderId);
  const mq = window.matchMedia('(max-width:700px)');

  // ---- дані ----------------------------------------------------------------
  const all = drivePhotos.map((p, i) => ({
    id: p.id, name: p.name, thumbnailLink: p.thumbnailLink,
    width: p.width || 800, height: p.height || 600, number: i + 1
  }));
  let filtered = all;
  let shown = Math.min(PHOTOS_PER_BATCH, all.length);

  // вибір: три паралельні масиви (як у чернетці): id, ім'я файлу, мініатюра
  let selIds = [];
  let selNames = [];
  let selThumbs = [];
  const d = loadDraft(key);
  if (d) {
    selIds = Array.isArray(d.photos) ? d.photos.slice() : [];
    selNames = Array.isArray(d.names) ? d.names.slice() : [];
    selThumbs = Array.isArray(d.thumbnails) ? d.thumbnails.slice() : [];
    const n = Math.min(selIds.length, selNames.length);
    selIds.length = selNames.length = n;
    selThumbs.length = n;
  }

  const persistNow = () => {
    saveDraft(key, { photos: selIds, names: selNames, thumbnails: selThumbs, selectedAt: Date.now(), albumId: album.id });
  };
  const persist = debounce(persistNow, 250);
  window.addEventListener('pagehide', persistNow);

  // ---- розмітка ------------------------------------------------------------------
  const grid = h('div', { id: 'photoGrid' });
  const sentinel = h('div', { id: 'sentinel' });
  const noResults = h('div', { class: 'gal-none', hidden: true }, t('gallery.notFound'));
  const emptyMsg = h('div', { class: 'gal-none', hidden: !!all.length }, t('gallery.empty'));
  const scrollArea = h('div', { class: 'gal-scroll', id: 'scrollArea' }, grid, noResults, emptyMsg, sentinel);
  const warning = h('div', { class: 'gal-warning', role: 'status', 'aria-live': 'polite', hidden: true }, t('gallery.warn'));

  const returnHref = (extra) => buildUrl('form.html', { album: album.id, group: groupFolderId, groupName, ...extra });

  const backBtn = h('a', { class: 'gbtn gbtn-back', id: 'back', href: returnHref(), 'data-tip': t('gallery.back'), 'aria-label': t('gallery.back') },
    icon('arrowLeft', 20), h('span', { class: 'lb' }, t('gallery.back')));
  const toggleBtn = h('button', { class: 'gbtn gbtn-tog', id: 'toggle', type: 'button', 'aria-expanded': 'true', 'aria-label': t('gallery.collapse'), title: t('gallery.collapse'), 'data-tip': t('gallery.expand') }, icon('chevronRight', 20));
  const mToggle = h('button', { class: 'gbtn gbtn-ghost gbtn-mtog', id: 'mtoggle', type: 'button', 'aria-expanded': 'false', 'aria-label': t('gallery.panelOpen'), title: t('gallery.panelOpen') }, icon('chevronDown', 20));

  const countNum = h('b', { id: 'n' }, '0');
  const countBox = h('div', { class: 'gcount', id: 'count', 'data-tip': t('gallery.selectedCount') },
    h('small', { class: 'lb' }, h('span', { class: 'full' }, t('gallery.selectedCount')), h('span', { class: 'short' }, t('gallery.selectedShort'))), countNum);

  const selCount = h('small', null, '0');
  const selList = h('div', { class: 'gsel-list' });
  const selBlock = h('div', { class: 'gsel' }, h('div', { class: 'gsel-title' }, h('span', null, t('gallery.selectedTitle')), selCount), selList);

  const search = h('input', { class: 'input gsearch', type: 'search', placeholder: t('gallery.search'), 'aria-label': t('gallery.search'), autocomplete: 'off', inputmode: 'search' });

  const slider = h('input', { type: 'range', id: 'sz', 'aria-label': t('gallery.size') });
  const sizeBlock = h('div', { class: 'gsize' }, h('label', { for: 'sz' }, t('gallery.size')),
    h('div', { class: 'gsize-row' }, h('span', null, t('gallery.small')), slider, h('span', null, t('gallery.large'))));

  const zin = h('button', { class: 'gbtn gbtn-ghost', type: 'button', 'data-tip': t('gallery.zoomIn'), 'aria-label': t('gallery.zoomIn') }, icon('zoomIn', 20));
  const zout = h('button', { class: 'gbtn gbtn-ghost', type: 'button', 'data-tip': t('gallery.zoomOut'), 'aria-label': t('gallery.zoomOut') }, icon('zoomOut', 20));
  const zoomMini = h('div', { class: 'gzoom-mini' }, zin, zout);

  const posIcon = icon('chevronDown', 18);
  const posText = h('span', null, t('gallery.panelBottom'));
  const posBtn = h('button', { class: 'gbtn gbtn-pos', type: 'button' }, posIcon, posText);
  const mobilePos = h('div', { class: 'gmobile-pos' }, posBtn);

  const resetBtn = h('button', { class: 'gbtn gbtn-ghost', id: 'reset', type: 'button', disabled: true, 'data-tip': t('gallery.reset') },
    icon('close', 18), h('span', { class: 'lb' }, t('gallery.reset')));
  const confirmBtn = h('a', { class: 'gbtn gbtn-pri is-disabled', id: 'confirm', href: returnHref({ scrollTo: 'photo' }), 'aria-disabled': 'true', 'data-tip': t('gallery.confirm') },
    icon('check', 18), h('span', { class: 'lb' }, h('span', { class: 'full' }, t('gallery.confirm')), h('span', { class: 'short' }, t('gallery.confirmShort'))));

  const side = h('aside', { class: 'gal-side', id: 'side', 'aria-label': t('gallery.panelLabel') },
    h('div', { class: 'gtop' }, backBtn, toggleBtn, mToggle),
    countBox, selBlock, search, sizeBlock, zoomMini, mobilePos,
    h('div', { class: 'gactions' }, resetBtn, confirmBtn));

  root.replaceChildren(h('div', { class: 'gal' }, scrollArea, side), warning);
  applyI18n(root);

  // ---- картка фото ---------------------------------------------------------------
  const isSel = (id) => selIds.includes(id);

  function openPhoto(photo) {
    const list = filtered;
    const index = Math.max(0, list.findIndex((p) => p.id === photo.id));
    openViewer({
      photos: list, index, selected: selIds, selectable: true,
      onToggle: (id) => { toggleSelection(id); }
    });
  }

  function buildCard(photo, width, height, idx) {
    const on = isSel(photo.id);
    const img = h('img', { alt: photo.name || '', loading: 'lazy', decoding: 'async', tabindex: '0', width: Math.round(width), height: Math.round(height) });
    let tried = false;
    img.addEventListener('error', () => {
      if (!tried) { tried = true; img.src = fallbackThumbUrl(photo, 800); return; }
      warning.hidden = false;
    });
    img.addEventListener('click', () => openPhoto(photo));
    img.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openPhoto(photo); } });
    img.src = thumbUrl(photo, 800);

    const btnSize = clamp(Math.min(width, height) * 0.16, 22, 36);
    const offset = Math.max(6, btnSize * 0.3);
    const btn = h('button', {
      class: 'gsel-btn' + (on ? ' is-on' : ''), type: 'button', dataset: { photoId: photo.id },
      'aria-pressed': on ? 'true' : 'false', 'aria-label': t('gallery.selectPhoto', { name: photo.name || '' }),
      style: { width: btnSize + 'px', height: btnSize + 'px', top: offset + 'px', right: offset + 'px' }
    }, icon('checkBold', 16));
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleSelection(photo.id); });

    return h('div', { class: 'gtile' + (on ? ' is-sel' : ''), dataset: { i: idx }, style: { width: width + 'px', height: height + 'px' } },
      img, h('div', { class: 'gtile-name' }, photo.name), btn);
  }

  // ---- вибір ---------------------------------------------------------------------
  function toggleSelection(id) {
    const i = selIds.indexOf(id);
    if (i !== -1) {
      selIds.splice(i, 1); selNames.splice(i, 1); selThumbs.splice(i, 1);
    } else {
      const p = all.find((x) => x.id === id);
      if (!p) return;
      selIds.push(id); selNames.push(p.name); selThumbs.push(p.thumbnailLink || '');
    }
    updateSelectionUI();
    persist();
  }

  function updateCounter() {
    const n = selIds.length;
    countNum.textContent = String(n);
    countBox.classList.toggle('has', n > 0);
    resetBtn.disabled = n === 0;
    confirmBtn.classList.toggle('is-disabled', n === 0);
    confirmBtn.setAttribute('aria-disabled', n === 0 ? 'true' : 'false');
    selCount.textContent = String(n);
  }

  function updateSelectedList() {
    if (!selIds.length) { selList.replaceChildren(h('div', { class: 'gsel-empty' }, t('gallery.selectedEmpty'))); return; }
    selList.replaceChildren(...selIds.map((id, i) => h('div', { class: 'gsel-item' },
      h('div', { class: 'gsel-num' }, String(i + 1)),
      h('div', { class: 'gsel-name', title: selNames[i] || id }, selNames[i] || id))));
  }

  function updateSelectionUI() {
    grid.querySelectorAll('.gsel-btn').forEach((btn) => {
      const on = isSel(btn.dataset.photoId);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
      const card = btn.closest('.gtile');
      if (card) card.classList.toggle('is-sel', on);
    });
    updateCounter();
    updateSelectedList();
  }

  // ---- кількість фото в ряду ----------------------------------------------------------
  let perRowDesktop = 4;
  let perRowMobile = 2;
  const cfg = () => (mq.matches ? { min: 1, max: 5, sum: 6 } : { min: 2, max: 8, sum: 10 });
  const getPerRow = () => (mq.matches ? perRowMobile : perRowDesktop);

  function syncSlider() {
    const c = cfg();
    slider.min = c.min; slider.max = c.max;
    slider.value = c.sum - getPerRow();
  }
  function setPerRow(n) {
    const c = cfg();
    n = c.sum - clamp(c.sum - n, c.min, c.max);
    if (mq.matches) perRowMobile = n; else perRowDesktop = n;
    syncSlider();
  }
  const effectivePerRow = (w) => Math.max(1, Math.min(getPerRow(), Math.floor(w / 60)));

  // ---- малювання рядів однакової висоти -----------------------------------------------
  let lastRow = null;
  let renderStart = 0;
  let lastW = 0;
  const visible = () => filtered.slice(0, shown);

  function renderJustified(full) {
    const data = visible();
    lastW = scrollArea.clientWidth;
    const containerWidth = lastW - (mq.matches ? 16 : 20);
    const perRow = effectivePerRow(containerWidth);
    const gap = mq.matches ? (lastW < 420 ? 6 : 8) : GAP;

    if (full) {
      grid.replaceChildren();
      renderStart = 0;
      lastRow = null;
    } else if (lastRow) {
      grid.removeChild(lastRow);
      lastRow = null;
    }

    for (let i = renderStart; i < data.length; i += perRow) {
      const rowPhotos = data.slice(i, i + perRow);
      const isLast = (i + perRow) >= data.length;
      const available = containerWidth - gap * (rowPhotos.length - 1);
      const aspectSum = rowPhotos.reduce((s, p) => s + p.width / p.height, 0);
      let rowHeight = available / aspectSum;
      if (isLast && rowPhotos.length < perRow) rowHeight = Math.min(rowHeight, containerWidth / perRow);

      const rowEl = h('div', { class: 'gal-row', style: { gap: gap + 'px', marginBottom: gap + 'px' } });
      rowPhotos.forEach((photo, k) => rowEl.append(buildCard(photo, (photo.width / photo.height) * rowHeight, rowHeight, i + k)));
      grid.append(rowEl);
      lastRow = rowEl;
      renderStart = i;
    }
  }

  /** Перемальовує, зберігаючи те саме фото на тому самому місці. */
  function renderPreservingPosition() {
    const areaRect = scrollArea.getBoundingClientRect();
    const anchor = [...grid.querySelectorAll('.gtile')]
      .map((card) => ({ card, rect: card.getBoundingClientRect() }))
      .filter((it) => it.rect.bottom > areaRect.top && it.rect.top < areaRect.bottom)
      .sort((a, b) => Math.abs(a.rect.top - areaRect.top) - Math.abs(b.rect.top - areaRect.top))[0];
    const idx = anchor ? anchor.card.dataset.i : null;
    const offset = anchor ? anchor.rect.top - areaRect.top : 0;
    renderJustified(true);
    if (idx != null) {
      const card = grid.querySelector(`.gtile[data-i="${idx}"]`);
      if (card) scrollArea.scrollTop += card.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top - offset;
    }
  }

  function anchorRender(cx, cy) {
    const el = document.elementFromPoint(cx, cy);
    const card = el && el.closest ? el.closest('.gtile') : null;
    const idx = card ? card.dataset.i : null;
    const before = card ? card.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top : 0;
    renderJustified(true);
    if (idx != null) {
      const next = grid.querySelector(`.gtile[data-i="${idx}"]`);
      if (next) scrollArea.scrollTop += next.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top - before;
    } else renderPreservingPosition();
  }

  let resizeTimer;
  new ResizeObserver(() => {
    if (Math.abs(scrollArea.clientWidth - lastW) < 2) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderPreservingPosition, 120);
  }).observe(scrollArea);

  const onMode = () => { syncSlider(); renderPreservingPosition(); };
  if (mq.addEventListener) mq.addEventListener('change', onMode); else mq.addListener(onMode);

  // догрузка наступних 100 при прокрутці
  new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting || shown >= filtered.length) return;
      shown = Math.min(shown + PHOTOS_PER_BATCH, filtered.length);
      renderJustified(false);
    });
  }, { root: scrollArea, threshold: 0.1 }).observe(sentinel);

  // ---- пошук -------------------------------------------------------------------
  search.addEventListener('input', debounce(() => {
    const text = search.value.trim().toLowerCase();
    filtered = text ? all.filter((p) => p.name.toLowerCase().includes(text)) : all;
    shown = Math.min(PHOTOS_PER_BATCH, filtered.length);
    noResults.hidden = !(text && !filtered.length);
    scrollArea.scrollTop = 0;
    renderJustified(true);
  }, 200));

  // ---- кнопки та повзунок ----------------------------------------------------------
  resetBtn.addEventListener('click', () => {
    selIds = []; selNames = []; selThumbs = [];
    clearSelection(key);
    updateSelectionUI();
    toast(t('gallery.resetDone'));
  });
  confirmBtn.addEventListener('click', (e) => {
    if (!selIds.length) { e.preventDefault(); return; }
    persistNow();
  });
  backBtn.addEventListener('click', persistNow);

  slider.addEventListener('input', () => { setPerRow(cfg().sum - Number(slider.value)); renderPreservingPosition(); });
  zin.addEventListener('click', () => { setPerRow(getPerRow() - 1); renderPreservingPosition(); });
  zout.addEventListener('click', () => { setPerRow(getPerRow() + 1); renderPreservingPosition(); });
  syncSlider();

  // ---- два пальці: розмір галереї ---------------------------------------------------
  let pinch = null;
  const dist = (tt) => Math.hypot(tt[0].clientX - tt[1].clientX, tt[0].clientY - tt[1].clientY);
  scrollArea.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    pinch = { d0: dist(e.touches) || 1, start: getPerRow(), cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
  }, { passive: true });
  scrollArea.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const target = Math.round(pinch.start * pinch.d0 / dist(e.touches));
    const before = getPerRow();
    setPerRow(target);
    if (getPerRow() !== before) { anchorRender(pinch.cx, pinch.cy); toast(t('gallery.perRow', { n: getPerRow() }), 'info', 900); }
  }, { passive: false });
  const endPinch = (e) => { if (e.touches.length < 2) pinch = null; };
  scrollArea.addEventListener('touchend', endPinch, { passive: true });
  scrollArea.addEventListener('touchcancel', endPinch, { passive: true });

  // ---- звуження панелі (комп'ютер) ----------------------------------------------------
  function setCollapsed(c) {
    side.classList.toggle('is-collapsed', c);
    toggleBtn.setAttribute('aria-expanded', String(!c));
    toggleBtn.setAttribute('aria-label', c ? t('gallery.expand') : t('gallery.collapse'));
    toggleBtn.title = c ? t('gallery.expand') : t('gallery.collapse');
    store.set(PANEL_KEY, c ? '1' : '0');
  }
  toggleBtn.addEventListener('click', () => setCollapsed(!side.classList.contains('is-collapsed')));
  if (store.get(PANEL_KEY) === '1') setCollapsed(true);

  // ---- телефон: відкрити/згорнути панель, панель зверху/знизу ------------------------------
  function setOpen(open) {
    side.classList.toggle('is-open', open);
    mToggle.setAttribute('aria-expanded', String(open));
    mToggle.setAttribute('aria-label', open ? t('gallery.panelClose') : t('gallery.panelOpen'));
    mToggle.title = open ? t('gallery.panelClose') : t('gallery.panelOpen');
  }
  mToggle.addEventListener('click', () => setOpen(!side.classList.contains('is-open')));
  countBox.addEventListener('click', () => { if (mq.matches) setOpen(!side.classList.contains('is-open')); });

  function setBottom(bottom) {
    document.body.classList.toggle('panel-bottom', bottom);
    posIcon.querySelector('path').setAttribute('d', bottom ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6');
    posText.textContent = bottom ? t('gallery.panelTop') : t('gallery.panelBottom');
    store.set(MOBILE_PANEL_KEY, bottom ? 'bottom' : 'top');
  }
  posBtn.addEventListener('click', () => setBottom(!document.body.classList.contains('panel-bottom')));
  setBottom(store.get(MOBILE_PANEL_KEY) === 'bottom');

  // ---- запуск ------------------------------------------------------------------------------
  renderJustified(true);
  updateCounter();
  updateSelectedList();
  // фото лише тепер мають розмір → якщо смуга прокрутки змінила ширину, перемалюємо
  requestAnimationFrame(() => { if (Math.abs(scrollArea.clientWidth - lastW) >= 2) renderJustified(true); });
}

boot();
