// Форма замовлення (звичайні бланки та портретні з «Вся фотосесія»).
// URL: form.html?album=ID[&group=FOLDER_ID&groupName=Назва][&scrollTo=photo]
import { mountBareLayout } from '../layout.js';
import { t, getLang, tv } from '../i18n.js';
import { h, icon, params, buildUrl, $, debounce, uid, fmtDateLong } from '../util.js';
import { api, errorText, requestId, ApiError, isAdminLoggedIn } from '../api.js';
import { loadingState, errorState } from '../ui.js';
import { toast, openModal, confirmDialog } from '../modal.js';
import { FORMAT_DIGITAL, TYPE_PORTRAIT, groupKey, cleanGroupName, isPortraitAlbum, normSize } from '../domain.js';
import { calcOrder, formatMoney } from '../pricing.js';
import { draftKey, loadDraft, saveDraft, clearDraft, clearSelection, removeFromSelection } from '../draft.js';
import { createRowsEditor } from '../rows.js';
import { openViewer } from '../viewer.js';

const q = params();
const albumId = q.get('album') || '';
const groupFolderId = q.get('group') || '';
const groupName = cleanGroupName(q.get('groupName') || '');

const { titleEl } = mountBareLayout({ backHref: 'index.html', backKey: 'form.home', title: '' });
const app = $('#app');

// Повернення кнопкою «Назад» браузера може віддати стару копію сторінки — перечитуємо чернетку.
window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

async function boot() {
  app.replaceChildren(h('div', { class: 'container' }, loadingState()));
  try {
    if (!albumId) throw new Error(t('form.noAlbum'));
    const [{ album }, { prices }] = await Promise.all([api('getAlbum', { id: albumId }), api('getPrices')]);
    start(album, prices);
  } catch (e) {
    const msg = e instanceof ApiError ? e : (e && e.message) || t('err.generic');
    app.replaceChildren(h('div', { class: 'container' }, errorState(msg, boot)));
  }
}

