// Оплата карткою (LiqPay): підпис, вибір способу, повідомлення LiqPay, перевірка статусу.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGas } = require('../dev/gas-emulator.js');
const { seed } = require('../dev/seed.js');

const PUB = 'sandbox_i000000001';
const PRIV = 'sandbox_secret_key_for_tests';
const sign = (data, key = PRIV) => crypto.createHash('sha1').update(key + data + key).digest('base64');
const enc = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const dec = (data) => JSON.parse(Buffer.from(data, 'base64').toString('utf8'));

function setup({ mode = 'test', keys = true, fetch } = {}) {
  const statuses = new Map();
  const gas = createGas({
    fetch: fetch || ((url, o) => {
      const req = dec(o.payload.data);
      assert.equal(o.payload.signature, sign(o.payload.data), 'запит статусу підписаний');
      const st = statuses.get(req.order_id);
      const body = st ? { ...st, order_id: req.order_id } : { status: 'error', err_code: 'payment_not_found', order_id: req.order_id };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    })
  });
  const { token, albums } = seed(gas);
  if (keys) { gas.props.LIQPAY_PUBLIC_KEY = PUB; gas.props.LIQPAY_PRIVATE_KEY = PRIV; }
  const call = (action, p = {}) => gas.post({ action, ...p });
  if (mode !== 'off') {
    const r = call('saveSettings', { token, settings: { cardPayments: mode } });
    assert.ok(r.ok, JSON.stringify(r));
  }
  const order = call('createOrder', {
    requestId: 'pay' + Math.random().toString(36).slice(2, 12) + 'xx',
    order: { albumId: albums.a2.id, clientName: 'Тест Оплата', phone: '0501234567', items: [{ photoNumber: '6040.JPG', photoType: 'На фоні', photoSize: '10x15', photoFormat: 'Друковані', count: 2 }] }
  }).data;
  return { gas, token, call, order, statuses, albums };
}

