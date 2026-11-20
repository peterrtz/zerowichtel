// Sprachneutrale Testumgebung für die HTTP-API: startet je Test einen frischen Server – wahlweise
// die Node-Version (Standard) oder zur Gegenprobe die PHP-Version 1.2.1:
//
//   node tests/api/run.mjs                                   # Node
//   git worktree add /tmp/zw-php v1.2.1
//   ZW_IMPL=php ZW_PHP_ROOT=/tmp/zw-php node tests/api/run.mjs   # dieselben Tests gegen PHP
//
// Die Uhrzeit steuert der Test über den Header X-ZW-Test-Now (nur im Testmodus ausgewertet).
// Einige Hilfen (Code anlegen, Admin einrichten, Benachrichtigungen auslösen) laufen direkt gegen die
// jeweilige Implementierung – so wie früher die PHP-Unit-Tests.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

// Testschlüssel sind feste Werte – im Entwicklungsmodus zulässig (siehe server/config.mjs).
process.env.ZW_DEV = '1';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IMPL = process.env.ZW_IMPL || 'node';
const PHP_ROOT = process.env.ZW_PHP_ROOT || ROOT;
export const T0 = Date.UTC(2026, 10, 1, 12) / 1000; // 2026-11-01 12:00 UTC
export const SERVER_KEY = Buffer.alloc(32, 'k');

// ------------------------------------------------------------------ kleine Hilfen

