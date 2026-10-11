/**
 * Admin.gs — дії, доступні лише адміністратору (потрібен токен після login).
 */

// ---------------------------------------------------------------
// Огляд
// ---------------------------------------------------------------

function apiAdminOverview_() {
  var counts = {};
  var orders = readAll_(SHEETS.ORDERS);
  orders.forEach(function (o) { counts[o.albumId] = (counts[o.albumId] || 0) + 1; });
  var albums = sortByCreatedDesc_(loadAlbums_()).map(function (a) {
    var p = albumPublic_(a);
    p.orderCount = counts[a.id] || 0;
    return p;
  });
  return { albums: albums, totals: { albums: albums.length, orders: orders.length } };
}

// ---------------------------------------------------------------
// Бланки
// ---------------------------------------------------------------

function validateAlbum_(a) {
  var L = AZART.LIMITS;
  var title = str_(a.title, L.maxTitle).replace(/\s+/g, ' ').trim();
  if (!title) fail_('BAD_REQUEST', 'Вкажіть назву бланка');
  var kindergarten = str_(a.kindergarten, 40).trim();
  if (!kindergarten) fail_('BAD_REQUEST', 'Оберіть садочок');

  var types = normList_(a.types, AZART.TYPES);
  if (!types.length) fail_('BAD_REQUEST', 'Оберіть хоча б один тип фото');
  if (types.indexOf(AZART.TYPE_PORTRAIT) >= 0 && types.length > 1) {
    fail_('BAD_REQUEST', 'Тип «Портрет» не можна поєднувати з іншими типами');
  }
  var sizes = normList_(a.sizes, AZART.SIZES, normSize_);
  if (!sizes.length) fail_('BAD_REQUEST', 'Оберіть хоча б один розмір');
  var formats = normList_(a.formats, AZART.FORMATS);
  if (!formats.length) fail_('BAD_REQUEST', 'Оберіть хоча б один формат');

  var deadline = String(a.deadline || '').trim();
  if (deadline) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline);
    var d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
      fail_('BAD_REQUEST', 'Некоректна кінцева дата');
    }
  }
  var folder = str_(a.driveFolderId, L.maxFolderId).trim();
  if (folder && !/^[\w-]+$/.test(folder)) fail_('BAD_REQUEST', 'Некоректний ID папки Google Drive');

  var ranges = [];
  (Array.isArray(a.typeRanges) ? a.typeRanges : []).slice(0, L.maxRanges).forEach(function (r) {
    if (!r) return;
    var from = Math.floor(Number(r.from)), to = Math.floor(Number(r.to));
    if (!isFinite(from) || !isFinite(to) || from < 0 || to < from || to > 99999999) return;
    if (types.indexOf(r.type) < 0) return;
    ranges.push({ from: from, to: to, type: r.type, group: cleanGroupName_(str_(r.group, L.maxGroupName)) });
  });

  return {
    title: title, kindergarten: kindergarten, deadline: deadline, driveFolderId: folder,
    types: types, sizes: sizes, formats: formats, typeRanges: ranges,
    discountEnabled: !!a.discountEnabled
  };
}