test('без ключів оплата карткою вимкнена й не вмикається', () => {
  const { call, order, token } = setup({ mode: 'off', keys: false });
  assert.deepEqual(order.payments, { card: false, test: false });
  const r = call('saveSettings', { token, settings: { cardPayments: 'on' } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_CONFIGURED');
  const p = call('choosePayment', { id: order.id, key: order.secret, method: 'card' });
  assert.equal(p.error.code, 'NOT_CONFIGURED');
});

test('картка: сервер підписує платіж на суму з таблиці', () => {
  const { call, order } = setup();
  assert.deepEqual(order.payments, { card: true, test: true });
  const r = call('choosePayment', { id: order.id, key: order.secret, method: 'card', returnUrl: 'https://azart.example/order.html?id=1&key=2', totalPrice: 1 });
  assert.ok(r.ok, JSON.stringify(r));
  const { url, data, signature } = r.data.checkout;
  assert.equal(url, 'https://www.liqpay.ua/api/3/checkout');
  assert.equal(signature, sign(data));
  const p = dec(data);
  assert.equal(p.public_key, PUB);
  assert.equal(p.action, 'pay');
  assert.equal(p.version, 3);
  assert.equal(p.currency, 'UAH');
  assert.equal(p.amount, order.totalPrice, 'сума з сервера, а не з браузера');
  assert.equal(p.sandbox, 1);
  assert.match(p.order_id, new RegExp('^' + order.id + '_'));
  assert.equal(p.result_url, 'https://azart.example/order.html?id=1&key=2');
  assert.equal(p.server_url, 'https://script.google.com/macros/s/DEV/exec');
  assert.match(p.description, /^За фотопослуги: .*Випускний, Тест Оплата$/);
});

test('чужий ключ замовлення — відмова; адреса повернення лише на сторінку замовлення', () => {
  const { call, order } = setup();
  assert.equal(call('choosePayment', { id: order.id, key: 'wrong', method: 'card' }).error.code, 'FORBIDDEN');
  assert.equal(call('choosePayment', { id: order.id, method: 'cash' }).error.code, 'FORBIDDEN');
  const bad = call('choosePayment', { id: order.id, key: order.secret, method: 'card', returnUrl: 'https://evil.example/steal' }).data;
  assert.equal(dec(bad.checkout.data).result_url, undefined);
  const http = call('choosePayment', { id: order.id, key: order.secret, method: 'card', returnUrl: 'http://evil.example/order.html' }).data;
  assert.equal(dec(http.checkout.data).result_url, undefined);
});

test('повідомлення LiqPay з правильним підписом позначає «Оплачено»; підробка — ні', () => {
  const { gas, call, order, token } = setup();
  const co = call('choosePayment', { id: order.id, key: order.secret, method: 'card' }).data.checkout;
  const ref = dec(co.data).order_id;
  const cb = (obj, key) => { const data = enc(obj); return gas.postForm({ data, signature: sign(data, key) }); };

  // підроблений підпис
  assert.equal(cb({ order_id: ref, status: 'sandbox', amount: order.totalPrice, currency: 'UAH' }, 'not-the-key'), 'bad signature');
  // неправильна сума
  cb({ order_id: ref, status: 'sandbox', amount: 1, currency: 'UAH' });
  let o = call('getOrder', { id: order.id, key: order.secret }).data.order;
  assert.equal(o.paid, false);
  // невдала оплата
  cb({ order_id: ref, status: 'failure', amount: order.totalPrice, currency: 'UAH' });
  assert.equal(call('getOrder', { id: order.id, key: order.secret }).data.order.paid, false);
  // успіх
  assert.equal(cb({ order_id: ref, status: 'sandbox', amount: order.totalPrice, currency: 'UAH', payment_id: 123456 }), 'ok');
  o = call('getOrder', { id: order.id, key: order.secret }).data.order;
  assert.equal(o.paid, true);
  assert.equal(o.payMethod, 'card');
  assert.equal(o.payments.card, false, 'оплачене вдруге не оплачується');

  // адмін бачить позначку у списках і для друку; відвідувач — ні
  const albumId = call('getOrder', { id: order.id, token }).data.album.id;
  const full = call('listOrdersFull', { token, albumId }).data.orders;
  assert.equal(full.find((x) => x.id === order.id).paid, true);
  assert.equal(call('listOrders', { albumId }).data.orders.find((x) => x.id === order.id).paid, undefined);
  assert.equal(call('listOrders', { albumId, token }).data.orders.find((x) => x.id === order.id).paid, true);
  assert.equal(call('getOrder', { id: order.id }).data.order.paid, undefined, 'без ключа статус оплати не видно');

  // повернення коштів знімає позначку
  cb({ order_id: ref, status: 'reversed', amount: order.totalPrice, currency: 'UAH' });
  assert.equal(call('getOrder', { id: order.id, key: order.secret }).data.order.paid, false);
});

test('тестова оплата не зараховується в бойовому режимі', () => {
  const { gas, call, order } = setup({ mode: 'on' });
  const co = call('choosePayment', { id: order.id, key: order.secret, method: 'card' }).data.checkout;
  assert.equal(dec(co.data).sandbox, undefined);
  const data = enc({ order_id: dec(co.data).order_id, status: 'sandbox', amount: order.totalPrice, currency: 'UAH' });
  gas.postForm({ data, signature: sign(data) });
  assert.equal(call('getOrder', { id: order.id, key: order.secret }).data.order.paid, false);
});

test('після повернення з LiqPay сервер сам перевіряє статус (якщо повідомлення загубилось)', () => {
  const { call, order, statuses } = setup();
  const ref = dec(call('choosePayment', { id: order.id, key: order.secret, method: 'card' }).data.checkout.data).order_id;
  let r = call('checkPayment', { id: order.id, key: order.secret }).data;
  assert.equal(r.paid, false);
  assert.equal(r.liqpayStatus, 'error');
  statuses.set(ref, { status: 'processing', amount: order.totalPrice, currency: 'UAH' });
  assert.equal(call('checkPayment', { id: order.id, key: order.secret }).data.liqpayStatus, 'processing');
  statuses.set(ref, { status: 'sandbox', amount: order.totalPrice, currency: 'UAH', payment_id: 77 });
  r = call('checkPayment', { id: order.id, key: order.secret }).data;
  assert.equal(r.paid, true);
  // повторна спроба оплати після успіху нічого не створює
  const again = call('choosePayment', { id: order.id, key: order.secret, method: 'card' }).data;
  assert.equal(again.paid, true);
  assert.equal(again.checkout, undefined);
});

test('готівка: лише запам’ятовується вибір, позначки немає', () => {
  const { call, order, token } = setup();
  const r = call('choosePayment', { id: order.id, key: order.secret, method: 'cash' }).data;
  assert.deepEqual([r.method, r.paid, r.checkout], ['cash', false, undefined]);
  const o = call('getOrder', { id: order.id, token }).data.order;
  assert.equal(o.payMethod, 'cash');
  assert.equal(o.paid, false);
  // можна передумати і оплатити карткою пізніше
  assert.ok(call('choosePayment', { id: order.id, key: order.secret, method: 'card' }).data.checkout);
});

test('дані ФОП для сторінок оферти: збереження й перевірка', () => {
  const { call, token } = setup({ mode: 'off' });
  let r = call('saveSettings', { token, settings: { fopName: '  ФОП  Іваненко Іван ', fopTaxId: '1234567890', fopEmail: 'bad' } });
  assert.equal(r.error.code, 'BAD_REQUEST');
  r = call('saveSettings', { token, settings: { fopName: '  ФОП  Іваненко Іван ', fopTaxId: '1234567890', fopEmail: 'a@b.ua', fopAddress: 'м. Київ' } });
  assert.ok(r.ok);
  const info = call('siteInfo').data;
  assert.deepEqual(info.business, { name: 'ФОП Іваненко Іван', taxId: '1234567890', address: 'м. Київ', email: 'a@b.ua' });
  assert.deepEqual(info.payments, { card: false, test: false });
});
