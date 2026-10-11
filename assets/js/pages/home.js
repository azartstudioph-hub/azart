// Головна сторінка: годинник, герой, інструкція у вигляді таймлайну.
import { mountLayout } from '../layout.js';
import { t, getLang, applyI18n } from '../i18n.js';
import { h, icon, fmtTime, fmtDateClock } from '../util.js';

mountLayout({ active: 'home' });
document.title = 'AZART STUDIO';

// іконки, які вставляються з JS
document.querySelector('.admin-link .ico').replaceWith(icon('lock', 16));
document.getElementById('cta-arrow').replaceWith(icon('arrowRight', 20));

// інструкція: 7 кроків
const tl = document.getElementById('timeline');
for (let i = 1; i <= 7; i++) {
  tl.appendChild(h('li', { class: 'tl-item' },
    h('div', { class: 'tl-text', html: t('home.step' + i) }),
    h('div', { class: 'tl-node', 'aria-hidden': 'true' }, String(i))));
}

// годинник
const timeEl = document.getElementById('clock-time');
const dateEl = document.getElementById('clock-date');
function tick() {
  const now = new Date();
  timeEl.textContent = fmtTime(now);
  dateEl.textContent = fmtDateClock(now, getLang());
}
tick();
setInterval(tick, 5000);
applyI18n();
