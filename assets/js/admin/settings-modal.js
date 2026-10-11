// Параметри сайту: як показувати імена в публічному списку й чи приймати замовлення після кінцевої дати.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { api, errorText } from '../api.js';
import { openModal, toast } from '../modal.js';

function radioGroup(name, current, options) {
  return h('div', { class: 'set-opts', role: 'radiogroup' }, options.map(([value, label]) => h('label', { class: 'check set-opt' },
    h('input', { type: 'radio', name, value, checked: current === value }), h('span', null, label))));
}

export async function openSettingsModal() {
  let settings;
  try {
    settings = (await api('getSettings')).settings;
  } catch (e) {
    toast(errorText(e), 'error', 6000);
    return;
  }
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, t('common.save'));
  const cancel = h('button', { class: 'btn btn-ghost', type: 'button' }, t('common.cancel'));
  const form = h('div', { class: 'set' },
    h('fieldset', { class: 'set-group' },
      h('legend', null, t('set.nameMode')),
      radioGroup('publicNameMode', settings.publicNameMode, [['full', t('set.nameFull')], ['short', t('set.nameShort')]]),
      h('p', { class: 'set-help' }, t('set.nameHelp'))),
    h('fieldset', { class: 'set-group' },
      h('legend', null, t('set.after')),
      radioGroup('acceptAfterDeadline', settings.acceptAfterDeadline, [['no', t('set.afterNo')], ['yes', t('set.afterYes')]]),
      h('p', { class: 'set-help' }, t('set.afterHelp'))));
  const m = openModal({ title: t('set.title'), body: form, actions: [cancel, save], size: 'md' });
  cancel.addEventListener('click', () => m.close('cancel'));
  save.addEventListener('click', async () => {
    const pick = (n) => form.querySelector(`input[name="${n}"]:checked`).value;
    save.disabled = true;
    try {
      await api('saveSettings', { settings: { publicNameMode: pick('publicNameMode'), acceptAfterDeadline: pick('acceptAfterDeadline') } }, { retries: 0 });
      toast(t('set.saved'), 'success');
      m.close('saved');
    } catch (e) {
      save.disabled = false;
      toast(errorText(e), 'error', 6000);
    }
  });
}
