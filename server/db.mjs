// SQLite über das eingebaute node:sqlite. Schema identisch mit der PHP-Version (user_version 4),
// bestehende Datenbanken werden unverändert weiterverwendet.
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_VERSION = 7;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 }); // = busy_timeout 5000
  if (path !== ':memory:') {
    try { chmodSync(path, 0o600); } catch { /* z. B. fremder Eigentümer – nicht kritisch */ }
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA secure_delete = ON'); // freigegebene Seiten werden überschrieben
  migrate(db);
  return db;
}

/**
 * Schreibtransaktion mit BEGIN IMMEDIATE: wartet gleich zu Beginn auf die Schreibsperre.
 * Wichtig, sobald ein zweiter Prozess (Kommandozeile) dieselbe Datei beschreibt.
 */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* bereits beendet */ }
    throw e;
  }
}

/** Kurzformen: erste Zeile, alle Zeilen, erste Spalte der ersten Zeile, Änderung ausführen. */
export const one = (db, sql, ...args) => db.prepare(sql).get(...args);
export const all = (db, sql, ...args) => db.prepare(sql).all(...args);
export const value = (db, sql, ...args) => {
  const row = db.prepare(sql).get(...args);
  return row ? Object.values(row)[0] : undefined;
};
export const run = (db, sql, ...args) => db.prepare(sql).run(...args);
export const isUnique = (e) => /UNIQUE/.test(String(e?.message));