function start(album, prices) {
  const portrait = isPortraitAlbum(album);
  const key = draftKey(album.id, groupFolderId);
  const defaultType = portrait ? TYPE_PORTRAIT : (album.types.length === 1 ? album.types[0] : '');
  const sessionAvailable = portrait && Number(prices.portretSessionPrice) > 0;
  const closed = !album.open && !isAdminLoggedIn();
  const gk = groupKey(groupName);
  const ranges = (album.typeRanges || [])
    .map((r) => ({ gk: groupKey(r.group), from: Number(r.from), to: Number(r.to), type: r.type }))
    .filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to) && album.types.includes(r.type));

  document.title = `${album.title} — AZART`;
  titleEl.textContent = album.title;

  let items = [];
  let fullSession = false;
  let validation = false;
  let highlight = [];
  let reqId = null;
  let submitting = false;

  // ---- рядки: допоміжні --------------------------------------------------
  const newRow = (extra = {}) => ({
    id: uid(), count: 1, photoNumber: '', photoId: '', photoThumbnail: '', photoType: defaultType,
    photoSize: '', photoFormat: '', price: 0, ...extra
  });

  const isEmpty = (it) => !it.photoNumber && !it.photoSize && !it.photoFormat && (!it.photoType || it.photoType === defaultType);

  const isValid = (it) => !!it.photoNumber && !!it.photoType && !!it.photoFormat && (it.photoFormat === FORMAT_DIGITAL || !!it.photoSize);

  /** Тип за номером фото: перше число в імені файлу проти діапазонів поточної групи. */
  function detectType(name) {
    const m = String(name || '').match(/(\d+)/);
    if (!m) return null;
    const n = Number(m[1]);
    const r = ranges.find((x) => x.gk === gk && n >= x.from && n <= x.to);
    return r ? r.type : null;
  }

  function normalizeRow(raw) {
    const name = typeof raw.photoNumber === 'string' ? raw.photoNumber : '';
    const type = raw.photoType && album.types.includes(raw.photoType) ? raw.photoType : (detectType(name) || defaultType);
    const size = normSize(raw.photoSize);
    const format = album.formats.includes(raw.photoFormat) ? raw.photoFormat : '';
    return {
      id: String(raw._id || raw.id || uid()),
      count: Math.min(10, Math.max(1, Number(raw.count) || 1)),
      photoNumber: name,
      photoId: typeof raw.photoId === 'string' ? raw.photoId : '',
      photoThumbnail: typeof raw.photoThumbnail === 'string' ? raw.photoThumbnail : '',
      photoType: type,
      photoSize: album.sizes.includes(size) ? size : '',
      photoFormat: format,
      price: 0
    };
  }

  // ---- розмітка -----------------------------------------------------------
  const nameInput = h('input', { class: 'input', id: 'customerName', name: 'name', type: 'text', autocomplete: 'name', maxlength: '120', placeholder: t('form.namePh') });
  const phoneInput = h('input', { class: 'input', id: 'customerPhone', name: 'tel', type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: '30', placeholder: t('form.phonePh') });
  const nameErr = h('div', { class: 'field-error', hidden: true });
  const phoneErr = h('div', { class: 'field-error', hidden: true });
  const commentInput = h('textarea', { class: 'textarea', id: 'orderComment', name: 'comment', maxlength: '1000', placeholder: t('form.commentPh'), 'aria-label': t('form.commentTitle') });

  const sumRows = h('b', null, '0');
  const sumPhotos = h('b', null, '0');
  const sumTotal = h('span', { class: 'fsum-total-val' }, '0 ' + t('common.currency'));
  const discountText = h('div');
  const discountBox = h('div', { class: 'note fdiscount', role: 'status', hidden: true }, icon('gift', 20), discountText);
  const submitLabel = h('span', null, t('form.submit'));
  const submitBtn = h('button', { class: 'btn btn-primary btn-lg btn-block fsubmit', type: 'button', disabled: closed }, submitLabel);

  const rows = createRowsEditor({
    onField, onRemove: removeRow, onCopy: copyRow, onOpenPhoto: openPhoto,
    onDeleteAll: deleteAll,
    onHowTo: () => openHowTo(portrait),
    onFullSession: (v) => { fullSession = !!v; changed(); }
  });

  const steps = ['form.step1', 'form.step2', 'form.step3', 'form.step4'];
  const stepsCard = h('ol', { class: 'fcard fsteps' },
    steps.map((k, i) => h('li', { class: 'fstep' }, h('span', { class: 'fstep-n' }, String(i + 1)), h('span', null, t(k)))));

  const dataCard = h('section', { class: 'fcard fdata', id: 'Form' },
    h('h2', null, t('form.dataTitle')),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'customerName' }, t('form.nameLabel')), nameInput, nameErr),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'customerPhone' }, t('form.phoneLabel')), phoneInput, phoneErr),
    album.deadline ? h('div', { class: 'fchip' }, icon('calendar', 20), h('span', null, t('form.deadline', { date: fmtDateLong(album.deadline, getLang()) }))) : null);

  const toGalleryBtn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: goGallery }, t('form.toGallery'));

  const side = h('aside', { class: 'fside' },
    h('section', { class: 'fcard fcomment' }, h('h2', null, t('form.commentTitle')), commentInput),
    h('section', { class: 'fcard fsum' },
      h('div', { class: 'fsum-row' }, h('span', null, t('form.sumRows')), sumRows),
      h('div', { class: 'fsum-row' }, h('span', null, t('form.sumPhotos')), sumPhotos),
      h('div', { class: 'fsum-line' }),
      h('div', { class: 'fsum-total' }, h('span', null, t('form.sumTotal')), sumTotal)),
    discountBox,
    closed ? h('div', { class: 'note note-warn' }, icon('info', 20), h('div', null, t('form.closed'))) : null,
    submitBtn);

  const photoSection = h('section', { class: 'fmain', id: 'Photo' }, h('div', { class: 'fcard frows' }, rows.el), side);

  app.replaceChildren(h('div', { class: 'container form-wrap' },
    h('section', { class: 'ftop' }, stepsCard, h('div', { class: 'fright' }, dataCard, toGalleryBtn)),
    h('hr', { class: 'form-rule' }),
    photoSection));

  // ---- відновлення чернетки ---------------------------------------------------
  function restore() {
    const d = loadDraft(key);
    let list = [];
    if (d) {
      nameInput.value = d.customerName || '';
      phoneInput.value = d.phoneNumber || '';
      commentInput.value = d.comment || '';
      fullSession = !!d.isFullSession && sessionAvailable;

      list = (Array.isArray(d.orderItems) ? d.orderItems : []).map(normalizeRow).filter((r) => !isEmpty(r));
      const names = Array.isArray(d.names) ? d.names : [];
      const thumbs = Array.isArray(d.thumbnails) ? d.thumbnails : [];
      const ids = Array.isArray(d.photos) ? d.photos : [];

      // Якщо вибір у галереї вже зберігався, зняте там фото зникає й тут.
      if (d.selectedAt) list = list.filter((r) => !r.photoNumber || names.includes(r.photoNumber));

      list.forEach((r) => {
        const i = names.indexOf(r.photoNumber);
        if (i < 0) return;
        if (thumbs[i]) r.photoThumbnail = thumbs[i];
        if (ids[i]) r.photoId = ids[i];
      });

      const have = new Set(list.map((r) => r.photoNumber).filter(Boolean));
      names.forEach((name, i) => {
        if (!name || have.has(name)) return;
        have.add(name);
        const r = newRow({ photoNumber: name, photoThumbnail: thumbs[i] || '', photoId: ids[i] || '', photoType: detectType(name) || defaultType });
        list.push(r);
        highlight.push(r.id);
      });
    }
    items = list.length ? list : [newRow()];
  }

  // ---- розрахунок і малювання --------------------------------------------------
  function calc() {
    const filled = items.filter((i) => !isEmpty(i));
    const res = calcOrder(prices, album, filled.map((i) => ({
      photoNumber: i.photoNumber, photoType: i.photoType,
      photoSize: i.photoFormat === FORMAT_DIGITAL ? '' : i.photoSize,
      photoFormat: i.photoFormat, count: i.count
    })), fullSession && sessionAvailable);
    items.forEach((i) => { i.price = 0; });
    filled.forEach((it, idx) => { it.price = res.items[idx].price; });
    return { res, filled };
  }

  function rowsPayload(res) {
    return {
      items: items.map((it, i) => {
        const showErr = validation && !isEmpty(it);
        const digital = it.photoFormat === FORMAT_DIGITAL;
        return {
          id: it.id, rowNumber: i + 1, photoNumber: it.photoNumber, photoThumbnail: it.photoThumbnail, photoId: it.photoId,
          count: it.count, photoSize: it.photoSize, photoFormat: it.photoFormat, photoType: it.photoType, price: it.price,
          disableCount: digital, disableSize: digital,
          typeLocked: !!(it.photoNumber && it.photoType && detectType(it.photoNumber) === it.photoType),
          sizeError: showErr && !digital && !it.photoSize,
          formatError: showErr && !it.photoFormat,
          typeError: showErr && !portrait && !it.photoType,
          photoError: showErr && !it.photoNumber
        };
      }),
      types: album.types, sizes: album.sizes, formats: album.formats,
      showTypeDropdown: !portrait,
      hidePrices: res.fullSession,
      session: { available: sessionAvailable, on: fullSession, price: Number(prices.portretSessionPrice) || 0 },
      hasPhotos: items.some((i) => !!i.photoNumber),
      howToKey: portrait ? 'form.howToSession' : 'form.howTo',
      highlightIds: highlight
    };
  }

  function refresh() {
    const { res, filled } = calc();
    sumRows.textContent = String(filled.length);
    sumPhotos.textContent = String(res.totalPhotos);
    sumTotal.textContent = `${formatMoney(res.total)} ${t('common.currency')}`;

    const msgs = [];
    if (!res.fullSession) {
      if (res.gift) msgs.push(t('form.gift'));
      if (res.percent > 0) msgs.push(t('form.percent', { n: res.percent }));
    }
    discountBox.hidden = !msgs.length;
    discountText.replaceChildren(...msgs.map((m) => h('div', null, m)));

    rows.setData(rowsPayload(res));
    highlight = [];
  }

  const persistNow = () => {
    saveDraft(key, {
      customerName: nameInput.value, phoneNumber: phoneInput.value, comment: commentInput.value,
      orderItems: items.map((i) => ({ _id: i.id, count: i.count, photoNumber: i.photoNumber, photoId: i.photoId, photoThumbnail: i.photoThumbnail, photoType: i.photoType, photoSize: i.photoSize, photoFormat: i.photoFormat })),
      isFullSession: fullSession, albumId: album.id
    });
  };
  const persist = debounce(persistNow, 250);

  /** Будь-яка зміна замовлення: нова спроба відправки отримає новий requestId. */
  function changed() {
    reqId = null;
    refresh();
    persist();
  }

  // ---- дії над рядками -------------------------------------------------------
  function applyToAll(field, value) {
    items.forEach((it) => {
      if (isEmpty(it)) return;
      if (field === 'size') {
        if (it.photoFormat !== FORMAT_DIGITAL) it.photoSize = value;
      } else {
        it.photoFormat = value;
        if (value === FORMAT_DIGITAL) { it.count = 1; it.photoSize = ''; }
      }
    });
  }

  function onField(rowId, field, value, all) {
    const it = items.find((i) => i.id === rowId);
    if (!it) return;
    if (field === 'count') it.count = Math.min(10, Math.max(1, Number(value) || 1));
    else if (field === 'size') it.photoSize = value;
    else if (field === 'type') it.photoType = value;
    else if (field === 'format') {
      it.photoFormat = value;
      if (value === FORMAT_DIGITAL) { it.count = 1; it.photoSize = ''; }
    }
    if (all && (field === 'size' || field === 'format')) applyToAll(field, value);
    changed();
  }

  function removeRow(rowId) {
    const it = items.find((i) => i.id === rowId);
    if (!it) return;
    const name = it.photoNumber;
    if (items.length === 1) {
      Object.assign(it, { photoNumber: '', photoId: '', photoThumbnail: '', photoType: defaultType, photoSize: '', photoFormat: '', count: 1, price: 0 });
    } else {
      items = items.filter((i) => i.id !== rowId);
    }
    // Фото, якого більше немає в жодному рядку, знімаємо з вибору в галереї.
    if (name && !items.some((i) => i.photoNumber === name)) removeFromSelection(key, name);
    changed();
  }

  function copyRow(rowId) {
    const i = items.findIndex((x) => x.id === rowId);
    if (i < 0) return;
    const copy = { ...items[i], id: uid() };
    items.splice(i + 1, 0, copy);
    highlight.push(copy.id);
    changed();
  }

  async function deleteAll() {
    const ok = await confirmDialog({ title: t('form.deleteAllTitle'), text: t('form.deleteAllText'), confirmText: t('form.remove'), danger: true });
    if (!ok) return;
    items = [newRow()];
    validation = false;
    clearSelection(key);
    changed();
  }

  function openPhoto(rowId) {
    const it = items.find((i) => i.id === rowId);
    if (!it || (!it.photoThumbnail && !it.photoId)) return;
    openViewer({ photos: [{ id: it.photoId || it.id, name: it.photoNumber, thumbnailLink: it.photoThumbnail }], selectable: false });
  }

  function goGallery() {
    persistNow();
    location.href = buildUrl('gallery.html', { album: album.id, group: groupFolderId, groupName });
  }

  // ---- поля клієнта ----------------------------------------------------------------
  function setFieldError(input, errEl, message) {
    input.classList.toggle('is-invalid', !!message);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    errEl.hidden = !message;
    errEl.textContent = message || '';
  }

  const phoneOk = (v) => {
    const s = v.trim();
    const digits = s.replace(/\D/g, '');
    return /^[0-9+()\-.\s]+$/.test(s) && digits.length >= 7 && digits.length <= 15;
  };

  nameInput.addEventListener('input', () => { setFieldError(nameInput, nameErr, ''); reqId = null; persist(); });
  phoneInput.addEventListener('input', () => { setFieldError(phoneInput, phoneErr, ''); reqId = null; persist(); });
  commentInput.addEventListener('input', () => { reqId = null; persist(); });

  // ---- відправка ------------------------------------------------------------------
  function setSubmitting(on) {
    submitting = on;
    submitBtn.disabled = on || closed;
    submitBtn.replaceChildren(on ? h('span', { class: 'spin' }) : submitLabel);
  }

  function scrollToEl(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submit() {
    if (submitting || closed) return;
    const { res, filled } = calc();
    const rowsInvalid = !filled.length || filled.some((i) => !isValid(i));
    const name = nameInput.value.replace(/\s+/g, ' ').trim();
    const phone = phoneInput.value.trim();

    validation = rowsInvalid;
    refresh();

    setFieldError(nameInput, nameErr, name ? '' : t('form.errName'));
    setFieldError(phoneInput, phoneErr, phoneOk(phone) ? '' : t('form.errPhone'));
    const customerInvalid = !name || !phoneOk(phone);

    if (rowsInvalid) {
      toast(filled.length ? t('form.errRows') : t('form.errNothing'), 'error', 5000);
      scrollToEl(photoSection);
      return;
    }
    if (customerInvalid) {
      toast(t('form.errCustomer'), 'error', 5000);
      scrollToEl(dataCard);
      (!name ? nameInput : phoneInput).focus({ preventScroll: true });
      return;
    }

    setSubmitting(true);
    reqId = reqId || requestId();
    const order = {
      albumId: album.id, clientName: name, phone, comment: commentInput.value.trim(),
      groupFolderId, groupName, isFullSession: res.fullSession,
      items: filled.map((i) => ({
        photoNumber: i.photoNumber, photoType: i.photoType,
        photoSize: i.photoFormat === FORMAT_DIGITAL ? '' : i.photoSize,
        photoFormat: i.photoFormat, count: i.photoFormat === FORMAT_DIGITAL ? 1 : i.count
      }))
    };
    try {
      const r = await api('createOrder', { order, requestId: reqId }, { timeout: 60000 });
      clearDraft(key);
      showSuccess(r);
    } catch (e) {
      setSubmitting(false);
      if (e instanceof ApiError && e.code === 'BAD_PHONE') {
        setFieldError(phoneInput, phoneErr, t('form.errPhone'));
        scrollToEl(dataCard);
      }
      toast(errorText(e), 'error', 8000);
    }
  }
  submitBtn.addEventListener('click', submit);

  function showSuccess(r) {
    const viewHref = buildUrl('order.html', { id: r.id, key: r.secret });
    openModal({
      title: t('form.successTitle'), size: 'md', closable: false, className: 'osuccess',
      body: h('div', { class: 'osuccess-body' },
        h('p', { class: 'osuccess-sum' }, t('form.successTotal', { sum: formatMoney(r.totalPrice) })),
        h('p', { class: 'osuccess-keep muted' }, t('form.successKeep'))),
      actions: [
        h('a', { class: 'btn btn-ghost', href: 'index.html' }, t('form.successHome')),
        h('a', { class: 'btn btn-primary', href: viewHref, autofocus: true }, t('form.successView'))
      ]
    });
  }

  // ---- запуск -------------------------------------------------------------------------
  restore();
  refresh();
  if (q.get('scrollTo') === 'photo') setTimeout(() => scrollToEl(photoSection), 120);
}

