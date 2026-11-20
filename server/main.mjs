#!/usr/bin/env node
// ZeroWichtel – Server und Kommandozeile. Benötigt Node.js ≥ 24.7, keine npm-Pakete.
//
//   zw serve [--host 127.0.0.1] [--port 8080]     Server starten (räumt selbst auf und verschickt Erinnerungen)
//   zw check                                       Konfiguration und Datenbank prüfen
//   zw codes create --label "…" [--rounds 3] [--days 60] | list | revoke <code>
//   zw open status | on --max 10 [--email] | off   Anlegen ohne Organisator-Code (Obergrenze gleichzeitiger Runden)
//   zw donation status | set --url https://… [--label "…"] [--note "…"] [--rounds on|off] | on | off   Unterstützungslink
//   zw admin <setup|status|password|totp|recovery|new-url|logout-all|unlock|remove>
//   zw cleanup [--vacuum]                          einmal aufräumen und fällige Mails verschicken
//   zw backup [--dir <ordner>] [--keep <tage>]     konsistente Sicherung (Standard: data/backup/, alte nach backup_days bzw. 14 Tagen löschen)
//
// Konfiguration: config.json (Pfad über ZW_CONFIG). Im Container ist „zw“ = node /app/server/main.mjs.
import { analogStats } from './stats.mjs';
import crypto from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { App, VERSION } from './app.mjs';
import { adminCommand, closeInput, codesCommand, donationCommand, openCommand, CliError } from './cli.mjs';
import { backup } from './backup.mjs';
import { cleanup } from './cleanup.mjs';
import { ROOT, loadConfig } from './config.mjs';
import { SCHEMA_VERSION, openDb, value } from './db.mjs';
import { createServer, loadStatic } from './http.mjs';
import { mailerFromConfig } from './mail/mailers.mjs';

const [cmd = 'help', ...args] = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const configPath = () => process.env.ZW_CONFIG || join(ROOT, 'config.json');
const stamp = (p) => { try { const s = statSync(p); return `${s.mtimeMs}:${s.size}`; } catch { return ''; } };

