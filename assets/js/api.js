// Клієнт до бекенду на Google Apps Script.
// POST з Content-Type: text/plain — «простий» запит, браузер не робить preflight (CORS).
import { CONFIG } from './config.js';
import { t } from './i18n.js';
import { store, sleep } from './util.js';

const TOKEN_KEY = 'azart_admin_token';

export class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
  }
}

// --- авторизація адміністратора --------------------------------------------
export function getToken() {
  const d = store.getJson(TOKEN_KEY);
  if (!d || !d.token) return '';
  if (d.expiresAt && d.expiresAt < Date.now()) { store.remove(TOKEN_KEY); return ''; }
  return d.token;
}

export const isAdminLoggedIn = () => !!getToken();

export function logout() {
  store.remove(TOKEN_KEY);
}

export async function login(password) {
  const d = await api('login', { password }, { auth: false });
  store.setJson(TOKEN_KEY, { token: d.token, expiresAt: d.expiresAt });
  return d;
}

// --- запити ------------------------------------------------------------------
let controllerSeq = 0;

/**
 * api('listAlbums', {kindergarten:'Сад 1'})
 * options: { auth: true (додавати токен), timeout, retries }
 */
export async function api(action, params = {}, options = {}) {
  if (!CONFIG.API_URL) {
    throw new ApiError('NOT_CONFIGURED', t('err.notConfigured'));
  }
  const { auth = true, timeout = 40000, retries = 1 } = options;
  const body = { action, ...params };
  if (auth) {
    const token = getToken();
    if (token) body.token = token;
  }
  const payload = JSON.stringify(body);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    controllerSeq++;
    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload,
        redirect: 'follow',
        signal: ctrl.signal
      });
      clearTimeout(timer);
      let json;
      try { json = await res.json(); } catch (e) { throw new ApiError('BAD_RESPONSE', t('err.badResponse')); }
      if (json && json.ok) return json.data;
      const code = json && json.error ? json.error.code : 'INTERNAL';
      const msg = json && json.error ? json.error.message : t('err.server');
      if (code === 'UNAUTHORIZED') logout();
      throw new ApiError(code, msg);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ApiError) throw e;
      lastErr = new ApiError('NETWORK', e && e.name === 'AbortError' ? t('err.timeout') : t('err.network'));
      if (attempt < retries) await sleep(800);
    }
  }
  throw lastErr;
}

/** Людський текст помилки для показу користувачу. */
export function errorText(e) {
  if (e instanceof ApiError) return e.message;
  return t('err.generic');
}

/** Унікальний ідентифікатор запиту (ідемпотентність створення замовлення). */
export function requestId() {
  const a = new Uint8Array(12);
  (self.crypto || window.crypto).getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
