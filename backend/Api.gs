/**
 * Api.gs — вхідні точки веб-застосунку, авторизація, публічні дії.
 *
 * Протокол: POST (Content-Type: text/plain) з JSON-тілом
 *   { "action": "...", ...параметри, "token": "..." }
 * Відповідь: { ok: true, data: ... } або { ok: false, error: { code, message } }
 */

// ---------------------------------------------------------------
// Вхідні точки
// ---------------------------------------------------------------

function doGet(e) {
  return json_({ ok: true, data: { service: 'azart-api', version: AZART.VERSION, time: iso_() } });
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (!raw) fail_('BAD_REQUEST', 'Порожній запит');
    if (raw.length > AZART.LIMITS.maxUploadBytes + 200000) fail_('TOO_LARGE', 'Запит завеликий');
    var req;
    try { req = JSON.parse(raw); } catch (err) { fail_('BAD_REQUEST', 'Некоректний JSON'); }
    if (!req || typeof req !== 'object') fail_('BAD_REQUEST', 'Некоректний запит');

    var action = String(req.action || '');
    var route = Object.prototype.hasOwnProperty.call(ROUTES_, action) ? ROUTES_[action] : null;
    if (!route) fail_('BAD_REQUEST', 'Невідома дія: ' + action.slice(0, 40));

    if (route.admin && !isAdmin_(req.token)) fail_('UNAUTHORIZED', 'Потрібен вхід адміністратора');

    return json_({ ok: true, data: route.fn(req) });
  } catch (err) {
    if (err instanceof ApiError_) {
      return json_({ ok: false, error: { code: err.code, message: err.message } });
    }
    console.error('API error: ' + (err && err.stack ? err.stack : err));
    return json_({ ok: false, error: { code: 'INTERNAL', message: 'Внутрішня помилка сервера' } });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

var ROUTES_ = {
  // публічні
  ping:             { fn: apiPing_ },
  whoami:           { fn: apiWhoami_ },
  login:            { fn: apiLogin_ },
  getPrices:        { fn: apiGetPrices_ },
  listAlbums:       { fn: apiListAlbums_ },
  getAlbum:         { fn: apiGetAlbum_ },
  groupOrderCounts: { fn: apiGroupOrderCounts_ },
  listGroupPhotos:  { fn: apiListGroupPhotos_ },
  listOrders:       { fn: apiListOrders_ },
  getOrder:         { fn: apiGetOrder_ },
  createOrder:      { fn: apiCreateOrder_ },
  // адміністратор
  adminOverview:    { fn: apiAdminOverview_, admin: true },
  saveAlbum:        { fn: apiSaveAlbum_, admin: true },
  deleteAlbum:      { fn: apiDeleteAlbum_, admin: true },
  savePrices:       { fn: apiSavePrices_, admin: true },
  setOrderStatus:   { fn: apiSetOrderStatus_, admin: true },
  deleteOrder:      { fn: apiDeleteOrder_, admin: true },
  listOrdersFull:   { fn: apiListOrdersFull_, admin: true },
  uploadGroupPhoto: { fn: apiUploadGroupPhoto_, admin: true },
  exportData:       { fn: apiExportData_, admin: true },
  importData:       { fn: apiImportData_, admin: true },
  migrateWixPhotos: { fn: apiMigrateWixPhotos_, admin: true },
  getSettings:      { fn: apiGetSettings_, admin: true },
  saveSettings:     { fn: apiSaveSettings_, admin: true }
};

// ---------------------------------------------------------------
// Авторизація
// ---------------------------------------------------------------

function tokenKey_() {
  var secret = prop_(PROPS.TOKEN_SECRET);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    setProp_(PROPS.TOKEN_SECRET, secret);
  }
  // Зміна пароля автоматично анулює всі видані токени.
  return secret + '|' + prop_(PROPS.ADMIN_PASSWORD);
}

function sign_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, tokenKey_()));
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function makeToken_() {
  var exp = Math.floor(Date.now() / 1000) + AZART.TOKEN_TTL_SEC;
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ exp: exp, v: 1 }));
  return { token: payload + '.' + sign_(payload), expiresAt: exp * 1000 };
}

