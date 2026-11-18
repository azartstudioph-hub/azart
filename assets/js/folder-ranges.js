// Діапазони типів фото з папки на комп'ютері адміністратора.
//
// Адміністратор перетягує у вікно бланка папку свята:
//   Свято осені / Група 6 / Репортаж / IMG_0001.JPG
//                        / Фон      / IMG_0420.JPG
//                        / Портрет  / …          (не завжди)
// Сайт читає лише шляхи й назви файлів (самі фото нікуди не завантажуються),
// бере номер із назви кожного файлу і складає з них діапазони для бланка.
//
// Тут лише чиста логіка без сторінки, щоб її можна було перевірити тестами.
import { TYPES, TYPE_PORTRAIT, groupKey, cleanGroupName, photoNumber } from './domain.js';

/** Файли, які вважаємо фотографіями (JPEG, PNG, TIFF, HEIC і RAW камер). */
const PHOTO_RE = /\.(jpe?g|png|tiff?|heic|heif|webp|bmp|cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|raf|orf|rw2|pef|srw|3fr|iiq)$/i;

export function isPhotoFile(name) {
  return PHOTO_RE.test(String(name || ''));
}

/** Тип за назвою підпапки: «Репортаж», «Фон», «На фоні», «Портрет» (регістр не важливий). */
export function typeFromFolderName(name) {
  const s = String(name || '').toLowerCase().replace(/ё/g, 'е').trim();
  if (!s) return null;
  if (/репорт|report/.test(s)) return 'Репортаж';
  if (/портрет|portrait/.test(s)) return 'Портрет';
  if (/(^|[^а-яіїєґ])фон|на\s*фоні|backdrop|background/.test(s)) return 'На фоні';
  return null;
}

/** Номер групи з назви: «Група 6», «гр6», «Гр. 6», «група №6», «6» → 6. */
export function groupNo(name) {
  const s = String(name || '').toLowerCase();
  const m = /гр(?:упа)?\.?\s*№?\s*(\d+)/.exec(s) || /group\s*(\d+)/.exec(s) || /^\s*(\d+)\s*$/.exec(s);
  return m ? Number(m[1]) : null;
}

/**
 * Розбирає список шляхів відносно перетягнутої папки («Свято/Група 6/Фон/IMG_1.JPG»).
 *
 * driveGroups — назви груп-папок цього бланка на Google Drive:
 *   null — невідомо (посилання не вказане або Drive не відповів): назви груп беремо з папки як є;
 *   []   — на Drive груп немає, фото лежать одразу в папці бланка: діапазони без групи;
 *   [..] — зіставляємо назви з папки з назвами на Drive (спершу точно, потім за номером групи).
 */
export function scanFolderPaths(paths, { driveGroups = null } = {}) {
  const groups = new Map();       // ключ — шлях до папки групи
  const loose = [];               // фото без папки типу: [{dir, name}]
  let ignored = 0;
  let total = 0;

  const groupFor = (dirs, typeIdx) => {
    const path = dirs.slice(0, typeIdx).join('/');
    if (!groups.has(path)) {
      groups.set(path, {
        path, local: typeIdx > 0 ? dirs[typeIdx - 1] : '', atRoot: typeIdx === 0,
        items: [], unsorted: 0, noNumber: 0
      });
    }
    return groups.get(path);
  };

  for (const raw of paths || []) {
    const segs = String(raw || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!segs.length) continue;
    const file = segs[segs.length - 1];
    if (!isPhotoFile(file)) { ignored++; continue; }
    total++;
    const dirs = segs.slice(0, -1);
    // найближча папка-предок, назва якої означає тип
    let typeIdx = -1, type = null;
    for (let i = dirs.length - 1; i >= 0; i--) {
      const tp = typeFromFolderName(dirs[i]);
      if (tp) { typeIdx = i; type = tp; break; }
    }
    if (typeIdx < 0) { loose.push(dirs.join('/')); continue; }
    const g = groupFor(dirs, typeIdx);
    const n = photoNumber(file);
    if (n === null) { g.noNumber++; continue; }
    g.items.push({ n, type, file });
  }

  // фото, що лежать просто в папці групи (поряд із підпапками типів), — неформовані
  for (const dir of loose) {
    const g = groups.get(dir);
    if (g) g.unsorted++;
  }

  // назви груп для бланка
  const driveKnown = Array.isArray(driveGroups);
  const driveList = driveKnown ? driveGroups.map((n) => ({ name: n, key: groupKey(n), no: groupNo(n) })) : [];
  const out = [];
  for (const g of groups.values()) {
    let name = cleanGroupName(g.local);
    let matched = null;                 // null — не перевіряли, true/false — знайдено на Drive чи ні
    if (driveKnown) {
      if (!driveList.length) { name = ''; matched = true; }
      else {
        const exact = driveList.find((d) => d.key === groupKey(g.local));
        const no = groupNo(g.local);
        const byNo = no !== null ? driveList.filter((d) => d.no === no) : [];
        if (exact) { name = exact.name; matched = true; }
        else if (byNo.length === 1) { name = byNo[0].name; matched = true; }
        else matched = false;
      }
    } else if (g.atRoot) {
      name = '';                         // підпапки типів лежать одразу в перетягнутій папці
    }
    out.push({ name, local: g.local, matched, items: g.items, unsorted: g.unsorted, noNumber: g.noNumber });
  }

  // групи з однаковою підсумковою назвою зливаємо (наприклад, кілька папок, коли на Drive груп немає)
  const merged = new Map();
  for (const g of out) {
    const k = groupKey(g.name);
    if (!merged.has(k)) merged.set(k, { ...g, items: [...g.items], locals: [g.local] });
    else {
      const m = merged.get(k);
      m.items.push(...g.items); m.unsorted += g.unsorted; m.noNumber += g.noNumber; m.locals.push(g.local);
      if (g.matched === false) m.matched = false;
    }
  }

  const foundTypes = new Set();
  for (const g of merged.values()) g.items.forEach((it) => foundTypes.add(it.type));

  return {
    groups: [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'uk', { numeric: true })),
    foundTypes: TYPES.filter((tp) => foundTypes.has(tp)),
    total, ignored
  };
}

