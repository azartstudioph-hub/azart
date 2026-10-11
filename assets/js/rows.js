// Редактор рядків замовлення: панель інструментів, «однаковий розмір/формат», список/плитки,
// картки з вибором кількості, розміру, формату й типу. Порт HTML-компонентів Wix
// («AlbumSettinf (item)» та «PortraitSetting (Item)») у звичайний DOM.
//
// Компонент «глупий»: нічого не рахує, лише малює payload і повідомляє про дії користувача.
import { h, icon } from './util.js';
import { t, tv } from './i18n.js';
import { thumbUrl, fallbackThumbUrl } from './drive.js';
import { formatMoney } from './pricing.js';

const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * createRowsEditor({ onField(rowId, field, value, applyToAll), onRemove(rowId), onCopy(rowId),
 *                    onOpenPhoto(rowId), onDeleteAll(), onHowTo(), onFullSession(bool) })
 * → { el, setData(payload) }
 *
 * payload: { items, types, sizes, formats, showTypeDropdown, hidePrices, session: {available, on, price},
 *            hasPhotos, highlightIds, howToKey }
 * item:    { id, rowNumber, photoNumber, photoThumbnail, photoId, count, photoSize, photoFormat, photoType,
 *            price, disableCount, disableSize, typeLocked, sizeError, formatError, typeError, photoError }
 */