function isAdmin_(token) {
  if (!token || typeof token !== 'string' || token.length > 500) return false;
  if (!prop_(PROPS.ADMIN_PASSWORD)) return false;
  var parts = token.split('.');
  if (parts.length !== 2) return false;
  if (!safeEqual_(sign_(parts[0]), parts[1])) return false;
  try {
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    return payload && payload.v === 1 && Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch (e) {
    return false;
  }
}

function rateLimit_(bucket, max, windowSec) {
  var cache = CacheService.getScriptCache();
  var key = 'rl:' + bucket;
  var n = Number(cache.get(key) || 0);
  if (n >= max) return false;
  cache.put(key, String(n + 1), windowSec);
  return true;
}

function apiLogin_(req) {
  var expected = prop_(PROPS.ADMIN_PASSWORD);
  if (!expected) fail_('NOT_CONFIGURED', 'Пароль адміністратора не задано (Script properties → ADMIN_PASSWORD).');

  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('loginFails') || 0);
  if (fails >= AZART.LOGIN_MAX_FAILS) {
    fail_('TOO_MANY', 'Забагато невдалих спроб. Зачекайте кілька хвилин.');
  }
  var given = typeof req.password === 'string' ? req.password.slice(0, 200) : '';
  // Порівнюємо HMAC-відбитки, щоб не залежати від довжини пароля
  var a = Utilities.base64Encode(Utilities.computeHmacSha256Signature(given, 'azart-login'));
  var b = Utilities.base64Encode(Utilities.computeHmacSha256Signature(expected, 'azart-login'));
  if (!given || !safeEqual_(a, b)) {
    cache.put('loginFails', String(fails + 1), AZART.LOGIN_WINDOW_SEC);
    Utilities.sleep(500);
    fail_('BAD_PASSWORD', 'Невірний пароль');
  }
  cache.remove('loginFails');
  return makeToken_();
}

function apiWhoami_(req) {
  return { admin: isAdmin_(req.token) };
}

function apiPing_() {
  var ready = true;
  try { ss_(); } catch (e) { ready = false; }
  return {
    service: 'azart-api', version: AZART.VERSION, time: iso_(),
    ready: ready, passwordSet: !!prop_(PROPS.ADMIN_PASSWORD)
  };
}

// ---------------------------------------------------------------
// Допоміжні
// ---------------------------------------------------------------

