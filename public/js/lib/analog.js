// ZeroWichtel – analoge Mitwichtelnde (ohne Smartphone) mit digitaler Helfer:in.
//
// Die analoge Person ist für Server und Ziehung eine normale Teilnehmer:in; ihr Link liegt bei der Helfer:in.
// Gespeichert wird nur in den Organisator-Daten (K_admin):
//   analog: [{ pid, helper: <pid> | null, helperName?: string }]   helper = null → Helfer:in wichtelt nicht mit
// Jedes Paar mit mitwichtelnder Helfer:in steht zusätzlich in der Ausschlussliste. So beachten auch ältere
// App-Versionen, die „analog“ nicht kennen, dass sich die beiden nicht gegenseitig ziehen.
//
// Grenze (docs/KONZEPT-ANALOG.md, Abschnitt 3): höchstens ⌊(n − 2) / 3⌋ Paare mit mitwichtelnder Helfer:in.
// Externe Helfer:innen zählen nicht mit – sie erzeugen keinen Ausschluss und wissen nur eine Zuordnung.

import { t } from './i18n.js';

export const ANALOG_HELPER_NAME_MAX = 40;

/** Höchstzahl analoger Mitwichtelnder mit mitwichtelnder Helfer:in bei n Ausgelosten. */
export function analogLimit(n) {
  return Math.max(0, Math.floor((n - 2) / 3));
}

/** Bereinigt die Liste aus den Organisator-Daten (unbekannte Personen, doppelte Einträge, ungültige Felder). */
export function normalizeAnalog(list, knownIds) {
  const known = new Set(knownIds);
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e.pid !== 'string' || !known.has(e.pid) || seen.has(e.pid)) continue;
    seen.add(e.pid);
    const helper = typeof e.helper === 'string' ? e.helper : null;
    const entry = { pid: e.pid, helper };
    if (helper === null) entry.helperName = String(e.helperName ?? '').trim().slice(0, ANALOG_HELPER_NAME_MAX);
    out.push(entry);
  }
  return out;
}

/** Ausschlusspaare für Paare mit mitwichtelnder Helfer:in. */
export function analogPairs(analog) {
  return (analog || []).filter((e) => e.helper).map((e) => [e.pid, e.helper]);
}

const samePair = ([a, b], [x, y]) => (a === x && b === y) || (a === y && b === x);

/** Ausschlüsse ohne die automatisch ergänzten Paare (für die Anzeige „Ausschlüsse“). */
export function manualExclusions(exclusions, analog) {
  const pairs = analogPairs(analog);
  return (exclusions || []).filter((ex) => !pairs.some((p) => samePair(p, ex)));
}

/** Gespeicherte Ausschlussliste: eigene Ausschlüsse plus Paare analog ↔ Helfer:in. */
export function mergeExclusions(manual, analog) {
  const out = [...(manual || [])];
  for (const p of analogPairs(analog)) if (!out.some((ex) => samePair(p, ex))) out.push(p);
  return out;
}

/**
 * Wer darf noch als analoge Person bzw. als Helfer:in gewählt werden?
 * @returns {{analogOk:(pid)=>boolean, helperOk:(pid, forPid)=>boolean}}
 */
export function analogChoices(analog) {
  const analogIds = new Set((analog || []).map((e) => e.pid));
  const helperIds = new Set((analog || []).map((e) => e.helper).filter(Boolean));
  return {
    analogOk: (pid) => !analogIds.has(pid) && !helperIds.has(pid),
    helperOk: (pid, forPid) => pid !== forPid && !analogIds.has(pid) && !helperIds.has(pid),
  };
}

/**
 * Vorprüfung vor der Ziehung (zusätzlich zu precheck aus draw.js).
 * @param {{pid,helper}[]} analog
 * @param {string[]} ids          wer ausgelost wird (zugesagt und angenommen)
 * @param {Record<string,string>} names
 * @param {{teams?:boolean}} opts
 */
export function analogPrecheck(analog, ids, names = {}, { teams = false } = {}) {
  const list = analog || [];
  if (!list.length) return { ok: true, reason: null, used: 0, limit: analogLimit(ids.length) };
  const name = (pid) => names[pid] ?? t('Eine Person');
  if (teams) return { ok: false, reason: t('Analoge Mitwichtelnde gibt es nur beim Wichteln Person für Person, nicht beim Team-Wichteln.') };
  const inDraw = new Set(ids);
  const helpers = new Map();
  for (const e of list) {
    if (!e.helper) continue;
    if (e.helper === e.pid || list.some((x) => x.pid === e.helper)) {
      return { ok: false, reason: t('{name} kann nicht Helfer:in sein, weil {name} selbst ohne Smartphone mitwichtelt.', { name: name(e.helper) }) };
    }
    if (helpers.has(e.helper)) {
      return { ok: false, reason: t('{name} ist schon Helfer:in für {other}. Jede Person kann nur für eine Person helfen.', { name: name(e.helper), other: name(helpers.get(e.helper)) }) };
    }
    helpers.set(e.helper, e.pid);
  }
  const active = list.filter((e) => inDraw.has(e.pid));
  for (const e of active) {
    if (e.helper && !inDraw.has(e.helper)) {
      return { ok: false, reason: t('{helper} hilft {name}, ist aber nicht dabei. Bitte eine neue Helfer:in eintragen oder {name} aus der Liste „Ohne Smartphone“ nehmen.', { helper: name(e.helper), name: name(e.pid) }) };
    }
  }
  const used = active.filter((e) => e.helper).length;
  const limit = analogLimit(ids.length);
  if (used > limit) {
    return {
      ok: false, used, limit,
      reason: limit === 0
        ? t('Bei {n} Personen geht ohne Smartphone nur mit einer Helfer:in, die selbst nicht mitwichtelt – sonst wäre die Auslosung zu leicht zu erraten.', { n: ids.length })
        : t('Bei {n} Personen dürfen höchstens {limit} ohne Smartphone mitwichteln, deren Helfer:in selbst mitwichtelt (eingetragen: {used}). Sonst wäre die Auslosung zu leicht zu erraten. Helfer:innen, die nicht mitwichteln, zählen nicht mit.', { n: ids.length, limit, used }),
    };
  }
  return { ok: true, reason: null, used, limit };
}
