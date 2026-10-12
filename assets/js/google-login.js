// Кнопка «Увійти через Google» для адміністратора (Google Identity Services).
// Браузер отримує ID-токен від Google і передає його серверу, який перевіряє його й видає вхід лише дозволеним адресам.
import { CONFIG } from './config.js';
import { t, getLang } from './i18n.js';
import { h } from './util.js';
import { loginWithGoogle, errorText, ApiError } from './api.js';

let loading = null;

function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CONFIG.GSI_SRC;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error('gsi')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export function loginErrorText(e) {
  if (e instanceof ApiError) {
    if (e.code === 'TOO_MANY') return t('admin.tooMany');
    if (e.code === 'FORBIDDEN' || e.code === 'NOT_CONFIGURED' || e.code === 'BAD_CREDENTIAL') return e.message;
  }
  return errorText(e);
}

/** Малює кнопку входу в host. onSuccess викликається після успішного входу. */
export function mountGoogleLogin(host, { onSuccess } = {}) {
  host.replaceChildren();
  if (!CONFIG.GOOGLE_CLIENT_ID) {
    host.append(h('div', { class: 'note note-warn' }, t('login.noClientId')));
    return;
  }
  const slot = h('div', { class: 'gsi-slot' });
  const msg = h('div', { class: 'field-error gsi-msg', role: 'alert', hidden: true });
  host.append(slot, msg);
  loadGsi().then(() => {
    window.google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      auto_select: false,
      callback: async (resp) => {
        msg.hidden = true;
        slot.classList.add('is-busy');
        try {
          await loginWithGoogle(resp.credential);
          if (onSuccess) onSuccess();
        } catch (e) {
          slot.classList.remove('is-busy');
          msg.textContent = loginErrorText(e);
          msg.hidden = false;
        }
      }
    });
    const dark = document.documentElement.dataset.theme === 'dark';
    window.google.accounts.id.renderButton(slot, { theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 280, locale: getLang() });
  }).catch(() => {
    msg.textContent = t('login.gsiFail');
    msg.hidden = false;
  });
}
