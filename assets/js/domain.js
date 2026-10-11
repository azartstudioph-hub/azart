// Доменні довідники. Мають збігатися з backend/Config.gs.
export const TYPES = ['Репортаж', 'На фоні', 'Портрет'];
export const SIZES = ['10x15', '15x21', '20x30', '30x45'];
export const FORMATS = ['Друковані', 'Електронні', 'Друковані + електронні'];
export const STATUSES = ['Нове', 'В роботі', 'Готово'];

export const FORMAT_PRINT = 'Друковані';
export const FORMAT_DIGITAL = 'Електронні';
export const FORMAT_BOTH = 'Друковані + електронні';
export const TYPE_PORTRAIT = 'Портрет';

/** Кирилична «х»/«Х», латинська X і знак множення → латинська «x». */
export function normSize(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[хХxX×]/g, 'x')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** Для відображення: 10x15 → 10x15 (латиниця), прибирає невидимі відмінності. */
export function sizeLabel(s) {
  return normSize(s);
}

/** Нормалізація назви групи для ключа бібліотеки фото: "Група  1" == "група 1". */
export function groupKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function cleanGroupName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

/** Номер групи для сортування: «Група 12» → 12. */
export function groupNumber(name) {
  const m = String(name || '').match(/група\D*(\d+)/i);
  return m ? Number(m[1]) : Infinity;
}

export function compareGroups(a, b) {
  const na = groupNumber(a), nb = groupNumber(b);
  if (na !== nb) return na < nb ? -1 : 1;
  return String(a || '').localeCompare(String(b || ''), 'uk', { numeric: true, sensitivity: 'base' });
}

export function isPortraitAlbum(album) {
  return !!album && Array.isArray(album.types) && album.types.length === 1 && album.types[0] === TYPE_PORTRAIT;
}

/**
 * Дістає ID папки Google Drive з посилання (…/folders/ID, …/u/0/folders/ID?usp=sharing, …?id=ID)
 * або приймає сам ID. Повертає '' якщо розпізнати не вдалося.
 */
export function parseDriveFolderId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const folder = /\/folders\/([\w-]+)/.exec(s);
  if (folder) return folder[1];
  const idParam = /[?&]id=([\w-]+)/.exec(s);
  if (idParam) return idParam[1];
  return /^[\w-]{8,}$/.test(s) ? s : '';
}

/**
 * Перевірка діапазонів «номер фото → тип» (як у Wix-компоненті «Створити бланк»).
 * ranges: [{from, to, type, group}] (from/to — числа або null).
 * Повертає null, якщо все гаразд, або { key, vars } для t(key, vars).
 * Порожні рядки (нічого не заповнено) ігноруються.
 */
export function validateTypeRanges(ranges) {
  const filled = (ranges || []).filter((r) => r.from !== null && r.from !== undefined || r.to !== null && r.to !== undefined || r.type);
  if (!filled.length) return null;
  for (const r of filled) {
    if (r.from === null || r.from === undefined || r.to === null || r.to === undefined || !r.type) return { key: 'ranges.errFill', vars: {} };
    if (r.from > r.to) return { key: 'ranges.errOrder', vars: { from: r.from, to: r.to } };
    if (r.from <= 0) return { key: 'ranges.errPositive', vars: {} };
  }
  const byGroup = {};
  filled.forEach((r) => { (byGroup[groupKey(r.group)] = byGroup[groupKey(r.group)] || []).push(r); });
  for (const key of Object.keys(byGroup)) {
    const sorted = [...byGroup[key]].sort((a, b) => a.from - b.from);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].to >= sorted[i + 1].from) {
        return {
          key: 'ranges.errOverlap',
          vars: { group: sorted[i].group || '', a: `${sorted[i].from}-${sorted[i].to}`, b: `${sorted[i + 1].from}-${sorted[i + 1].to}`, whereKey: key ? 'ranges.whereGroup' : 'ranges.whereRoot' }
        };
      }
    }
  }
  return null;
}
