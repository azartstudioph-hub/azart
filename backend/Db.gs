/**
 * Db.gs — робота з Google Таблицею як з базою даних.
 *
 * Принципи:
 *  - колонки читаються за назвами з першого рядка (порядок колонок не важливий);
 *  - текстові колонки завжди мають формат "@" (щоб телефон 0959... не став числом);
 *  - усі записи роблять під скриптовим замком (withLock_);
 *  - відсутні колонки/аркуші створюються автоматично.
 */

var DB_ = { ss: null, headers: {} };

function ApiError_(code, message) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message || code;
}
ApiError_.prototype = Object.create(Error.prototype);
ApiError_.prototype.constructor = ApiError_;

function fail_(code, message) {
  throw new ApiError_(code, message);
}

// ---------------------------------------------------------------
// Підключення до таблиці
// ---------------------------------------------------------------

function ss_() {
  if (DB_.ss) return DB_.ss;
  var id = prop_(PROPS.SHEET_ID);
  var ss = null;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  }
  if (!ss) fail_('NOT_CONFIGURED', 'Таблицю не налаштовано. Запустіть функцію setup() у редакторі Apps Script.');
  DB_.ss = ss;
  return ss;
}

function typeMap_(name) {
  var map = {};
  SCHEMAS[name].forEach(function (c) { map[c[0]] = c[1]; });
  return map;
}

function isTextType_(t) { return t === 's' || t === 'j'; }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) sh = createSheet_(name);
  return sh;
}

function createSheet_(name) {
  var schema = SCHEMAS[name];
  if (!schema) fail_('INTERNAL', 'Невідомий аркуш ' + name);
  var sh = ss_().insertSheet(name);
  var names = schema.map(function (c) { return c[0]; });
  sh.getRange(1, 1, 1, names.length).setValues([names]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // Текстовий формат для всіх рядків, що вже існують в аркуші (далі - при додаванні).
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  var types = typeMap_(name);
  var runs = textRuns_(names, types);
  runs.forEach(function (r) { sh.getRange(2, r[0], rows, r[1]).setNumberFormat('@'); });
  delete DB_.headers[name];
  return sh;
}

/** Повертає назви колонок аркуша; додає у кінець колонки зі схеми, яких бракує. */
function headers_(sh, name) {
  if (DB_.headers[name]) return DB_.headers[name];
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var raw = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); });
  var missing = SCHEMAS[name].map(function (c) { return c[0]; }).filter(function (n) { return raw.indexOf(n) < 0; });
  if (missing.length) {
    // Перша порожня колонка в кінці заголовків
    var firstEmpty = raw.length;
    while (firstEmpty > 0 && !raw[firstEmpty - 1]) firstEmpty--;
    sh.getRange(1, firstEmpty + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    raw = raw.slice(0, firstEmpty).concat(missing);
  }
  DB_.headers[name] = raw;
  return raw;
}

/** Безперервні відрізки текстових колонок: [[початок(1-based), довжина], ...]. */
function textRuns_(headers, types) {
  var runs = [];
  var cur = null;
  for (var i = 0; i < headers.length; i++) {
    var t = types[headers[i]];
    if (t && isTextType_(t)) {
      if (cur && cur[0] + cur[1] === i + 1) cur[1]++;
      else { cur = [i + 1, 1]; runs.push(cur); }
    }
  }
  return runs;
}

// ---------------------------------------------------------------
// Серіалізація
// ---------------------------------------------------------------