export const b64u = (b) => Buffer.from(b).toString('base64url');
export const nid = () => b64u(crypto.randomBytes(16));
export const ct = (n = 60) => `v1.${b64u(crypto.randomBytes(n))}`;
export const sealed = () => `s1.${b64u(crypto.randomBytes(90))}`;
export const h = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Eigene TOTP-Berechnung (RFC 6238), unabhängig von beiden Implementierungen. */
export function totpCode(secretB32, step, digits = 6) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = secretB32.toUpperCase().split('').map((c) => B32.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const off = mac[19] & 15;
  return String((mac.readUInt32BE(off) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}

/** PHP-Code mit geladener Konfiguration ($c) und Datenbank ($db) ausführen. */
const phpSnippet = (cfgPath, code, ...args) => execFileSync('php', ['-r', `require getenv("ZW_PHP_ROOT") . "/src/bootstrap.php"; $c = zw_config(); $db = ZeroWichtel\\Db::open($c["db_path"]); ${code}`, ...args.map(String)],
  { env: { ...process.env, ZW_PHP_ROOT: PHP_ROOT, ZW_CONFIG: cfgPath } }).toString();

// ------------------------------------------------------------------ Server

/**
 * @param {object} o
 * @param {boolean} [o.mail=true]      Log-Mailer an/aus
 * @param {boolean} [o.lazy=false]     lazy_cleanup
 * @param {boolean} [o.admin]          admin.enabled
 * @param {object}  [o.rateLimits]
 * @param {string}  [o.dbPath]         bestehende Datenbank verwenden
 * @param {'node'|'php'} [o.impl]      Implementierung (Standard: ZW_IMPL)
 */
export async function startServer(o = {}) {
  const impl = o.impl ?? IMPL;
  const tmp = mkdtempSync(join(tmpdir(), 'zw-api-'));
  const dbPath = o.dbPath ?? join(tmp, 'db.sqlite');
  const mailLog = join(tmp, 'mail.log');
  const cfg = {
    db_path: dbPath,
    server_key: SERVER_KEY.toString('base64'),
    lazy_cleanup: o.lazy ?? false,
    base_url: 'https://zw.example',
    client_ip_header: 'X-Forwarded-For',
    admin: { enabled: o.admin ?? false },
    ...(o.rateLimits ? { rate_limits: o.rateLimits } : {}),
    ...(o.mail === false ? {} : { mail: { transport: 'log', from_email: 'noreply@zw.example', log_path: mailLog } }),
  };
  // Zufälliger Port unterhalb des Linux-Bereichs für ausgehende Verbindungen (ab 32768); ist er doch belegt
  // (EADDRINUSE), mit einem anderen Port neu starten.
  let cfgPath;
  let proc;
  let port;
  let log = '';
  let base;
  let up = false;
  for (let attempt = 0; attempt < 5 && !up; attempt++) {
    port = 10000 + Math.floor(Math.random() * 22000);
    if (impl === 'php') {
      cfgPath = join(tmp, 'config.php');
      writeFileSync(cfgPath, `<?php return json_decode(${JSON.stringify(JSON.stringify(cfg))}, true);`);
      proc = spawn('php', ['-S', `127.0.0.1:${port}`, join(ROOT, 'tests', 'api', 'php-router.php')],
        { env: { ...process.env, ZW_CONFIG: cfgPath, ZW_PHP_ROOT: PHP_ROOT }, stdio: ['ignore', 'ignore', 'pipe'] });
    } else {
      cfgPath = join(tmp, 'config.json');
      writeFileSync(cfgPath, JSON.stringify(cfg));
      proc = spawn(process.execPath, [join(ROOT, 'server', 'main.mjs'), 'serve', '--port', String(port)],
        { env: { ...process.env, ZW_CONFIG: cfgPath, ZW_TEST_CLOCK: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    }
    log = '';
    let exited = false;
    proc.on('exit', () => { exited = true; });
    proc.stderr.on('data', (d) => { log += d; });
    base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 300 && !up && !exited; i++) {
      try {
        // Mit Testuhr: sonst setzt schon diese Anfrage last_cleanup auf die echte Uhrzeit
        await fetch(`${base}/api/gibtsnicht`, { headers: { 'X-Forwarded-Proto': 'https', 'X-ZW-Test-Now': String(T0) } });
        up = !exited;
      } catch { await new Promise((r) => setTimeout(r, 50)); }
    }
    if (!up && !/EADDRINUSE|Address already in use/.test(log)) break;
    if (!up) proc.kill();
  }
  // Diagnose für seltene Startfehler im Gesamtlauf (2.5.1: ca. 1 von 10 Läufen, Ursache noch nicht gefunden)
  if (!up) throw new Error(`Server (${impl}) startet nicht (Port ${port}, Prozess ${proc.exitCode === null ? 'läuft noch' : `beendet mit ${proc.exitCode}/${proc.signalCode}`}, ${new Date().toISOString()}): ${log.slice(-500)}`);

  const db = () => new DatabaseSync(dbPath);
  const nodeMods = impl === 'node' ? {
    ...(await import('../../server/db.mjs')),
    ...(await import('../../server/codes.mjs')),
    ...(await import('../../server/admin.mjs')),
    ...(await import('../../server/cleanup.mjs')),
    ...(await import('../../server/app.mjs')),
    ...(await import('../../server/config.mjs')),
    ...(await import('../../server/mail/mailers.mjs')),
    ...(await import('../../server/crypto.mjs')),
  } : null;
  const withNodeDb = (fn) => {
    const d = nodeMods.openDb(dbPath);
    try { return fn(d); } finally { d.close(); }
  };
  const php = (code, ...args) => phpSnippet(cfgPath, code, ...args);

  return {
    base,
    dbPath,
    log: () => log,

    /** Liefert [Status, JSON-Daten]. */
    async call(method, path, body = null, auth = null, { ip = '10.0.0.1', now, raw } = {}) {
      const headers = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': ip, 'X-ZW-Test-Now': String(now) };
      if (auth !== null) headers['X-ZW-Auth'] = auth;
      let payload;
      if (raw !== undefined) payload = raw;
      else if (method !== 'GET') payload = JSON.stringify(body ?? {});
      if (payload !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${base}/api${path}`, { method, headers, body: payload });
      const text = await res.text();
      const isJson = /json/.test(res.headers.get('content-type') ?? '');
      return [res.status, text && isJson ? JSON.parse(text) : text || null, res];
    },

    sql(q, ...args) {
      const d = db();
      try { return d.prepare(q).all(...args); } finally { d.close(); }
    },
    sqlValue(q, ...args) {
      const row = this.sql(q, ...args)[0];
      return row ? Object.values(row)[0] : undefined;
    },
    exec(q) {
      const d = db();
      try { d.exec(q); } finally { d.close(); }
    },
    /** Kommandozeile „zw …“ gegen die Testdatenbank (nur Node); liefert { status, out }. */
    cli(...args) {
      try {
        return { status: 0, out: execFileSync(process.execPath, [join(ROOT, 'server', 'main.mjs'), ...args], { env: { ...process.env, ZW_CONFIG: cfgPath }, stdio: ['ignore', 'pipe', 'pipe'] }).toString() };
      } catch (e) { return { status: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
    },
    mails: () => (existsSync(mailLog) ? readFileSync(mailLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),

    // ---- direkt gegen die Implementierung
    code(rounds, days, now, label = 'Test') {
      if (impl === 'php') return php('echo ZeroWichtel\\OrganizerCodes::create($db, $argv[1], (int) $argv[2], (int) $argv[3], (int) $argv[4]);', label, rounds, days, now);
      return withNodeDb((d) => nodeMods.createCode(d, label, rounds, days, now));
    },
    adminSetup(password, now) {
      if (impl === 'php') {
        return JSON.parse(php('$a = new ZeroWichtel\\Admin($db, ZeroWichtel\\Admin::crypto($c["server_key_raw"])); $s = ZeroWichtel\\Totp::newSecret();'
          + ' $r = $a->setup($argv[1], $s, (int) $argv[2]); echo json_encode(["slug" => $r["slug"], "secret" => $s, "recovery" => $r["recovery"]]);', password, now));
      }
      return withNodeDb((d) => {
        const secret = nodeMods.totp.newSecret();
        const r = new nodeMods.Admin(d, SERVER_KEY).setup(password, secret, now);
        return { slug: r.slug, secret, recovery: r.recovery };
      });
    },
    adminNewPath(now) {
      if (impl === 'php') return php('echo (new ZeroWichtel\\Admin($db, ZeroWichtel\\Admin::crypto($c["server_key_raw"])))->newPath((int) $argv[1]);', now);
      return withNodeDb((d) => new nodeMods.Admin(d, SERVER_KEY).newPath(now));
    },
    /** Benachrichtigungen wie im Hintergrundlauf. */
    async notify(now) {
      if (impl === 'php') {
        return JSON.parse(php('$app = new ZeroWichtel\\App($db, $c, fn () => (int) $argv[1], ZeroWichtel\\Mail\\MailerFactory::fromConfig($c)); echo json_encode($app->notifier()->run((int) $argv[1]));', now));
      }
      const d = nodeMods.openDb(dbPath);
      try {
        const config = nodeMods.loadConfig(cfgPath);
        return await new nodeMods.App(d, config, { mailer: nodeMods.mailerFromConfig(config) }).notifier.run(now);
      } finally { d.close(); }
    },
    cleanup(now) {
      if (impl === 'php') return JSON.parse(php('echo json_encode(ZeroWichtel\\Cleanup::run($db, (int) $argv[1]));', now));
      return withNodeDb((d) => nodeMods.cleanup(d, now));
    },
    /** Serverseitige Verschlüsselung: seal und open in der Implementierung. */
    serverCrypto(op, keyChar, a, b) {
      const key = Buffer.alloc(32, keyChar);
      if (impl === 'php') {
        const r = php('$s = new ZeroWichtel\\ServerCrypto(str_repeat($argv[1], 32)); echo json_encode($argv[2] === "seal" ? $s->seal($argv[3], $argv[4]) : $s->open($argv[3], $argv[4]));', keyChar, op, a, b);
        return JSON.parse(r);
      }
      const s = new nodeMods.ServerCrypto(key);
      return op === 'seal' ? s.seal(a, b) : s.open(a, b);
    },

    stop() {
      proc.kill();
      rmSync(tmp, { recursive: true, force: true });
      const issues = log.split('\n').filter((l) => /(Deprecated|Warning|Notice|Fatal error|Error:|TypeError|ReferenceError)/.test(l));
      return issues;
    },
  };
}
