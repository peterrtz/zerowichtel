// Startet einen lokalen ZeroWichtel-Server (Node) mit frischer Datenbank für E2E-, UI- und Browser-Tests.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Testschlüssel sind feste Werte – im Entwicklungsmodus zulässig (siehe server/config.mjs).
process.env.ZW_DEV = '1';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = join(ROOT, 'server', 'main.mjs');

// Richtet den Admin-Bereich mit bekanntem Passwort ein (für Tests). Gibt Pfad, TOTP-Geheimnis und Notfallcodes zurück.
const ADMIN_SETUP = `
const [root, password] = process.argv.slice(1);
const { loadConfig } = await import(root + '/server/config.mjs');
const { openDb } = await import(root + '/server/db.mjs');
const { Admin, totp } = await import(root + '/server/admin.mjs');
const c = loadConfig();
const secret = totp.newSecret();
const r = new Admin(openDb(c.db_path), c.server_key_raw).setup(password, secret, Math.floor(Date.now() / 1000));
console.log(JSON.stringify({ slug: r.slug, secret, recovery: r.recovery }));`;
function adminSetupWith(nodeCmd, appRoot, env, password) {
  const out = execFileSync(nodeCmd[0], [...nodeCmd.slice(1), '--input-type=module', '-e', ADMIN_SETUP, appRoot, password], { env }).toString();
  return { ...JSON.parse(out), password };
}

export async function startServer({ lazy = true } = {}) {
  // Gegen eine laufende Installation testen (z. B. Docker hinter Caddy):
  //   ZW_EXTERNAL_BASE=https://… ZW_CODES_CMD="docker exec zerowichtel zw codes" ZW_NODE_CMD="docker exec zerowichtel node" ZW_APP_ROOT=/app
  if (process.env.ZW_EXTERNAL_BASE) {
    const cmd = (process.env.ZW_CODES_CMD || `${process.execPath} ${MAIN} codes`).split(' ');
    return {
      base: process.env.ZW_EXTERNAL_BASE.replace(/\/$/, ''),
      external: true,
      mails: () => [],
      log: () => '',
      // Optional: SQL in der Datenbank der Installation, z. B. ZW_EXTERNAL_DB=/app/data/zerowichtel.sqlite mit ZW_NODE_CMD="docker exec zerowichtel node"
      sql: (q) => {
        if (!process.env.ZW_EXTERNAL_DB) throw new Error('sql() nicht verfügbar bei externer Installation (ZW_EXTERNAL_DB setzen)');
        const nodeCmd = (process.env.ZW_NODE_CMD || process.execPath).split(' ');
        const code = 'import { DatabaseSync } from "node:sqlite"; const [p, q] = process.argv.slice(1); const d = new DatabaseSync(p, { timeout: 5000 }); d.exec(q);';
        execFileSync(nodeCmd[0], [...nodeCmd.slice(1), '--input-type=module', '-e', code, process.env.ZW_EXTERNAL_DB, q]);
      },
      organizerCode: (rounds = 3) => execFileSync(cmd[0], [...cmd.slice(1), 'create', '--label', 'Test', '--rounds', String(rounds)]).toString().match(/ZW-[A-Z0-9-]+/)[0],
      adminSetup: (password = 'test passwort lang genug') => adminSetupWith((process.env.ZW_NODE_CMD || process.execPath).split(' '), process.env.ZW_APP_ROOT || ROOT, process.env, password),
      stop: () => {},
    };
  }
  const port = 18000 + Math.floor(Math.random() * 1500);
  const base = `http://127.0.0.1:${port}`;
  const tmp = mkdtempSync(join(tmpdir(), 'zw-test-'));
  const cfgPath = join(tmp, 'config.json');
  const dbPath = join(tmp, 'test.sqlite');
  const mailLog = join(tmp, 'mail.log');
  writeFileSync(cfgPath, JSON.stringify({
    db_path: dbPath,
    server_key: Buffer.alloc(32, 7).toString('base64'),
    lazy_cleanup: lazy,
    base_url: base,
    mail: { transport: 'log', from_email: 'noreply@localhost', log_path: mailLog },
    admin: { enabled: true },
    rate_limits: { read: [100000, 3600], write: [100000, 3600], claim: [1000, 3600], create_round: [1000, 3600], recover: [1000, 3600] },
  }));
  const env = { ...process.env, ZW_CONFIG: cfgPath };
  const proc = spawn(process.execPath, [MAIN, 'serve', '--port', String(port)], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; });

  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/info`)).ok) break;
    } catch { /* wartet */ }
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    base,
    dbPath,
    env,
    mails: () => (existsSync(mailLog) ? readFileSync(mailLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    log: () => log,
    /** SQL direkt auf der Testdatenbank; Ergebnis als JSON-Text (wie früher). */
    sql: (q) => {
      const db = new DatabaseSync(dbPath);
      try {
        const st = db.prepare(q);
        return JSON.stringify(st.columns().length ? st.all() : (st.run(), []));
      } finally { db.close(); }
    },
    organizerCode: (rounds = 3) => execFileSync(process.execPath, [MAIN, 'codes', 'create', '--label', 'Test', '--rounds', String(rounds)], { env }).toString().match(/ZW-[A-Z0-9-]+/)[0],
    adminSetup: (password = 'test passwort lang genug') => adminSetupWith([process.execPath], ROOT, env, password),
    stop: () => {
      proc.kill();
      rmSync(tmp, { recursive: true, force: true });
      // Fehler des Servers sichtbar machen
      const issues = log.split('\n').filter((l) => /(Error|Warning|ZeroWichtel:)/.test(l));
      if (issues.length) {
        console.log(`Server meldete ${issues.length} Hinweis(e):\n  ${[...new Set(issues)].slice(0, 10).join('\n  ')}`);
        process.exitCode = 1;
      }
    },
  };
}
