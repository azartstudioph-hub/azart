import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDriveFolderId, validateTypeRanges, normSize, compareGroups } from '../assets/js/domain.js';

test('parseDriveFolderId: різні види посилань і голий ID', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123';
  assert.equal(parseDriveFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`), id);
  assert.equal(parseDriveFolderId(`https://drive.google.com/drive/u/0/folders/${id}`), id);
  assert.equal(parseDriveFolderId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(parseDriveFolderId(`  ${id}  `), id);
  assert.equal(parseDriveFolderId('https://example.com/nothing'), '');
  assert.equal(parseDriveFolderId(''), '');
  assert.equal(parseDriveFolderId('abc'), '');
});

const R = (from, to, type = 'На фоні', group = '') => ({ from, to, type, group });

test('validateTypeRanges: порожнє та правильне', () => {
  assert.equal(validateTypeRanges([]), null);
  assert.equal(validateTypeRanges([R(null, null, '')]), null);
  assert.equal(validateTypeRanges([R(1, 100), R(101, 200, 'Репортаж')]), null);
});

test('validateTypeRanges: незаповнені поля, порядок, нуль', () => {
  assert.equal(validateTypeRanges([R(1, null)]).key, 'ranges.errFill');
  assert.equal(validateTypeRanges([R(1, 5, '')]).key, 'ranges.errFill');
  assert.equal(validateTypeRanges([R(10, 5)]).key, 'ranges.errOrder');
  assert.equal(validateTypeRanges([R(0, 5)]).key, 'ranges.errPositive');
});

test('validateTypeRanges: перетин у межах однієї групи; різні групи не конфліктують', () => {
  const e = validateTypeRanges([R(1, 100), R(100, 200)]);
  assert.equal(e.key, 'ranges.errOverlap');
  assert.equal(e.vars.whereKey, 'ranges.whereRoot');
  assert.equal(e.vars.a, '1-100');
  const g = validateTypeRanges([R(1, 100, 'На фоні', 'Група 1'), R(50, 150, 'На фоні', ' група  1 ')]);
  assert.equal(g.vars.whereKey, 'ranges.whereGroup');
  assert.equal(validateTypeRanges([R(1, 100, 'На фоні', 'Група 1'), R(50, 150, 'На фоні', 'Група 2')]), null);
  // порожній рядок посеред не заважає
  assert.equal(validateTypeRanges([R(1, 10), R(null, null, ''), R(11, 20)]), null);
});

test('normSize / compareGroups', () => {
  assert.equal(normSize('10х15'), '10x15');
  assert.equal(normSize(' 30 X 45 '), '30x45');
  assert.deepEqual(['Група 10', 'Група 2', 'Група 1'].sort(compareGroups), ['Група 1', 'Група 2', 'Група 10']);
});
