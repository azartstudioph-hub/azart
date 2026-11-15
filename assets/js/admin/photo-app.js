// Кнопка «Обробка фото» на сторінці адміністратора.
// Програма обробки працює на цьому ж комп'ютері, тому сайт лише перевіряє,
// чи вона запущена, і відкриває її в новій вкладці. Ніякі дані між ними не передаються.
import { h, icon, store } from '../util.js';
import { t } from '../i18n.js';
import { CONFIG } from '../config.js';
import { openModal, toast } from '../modal.js';
import { copyText } from '../util.js';

const KEY = 'azart_photo_app_url';
const DEFAULT_URL = 'http://127.0.0.1:8765/';

export function photoAppUrl() {
  const raw = (store.get(KEY) || CONFIG.PHOTO_APP_URL || DEFAULT_URL).trim();
  return /\/$/.test(raw) ? raw : raw + '/';
}

/** Чи запущена програма. Відповідає лише адреса /api/ping, і лише фактом запуску. */
export async function pingPhotoApp(base = photoAppUrl(), ms = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(base + 'api/ping', { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!d && d.app === 'azart-photo';
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function helpModal(onChange) {
  const input = h('input', { class: 'inp', type: 'text', value: photoAppUrl(), spellcheck: 'false' });
  const state = h('p', { class: 'pa-state' }, t('photoApp.helpCheckHint'));
  const check = h('button', { class: 'btn btn-ghost', type: 'button' }, t('photoApp.check'));
  const close = h('button', { class: 'btn btn-primary', type: 'button' }, t('common.close'));
  const copyBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('copy', 15), h('span', null, t('photoApp.copyCmd')));
  const cmd = 'python app.py';
  copyBtn.addEventListener('click', async () => {
    toast(t(await copyText(cmd) ? 'photoApp.copied' : 'photoApp.copyFail'), 'info');
  });

  const body = h('div', { class: 'pa-help' },
    h('ol', { class: 'pa-steps' },
      h('li', null, t('photoApp.step1')),
      h('li', null, t('photoApp.step2')),
      h('li', null, t('photoApp.step3'))),
    h('p', { class: 'pa-note' }, t('photoApp.note')),
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, t('photoApp.address')),
      h('div', { class: 'pa-row' }, input, check)),
    state,
    h('div', { class: 'pa-cmd' }, h('code', null, cmd), copyBtn));

  const m = openModal({ title: t('photoApp.helpTitle'), body, actions: [close], size: 'md' });
  close.addEventListener('click', () => m.close('x'));
  check.addEventListener('click', async () => {
    const base = input.value.trim() ? (/\/$/.test(input.value.trim()) ? input.value.trim() : input.value.trim() + '/') : DEFAULT_URL;
    check.disabled = true;
    state.textContent = t('photoApp.checking');
    const ok = await pingPhotoApp(base);
    check.disabled = false;
    state.className = 'pa-state ' + (ok ? 'is-on' : 'is-off');
    state.textContent = t(ok ? 'photoApp.found' : 'photoApp.notFound');
    if (ok) {
      store.set(KEY, base);
      onChange && onChange();
      window.open(base, 'azartPhoto');
      m.close('ok');
    }
  });
}

/**
 * Кнопка для рядка посилань на сторінці адміністратора.
 * Програму перевіряємо лише за натисканням: інакше кожне відкриття сторінки
 * стукало б у локальний порт і лишало помилку в журналі браузера.
 */
export function photoAppButton() {
  const dot = h('i', { class: 'pa-dot', 'aria-hidden': 'true' });
  const btn = h('button', { class: 'adm-link pa-btn', type: 'button', title: t('photoApp.link') },
    icon('camera', 16), h('span', null, t('photoApp.link')), dot);

  async function check() {
    const ok = await pingPhotoApp();
    dot.className = 'pa-dot ' + (ok ? 'is-on' : 'is-off');
    btn.title = t(ok ? 'photoApp.on' : 'photoApp.off');
    return ok;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const ok = await check();
    btn.disabled = false;
    if (ok) window.open(photoAppUrl(), 'azartPhoto');
    else helpModal(check);
  });
  return btn;
}