export function createRowsEditor(handlers) {
  let payload = { items: [], types: [], sizes: [], formats: [], showTypeDropdown: true, hidePrices: false, session: null, hasPhotos: false, highlightIds: [], howToKey: 'form.howTo' };
  let view = 'list';
  let sameSize = false;
  let sameFormat = false;

  // --- панель інструментів -------------------------------------------------
  const delBtn = h('button', { class: 'rbtn', type: 'button', onclick: () => handlers.onDeleteAll() }, icon('trash', 18), h('span', null, t('form.deleteAll')));
  const howSpan = h('span');
  const howBtn = h('button', { class: 'rbtn rbtn-help', type: 'button', onclick: () => handlers.onHowTo() }, icon('help', 18), howSpan);
  const gridBtn = h('button', { type: 'button', title: t('form.viewGrid'), 'aria-label': t('form.viewGrid'), onclick: () => setView('grid') }, icon('grid', 18));
  const listBtn = h('button', { type: 'button', class: 'is-active', title: t('form.viewList'), 'aria-label': t('form.viewList'), onclick: () => setView('list') }, icon('list', 18));
  const seg = h('div', { class: 'rseg', role: 'group', 'aria-label': t('form.view') }, gridBtn, listBtn);

  const sessionInput = h('input', { type: 'checkbox', id: 'fullSessionToggle' });
  const sessionLabel = h('label', { class: 'rchk rchk-session', for: 'fullSessionToggle' }, sessionInput, icon('camera', 18), h('span', null, t('form.fullSession')));
  sessionInput.addEventListener('change', () => handlers.onFullSession(sessionInput.checked));

  const sizeInput = h('input', { type: 'checkbox', id: 'sameSizeToggle' });
  const formatInput = h('input', { type: 'checkbox', id: 'sameFormatToggle' });
  sizeInput.addEventListener('change', () => { sameSize = sizeInput.checked; });
  formatInput.addEventListener('change', () => { sameFormat = formatInput.checked; });
  const sameRow = h('div', { class: 'rgroup' },
    sessionLabel,
    h('label', { class: 'rchk', for: 'sameSizeToggle' }, sizeInput, h('span', null, t('form.sameSize'))),
    h('label', { class: 'rchk', for: 'sameFormatToggle' }, formatInput, h('span', null, t('form.sameFormat'))));

  const sessionNote = h('div', { class: 'note rsession-note', role: 'status', hidden: true }, icon('info', 20), h('div'));
  const list = h('div', { class: 'rlist' });
  const scroller = h('div', { class: 'rscroll' }, sessionNote, list);

  const el = h('div', { class: 'rrows' },
    h('div', { class: 'rtool' }, h('div', { class: 'rgroup' }, delBtn, howBtn), seg),
    sameRow, scroller);

  function setView(v) {
    view = v;
    gridBtn.classList.toggle('is-active', v === 'grid');
    listBtn.classList.toggle('is-active', v === 'list');
    render();
  }

  function resetSame() {
    sameSize = false;
    sameFormat = false;
    sizeInput.checked = false;
    formatInput.checked = false;
  }

  // --- рядок ------------------------------------------------------------------
  function option(value, label, selected) {
    const o = h('option', { value }, label);
    if (selected) o.selected = true;
    return o;
  }

  function selectField(item, field, labelKey, options, selected, { disabled = false, error = false, blank = false } = {}) {
    const sel = h('select', {
      class: 'rsel' + (error ? ' is-invalid' : ''), dataset: { field, rowId: item.id }, disabled,
      'aria-invalid': error ? 'true' : null
    });
    if (blank) sel.append(option('', '—', selected === ''));
    options.forEach((o) => sel.append(option(o.value, o.label, String(o.value) === String(selected))));
    sel.title = (options.find((o) => String(o.value) === String(selected)) || {}).label || '';
    return h('label', { class: 'rfield rfield-' + field }, h('span', null, t(labelKey)), sel);
  }

  function thumbNode(item) {
    const src = item.photoThumbnail ? thumbUrl(item.photoThumbnail, 400) : (item.photoId ? fallbackThumbUrl({ id: item.photoId }, 400) : '');
    const btn = h('button', {
      class: 'rrow-thumb', type: 'button', dataset: { act: 'open', rowId: item.id },
      title: t('form.openPhoto'), 'aria-label': t('form.openPhoto'), disabled: !src
    });
    const placeholder = () => { btn.replaceChildren(h('span', { class: 'rrow-nophoto' }, t('form.noPhoto'))); btn.disabled = true; };
    if (!src) { placeholder(); return btn; }
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src });
    let tried = false;
    img.addEventListener('error', () => {
      if (!tried && item.photoId) { tried = true; img.src = fallbackThumbUrl({ id: item.photoId }, 400); } else placeholder();
    });
    btn.append(img);
    return btn;
  }

  function rowCard(item) {
    const p = payload;
    const fields = [
      selectField(item, 'count', 'form.count', COUNT_OPTIONS.map((n) => ({ value: n, label: String(n) })), item.count, { disabled: item.disableCount }),
      selectField(item, 'size', 'form.size', p.sizes.map((s) => ({ value: s, label: s })), item.photoSize, { disabled: item.disableSize, error: item.sizeError, blank: true }),
      selectField(item, 'format', 'form.format', p.formats.map((f) => ({ value: f, label: tv(f) })), item.photoFormat, { error: item.formatError, blank: true })
    ];
    if (p.showTypeDropdown) {
      fields.push(selectField(item, 'type', 'form.type', p.types.map((x) => ({ value: x, label: tv(x) })), item.photoType, { disabled: item.typeLocked, error: item.typeError, blank: true }));
    }
    const card = h('div', { class: 'rrow' + (item.photoError ? ' has-error' : ''), dataset: { rowId: item.id } },
      h('span', { class: 'rrow-badge' }, item.rowNumber),
      thumbNode(item),
      h('div', { class: 'rrow-fields' }, fields),
      h('div', { class: 'rrow-meta' },
        h('span', { class: 'rrow-name', title: item.photoNumber || '' }, item.photoNumber || '—'),
        p.hidePrices ? null : h('span', { class: 'rrow-price' }, `${formatMoney(item.price)} ${t('common.currency')}`),
        item.photoError ? h('span', { class: 'rrow-err' }, t('form.rowNeedPhoto')) : null),
      h('div', { class: 'rrow-actions' },
        h('button', { class: 'rib', type: 'button', dataset: { act: 'copy', rowId: item.id }, title: t('form.copy'), 'aria-label': t('form.copy') }, icon('copy', 18)),
        h('button', { class: 'rib rib-del', type: 'button', dataset: { act: 'remove', rowId: item.id }, title: t('form.remove'), 'aria-label': t('form.remove') }, icon('trash', 18))));
    if (p.highlightIds && p.highlightIds.includes(item.id)) {
      card.classList.add('is-new');
      setTimeout(() => card.classList.remove('is-new'), 1200);
    }
    return card;
  }

  // --- малювання --------------------------------------------------------------
  function render() {
    const p = payload;
    // запам'ятовуємо фокус і прокрутку, щоб перемальовування не збивало роботу з клавіатури
    const ae = document.activeElement;
    const focus = ae && list.contains(ae) && ae.dataset && ae.dataset.rowId ? { rowId: ae.dataset.rowId, field: ae.dataset.field, act: ae.dataset.act } : null;
    const prevScroll = scroller.scrollTop;

    howSpan.textContent = t(p.howToKey || 'form.howTo');
    delBtn.disabled = !p.hasPhotos;
    list.className = 'rlist' + (view === 'grid' ? ' is-grid' : '');
    list.replaceChildren();

    const s = p.session;
    sessionLabel.hidden = !(s && s.available);
    sessionInput.checked = !!(s && s.on);
    const showNote = !!(s && s.available && s.on && s.price > 0);
    sessionNote.hidden = !showNote;
    if (showNote) sessionNote.lastChild.innerHTML = t('form.sessionNote', { price: formatMoney(s.price) });

    if (!p.items.length) {
      list.append(h('div', { class: 'rempty' }, t('form.empty')));
    } else {
      const frag = document.createDocumentFragment();
      p.items.forEach((it) => frag.append(rowCard(it)));
      list.append(frag);
    }
    scroller.scrollTop = prevScroll;

    if (focus) {
      const sel = focus.field ? `[data-row-id="${CSS.escape(focus.rowId)}"][data-field="${focus.field}"]` : `[data-row-id="${CSS.escape(focus.rowId)}"][data-act="${focus.act}"]`;
      const target = list.querySelector(sel);
      if (target && !target.disabled) { try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }

  // --- події (делегування) -----------------------------------------------------
  list.addEventListener('change', (e) => {
    const sel = e.target.closest('select');
    if (!sel || !sel.dataset.rowId) return;
    const field = sel.dataset.field;
    let applyToAll = false;
    if (field === 'size' && sameSize) { applyToAll = true; resetSame(); }
    if (field === 'format' && sameFormat) { applyToAll = true; resetSame(); }
    handlers.onField(sel.dataset.rowId, field, sel.value, applyToAll);
  });

  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const rowId = b.dataset.rowId;
    if (b.dataset.act === 'remove') handlers.onRemove(rowId);
    else if (b.dataset.act === 'copy') handlers.onCopy(rowId);
    else if (b.dataset.act === 'open') handlers.onOpenPhoto(rowId);
  });

  return {
    el,
    setData(next) { payload = { ...payload, ...next }; render(); }
  };
}