function apiSaveAlbum_(req) {
  var input = req.album;
  if (!input || typeof input !== 'object') fail_('BAD_REQUEST', 'Порожній бланк');
  var clean = validateAlbum_(input);
  return withLock_(function () {
    var now = iso_();
    var rows = readAll_(SHEETS.ALBUMS);
    // назви бланків мають бути унікальними (без урахування регістру й зайвих пробілів)
    var norm = function (s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
    rows.forEach(function (r) {
      if (r.id !== input.id && norm(r.title) === norm(clean.title)) fail_('DUPLICATE', 'Бланк «' + r.title + '» вже існує.');
    });
    if (input.id) {
      var row = null;
      rows.forEach(function (r) { if (r.id === input.id) row = r; });
      if (!row) fail_('NOT_FOUND', 'Бланк не знайдено');
      Object.keys(clean).forEach(function (k) { row[k] = clean[k]; });
      row.updatedAt = now;
      writeRow_(SHEETS.ALBUMS, row);
      return { album: albumPublic_(albumFromRow_(row)) };
    }
    var obj = {};
    Object.keys(clean).forEach(function (k) { obj[k] = clean[k]; });
    obj.id = newId_();
    obj.createdAt = now;
    obj.updatedAt = now;
    appendRows_(SHEETS.ALBUMS, [obj]);
    return { album: albumPublic_(albumFromRow_(obj)) };
  });
}

function apiDeleteAlbum_(req) {
  var id = String(req.id || '');
  if (!id) fail_('BAD_REQUEST', 'Не вказано бланк');
  return withLock_(function () {
    if (!findAlbum_(id)) fail_('NOT_FOUND', 'Бланк не знайдено');
    var orderIds = {};
    readAll_(SHEETS.ORDERS).forEach(function (o) { if (o.albumId === id) orderIds[o.id] = true; });
    var items = deleteWhere_(SHEETS.ITEMS, function (i) { return orderIds[i.orderId] === true; });
    var orders = deleteWhere_(SHEETS.ORDERS, function (o) { return o.albumId === id; });
    deleteWhere_(SHEETS.ALBUMS, function (a) { return a.id === id; });
    return { deleted: true, orders: orders, items: items };
  });
}

// ---------------------------------------------------------------
// Ціни та налаштування
// ---------------------------------------------------------------

function apiSavePrices_(req) {
  if (!req.prices || typeof req.prices !== 'object') fail_('BAD_REQUEST', 'Порожні ціни');
  return withLock_(function () { return { prices: savePrices_(req.prices) }; });
}

function apiGetSettings_() {
  return { settings: getSettings_() };
}

function apiSaveSettings_(req) {
  var input = req.settings || {};
  var allowed = {
    publicNameMode: ['full', 'short'],
    acceptAfterDeadline: ['yes', 'no']
  };
  return withLock_(function () {
    var rows = readAll_(SHEETS.SETTINGS);
    var byKey = {};
    rows.forEach(function (r) { byKey[r.key] = r; });
    var add = [];
    Object.keys(allowed).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(input, k)) return;
      var v = String(input[k]);
      if (allowed[k].indexOf(v) < 0) fail_('BAD_REQUEST', 'Некоректне значення: ' + k);
      if (byKey[k]) { byKey[k].value = v; writeRow_(SHEETS.SETTINGS, byKey[k]); }
      else add.push({ key: k, value: v });
    });
    if (add.length) appendRows_(SHEETS.SETTINGS, add);
    return { settings: getSettings_() };
  });
}

// ---------------------------------------------------------------
// Замовлення
// ---------------------------------------------------------------

function apiSetOrderStatus_(req) {
  var id = String(req.id || '');
  var status = String(req.status || '');
  if (AZART.STATUSES.indexOf(status) < 0) fail_('BAD_REQUEST', 'Недопустимий статус');
  return withLock_(function () {
    var row = null;
    readAll_(SHEETS.ORDERS).forEach(function (o) { if (o.id === id) row = o; });
    if (!row) fail_('NOT_FOUND', 'Замовлення не знайдено');
    row.status = status;
    writeRow_(SHEETS.ORDERS, row);
    return { id: id, status: status };
  });
}

function apiDeleteOrder_(req) {
  var id = String(req.id || '');
  return withLock_(function () {
    var n = deleteWhere_(SHEETS.ORDERS, function (o) { return o.id === id; });
    if (!n) fail_('NOT_FOUND', 'Замовлення не знайдено');
    deleteWhere_(SHEETS.ITEMS, function (i) { return i.orderId === id; });
    return { deleted: true };
  });
}