// ---- вікна-інструкції ---------------------------------------------------------------
function howToBody(titleKey, subKey, stepKeys, extra) {
  return h('div', { class: 'howto' },
    h('p', { class: 'howto-sub' }, t(subKey)),
    h('ol', { class: 'howto-steps' }, stepKeys.map((k, i) => h('li', { class: 'howto-step' }, h('span', { class: 'howto-n' }, String(i + 1)), h('div', { html: t(k) })))),
    extra);
}

function openHowTo(portrait) {
  let m;
  const ok = h('button', { class: 'btn btn-primary btn-lg howto-ok', type: 'button', onclick: () => m.close('btn'), autofocus: true }, t('common.understood'));
  if (portrait) {
    m = openModal({
      title: t('form.sessTitle'), size: 'md',
      body: howToBody('form.sessTitle', 'form.sessSub', ['form.sess1', 'form.sess2', 'form.sess3', 'form.sess4'],
        [h('div', { class: 'howto-box howto-box-blue', html: t('form.sessNote') }), h('div', { class: 'howto-box howto-box-warn', html: t('form.sessWarn') })]),
      actions: [ok]
    });
  } else {
    m = openModal({
      title: t('form.howTitle'), size: 'md',
      body: howToBody('form.howTitle', 'form.howSub', ['form.how1', 'form.how2', 'form.how3', 'form.how4', 'form.how5', 'form.how6', 'form.how7'],
        h('div', { class: 'howto-box howto-box-green', html: t('form.howNote') })),
      actions: [ok]
    });
  }
}

boot();
