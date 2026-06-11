'use strict';
// 로컬 개발/테스트 서버: 정적 파일 + /api/proxy (Vercel 없이 로컬 확인용)
// 실행: node webapp/dev-server.js  → http://localhost:5180

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 5180;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
};
const ALLOWED = new Set([
  'finance.naver.com', 'api.finance.naver.com', 'polling.finance.naver.com',
  'm.stock.naver.com', 'api.stock.naver.com', 'ac.stock.naver.com',
]);

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname === '/api/proxy') {
    const target = u.searchParams.get('url');
    try {
      const t = new URL(target);
      if (!ALLOWED.has(t.hostname)) { res.writeHead(400).end('host'); return; }
      const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' } });
      const body = await r.text();
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'text/plain', 'access-control-allow-origin': '*' });
      res.end(body);
    } catch (e) { res.writeHead(502).end(String(e.message)); }
    return;
  }
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const file = path.join(ROOT, decodeURIComponent(p));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
server.listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`));
