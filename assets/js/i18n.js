// Переклади UK/EN. Ключі — у lang/uk.js та lang/en.js.
import uk from './lang/uk.js';
import en from './lang/en.js';
import { CONFIG } from './config.js';
import { store } from './util.js';

const DICTS = { uk, en };
const KEY = 'azart_lang';

let lang = (() => {
  const saved = store.get(KEY);
  if (saved === 'uk' || saved === 'en') return saved;
  return CONFIG.DEFAULT_LANG === 'en' ? 'en' : 'uk';
})();
document.documentElement.lang = lang;

export const getLang = () => lang;

export function setLang(next) {
  if (next !== 'uk' && next !== 'en') return;
  store.set(KEY, next);
  location.reload();
}

/** t('key', {n: 5}) — підстановка {n}. Якщо ключа немає, повертає український текст або сам ключ. */
export function t(key, vars) {
  let s = DICTS[lang][key];
  if (s === undefined) s = DICTS.uk[key];
  if (s === undefined) s = key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}

/** Переклад значень, що зберігаються в базі українською (типи, формати, статуси). */
export function tv(value) {
  if (lang === 'uk' || !value) return value;
  const s = DICTS.en['v.' + value];
  return s === undefined ? value : s;
}

/** Множина: українські форми 1 / 2-4 / 5+. key.one / key.few / key.many */
export function plural(key, n, vars = {}) {
  let form;
  if (lang === 'en') form = n === 1 ? 'one' : 'many';
  else {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) form = 'one';
    else if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) form = 'few';
    else form = 'many';
  }
  return t(key + '.' + form, { n, ...vars });
}

/** Застосовує переклади до розмітки: data-i18n, data-i18n-html, data-i18n-attr="placeholder:key;title:key". */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

export function pageTitle(key) {
  document.title = t(key) + ' — AZART';
}
