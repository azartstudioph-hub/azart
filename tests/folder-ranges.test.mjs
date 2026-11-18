import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanFolderPaths, rangesFromScan, typesAfterScan, mergeRanges,
  typeFromFolderName, groupNo, isPhotoFile
} from '../assets/js/folder-ranges.js';
import { validateTypeRanges, MAX_RANGES } from '../assets/js/domain.js';

const img = (n) => `IMG_${String(n).padStart(4, '0')}.JPG`;
const files = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}/${img(from + i)}`);

test('назви підпапок → типи', () => {
  assert.equal(typeFromFolderName('Репортаж'), 'Репортаж');
  assert.equal(typeFromFolderName('репортаж '), 'Репортаж');
  assert.equal(typeFromFolderName('Фон'), 'На фоні');
  assert.equal(typeFromFolderName('ФОН 2'), 'На фоні');
  assert.equal(typeFromFolderName('На фоні'), 'На фоні');
  assert.equal(typeFromFolderName('Портрет'), 'Портрет');
  assert.equal(typeFromFolderName('Телефон'), null, '«фон» усередині слова — не тип');
  assert.equal(typeFromFolderName('Група 6'), null);
  assert.equal(typeFromFolderName('Відібрані'), null);
});

test('номер групи з різних написань', () => {
  for (const s of ['Група 6', 'група6', 'Гр6', 'гр. 6', 'Група №6', 'С7 Гр6 св осені', '6']) assert.equal(groupNo(s), 6, s);
  assert.equal(groupNo('Молодша'), null);
});

test('фото: розширення', () => {
  for (const f of ['a.jpg', 'A.JPEG', 'b.CR2', 'c.nef', 'd.heic', 'e.tif']) assert.ok(isPhotoFile(f), f);
  for (const f of ['Thumbs.db', 'desktop.ini', 'IMG_0001.xmp', 'note.txt']) assert.ok(!isPhotoFile(f), f);
});

test('свято з групами: діапазони за групами, пропуски нумерації не розривають діапазон', () => {
  const paths = [
    ...files('Свято осені/Група 6/Репортаж', 1, 40),
    ...files('Свято осені/Група 6/Репортаж', 45, 60),      // 41–44 видалені кадри
    ...files('Свято осені/Група 6/Фон', 61, 90),
    ...files('Свято осені/Група 7/Репортаж', 100, 150),
    ...files('Свято осені/Група 7/Фон', 151, 170),
    'Свято осені/Група 7/Фон/Thumbs.db'
  ];
  const scan = scanFolderPaths(paths, { driveGroups: ['Група 6', 'Група 7'] });
  assert.equal(scan.total, 40 + 16 + 30 + 51 + 20);
  assert.equal(scan.ignored, 1);
  assert.deepEqual(scan.foundTypes, ['Репортаж', 'На фоні']);
  const { ranges, perGroup } = rangesFromScan(scan);
  assert.deepEqual(ranges, [
    { from: 1, to: 60, type: 'Репортаж', group: 'Група 6' },
    { from: 61, to: 90, type: 'На фоні', group: 'Група 6' },
    { from: 100, to: 150, type: 'Репортаж', group: 'Група 7' },
    { from: 151, to: 170, type: 'На фоні', group: 'Група 7' }
  ]);
  assert.deepEqual(perGroup[0].counts, { 'Репортаж': 56, 'На фоні': 30 });
  assert.equal(validateTypeRanges(ranges), null, 'результат проходить звичайну перевірку бланка');
});

test('перемішані типи: діапазон закривається там, де починається інший тип', () => {
  const paths = [
    ...files('С/Група 1/Репортаж', 1, 10),
    ...files('С/Група 1/Фон', 11, 20),
    ...files('С/Група 1/Репортаж', 21, 30)
  ];
  const { ranges } = rangesFromScan(scanFolderPaths(paths));
  assert.deepEqual(ranges.map((r) => [r.from, r.to, r.type]), [[1, 10, 'Репортаж'], [11, 20, 'На фоні'], [21, 30, 'Репортаж']]);
  assert.equal(validateTypeRanges(ranges), null);
});

test('один номер у двох типах — без типу, у звіті; jpg+raw одного кадру — не конфлікт', () => {
  const paths = [
    ...files('С/Група 1/Репортаж', 1, 5),
    'С/Група 1/Фон/IMG_0005.JPG',                     // помилково в обох
    'С/Група 1/Фон/IMG_0006.JPG', 'С/Група 1/Фон/IMG_0006.CR2'
  ];
  const { ranges, perGroup } = rangesFromScan(scanFolderPaths(paths));
  assert.deepEqual(perGroup[0].conflicts, [5]);
  assert.deepEqual(ranges.map((r) => [r.from, r.to, r.type]), [[1, 4, 'Репортаж'], [6, 6, 'На фоні']]);
});

test('назви груп зіставляються з Drive: точно, за номером; невідома — позначена', () => {
  const paths = [
    ...files('С/група 6/Фон', 1, 3),
    ...files('С/Гр7/Фон', 10, 12),
    ...files('С/Молодша/Фон', 20, 22)
  ];
  const scan = scanFolderPaths(paths, { driveGroups: ['Група 6', 'Група 7'] });
  const byLocal = Object.fromEntries(scan.groups.map((g) => [g.locals[0], g]));
  assert.equal(byLocal['група 6'].name, 'Група 6');
  assert.equal(byLocal['група 6'].matched, true);
  assert.equal(byLocal['Гр7'].name, 'Група 7');
  assert.equal(byLocal['Гр7'].matched, true);
  assert.equal(byLocal['Молодша'].matched, false);
});

test('на Drive груп немає — діапазони без групи', () => {
  const scan = scanFolderPaths(files('Свято/Група 1/Фон', 1, 5), { driveGroups: [] });
  const { ranges } = rangesFromScan(scan);
  assert.deepEqual(ranges, [{ from: 1, to: 5, type: 'На фоні', group: '' }]);
});

test('перетягнули одну групу; перетягнули папку, де одразу підпапки типів', () => {
  let { ranges } = rangesFromScan(scanFolderPaths(files('Група 6/Репортаж', 1, 3)));
  assert.equal(ranges[0].group, 'Група 6');
  ({ ranges } = rangesFromScan(scanFolderPaths(files('Репортаж', 1, 3))));
  assert.equal(ranges[0].group, '');
});

test('фото поза підпапками типу та файли без номера — пропущені й пораховані', () => {
  const paths = [...files('С/Група 1/Фон', 1, 3), 'С/Група 1/IMG_0099.JPG', 'С/Група 1/Фон/обкладинка.jpg'];
  const { perGroup } = rangesFromScan(scanFolderPaths(paths));
  assert.equal(perGroup[0].unsorted, 1);
  assert.equal(perGroup[0].noNumber, 1);
});

test('типи бланка після сканування', () => {
  assert.deepEqual(typesAfterScan(['Репортаж'], ['Репортаж', 'На фоні']), { types: ['Репортаж', 'На фоні'], enabled: ['На фоні'], switchedToPortrait: false });
  assert.deepEqual(typesAfterScan(['Репортаж', 'На фоні'], ['Портрет']).types, ['Портрет']);
  assert.equal(typesAfterScan(['Репортаж', 'На фоні'], ['Портрет']).switchedToPortrait, true);
  assert.deepEqual(typesAfterScan(['Портрет'], ['Портрет', 'Репортаж']).types, ['Портрет']);
  assert.deepEqual(typesAfterScan(['Репортаж', 'На фоні'], ['Репортаж', 'Портрет']).types, ['Репортаж', 'На фоні'], 'портрет не додається до звичайного бланка');
  assert.deepEqual(typesAfterScan(['Репортаж', 'На фоні'], []).types, ['Репортаж', 'На фоні']);
});

test('портрет у звичайному бланку — пропущений і порахований', () => {
  const scan = scanFolderPaths([...files('С/Група 1/Репортаж', 1, 3), ...files('С/Група 1/Портрет', 4, 5)]);
  const { ranges, perGroup } = rangesFromScan(scan, ['Репортаж', 'На фоні']);
  assert.deepEqual(ranges.map((r) => r.type), ['Репортаж']);
  assert.deepEqual(perGroup[0].skipped, { 'Портрет': 2 });
});

test('злиття: нові діапазони замінюють лише проскановані групи', () => {
  const existing = [
    { from: 1, to: 9, type: 'Репортаж', group: 'Група 6' },
    { from: 500, to: 600, type: 'На фоні', group: 'Група 9' },
    { from: null, to: null, type: '', group: '' }
  ];
  const generated = [{ from: 1, to: 60, type: 'Репортаж', group: 'Група 6' }];
  assert.deepEqual(mergeRanges(existing, generated, ['група 6']), [existing[1], generated[0]]);
});

test('забагато діапазонів — зрозуміла помилка замість мовчазного обрізання на сервері', () => {
  const many = Array.from({ length: MAX_RANGES + 1 }, (_, i) => ({ from: i * 2 + 1, to: i * 2 + 1, type: i % 2 ? 'Репортаж' : 'На фоні', group: 'Група 1' }));
  assert.equal(validateTypeRanges(many).key, 'ranges.errTooMany');
});

test('номер фото рахується так само, як на сторінці замовлення', () => {
  const scan = scanFolderPaths(['С/Група 1/Фон/DSC_0420 копія.JPG']);
  assert.equal(rangesFromScan(scan).ranges[0].from, 420);
});
