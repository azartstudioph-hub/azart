// Параметри сайту: імена в публічному списку, прийом після кінцевої дати, оплата карткою (LiqPay), дані ФОП для оферти.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { api, errorText } from '../api.js';
import { openModal, toast } from '../modal.js';

function radioGroup(name, current, options) {
  return h('div', { class: 'set-opts', role: 'radiogroup' }, options.map(([value, label]) => h('label', { class: 'check set-opt' },
    h('input', { type: 'radio', name, value, checked: current === value }), h('span', null, label))));
}

function textField(id, label, value, { placeholder = '', type = 'text', maxlength = 120, inputmode } = {}) {
  return h('label', { class: 'set-field', for: id },
    h('span', null, label),
    h('input', { class: 'input', id, type, value: value || '', placeholder, maxlength: String(maxlength), autocomplete: 'off', inputmode }));
}

export async function openSettingsModal() {
  let settings, liqpay;
  try {
    ({ settings, liqpay = { keys: false } } = await api('getSettings'));
  } catch (e) {
    toast(errorText(e), 'error', 6000);
    return;
  }
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, t('common.save'));
  const cancel = h('button', { class: 'btn btn-ghost', type: 'button' }, t('common.cancel'));
  const payGroup = radioGroup('cardPayments', settings.cardPayments || 'off',
    [['off', t('set.payOff')], ['test', t('set.payTest')], ['on', t('set.payOn')]]);
  if (!liqpay.keys) payGroup.querySelectorAll('input:not([value="off"])').forEach((i) => { i.disabled = true; });
  const form = h('div', { class: 'set' },
    h('fieldset', { class: 'set-group' },
      h('legend', null, t('set.nameMode')),
      radioGroup('publicNameMode', settings.publicNameMode, [['full', t('set.nameFull')], ['short', t('set.nameShort')]]),
      h('p', { class: 'set-help' }, t('set.nameHelp'))),
    h('fieldset', { class: 'set-group' },
      h('legend', null, t('set.after')),
      radioGroup('acceptAfterDeadline', settings.acceptAfterDeadline, [['no', t('set.afterNo')], ['yes', t('set.afterYes')]]),
      h('p', { class: 'set-help' }, t('set.afterHelp'))),
    h('fieldset', { class: 'set-group' },
      h('legend', null, t('set.pay')),
      payGroup,
      h('p', { class: 'set-help' + (liqpay.keys ? '' : ' set-help-warn') }, t(liqpay.keys ? 'set.payHelp' : 'set.payNoKeys'))),
    h('fieldset', { class: 'set-group' },
      h('legend', null, t('set.fop')),
      h('p', { class: 'set-help set-help-top' }, t('set.fopHelp')),
      h('div', { class: 'set-fields' },
        textField('set-fopName', t('set.fopName'), settings.fopName, { placeholder: t('set.fopNamePh') }),
        textField('set-fopTaxId', t('set.fopTaxId'), settings.fopTaxId, { maxlength: 20, inputmode: 'numeric' }),
        textField('set-fopAddress', t('set.fopAddress'), settings.fopAddress, { maxlength: 200 }),
        textField('set-fopEmail', t('set.fopEmail'), settings.fopEmail, { type: 'email', maxlength: 100 }),
        textField('set-deliveryDays', t('set.deliveryDays'), settings.deliveryDays, { maxlength: 3, inputmode: 'numeric' }))));
  const m = openModal({ title: t('set.title'), body: form, actions: [cancel, save], size: 'md' });
  cancel.addEventListener('click', () => m.close('cancel'));
  save.addEventListener('click', async () => {
    const pick = (n) => form.querySelector(`input[name="${n}"]:checked`).value;
    const val = (id) => form.querySelector('#set-' + id).value.trim();
    save.disabled = true;
    try {
      await api('saveSettings', { settings: {
        publicNameMode: pick('publicNameMode'), acceptAfterDeadline: pick('acceptAfterDeadline'), cardPayments: pick('cardPayments'),
        fopName: val('fopName'), fopTaxId: val('fopTaxId'), fopAddress: val('fopAddress'), fopEmail: val('fopEmail'), deliveryDays: val('deliveryDays')
      } }, { retries: 0 });
      toast(t('set.saved'), 'success');
      m.close('saved');
    } catch (e) {
      save.disabled = false;
      toast(errorText(e), 'error', 6000);
    }
  });
}
