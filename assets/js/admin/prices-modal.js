// Редактор цін (порт HTML-компонента Wix «Налаштування цін»).
// Таблиця «тип × розмір», доплата за «друковані + електронні», бонус і знижки, ціна за всю фотосесію портрета.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { api, errorText } from '../api.js';
import { openModal } from '../modal.js';
import { SIZES } from '../domain.js';

const ROWS = [
  { labelKey: 'pe.rowBackground', key: 'background' },
  { labelKey: 'pe.rowReportage', key: 'reportage' },
  { labelKey: 'pe.rowPortrait', key: 'portret' }
];

/** Ключ ціни друку: ('background', '10x15') → background10X15Print. */
export const priceField = (key, size) => `${key}${size.replace('x', 'X')}Print`;

export const PRICE_FIELDS = [
  ...ROWS.flatMap((r) => [...SIZES.map((s) => priceField(r.key, s)), r.key + 'Digital']),
  'printAndDigitalExtra', 'discountThreshold',
  'discountPriceThreshold', 'discountPercent', 'discountPriceThreshold2', 'discountPercent2',
  'discountPriceThreshold3', 'discountPercent3', 'portretSessionPrice'
];

function numInput(field, value, cls = '') {
  return h('input', {
    class: 'input pe-input ' + cls, type: 'number', min: '0', step: 'any', inputmode: 'decimal',
    id: 'pe-' + field, name: field, value: value === undefined || value === null ? '' : String(value)
  });
}

/**
 * openPricesModal(prices) → Promise<prices|null>
 * Повертає останні збережені ціни (або null, якщо нічого не зберігали).
 */
export function openPricesModal(prices) {
  return new Promise((resolve) => {
    let latest = null;
    const inputs = {};
    const reg = (field, cls) => { inputs[field] = numInput(field, prices[field], cls); return inputs[field]; };

    const head = h('div', { class: 'pe-row pe-head' },
      h('span'), SIZES.map((s) => h('span', null, s)), h('span', null, t('pe.digital')), h('span', null, t('pe.both')));
    const rows = ROWS.map((r, i) => h('div', { class: 'pe-row pe-body' },
      h('b', { class: 'pe-type' }, t(r.labelKey)),
      SIZES.map((s) => h('label', { class: 'pe-cell' }, h('span', { class: 'sr-only' }, `${t(r.labelKey)} ${s}`), reg(priceField(r.key, s)))),
      h('label', { class: 'pe-cell' }, h('span', { class: 'sr-only' }, `${t(r.labelKey)} ${t('pe.digital')}`), reg(r.key + 'Digital')),
      i === 0 ? h('label', { class: 'pe-cell' }, h('span', { class: 'sr-only' }, t('pe.both')), reg('printAndDigitalExtra')) : h('span')));

    const box = (...children) => h('div', { class: 'pe-box' }, ...children);
    const cur = () => h('span', null, t('common.currency'));
    const discount = (a, p) => box(t('pe.discountA'), reg(a), t('pe.discountB'), reg(p), h('span', null, '%'));

    const msg = h('div', { class: 'pe-msg', role: 'status', 'aria-live': 'polite' });
    const saveBtn = h('button', { class: 'btn btn-primary pe-save', type: 'button' }, t('pe.save'));

    const body = h('div', { class: 'pe' },
      h('div', { class: 'pe-scroll' }, h('div', { class: 'pe-table' }, head, rows)),
      box(t('pe.gift'), reg('discountThreshold'), cur()),
      discount('discountPriceThreshold', 'discountPercent'),
      discount('discountPriceThreshold2', 'discountPercent2'),
      discount('discountPriceThreshold3', 'discountPercent3'),
      box(t('pe.session'), reg('portretSessionPrice'), cur()),
      saveBtn, msg);

    let timer = 0;
    saveBtn.addEventListener('click', async () => {
      const values = {};
      PRICE_FIELDS.forEach((f) => { values[f] = Math.max(0, Number(inputs[f].value) || 0); });
      saveBtn.disabled = true;
      saveBtn.textContent = t('pe.saving');
      msg.className = 'pe-msg';
      try {
        const r = await api('savePrices', { prices: values }, { retries: 0 });
        latest = r.prices;
        PRICE_FIELDS.forEach((f) => { inputs[f].value = String(latest[f]); });
        msg.textContent = t('pe.saved');
      } catch (e) {
        msg.classList.add('is-error');
        msg.textContent = t('pe.fail') + ': ' + errorText(e);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = t('pe.save');
        clearTimeout(timer);
        timer = setTimeout(() => { msg.textContent = ''; }, 3500);
      }
    });

    openModal({ title: t('pe.title'), body, size: 'xl', className: 'pe-modal', onClose: () => { clearTimeout(timer); resolve(latest); } });
  });
}