/** Замовлення бланка разом з позиціями і контактами (для друку та адмін-сторінок). */
function apiListOrdersFull_(req) {
  var albumId = String(req.albumId || '');
  var groupId = req.groupFolderId === undefined || req.groupFolderId === null ? null : String(req.groupFolderId);
  var orders = readAll_(SHEETS.ORDERS).filter(function (o) {
    return o.albumId === albumId && (groupId === null || o.groupFolderId === groupId);
  });
  var set = {};
  orders.forEach(function (o) { set[o.id] = true; });
  var byOrder = {};
  readAll_(SHEETS.ITEMS).forEach(function (i) {
    if (!set[i.orderId]) return;
    (byOrder[i.orderId] = byOrder[i.orderId] || []).push(i);
  });
  var out = sortByCreatedDesc_(orders).map(function (o) {
    var s = orderSummary_(o, 'full');
    s.phone = o.phone;
    s.comment = o.comment;
    s.items = (byOrder[o.id] || []).sort(function (a, b) { return a.position - b.position; }).map(itemOut_);
    return s;
  });
  return { orders: out };
}

// ---------------------------------------------------------------
// Експорт для програми сортування фото (формат як у Wix exportData)
// ---------------------------------------------------------------

function cyrSize_(s) {
  // У Wix розміри містили кириличну «х» (10х15) — сортувальник очікує саме її.
  return String(s || '').replace(/x/g, 'х');
}

function apiExportData_(req) {
  var albumId = req.albumId ? String(req.albumId) : '';
  if (!albumId) {
    return {
      albums: sortByCreatedDesc_(loadAlbums_()).map(function (a) { return { id: a.id, title: a.title || '' }; })
    };
  }
  var album = findAlbum_(albumId);
  if (!album) fail_('NOT_FOUND', 'Бланк не знайдено');
  var orders = readAll_(SHEETS.ORDERS).filter(function (o) { return o.albumId === albumId; });
  orders.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; });
  var set = {};
  orders.forEach(function (o) { set[o.id] = true; });
  var byOrder = {};
  readAll_(SHEETS.ITEMS).forEach(function (i) {
    if (!set[i.orderId]) return;
    (byOrder[i.orderId] = byOrder[i.orderId] || []).push(i);
  });
  return {
    album: { id: album.id, title: album.title || '' },
    orders: orders.map(function (o) {
      var items = (byOrder[o.id] || []).sort(function (a, b) { return a.position - b.position; });
      return {
        id: o.id,
        name: o.clientName || '',
        group: o.groupName || '',
        groupFolderId: o.groupFolderId || '',
        items: items.map(function (i) {
          return { photo: i.photoNumber || '', size: cyrSize_(i.photoSize), format: i.photoFormat || '', count: Number(i.count) || 1 };
        })
      };
    })
  };
}

// ---------------------------------------------------------------
// Фото груп (бібліотека, спільна для садочка)
// ---------------------------------------------------------------

function groupPhotosFolder_() {
  var id = prop_(PROPS.GROUP_PHOTOS_FOLDER_ID);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* створимо нову */ }
  }
  var folder = DriveApp.createFolder('AZART — фото груп');
  try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) { /* політика домену */ }
  setProp_(PROPS.GROUP_PHOTOS_FOLDER_ID, folder.getId());
  return folder;
}

