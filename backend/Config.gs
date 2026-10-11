/**
 * AZART — бекенд на Google Apps Script
 * ---------------------------------------------------------------
 * Config.gs — константи, обмеження, доступ до налаштувань скрипту.
 *
 * Усі файли .gs у проєкті Apps Script ділять одну глобальну область,
 * тому функції, які не є публічним входом (doGet/doPost/setup...),
 * мають назви із підкресленням у кінці.
 */

var AZART = {
  VERSION: '1.0.0',
  TZ: 'Europe/Kiev',

  // Доменні довідники (мають збігатися з assets/js/config.js)
  TYPES: ['Репортаж', 'На фоні', 'Портрет'],
  SIZES: ['10x15', '15x21', '20x30', '30x45'],
  FORMATS: ['Друковані', 'Електронні', 'Друковані + електронні'],
  STATUSES: ['Нове', 'В роботі', 'Готово'],
  KINDERGARTENS_DEFAULT: ['Сад 1', 'Сад 7'],

  FORMAT_PRINT: 'Друковані',
  FORMAT_DIGITAL: 'Електронні',
  FORMAT_BOTH: 'Друковані + електронні',
  TYPE_PORTRAIT: 'Портрет',

  // Обмеження вхідних даних
  LIMITS: {
    maxItems: 300,        // позицій у одному замовленні
    maxCount: 10,         // примірників одного фото
    maxName: 120,
    maxPhone: 30,
    maxComment: 1000,
    maxPhotoName: 120,
    maxTitle: 80,
    maxGroupName: 80,
    maxFolderId: 100,
    maxRanges: 100,
    maxBodyBytes: 600000, // тіло запиту (крім uploadGroupPhoto)
    maxUploadBytes: 3000000
  },

  TOKEN_TTL_SEC: 12 * 60 * 60,
  LOGIN_MAX_FAILS: 10,          // невдалих спроб ...
  LOGIN_WINDOW_SEC: 10 * 60,    // ... за такий проміжок => блокування
  IDEMPOTENCY_TTL_SEC: 6 * 60 * 60,
  LOCK_WAIT_MS: 25000
};

/** Назви аркушів таблиці. */
var SHEETS = {
  ALBUMS: 'Albums',
  ORDERS: 'Orders',
  ITEMS: 'OrderItems',
  PRICES: 'Prices',
  SETTINGS: 'Settings',
  GROUP_PHOTOS: 'GroupPhotos'
};

/**
 * Схеми аркушів: [назва колонки, тип].
 * Типи: s - текст, n - число, b - TRUE/FALSE, j - JSON-рядок.
 * Читання йде за назвами колонок із першого рядка, тому
 * порядок колонок в таблиці можна змінювати, а власні колонки — додавати.
 */
var SCHEMAS = {};
SCHEMAS[SHEETS.ALBUMS] = [
  ['id', 's'], ['title', 's'], ['kindergarten', 's'], ['deadline', 's'],
  ['driveFolderId', 's'], ['types', 'j'], ['sizes', 'j'], ['formats', 'j'],
  ['typeRanges', 'j'], ['createdAt', 's'], ['updatedAt', 's'],
  ['discountEnabled', 'b']
];
SCHEMAS[SHEETS.ORDERS] = [
  ['id', 's'], ['secret', 's'], ['albumId', 's'],
  ['clientName', 's'], ['phone', 's'], ['comment', 's'], ['status', 's'],
  ['groupFolderId', 's'], ['groupName', 's'], ['createdAt', 's'],
  ['totalPrice', 'n'], ['totalPhotos', 'n'], ['isFullSession', 'b']
];
SCHEMAS[SHEETS.ITEMS] = [
  ['id', 's'], ['orderId', 's'],
  ['photoNumber', 's'], ['photoType', 's'], ['photoSize', 's'], ['photoFormat', 's'],
  ['position', 'n'], ['count', 'n'], ['price', 'n']
];
SCHEMAS[SHEETS.PRICES] = [['key', 's'], ['value', 'n']];
SCHEMAS[SHEETS.SETTINGS] = [['key', 's'], ['value', 's']];
SCHEMAS[SHEETS.GROUP_PHOTOS] = [
  ['id', 's'], ['kindergarten', 's'], ['groupKey', 's'],
  ['photoUrl', 's'], ['updatedAt', 's']
];

/** Усі ключі цін, що їх знає система, та значення за замовчуванням. */
var PRICE_DEFAULTS = {
  background10X15Print: 60, background15X21Print: 90, background20X30Print: 150, background30X45Print: 200,
  reportage10X15Print: 40, reportage15X21Print: 60, reportage20X30Print: 100, reportage30X45Print: 150,
  portret10X15Print: 60, portret15X21Print: 80, portret20X30Print: 120, portret30X45Print: 150,
  backgroundDigital: 60, reportageDigital: 40, portretDigital: 60,
  printAndDigitalExtra: 10,
  discountThreshold: 600,
  discountPriceThreshold: 1000, discountPercent: 10,
  discountPriceThreshold2: 1500, discountPercent2: 15,
  discountPriceThreshold3: 2000, discountPercent3: 20,
  portretSessionPrice: 1000
};

/** Налаштування (аркуш Settings) та значення за замовчуванням. */
var SETTINGS_DEFAULTS = {
  // full - показувати ім'я як є; short - "Прізвище І." у публічному списку
  publicNameMode: 'full',
  // yes - сервер приймає замовлення і після кінцевої дати бланка (за замовчуванням - ні)
  acceptAfterDeadline: 'no'
};

// ---------------------------------------------------------------
// Властивості скрипту (Project Settings → Script properties)
// ---------------------------------------------------------------

var PROPS = {
  ADMIN_PASSWORD: 'ADMIN_PASSWORD',        // пароль адміністратора (ОБОВ'ЯЗКОВО)
  TOKEN_SECRET: 'TOKEN_SECRET',            // створюється автоматично
  SHEET_ID: 'SHEET_ID',                    // якщо скрипт не прив'язаний до таблиці
  GROUP_PHOTOS_FOLDER_ID: 'GROUP_PHOTOS_FOLDER_ID'
};

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function setProp_(name, value) {
  PropertiesService.getScriptProperties().setProperty(name, String(value));
}
