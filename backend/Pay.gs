/**
 * Pay.gs — оплата карткою через LiqPay (протокол API v3).
 *
 * Як це працює:
 *  1. Після оформлення замовлення клієнт обирає «Оплатити карткою зараз».
 *     Сайт викликає choosePayment, сервер сам рахує суму (з таблиці, а не з браузера),
 *     підписує платіж приватним ключем і повертає дані для сторінки оплати LiqPay.
 *  2. Клієнт платить на сторінці LiqPay. LiqPay надсилає результат на цей веб-застосунок
 *     (server_url → doPost) і повертає клієнта на сторінку замовлення (result_url).
 *  3. Сторінка замовлення додатково питає checkPayment: сервер сам запитує статус у LiqPay.
 *     Тож оплата позначиться, навіть якщо повідомлення від LiqPay загубилось.
 *
 * Ключі зберігаються лише у Script properties (LIQPAY_PUBLIC_KEY, LIQPAY_PRIVATE_KEY).
 * Будь-які дані «про оплату» приймаються лише з правильним підписом LiqPay.
 */

var LIQPAY_ = {
  BASE: 'https://www.liqpay.ua',
  CHECKOUT: '/api/3/checkout',
  REQUEST: '/api/request',
  // статуси, за яких гроші з клієнта списано
  PAID: ['success', 'wait_accept'],
  // гроші повернуто клієнту
  REFUNDED: ['reversed']
};

function liqpayKeysSet_() {
  return !!(prop_(PROPS.LIQPAY_PUBLIC_KEY) && prop_(PROPS.LIQPAY_PRIVATE_KEY));
}

function liqpayBase_() {
  return (prop_(PROPS.LIQPAY_BASE) || LIQPAY_.BASE).replace(/\/+$/, '');
}

/** Режим оплати карткою: 'off' | 'test' | 'on' (без ключів — завжди 'off'). */
function cardMode_() {
  if (!liqpayKeysSet_()) return 'off';
  var m = getSettings_().cardPayments;
  return m === 'test' || m === 'on' ? m : 'off';
}

/** Що бачить клієнт: чи можна оплатити це замовлення карткою. */
function paymentsInfo_(order) {
  var mode = cardMode_();
  var can = mode !== 'off' && (!order || (Number(order.totalPrice) > 0 && order.payStatus !== 'paid'));
  return { card: can, test: mode === 'test' };
}

function liqpaySign_(data) {
  var key = prop_(PROPS.LIQPAY_PRIVATE_KEY);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, key + data + key, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(digest);
}

function liqpayEncode_(params) {
  return Utilities.base64Encode(JSON.stringify(params), Utilities.Charset.UTF_8);
}

function liqpayDecode_(data) {
  return JSON.parse(Utilities.newBlob(Utilities.base64Decode(data)).getDataAsString());
}

/** Перевіряє підпис LiqPay і повертає розкодовані дані (або null). */
function liqpayVerify_(data, signature) {
  if (!liqpayKeysSet_()) return null;
  if (typeof data !== 'string' || typeof signature !== 'string' || !data || data.length > 20000) return null;
  if (!safeEqual_(liqpaySign_(data), signature)) return null;
  try { return liqpayDecode_(data); } catch (e) { return null; }
}

