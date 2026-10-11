// Перевірка словників: однакові набори ключів UK/EN, однакові плейсхолдери,
// і кожен буквальний ключ, що використовується в коді та HTML, існує в обох мовах.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uk = (await import(pathToFileURL(path.join(root, 'assets/js/lang/uk.js')))).default;
const en = (await import(pathToFileURL(path.join(root, 'assets/js/lang/en.js')))).default;

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'tests', 'dev', 'docs', 'backend', 'tools', 'sorter'].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(f.name) && !/\/lang\//.test(p)) out.push(p);
  }
  return out;
}

test('UK і EN мають однакові ключі', () => {
  // «v.*» — переклади значень з бази (в UK значення вже українські), тому є лише в EN
  const ku = Object.keys(uk), ke = Object.keys(en).filter((k) => !k.startsWith('v.'));
  assert.deepEqual(ku.filter((k) => !(k in en)), [], 'немає в EN');
  assert.deepEqual(ke.filter((k) => !(k in uk)), [], 'немає в UK');
});

test('плейсхолдери {x} збігаються в обох мовах', () => {
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const bad = Object.keys(uk).filter((k) => k in en && ph(uk[k]) !== ph(en[k]));
  assert.deepEqual(bad, []);
});

test('усі буквальні ключі з коду й розмітки існують у словниках', () => {
  const missing = [];
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const keys = new Set();
    for (const m of src.matchAll(/\b(?:t|tv|plural)\(\s*['"]([a-zA-Z][\w.]*)['"]\s*[,)]/g)) keys.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-[a-z]+)?=["']([\w.]+)["']/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\b(?:titleKey|descKey|backKey|labelKey|textKey|placeholderKey)\s*:\s*['"]([a-zA-Z][\w.]*)['"]/g)) keys.add(m[1]);
    for (const k of keys) {
      if (k.startsWith('v.')) continue;
      if (!(k in uk) && !(`${k}.one` in uk)) missing.push(`${path.relative(root, file)}: ${k} (UK)`);
      else if (!(k in en) && !(`${k}.one` in en)) missing.push(`${path.relative(root, file)}: ${k} (EN)`);
    }
  }
  assert.deepEqual(missing, []);
});

test('значення, що зберігаються в базі, мають англійські назви (v.*)', () => {
  const vals = ['Репортаж', 'На фоні', 'Портрет', 'Друковані', 'Електронні', 'Друковані + електронні', 'Нове', 'В роботі', 'Готово'];
  for (const v of vals) assert.ok(('v.' + v) in en, v);
});
