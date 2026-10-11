// Типові стани сторінок: завантаження, помилка, порожньо.
import { h, icon } from './util.js';
import { t } from './i18n.js';
import { errorText } from './api.js';

export function loadingState(text) {
  return h('div', { class: 'state', role: 'status' }, h('div', { class: 'spin' }), h('p', null, text || t('common.loading')));
}

export function errorState(err, retry) {
  return h('div', { class: 'state state-error', role: 'alert' },
    h('div', { class: 'state-ico' }, icon('info', 30)),
    h('h3', null, t('state.errorTitle')),
    h('p', null, typeof err === 'string' ? err : errorText(err)),
    retry ? h('button', { class: 'btn btn-primary', type: 'button', style: { marginTop: '16px' }, onclick: retry }, t('common.retry')) : null);
}

export function emptyState(title, text) {
  return h('div', { class: 'state' }, h('h3', null, title), text ? h('p', null, text) : null);
}

/** Виконує load() і малює результат у container; при помилці показує повтор. */
export async function loadInto(container, load, render) {
  container.replaceChildren(loadingState());
  try {
    const data = await load();
    container.replaceChildren();
    await render(data);
  } catch (e) {
    container.replaceChildren(errorState(e, () => loadInto(container, load, render)));
  }
}
