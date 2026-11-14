import { t, tn } from './i18n.js';

// ZeroWichtel – Spielregeln fürs Schrottwichteln.
// Die Regeln liegen in den Runden-Metadaten (verschlüsselt mit K_runde) und sind für alle Eingeladenen lesbar.
//
// rules = {
//   v: 1,
//   preset: 'klassisch' | 'tauschen' | 'rasant' | 'eigene',
//   dice: 1 | 2,                       // bei 2 Würfeln zählt die Augensumme
//   appDice: true,                     // App-Würfel vorschlagen (echte Würfel gehen immer)
//   phases: [{ name, minutes|null, actions: { '6': 'take_center', … } }],   // minutes null = bis die Mitte leer ist
//   end: 'unwrap_all' | 'immediately',
// }

// Beschriftungen als Getter: sie folgen der gewählten Sprache (i18n.js).
export const ACTIONS = {
  get take_center() { return t('Päckchen aus der Mitte nehmen'); },
  get steal() { return t('Päckchen von beliebiger Person nehmen'); },
  get swap_left() { return t('Mit linker Nachbarperson tauschen'); },
  get swap_right() { return t('Mit rechter Nachbarperson tauschen'); },
  get pass_left() { return t('Alle geben ein Päckchen nach links weiter'); },
  get pass_right() { return t('Alle geben ein Päckchen nach rechts weiter'); },
  get unwrap() { return t('Eigenes Päckchen auspacken'); },
  get again() { return t('Noch einmal würfeln'); },
  get skip() { return t('Aussetzen'); },
};

export const END_LABEL = {
  get unwrap_all() { return t('Danach packen alle ihre Päckchen aus.'); },
  get immediately() { return t('Das Spiel endet sofort nach der letzten Phase.'); },
};

export const LIMITS = { phases: 4, nameLength: 30, minMinutes: 1, maxMinutes: 60 };

export const PRESETS = {
  klassisch: {
    get label() { return t('Klassisch'); },
    get hint() { return t('Erst einsammeln, dann 10 Minuten stibitzen. Nur die 6 zählt.'); },
    get rules() {
      return {
        dice: 1,
        phases: [
          { name: t('Einsammeln'), minutes: null, actions: { 6: 'take_center' } },
          { name: t('Stibitzen'), minutes: 10, actions: { 6: 'steal' } },
        ],
        end: 'unwrap_all',
      };
    },
  },
  tauschen: {
    get label() { return t('Klassisch plus Tauschen'); },
    get hint() { return t('Wie klassisch, zusätzlich wird bei der 1 mit den Nachbarn getauscht.'); },
    get rules() {
      return {
        dice: 1,
        phases: [
          { name: t('Einsammeln'), minutes: null, actions: { 6: 'take_center', 1: 'swap_left' } },
          { name: t('Stibitzen'), minutes: 10, actions: { 6: 'steal', 1: 'swap_right' } },
        ],
        end: 'unwrap_all',
      };
    },
  },
  rasant: {
    get label() { return t('Rasant'); },
    get hint() { return t('Mehr Bewegung: 5 und 6 sammeln, danach 5 Minuten Chaos mit Weitergeben.'); },
    get rules() {
      return {
        dice: 1,
        phases: [
          { name: t('Einsammeln'), minutes: null, actions: { 5: 'take_center', 6: 'take_center' } },
          { name: t('Chaos'), minutes: 5, actions: { 6: 'steal', 3: 'pass_left', 4: 'pass_right', 1: 'again' } },
        ],
        end: 'unwrap_all',
      };
    },
  },
};

export function faces(dice) {
  return dice === 2 ? Array.from({ length: 11 }, (_, i) => i + 2) : [1, 2, 3, 4, 5, 6];
}

export function fromPreset(key) {
  const p = PRESETS[key] ?? PRESETS.klassisch;
  return { v: 1, preset: PRESETS[key] ? key : 'klassisch', appDice: true, ...structuredClone(p.rules) };
}

