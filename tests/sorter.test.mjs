// Сортувальник фото: перевіряємо чисту логіку (між PLAN-START/PLAN-END) і сумісність з exportData бекенду.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'sorter/index.html'), 'utf8');

const m = /\/\*PLAN-START\*\/([\s\S]*?)\/\*PLAN-END\*\//.exec(html);
assert.ok(m, 'у sorter/index.html є блок PLAN-START…PLAN-END');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\nthis.api = { classify, safeName, baseOf, buildPlan, chooseSource, finalName };', sandbox);
const raw = sandbox.api;
const { classify, safeName, baseOf, chooseSource, finalName } = raw;
// результат vm-контексту має «чужі» прототипи масивів — приводимо до звичайних структур
const plain = (v) => JSON.parse(JSON.stringify(v));
const buildPlan = (orders) => {
  const r = raw.buildPlan(orders);
  return plain({ entries: Array.from(r.entries, (e) => ({ ...e, who: [...e.who] })), warnings: r.warnings });
};

test('classify / safeName / baseOf', () => {
  assert.equal(classify('Друковані'), 'print');
  assert.equal(classify('Електронні'), 'digital');
  assert.equal(classify('Друковані + електронні'), 'both');
  assert.equal(classify(''), null);
  assert.equal(safeName('Іванов: А/Б?'), 'Іванов_ А_Б_');
  assert.equal(safeName('  ...  '), '_');
  assert.equal(baseOf('IMG_7653.JPG'), 'IMG_7653');
  assert.equal(baseOf('IMG_7653'), 'IMG_7653');
});

test('buildPlan: друк групується по розмірах, електронні — по замовниках, кількості складаються', () => {
  const orders = [
    { name: 'Іваненко Олена', group: 'Група 1', items: [
      { photo: 'IMG_1.jpg', size: '10х15', format: 'Друковані', count: 2 },
      { photo: 'IMG_2', size: '', format: 'Електронні', count: 1 },
      { photo: 'IMG_3', size: '15х21', format: 'Друковані + електронні', count: 1 }
    ] },
    { name: 'Петренко Ія', group: 'Група 1', items: [
      { photo: 'IMG_1', size: '10х15', format: 'Друковані', count: 3 }
    ] },
    { name: 'Іваненко Олена', group: 'Група 1', items: [{ photo: 'IMG_9', size: '', format: 'Електронні', count: 1 }] }
  ];
  const { entries, warnings } = buildPlan(orders);
  assert.deepEqual(warnings, []);
  const flat = entries.map((e) => `${e.dir.join('/')}|${finalName(e, '.jpg')}`);
  assert.ok(flat.includes('Група 1/Друк 10х15|IMG_1_5.jpg'), flat.join('\n'));
  assert.ok(flat.includes('Група 1/Електронні фото + додатковий друк/Іваненко Олена|IMG_2.jpg'));
  assert.ok(flat.includes('Група 1/Електронні фото + додатковий друк/Іваненко Олена/Друк + електронне фото 15х21|IMG_3.jpg'));
  // тезка в тій самій групі отримує окрему папку
  assert.ok(flat.includes('Група 1/Електронні фото + додатковий друк/Іваненко Олена (2)|IMG_9.jpg'));
});

test('buildPlan: попередження для порожніх номерів, невідомого формату, друку без розміру', () => {
  const { entries, warnings } = buildPlan([{ name: 'X', group: 'Г', items: [
    { photo: '', size: '10х15', format: 'Друковані', count: 1 },
    { photo: 'A', size: '10х15', format: 'щось', count: 1 },
    { photo: 'B', size: '', format: 'Друковані', count: 1 }
  ] }]);
  assert.equal(warnings.length, 3);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].dir, ['Г', 'Друк (без розміру)']);
});

test('chooseSource: ніколи не бере файл із папки іншої групи', () => {
  const hit = (dirPath) => ({ dirPath, segs: dirPath ? dirPath.split('/') : [], path: dirPath + '/IMG_1.jpg' });
  const all = ['Група 1', 'Група 2', 'Група 11'];
  // свій файл серед однойменних
  const r1 = chooseSource('Група 1', [hit('Група 1'), hit('Група 2')], '', all);
  assert.equal(r1.src.dirPath, 'Група 1');
  // «Група 1» ≠ «Група 11»
  const r2 = chooseSource('Група 1', [hit('Група 11')], '', all);
  assert.ok(r2.otherGroup);
  // нейтральна папка
  const r3 = chooseSource('Група 1', [hit('Усі'), hit('Група 2')], '', all);
  assert.equal(r3.src.dirPath, 'Усі');
  // два нейтральні — конфлікт
  const r4 = chooseSource('Група 1', [hit('A'), hit('B')], '', all);
  assert.ok(r4.conflict);
  // папка, вказана користувачем
  const r5 = chooseSource('Група 1', [hit('X/G1'), hit('Група 2')], 'X/G1', all);
  assert.equal(r5.src.dirPath, 'X/G1');
  // розпізнавання «гр. 8» / «8»
  const r6 = chooseSource('Група 8', [hit('гр. 8'), hit('7')], '', ['Група 8', 'Група 7']);
  assert.equal(r6.src.dirPath, 'гр. 8');
});

test('exportData бекенду → buildPlan: кирилична «х» у розмірі, групи, кількості', async () => {
  const { start } = require('../dev/server.js');
  const app = await start({ port: 0, quiet: true });
  try {
    const list = app.gas.post({ action: 'exportData', token: app.seeded.token });
    assert.ok(list.ok, JSON.stringify(list));
    assert.ok(list.data.albums.length >= 3);
    const a1 = app.seeded.albums.a1.id;
    const mk = app.gas.post({ action: 'createOrder', requestId: 'sortertest0001xx', order: {
      albumId: a1, clientName: 'Сортувальник Тест', phone: '0950000001', comment: '',
      groupFolderId: 'DEMO_G1', groupName: 'Група 1', isFullSession: false,
      items: [
        { photoNumber: 'IMG_0101.jpg', photoType: 'На фоні', photoSize: '10x15', photoFormat: 'Друковані', count: 2 },
        { photoNumber: 'IMG_0102.jpg', photoType: 'Репортаж', photoSize: '', photoFormat: 'Електронні', count: 1 }
      ] } });
    assert.ok(mk.ok, JSON.stringify(mk));
    const r = app.gas.post({ action: 'exportData', token: app.seeded.token, albumId: a1 });
    assert.ok(r.ok, JSON.stringify(r));
    const o = r.data.orders.find((x) => x.name === 'Сортувальник Тест');
    assert.ok(o);
    assert.equal(o.group, 'Група 1');
    assert.equal(o.groupFolderId, 'DEMO_G1');
    assert.equal(o.items[0].size, '10х15', 'розмір із кириличною «х»');
    assert.deepEqual(o.items.map((i) => i.count), [2, 1]);
    const { entries, warnings } = buildPlan([o]);
    assert.deepEqual(warnings, []);
    assert.deepEqual(entries.map((e) => e.dir.join('/') + '|' + finalName(e, '.jpg')).sort(), [
      'Група 1/Друк 10х15|IMG_0101_2.jpg',
      'Група 1/Електронні фото + додатковий друк/Сортувальник Тест|IMG_0102.jpg'
    ].sort());
    // без токена — відмова
    const denied = app.gas.post({ action: 'exportData' });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, 'UNAUTHORIZED');
  } finally {
    await app.close();
  }
});