function imageKind_(bytes) {
  function u(i) { return (bytes[i] + 256) % 256; }
  if (bytes.length > 12) {
    if (u(0) === 0xFF && u(1) === 0xD8 && u(2) === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
    if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47) return { mime: 'image/png', ext: 'png' };
    if (u(0) === 0x52 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x46 &&
        u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50) return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

function driveThumbUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';
}

function driveIdFromUrl_(url) {
  var m = /[?&]id=([\w-]+)/.exec(String(url || ''));
  return m && /drive\.google\.com/.test(url) ? m[1] : '';
}

/** Створює/оновлює запис бібліотеки (kindergarten + groupKey). */
function upsertGroupPhoto_(rows, kindergarten, groupName, photoUrl) {
  var key = groupKey_(groupName);
  var found = null;
  rows.forEach(function (r) { if (r.kindergarten === kindergarten && r.groupKey === key) found = r; });
  var now = iso_();
  if (found) {
    var old = found.photoUrl;
    found.photoUrl = photoUrl;
    found.updatedAt = now;
    writeRow_(SHEETS.GROUP_PHOTOS, found);
    return { key: key, previousUrl: old, created: false };
  }
  var obj = { id: newId_(), kindergarten: kindergarten, groupKey: key, photoUrl: photoUrl, updatedAt: now };
  appendRows_(SHEETS.GROUP_PHOTOS, [obj]);
  rows.push(obj);
  return { key: key, previousUrl: '', created: true };
}

function apiUploadGroupPhoto_(req) {
  var kg = str_(req.kindergarten, 40).trim();
  var groupName = cleanGroupName_(str_(req.groupName, AZART.LIMITS.maxGroupName));
  if (!kg || !groupName) fail_('BAD_REQUEST', 'Вкажіть садочок і групу');
  var b64 = String(req.data || '').replace(/^data:[^,]*,/, '');
  if (!b64 || b64.length > Math.ceil(AZART.LIMITS.maxUploadBytes * 4 / 3) + 16) fail_('TOO_LARGE', 'Файл завеликий');
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (e) { fail_('BAD_REQUEST', 'Некоректні дані зображення'); }
  if (bytes.length > AZART.LIMITS.maxUploadBytes) fail_('TOO_LARGE', 'Файл завеликий');
  var kind = imageKind_(bytes);
  if (!kind) fail_('BAD_REQUEST', 'Підтримуються лише зображення JPEG, PNG або WebP');

  return withLock_(function () {
    var folder = groupPhotosFolder_();
    var fileName = (kg + ' — ' + groupName + ' — ' + iso_().replace(/[:T]/g, '-').slice(0, 19) + '.' + kind.ext).replace(/[\\/:*?"<>|]/g, '_');
    var file = folder.createFile(Utilities.newBlob(bytes, kind.mime, fileName));
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* успадкує від папки */ }
    var url = driveThumbUrl_(file.getId());
    var res = upsertGroupPhoto_(readAll_(SHEETS.GROUP_PHOTOS), kg, groupName, url);
    var oldId = driveIdFromUrl_(res.previousUrl);
    if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e3) { /* ignore */ } }
    return { photoUrl: url, groupKey: res.key };
  });
}

/**
 * Переносить фото груп зі старого Wix (static.wixstatic.com) у Google Drive.
 * Викликається частинами; повертає, скільки ще залишилось.
 */
