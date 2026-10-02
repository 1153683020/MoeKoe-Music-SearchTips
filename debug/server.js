// debug/server.js - 调试台静态服务器（无依赖）
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8931;
const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400); res.end(); return;
  }
  if (p === '/' || p === '') p = '/debug/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not Found: ' + p); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('[debug-server] listening at http://127.0.0.1:' + PORT);
});
