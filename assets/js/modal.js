// Модальні вікна, підтвердження та тости. Доступність: role=dialog, Esc, фокус-пастка.
import { h, icon } from './util.js';
import { t } from './i18n.js';

let openCount = 0;

/**
 * openModal({ title, body: Node, actions: [Node], size: 'sm'|'md'|'lg', closable: true, onClose })
 * Повертає { close, el }.
 */
export function openModal(opts) {
  const { title, body, actions, size = 'md', closable = true, onClose, className = '' } = opts;
  const previouslyFocused = document.activeElement;
  const titleId = 'm' + Math.random().toString(36).slice(2, 8);

  const dialog = h('div', {
    class: `modal modal-${size} ${className}`.trim(), role: 'dialog', 'aria-modal': 'true',
    'aria-labelledby': title ? titleId : null, tabindex: '-1'
  },
  closable ? h('button', { class: 'modal-x', type: 'button', 'aria-label': t('common.close'), onclick: () => close('x') }, icon('close', 20)) : null,
  title ? h('h2', { class: 'modal-title', id: titleId }, title) : null,
  h('div', { class: 'modal-body' }, body),
  actions && actions.length ? h('div', { class: 'modal-actions' }, actions) : null);

  const overlay = h('div', { class: 'modal-overlay' }, dialog);
  let closed = false;

  function close(reason) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 120);
    openCount = Math.max(0, openCount - 1);
    if (!openCount) document.documentElement.classList.remove('modal-open');
    if (previouslyFocused && previouslyFocused.focus) { try { previouslyFocused.focus(); } catch (e) { /* ignore */ } }
    if (onClose) onClose(reason);
  }

  function onKey(e) {
    if (e.key === 'Escape' && closable) { e.stopPropagation(); close('esc'); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter((x) => x.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && closable) close('overlay'); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  openCount++;
  document.documentElement.classList.add('modal-open');
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    const auto = dialog.querySelector('[autofocus]');
    (auto || dialog).focus();
  });
  return { close, el: dialog, overlay };
}

/** Підтвердження дії. Повертає Promise<boolean>. */
export function confirmDialog({ title, text, confirmText, cancelText, danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const done = (v) => { decided = true; m.close('btn'); resolve(v); };
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => done(true), autofocus: true }, confirmText || t('common.confirm'));
    const cancel = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => done(false) }, cancelText || t('common.cancel'));
    const m = openModal({
      title, size: 'sm', body: h('p', { class: 'modal-text' }, text), actions: [cancel, ok],
      onClose: () => { if (!decided) resolve(false); }
    });
  });
}

// --- тости -----------------------------------------------------------------
let toastHost;

export function toast(message, type = 'info', ms = 3800) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 250);
  }, ms);
}
