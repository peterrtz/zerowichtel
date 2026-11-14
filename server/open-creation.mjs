// Anlegen ohne Organisator-Code (optional, im Admin-Bereich oder per „zw open“ einstellbar).
//
// Mit Code geht es immer (bis zum Kontingent des Codes). Ohne Code nur, wenn das Anlegen ohne Code eingeschaltet
// ist UND weniger als maxRounds Runden ohne Code gleichzeitig bestehen. Eine Runde zählt, bis sie gelöscht ist
// (sofort durch die Organisator:in oder spätestens 14 Tage nach dem Wichteldatum). Optional ist der E-Mail-Versand
// für Runden ohne Code gesperrt (Missbrauchsschutz: wer keinen Code hat, verschickt keine Mails über den Server).
// Gespeichert in der Tabelle meta; ohne Eintrag gilt: aus.
import { value } from './db.mjs';
import { getMeta, setMeta } from './cleanup.mjs';

export const OPEN_MAX = 500;
export const OPEN_DEFAULT = { enabled: false, maxRounds: 10, email: false };

export function openSettings(db) {
  const raw = getMeta(db, 'open_creation');
  if (!raw) return { ...OPEN_DEFAULT };
  try {
    const s = JSON.parse(raw);
    return {
      enabled: s.enabled === true,
      maxRounds: Number.isInteger(s.maxRounds) && s.maxRounds >= 1 && s.maxRounds <= OPEN_MAX ? s.maxRounds : OPEN_DEFAULT.maxRounds,
      email: s.email === true,
    };
  } catch {
    return { ...OPEN_DEFAULT };
  }
}

export function saveOpenSettings(db, { enabled, maxRounds, email }) {
  setMeta(db, 'open_creation', JSON.stringify({ enabled: !!enabled, maxRounds, email: !!email }));
}

/** Zahl der bestehenden Runden, die ohne Code angelegt wurden. */
export const openUsage = (db) => value(db, 'SELECT COUNT(*) FROM rounds WHERE without_code = 1') ?? 0;

export function openStatus(db) {
  const s = openSettings(db);
  const used = openUsage(db);
  return { ...s, used, free: s.enabled ? Math.max(0, s.maxRounds - used) : 0 };
}

export function describeOpen(s) {
  return s.enabled ? `an (höchstens ${s.maxRounds} gleichzeitig, E-Mail ${s.email ? 'erlaubt' : 'aus'})` : 'aus';
}
