// HTTP-Server: API unter /api/…, sonst die statischen Dateien aus public/ (beim Start in den Speicher geladen).
// Ersetzt Apache + .htaccess: dieselben Sicherheitsheader, HTTPS-Weiterleitung, keine Zugriffsprotokolle.
import http from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import zlib from 'node:zlib';
import { HttpError, parseBody } from './validate.mjs';

export const MAX_BODY = 65536;
// Adventsalbum (2.13): ein Foto bis 600 KB plus Vorschau, Base64 → eigene, größere Grenze nur für diesen Weg
export const MAX_PHOTO_BODY = 1_100_000;

// Für alle Antworten
const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // Keine Indexierung, kein KI-Training (TDM-Nutzungsvorbehalt, § 44b UrhG)
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai',
  'tdm-reservation': '1',
};
const STATIC_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; "
  + "worker-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const API_HEADERS = { 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg',
};
const NO_CACHE = new Set(['/index.html', '/sw.js']); // immer neu prüfen, damit Updates sofort ankommen

/** Liest public/ einmalig ein (inkl. gzip-Variante für Text). Versteckte Dateien außer .well-known bleiben draußen. */
export function loadStatic(dir, prefix = '') {
  const files = new Map();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.well-known') continue;
    const full = join(dir, e.name);
    const url = `${prefix}/${e.name}`;
    if (e.isDirectory()) {
      for (const [k, v] of loadStatic(full, url)) files.set(k, v);
      continue;
    }
    if (!e.isFile() || e.name.endsWith('.php')) continue;
    const body = readFileSync(full);
    const type = TYPES[extname(e.name)] ?? 'application/octet-stream';
    const gz = /^(text\/|application\/(json|manifest)|image\/svg)/.test(type) && body.length > 1024 ? zlib.gzipSync(body, { level: 9 }) : null;
    files.set(url, { body, gz, type, mtime: new Date(Math.floor(statSync(full).mtimeMs / 1000) * 1000) });
  }
  return files;
}

function send(res, status, headers, body = null) {
  res.writeHead(status, { ...COMMON, ...headers, ...(body !== null ? { 'Content-Length': body.length } : {}) });
  res.end(body);
}

/**
 * Liest den Körper bis MAX_BODY; größer → 413. Der Rest wird nur noch verworfen (nicht gespeichert),
 * damit der Client die Antwort sauber erhält; requestTimeout begrenzt die Dauer.
 */
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('end', () => (size > max ? reject(new HttpError(413, 'too_large', 'Anfrage zu groß.')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

/**
 * @param {object} o
 * @param {() => import('./app.mjs').App} o.getApp  aktuelle App (wird bei geänderter Konfiguration ausgetauscht)
 * @param {Map} o.files            Ergebnis von loadStatic()
 * @param {(now:number)=>void} [o.setTestNow]  nur in Tests: Uhrzeit aus dem Header X-ZW-Test-Now
 */
export function createServer({ getApp, files, setTestNow = null }) {
  async function api(req, res, path, app, hsts) {
    const { config } = app;
    const reply = (status, data) => send(res, status, { ...hsts, ...API_HEADERS, ...(data ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
      data ? Buffer.from(JSON.stringify(data)) : null);
    let body = {};
    try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        // Große Anfragen nur für Foto-Uploads mit gültigem Teilnehmerzugang (vorab geprüft, bevor gelesen wird)
        const auth0 = typeof req.headers['x-zw-auth'] === 'string' ? req.headers['x-zw-auth'] : null;
        const big = req.method === 'POST' && path === '/me/photos' && app.photoUploadAllowed(auth0);
        body = parseBody(await readBody(req, big ? MAX_PHOTO_BODY : MAX_BODY));
      }
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, { error: e.code, message: e.message });
      throw e;
    }
    let ip = req.socket.remoteAddress ?? '';
    const hdr = config.client_ip_header ? req.headers[String(config.client_ip_header).toLowerCase()] : null;
    if (typeof hdr === 'string' && hdr !== '') ip = hdr.split(',')[0].trim();
    const auth = typeof req.headers['x-zw-auth'] === 'string' ? req.headers['x-zw-auth'] : null;
    if (setTestNow && req.headers['x-zw-test-now']) setTestNow(Number(req.headers['x-zw-test-now']));
    const { status, data } = await app.handle({ method: req.method, path, body, auth, ip });
    reply(status, data);
  }

  function serveStatic(req, res, rawPath, hsts) {
    const h = { ...hsts, 'Content-Security-Policy': STATIC_CSP };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ...h, Allow: 'GET, HEAD' }, Buffer.from(''));
    let path;
    try {
      path = posix.normalize(decodeURIComponent(rawPath));
    } catch {
      return send(res, 400, h, Buffer.from(''));
    }
    if (/(^|\/)\.(?!well-known\/)/.test(path) || path.includes('\0')) return send(res, 403, { ...h, 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('Verboten'));
    if (path.endsWith('/')) path += 'index.html';
    const f = files.get(path);
    if (!f) return send(res, 404, { ...h, 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('Nicht gefunden'));

    const fh = { ...h, 'Content-Type': f.type, 'Last-Modified': f.mtime.toUTCString(), ...(NO_CACHE.has(path) ? { 'Cache-Control': 'no-cache' } : {}) };
    if (f.gz) fh.Vary = 'Accept-Encoding';
    const since = Date.parse(req.headers['if-modified-since'] ?? '');
    if (since >= f.mtime.getTime()) return send(res, 304, fh);
    // Teilanfragen (Audio, v. a. Safari): ein Bereich „bytes=a-b“, unkomprimiert
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const size = f.body.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) return send(res, 416, { ...h, 'Content-Range': `bytes */${size}` }, Buffer.from(''));
      return send(res, 206, { ...fh, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}` }, f.body.subarray(start, end + 1));
    }
    if (!f.gz) fh['Accept-Ranges'] = 'bytes';
    const gzip = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    send(res, 200, gzip ? { ...fh, 'Content-Encoding': 'gzip' } : fh, gzip ? f.gz : f.body);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const raw = req.url ?? '/';
      if (!raw.startsWith('/')) return send(res, 400, {}, Buffer.from(''));
      const app = getApp();
      const base = app.baseUrl;
      const httpsOnly = /^https:\/\//i.test(base);
      const hsts = httpsOnly ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {};
      // Hinter dem Reverse Proxy: nur HTTPS (der Proxy meldet das per X-Forwarded-Proto)
      if (httpsOnly && req.headers['x-forwarded-proto'] !== 'https') return send(res, 301, { ...hsts, Location: base + raw }, Buffer.from(''));
      const path = raw.split('?')[0];
      if (path === '/api' || path.startsWith('/api/')) return await api(req, res, path.slice(4) || '/', app, hsts);
      return serveStatic(req, res, path, hsts);
    } catch (e) {
      console.error(`ZeroWichtel: ${e?.stack ?? e}`);
      if (!res.headersSent) send(res, 500, API_HEADERS, Buffer.from('{"error":"server","message":"Interner Fehler."}'));
      else res.destroy();
    }
  });
  server.requestTimeout = 30000; // wie Apache „Timeout 30“
  server.headersTimeout = 20000;
  server.keepAliveTimeout = 5000;
  return server;
}
