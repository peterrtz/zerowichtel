// Geschenkvorschläge für den Ideen-Würfel (2.12), im Admin-Bereich oder per „zw ideas“ pflegbar.
//
// Ohne Einstellung gilt die Standardliste aus public/js/lib/ideas.js. Der Betreiber kann sie um eigene Vorschläge
// ergänzen („extend“) oder ganz ersetzen („replace“). Jeder Vorschlag hat eine Preisklasse (Obergrenze in Euro,
// null = darüber), einen deutschen und optional einen englischen Text sowie ein Mindestalter (0 = jedes) und ein
// optionales Höchstalter (2.13). Gespeichert in der Tabelle meta.
import { getMeta, setMeta } from './cleanup.mjs';

export const IDEA_CLASSES = [5, 10, 20, 30, 50, null];
// 200 × (120 + 120 Zeichen) passen in die 64-KB-Grenze für Anfragen (server/http.mjs), solange nicht fast alles Emoji ist
export const IDEA_LIMITS = { items: 200, text: 120 };
export const IDEA_MODES = ['builtin', 'extend', 'replace'];

const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const chars = (s) => [...s].length;

export class IdeasError extends Error {}

function text(v, what, i, required) {
  if (v !== undefined && v !== null && typeof v !== 'string') throw new IdeasError(`Vorschlag ${i + 1}: ${what} muss Text sein.`);
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (required && !s) throw new IdeasError(`Vorschlag ${i + 1}: Der deutsche Text fehlt.`);
  if (CTRL.test(s)) throw new IdeasError(`Vorschlag ${i + 1}: ${what} enthält Steuerzeichen.`);
  if (chars(s) > IDEA_LIMITS.text) throw new IdeasError(`Vorschlag ${i + 1}: ${what} hat mehr als ${IDEA_LIMITS.text} Zeichen.`);
  return s;
}

/** Prüft und normalisiert { mode, items: [{ max, de, en }] }. */
export function normalizeIdeas(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new IdeasError('Erwartet ein Objekt { mode, items }.');
  const mode = input.mode ?? 'builtin';
  if (!IDEA_MODES.includes(mode)) throw new IdeasError(`mode muss ${IDEA_MODES.join(', ')} sein.`);
  const raw = input.items ?? [];
  if (!Array.isArray(raw)) throw new IdeasError('items muss eine Liste sein.');
  if (raw.length > IDEA_LIMITS.items) throw new IdeasError(`Höchstens ${IDEA_LIMITS.items} Vorschläge.`);
  const items = raw.map((it, i) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) throw new IdeasError(`Vorschlag ${i + 1}: ungültiger Eintrag.`);
    const max = it.max === undefined ? null : it.max;
    if (!IDEA_CLASSES.includes(max)) throw new IdeasError(`Vorschlag ${i + 1}: Preisklasse muss ${IDEA_CLASSES.map((c) => c ?? 'null').join(', ')} sein.`);
    const minAge = it.minAge === undefined || it.minAge === null ? 0 : it.minAge;
    const maxAge = it.maxAge === undefined ? null : it.maxAge;
    if (!Number.isInteger(minAge) || minAge < 0 || minAge > 99) throw new IdeasError(`Vorschlag ${i + 1}: Mindestalter muss eine ganze Zahl von 0 bis 99 sein.`);
    if (maxAge !== null && (!Number.isInteger(maxAge) || maxAge < minAge || maxAge > 99)) throw new IdeasError(`Vorschlag ${i + 1}: Höchstalter muss leer sein oder zwischen Mindestalter und 99 liegen.`);
    return { max, de: text(it.de, 'Der deutsche Text', i, true), en: text(it.en, 'Der englische Text', i, false), minAge, maxAge };
  });
  if (mode === 'replace' && !items.length) throw new IdeasError('Eine eigene Liste ohne Vorschläge geht nicht – dann lieber die Standardliste verwenden.');
  return { mode, items };
}

export function ideasSettings(db) {
  const raw = getMeta(db, 'ideas');
  if (!raw) return { mode: 'builtin', items: [] };
  try {
    return normalizeIdeas(JSON.parse(raw));
  } catch {
    return { mode: 'builtin', items: [] };
  }
}

export function saveIdeas(db, input) {
  const s = normalizeIdeas(input);
  setMeta(db, 'ideas', JSON.stringify(s));
  return s;
}

/** Was die App bekommt: bei der Standardliste nur der Modus (die App hat die Liste selbst). */
export function publicIdeas(db) {
  const s = ideasSettings(db);
  return s.mode === 'builtin' ? { mode: 'builtin', items: [] } : s;
}

export function describeIdeas(s) {
  if (s.mode === 'builtin') return `Standardliste${s.items.length ? ` (${s.items.length} eigene gespeichert, nicht aktiv)` : ''}`;
  return `${s.mode === 'extend' ? 'Standardliste plus' : 'nur'} ${s.items.length} eigene Vorschläge`;
}
