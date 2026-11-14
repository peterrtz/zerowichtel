// ZeroWichtel – Ziehungsalgorithmus. Läuft ausschließlich im Browser der Organisator:in.
//
// Ziel: ein einziger zufälliger Kreis, in dem niemand die eigene Untergruppe oder eine
// ausgeschlossene Person beschenkt. Gelingt das nicht, Rückfall auf eine freie Zuordnung
// (Permutation ohne Fixpunkte) mit denselben Regeln.

/** Unverzerrte Zufallszahl 0 … n-1 aus WebCrypto. */
import { t } from './i18n.js';

export function cryptoRandomInt(n) {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new Error('Ungültiger Bereich');
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

export function shuffle(arr, rnd = cryptoRandomInt) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {string[]} ids              Teilnehmende (Zusagen)
 * @param {{members:string[]}[]} groups  Untergruppen
 * @param {[string,string][]} exclusions Paare, gelten in beide Richtungen
 * @returns {(a:number,b:number)=>boolean} erlaubt(a beschenkt b) über Indizes in ids
 */
export function buildAllowed(ids, groups = [], exclusions = []) {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const group = new Array(ids.length).fill(-1);
  groups.forEach((g, gi) => {
    for (const m of g.members || []) if (idx.has(m)) group[idx.get(m)] = gi;
  });
  const n = ids.length;
  const ok = Array.from({ length: n }, () => new Array(n).fill(true));
  for (let i = 0; i < n; i++) {
    ok[i][i] = false;
    for (let j = 0; j < n; j++) {
      if (group[i] >= 0 && group[i] === group[j]) ok[i][j] = false;
    }
  }
  for (const [a, b] of exclusions) {
    if (idx.has(a) && idx.has(b)) {
      ok[idx.get(a)][idx.get(b)] = false;
      ok[idx.get(b)][idx.get(a)] = false;
    }
  }
  return { n, ok, group };
}

/** Schnelle Vorabprüfung mit verständlicher Begründung. */
export function precheck(ids, groups = [], exclusions = [], names = {}) {
  const n = ids.length;
  if (n < 3) return { ok: false, reason: t('Für eine Ziehung braucht es mindestens 3 Zusagen (derzeit {n}).', { n }) };
  const { ok } = buildAllowed(ids, groups, exclusions);
  for (let i = 0; i < n; i++) {
    if (!ok[i].some(Boolean)) {
      return { ok: false, reason: t('{name} darf niemanden beschenken – zu viele Ausschlüsse.', { name: names[ids[i]] ?? t('Eine Person') }) };
    }
  }
  const sizes = groups.map((g) => (g.members || []).filter((m) => ids.includes(m)).length);
  const maxSize = Math.max(0, ...sizes);
  if (maxSize > n / 2) {
    const g = groups[sizes.indexOf(maxSize)];
    return { ok: false, reason: t('Die Untergruppe „{name}“ umfasst {size} von {n} Zusagen. Eine Untergruppe darf höchstens die Hälfte umfassen.', { name: g.name || t('ohne Namen'), size: maxSize, n }) };
  }
  return { ok: true, reason: null };
}

function cycleValid(order, ok) {
  for (let i = 0; i < order.length; i++) {
    if (!ok[order[i]][order[(i + 1) % order.length]]) return false;
  }
  return true;
}

/** 1. Kreis per Zurückweisung: gleichverteilt über alle gültigen Kreise. */
export function cycleByRejection(ok, n, rnd, tries = 20000) {
  const base = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < tries; k++) {
    const order = shuffle(base, rnd);
    if (cycleValid(order, ok)) return order;
  }
  return null;
}

/** 2. Kreis per randomisierter Tiefensuche (Hamilton-Kreis) mit Schrittlimit. */
export function cycleBySearch(ok, n, rnd, maxSteps = 300000) {
  let steps = 0;
  const start = rnd(n);
  const path = [start];
  const used = new Array(n).fill(false);
  used[start] = true;
  const degree = (v) => {
    let c = 0;
    for (let w = 0; w < n; w++) if (!used[w] && ok[v][w]) c++;
    return c;
  };
  const dfs = () => {
    if (++steps > maxSteps) return false;
    const last = path[path.length - 1];
    if (path.length === n) return ok[last][start];
    // Kandidaten zufällig mischen, dann nach wenigsten Anschlussmöglichkeiten sortieren (Warnsdorff)
    const cand = shuffle([...Array(n).keys()].filter((w) => !used[w] && ok[last][w]), rnd)
      .map((w) => [w, degree(w)])
      .sort((a, b) => a[1] - b[1])
      .map(([w]) => w);
    for (const w of cand) {
      used[w] = true;
      path.push(w);
      if (dfs()) return true;
      path.pop();
      used[w] = false;
      if (steps > maxSteps) return false;
    }
    return false;
  };
  return dfs() ? path : null;
}