export function migrate(db) {
  const version = value(db, 'PRAGMA user_version');
  const pending = STEPS.slice(version);
  if (!pending.length) return;
  tx(db, () => {
    for (const step of pending) for (const sql of step) db.exec(sql);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

const STEPS = [
  // v1: Grundschema
  [
    `CREATE TABLE organizer_codes (
        code_hash    TEXT PRIMARY KEY,
        label        TEXT,
        max_rounds   INTEGER NOT NULL DEFAULT 3,
        used_rounds  INTEGER NOT NULL DEFAULT 0,
        expires_at   INTEGER NOT NULL,
        created_at   INTEGER NOT NULL
    )`,
    `CREATE TABLE rounds (
        id              TEXT PRIMARY KEY,
        mode            TEXT NOT NULL CHECK (mode IN ('wichteln','schrott')),
        status          TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','gezogen','beendet')),
        admin_hash      TEXT NOT NULL,
        email_enabled   INTEGER NOT NULL DEFAULT 0,
        rsvp_deadline   INTEGER NOT NULL,
        wish_deadline   INTEGER,
        event_date      INTEGER NOT NULL,
        delete_after    INTEGER NOT NULL,
        meta_ct         TEXT NOT NULL,
        admin_ct        TEXT,
        drawn_at        INTEGER,
        created_at      INTEGER NOT NULL
    )`,
    'CREATE INDEX rounds_delete_after ON rounds(delete_after)',
    `CREATE TABLE participants (
        id              TEXT PRIMARY KEY,
        round_id        TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        invite_hash     TEXT NOT NULL,
        invite_ct       TEXT,
        claimed_at      INTEGER,
        access_hash     TEXT,
        pubkey          TEXT,
        name_ct         TEXT NOT NULL,
        rsvp            TEXT NOT NULL DEFAULT 'offen' CHECK (rsvp IN ('offen','dabei','raus')),
        email_ct        TEXT,
        notify          INTEGER NOT NULL DEFAULT 1,
        wish_ct         TEXT,
        assignment_ct   TEXT,
        mailboxkey_ct   TEXT,
        recovery_hash   TEXT UNIQUE,
        recovery_ct     TEXT,
        last_seen_day   INTEGER,
        created_at      INTEGER NOT NULL
    )`,
    'CREATE INDEX participants_round ON participants(round_id)',
    `CREATE TABLE mailboxes (
        id              TEXT PRIMARY KEY,
        round_id        TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        giver_hash      TEXT NOT NULL,
        receiver_hash   TEXT NOT NULL,
        wish_ct         TEXT,
        wish_day        INTEGER
    )`,
    'CREATE INDEX mailboxes_round ON mailboxes(round_id)',
    `CREATE TABLE messages (
        id              INTEGER PRIMARY KEY,
        mailbox_id      TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
        direction       TEXT NOT NULL CHECK (direction IN ('frage','antwort')),
        body_ct         TEXT NOT NULL,
        created_day     INTEGER NOT NULL
    )`,
    'CREATE INDEX messages_mailbox ON messages(mailbox_id)',
    `CREATE TABLE rate_limits (
        bucket          TEXT PRIMARY KEY,
        window_start    INTEGER NOT NULL,
        hits            INTEGER NOT NULL
    )`,
    `CREATE TABLE meta (
        key             TEXT PRIMARY KEY,
        value           TEXT NOT NULL
    )`,
  ],
  // v2: E-Mail-Modus. email_ct/mail_title_ct mit dem Serverschlüssel, email_view_ct mit K_admin (nur Anzeige).
  [
    'ALTER TABLE participants ADD COLUMN email_view_ct TEXT',
    'ALTER TABLE rounds ADD COLUMN mail_title_ct TEXT',
    'ALTER TABLE rounds ADD COLUMN reminded_rsvp INTEGER',
    'ALTER TABLE rounds ADD COLUMN reminded_wish INTEGER',
    'ALTER TABLE rounds ADD COLUMN notified_draw INTEGER',
    'ALTER TABLE rounds ADD COLUMN digest_msg_id INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE rounds ADD COLUMN digest_day INTEGER NOT NULL DEFAULT 0',
  ],
  // v3: Admin-Bereich (eine Zeile admin; Protokoll ohne IP-Adressen)
  [
    `CREATE TABLE admin (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        slug            TEXT NOT NULL,
        pw_hash         TEXT NOT NULL,
        totp_ct         TEXT NOT NULL,
        totp_last_step  INTEGER NOT NULL DEFAULT 0,
        failures        INTEGER NOT NULL DEFAULT 0,
        locked_until    INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL
    )`,
    `CREATE TABLE admin_recovery (
        hash            TEXT PRIMARY KEY,
        used_at         INTEGER
    )`,
    `CREATE TABLE admin_sessions (
        id              TEXT PRIMARY KEY,
        token_hash      TEXT NOT NULL,
        expires_at      INTEGER NOT NULL,
        created_at      INTEGER NOT NULL
    )`,
    `CREATE TABLE admin_log (
        id              INTEGER PRIMARY KEY,
        ts              INTEGER NOT NULL,
        event           TEXT NOT NULL,
        detail          TEXT
    )`,
  ],
  // v4: Nach der Ziehung „schon nachgesehen?“ (ja/nein) und Zeitpunkt der letzten Erinnerung
  [
    'ALTER TABLE participants ADD COLUMN draw_seen INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE participants ADD COLUMN draw_reminded INTEGER',
  ],
  // v5 (2.3): Gruppenlink (join_*, Token nur als Hash, join_ct = Token mit K_admin für die Anzeige),
  // Sprache der Runde für Mails, zeitgesteuerte Rätselhinweise des Wichtels (Inhalt verschlüsselt).
  [
    'ALTER TABLE rounds ADD COLUMN lang TEXT NOT NULL DEFAULT \'de\'',
    'ALTER TABLE rounds ADD COLUMN join_hash TEXT',
    'ALTER TABLE rounds ADD COLUMN join_ct TEXT',
    'ALTER TABLE rounds ADD COLUMN join_until INTEGER',
    'ALTER TABLE rounds ADD COLUMN join_max INTEGER',
    'ALTER TABLE rounds ADD COLUMN join_used INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE participants ADD COLUMN via_group INTEGER NOT NULL DEFAULT 0',
    `CREATE TABLE hints (
        id              TEXT PRIMARY KEY,
        mailbox_id      TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
        body_ct         TEXT NOT NULL,
        release_at      INTEGER NOT NULL
    )`,
    'CREATE INDEX hints_mailbox ON hints(mailbox_id)',
  ],
  // v6 (2.4): Runde ohne Organisator-Code angelegt (für die Obergrenze gleichzeitiger Runden ohne Code)
  [
    'ALTER TABLE rounds ADD COLUMN without_code INTEGER NOT NULL DEFAULT 0',
  ],
  // v7 (2.5): Team-Wichteln. teams_ct = Teamliste (K_round), team_ct = gewähltes Team je Person (K_round),
  // wish_rev = Stand des gemeinsamen Team-Wunschzettels (gegen gegenseitiges Überschreiben). Nur hinzufügen.
  [
    'ALTER TABLE rounds ADD COLUMN teams_ct TEXT',
    'ALTER TABLE participants ADD COLUMN team_ct TEXT',
    'ALTER TABLE mailboxes ADD COLUMN wish_rev INTEGER NOT NULL DEFAULT 0',
  ],
];
