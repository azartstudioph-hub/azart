'use strict';
/**
 * Мінімальний емулятор Google Apps Script для локальних тестів і dev-сервера.
 * Завантажує backend/*.gs у vm-контекст і підставляє фейкові сервіси:
 * SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities,
 * ContentService, DriveApp, UrlFetchApp. Поведінка таблиці наближена до реальної:
 *  - у звичайних клітинках рядки на кшталт "0950000001" або "2026-10-30" стають
 *    числом/датою (як при ручному введенні), а у клітинках з форматом "@" — лишаються текстом;
 *  - вихід за межі аркуша кидає виняток.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function toSigned(buf) { return Array.from(buf, (b) => (b > 127 ? b - 256 : b)); }
function toBuf(input) {
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  return Buffer.from(input.map((b) => (b + 256) % 256));
}

function fmtDate(date, tz, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  const map = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
  let out = '';
  for (let i = 0; i < pattern.length;) {
    if (pattern[i] === "'") {
      const j = pattern.indexOf("'", i + 1);
      out += pattern.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    const tok = Object.keys(map).find((t) => pattern.startsWith(t, i));
    if (tok) { out += map[tok]; i += tok.length; } else { out += pattern[i]; i++; }
  }
  return out;
}

class Range {
  constructor(sheet, r, c, nr, nc) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    if (r + nr - 1 > sheet.maxRows || c + nc - 1 > sheet.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
    Object.assign(this, { sheet, r, c, nr, nc });
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some((row) => row.length !== this.nc)) {
      throw new Error('The number of rows/columns in the data does not match the number in the range.');
    }
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.r + i, this.c + j, values[i][j]);
    return this;
  }
  setFontWeight() { return this; }
  setNumberFormat(f) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.setFormat(this.r + i, this.c + j, f);
    return this;
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.cells.delete(this.sheet.k(this.r + i, this.c + j));
    return this;
  }
}

class Sheet {
  constructor(ss, name) {
    this.ss = ss; this.name = name; this.cells = new Map(); this.formats = new Map();
    this.maxRows = 1000; this.maxCols = 26; this.calls = 0;
  }
  k(r, c) { return r + ':' + c; }
  get(r, c) { const v = this.cells.get(this.k(r, c)); return v === undefined ? '' : v; }
  setFormat(r, c, f) { this.formats.set(this.k(r, c), f); }
  set(r, c, v) {
    const fmt = this.formats.get(this.k(r, c));
    if (typeof v === 'string' && fmt !== '@') {
      if (/^[+-]?\d+(\.\d+)?$/.test(v)) v = Number(v);              // "0950000001" -> 950000001
      else if (/^(true|false)$/i.test(v)) v = v.toLowerCase() === 'true';
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v = new Date(v + 'T00:00:00Z'); // дата
      else if (v.startsWith('=')) v = '#ERROR!';
    }
    if (v === '' || v === null || v === undefined) this.cells.delete(this.k(r, c));
    else this.cells.set(this.k(r, c), v);
  }
  getName() { return this.name; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getLastRow() { let m = 0; for (const key of this.cells.keys()) m = Math.max(m, +key.split(':')[0]); return m; }
  getLastColumn() { let m = 0; for (const key of this.cells.keys()) m = Math.max(m, +key.split(':')[1]); return m; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  setFrozenRows() {}
}

class Spreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = [new Sheet(this, 'Sheet1')]; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error('Sheet with this name already exists');
    const s = new Sheet(this, n); this.sheets.push(s); return s;
  }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

function createGas(opts = {}) {
  const dir = opts.dir || path.join(__dirname, '..', 'backend');
  const clock = { t: opts.now || Date.now() };
  const props = Object.assign({}, opts.props || {});
  const cache = new Map();
  const spreadsheets = new Map();
  const driveFiles = new Map();
  const logs = [];
  let lockHeld = false;
  const stats = { sheetCalls: 0 };

  const FakeDate = class extends Date {
    constructor(...a) { if (a.length === 0) super(clock.t); else super(...a); }
    static now() { return clock.t; }
  };

  function newSs(name) {
    const id = 'sheet_' + crypto.randomBytes(6).toString('hex');
    const ss = new Spreadsheet(id, name); spreadsheets.set(id, ss); return ss;
  }
  let activeSs = opts.bound === false ? null : newSs('AZART test');

  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    sleep: () => {},
    formatDate: (d, tz, p) => fmtDate(d, tz === 'UTC' ? 'UTC' : tz, p),
    computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
    base64Encode: (v) => toBuf(v).toString('base64'),
    base64Decode: (s) => { if (/[^A-Za-z0-9+/=\s]/.test(s)) throw new Error('Invalid base64'); return toSigned(Buffer.from(s, 'base64')); },
    base64EncodeWebSafe: (v) => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (data, mime, name) => {
      const bytes = typeof data === 'string' ? toSigned(Buffer.from(data)) : data;
      return { getBytes: () => bytes, getDataAsString: () => toBuf(bytes).toString('utf8'), getContentType: () => mime, getName: () => name };
    },
    Charset: { UTF_8: 'UTF_8' }
  };

  const store = (map) => ({
    get: (k) => { const e = map.get(k); if (!e) return null; if (e.exp && e.exp < clock.t) { map.delete(k); return null; } return e.v; },
    put: (k, v, sec) => { map.set(k, { v: String(v), exp: sec ? clock.t + sec * 1000 : 0 }); },
    remove: (k) => { map.delete(k); }
  });

  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) },
    Date: FakeDate,
    Utilities,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => activeSs,
      openById: (id) => { const s = spreadsheets.get(id); if (!s) throw new Error('No spreadsheet ' + id); return s; },
      create: (n) => newSs(n)
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); }
      })
    },
    CacheService: { getScriptCache: () => store(cache) },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (lockHeld) return false; lockHeld = true; return true; },
        releaseLock: () => { lockHeld = false; }
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => { const o = { getContent: () => s, getMimeType: () => o.mt, setMimeType(m) { o.mt = m; return o; } }; return o; }
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
      createFolder: (name) => {
        const id = 'folder_' + crypto.randomBytes(5).toString('hex');
        const f = { id, name, getId: () => id, getName: () => name, getUrl: () => 'https://drive.google.com/drive/folders/' + id, setSharing() {},
          createFile: (blob) => {
            const fid = 'file_' + crypto.randomBytes(5).toString('hex');
            const file = { id: fid, blob, trashed: false, getId: () => fid, setSharing() {}, setTrashed(v) { file.trashed = v; } };
            driveFiles.set(fid, file); return file;
          } };
        driveFiles.set(id, f); return f;
      },
      getFolderById: (id) => { const f = driveFiles.get(id); if (!f || !f.createFile) throw new Error('No folder ' + id); return f; },
      getFileById: (id) => { const f = driveFiles.get(id); if (!f) throw new Error('No file ' + id); return f; }
    },
    UrlFetchApp: { fetch: (url, o) => (opts.fetch ? opts.fetch(url, o) : (() => { throw new Error('UrlFetchApp not stubbed: ' + url); })()) }
  };
  const ctx = vm.createContext(sandbox);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));

  function post(body) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const out = ctx.doPost({ postData: { contents: raw, type: 'text/plain' } });
    return JSON.parse(out.getContent());
  }

  return {
    ctx, props, logs, clock, spreadsheets, driveFiles, post, stats,
    get ss() { return activeSs; },
    advance: (ms) => { clock.t += ms; },
    run: (name, ...args) => ctx[name](...args),
    get: () => JSON.parse(ctx.doGet({}).getContent()),
    /** Знімок усіх таблиць для збереження між перезапусками dev-сервера */
    snapshot() {
      const out = { props: Object.assign({}, props), sheets: {} };
      for (const [id, ss] of spreadsheets) {
        out.sheets[id] = { name: ss.name, tabs: ss.sheets.map((s) => ({ name: s.name, maxRows: s.maxRows,
          cells: [...s.cells.entries()].map(([k, v]) => [k, v instanceof Date ? { $d: v.toISOString() } : v]),
          formats: [...s.formats.entries()] })) };
      }
      return out;
    }
  };
}

module.exports = { createGas };