function iso_(d) {
  return Utilities.formatDate(d || new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function coerce_(type, v) {
  switch (type) {
    case 'n':
      if (v === '' || v === null || v === undefined) return 0;
      var n = Number(v);
      return isFinite(n) ? n : 0;
    case 'b':
      return v === true || String(v).toLowerCase() === 'true';
    case 'j':
      if (v === '' || v === null || v === undefined) return null;
      try { return JSON.parse(v); } catch (e) { return null; }
    default:
      if (v instanceof Date) return iso_(v);
      return v === null || v === undefined ? '' : String(v);
  }
}

function ser_(type, v) {
  switch (type) {
    case 'n': var n = Number(v); return isFinite(n) ? n : 0;
    case 'b': return !!v;
    case 'j': return JSON.stringify(v === undefined ? null : v);
    default: return v === null || v === undefined ? '' : String(v);
  }
}

// ---------------------------------------------------------------
// Читання / запис
// ---------------------------------------------------------------

/** Усі рядки аркуша як об'єкти (з __row - номер рядка в таблиці). */
function readAll_(name) {
  var sh = sheet_(name);
  var hs = headers_(sh, name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, hs.length).getValues();
  var types = typeMap_(name);
  var keyName = SCHEMAS[name][0][0];
  var keyIdx = hs.indexOf(keyName);
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (row[keyIdx] === '' || row[keyIdx] === null) continue;
    var o = { __row: i + 2 };
    for (var c = 0; c < hs.length; c++) {
      if (!hs[c]) continue;
      o[hs[c]] = coerce_(types[hs[c]] || 's', row[c]);
    }
    out.push(o);
  }
  return out;
}

function toRow_(hs, types, obj) {
  return hs.map(function (h) {
    return h && Object.prototype.hasOwnProperty.call(obj, h) ? ser_(types[h] || 's', obj[h]) : '';
  });
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var hs = headers_(sh, name);
  var types = typeMap_(name);
  var rows = objs.map(function (o) { return toRow_(hs, types, o); });
  var start = Math.max(sh.getLastRow(), 1) + 1;
  var need = start + rows.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
  textRuns_(hs, types).forEach(function (r) {
    sh.getRange(start, r[0], rows.length, r[1]).setNumberFormat('@');
  });
  sh.getRange(start, 1, rows.length, hs.length).setValues(rows);
}

/** Повністю переписує рядок (об'єкт має містити __row з readAll_). */
function writeRow_(name, obj) {
  var sh = sheet_(name);
  var hs = headers_(sh, name);
  var types = typeMap_(name);
  var row = toRow_(hs, types, obj);
  sh.getRange(obj.__row, 1, 1, hs.length).setValues([row]);
}

/** Видаляє рядки, для яких keep(obj) === false. Повертає кількість видалених. */
function deleteWhere_(name, shouldDelete) {
  var sh = sheet_(name);
  var hs = headers_(sh, name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var types = typeMap_(name);
  var range = sh.getRange(2, 1, lastRow - 1, hs.length);
  var values = range.getValues();
  var keep = [];
  var removed = 0;
  for (var i = 0; i < values.length; i++) {
    var o = {};
    for (var c = 0; c < hs.length; c++) { if (hs[c]) o[hs[c]] = coerce_(types[hs[c]] || 's', values[i][c]); }
    if (shouldDelete(o)) removed++;
    else keep.push(values[i]);
  }
  if (!removed) return 0;
  // Спочатку записуємо те, що залишається, потім очищуємо хвіст.
  if (keep.length) {
    textRuns_(hs, types).forEach(function (r) { sh.getRange(2, r[0], keep.length, r[1]).setNumberFormat('@'); });
    sh.getRange(2, 1, keep.length, hs.length).setValues(keep);
  }
  var tail = values.length - keep.length;
  if (tail > 0) sh.getRange(2 + keep.length, 1, tail, hs.length).clearContent();
  return removed;
}

// ---------------------------------------------------------------
// Замок і ідемпотентність
// ---------------------------------------------------------------

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(AZART.LOCK_WAIT_MS)) fail_('BUSY', 'Сервер зайнятий, спробуйте ще раз за кілька секунд.');
  try {
    // Кеш заголовків і таблиці діє лише в межах одного виклику.
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function newId_() { return Utilities.getUuid(); }

function newSecret_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 24); }

// ---------------------------------------------------------------
// Ціни та налаштування (аркуші key/value)
// ---------------------------------------------------------------

function getPrices_() {
  var out = {};
  Object.keys(PRICE_DEFAULTS).forEach(function (k) { out[k] = PRICE_DEFAULTS[k]; });
  readAll_(SHEETS.PRICES).forEach(function (r) {
    if (Object.prototype.hasOwnProperty.call(PRICE_DEFAULTS, r.key)) out[r.key] = r.value;
  });
  return out;
}

function savePrices_(input) {
  var rows = readAll_(SHEETS.PRICES);
  var byKey = {};
  rows.forEach(function (r) { byKey[r.key] = r; });
  var toAppend = [];
  Object.keys(PRICE_DEFAULTS).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(input, k)) return;
    var n = Number(input[k]);
    if (!isFinite(n) || n < 0 || n > 1000000) fail_('BAD_REQUEST', 'Некоректне значення ціни: ' + k);
    n = Math.round(n * 100) / 100;
    if (byKey[k]) { byKey[k].value = n; writeRow_(SHEETS.PRICES, byKey[k]); }
    else toAppend.push({ key: k, value: n });
  });
  if (toAppend.length) appendRows_(SHEETS.PRICES, toAppend);
  return getPrices_();
}

function getSettings_() {
  var out = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(function (k) { out[k] = SETTINGS_DEFAULTS[k]; });
  readAll_(SHEETS.SETTINGS).forEach(function (r) {
    if (Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, r.key)) out[r.key] = r.value;
  });
  return out;
}
