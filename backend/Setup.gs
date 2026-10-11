/**
 * Setup.gs — одноразове налаштування та службові функції.
 * Запускаються вручну з редактора Apps Script (меню «Виконати»).
 */

/**
 * ЗАПУСТІТЬ ОДИН РАЗ після вставлення коду.
 * Створює аркуші в таблиці, ціни за замовчуванням, секрет для токенів
 * і папку Google Drive для фото груп. Безпечно запускати повторно.
 */
function setup() {
  var log = [];

  // 1. Таблиця
  var id = prop_(PROPS.SHEET_ID);
  var ss = null;
  if (id) {
    ss = SpreadsheetApp.openById(id);
    log.push('Таблиця: ' + ss.getName());
  } else {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
    if (!ss) {
      ss = SpreadsheetApp.create('AZART — база даних');
      log.push('Створено нову таблицю: ' + ss.getUrl());
    } else {
      log.push('Використовується таблиця, до якої прив\'язано скрипт: ' + ss.getName());
    }
    setProp_(PROPS.SHEET_ID, ss.getId());
  }
  DB_.ss = ss;
  DB_.headers = {};

  // 2. Аркуші
  Object.keys(SHEETS).forEach(function (k) { headers_(sheet_(SHEETS[k]), SHEETS[k]); });
  // Прибрати порожній аркуш за замовчуванням ("Аркуш1" / "Sheet1")
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    var known = Object.keys(SHEETS).some(function (k) { return SHEETS[k] === n; });
    if (!known && sh.getLastRow() === 0 && sh.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
    }
  });
  log.push('Аркуші: ' + Object.keys(SHEETS).map(function (k) { return SHEETS[k]; }).join(', '));

  // 3. Ціни за замовчуванням (лише якщо порожньо)
  if (!readAll_(SHEETS.PRICES).length) {
    appendRows_(SHEETS.PRICES, Object.keys(PRICE_DEFAULTS).map(function (k) { return { key: k, value: PRICE_DEFAULTS[k] }; }));
    log.push('Записано ціни за замовчуванням (змініть їх на сайті: Адмін → Налаштування цін).');
  }
  if (!readAll_(SHEETS.SETTINGS).length) {
    appendRows_(SHEETS.SETTINGS, Object.keys(SETTINGS_DEFAULTS).map(function (k) { return { key: k, value: SETTINGS_DEFAULTS[k] }; }));
  }

  // 4. Секрет токенів
  tokenKey_();

  // 5. Пароль адміністратора
  if (!prop_(PROPS.ADMIN_PASSWORD)) {
    var pass = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    setProp_(PROPS.ADMIN_PASSWORD, pass);
    log.push('ПАРОЛЬ АДМІНІСТРАТОРА (було не задано, створено автоматично): ' + pass);
    log.push('Змінити: Project Settings → Script properties → ADMIN_PASSWORD.');
  } else {
    log.push('Пароль адміністратора вже задано.');
  }

  // 6. Папка для фото груп
  var folder = groupPhotosFolder_();
  log.push('Папка для фото груп: ' + folder.getUrl());

  log.push('Готово. Тепер: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.');
  log.forEach(function (l) { console.log(l); });
  return log.join('\n');
}

/** Перевірка стану (запускайте після змін, дивіться журнал виконання). */
function selfTest() {
  var out = [];
  function check(name, fn) {
    try { var r = fn(); out.push('OK   ' + name + (r ? ': ' + r : '')); } catch (e) { out.push('FAIL ' + name + ': ' + (e.message || e)); }
  }
  check('Таблиця', function () { return ss_().getName(); });
  Object.keys(SHEETS).forEach(function (k) {
    check('Аркуш ' + SHEETS[k], function () { return readAll_(SHEETS[k]).length + ' рядків'; });
  });
  check('ADMIN_PASSWORD', function () { if (!prop_(PROPS.ADMIN_PASSWORD)) throw new Error('не задано'); return 'задано'; });
  check('Папка фото груп', function () { return groupPhotosFolder_().getName(); });
  check('Ціни', function () { return Object.keys(getPrices_()).length + ' ключів'; });
  out.forEach(function (l) { console.log(l); });
  return out.join('\n');
}

/** Видалити «осиротілі» позиції (без замовлення) — обслуговування. */
function cleanOrphans() {
  return withLock_(function () {
    var ids = {};
    readAll_(SHEETS.ORDERS).forEach(function (o) { ids[o.id] = true; });
    var n = deleteWhere_(SHEETS.ITEMS, function (i) { return !ids[i.orderId]; });
    console.log('Видалено позицій без замовлення: ' + n);
    return n;
  });
}