function serve(config, db) {
  // Nur für die Testsuite: Uhrzeit pro Anfrage über den Header X-ZW-Test-Now (nie in Produktion setzen).
  const testClock = process.env.ZW_TEST_CLOCK === '1';
  const host = opt('host', '127.0.0.1');
  // Die Testuhr lässt jede Anfrage die Uhrzeit setzen (Fristen, Löschung). Darum nur im Entwicklungsmodus und nur,
  // wenn der Server ausschließlich lokal lauscht – im Container (0.0.0.0, ohne ZW_DEV) startet er damit nicht.
  if (testClock && (process.env.ZW_DEV !== '1' || !['127.0.0.1', '::1', 'localhost'].includes(host))) {
    throw new CliError('ZW_TEST_CLOCK ist nur für Tests: braucht ZW_DEV=1 und --host 127.0.0.1. Bitte die Variable entfernen.');
  }
  let testNow = null;
  const clock = () => testNow ?? Math.floor(Date.now() / 1000);
  const makeApp = (c) => new App(db, c, { mailer: mailerFromConfig(c), clock });
  let app = makeApp(config);

  const server = createServer({ getApp: () => app, files: loadStatic(join(ROOT, 'public')), setTestNow: testClock ? (n) => { testNow = n; } : null });
  const port = Number(opt('port', '8080'));
  server.listen(port, host, () => console.log(`ZeroWichtel ${VERSION} läuft auf http://${host}:${port}`));

  // Geänderte config.json wird ohne Neustart übernommen (wie früher config.php). Ungültig → alte bleibt aktiv.
  let seen = stamp(configPath());
  const reload = () => {
    const now = stamp(configPath());
    if (now === seen) return;
    seen = now;
    try {
      app = makeApp(loadConfig(configPath()));
      console.log('ZeroWichtel: Konfiguration neu geladen.');
    } catch (e) {
      console.error(`ZeroWichtel: ${e.message} – bisherige Konfiguration bleibt aktiv.`);
    }
  };

  // Jede Minute: Konfiguration prüfen; aufräumen und Erinnerungen verschicken höchstens alle 10 Minuten
  // (ersetzt den früheren Cronjob).
  const timer = testClock ? null : setInterval(() => { reload(); app.housekeeping(); }, 60_000);
  if (!testClock) app.housekeeping();

  const stop = () => {
    clearInterval(timer);
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('SIGHUP', reload); // sofort neu laden: docker kill -s HUP zerowichtel
}

/** Kurzer Selbsttest für Installation und Betrieb – ohne Inhalte. */
function check(config, db) {
  const mail = config.mail.transport && mailerFromConfig(config) ? config.mail.transport
    : config.mail.transport === 'log' ? 'aus (Transport „log“ gibt es nur im Entwicklungsmodus – er schriebe Links mit Schlüsseln in eine Datei)' : 'aus';
  console.log(`ZeroWichtel ${VERSION} (Node ${process.versions.node})`);
  console.log(`Konfiguration: ok (${configPath()})`);
  console.log(`Datenbank:     ok (Schema ${value(db, 'PRAGMA user_version')}/${SCHEMA_VERSION}, ${value(db, 'SELECT COUNT(*) FROM rounds')} Runde(n))`);
  console.log(`Adresse:       ${config.base_url || '– (base_url fehlt)'}`);
  console.log(`E-Mail:        ${mail}`);
  console.log(`Admin-Bereich: ${config.admin.enabled ? 'eingeschaltet' : 'aus'}`);
  console.log(`Analog:        ${analogStats(db).total} Runde(n) zum Ausdrucken vorbereitet`);
}

async function main() {
  if (typeof crypto.argon2Sync !== 'function') throw new CliError(`Node.js ${process.versions.node} ist zu alt – benötigt wird Version 24.7 oder neuer.`);
  if (!['serve', 'check', 'codes', 'open', 'donation', 'admin', 'cleanup', 'backup'].includes(cmd)) {
    console.log(`ZeroWichtel ${VERSION}\n\nBefehle: serve, check, codes, open, donation, admin, cleanup, backup  (Details: siehe Kopf von server/main.mjs)`);
    return;
  }
  const config = loadConfig(configPath());
  const db = openDb(config.db_path);
  if (cmd === 'serve') return serve(config, db);
  if (cmd === 'check') check(config, db);
  if (cmd === 'codes') codesCommand(db, args);
  if (cmd === 'open') openCommand(db, config, args);
  if (cmd === 'donation') donationCommand(db, config, args);
  if (cmd === 'admin') await adminCommand(db, config, args).finally(closeInput);
  if (cmd === 'backup') {
    const i = args.indexOf('--dir');
    const k = args.indexOf('--keep');
    const keepDays = k >= 0 ? Math.trunc(Number(args[k + 1])) : (Number(config.privacy.backup_days) || 14);
    if (!(keepDays >= 0 && keepDays <= 365)) throw new CliError('--keep: 0 bis 365 Tage (0 = nichts löschen)');
    const r = backup(db, config.db_path, { dir: i >= 0 ? args[i + 1] : null, keepDays });
    console.log(`Sicherung: ${r.file}`);
    if (r.removed.length) console.log(`Gelöscht (älter als ${keepDays} Tage): ${r.removed.join(', ')}`);
    if (!config.privacy.backup_days) console.log('Hinweis: In config.json "privacy": { "backup_days": … } eintragen, damit die Datenschutzerklärung die Sicherungen nennt.');
  }
  if (cmd === 'cleanup') {
    const now = Math.floor(Date.now() / 1000);
    const r = cleanup(db, now, args.includes('--vacuum'));
    console.log(`Gelöschte Runden: ${r.rounds}, VACUUM: ${r.vacuum ? 'ja' : 'nein'}`);
    const n = await new App(db, config, { mailer: mailerFromConfig(config) }).notifier?.run(now);
    if (n) console.log(`E-Mails verschickt: ${n.sent}, fehlgeschlagen: ${n.failed}`);
  }
  db.close();
}

main().catch((e) => {
  console.error(e instanceof CliError || /^Konfiguration/.test(e.message) ? `Fehler: ${e.message}` : e);
  process.exit(1);
});
