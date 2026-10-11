// Читання фото та папок із Google Drive напряму з браузера (Drive API v3 + ключ API).
// Папка бланка має бути відкрита «усім, хто має посилання» (перегляд).
import { CONFIG } from './config.js';
import { naturalCompare, store } from './util.js';
import { t } from './i18n.js';

const FOLDER_RE = /^[\w-]+$/;

export class DriveError extends Error {
  constructor(code, message) { super(message); this.name = 'DriveError'; this.code = code; }
}

async function listAll(q, fields) {
  if (!CONFIG.DRIVE_API_KEY) throw new DriveError('NO_KEY', t('drive.noKey'));
  const files = [];
  let pageToken = '';
  let guard = 0;
  do {
    const u = new URL(CONFIG.DRIVE_API_BASE, location.href);
    u.searchParams.set('q', q);
    u.searchParams.set('key', CONFIG.DRIVE_API_KEY);
    u.searchParams.set('fields', `nextPageToken,files(${fields})`);
    u.searchParams.set('pageSize', '1000');
    u.searchParams.set('supportsAllDrives', 'true');
    u.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    let res;
    try { res = await fetch(u.toString()); } catch (e) { throw new DriveError('NETWORK', t('err.network')); }
    if (!res.ok) {
      if (res.status === 404) throw new DriveError('NOT_FOUND', t('drive.notFound'));
      if (res.status === 400) throw new DriveError('BAD_REQUEST', t('drive.badRequest'));
      if (res.status === 403 || res.status === 401) throw new DriveError('FORBIDDEN', t('drive.forbidden'));
      throw new DriveError('HTTP', t('err.server'));
    }
    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
    guard++;
  } while (pageToken && guard < 50);
  return files;
}

function checkFolder(folderId) {
  if (!folderId || !FOLDER_RE.test(folderId)) throw new DriveError('BAD_ID', t('drive.badFolder'));
}

/**
 * Підпапки (групи). Повертає [{id, name}].
 * Результат на 3 хвилини кешується в sessionStorage, щоб перехід між сторінками був миттєвим.
 */
export async function getGroups(folderId, { fresh = false } = {}) {
  checkFolder(folderId);
  const ck = 'azart_groups_' + folderId;
  if (!fresh) {
    try {
      const c = JSON.parse(sessionStorage.getItem(ck) || 'null');
      if (c && Date.now() - c.t < 180000) return c.v;
    } catch (e) { /* ignore */ }
  }
  const q = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const files = await listAll(q, 'id,name');
  const v = files.map((f) => ({ id: f.id, name: f.name }));
  try { sessionStorage.setItem(ck, JSON.stringify({ t: Date.now(), v })); } catch (e) { /* ignore */ }
  return v;
}

/** Фото в папці. Повертає [{id, name, thumbnailLink, width, height}] у природному порядку імен. */
export async function getPhotos(folderId) {
  checkFolder(folderId);
  const q = `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`;
  const files = await listAll(q, 'id,name,thumbnailLink,imageMediaMetadata(width,height)');
  const list = files.map((f) => ({
    id: f.id, name: f.name, thumbnailLink: f.thumbnailLink || '',
    width: f.imageMediaMetadata ? f.imageMediaMetadata.width : 0,
    height: f.imageMediaMetadata ? f.imageMediaMetadata.height : 0
  }));
  list.sort((a, b) => naturalCompare(a.name, b.name));
  return list;
}

/** Мініатюра потрібного розміру (ширина в пікселях). */
export function thumbUrl(photo, size = 800) {
  const link = typeof photo === 'string' ? photo : photo.thumbnailLink;
  if (link) return link.replace(/=s\d+(-c)?$/, `=s${size}`);
  const id = typeof photo === 'string' ? '' : photo.id;
  return id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${size}` : '';
}

/** Запасний варіант, якщо thumbnailLink не завантажився. */
export function fallbackThumbUrl(photo, size = 800) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(photo.id)}&sz=w${size}`;
}
