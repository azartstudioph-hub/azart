// Повноекранний перегляд фото: свайп вліво/вправо, вниз — закрити, щипок і подвійний тап — зум,
// колесо миші — зум, стрілки/Esc/Пробіл — клавіатура. Порт «PhotoViewer» зі сторінок Wix.
//
// openViewer({ photos: [{ id, name, thumbnailLink }], index, selected: [id], selectable,
//              onToggle(photoId, isSelected), onClose() })
import { h, icon, clamp } from './util.js';
import { t } from './i18n.js';
import { thumbUrl, fallbackThumbUrl } from './drive.js';

const MAX_SCALE = 5;
const EASE = 'transform .3s cubic-bezier(.22,.8,.24,1)';

export function openViewer({ photos, index = 0, selected = [], selectable = false, onToggle, onClose } = {}) {
  if (!Array.isArray(photos) || !photos.length) return null;

  const prevFocus = document.activeElement;
  const sel = new Set(selected);
  let idx = clamp(Number(index) || 0, 0, photos.length - 1);
  let W = 0, H = 0;
  let scale = 1, tx = 0, ty = 0;
  let busy = false, initialized = false, closed = false;

  // ---- розмітка -----------------------------------------------------------
  const bg = h('div', { class: 'pv-bg' });
  let slides = [0, 1, 2].map(() => h('div', { class: 'pv-slide' }, h('img', { alt: '', draggable: 'false' })));
  const viewer = h('div', { class: 'pv-viewer' }, slides);
  const nameEl = h('b');
  const countEl = h('span');
  const closeBtn = h('button', { class: 'pv-ib', type: 'button', 'aria-label': t('viewer.close'), title: t('viewer.close') }, icon('close', 22));
  const prevBtn = h('button', { class: 'pv-nav pv-prev', type: 'button', 'aria-label': t('viewer.prev') }, icon('chevronLeft', 24));
  const nextBtn = h('button', { class: 'pv-nav pv-next', type: 'button', 'aria-label': t('viewer.next') }, icon('chevronRight', 24));
  const pickText = h('span', null, t('viewer.pick'));
  const pickBtn = selectable
    ? h('button', { class: 'pv-pick', type: 'button', 'aria-pressed': 'false' },
      h('span', { class: 'pv-ring' }, icon('checkBold', 15)), pickText)
    : null;
  const status = h('div', { class: 'pv-status', role: 'status' }, t('viewer.loading'));

  const root = h('div', {
    class: 'pv', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('form.openPhoto'), tabindex: '-1'
  },
  bg, viewer,
  h('div', { class: 'pv-top' }, h('div', { class: 'pv-meta' }, nameEl, countEl), closeBtn),
  prevBtn, nextBtn,
  pickBtn ? h('div', { class: 'pv-bottom' }, pickBtn) : null,
  status);

  const imgOf = (s) => s.querySelector('img');
  const fadeUI = (o) => root.style.setProperty('--c', o);
  const measure = () => { W = viewer.clientWidth; H = viewer.clientHeight; };

  // ---- завантаження: спочатку мала версія, потім велика --------------------
  const bigLoaded = new Set();
  const setStatus = (text) => { status.textContent = text || ''; status.style.display = text ? 'block' : 'none'; };

  function fill(slide, i) {
    const img = imgOf(slide);
    if (i < 0 || i >= photos.length) { img.removeAttribute('src'); img.dataset.pid = ''; return; }
    const p = photos[i];
    const key = String(p.id || i);
    img.dataset.pid = key;
    let triedFallback = false;
    img.onload = () => { if (slides[1] === slide) setStatus(''); };
    img.onerror = () => {
      if (!triedFallback && p.id) {
        triedFallback = true;
        img.src = fallbackThumbUrl(p, 1600);
        return;
      }
      if (slides[1] === slide) setStatus(t('viewer.failed'));
    };
    const big = thumbUrl(p, 2000);
    if (bigLoaded.has(key)) { img.src = big; return; }
    img.src = thumbUrl(p, 800);
    if (!big) return;
    const b = new Image();
    b.onload = () => { bigLoaded.add(key); if (img.dataset.pid === key) img.src = b.src; };
    b.src = big;
  }

  // ---- позиції та трансформації -------------------------------------------
  function place(dx = 0, dy = 0, anim = false) {
    slides.forEach((s, i) => {
      s.style.transition = anim ? EASE : 'none';
      s.style.transform = `translate3d(${(i - 1) * W + dx}px,${i === 1 ? dy : 0}px,0)`;
    });
  }
  function applyImg(anim = false) {
    const img = imgOf(slides[1]);
    img.style.transition = anim ? EASE : 'none';
    img.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${scale})`;
    viewer.classList.toggle('is-zoomed', scale > 1.01);
  }
  function limits(s = scale) {
    const img = imgOf(slides[1]);
    return { x: Math.max(0, (img.offsetWidth * s - W) / 2), y: Math.max(0, (img.offsetHeight * s - H) / 2) };
  }
  function clampPan() {
    const l = limits();
    tx = clamp(tx, -l.x, l.x);
    ty = clamp(ty, -l.y, l.y);
  }
  function resetZoom(anim = false) {
    scale = 1; tx = 0; ty = 0;
    slides.forEach((s) => { const i = imgOf(s); i.style.transition = 'none'; i.style.transform = ''; });
    if (anim) applyImg(true); else viewer.classList.remove('is-zoomed');
  }
  function zoomTo(ns, cx, cy, anim) {
    ns = clamp(ns, 1, MAX_SCALE);
    const r = ns / scale;
    tx = cx - (cx - tx) * r; ty = cy - (cy - ty) * r; scale = ns;
    if (scale <= 1.001) { scale = 1; tx = 0; ty = 0; } else clampPan();
    applyImg(anim);
  }
  function settleZoom() {
    if (scale < 1.02) { scale = 1; tx = 0; ty = 0; } else { scale = Math.min(scale, MAX_SCALE); clampPan(); }
    applyImg(true);
  }

  // ---- інтерфейс ------------------------------------------------------------
  function updateUI() {
    const p = photos[idx];
    if (!p) return;
    nameEl.textContent = p.name || '';
    countEl.textContent = (photos.length > 1 ? t('viewer.counter', { i: idx + 1, n: photos.length }) : '')
      + (selectable && sel.size ? (photos.length > 1 ? ' · ' : '') + t('viewer.selectedCount', { n: sel.size }) : '');
    if (pickBtn) {
      const on = sel.has(p.id);
      pickBtn.classList.toggle('is-on', on);
      pickBtn.setAttribute('aria-pressed', String(on));
      pickText.textContent = on ? t('viewer.picked') : t('viewer.pick');
    }
    prevBtn.classList.toggle('is-off', idx === 0);
    nextBtn.classList.toggle('is-off', idx === photos.length - 1);
  }

  function toggleSelect() {
    if (!selectable) return;
    const p = photos[idx];
    if (!p) return;
    const on = !sel.has(p.id);
    if (on) sel.add(p.id); else sel.delete(p.id);
    updateUI();
    pickBtn.classList.remove('is-pop');
    void pickBtn.offsetWidth;
    pickBtn.classList.add('is-pop');
    if (onToggle) onToggle(p.id, on);
  }

  // ---- навігація ------------------------------------------------------------
  function go(dir) {
    if (busy) return;
    const target = idx + dir;
    if (target < 0 || target >= photos.length) { place(0, 0, true); return; }
    busy = true;
    if (scale !== 1) resetZoom();
    place(-dir * W, 0, true);
    setTimeout(() => {
      if (closed) return;
      if (dir === 1) { slides.push(slides.shift()); idx++; fill(slides[2], idx + 1); }
      else { slides.unshift(slides.pop()); idx--; fill(slides[0], idx - 1); }
      place(0, 0, false);
      resetZoom();
      updateUI();
      busy = false;
    }, 310);
  }

  function destroy() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    ro.disconnect();
    root.remove();
    document.documentElement.classList.remove('modal-open');
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    if (onClose) onClose();
  }

  function closeViewer(dir = 1) {
    if (busy || closed) return;
    busy = true;
    const s = slides[1];
    s.style.transition = 'transform .25s ease-in, opacity .25s';
    if (dir) s.style.transform = `translate3d(0,${dir * H}px,0)`; else s.style.opacity = 0;
    bg.style.transition = 'opacity .25s';
    bg.style.opacity = 0;
    fadeUI(0);
    setTimeout(destroy, 220);
  }

  // ---- жести (Pointer Events: миша, дотик, стилус) ------------------------
  const ptrs = new Map();
  let g = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  const centerOf = (a, b) => {
    const r = viewer.getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - r.left - W / 2, y: (a.y + b.y) / 2 - r.top - H / 2 };
  };
  function velocity(samples) {
    if (samples.length < 2) return { x: 0, y: 0 };
    const last = samples[samples.length - 1];
    let first = samples[0];
    for (const s of samples) { if (last.t - s.t < 120) { first = s; break; } }
    const dt = Math.max(1, last.t - first.t);
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }

  viewer.addEventListener('pointerdown', (e) => {
    root.focus({ preventScroll: true });
    if (busy) return;
    try { viewer.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      g = { mode: 'pending', sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty, dx: 0, dy: 0, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      place(0, 0, false);
      bg.style.opacity = 1;
      fadeUI(1);
      g = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: scale, tx0: tx, ty0: ty, c0: centerOf(a, b) };
    }
  });

  viewer.addEventListener('pointermove', (e) => {
    if (!g || !ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.mode === 'pinch') {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()];
      const ns = clamp(g.s0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0, 0.8, MAX_SCALE * 1.15);
      const c = centerOf(a, b);
      const r = ns / g.s0;
      tx = c.x - (g.c0.x - g.tx0) * r;
      ty = c.y - (g.c0.y - g.ty0) * r;
      scale = ns;
      applyImg(false);
      return;
    }
    if (g.mode === 'ignore') return;

    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    g.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (g.samples.length > 8) g.samples.shift();

    if (g.mode === 'pending') {
      if (Math.hypot(dx, dy) < 8) return;
      g.mode = scale > 1.01 ? 'pan' : (Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'dismiss');
    }

    if (g.mode === 'pan') {
      tx = g.tx0 + dx; ty = g.ty0 + dy; clampPan(); applyImg(false);
    } else if (g.mode === 'swipe') {
      const edge = (idx === 0 && dx > 0) || (idx === photos.length - 1 && dx < 0);
      g.dx = edge ? dx * 0.3 : dx; // опір на краях
      place(g.dx, 0, false);
    } else if (g.mode === 'dismiss') {
      g.dy = dy;
      place(0, dy, false);
      const p = Math.min(1, Math.abs(dy) / (H * 0.5));
      bg.style.opacity = 1 - p * 0.85;
      fadeUI(1 - p);
    }
  });

  function endPointer(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!g) return;

    if (g.mode === 'pinch') {
      if (ptrs.size < 2) {
        settleZoom();
        const rest = [...ptrs.values()][0];
        g = rest ? { mode: scale > 1.01 ? 'pan' : 'ignore', sx: rest.x, sy: rest.y, tx0: tx, ty0: ty, dx: 0, dy: 0, samples: [] } : null;
      }
      return;
    }

    const cur = g;
    g = null;
    if (cur.mode === 'ignore') return;
    const v = velocity(cur.samples);

    if (cur.mode === 'pending') { onTap(e); return; }

    if (cur.mode === 'swipe') {
      const far = Math.abs(cur.dx) > W * 0.2, fast = Math.abs(v.x) > 0.45;
      if ((far || fast) && cur.dx < 0 && idx < photos.length - 1) go(1);
      else if ((far || fast) && cur.dx > 0 && idx > 0) go(-1);
      else place(0, 0, true);
    } else if (cur.mode === 'dismiss') {
      if (Math.abs(cur.dy) > H * 0.16 || Math.abs(v.y) > 0.55) closeViewer(cur.dy >= 0 ? 1 : -1);
      else { place(0, 0, true); bg.style.transition = 'opacity .25s'; bg.style.opacity = 1; fadeUI(1); }
    }
  }
  viewer.addEventListener('pointerup', endPointer);
  viewer.addEventListener('pointercancel', endPointer);

  // Тап поза фото закриває перегляд; подвійний тап збільшує/повертає.
  function onTap(e) {
    const r = imgOf(slides[1]).getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) { closeViewer(0); return; }
    const now = performance.now();
    if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap.t = 0;
      if (scale > 1.05) { scale = 1; tx = 0; ty = 0; applyImg(true); } else {
        const vr = viewer.getBoundingClientRect();
        zoomTo(2.5, e.clientX - vr.left - W / 2, e.clientY - vr.top - H / 2, true);
      }
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  }

  viewer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewer.getBoundingClientRect();
    const k = e.ctrlKey ? 0.01 : 0.0018;
    zoomTo(scale * Math.exp(-e.deltaY * k), e.clientX - r.left - W / 2, e.clientY - r.top - H / 2, false);
  }, { passive: false });

  // ---- кнопки і клавіатура --------------------------------------------------
  closeBtn.addEventListener('click', () => closeViewer(1));
  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  if (pickBtn) pickBtn.addEventListener('click', toggleSelect);

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeViewer(1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); return; }
    if ((e.key === ' ' || e.key === 'Enter') && selectable && !(e.target.closest && e.target.closest('button'))) {
      e.preventDefault();
      toggleSelect();
    }
  }
  document.addEventListener('keydown', onKey, true);

  const ro = new ResizeObserver(() => {
    measure();
    if (!initialized) return;
    place(0, 0, false);
    clampPan();
    applyImg(false);
  });

  // ---- запуск ---------------------------------------------------------------
  document.body.appendChild(root);
  document.documentElement.classList.add('modal-open');
  ro.observe(viewer);
  function start() {
    if (closed) return;
    measure();
    if (!W || !H) { requestAnimationFrame(start); return; }
    resetZoom();
    fill(slides[0], idx - 1);
    fill(slides[1], idx);
    fill(slides[2], idx + 1);
    place(0, 0, false);
    updateUI();
    initialized = true;
    root.focus({ preventScroll: true });
  }
  start();

  return { close: () => closeViewer(0), el: root };
}