/**
 * Діапазони з результату scanFolderPaths для дозволених у бланку типів.
 * Підряд ідучі номери одного типу стають одним діапазоном; пропуски в нумерації
 * (видалені кадри) діапазон не розривають, бо між ними немає фото іншого типу.
 * Номер, що трапився в кількох типах одразу, лишаємо без типу — його покаже звіт.
 */
export function rangesFromScan(scan, allowedTypes = TYPES) {
  const ranges = [];
  const perGroup = [];
  for (const g of scan.groups) {
    const byN = new Map();
    const skipped = {};
    for (const it of g.items) {
      if (!allowedTypes.includes(it.type)) { skipped[it.type] = (skipped[it.type] || 0) + 1; continue; }
      if (!byN.has(it.n)) byN.set(it.n, new Set());
      byN.get(it.n).add(it.type);
    }
    const conflicts = [];
    const seq = [];
    for (const [n, types] of [...byN.entries()].sort((a, b) => a[0] - b[0])) {
      if (types.size > 1) { conflicts.push(n); seq.push({ n, type: null }); }
      else seq.push({ n, type: [...types][0] });
    }
    const counts = {};
    let cur = null;
    let made = 0;
    for (const { n, type } of seq) {
      if (type) counts[type] = (counts[type] || 0) + 1;
      if (cur && cur.type === type && type) { cur.to = n; continue; }
      if (cur) { ranges.push(cur); made++; }
      cur = type ? { from: n, to: n, type, group: g.name } : null;
    }
    if (cur) { ranges.push(cur); made++; }
    perGroup.push({ name: g.name, locals: g.locals, matched: g.matched, counts, ranges: made,
      conflicts, unsorted: g.unsorted, noNumber: g.noNumber, skipped });
  }
  return { ranges, perGroup };
}

/**
 * Які типи має отримати бланк після сканування.
 * «Портрет» у бланку не поєднується з іншими типами (так само, як галочки у вікні).
 *  - бланк портретний → лише «Портрет», решту пропускаємо;
 *  - у папці лише портрети → переводимо бланк на «Портрет»;
 *  - інакше вмикаємо знайдені звичайні типи, портрет пропускаємо.
 */
export function typesAfterScan(currentTypes, foundTypes) {
  const cur = currentTypes || [];
  const found = foundTypes || [];
  const others = found.filter((tp) => tp !== TYPE_PORTRAIT);
  if (cur.length === 1 && cur[0] === TYPE_PORTRAIT) {
    return { types: cur, enabled: [], switchedToPortrait: false };
  }
  if (found.length && !others.length) {
    return { types: [TYPE_PORTRAIT], enabled: [], switchedToPortrait: !(cur.length === 1 && cur[0] === TYPE_PORTRAIT) };
  }
  const base = cur.filter((tp) => tp !== TYPE_PORTRAIT);
  const enabled = others.filter((tp) => !base.includes(tp));
  return { types: TYPES.filter((tp) => base.includes(tp) || enabled.includes(tp)), enabled, switchedToPortrait: false };
}

/** Нові діапазони замінюють старі лише для просканованих груп; решта лишається як була. */
export function mergeRanges(existing, generated, scannedGroupNames) {
  const keys = new Set((scannedGroupNames || []).map(groupKey));
  const kept = (existing || []).filter((r) => {
    const empty = (r.from === null || r.from === undefined) && (r.to === null || r.to === undefined) && !r.type;
    return !empty && !keys.has(groupKey(r.group));
  });
  return [...kept, ...generated];
}