function apiMigrateWixPhotos_(req) {
  var limit = Math.max(1, Math.min(20, Math.floor(Number(req.limit)) || 5));
  var started = Date.now();
  return withLock_(function () {
    var rows = readAll_(SHEETS.GROUP_PHOTOS);
    // skip — скільки перших рядків пропустити (ті, що вже не вдалося перенести), щоб не зациклитись на них
    var skip = Math.max(0, Math.floor(Number(req.skip)) || 0);
    var pending = rows.filter(function (r) { return /^https:\/\/static\.wixstatic\.com\//.test(r.photoUrl); }).slice(skip);
    var done = 0, failed = [];
    var folder = null;
    for (var i = 0; i < pending.length && done + failed.length < limit; i++) {
      if (Date.now() - started > 240000) break;
      var r = pending[i];
      try {
        var resp = UrlFetchApp.fetch(r.photoUrl, { muteHttpExceptions: true, followRedirects: true });
        if (resp.getResponseCode() !== 200) throw new Error('HTTP ' + resp.getResponseCode());
        var bytes = resp.getContent();
        var kind = imageKind_(bytes);
        if (!kind) throw new Error('не зображення');
        folder = folder || groupPhotosFolder_();
        var name = (r.kindergarten + ' — ' + r.groupKey + '.' + kind.ext).replace(/[\\/:*?"<>|]/g, '_');
        var file = folder.createFile(Utilities.newBlob(bytes, kind.mime, name));
        try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* ignore */ }
        r.photoUrl = driveThumbUrl_(file.getId());
        r.updatedAt = iso_();
        writeRow_(SHEETS.GROUP_PHOTOS, r);
        done++;
      } catch (err) {
        failed.push({ group: r.groupKey, kindergarten: r.kindergarten, error: String(err.message || err).slice(0, 120) });
      }
    }
    var remaining = rows.filter(function (r) { return /^https:\/\/static\.wixstatic\.com\//.test(r.photoUrl); }).length;
    return { migrated: done, failed: failed, remaining: remaining };
  });
}

// ---------------------------------------------------------------
// Імпорт даних з Wix (ідемпотентний: повторний запуск оновлює, а не дублює)
// ---------------------------------------------------------------

function importId_(v) {
  var s = String(v || '').trim();
  return /^[\w-]{1,64}$/.test(s) ? s : '';
}

function importDate_(v, fallback) {
  var s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s) ? s : fallback;
}

function apiImportData_(req) {
  var d = req.data;
  if (!d || typeof d !== 'object') fail_('BAD_REQUEST', 'Порожні дані імпорту');
  ['albums', 'orders', 'items', 'groupPhotos'].forEach(function (k) {
    if (d[k] !== undefined && (!Array.isArray(d[k]) || d[k].length > 2000)) fail_('BAD_REQUEST', 'Некоректний список: ' + k);
  });
  var L = AZART.LIMITS;

  return withLock_(function () {
    var stats = {
      albums: { added: 0, updated: 0 }, orders: { added: 0, updated: 0 },
      items: { added: 0, updated: 0 }, groupPhotos: { added: 0, updated: 0 }, prices: 0,
      warnings: []
    };
    var now = iso_();

    // --- бланки
    var existingAlbums = {};
    readAll_(SHEETS.ALBUMS).forEach(function (r) { existingAlbums[r.id] = r; });
    var addAlbums = [];
    (d.albums || []).forEach(function (a, idx) {
      var id = importId_(a && a.id);
      if (!id) { stats.warnings.push('Бланк №' + (idx + 1) + ': некоректний id — пропущено'); return; }
      var clean;
      try { clean = validateAlbum_(a); } catch (e) {
        stats.warnings.push('Бланк «' + str_(a && a.title, 40) + '»: ' + (e.message || e) + ' — пропущено');
        return;
      }
      if (existingAlbums[id]) {
        var row = existingAlbums[id];
        Object.keys(clean).forEach(function (k) { row[k] = clean[k]; });
        row.updatedAt = now;
        writeRow_(SHEETS.ALBUMS, row);
        stats.albums.updated++;
      } else {
        var obj = {};
        Object.keys(clean).forEach(function (k) { obj[k] = clean[k]; });
        obj.id = id; obj.createdAt = importDate_(a.createdAt, now); obj.updatedAt = now;
        addAlbums.push(obj);
        existingAlbums[id] = obj;
        stats.albums.added++;
      }
    });
    appendRows_(SHEETS.ALBUMS, addAlbums);

    // --- замовлення
    var existingOrders = {};
    readAll_(SHEETS.ORDERS).forEach(function (r) { existingOrders[r.id] = r; });
    var addOrders = [];
    (d.orders || []).forEach(function (o, idx) {
      o = o || {};
      var id = importId_(o.id);
      var albumId = importId_(o.albumId);
      if (!id || !albumId || !existingAlbums[albumId]) {
        stats.warnings.push('Замовлення №' + (idx + 1) + ': немає бланка або id — пропущено');
        return;
      }
      var obj = {
        id: id, albumId: albumId,
        clientName: str_(o.clientName, L.maxName).replace(/\s+/g, ' ').trim(),
        phone: str_(o.phone, L.maxPhone).trim(),
        comment: str_(o.comment, L.maxComment).trim(),
        status: AZART.STATUSES.indexOf(o.status) >= 0 ? o.status : AZART.STATUSES[0],
        groupFolderId: /^[\w-]*$/.test(String(o.groupFolderId || '')) ? str_(o.groupFolderId, L.maxFolderId) : '',
        groupName: cleanGroupName_(str_(o.groupName, L.maxGroupName)),
        createdAt: importDate_(o.createdAt, now),
        totalPrice: Math.max(0, Number(o.totalPrice) || 0),
        totalPhotos: Math.max(0, Math.floor(Number(o.totalPhotos)) || 0),
        isFullSession: !!o.isFullSession
      };
      if (existingOrders[id]) {
        var row = existingOrders[id];
        obj.secret = row.secret || newSecret_();
        obj.__row = row.__row;
        writeRow_(SHEETS.ORDERS, obj);
        stats.orders.updated++;
      } else {
        obj.secret = newSecret_();
        addOrders.push(obj);
        existingOrders[id] = obj;
        stats.orders.added++;
      }
    });
    appendRows_(SHEETS.ORDERS, addOrders);

    // --- позиції
    var existingItems = {};
    readAll_(SHEETS.ITEMS).forEach(function (r) { existingItems[r.id] = r; });
    var addItems = [];
    (d.items || []).forEach(function (it, idx) {
      it = it || {};
      var orderId = importId_(it.orderId);
      if (!orderId || !existingOrders[orderId]) {
        stats.warnings.push('Позиція №' + (idx + 1) + ': немає замовлення — пропущено');
        return;
      }
      var id = importId_(it.id) || newId_();
      var type = AZART.TYPES.indexOf(it.photoType) >= 0 ? it.photoType : '';
      var format = AZART.FORMATS.indexOf(it.photoFormat) >= 0 ? it.photoFormat : '';
      var obj = {
        id: id, orderId: orderId,
        photoNumber: str_(it.photoNumber, L.maxPhotoName).trim(),
        photoType: type, photoSize: normSize_(it.photoSize), photoFormat: format,
        position: Math.floor(Number(it.position)) || 0,
        count: Math.max(1, Math.floor(Number(it.count)) || 1),
        price: Math.max(0, Number(it.price) || 0)
      };
      if (existingItems[id] && existingItems[id].__row) {
        obj.__row = existingItems[id].__row;
        if (!obj.position) obj.position = existingItems[id].position;
        writeRow_(SHEETS.ITEMS, obj);
        stats.items.updated++;
      } else if (existingItems[id]) {
        stats.warnings.push('Позиція №' + (idx + 1) + ': дубль id у цьому пакеті — пропущено');
      } else {
        addItems.push(obj);
        existingItems[id] = obj;
        stats.items.added++;
      }
    });
    appendRows_(SHEETS.ITEMS, addItems);

    // --- фото груп
    var libRows = readAll_(SHEETS.GROUP_PHOTOS);
    (d.groupPhotos || []).forEach(function (g, idx) {
      g = g || {};
      var kg = str_(g.kindergarten, 40).trim();
      var name = cleanGroupName_(str_(g.groupName, L.maxGroupName));
      var url = String(g.photoUrl || '').trim();
      if (!kg || !name || !/^https:\/\/[^\s]{5,480}$/.test(url)) {
        stats.warnings.push('Фото групи №' + (idx + 1) + ': некоректні дані — пропущено');
        return;
      }
      var res = upsertGroupPhoto_(libRows, kg, name, url);
      if (res.created) stats.groupPhotos.added++; else stats.groupPhotos.updated++;
    });

    // --- ціни
    if (d.prices && typeof d.prices === 'object') {
      var saved = savePrices_(d.prices);
      stats.prices = Object.keys(saved).length;
    }
    return stats;
  });
}