/** Адреса цього веб-застосунку (/exec), куди LiqPay надсилає результат оплати. */
function liqpayServerUrl_() {
  var fixed = prop_(PROPS.LIQPAY_SERVER_URL);
  if (fixed) return fixed;
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/** Адреса повернення клієнта: лише сторінка замовлення сайту (https або локальна розробка). */
function cleanReturnUrl_(url) {
  url = String(url || '');
  if (url.length > 600) return '';
  if (!/^(https:\/\/[^\s"'<>]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s"'<>]*)$/.test(url)) return '';
  if (!/\/order\.html(\?|$)/.test(url)) return '';
  return url;
}

// ---------------------------------------------------------------
// Пошук і оновлення замовлення
// ---------------------------------------------------------------

function findOrderRow_(id) {
  id = String(id || '');
  if (!id) return null;
  var row = null;
  readAll_(SHEETS.ORDERS).some(function (o) { if (o.id === id) { row = o; return true; } return false; });
  return row;
}

/** Власник (посилання з ключем) або адміністратор. */
function orderForOwner_(req) {
  var order = findOrderRow_(req.id);
  if (!order) fail_('NOT_FOUND', 'Замовлення не знайдено');
  var owner = !!req.key && safeEqual_(String(req.key), order.secret);
  if (!owner && !isAdmin_(req.token)) fail_('FORBIDDEN', 'Немає доступу до цього замовлення');
  return order;
}

/** Номер платежу для LiqPay: «id замовлення_мітка». Кожна спроба оплати має власний номер. */
function payRefOrderId_(ref) {
  var s = String(ref || '');
  var i = s.lastIndexOf('_');
  return i > 0 ? s.slice(0, i) : '';
}

/**
 * Застосовує відповідь LiqPay (з перевіреним підписом) до замовлення.
 * Повертає true, якщо замовлення змінилось.
 */
function applyLiqpay_(order, d) {
  if (!d || String(d.order_id || '') !== String(order.payRef || '')) return false;
  var status = String(d.status || '');
  var test = cardMode_() === 'test';
  var paid = LIQPAY_.PAID.indexOf(status) >= 0 || (test && status === 'sandbox');
  var refunded = LIQPAY_.REFUNDED.indexOf(status) >= 0;
  if (paid) {
    // сума та валюта мають збігатися з тим, що порахував сервер
    if (String(d.currency || '').toUpperCase() !== 'UAH') return false;
    if (Math.abs(Number(d.amount) - Number(order.totalPrice)) > 0.009) return false;
    if (order.payStatus === 'paid') return false;
    order.payStatus = 'paid';
    order.payMethod = 'card';
    order.paidAt = iso_();
    order.payId = str_(d.payment_id, 40);
    order.payAmount = Number(d.amount) || 0;
    return true;
  }
  if (refunded && order.payStatus === 'paid') {
    order.payStatus = 'refunded';
    return true;
  }
  return false;
}

function paymentOut_(order) {
  return {
    method: order.payMethod || '',
    paid: order.payStatus === 'paid',
    paidAt: order.payStatus === 'paid' ? order.paidAt : '',
    payments: paymentsInfo_(order)
  };
}

// ---------------------------------------------------------------
// Публічні дії
// ---------------------------------------------------------------

/**
 * Вибір способу оплати після оформлення.
 *   { id, key, method: 'cash' | 'card', returnUrl }
 * Для картки повертає { checkout: { url, data, signature } } — сайт відправляє ці поля формою на LiqPay.
 */
function apiChoosePayment_(req) {
  var method = String(req.method || '');
  if (method !== 'cash' && method !== 'card') fail_('BAD_REQUEST', 'Невідомий спосіб оплати');
  if (!rateLimit_('pay', 60, 60)) fail_('TOO_MANY', 'Забагато запитів. Спробуйте за хвилину.');

  return withLock_(function () {
    var order = orderForOwner_(req);
    if (order.payStatus === 'paid') return paymentOut_(order);

    if (method === 'cash') {
      if (order.payMethod !== 'cash') { order.payMethod = 'cash'; writeRow_(SHEETS.ORDERS, order); }
      return paymentOut_(order);
    }

    var mode = cardMode_();
    if (mode === 'off') fail_('NOT_CONFIGURED', 'Оплата карткою зараз недоступна. Оберіть оплату готівкою.');
    var amount = Number(order.totalPrice) || 0;
    if (amount <= 0) fail_('BAD_REQUEST', 'Сума замовлення нульова — оплачувати нічого');
    var serverUrl = liqpayServerUrl_();
    if (!serverUrl) fail_('NOT_CONFIGURED', 'Не вдалося визначити адресу сервера для LiqPay (Script properties → LIQPAY_SERVER_URL).');

    var album = findAlbum_(order.albumId);
    var desc = 'AZART: ' + [album ? album.title : '', order.groupName, order.clientName].filter(Boolean).join(', ');
    var ref = order.id + '_' + Date.now().toString(36);
    var params = {
      version: 3,
      public_key: prop_(PROPS.LIQPAY_PUBLIC_KEY),
      action: 'pay',
      amount: Math.round(amount * 100) / 100,
      currency: 'UAH',
      description: desc.slice(0, 240),
      order_id: ref,
      language: req.lang === 'en' ? 'en' : 'uk',
      server_url: serverUrl
    };
    var ret = cleanReturnUrl_(req.returnUrl);
    if (ret) params.result_url = ret;
    if (mode === 'test') params.sandbox = 1;

    order.payMethod = 'card';
    order.payRef = ref;
    writeRow_(SHEETS.ORDERS, order);

    var data = liqpayEncode_(params);
    var out = paymentOut_(order);
    out.checkout = { url: liqpayBase_() + LIQPAY_.CHECKOUT, data: data, signature: liqpaySign_(data) };
    return out;
  });
}

/**
 * Перевірка оплати після повернення зі сторінки LiqPay: сервер сам питає статус у LiqPay.
 *   { id, key }
 */
function apiCheckPayment_(req) {
  var order = orderForOwner_(req);
  if (order.payStatus === 'paid' || !order.payRef || !liqpayKeysSet_()) return paymentOut_(order);
  if (!rateLimit_('paycheck:' + order.id, 20, 60)) return paymentOut_(order);

  var d = liqpayStatus_(order.payRef);
  var out;
  if (d) {
    out = withLock_(function () {
      var fresh = findOrderRow_(order.id);
      if (fresh && applyLiqpay_(fresh, d)) writeRow_(SHEETS.ORDERS, fresh);
      return paymentOut_(fresh || order);
    });
  } else {
    out = paymentOut_(order);
  }
  // для повідомлення клієнту: оплата ще обробляється чи не пройшла
  out.liqpayStatus = d ? String(d.status || '') : '';
  return out;
}

/** Запит статусу платежу в LiqPay. Відповідь LiqPay не підписана, тому довіряємо лише HTTPS-з'єднанню з liqpay.ua. */
function liqpayStatus_(ref) {
  var data = liqpayEncode_({ version: 3, public_key: prop_(PROPS.LIQPAY_PUBLIC_KEY), action: 'status', order_id: ref });
  try {
    var res = UrlFetchApp.fetch(liqpayBase_() + LIQPAY_.REQUEST, {
      method: 'post', payload: { data: data, signature: liqpaySign_(data) }, muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    var d = JSON.parse(res.getContentText());
    return d && d.order_id === ref ? d : null;
  } catch (e) {
    console.error('LiqPay status: ' + e);
    return null;
  }
}

/**
 * Повідомлення від LiqPay (server_url): POST із полями data та signature.
 * Викликається з doPost. Відповідає просто «ok» — LiqPay вміст відповіді не читає.
 */
function liqpayCallback_(data, signature) {
  var d = liqpayVerify_(data, signature);
  if (!d) {
    console.warn('LiqPay: відхилено повідомлення з неправильним підписом');
    return ContentService.createTextOutput('bad signature');
  }
  var orderId = payRefOrderId_(d.order_id);
  withLock_(function () {
    var order = findOrderRow_(orderId);
    if (order && applyLiqpay_(order, d)) writeRow_(SHEETS.ORDERS, order);
  });
  return ContentService.createTextOutput('ok');
}

/** Поля форми з тіла запиту application/x-www-form-urlencoded. */
function formFields_(e) {
  var out = {};
  if (e && e.parameter && (e.parameter.data || e.parameter.signature)) {
    out.data = e.parameter.data; out.signature = e.parameter.signature;
    return out;
  }
  var raw = (e && e.postData && e.postData.contents) || '';
  if (!/^[\w%.+\-]+=/.test(raw) || raw.charAt(0) === '{') return out;
  raw.split('&').forEach(function (pair) {
    var i = pair.indexOf('=');
    if (i < 0) return;
    var k = decodeURIComponent(pair.slice(0, i).replace(/\+/g, ' '));
    if (k === 'data' || k === 'signature') out[k] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
  });
  return out;
}
