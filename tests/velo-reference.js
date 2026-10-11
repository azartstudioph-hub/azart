'use strict';
/**
 * ЕТАЛОН: логіка розрахунку цін, дослівно перенесена зі сторінок Wix
 * «AlbumSettings (Item)» та «PortraitAlbumSettings (Item)»
 * (лише замість глобальних змінних — аргументи функції).
 * Використовується тестами для перевірки, що нова реалізація дає ті самі суми.
 */
function veloCalc({ priceSettings, currentAlbum, orderItems, isFullSession, portraitSessionPrice }) {
  function getPriceKey(type) {
    if (type === 'На фоні') return 'background';
    if (type === 'Репортаж') return 'reportage';
    if (type === 'Портрет') return 'portret';
    return null;
  }
  function calculateBaseItemPrice(type, size, format, count = 1) {
    if (!priceSettings) return 0;
    const key = getPriceKey(type);
    if (!key) return 0;
    count = Number(count) || 1;
    if (format === 'Електронні') return Number(priceSettings[key + 'Digital'] || 0) * count;
    if (format === 'Друковані') {
      const priceKey = key + size.replace('х', 'X') + 'Print';   // кирилична х, як у Wix
      return Number(priceSettings[priceKey] || 0) * count;
    }
    if (format === 'Друковані + електронні') {
      const priceKey = key + size.replace('х', 'X') + 'Print';
      return (Number(priceSettings[priceKey] || 0) * count) + Number(priceSettings.printAndDigitalExtra || 0);
    }
    return 0;
  }
  function isDiscountActive() {
    if (!currentAlbum.discountEnabled) return false;
    if (!priceSettings) return false;
    const threshold = Number(priceSettings.discountThreshold || 0);
    if (threshold <= 0) return false;
    let totalBeforeDiscount = 0;
    orderItems.forEach((item) => { totalBeforeDiscount += calculateBaseItemPrice(item.photoType, item.photoSize, item.photoFormat, item.count); });
    return totalBeforeDiscount >= threshold;
  }
  function calculateItemPrice(item, discountActive) {
    const basePrice = calculateBaseItemPrice(item.photoType, item.photoSize, item.photoFormat, item.count);
    if (!discountActive) return basePrice;
    if (item.photoFormat === 'Електронні') return basePrice;
    if (item.photoFormat === 'Друковані' || item.photoFormat === 'Друковані + електронні') {
      const key = getPriceKey(item.photoType);
      if (!key) return basePrice;
      const priceKey = key + item.photoSize.replace('х', 'X') + 'Print';
      return Number(priceSettings[priceKey] || 0) * Number(item.count || 1);
    }
    return basePrice;
  }
  function getOrderPercentDiscount() {
    if (!priceSettings) return 0;
    let total = 0;
    orderItems.forEach((item) => { total += calculateBaseItemPrice(item.photoType, item.photoSize, item.photoFormat, item.count); });
    const threshold1 = Number(priceSettings.discountPriceThreshold || 0);
    const percent1 = Number(priceSettings.discountPercent || 0);
    const threshold2 = Number(priceSettings.discountPriceThreshold2 || 0);
    const percent2 = Number(priceSettings.discountPercent2 || 0);
    const threshold3 = Number(priceSettings.discountPriceThreshold3 || 0);
    const percent3 = Number(priceSettings.discountPercent3 || 0);
    let activePercent = 0;
    if (threshold1 > 0 && percent1 > 0 && total >= threshold1) activePercent = percent1;
    if (threshold2 > 0 && percent2 > 0 && total >= threshold2) { if (percent2 > activePercent) activePercent = percent2; }
    if (threshold3 > 0 && percent3 > 0 && total >= threshold3) { if (percent3 > activePercent) activePercent = percent3; }
    return activePercent;
  }

  const freeDigital = isDiscountActive();
  const percent = getOrderPercentDiscount();
  const items = orderItems.map((item) => {
    let price = calculateItemPrice(item, freeDigital);
    if (percent > 0) price = price * (1 - percent / 100);
    return { ...item, price: Math.round(price * 100) / 100 };
  });
  let total = 0;
  items.forEach((i) => { total += Number(i.price || 0); });
  if (isFullSession && portraitSessionPrice > 0) total = portraitSessionPrice;
  return { items, total, gift: freeDigital, percent };
}

module.exports = { veloCalc };
