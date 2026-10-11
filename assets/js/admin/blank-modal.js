// Створення / редагування бланка (порт HTML-компонента Wix «Створити бланк»).
// Два екрани: основний (типи, розміри, формати, бонус, садок, назва, посилання на Drive, дата) та діапазони фото.
import { h, icon, uid } from '../util.js';
import { t, tv } from '../i18n.js';
import { api, errorText, ApiError } from '../api.js';
import { openModal } from '../modal.js';
import { CONFIG } from '../config.js';
import { TYPES, SIZES, FORMATS, TYPE_PORTRAIT, parseDriveFolderId, validateTypeRanges } from '../domain.js';
import { getGroups, getPhotos } from '../drive.js';
import { formatMoney } from '../pricing.js';

/** Текст помилки діапазонів (validateTypeRanges повертає { key, vars }). */
export function rangeErrorText(err) {
  const vars = { ...err.vars };
  if (vars.whereKey) vars.where = t(vars.whereKey, { group: vars.group });
  return t(err.key, vars);
}

function checkGroup(title, name, values, selected, labelOf, hint) {
  return h('div', { class: 'bm-col' },
    h('h4', null, title),
    values.map((v) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name, value: v, checked: selected.includes(v) }), h('span', null, labelOf(v)))),
    hint ? h('p', { class: 'bm-colhint' }, hint) : null);
}

/**
 * openBlankModal({ album, prices }) → Promise<album|null>
 * album — існуючий бланк (редагування) або null (створення).
 */
