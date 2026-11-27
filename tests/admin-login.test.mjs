// Вхід адміністратора через Google: перевірка ID-токена на сервері.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGas, devCredential } = require('../dev/gas-emulator.js');

function gas(props = {}) {
  const g = createGas({ props: { GOOGLE_CLIENT_ID: 'dev-client-id', DEV_PASSWORD_LOGIN: '', ...props } });
  g.run('setup');
  return g;
}
const login = (g, email, extra) => g.post({ action: 'login', credential: devCredential(email, 'dev-client-id', extra) });

test('власник скрипта входить; токен дає доступ до дій адміністратора', () => {
  const g = gas();
  const r = login(g, 'AzartStudioPh@gmail.com');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(g.post({ action: 'whoami', token: r.data.token }).data.admin, true);
  assert.equal(g.post({ action: 'getSettings', token: r.data.token }).ok, true);
});

test('чужий акаунт: FORBIDDEN з адресою', () => {
  const r = login(gas(), 'stranger@example.com');
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.match(r.error.message, /stranger@example\.com не має доступу адміністратора/);
});

test('ADMIN_EMAILS замінює власника; зміна списку анулює входи', () => {
  const g = gas({ ADMIN_EMAILS: 'helper@gmail.com, second@gmail.com' });
  assert.equal(login(g, 'azartstudioph@gmail.com').error.code, 'FORBIDDEN');
  const tok = login(g, 'second@gmail.com').data.token;
  assert.equal(g.post({ action: 'whoami', token: tok }).data.admin, true);
  g.props.ADMIN_EMAILS = 'helper@gmail.com';
  assert.equal(g.post({ action: 'whoami', token: tok }).data.admin, false);
});

test('інший Client ID, непідтверджена адреса, підробка, застарілий токен', () => {
  const g = gas();
  const other = g.post({ action: 'login', credential: devCredential('azartstudioph@gmail.com', 'other-app') });
  assert.equal(other.error.code, 'BAD_CREDENTIAL');
  assert.match(other.error.message, /іншого застосунку/);
  assert.equal(login(g, 'azartstudioph@gmail.com', { email_verified: 'false' }).error.code, 'FORBIDDEN');
  assert.equal(g.post({ action: 'login', credential: 'garbage' }).error.code, 'BAD_CREDENTIAL');
  assert.equal(login(g, 'azartstudioph@gmail.com', { exp: '1000' }).error.code, 'BAD_CREDENTIAL');
  assert.equal(login(g, 'azartstudioph@gmail.com', { iss: 'evil.example' }).error.code, 'BAD_CREDENTIAL');
});

test('без GOOGLE_CLIENT_ID — NOT_CONFIGURED; пароль на сервері вимкнено', () => {
  const g = gas({ GOOGLE_CLIENT_ID: '', ADMIN_PASSWORD: 'secret' });
  assert.equal(login(g, 'azartstudioph@gmail.com').error.code, 'NOT_CONFIGURED');
  const p = g.post({ action: 'login', password: 'secret' });
  assert.equal(p.error.code, 'NOT_CONFIGURED');
  assert.match(p.error.message, /Google/);
});

test('забагато невдалих спроб — TOO_MANY', () => {
  const g = gas();
  for (let i = 0; i < 10; i++) login(g, 'stranger@example.com');
  assert.equal(login(g, 'azartstudioph@gmail.com').error.code, 'TOO_MANY');
});

test('вхід діє 14 днів і подовжується, поки адміністратор працює', () => {
  const g = gas();
  const DAY = 24 * 3600 * 1000;
  const r = login(g, 'azartstudioph@gmail.com').data;
  assert.ok(r.expiresAt - Date.now() > 13.9 * DAY, 'токен на 14 днів');
  // через 13 днів без роботи — ще діє
  g.advance(13 * DAY);
  const a = g.post({ action: 'getSettings', token: r.token });
  assert.equal(a.ok, true);
  assert.ok(a.renew && a.renew.token, 'старий токен — сервер видає новий');
  // через ще 13 днів старий уже не діє, а подовжений — діє
  g.advance(13 * DAY);
  assert.equal(g.post({ action: 'getSettings', token: r.token }).error.code, 'UNAUTHORIZED');
  assert.equal(g.post({ action: 'getSettings', token: a.renew.token }).ok, true);
});

test('свіжий токен не подовжується на кожен запит; публічні дії — без подовження', () => {
  const g = gas();
  const tok = login(g, 'azartstudioph@gmail.com').data.token;
  assert.equal(g.post({ action: 'getSettings', token: tok }).renew, undefined);
  g.advance(2 * 24 * 3600 * 1000);
  assert.equal(g.post({ action: 'whoami', token: tok }).renew, undefined);
});

test('без ADMIN_EMAILS ключ входу не залежить від пошуку власника', () => {
  const g = gas();
  const tok = login(g, 'azartstudioph@gmail.com').data.token;
  g.ctx.Session.getEffectiveUser = () => ({ getEmail: () => '' });   // Google на мить не віддав адресу
  assert.equal(g.post({ action: 'whoami', token: tok }).data.admin, true);
});
