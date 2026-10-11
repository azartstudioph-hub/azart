// Чернетка замовлення та вибір фото — у localStorage браузера.
// Ключ як у Wix: photoSelection_{albumId}[_{groupFolderId}]
import { store } from './util.js';
import { CONFIG } from './config.js';

export function draftKey(albumId, groupFolderId) {
  if (!albumId) return null;
  return groupFolderId ? `photoSelection_${albumId}_${groupFolderId}` : `photoSelection_${albumId}`;
}

const ttlMs = () => Math.max(1, CONFIG.DRAFT_TTL_MINUTES) * 60 * 1000;

/** Повертає чернетку або null (прострочену видаляє). */
export function loadDraft(key) {
  if (!key) return null;
  const d = store.getJson(key);
  if (!d || typeof d !== 'object') return null;
  if (!d.timestamp || Date.now() - d.timestamp > ttlMs()) { store.remove(key); return null; }
  return d;
}

/** Зливає patch у наявну чернетку (нічого не втрачаючи) і оновлює час. */
export function saveDraft(key, patch) {
  if (!key) return null;
  const existing = loadDraft(key) || {};
  const next = { ...existing, ...patch, timestamp: Date.now() };
  store.setJson(key, next);
  return next;
}

export function clearDraft(key) {
  if (key) store.remove(key);
}

/** Скидає лише вибір фото в галереї (дані клієнта й рядки лишаються). */
export function clearSelection(key) {
  const d = loadDraft(key);
  if (!d) return;
  d.photos = [];
  d.names = [];
  d.thumbnails = [];
  d.selectedAt = Date.now();
  d.timestamp = Date.now();
  store.setJson(key, d);
}

/**
 * Прибирає одне фото (за іменем файлу) зі списку вибраних у галереї.
 * Потрібно, коли клієнт видаляє картку у формі — інакше фото знову «повернеться» з галереї.
 */
export function removeFromSelection(key, photoName) {
  const d = loadDraft(key);
  if (!d || !Array.isArray(d.names)) return;
  const i = d.names.indexOf(photoName);
  if (i < 0) return;
  ['photos', 'names', 'thumbnails'].forEach((k) => { if (Array.isArray(d[k])) d[k].splice(i, 1); });
  d.timestamp = Date.now();
  store.setJson(key, d);
}