/** 3. Freie Zuordnung (Permutation ohne Fixpunkte, gegenseitige Paare möglich). */
export function derangement(ok, n, rnd, tries = 20000, maxSteps = 300000) {
  const base = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < tries; k++) {
    const p = shuffle(base, rnd);
    if (p.every((r, g) => ok[g][r])) return p;
  }
  // Suche: Schenkende mit den wenigsten Optionen zuerst
  const to = new Array(n).fill(-1);
  const taken = new Array(n).fill(false);
  const order = shuffle(base, rnd).sort((a, b) => ok[a].filter(Boolean).length - ok[b].filter(Boolean).length);
  let steps = 0;
  const rec = (k) => {
    if (++steps > maxSteps) return false;
    if (k === n) return true;
    const g = order[k];
    for (const r of shuffle(base.filter((r) => !taken[r] && ok[g][r]), rnd)) {
      taken[r] = true;
      to[g] = r;
      if (rec(k + 1)) return true;
      taken[r] = false;
      to[g] = -1;
    }
    return false;
  };
  return rec(0) ? to : null;
}

/**
 * Führt die Ziehung durch.
 * @returns {{pairs: [string,string][], form: 'kreis'|'frei'}}  pairs: [Schenkende:r, Beschenkte:r]
 */
export function draw(ids, groups = [], exclusions = [], { rnd = cryptoRandomInt, names = {} } = {}) {
  const pre = precheck(ids, groups, exclusions, names);
  if (!pre.ok) throw new Error(pre.reason);
  const { n, ok } = buildAllowed(ids, groups, exclusions);
  let order = cycleByRejection(ok, n, rnd);
  if (!order) order = cycleBySearch(ok, n, rnd);
  if (order) {
    return { form: 'kreis', pairs: order.map((g, i) => [ids[g], ids[order[(i + 1) % n]]]) };
  }
  const to = derangement(ok, n, rnd);
  if (to) return { form: 'frei', pairs: to.map((r, g) => [ids[g], ids[r]]) };
  throw new Error(t('Mit diesen Untergruppen und Ausschlüssen ist keine Ziehung möglich. Bitte Ausschlüsse reduzieren.'));
}

/** Prüft ein Ergebnis gegen die Regeln (für Tests und als Sicherheitsnetz vor dem Speichern). */
export function verify(ids, pairs, groups = [], exclusions = []) {
  const { ok } = buildAllowed(ids, groups, exclusions);
  const idx = new Map(ids.map((id, i) => [id, i]));
  if (pairs.length !== ids.length) return false;
  const givers = new Set(pairs.map((p) => p[0]));
  const receivers = new Set(pairs.map((p) => p[1]));
  if (givers.size !== ids.length || receivers.size !== ids.length) return false;
  return pairs.every(([g, r]) => idx.has(g) && idx.has(r) && ok[idx.get(g)][idx.get(r)]);
}

export function isSingleCycle(pairs) {
  const next = new Map(pairs);
  let cur = pairs[0][0];
  for (let i = 0; i < pairs.length; i++) cur = next.get(cur);
  if (cur !== pairs[0][0]) return false;
  const seen = new Set();
  cur = pairs[0][0];
  do { seen.add(cur); cur = next.get(cur); } while (cur !== pairs[0][0]);
  return seen.size === pairs.length;
}

// ------------------------------------------------------------------ Team-Wichteln

/**
 * Vorprüfung Team-Wichteln.
 * @param {{id:string,name:string,max?:number|null}[]} teams
 * @param {{id:string,name:string,team:string|null}[]} people  Zusagende mit Schlüssel
 * @returns {{ok:boolean, reason:string|null, warnings:string[], active:string[]}} active: Teams mit Mitgliedern
 */
export function teamPrecheck(teams, people) {
  const known = new Set(teams.map((x) => x.id));
  const without = people.filter((p) => !p.team || !known.has(p.team));
  if (people.length < 3) return { ok: false, reason: t('Für eine Ziehung braucht es mindestens 3 Zusagen (derzeit {n}).', { n: people.length }), warnings: [], active: [] };
  if (without.length) {
    return { ok: false, reason: t('Noch ohne Team: {names}. Ordne sie unten einem Team zu oder bitte sie, auf ihrer Seite ein Team zu wählen.', { names: without.map((p) => p.name).join(', ') }), warnings: [], active: [] };
  }
  const size = (id) => people.filter((p) => p.team === id).length;
  const active = teams.filter((x) => size(x.id) > 0).map((x) => x.id);
  if (active.length < 2) return { ok: false, reason: t('Für Team-Wichteln braucht es mindestens 2 Teams mit Mitgliedern.'), warnings: [], active };
  const warnings = [];
  if (active.length === 2) warnings.push(t('Nur 2 Teams: Jedes Team weiß dann sicher, welches Team es beschenkt – die Überraschung liegt nur im Geschenk.'));
  for (const x of teams) {
    if (x.max && size(x.id) > x.max) warnings.push(t('Team „{name}“ hat {n} Mitglieder, vorgesehen waren höchstens {max}.', { name: x.name, n: size(x.id), max: x.max }));
  }
  return { ok: true, reason: null, warnings, active };
}

/** Ziehung zwischen Teams: ein Kreis, kein Team beschenkt sich selbst. Bei 2 Teams beschenken sie sich gegenseitig. */
export function drawTeams(teamIds, { rnd = cryptoRandomInt } = {}) {
  if (teamIds.length < 2) throw new Error(t('Für Team-Wichteln braucht es mindestens 2 Teams mit Mitgliedern.'));
  if (teamIds.length === 2) return { form: 'kreis', pairs: [[teamIds[0], teamIds[1]], [teamIds[1], teamIds[0]]] };
  return draw(teamIds, [], [], { rnd });
}
