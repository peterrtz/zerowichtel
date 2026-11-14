// Endgültige Löschung (ersetzt den früheren Cronjob; läuft im Server selbst).
//  - Runden ab delete_after (Wichteldatum + 14 Tage)
//  - Runden, in denen 30 Tage nach Anlage niemand eine Einladung eingelöst hat
//  - Rate-Limit-Buckets älter als 24 Stunden
//  - Organisator-Codes 90 Tage nach Ablauf, abgelaufene Admin-Sitzungen, Admin-Protokoll nach 90 Tagen
// secure_delete überschreibt freigegebene Seiten; Checkpoint und VACUUM entfernen Reste aus WAL und Datei.
import { pruneAdmin } from './admin.mjs';
import { run, value } from './db.mjs';

export const STALE_UNCLAIMED = 30 * 86400;
export const LAZY_INTERVAL = 600;
export const CODES_KEEP = 90 * 86400;

export function cleanup(db, now, forceVacuum = false) {
  const deleted = run(db, `DELETE FROM rounds
      WHERE delete_after <= ?
         OR (created_at <= ? AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.round_id = rounds.id AND p.claimed_at IS NOT NULL))`,
  now, now - STALE_UNCLAIMED).changes;

  run(db, 'DELETE FROM rate_limits WHERE window_start < ?', now - 86400);
  run(db, 'DELETE FROM organizer_codes WHERE expires_at < ?', now - CODES_KEEP);
  pruneAdmin(db, now);
  setMeta(db, 'last_cleanup', String(now));

  let vacuum = false;
  if (forceVacuum || deleted > 0 || now - Number(getMeta(db, 'last_vacuum') ?? 0) >= 86400) {
    shred(db);
    setMeta(db, 'last_vacuum', String(now));
    vacuum = true;
  }
  return { rounds: deleted, vacuum };
}

/** Höchstens alle 10 Minuten aufräumen. Gibt true zurück, wenn aufgeräumt wurde. */
export function maybeCleanup(db, now) {
  if (now - Number(getMeta(db, 'last_cleanup') ?? 0) < LAZY_INTERVAL) return false;
  cleanup(db, now);
  return true;
}

/** Entfernt gelöschte Daten auch aus WAL und freien Seiten. */
export function shred(db) {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}

export const getMeta = (db, key) => value(db, 'SELECT value FROM meta WHERE key = ?', key) ?? null;
export const setMeta = (db, key, v) => run(db, 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, v);