export function openBlankModal({ album = null, prices = {} } = {}) {
  return new Promise((resolve) => {
    const editing = !!album;
    let result = null;

    const state = {
      types: album ? [...album.types] : ['Репортаж', 'На фоні'],
      sizes: album ? [...album.sizes] : [...SIZES],
      formats: album ? [...album.formats] : [...FORMATS],
      kindergarten: (album && album.kindergarten) || CONFIG.KINDERGARTENS[0],
      ranges: (album && album.typeRanges ? album.typeRanges : []).map((r) => ({ _id: uid(), from: r.from, to: r.to, type: r.type, group: r.group || '' }))
    };

    // ---------- основний екран ----------
    const main = h('div', { class: 'bm-screen' });
    const rangesScreen = h('div', { class: 'bm-screen', hidden: true });

    const typeCol = checkGroup(t('blank.types'), 'type', TYPES, state.types, tv, t('blank.portraitHint'));
    const sizeCol = checkGroup(t('blank.sizes'), 'size', SIZES, state.sizes, (s) => s);
    const formatCol = checkGroup(t('blank.formats'), 'format', FORMATS, state.formats, tv);
    const discountInput = h('input', { type: 'checkbox', id: 'bm-discount', checked: album ? !!album.discountEnabled : true });
    const bonusCol = h('div', { class: 'bm-col' },
      h('h4', null, t('blank.bonus', { n: formatMoney(prices.discountThreshold || 0, { group: false }) })),
      h('label', { class: 'check' }, discountInput, h('span', null, t('blank.bonusYes'))));
    const kgCol = h('div', { class: 'bm-col' },
      h('h4', null, t('blank.kindergarten')),
      CONFIG.KINDERGARTENS.map((k) => h('label', { class: 'check' },
        h('input', { type: 'radio', name: 'kindergarten', value: k, checked: state.kindergarten === k }), h('span', null, k))));

    // Тип «Портрет» виключає інші типи (як у Wix)
    let prevTypes = [...state.types];
    typeCol.addEventListener('change', () => {
      const boxes = [...typeCol.querySelectorAll('input')];
      const current = boxes.filter((b) => b.checked).map((b) => b.value);
      const added = current.filter((v) => !prevTypes.includes(v));
      let finalValue = current;
      if (added.includes(TYPE_PORTRAIT)) finalValue = [TYPE_PORTRAIT];
      else if (added.length) finalValue = current.filter((v) => v !== TYPE_PORTRAIT);
      boxes.forEach((b) => { b.checked = finalValue.includes(b.value); });
      prevTypes = finalValue;
      state.types = finalValue;
      // діапазони для типів, яких більше немає, втрачають сенс
      state.ranges.forEach((r) => { if (r.type && !finalValue.includes(r.type)) r.type = ''; });
      paintRangesBtn();
    });
    sizeCol.addEventListener('change', () => { state.sizes = [...sizeCol.querySelectorAll('input:checked')].map((b) => b.value); });
    formatCol.addEventListener('change', () => { state.formats = [...formatCol.querySelectorAll('input:checked')].map((b) => b.value); });
    kgCol.addEventListener('change', () => { state.kindergarten = kgCol.querySelector('input:checked').value; });

    const titleInput = h('input', { class: 'input bm-lg', type: 'text', id: 'bm-title', maxlength: '120', autocomplete: 'off', value: album ? album.title : '' });
    const titleErr = h('div', { class: 'field-error bm-err', hidden: true, role: 'alert' });

    const driveInput = h('input', {
      class: 'input bm-lg', type: 'text', id: 'bm-drive', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'https://drive.google.com/drive/folders/…', value: album ? album.driveFolderId : ''
    });
    const driveStatus = h('div', { class: 'bm-drive-status', role: 'status', hidden: true });
    const driveBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('folder', 16), h('span', null, t('blank.driveCheck')));
    driveBtn.addEventListener('click', async () => {
      const id = parseDriveFolderId(driveInput.value);
      driveStatus.hidden = false;
      driveStatus.className = 'bm-drive-status';
      if (!id) { driveStatus.classList.add('is-bad'); driveStatus.textContent = t('blank.errDriveBad'); return; }
      driveBtn.disabled = true;
      driveStatus.textContent = t('blank.driveChecking');
      try {
        const groups = await getGroups(id, { fresh: true });
        const photos = await getPhotos(id);
        driveStatus.classList.add('is-ok');
        driveStatus.textContent = t('blank.driveOk', { g: groups.length, p: photos.length });
      } catch (e) {
        driveStatus.classList.add('is-bad');
        driveStatus.textContent = e && e.message ? e.message : t('err.generic');
      } finally {
        driveBtn.disabled = false;
      }
    });

    const deadlineInput = h('input', { class: 'input bm-lg', type: 'date', id: 'bm-deadline', value: album && album.deadline ? album.deadline : '' });
    const submitErr = h('div', { class: 'field-error bm-err', hidden: true, role: 'alert' });

    const rangesBtn = h('button', { class: 'btn btn-outline', type: 'button' });
    const submitBtn = h('button', { class: 'btn btn-primary', type: 'button' }, t(editing ? 'blank.save' : 'blank.create'));
    const filledRanges = () => state.ranges.filter((r) => r.from !== null || r.to !== null || r.type).length;
    function paintRangesBtn() { const n = filledRanges(); rangesBtn.textContent = n ? t('blank.editRanges', { n }) : t('blank.addRange'); }
    paintRangesBtn();

    main.append(
      h('div', { class: 'bm-card' }, typeCol, sizeCol, formatCol, bonusCol, kgCol),
      h('div', { class: 'bm-field' }, h('label', { class: 'bm-label', for: 'bm-title' }, t('blank.name')), titleInput, titleErr),
      h('div', { class: 'bm-two' },
        h('div', { class: 'bm-field' },
          h('label', { class: 'bm-label', for: 'bm-drive' }, t('blank.drive')), driveInput,
          h('p', { class: 'bm-hint' }, t('blank.driveHint')),
          h('div', { class: 'bm-drive-row' }, driveBtn, driveStatus)),
        h('div', { class: 'bm-field' }, h('label', { class: 'bm-label', for: 'bm-deadline' }, t('blank.deadline')), deadlineInput)),
      submitErr,
      h('div', { class: 'bm-bar' }, rangesBtn, submitBtn));

    // ---------- екран діапазонів ----------
    const rangesList = h('div', { class: 'bm-ranges' });
    const rangesErr = h('div', { class: 'field-error bm-err', hidden: true, role: 'alert' });
    let backup = [];

    function renderRanges() {
      rangesList.replaceChildren(...state.ranges.map((r) => {
        const from = h('input', { class: 'input', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: r.from !== null ? String(r.from) : '', 'aria-label': t('ranges.first') });
        const to = h('input', { class: 'input', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: r.to !== null ? String(r.to) : '', 'aria-label': t('ranges.last') });
        const type = h('select', { class: 'select', 'aria-label': t('ranges.type') },
          h('option', { value: '' }, '—'),
          state.types.map((x) => h('option', { value: x, selected: r.type === x }, tv(x))));
        const group = h('input', { class: 'input', type: 'text', maxlength: '60', value: r.group || '', 'aria-label': t('ranges.group'), autocomplete: 'off' });
        from.addEventListener('input', () => { r.from = from.value === '' ? null : Number(from.value); });
        to.addEventListener('input', () => { r.to = to.value === '' ? null : Number(to.value); });
        type.addEventListener('change', () => { r.type = type.value; });
        group.addEventListener('input', () => { r.group = group.value.trim(); });
        const del = h('button', { class: 'btn btn-primary bm-range-del', type: 'button', title: t('ranges.remove'), 'aria-label': t('ranges.remove') }, icon('close', 16));
        del.addEventListener('click', () => {
          if (state.ranges.length === 1) { Object.assign(r, { from: null, to: null, type: '', group: '' }); }
          else state.ranges = state.ranges.filter((x) => x._id !== r._id);
          renderRanges();
        });
        const f = (label, input) => h('label', { class: 'bm-rf' }, h('span', null, label), input);
        return h('div', { class: 'bm-range' }, f(t('ranges.first'), from), f(t('ranges.last'), to), f(t('ranges.type'), type), f(t('ranges.group'), group), del);
      }));
    }

    const newRange = () => ({ _id: uid(), from: null, to: null, type: '', group: '' });
    const addRangeBtn = h('button', { class: 'btn btn-outline', type: 'button' }, t('ranges.add'));
    const saveRangesBtn = h('button', { class: 'btn btn-outline', type: 'button' }, t('ranges.save'));
    const cancelRangesBtn = h('button', { class: 'btn btn-outline-danger', type: 'button' }, t('common.cancel'));
    rangesScreen.append(
      h('div', { class: 'bm-ranges-top' }, addRangeBtn, h('div', { class: 'bm-ranges-actions' }, saveRangesBtn, cancelRangesBtn)),
      h('p', { class: 'bm-hint' }, t('ranges.hint')),
      rangesErr, rangesList);

    function showScreen(name) {
      main.hidden = name !== 'main';
      rangesScreen.hidden = name !== 'ranges';
      m.el.querySelector('.modal-title').textContent = name === 'ranges' ? t('ranges.title') : t(editing ? 'blank.titleEdit' : 'blank.titleCreate');
      m.el.scrollTop = 0;
    }

    rangesBtn.addEventListener('click', () => {
      if (!state.types.length) { showError(submitErr, t('blank.errTypesFirst')); return; }
      submitErr.hidden = true;
      backup = state.ranges.map((r) => ({ ...r }));
      if (!state.ranges.length) state.ranges.push(newRange());
      rangesErr.hidden = true;
      renderRanges();
      showScreen('ranges');
    });
    addRangeBtn.addEventListener('click', () => { state.ranges.push(newRange()); renderRanges(); });
    saveRangesBtn.addEventListener('click', () => {
      const err = validateTypeRanges(state.ranges);
      if (err) { showError(rangesErr, rangeErrorText(err)); return; }
      rangesErr.hidden = true;
      state.ranges = state.ranges.filter((r) => r.from !== null || r.to !== null || r.type);
      paintRangesBtn();
      showScreen('main');
    });
    cancelRangesBtn.addEventListener('click', () => { state.ranges = backup; paintRangesBtn(); showScreen('main'); });

    function showError(el, text) { el.textContent = text; el.hidden = false; }

    // ---------- збереження ----------
    submitBtn.addEventListener('click', async () => {
      titleErr.hidden = true;
      submitErr.hidden = true;
      titleInput.classList.remove('is-invalid');
      driveInput.classList.remove('is-invalid');

      const title = titleInput.value.replace(/\s+/g, ' ').trim();
      if (!title) { titleInput.classList.add('is-invalid'); showError(submitErr, t('blank.errTitle')); titleInput.focus(); return; }
      if (!state.types.length) { showError(submitErr, t('blank.errTypes')); return; }
      if (!state.sizes.length) { showError(submitErr, t('blank.errSizes')); return; }
      if (!state.formats.length) { showError(submitErr, t('blank.errFormats')); return; }
      const raw = driveInput.value.trim();
      if (!raw) { driveInput.classList.add('is-invalid'); showError(submitErr, t('blank.errDrive')); driveInput.focus(); return; }
      const folder = parseDriveFolderId(raw);
      if (!folder) { driveInput.classList.add('is-invalid'); showError(submitErr, t('blank.errDriveBad')); driveInput.focus(); return; }
      const rangesErrObj = validateTypeRanges(state.ranges);
      if (rangesErrObj) { showError(submitErr, rangeErrorText(rangesErrObj)); return; }

      submitBtn.disabled = true;
      rangesBtn.disabled = true;
      submitBtn.textContent = t('blank.saving');
      try {
        const payload = {
          ...(editing ? { id: album.id } : {}),
          title, kindergarten: state.kindergarten, deadline: deadlineInput.value || '',
          driveFolderId: folder, types: state.types, sizes: state.sizes, formats: state.formats,
          discountEnabled: discountInput.checked,
          typeRanges: state.ranges.filter((r) => r.from !== null && r.to !== null && r.type).map((r) => ({ from: r.from, to: r.to, type: r.type, group: r.group || '' }))
        };
        const r = await api('saveAlbum', { album: payload }, { retries: 0 });
        result = r.album;
        m.close('saved');
      } catch (e) {
        submitBtn.disabled = false;
        rangesBtn.disabled = false;
        submitBtn.textContent = t(editing ? 'blank.save' : 'blank.create');
        if (e instanceof ApiError && e.code === 'DUPLICATE') {
          titleInput.classList.add('is-invalid');
          showError(titleErr, t('blank.exists', { title }));
          titleInput.focus();
        } else {
          showError(submitErr, errorText(e));
        }
      }
    });

    const m = openModal({
      title: t(editing ? 'blank.titleEdit' : 'blank.titleCreate'),
      body: h('div', { class: 'bm' }, main, rangesScreen), size: 'xl', className: 'bm-modal',
      onClose: () => resolve(result)
    });
  });
}
