// Servidor mínimo (sin dependencias) para Render u otro hosting con Node 18+.
// Sirve la carpeta public/ y el endpoint POST /api/form que lee formularios por enlace.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleFormRequest } from './lib/forms.mjs';

const ROOT = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

// Límite sencillo: 30 lecturas de formulario por minuto y por IP
const hits = new Map();
function limited(ip) {
  const now = Date.now(), w = hits.get(ip) || [];
  const recent = w.filter(t => now - t < 60000);
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 30;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/form') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Método no permitido' });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { ok: false, error: 'Demasiadas peticiones. Espera un minuto.' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 10000) return send(res, 413, { ok: false, error: 'Petición demasiado grande' }); }
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { ok: false, error: 'JSON no válido' }); }
      const out = await handleFormRequest(body.url);
      return send(res, out.status, out.body);
    }
    if (url.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido', 'text/plain');

    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) return send(res, 403, 'Prohibido', 'text/plain');
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error();
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      send(res, 404, 'No encontrado', 'text/plain; charset=utf-8');
    }
  } catch (e) {
    send(res, 500, { ok: false, error: 'Error interno' });
  }
});

server.listen(PORT, () => console.log(`Generador de respuestas en http://localhost:${PORT}`));
