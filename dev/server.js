#!/usr/bin/env node
'use strict';
/**
 * Локальний dev-сервер: статичні файли сайту + емульований бекенд Apps Script (/exec)
 * + імітація Google Drive API (/drive/v3/files) і зображень (/dev-img/...).
 *
 *   node dev/server.js [порт]         → http://localhost:8080   (адмін-пароль: admin)
 *
 * Це лише для розробки і тестів. На GitHub Pages ці файли не потрібні.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-emulator');
const { seed } = require('./seed');
const drive = require('./mock-drive');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8'
};

function start({ port = 8080, latency = 0, withSeed = true, quiet = false, gasOptions = {} } = {}) {
  const gas = createGas(gasOptions);
  const seeded = withSeed ? seed(gas) : (gas.props.ADMIN_PASSWORD = 'admin', gas.run('setup'), null);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (latency) await sleep(latency);

      if (url.pathname === '/exec') {
        if (req.method === 'POST') {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks).toString('utf8');
          const out = gas.ctx.doPost({ postData: { contents: body, type: 'text/plain' } }).getContent()
            .replace(/https:\/\/example\.invalid\//g, '/dev-img/');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          return res.end(out);
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(gas.ctx.doGet({}).getContent());
      }

      if (url.pathname === '/drive/v3/files') {
        const r = drive.list(url);
        res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(r.body));
      }

      if (url.pathname.startsWith('/dev-img/')) {
        const name = decodeURIComponent(url.pathname.slice('/dev-img/'.length)).replace(/=s\d+$/, '').replace(/\.svg$/, '');
        const g = /^group-(\d+)$/.exec(name);
        const svg = g ? drive.groupImage(Number(g[1])) : drive.image(name);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=60' });
        return res.end(svg);
      }

      if (url.pathname === '/__dev/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ seeded: seeded && { token: seeded.token, albums: seeded.albums } }));
      }

      // Статика
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      let file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT) || /[\\/](dev|tests|backend|docs|node_modules)[\\/]/.test(file.slice(ROOT.length) + path.sep)) {
        res.writeHead(404); return res.end('Not found');
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      if (/assets[\\/]js[\\/]config\.js$/.test(file)) {
        // Локальна підміна налаштувань
        let src = fs.readFileSync(file, 'utf8');
        src = src.replace(/API_URL: '[^']*'/, "API_URL: '/exec'")
          .replace(/DRIVE_API_KEY: '[^']*'/, "DRIVE_API_KEY: 'dev-key'")
          .replace(/DRIVE_API_BASE: '[^']*'/, "DRIVE_API_BASE: '/drive/v3/files'");
        res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
        return res.end(src);
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (!quiet) console.error(e);
      res.writeHead(500); res.end('Server error');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      if (!quiet) console.log(`AZART dev-сервер: http://localhost:${actualPort}  (адмін-пароль: admin)`);
      resolve({ server, gas, port: actualPort, url: `http://localhost:${actualPort}`, seeded, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (require.main === module) {
  start({ port: Number(process.argv[2]) || 8080, latency: Number(process.env.DEV_LATENCY) || 0 });
}
module.exports = { start };