export function defaultRules() {
  return fromPreset('klassisch');
}

/** Prüft und bereinigt Regeln. Wirft verständliche Fehler. */
export function normalizeRules(input) {
  if (!input || typeof input !== 'object') return defaultRules();
  const dice = input.dice === 2 ? 2 : 1;
  const allowedFaces = new Set(faces(dice).map(String));
  const raw = Array.isArray(input.phases) ? input.phases : [];
  if (raw.length === 0) throw new Error(t('Mindestens eine Spielphase ist nötig.'));
  if (raw.length > LIMITS.phases) throw new Error(t('Höchstens {n} Spielphasen.', { n: LIMITS.phases }));
  const phases = raw.map((p, i) => {
    const name = String(p?.name ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, LIMITS.nameLength) || t('Phase {n}', { n: i + 1 });
    let minutes = p?.minutes;
    if (minutes === '' || minutes === undefined) minutes = null;
    if (minutes !== null) {
      minutes = Number(minutes);
      if (!Number.isInteger(minutes) || minutes < LIMITS.minMinutes || minutes > LIMITS.maxMinutes) {
        throw new Error(t('Phase „{name}“: Dauer bitte in ganzen Minuten von {min} bis {max}.', { name, min: LIMITS.minMinutes, max: LIMITS.maxMinutes }));
      }
    }
    const actions = {};
    for (const [face, act] of Object.entries(p?.actions ?? {})) {
      if (allowedFaces.has(String(face)) && ACTIONS[act]) actions[String(face)] = act;
    }
    if (Object.keys(actions).length === 0) throw new Error(t('Phase „{name}“: Mindestens eine Augenzahl braucht eine Aktion.', { name }));
    return { name, minutes, actions };
  });
  return {
    v: 1,
    preset: PRESETS[input.preset] ? input.preset : 'eigene',
    dice,
    appDice: input.appDice !== false,
    phases,
    end: input.end === 'immediately' ? 'immediately' : 'unwrap_all',
  };
}

/** Aktion für einen Wurf in einer Phase (null = nichts passiert). */
export function actionFor(phase, value) {
  const a = phase?.actions?.[String(value)];
  return a && ACTIONS[a] ? { id: a, label: ACTIONS[a] } : null;
}

/** Namen der Vorlagen (z. B. „Einsammeln“) erscheinen in der gewählten Sprache; eigene Namen bleiben, wie sie sind. */
export function phaseName(name) {
  return t(name);
}

export function durationLabel(phase) {
  return phase.minutes === null ? t('bis die Mitte leer ist') : tn(phase.minutes, '{n} Minute', '{n} Minuten');
}

/** Kurzbeschreibung als Zeilen, z. B. für Hilfetexte und Tests. */
export function describe(rules) {
  const r = normalizeRules(rules);
  const lines = [r.dice === 2 ? t('Zwei Würfel, es zählt die Summe.') : t('Ein Würfel.')];
  r.phases.forEach((p, i) => {
    const acts = Object.entries(p.actions).sort((a, b) => Number(b[0]) - Number(a[0])).map(([f, a]) => `${f}: ${ACTIONS[a]}`).join('; ');
    lines.push(t('Phase {n} – {name} ({duration}): {acts}.', { n: i + 1, name: phaseName(p.name), duration: durationLabel(p), acts }));
  });
  lines.push(END_LABEL[r.end]);
  return lines;
}

/** Würfelwurf mit unverzerrtem Zufall aus WebCrypto. */
export function rollDice(count = 1) {
  const buf = new Uint8Array(1);
  const one = () => {
    for (;;) {
      globalThis.crypto.getRandomValues(buf);
      if (buf[0] < 252) return (buf[0] % 6) + 1; // 252 = 42 · 6, verwirft 252–255
    }
  };
  return Array.from({ length: count === 2 ? 2 : 1 }, one);
}
