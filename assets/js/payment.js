// Оплата замовлення карткою через LiqPay.
// Суму й підпис готує сервер; браузер лише пересилає їх формою на сторінку оплати LiqPay.
import { api } from './api.js';
import { buildUrl } from './util.js';
import { getLang } from './i18n.js';

/** Адреса сторінки замовлення, куди LiqPay поверне клієнта після оплати. */
export function returnUrl(id, key) {
  const base = new URL('order.html', location.href);
  return buildUrl(base.origin + base.pathname, { id, key, pay: '1' });
}

/** Відправляє клієнта на сторінку оплати LiqPay. */
export function goToCheckout(checkout) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = checkout.url;
  form.acceptCharset = 'utf-8';
  form.hidden = true;
  for (const [name, value] of [['data', checkout.data], ['signature', checkout.signature]]) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

/** «Оплатити карткою»: сервер готує платіж; якщо замовлення вже оплачене — повертає { paid: true }. */
export async function payByCard({ id, key }) {
  const r = await api('choosePayment', { id, key, method: 'card', returnUrl: returnUrl(id, key), lang: getLang() }, { retries: 0, timeout: 45000 });
  if (r.checkout) goToCheckout(r.checkout);
  return r;
}

/** «Готівкою пізніше»: лише запам'ятовуємо вибір. Збій тут не заважає клієнту. */
export async function chooseCash({ id, key }) {
  try { return await api('choosePayment', { id, key, method: 'cash' }, { retries: 1 }); } catch (e) { return null; }
}
