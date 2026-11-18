'use strict';
/**
 * Імітація LiqPay для локальної розробки й тестів (справжній LiqPay тут не викликається).
 *  POST /__liqpay/api/3/checkout — «сторінка оплати» з кнопками «Оплатити», «Помилка оплати», «Оплатити без повідомлення»;
 *  POST /__liqpay/api/request    — запит статусу (через UrlFetchApp з емульованого Apps Script).
 * Підписи перевіряються так само, як у LiqPay: base64(sha1(private + data + private)).
 */
const crypto = require('crypto');

const PUBLIC_KEY = 'sandbox_i00000000000';
const PRIVATE_KEY = 'sandbox_dev_private_key';

const sign = (data) => crypto.createHash('sha1').update(PRIVATE_KEY + data + PRIVATE_KEY).digest('base64');
const enc = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const dec = (data) => JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function createMockLiqpay() {
  const payments = new Map();   // order_id → { params, status }
  let gas = null;

  /** Для UrlFetchApp: відповідь на запит статусу. */
  function fetch(url, o) {
    if (!/\/api\/request$/.test(url)) throw new Error('UrlFetchApp: невідома адреса ' + url);
    const { data, signature } = o.payload || {};
    if (signature !== sign(data)) return resp(200, { status: 'error', err_code: 'invalid_signature' });
    const req = dec(data);
    const p = payments.get(req.order_id);
    if (!p || !p.status) return resp(200, { status: 'error', err_code: 'payment_not_found', order_id: req.order_id });
    return resp(200, result(p));
  }
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  const result = (p) => ({
    action: 'pay', status: p.status, order_id: p.params.order_id, amount: p.params.amount, currency: p.params.currency,
    payment_id: p.paymentId, description: p.params.description
  });

  const form = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
  };

  /** Обробник запитів /__liqpay/... ; повертає true, якщо запит оброблено. */
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/__liqpay/')) return false;
    const path = url.pathname.slice('/__liqpay'.length);
    if (path === '/api/3/checkout' && req.method === 'POST') {
      const f = await form(req);
      if (!f.data || f.signature !== sign(f.data)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('LiqPay (імітація): неправильний підпис');
        return true;
      }
      const params = dec(f.data);
      payments.set(params.order_id, { params, status: '', paymentId: Math.floor(Math.random() * 1e9) });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(params));
      return true;
    }
    if (path === '/act' && req.method === 'POST') {
      const f = await form(req);
      const p = payments.get(f.order_id);
      if (!p) { res.writeHead(404); res.end('no payment'); return true; }
      const test = Number(p.params.sandbox) === 1;
      p.status = f.outcome === 'fail' ? 'failure' : (test ? 'sandbox' : 'success');
      // повідомлення на server_url (емульований Apps Script), якщо його не «загубили» навмисно
      if (f.outcome !== 'silent' && gas) {
        const data = enc(result(p));
        gas.postForm({ data, signature: sign(data) });
      }
      res.writeHead(303, { Location: p.params.result_url || '/' });
      res.end();
      return true;
    }
    res.writeHead(404); res.end('Not found');
    return true;
  }

  function page(p) {
    const btn = (outcome, label, cls) => `<button name="outcome" value="${outcome}" class="${cls}">${label}</button>`;
    return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LiqPay — імітація оплати</title>
<style>body{font-family:system-ui,sans-serif;background:#f3f5f8;margin:0;display:grid;place-items:center;min-height:100vh;color:#111}
.box{background:#fff;border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:28px;max-width:420px;width:calc(100% - 32px)}
h1{font-size:18px;margin:0 0 4px}.dev{color:#b7791f;font-size:13px;font-weight:600;margin:0 0 18px}.sum{font-size:32px;font-weight:800;margin:8px 0}
.desc{color:#555;font-size:14px;margin-bottom:22px}button{display:block;width:100%;padding:13px;border-radius:12px;border:0;font-size:15px;font-weight:700;margin-top:10px;cursor:pointer}
.ok{background:#7ab72b;color:#fff}.fail{background:#fdecec;color:#b42318}.silent{background:#eef1f5;color:#333}</style></head>
<body><form class="box" method="post" action="/__liqpay/act"><h1>LiqPay</h1><p class="dev">Імітація для перевірки сайту — справжні гроші не списуються</p>
<div class="sum">${esc(p.amount)} ${esc(p.currency)}</div><div class="desc">${esc(p.description)}</div>
<input type="hidden" name="order_id" value="${esc(p.order_id)}">
${btn('pay', 'Оплатити', 'ok')}${btn('fail', 'Імітувати помилку оплати', 'fail')}${btn('silent', 'Оплатити, але «загубити» повідомлення сервера', 'silent')}
</form></body></html>`;
  }

  return { fetch, handle, payments, PUBLIC_KEY, PRIVATE_KEY, attach: (g) => { gas = g; } };
}

module.exports = { createMockLiqpay };