function groupKey_(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanGroupName_(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

function str_(v, max) {
  var s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return s.length > max ? s.slice(0, max) : s;
}

function todayKyiv_() {
  return Utilities.formatDate(new Date(), AZART.TZ, 'yyyy-MM-dd');
}

/** Бланк відкритий для замовлень, якщо кінцева дата не раніше сьогодні (включно з цим днем). */
function isOpen_(album) {
  if (!album.deadline) return true;
  return String(album.deadline).slice(0, 10) >= todayKyiv_();
}

function normList_(arr, allowed, normalizer) {
  var out = [];
  (Array.isArray(arr) ? arr : []).forEach(function (v) {
    var n = normalizer ? normalizer(v) : String(v);
    if (allowed.indexOf(n) >= 0 && out.indexOf(n) < 0) out.push(n);
  });
  // зберігаємо канонічний порядок довідника
  return allowed.filter(function (a) { return out.indexOf(a) >= 0; });
}

/** Приводить рядок аркуша «Albums» до робочого вигляду (нормалізація розмірів тощо). */
function albumFromRow_(r) {
  var a = {
    id: r.id, title: r.title, kindergarten: r.kindergarten || AZART.KINDERGARTENS_DEFAULT[0],
    deadline: String(r.deadline || '').slice(0, 10),
    driveFolderId: r.driveFolderId || '',
    types: normList_(r.types, AZART.TYPES),
    sizes: normList_(r.sizes, AZART.SIZES, normSize_),
    formats: normList_(r.formats, AZART.FORMATS),
    typeRanges: Array.isArray(r.typeRanges) ? r.typeRanges : [],
    discountEnabled: !!r.discountEnabled,
    createdAt: r.createdAt || '', updatedAt: r.updatedAt || '',
    __row: r.__row
  };
  return a;
}

function loadAlbums_() {
  return readAll_(SHEETS.ALBUMS).map(albumFromRow_);
}

function findAlbum_(id) {
  id = String(id || '');
  if (!id) return null;
  var all = loadAlbums_();
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function albumPublic_(a) {
  return {
    id: a.id, title: a.title, kindergarten: a.kindergarten, deadline: a.deadline,
    driveFolderId: a.driveFolderId, types: a.types, sizes: a.sizes, formats: a.formats,
    typeRanges: a.typeRanges, discountEnabled: a.discountEnabled,
    isPortrait: isPortraitAlbum_(a), open: isOpen_(a), createdAt: a.createdAt
  };
}

function maskName_(name) {
  var parts = String(name || '').trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return '';
  return parts[1] ? parts[0] + ' ' + parts[1].charAt(0).toUpperCase() + '.' : parts[0];
}

function maskPhone_(phone) {
  var s = String(phone || '');
  if (s.length <= 5) return s ? '•••' : '';
  return s.slice(0, 3) + new Array(s.length - 4).join('•') + s.slice(-2);
}

function orderSummary_(o, nameMode) {
  return {
    id: o.id,
    clientName: nameMode === 'short' ? maskName_(o.clientName) : o.clientName,
    totalPrice: o.totalPrice, totalPhotos: o.totalPhotos, status: o.status,
    groupFolderId: o.groupFolderId, groupName: o.groupName,
    isFullSession: o.isFullSession, createdAt: o.createdAt
  };
}

function itemOut_(i) {
  return {
    photoNumber: i.photoNumber, photoType: i.photoType, photoSize: i.photoSize,
    photoFormat: i.photoFormat, count: i.count, price: i.price
  };
}

function sortByCreatedDesc_(arr) {
  return arr.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; });
}

// ---------------------------------------------------------------
// Публічні дії (читання)
// ---------------------------------------------------------------

function apiGetPrices_() {
  return { prices: getPrices_() };
}

function apiListAlbums_(req) {
  var kg = req.kindergarten ? String(req.kindergarten) : '';
  var list = loadAlbums_().filter(function (a) { return !kg || a.kindergarten === kg; });
  list = sortByCreatedDesc_(list).map(albumPublic_);
  return { albums: list };
}

function apiGetAlbum_(req) {
  var a = findAlbum_(req.id);
  if (!a) fail_('NOT_FOUND', 'Бланк не знайдено');
  return { album: albumPublic_(a) };
}

function apiGroupOrderCounts_(req) {
  var albumId = String(req.albumId || '');
  var counts = {};
  readAll_(SHEETS.ORDERS).forEach(function (o) {
    if (o.albumId !== albumId) return;
    counts[o.groupFolderId] = (counts[o.groupFolderId] || 0) + 1;
  });
  return { counts: counts };
}

function apiListGroupPhotos_(req) {
  var kg = String(req.kindergarten || '');
  var photos = {};
  readAll_(SHEETS.GROUP_PHOTOS).forEach(function (r) {
    if (kg && r.kindergarten !== kg) return;
    if (r.photoUrl) photos[r.groupKey] = r.photoUrl;
  });
  return { photos: photos };
}

function apiListOrders_(req) {
  var albumId = String(req.albumId || '');
  var groupId = req.groupFolderId === undefined || req.groupFolderId === null ? null : String(req.groupFolderId);
  var mode = getSettings_().publicNameMode;
  var admin = isAdmin_(req.token);
  var list = readAll_(SHEETS.ORDERS).filter(function (o) {
    return o.albumId === albumId && (groupId === null || o.groupFolderId === groupId);
  });
  list = sortByCreatedDesc_(list).map(function (o) { return orderSummary_(o, admin ? 'full' : mode); });
  return { orders: list, admin: admin };
}

function apiGetOrder_(req) {
  var id = String(req.id || '');
  if (!id) fail_('BAD_REQUEST', 'Не вказано замовлення');
  var order = null;
  readAll_(SHEETS.ORDERS).some(function (o) { if (o.id === id) { order = o; return true; } return false; });
  if (!order) fail_('NOT_FOUND', 'Замовлення не знайдено');

  var admin = isAdmin_(req.token);
  var owner = !!req.key && safeEqual_(String(req.key), order.secret);
  var full = admin || owner;

  var items = readAll_(SHEETS.ITEMS)
    .filter(function (i) { return i.orderId === id; })
    .sort(function (a, b) { return a.position - b.position; })
    .map(itemOut_);

  var album = findAlbum_(order.albumId);
  var summary = orderSummary_(order, full ? 'full' : getSettings_().publicNameMode);
  summary.phone = full ? order.phone : maskPhone_(order.phone);
  summary.comment = full ? order.comment : '';
  summary.commentHidden = !full && !!order.comment;
  summary.items = items;
  summary.canSeeAll = full;
  summary.admin = admin;
  return {
    order: summary,
    album: album ? { id: album.id, title: album.title, kindergarten: album.kindergarten, isPortrait: isPortraitAlbum_(album) } : null
  };
}

// ---------------------------------------------------------------
// Створення замовлення
// ---------------------------------------------------------------

function validateOrder_(album, input) {
  var L = AZART.LIMITS;
  var name = str_(input.clientName, L.maxName).replace(/\s+/g, ' ').trim();
  if (!name) fail_('BAD_REQUEST', 'Вкажіть прізвище та ім\'я');
  var phone = str_(input.phone, L.maxPhone).trim();
  var digits = phone.replace(/\D/g, '');
  if (!/^[0-9+()\-.\s]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    fail_('BAD_PHONE', 'Вкажіть коректний номер телефону');
  }
  var comment = str_(input.comment, L.maxComment).trim();

  var groupFolderId = str_(input.groupFolderId, L.maxFolderId).trim();
  if (groupFolderId && !/^[\w-]+$/.test(groupFolderId)) fail_('BAD_REQUEST', 'Некоректна група');
  var groupName = cleanGroupName_(str_(input.groupName, L.maxGroupName));

  var rows = Array.isArray(input.items) ? input.items : [];
  if (!rows.length) fail_('BAD_REQUEST', 'Додайте хоча б одне фото');
  if (rows.length > L.maxItems) fail_('BAD_REQUEST', 'Забагато позицій у замовленні');

  var items = rows.map(function (r, idx) {
    var n = idx + 1;
    r = r || {};
    var photo = str_(r.photoNumber, L.maxPhotoName).trim();
    if (!photo) fail_('BAD_ITEM', 'Рядок ' + n + ': не вказано номер фото');
    var type = String(r.photoType || '');
    if (album.types.indexOf(type) < 0) fail_('BAD_ITEM', 'Рядок ' + n + ': недопустимий тип фото');
    var format = String(r.photoFormat || '');
    if (album.formats.indexOf(format) < 0) fail_('BAD_ITEM', 'Рядок ' + n + ': недопустимий формат');
    var size = normSize_(r.photoSize);
    var count = Math.floor(Number(r.count));
    if (format === AZART.FORMAT_DIGITAL) {
      size = '';
      count = 1;
    } else {
      if (album.sizes.indexOf(size) < 0) fail_('BAD_ITEM', 'Рядок ' + n + ': недопустимий розмір');
      if (!isFinite(count) || count < 1 || count > L.maxCount) fail_('BAD_ITEM', 'Рядок ' + n + ': кількість має бути від 1 до ' + L.maxCount);
    }
    return { photoNumber: photo, photoType: type, photoSize: size, photoFormat: format, count: count };
  });

  return {
    clientName: name, phone: phone, comment: comment,
    groupFolderId: groupFolderId, groupName: groupName,
    items: items, isFullSession: !!input.isFullSession
  };
}

function apiCreateOrder_(req) {
  var input = req.order;
  if (!input || typeof input !== 'object') fail_('BAD_REQUEST', 'Порожнє замовлення');
  var reqId = req.requestId ? String(req.requestId) : '';
  if (reqId && !/^[\w-]{8,64}$/.test(reqId)) fail_('BAD_REQUEST', 'Некоректний requestId');
  if (!rateLimit_('createOrder', 90, 60)) fail_('TOO_MANY', 'Забагато запитів. Спробуйте за хвилину.');
  var admin = isAdmin_(req.token);

  return withLock_(function () {
    var cache = CacheService.getScriptCache();
    if (reqId) {
      var hit = cache.get('rq:' + reqId);
      if (hit) { var prev = JSON.parse(hit); prev.duplicate = true; return prev; }
    }

    var album = findAlbum_(input.albumId);
    if (!album) fail_('NOT_FOUND', 'Бланк не знайдено');
    if (!admin && !isOpen_(album) && getSettings_().acceptAfterDeadline !== 'yes') {
      fail_('CLOSED', 'Прийом замовлень за цим бланком завершено');
    }

    var clean = validateOrder_(album, input);
    var calc = calcOrder_(getPrices_(), album, clean.items, clean.isFullSession);

    var id = newId_();
    var secret = newSecret_();
    var createdAt = iso_();
    var itemRows = calc.items.map(function (it, i) {
      return {
        id: newId_(), orderId: id, photoNumber: it.photoNumber, photoType: it.photoType,
        photoSize: it.photoSize, photoFormat: it.savedFormat, position: i + 1,
        count: it.count, price: it.price
      };
    });

    appendRows_(SHEETS.ITEMS, itemRows);
    try {
      appendRows_(SHEETS.ORDERS, [{
        id: id, secret: secret, albumId: album.id, clientName: clean.clientName, phone: clean.phone,
        comment: clean.comment, status: AZART.STATUSES[0], groupFolderId: clean.groupFolderId,
        groupName: clean.groupName, createdAt: createdAt, totalPrice: calc.total,
        totalPhotos: calc.totalPhotos, isFullSession: calc.fullSession
      }]);
    } catch (e) {
      try { deleteWhere_(SHEETS.ITEMS, function (r) { return r.orderId === id; }); } catch (e2) { /* ignore */ }
      throw e;
    }

    var result = {
      id: id, secret: secret, totalPrice: calc.total, totalPhotos: calc.totalPhotos,
      status: AZART.STATUSES[0], createdAt: createdAt, gift: calc.gift, percent: calc.percent,
      fullSession: calc.fullSession
    };
    if (reqId) cache.put('rq:' + reqId, JSON.stringify(result), AZART.IDEMPOTENCY_TTL_SEC);
    return result;
  });
}
