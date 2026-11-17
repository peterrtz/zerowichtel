// Zähler ohne Inhalte, die nicht an einer Runde hängen.
//
// Analoge Wichtelrunden (2.7): Die Vorbereitung läuft komplett im Browser; der Server erfährt davon nur,
// DASS eine Runde vorbereitet wurde – ohne Namen, Titel, Datum oder sonst etwas. Gespeichert in der Tabelle meta:
//   stat_analog = {"total": n, "years": {"2026": n}}
import { getMeta, setMeta } from './cleanup.mjs';

const KEY = 'stat_analog';

export function analogStats(db) {
  try {
    const s = JSON.parse(getMeta(db, KEY) ?? 'null');
    const total = Number.isInteger(s?.total) && s.total >= 0 ? s.total : 0;
    const years = {};
    for (const [y, n] of Object.entries(s?.years ?? {})) if (/^\d{4}$/.test(y) && Number.isInteger(n) && n >= 0) years[y] = n;
    return { total, years };
  } catch {
    return { total: 0, years: {} };
  }
}

export function countAnalog(db, now) {
  const s = analogStats(db);
  const y = String(new Date(now * 1000).getUTCFullYear());
  s.total += 1;
  s.years[y] = (s.years[y] ?? 0) + 1;
  setMeta(db, KEY, JSON.stringify(s));
  return s;
}
