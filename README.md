# AZART STUDIO — замовлення фото для садочків

Статичний сайт для GitHub Pages (без збірки, чистий HTML/CSS/JS) + сервер на Google Apps Script з Google Таблицею як базою. Фото читаються з Google Диска.

**Почніть тут:** [`docs/SETUP.md`](docs/SETUP.md) — розгортання крок за кроком, імпорт із Wix, щоденна робота.
Відмінності від Wix і відкриті питання: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Структура

```
index.html, orders.html, blanks.html, groups.html,
gallery.html, form.html, prices.html     сторінки для клієнтів
album-orders.html, order.html            перегляд замовлень
admin.html, print.html, import.html      адміністратор
sorter/                                  програма створення папок для друку (Chrome/Edge)
assets/js/config.js                      ← єдине місце налаштувань (API_URL, DRIVE_API_KEY, садочки, контакти)
assets/js, assets/css                    код і стилі (ES-модулі, без збірки)
backend/                                 код сервера для Apps Script (.gs) + appsscript.json
dev/                                     локальний сервер і емулятор Apps Script / Drive (лише для розробки)
tests/                                   тести (юніт + браузер); tests/fixtures — синтетичні CSV
docs/                                    інструкції
404.html, .nojekyll                      для GitHub Pages
```

## Локально

```bash
npm run dev     # http://localhost:8080, адмін-пароль: admin (дані емульовані)
npm test        # усі тести (потрібен Node 20+ і Playwright з Chromium)
```

## Як це влаштовано

- Браузер звертається до `API_URL` (веб-застосунок Apps Script) запитами `POST` з JSON `{action, …, token}`; відповідь `{ok, data}` або `{ok:false, error:{code,message}}`.
- Усі суми рахує сервер (`backend/Pricing.gs`; клієнтське дзеркало `assets/js/pricing.js` перевіряється тестом паритету).
- Адміністратор входить за паролем зі властивостей скрипта; токен діє 12 годин.
- Фото й папки читаються браузером напряму з Google Drive API (ключ з обмеженням за адресою сайту); папки мають бути відкриті «усім за посиланням».
