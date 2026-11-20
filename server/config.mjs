// Konfiguration: config.json (JSON; ganze Zeilen, die mit // beginnen, gelten als Kommentar).
// Die Schlüssel entsprechen der früheren config.php, die Umstellung ist daher eine reine Formatfrage.
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = {
  db_path: null,
  base_url: '',
  // Link „Quellcode“ in Fußzeile, Impressum und Lizenzen. Wer ZeroWichtel verändert betreibt, trägt hier den eigenen
  // Quellcode ein (EUPL-1.2). Nur https; ungültig → Standard.
  source_url: 'https://github.com/peterrtz/zerowichtel',
  server_key: '',
  require_organizer_code: true,
  max_participants: 50,
  lazy_cleanup: true,
  // [Anfragen, Zeitfenster in Sekunden] je Aktion und Client
  rate_limits: {
    create_round: [10, 3600],
    create_open: [2, 86400], // Runden ohne Organisator-Code je Anschluss und Tag (IPv6: je /64)
    claim: [30, 3600],
    recover: [10, 3600],
    write: [300, 3600],
    read: [1200, 3600],
    mail: [30, 3600],
    // je Runde statt je Client (SEC-002): Mails einer Runde insgesamt, Admin-Link-Mails an frei gewählte Adressen
    mail_round: [120, 86400],
    mail_admin: [5, 86400],
    admin: [30, 3600],
    analog: [5, 86400], // Zähler „analoge Wichtelrunde vorbereitet“ je Anschluss und Tag
    question_anon: [3, 86400], // anonyme Rückfragen je Anschluss und Tag (2.9)
    photo: [60, 86400], // Foto-Uploads je Anschluss und Tag (2.13)
    photo_read: [600, 3600], // Abrufe von Fotos und Fotolisten je Anschluss und Stunde (2.13)
  },
  client_ip_header: null, // z. B. 'X-Forwarded-For' hinter einem Reverse Proxy
  operator: { name: '', street: '', city: '', email: '', phone: '' },
  hoster: '',
  // nur für die Datenschutzerklärung
  privacy: { mail_provider: '', no_access_logs: false, backup_days: 0 },
  admin: { enabled: false, session_minutes: 30 },
  // Adventsalbum (2.13): enabled = false schaltet es serverweit ab (bestehende Fotos bleiben bis zur Löschung der Runde);
  // round_mb = Speicher je Runde, person_photos = Fotos je Person – Ausgangswerte; im Admin-Bereich änderbar (2.13.1)
  album: { enabled: true, round_mb: 60, person_photos: 20 },
  mail: { transport: null, from_email: '', from_name: 'ZeroWichtel' },
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v) => Math.trunc(Number(v)) || 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, int(v)));

function safeSourceUrl(v) {
  try {
    const u = new URL(String(v));
    if (u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 300) return u.href;
  } catch { /* Standard */ }
  return DEFAULTS.source_url;
}

/** Ergänzt Standardwerte und prüft Pflichtangaben. Wirft bei unbrauchbarer Konfiguration. */
export function normalizeConfig(input, baseDir = process.cwd()) {
  const cfg = { ...DEFAULTS, ...input };
  for (const k of ['rate_limits', 'operator', 'privacy', 'admin', 'mail', 'album']) {
    cfg[k] = { ...DEFAULTS[k], ...(isObj(input[k]) ? input[k] : {}) };
  }
  // Im Container gibt die Umgebung den Datenbankpfad fest vor.
  if (process.env.ZW_DB_PATH) cfg.db_path = process.env.ZW_DB_PATH;
  if (typeof cfg.db_path !== 'string' || cfg.db_path === '') throw new Error('Konfiguration: db_path fehlt.');
  if (!isAbsolute(cfg.db_path)) cfg.db_path = join(baseDir, cfg.db_path);
  if (typeof cfg.mail.log_path === 'string' && !isAbsolute(cfg.mail.log_path)) cfg.mail.log_path = join(baseDir, cfg.mail.log_path);

  const key = typeof cfg.server_key === 'string' && /^[A-Za-z0-9+/]{43}=?$/.test(cfg.server_key) ? Buffer.from(cfg.server_key, 'base64') : null;
  if (!key || key.length !== 32) throw new Error('Konfiguration: server_key muss 32 Byte als Base64 sein.');
  // Schwache oder bekannte Schlüssel (z. B. der Platzhalter aus dev/config.dev.json) nur im Entwicklungsmodus (SEC-004).
  // Ein Zufallsschlüssel hat praktisch immer über 20 verschiedene Bytes; unter 16 ist er nicht zufällig erzeugt.
  if (new Set(key).size < 16 && process.env.ZW_DEV !== '1') {
    throw new Error('Konfiguration: server_key ist zu schwach (kein Zufallswert). Neu erzeugen: head -c 32 /dev/urandom | base64');
  }
  cfg.server_key_raw = key;

  cfg.source_url = safeSourceUrl(cfg.source_url);
  cfg.album = {
    enabled: cfg.album.enabled !== false,
    round_mb: clamp(cfg.album.round_mb, 1, 500),
    person_photos: clamp(cfg.album.person_photos, 1, 50),
  };
  cfg.max_participants = clamp(cfg.max_participants, 3, 50);
  cfg.admin.session_minutes = clamp(cfg.admin.session_minutes, 5, 120);
  return cfg;
}

/** Liest config.json (Pfad aus ZW_CONFIG, sonst config.json im Projektordner). */
export function loadConfig(path = process.env.ZW_CONFIG || join(ROOT, 'config.json')) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Konfiguration nicht gefunden: ${path} (Vorlage: config.example.json)`);
  }
  const json = text.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
  let data;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`Konfiguration ${path} ist kein gültiges JSON: ${e.message}`);
  }
  if (!isObj(data)) throw new Error(`Konfiguration ${path}: JSON-Objekt erwartet.`);
  return normalizeConfig(data, dirname(resolve(path)));
}
