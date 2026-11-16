// Кнопка «Обробка фото» на сторінці адміністратора.
// Програма працює на цьому ж комп'ютері. Сторінка не може запустити файл напряму —
// це заборонено в усіх браузерах. Тому програма при першому запуску реєструє в Windows
// посилання azart://, і далі кнопка відкриває саме його: запускає Windows, а не сайт.
import { h, icon, store, sleep } from '../util.js';
import { t } from '../i18n.js';
import { CONFIG } from '../config.js';
import { openModal, toast } from '../modal.js';
import { copyText } from '../util.js';

const KEY = 'azart_photo_app_url';
const SEEN = 'azart_photo_app_seen';
const DEFAULT_URL = 'http://127.0.0.1:8765/';
const PROTOCOL = 'azart://open';
const LAUNCH_WAIT = 14000;

export function photoAppUrl() {
  const raw = (store.get(KEY) || CONFIG.PHOTO_APP_URL || DEFAULT_URL).trim();
  return /\/$/.test(raw) ? raw : raw + '/';
}

const isWindows = () => /Windows/i.test(navigator.userAgent);
const downloadUrl = () => (CONFIG.PHOTO_APP_DOWNLOAD || '').trim();

/** Чи запущена програма. Відповідає лише адреса /api/ping, і лише фактом запуску. */
export async function pingPhotoApp(base = photoAppUrl(), ms = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(base + 'api/ping', { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    const d = await r.json();
    if (d && d.app === 'azart-photo') { store.set(SEEN, '1'); return true; }
    return false;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Просимо Windows відкрити azart:// і чекаємо, доки програма підніметься. */
async function launchAndWait(ms = LAUNCH_WAIT) {
  const a = h('a', { href: PROTOCOL, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await sleep(900);
    if (await pingPhotoApp(photoAppUrl(), 800)) return true;
  }
  return false;
}

function helpModal(onFound, launchFailed) {
  const input = h('input', { class: 'inp', type: 'text', value: photoAppUrl(), spellcheck: 'false' });
  const state = h('p', { class: 'pa-state' }, launchFailed ? t('photoApp.launchFail') : t('photoApp.helpCheckHint'));
  if (launchFailed) state.className = 'pa-state is-off';
  const check = h('button', { class: 'btn btn-ghost', type: 'button' }, t('photoApp.check'));
  const close = h('button', { class: 'btn btn-ghost', type: 'button' }, t('common.close'));
  const dl = downloadUrl();
  const getBtn = dl
    ? h('a', { class: 'btn btn-primary', href: dl, target: '_blank', rel: 'noopener' },
      icon('upload', 17), h('span', null, t('photoApp.download')))
    : null;

  const cmd = 'python app.py';
  const copyBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('copy', 15), h('span', null, t('photoApp.copyCmd')));
  copyBtn.addEventListener('click', async () => {
    toast(t(await copyText(cmd) ? 'photoApp.copied' : 'photoApp.copyFail'), 'info');
  });

  const body = h('div', { class: 'pa-help' },
    h('ol', { class: 'pa-steps' },
      h('li', null, dl ? t('photoApp.step1') : t('photoApp.buildHint')),
      h('li', null, t('photoApp.step2')),
      h('li', null, t('photoApp.step3'))),
    h('p', { class: 'pa-note' }, t('photoApp.note')),
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, t('photoApp.address')),
      h('div', { class: 'pa-row' }, input, check)),
    state,
    h('div', { class: 'pa-cmd' }, h('code', null, cmd), copyBtn));

  const m = openModal({
    title: t('photoApp.helpTitle'), body, size: 'md',
    actions: getBtn ? [close, getBtn] : [close]
  });
  close.addEventListener('click', () => m.close('x'));
  check.addEventListener('click', async () => {
    const raw = input.value.trim() || DEFAULT_URL;
    const base = /\/$/.test(raw) ? raw : raw + '/';
    check.disabled = true;
    state.className = 'pa-state';
    state.textContent = t('photoApp.checking');
    const ok = await pingPhotoApp(base);
    check.disabled = false;
    state.className = 'pa-state ' + (ok ? 'is-on' : 'is-off');
    state.textContent = t(ok ? 'photoApp.found' : 'photoApp.notFound');
    if (ok) {
      store.set(KEY, base);
      onFound && onFound();
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

  function paint(ok) {
    dot.className = 'pa-dot ' + (ok ? 'is-on' : 'is-off');
    btn.title = t(ok ? 'photoApp.on' : 'photoApp.off');
    return ok;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (paint(await pingPhotoApp())) { window.open(photoAppUrl(), 'azartPhoto'); return; }
      // програму вже бачили на цьому комп'ютері — просимо Windows її запустити
      if (store.get(SEEN) && isWindows()) {
        toast(t('photoApp.starting'), 'info', LAUNCH_WAIT);
        if (paint(await launchAndWait())) { window.open(photoAppUrl(), 'azartPhoto'); return; }
        helpModal(() => paint(true), true);
        return;
      }
      helpModal(() => paint(true), false);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}
