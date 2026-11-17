// ZeroWichtel – analoge Wichtelrunde zum Ausdrucken (2.7).
//
// Alles läuft in diesem Browser. Gespeichert wird nur im lokalen Speicher dieses Browsers (localStorage),
// bis die Person „Alles löschen“ wählt. Der Server sieht weder Namen noch Termine noch Lose; er zählt nur,
// DASS eine Runde vorbereitet wurde (POST /api/stats/analog, einmal je Vorbereitung).

import { draw, precheck, verify } from './draw.js';
import { t } from './i18n.js';

export const ANALOG_ROUND_KEY = 'zw.analogRound.v1';
export const ANALOG_ROUND_LIMITS = { title: 80, place: 80, note: 300, name: 40, people: 50, budgetMax: 1000 };
export const SLIP_MODES = ['verdeckt', 'hut'];
export const CARD_DESIGNS = ['tanne', 'sterne', 'schleife'];
export const CARD_KINDS = ['einladung', 'erinnerung'];

const newId = () => Math.random().toString(36).slice(2, 10);
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\s+/g, ' ');

export function emptyAnalogRound() {
  return { v: 1, title: '', date: '', place: '', budget: null, note: '', people: [], exclusions: [], mode: 'verdeckt', design: 'tanne', cardKind: 'einladung', pairs: null, drawnAt: null, counted: false };
}

/** Prüft und bereinigt einen gespeicherten oder eingegebenen Stand. Unbekanntes wird verworfen. */
export function normalizeAnalogRound(raw) {
  const s = emptyAnalogRound();
  if (!raw || typeof raw !== 'object') return s;
  s.title = oneLine(raw.title, ANALOG_ROUND_LIMITS.title);
  s.date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date ?? '')) ? raw.date : '';
  s.place = oneLine(raw.place, ANALOG_ROUND_LIMITS.place);
  const b = Number(raw.budget);
  s.budget = raw.budget === null || raw.budget === '' || raw.budget === undefined || !Number.isFinite(b) ? null : Math.max(0, Math.min(ANALOG_ROUND_LIMITS.budgetMax, Math.round(b)));
  s.note = clean(raw.note, ANALOG_ROUND_LIMITS.note);
  const seen = new Set();
  for (const p of Array.isArray(raw.people) ? raw.people : []) {
    const name = oneLine(p?.name, ANALOG_ROUND_LIMITS.name);
    const id = typeof p?.id === 'string' && /^[a-z0-9]{1,12}$/.test(p.id) ? p.id : newId();
    if (!name || seen.has(id) || s.people.length >= ANALOG_ROUND_LIMITS.people) continue;
    seen.add(id);
    s.people.push({ id, name });
  }
  const ids = new Set(s.people.map((p) => p.id));
  for (const ex of Array.isArray(raw.exclusions) ? raw.exclusions : []) {
    if (!Array.isArray(ex) || ex.length !== 2) continue;
    const [a, b2] = ex;
    if (a === b2 || !ids.has(a) || !ids.has(b2)) continue;
    if (s.exclusions.some(([x, y]) => (x === a && y === b2) || (x === b2 && y === a))) continue;
    s.exclusions.push([a, b2]);
  }
  if (SLIP_MODES.includes(raw.mode)) s.mode = raw.mode;
  if (CARD_DESIGNS.includes(raw.design)) s.design = raw.design;
  if (CARD_KINDS.includes(raw.cardKind)) s.cardKind = raw.cardKind;
  // Lose nur übernehmen, wenn sie zu den aktuellen Personen und Ausschlüssen passen
  if (Array.isArray(raw.pairs) && raw.pairs.every((x) => Array.isArray(x) && x.length === 2)
      && verify(s.people.map((p) => p.id), raw.pairs, [], s.exclusions)) {
    s.pairs = raw.pairs.map(([g, r]) => [g, r]);
    s.drawnAt = Number.isInteger(raw.drawnAt) ? raw.drawnAt : null;
  }
  s.counted = raw.counted === true;
  return s;
}

export function loadAnalogRound(storage = globalThis.localStorage) {
  try {
    return normalizeAnalogRound(JSON.parse(storage.getItem(ANALOG_ROUND_KEY) || 'null'));
  } catch {
    return emptyAnalogRound();
  }
}

/** Speichert lokal. Gibt false zurück, wenn der Browser nichts speichert (z. B. privater Modus). */
export function saveAnalogRound(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(ANALOG_ROUND_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearAnalogRound(storage = globalThis.localStorage) {
  try {
    storage.removeItem(ANALOG_ROUND_KEY);
  } catch { /* nichts gespeichert */ }
}

/** Person hinzufügen; Fehlermeldung als Text oder null. Ändert die Personen → bisherige Lose verfallen. */
export function addPerson(state, name) {
  const n = oneLine(name, ANALOG_ROUND_LIMITS.name);
  if (!n) return t('Bitte einen Namen eingeben.');
  if (state.people.length >= ANALOG_ROUND_LIMITS.people) return t('Höchstens {n} Personen.', { n: ANALOG_ROUND_LIMITS.people });
  if (state.people.some((p) => p.name.toLocaleLowerCase() === n.toLocaleLowerCase())) return t('{name} steht schon auf der Liste. Bei gleichen Namen bitte unterscheiden, z. B. „Anna K.“', { name: n });
  state.people.push({ id: newId(), name: n });
  state.pairs = null;
  return null;
}

export function removePerson(state, id) {
  state.people = state.people.filter((p) => p.id !== id);
  state.exclusions = state.exclusions.filter(([a, b]) => a !== id && b !== id);
  state.pairs = null;
}

/** Vorprüfung für verdeckte Lose (gleiche Regeln wie bei der Online-Ziehung). */
export function analogRoundPrecheck(state) {
  const names = Object.fromEntries(state.people.map((p) => [p.id, p.name]));
  return precheck(state.people.map((p) => p.id), [], state.exclusions, names);
}

/** Lost aus (ein Kreis, wenn möglich). Das Ergebnis bleibt nur im lokalen Speicher. */
export function drawAnalogRound(state, opts = {}) {
  const ids = state.people.map((p) => p.id);
  const names = Object.fromEntries(state.people.map((p) => [p.id, p.name]));
  const r = draw(ids, [], state.exclusions, { names, ...opts });
  state.pairs = r.pairs;
  state.drawnAt = Math.floor(Date.now() / 1000);
  return r.form;
}

/** Daten für die verdeckten Lose: je Person „für X“ → „du beschenkst Y“, in der Reihenfolge der Namensliste. */
export function hiddenSlips(state) {
  if (!state.pairs) return [];
  const name = Object.fromEntries(state.people.map((p) => [p.id, p.name]));
  // Reihenfolge wie die Namensliste (zum Wiederfinden beim Verteilen), nicht wie der Kreis
  const order = state.people.map((p) => p.id);
  const to = Object.fromEntries(state.pairs);
  return order.map((g) => ({ giver: name[g], receiver: name[to[g]] }));
}
