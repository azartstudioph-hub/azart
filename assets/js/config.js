// ============================================================================
// НАЛАШТУВАННЯ САЙТУ — єдине місце, яке потрібно відредагувати після розгортання.
// Докладно: docs/SETUP.md
// ============================================================================
export const CONFIG = {
  // Адреса веб-застосунку Google Apps Script (закінчується на /exec).
  // Отримується після Deploy → New deployment → Web app.
  API_URL: 'https://script.google.com/macros/s/AKfycbz_4FtianOutp7c86uA7s2JEhKp1Q3HB-Fj507ki5cfYjnf3XnfS5BKeQXiIyBBoFjNZA/exec',

  // Ключ Google Drive API (Google Cloud Console → Credentials → API key).
  // Обмежте його: HTTP referrers = адреса вашого сайту, API = Google Drive API.
  DRIVE_API_KEY: 'AIzaSyCPtlbkqqLaFShX_feBsYGPkUhUvUUE0Ds',

  // Службова адреса Drive API (змінювати не потрібно; у локальній розробці підміняється).
  DRIVE_API_BASE: 'https://www.googleapis.com/drive/v3/files',

  // Садочки. Назва має збігатися з тим, що обирається при створенні бланка.
  KINDERGARTENS: ['Сад 1', 'Сад 7'],

  // Контакти у футері.
  CONTACT: {
    phone: '+380637250165',
    phoneLabel: '+380 63 725 0165',
    viber: 'viber://chat?number=%2B380637250165',
    // Якщо у вас є ім'я користувача Telegram, замініть на https://t.me/ВАШ_НІК
    telegram: 'https://t.me/+380637250165'
  },
  SCHEDULE: {
    uk: 'Пн-Пт - 09:00-18:00; Сб-Нд - вихідні',
    en: 'Mon-Fri - 09:00-18:00; Sat-Sun - closed'
  },

  // Програма сортування фото (сторінка зі сторінки адміністратора).
  SORTER_URL: './sorter/',

  // Скільки хвилин зберігається чернетка замовлення в браузері.
  DRAFT_TTL_MINUTES: 60,

  // Мова за замовчуванням: 'uk' або 'en'.
  DEFAULT_LANG: 'uk'
};
