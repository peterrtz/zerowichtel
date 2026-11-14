// Kommandozeile: Organisator-Codes und Admin-Bereich verwalten (zw codes …, zw admin …).
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Admin, MAX_FAILURES, MIN_PASSWORD, RECOVERY_COUNT, totp } from './admin.mjs';
import { codeHash, createCode } from './codes.mjs';
import { openSettings, openStatus, saveOpenSettings, describeOpen, OPEN_MAX } from './open-creation.mjs';
import { all, run } from './db.mjs';
import qrcode from '../public/js/vendor/qrcode.mjs';

const out = (s = '') => process.stdout.write(`${s}\n`);
const nowSec = () => Math.floor(Date.now() / 1000);
const pad2 = (n) => String(n).padStart(2, '0');
/** Datum/Uhrzeit in der Zeitzone des Servers (TZ, im Container Europe/Berlin). */
const ymd = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const hm = (ts) => { const d = new Date(ts * 1000); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

export class CliError extends Error {}

/** Wert einer Option wie --label "…" */
const opt = (args, name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

// ------------------------------------------------------------------ Eingabe

let lines = null;
let rl = null;
/** Beendet das Lesen von stdin, damit sich der Prozess beenden kann. */
export const closeInput = () => rl?.close();
/** Liest Zeilen von stdin (Terminal oder Pipe). Verdeckte Eingabe über „stty -echo“ wie in der PHP-Version. */
async function ask(prompt, hidden = false) {
  if (!lines) {
    rl = createInterface({ input: process.stdin, terminal: false });
    const queue = [];
    const waiters = [];
    rl.on('line', (l) => (waiters.length ? waiters.shift()(l) : queue.push(l)));
    rl.on('close', () => { while (waiters.length) waiters.shift()(null); queue.push(null); });
    lines = () => new Promise((resolve) => (queue.length ? resolve(queue.shift()) : waiters.push(resolve)));
  }
  const tty = process.stdin.isTTY;
  const stty = (arg) => spawnSync('stty', [arg], { stdio: ['inherit', 'ignore', 'ignore'] });
  if (hidden && tty) stty('-echo'); // vor der Eingabeaufforderung, sonst kann schnelles Tippen noch erscheinen
  process.stdout.write(prompt);
  const line = await lines();
  if (hidden && tty) {
    stty('echo');
    out();
  }
  if (line === null) throw new CliError('Eingabe abgebrochen. Im Container mit „docker exec -it …“ aufrufen.');
  return line.replace(/\r$/, '');
}

async function askPassword() {
  for (let i = 0; i < 3; i++) {
    const a = await ask(`Neues Masterpasswort (mindestens ${MIN_PASSWORD} Zeichen): `, true);
    if ([...a].length < MIN_PASSWORD) {
      out('Zu kurz. Tipp: vier, fünf zufällige Wörter aus dem Passwortmanager.');
      continue;
    }
    if (await ask('Passwort wiederholen: ', true) !== a) {
      out('Die Eingaben stimmen nicht überein.');
      continue;
    }
    return a;
  }
  throw new CliError('Kein Passwort gesetzt.');
}

/** QR-Code als Unicode-Halbblöcke (zwei Modulzeilen je Textzeile), schwarz auf weiß erzwungen. */
export function terminalQr(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const rows = [];
  for (let r = -2; r < n + 2; r += 2) {
    let line = '';
    for (let c = -2; c < n + 2; c++) {
      const top = dark(r, c);
      const bottom = dark(r + 1, c);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    rows.push(`\x1b[30;47m${line}\x1b[0m`);
  }
  return rows.join('\n');
}

/** Zeigt ein neues TOTP-Geheimnis (QR und Klartext) und lässt einen Code bestätigen. */
async function enrollTotp(account) {
  const secret = totp.newSecret();
  out();
  out('Authenticator-App einrichten (z. B. Aegis, 2FAS, Ente Auth, Google/Microsoft Authenticator):');
  out();
  if (process.stdout.isTTY) {
    out('QR-Code mit der App scannen:');
    out(terminalQr(totp.uri(secret, account)));
    out('Oder von Hand eingeben:');
  } else {
    out('Von Hand in der App eingeben („Schlüssel eingeben“, zeitbasiert):');
  }
  out(`  Konto:     ${account}`);
  out(`  Schlüssel: ${secret.match(/.{1,4}/g).join(' ')}`);
  out();
  for (let i = 0; i < 5; i++) {
    if (totp.verify(secret, await ask('Zur Bestätigung den 6-stelligen Code aus der App eingeben: '), nowSec()) !== null) {
      out('Code stimmt.');
      return secret;
    }
    out('Code passt nicht. Uhrzeit auf Handy und Server prüfen, dann erneut versuchen.');
  }
  throw new CliError('Authenticator nicht bestätigt – nichts geändert.');
}

function printRecovery(codes) {
  out();
  out('Notfallcodes – jeder funktioniert genau einmal statt des App-Codes.');
  out('Jetzt in den Passwortmanager übernehmen, sie werden nicht wieder angezeigt:');
  out();
  for (let i = 0; i < codes.length; i += 2) out(`  ${codes.slice(i, i + 2).join('     ')}`);
  out();
}

// ------------------------------------------------------------------ zw codes

export function codesCommand(db, args) {
  switch (args[0]) {
    case 'create': {
      const label = opt(args, 'label', '');
      const rounds = Math.max(1, Math.trunc(Number(opt(args, 'rounds', '3'))) || 1);
      const days = Math.max(1, Math.trunc(Number(opt(args, 'days', '60'))) || 1);
      const code = createCode(db, label, rounds, days, nowSec());
      out(`Neuer Organisator-Code (wird nur jetzt angezeigt):\n\n  ${code}\n`);
      out(`Gültig für ${rounds} Runde(n), ${days} Tage. Label: ${label || '–'}`);
      break;
    }
    case 'list': {
      const rows = all(db, 'SELECT substr(code_hash, 1, 10) AS h, label, used_rounds, max_rounds, expires_at FROM organizer_codes ORDER BY created_at DESC');
      if (!rows.length) out('Keine Codes.');
      for (const r of rows) {
        out(`${r.h}…  ${(r.label || '–').padEnd(24)}  ${r.used_rounds}/${r.max_rounds} Runden  gültig bis ${ymd(r.expires_at)}${r.expires_at < nowSec() ? '  (abgelaufen)' : ''}`);
      }
      break;
    }
    case 'revoke':
      out(run(db, 'DELETE FROM organizer_codes WHERE code_hash = ?', codeHash(args[1] ?? '')).changes ? 'Code widerrufen.' : 'Code nicht gefunden.');
      break;
    default:
      out('Verwendung:\n  zw codes create --label "Name" [--rounds 3] [--days 60]\n  zw codes list\n  zw codes revoke <code>');
  }
}

// ------------------------------------------------------------------ zw open

/** Anlegen ohne Organisator-Code: zw open status | zw open on --max 10 [--email] | zw open off */
export function openCommand(db, config, args) {
  const show = () => {
    const s = openStatus(db);
    out(`Anlegen ohne Code: ${describeOpen(s)}`);
    if (s.enabled) out(`Belegt: ${s.used} von ${s.maxRounds} (frei: ${s.free})`);
    if (!config.require_organizer_code) out('Hinweis: require_organizer_code ist in config.json false – dann geht Anlegen ohnehin ohne Code und ohne Grenze.');
  };
  switch (args[0]) {
    case 'on': {
      const max = Math.trunc(Number(opt(args, 'max', String(openSettings(db).maxRounds))));
      if (!(max >= 1 && max <= OPEN_MAX)) throw new CliError(`--max: 1 bis ${OPEN_MAX}`);
      saveOpenSettings(db, { enabled: true, maxRounds: max, email: args.includes('--email') });
      new Admin(db, config.server_key_raw).log(nowSec(), 'Anlegen ohne Code', `${describeOpen(openSettings(db))} (Kommandozeile)`);
      show();
      break;
    }
    case 'off':
      saveOpenSettings(db, { ...openSettings(db), enabled: false });
      new Admin(db, config.server_key_raw).log(nowSec(), 'Anlegen ohne Code', 'aus (Kommandozeile)');
      show();
      break;
    case 'status':
    case undefined:
      show();
      break;
    default:
      out('Verwendung:\n  zw open status\n  zw open on --max 10 [--email]   (höchstens 10 gleichzeitige Runden ohne Code)\n  zw open off');
  }
}

// ------------------------------------------------------------------ zw admin

export async function adminCommand(db, config, args) {
  const admin = new Admin(db, config.server_key_raw);
  const base = String(config.base_url).replace(/\/+$/, '');
  const enabled = Boolean(config.admin.enabled);
  const host = (() => { try { return new URL(base).hostname || 'zerowichtel'; } catch { return 'zerowichtel'; } })();
  const requireSetUp = () => { if (!admin.isSetUp()) throw new CliError('Der Admin-Bereich ist noch nicht eingerichtet: zw admin setup'); };
  const enableHint = 'in config.json: "admin": { "enabled": true }';

  switch (args[0]) {
    case 'setup': {
      if (admin.isSetUp() && (await ask('Es gibt bereits einen Admin-Zugang. Komplett ersetzen? [j/N] ')).toLowerCase() !== 'j') {
        out('Abgebrochen.');
        return;
      }
      out('ZeroWichtel – Admin-Bereich einrichten');
      out();
      const pw = await askPassword();
      const secret = await enrollTotp(host);
      const res = admin.setup(pw, secret, nowSec());
      printRecovery(res.recovery);
      out('Adresse des Admin-Bereichs (als Lesezeichen speichern, nicht weitergeben):');
      out();
      out(`  ${base}/#backend/${res.slug}`);
      out();
      if (!enabled) out(`Noch ausgeschaltet. Eintragen ${enableHint}`);
      return;
    }
    case 'status': {
      if (!admin.isSetUp()) {
        out('Nicht eingerichtet.  →  zw admin setup');
        return;
      }
      const r = admin.row();
      const now = nowSec();
      out(`Eingerichtet:        ja (seit ${ymd(r.created_at)})`);
      out(`Eingeschaltet:       ${enabled ? 'ja' : `nein  →  ${enableHint}`}`);
      out(`Adresse:             ${base}/#backend/${r.slug}`);
      out(`Aktive Sitzungen:    ${admin.activeSessionCount(now)}`);
      out(`Notfallcodes übrig:  ${admin.unusedRecoveryCount()} von ${RECOVERY_COUNT}`);
      out(`Sperre:              ${r.locked_until > now ? `gesperrt bis ${hm(r.locked_until)}  →  zw admin unlock` : 'keine'}`);
      out(`Fehlversuche:        ${r.failures} (Sperre ab ${MAX_FAILURES})`);
      out();
      out('Letzte Ereignisse:');
      for (const l of admin.recentLog(10)) out(`  ${ymd(l.ts)} ${hm(l.ts)}  ${l.event}${l.detail ? `  · ${l.detail}` : ''}`);
      return;
    }
    case 'password':
      requireSetUp();
      admin.setPassword(await askPassword(), nowSec());
      out('Passwort geändert, alle Sitzungen beendet.');
      return;
    case 'totp':
      requireSetUp();
      admin.setTotp(await enrollTotp(host), nowSec());
      out('Authenticator neu eingerichtet, alle Sitzungen beendet. Den alten Eintrag in der App löschen.');
      return;
    case 'recovery':
      requireSetUp();
      printRecovery(admin.newRecoveryCodes(nowSec()));
      out('Die bisherigen Notfallcodes sind ungültig.');
      return;
    case 'new-url':
      requireSetUp();
      out('Neue Adresse (alte funktioniert nicht mehr, alle Sitzungen beendet):');
      out();
      out(`  ${base}/#backend/${admin.newPath(nowSec())}`);
      return;
    case 'logout-all':
      requireSetUp();
      out(`${admin.logoutAll()} Sitzung(en) beendet.`);
      return;
    case 'unlock':
      requireSetUp();
      admin.unlock(nowSec());
      out('Sperre aufgehoben.');
      return;
    case 'remove':
      requireSetUp();
      if ((await ask('Admin-Zugang, Notfallcodes und Protokoll löschen? Organisator-Codes bleiben. [j/N] ')).toLowerCase() !== 'j') {
        out('Abgebrochen.');
        return;
      }
      admin.remove();
      out('Entfernt. In config.json zusätzlich "admin": { "enabled": false } setzen.');
      return;
    default:
      out('Verwendung: zw admin <befehl>');
      out();
      out('  setup        Passwort, Authenticator und Notfallcodes einrichten');
      out('  status       Zustand und letzte Ereignisse anzeigen');
      out('  password     Passwort ändern');
      out('  totp         Authenticator neu einrichten');
      out('  recovery     neue Notfallcodes erzeugen');
      out('  new-url      neue geheime Adresse');
      out('  logout-all   alle Sitzungen beenden');
      out('  unlock       Sperre nach Fehlversuchen aufheben');
      out('  remove       Admin-Bereich entfernen');
      out();
      out('Im Docker-Container:  sudo docker exec -it zerowichtel zw admin <befehl>');
  }
}
