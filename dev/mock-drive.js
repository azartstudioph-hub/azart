'use strict';
// Імітація Google Drive API v3 (files.list) для локальної розробки та тестів.
// Створює папки-групи та «фото» у вигляді SVG-заглушок.

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function buildTree() {
  const nodes = new Map();
  const add = (n) => { nodes.set(n.id, n); return n; };

  // Бланк з групами (як у реальному використанні): DEMO_GROUPS → Група 1..6
  add({ id: 'DEMO_GROUPS', name: 'Новорічне свято', mimeType: FOLDER_MIME, parent: null });
  let base = 5300;
  for (let g = 1; g <= 6; g++) {
    const gid = 'DEMO_G' + g;
    add({ id: gid, name: 'Група ' + g, mimeType: FOLDER_MIME, parent: 'DEMO_GROUPS' });
    const rand = rng(g * 977);
    const count = 14 + g * 2;
    for (let i = 0; i < count; i++) {
      const num = base + i * 3 + Math.floor(rand() * 3);
      const portrait = rand() < 0.35;
      add({ id: `${gid}_P${i}`, name: `IMG_${num}.JPG`, mimeType: 'image/jpeg', parent: gid, w: portrait ? 2000 : 3000, h: portrait ? 3000 : 2000, hue: Math.floor(rand() * 360) });
    }
    base += 400;
  }

  // Плоский бланк без груп
  add({ id: 'DEMO_FLAT', name: 'Випускний', mimeType: FOLDER_MIME, parent: null });
  const rand = rng(4242);
  for (let i = 0; i < 40; i++) {
    const portrait = rand() < 0.4;
    add({ id: `DEMO_FLAT_P${i}`, name: `${6040 + i * 2}.JPG`, mimeType: 'image/jpeg', parent: 'DEMO_FLAT', w: portrait ? 2000 : 3000, h: portrait ? 3000 : 2000, hue: Math.floor(rand() * 360) });
  }

  // Портретний бланк з групами
  add({ id: 'DEMO_PORTRAIT', name: 'Портрети', mimeType: FOLDER_MIME, parent: null });
  for (let g = 1; g <= 3; g++) {
    const gid = 'DEMO_PG' + g;
    add({ id: gid, name: 'Група ' + g, mimeType: FOLDER_MIME, parent: 'DEMO_PORTRAIT' });
    const r = rng(g * 31);
    for (let i = 0; i < 12; i++) {
      add({ id: `${gid}_P${i}`, name: `${7000 + g * 100 + i}.JPG`, mimeType: 'image/jpeg', parent: gid, w: 2000, h: 3000, hue: Math.floor(r() * 360) });
    }
  }
  return nodes;
}

const NODES = buildTree();

function parseQuery(q) {
  const parent = /'([^']+)' in parents/.exec(q);
  return {
    parent: parent ? parent[1] : null,
    folders: /mimeType\s*=\s*'application\/vnd\.google-apps\.folder'/.test(q),
    images: /mimeType contains 'image\/'/.test(q)
  };
}

/** Відповідь на GET /drive/v3/files?... */
function list(url) {
  const key = url.searchParams.get('key');
  if (!key) return { status: 403, body: { error: { code: 403, message: 'API key missing' } } };
  const q = parseQuery(url.searchParams.get('q') || '');
  if (!q.parent) return { status: 400, body: { error: { code: 400, message: 'Invalid query' } } };
  const parentNode = NODES.get(q.parent);
  if (!parentNode) return { status: 404, body: { error: { code: 404, message: 'File not found: ' + q.parent } } };
  const files = [];
  for (const n of NODES.values()) {
    if (n.parent !== q.parent) continue;
    if (q.folders && n.mimeType === FOLDER_MIME) files.push({ id: n.id, name: n.name });
    if (q.images && n.mimeType !== FOLDER_MIME) {
      files.push({ id: n.id, name: n.name, thumbnailLink: `/dev-img/${n.id}=s220`, imageMediaMetadata: { width: n.w, height: n.h } });
    }
  }
  return { status: 200, body: { files } };
}

/** SVG-заглушка для /dev-img/<id>=sNNN */
function image(id) {
  const n = NODES.get(id);
  const label = n ? n.name.replace(/\.JPG$/, '') : id;
  const hue = n && n.hue !== undefined ? n.hue : 210;
  const w = n && n.w ? n.w : 3000, h = n && n.h ? n.h : 2000;
  const vw = w / 10, vh = h / 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},62%,72%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},58%,52%)"/></linearGradient></defs>
<rect width="${vw}" height="${vh}" fill="url(#g)"/>
<circle cx="${vw * 0.5}" cy="${vh * 0.42}" r="${Math.min(vw, vh) * 0.17}" fill="rgba(255,255,255,.55)"/>
<path d="M${vw * 0.22} ${vh} Q${vw * 0.5} ${vh * 0.52} ${vw * 0.78} ${vh} Z" fill="rgba(255,255,255,.45)"/>
<text x="${vw / 2}" y="${vh * 0.9}" font-family="sans-serif" font-size="${Math.min(vw, vh) * 0.09}" fill="rgba(0,0,0,.45)" text-anchor="middle">${label}</text></svg>`;
}

function groupImage(n) {
  const hue = (n * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,80%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},65%,60%)"/></linearGradient></defs><rect width="300" height="200" fill="url(#g)"/><g fill="rgba(255,255,255,.7)"><circle cx="90" cy="95" r="26"/><circle cx="150" cy="85" r="30"/><circle cx="212" cy="97" r="25"/><path d="M50 200 Q90 120 130 200Z"/><path d="M110 200 Q150 112 190 200Z"/><path d="M172 200 Q212 125 252 200Z"/></g></svg>`;
}

module.exports = { list, image, groupImage, NODES };
