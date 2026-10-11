/**
 * Pricing.gs — розрахунок вартості замовлення.
 *
 * Це точний переніс логіки зі сторінки Wix «AlbumSettings (Item)» /
 * «PortraitAlbumSettings (Item)». Та сама логіка продубльована у
 * assets/js/pricing.js (щоб клієнт показував суму одразу). Сервер завжди
 * перераховує ціну сам і не довіряє сумі від клієнта.
 *
 * Правила:
 *  - База позиції:
 *      Електронні              = ціна_електронних × кількість
 *      Друковані               = ціна_друку(тип, розмір) × кількість
 *      Друковані + електронні  = ціна_друку × кількість + надбавка (один раз на рядок)
 *  - baseTotal = сума баз усіх рядків (без подарунка та %).
 *  - Подарунок «електронні фото безкоштовно»: якщо у бланку увімкнено
 *    discountEnabled, поріг > 0 і baseTotal >= поріг, то для рядків
 *    «Друковані» та «Друковані + електронні» надбавка не стягується
 *    (ціна = друк × кількість), а формат «Друковані» зберігається як
 *    «Друковані + електронні». Рядки «Електронні» залишаються платними.
 *  - Відсоткова знижка: найбільший відсоток із трьох порогів, які досягнуті
 *    за baseTotal; застосовується до кожної позиції окремо з округленням до копійок.
 *  - Портрет + «Вся фотосесія»: підсумок = фіксована ціна сесії.
 */

function normSize_(s) {
  // Кирилична «х»/«Х», латинська X і знак множення → латинська «x»
  return String(s === null || s === undefined ? '' : s)
    .replace(/[хХxX×]/g, 'x')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function typeKey_(type) {
  if (type === 'На фоні') return 'background';
  if (type === 'Репортаж') return 'reportage';
  if (type === 'Портрет') return 'portret';
  return null;
}

function printPriceKey_(type, size) {
  var key = typeKey_(type);
  if (!key) return null;
  return key + normSize_(size).replace('x', 'X') + 'Print';
}

function num_(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function printPrice_(prices, type, size) {
  var k = printPriceKey_(type, size);
  return k ? num_(prices[k]) : 0;
}

/** База позиції без подарунка і без відсотків. */
function baseItemPrice_(prices, type, size, format, count) {
  var key = typeKey_(type);
  if (!key) return 0;
  var cnt = Number(count) || 1;
  if (format === AZART.FORMAT_DIGITAL) {
    return num_(prices[key + 'Digital']) * cnt;
  }
  if (format === AZART.FORMAT_PRINT) {
    return printPrice_(prices, type, size) * cnt;
  }
  if (format === AZART.FORMAT_BOTH) {
    return printPrice_(prices, type, size) * cnt + num_(prices.printAndDigitalExtra);
  }
  return 0;
}

function giftActive_(prices, album, baseTotal) {
  if (!album || !album.discountEnabled) return false;
  var threshold = num_(prices.discountThreshold);
  if (threshold <= 0) return false;
  return baseTotal >= threshold;
}

function percentDiscount_(prices, baseTotal) {
  var pairs = [
    [num_(prices.discountPriceThreshold), num_(prices.discountPercent)],
    [num_(prices.discountPriceThreshold2), num_(prices.discountPercent2)],
    [num_(prices.discountPriceThreshold3), num_(prices.discountPercent3)]
  ];
  var active = 0;
  pairs.forEach(function (p) {
    if (p[0] > 0 && p[1] > 0 && baseTotal >= p[0] && p[1] > active) active = p[1];
  });
  return active;
}

function isPortraitAlbum_(album) {
  return !!album && Array.isArray(album.types) && album.types.length === 1 && album.types[0] === AZART.TYPE_PORTRAIT;
}

/**
 * Рахує замовлення.
 * items: [{photoNumber, photoType, photoSize, photoFormat, count}]
 * Повертає {items:[... + price, savedFormat], baseTotal, gift, percent, fullSession, total, totalPhotos}
 */
function calcOrder_(prices, album, items, isFullSession) {
  var baseTotal = 0;
  items.forEach(function (it) {
    baseTotal += baseItemPrice_(prices, it.photoType, it.photoSize, it.photoFormat, it.count);
  });
  var gift = giftActive_(prices, album, baseTotal);
  var percent = percentDiscount_(prices, baseTotal);

  var sum = 0;
  var photos = 0;
  var out = items.map(function (it) {
    var cnt = Number(it.count) || 1;
    var price = baseItemPrice_(prices, it.photoType, it.photoSize, it.photoFormat, cnt);
    var savedFormat = it.photoFormat;
    if (gift && (it.photoFormat === AZART.FORMAT_PRINT || it.photoFormat === AZART.FORMAT_BOTH)) {
      if (typeKey_(it.photoType)) price = printPrice_(prices, it.photoType, it.photoSize) * cnt;
      if (it.photoFormat === AZART.FORMAT_PRINT) savedFormat = AZART.FORMAT_BOTH;
    }
    if (percent > 0) price = price * (1 - percent / 100);
    price = round2_(price);
    sum += price;
    photos += cnt;
    var copy = {};
    Object.keys(it).forEach(function (k) { copy[k] = it[k]; });
    copy.count = cnt;
    copy.price = price;
    copy.savedFormat = savedFormat;
    return copy;
  });

  var sessionPrice = num_(prices.portretSessionPrice);
  var fullSession = !!isFullSession && isPortraitAlbum_(album) && sessionPrice > 0;
  var total = fullSession ? sessionPrice : round2_(sum);

  return {
    items: out,
    baseTotal: round2_(baseTotal),
    gift: gift,
    percent: percent,
    fullSession: fullSession,
    total: total,
    totalPhotos: photos
  };
}
