// Schrottwichteln vor Ort: Vollbild-Spielansicht auf einem Gerät.
// Läuft komplett lokal – kein Serverkontakt, keine Speicherung von Spielständen auf dem Server.

import { h, add, clear, field } from '../lib/dom.js';
import { ACTIONS, END_LABEL, actionFor, durationLabel, normalizeRules, rollDice, defaultRules, fromPreset, phaseName } from '../lib/rules.js';
import { page, card, mount, setTitle } from './common.js';
import { rulesEditor, rulesView } from './rules-editor.js';
import { t } from '../lib/i18n.js';

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function die(value) {
  const d = h('div', { class: 'die', 'aria-hidden': 'true' });
  for (let i = 0; i < 9; i++) add(d, h('span', { class: ['pip', PIPS[value]?.includes(i) && 'on'] }));
  return d;
}

const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------- Ton und Vibration (ohne Audiodateien)

let audio = null;
function unlockAudio() {
  try {
    audio ??= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
function beep(times = 3) {
  try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch { /* ohne Vibration */ }
  if (!audio) return;
  for (let i = 0; i < times; i++) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    const at = audio.currentTime + i * 0.35;
    o.frequency.value = i === times - 1 ? 988 : 784;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    o.connect(g).connect(audio.destination);
    o.start(at);
    o.stop(at + 0.3);
  }
}

// ---------- Bildschirm anlassen

async function keepAwake() {
  try {
    return await navigator.wakeLock?.request('screen');
  } catch {
    return null;
  }
}

/**
 * Öffnet das Spiel als Vollbild-Ebene.
 * @param {{rules: object, title: string, packages?: number, storageKey: string}} opts
 */
export function openGame({ rules, title, packages = 0, storageKey }) {
  const r = (() => { try { return normalizeRules(rules ?? defaultRules()); } catch { return defaultRules(); } })();
  const key = `zw.game.${storageKey}`;
  const fresh = () => ({ phase: 0, running: false, endsAt: 0, remaining: (r.phases[0].minutes ?? 0) * 60000, center: packages, rolls: [], appDice: r.appDice, finished: false, timeUp: false });
  let st;
  try { st = { ...fresh(), ...JSON.parse(sessionStorage.getItem(key) || 'null') }; } catch { st = fresh(); }
  if (st.phase >= r.phases.length) st = fresh();
  const persist = () => { try { sessionStorage.setItem(key, JSON.stringify(st)); } catch { /* egal */ } };

  let wake = null;
  let tick = null;
  let rolling = false;
  const prevFocus = document.activeElement;
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'assertive' });
  const overlay = h('div', { class: 'game', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Spiel: {title}', { title }) });
  const body = h('div', { class: 'game-body' });
  add(overlay, body, live);
  document.body.appendChild(overlay);
  document.body.classList.add('game-open');

  const phase = () => r.phases[st.phase];
  const remainingNow = () => (st.running ? st.endsAt - Date.now() : st.remaining);

  const close = () => {
    if (st.running && !confirm(t('Das Spiel läuft noch. Wirklich schließen? Der Stand bleibt in diesem Tab erhalten.'))) return;
    clearInterval(tick);
    try { wake?.release(); } catch { /* egal */ }
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('game-open');
    prevFocus?.focus?.();
  };
  const onVisible = async () => { if (document.visibilityState === 'visible') wake = await keepAwake(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('keydown', onKey);
  keepAwake().then((w) => { wake = w; });

  const startPause = () => {
    unlockAudio();
    if (st.running) {
      st.remaining = Math.max(0, st.endsAt - Date.now());
      st.running = false;
    } else {
      st.endsAt = Date.now() + st.remaining;
      st.running = true;
      st.timeUp = false;
    }
    persist();
    render();
  };

  const nextPhase = () => {
    st.running = false;
    st.timeUp = false;
    if (st.phase + 1 >= r.phases.length) {
      st.finished = true;
      live.textContent = t('Spiel beendet.');
    } else {
      st.phase += 1;
      st.remaining = (phase().minutes ?? 0) * 60000;
      live.textContent = t('Phase {n}: {name}', { n: st.phase + 1, name: phaseName(phase().name) });
    }
    persist();
    render();
  };

  const restart = () => {
    st = fresh();
    persist();
    render();
  };

  const roll = () => {
    if (rolling) return;
    unlockAudio();
    rolling = true;
    const values = rollDice(r.dice);
    const sum = values.reduce((a, b) => a + b, 0);
    const finish = () => {
      rolling = false;
      const act = actionFor(phase(), sum);
      st.rolls = [{ values, sum, act: act?.id ?? null }, ...st.rolls].slice(0, 6);
      persist();
      live.textContent = `${t('Gewürfelt: {sum}.', { sum })} ${act ? act.label : t('Nichts passiert.')}`;
      render();
    };
    if (reducedMotion()) return finish();
    // kurze Animation mit Zwischenwerten
    const diceEls = body.querySelectorAll('.dice-row .die');
    let n = 0;
    const anim = setInterval(() => {
      diceEls.forEach((d) => {
        const v = 1 + Math.floor(Math.random() * 6); // nur Optik, das Ergebnis kommt aus WebCrypto
        d.querySelectorAll('.pip').forEach((p, i) => p.classList.toggle('on', PIPS[v].includes(i)));
        d.classList.add('rolling');
      });
      if (++n >= 7) { clearInterval(anim); finish(); }
    }, 70);
  };

  // Zeit prüfen und Anzeige aktualisieren, ohne neu zu rendern
  // Ansagen für Screenreader an wenigen Punkten statt jede Sekunde
  const SAY = [[60000, t('Noch 1 Minute')], [10000, t('Noch 10 Sekunden')]];
  let said = new Set();
  tick = setInterval(() => {
    if (!st.running) { said = new Set(); return; }
    const left = st.endsAt - Date.now();
    const timerEl = body.querySelector('.timer');
    if (timerEl) timerEl.textContent = fmtTime(left);
    for (const [ms, text] of SAY) {
      if (left <= ms && left > ms - 2000 && !said.has(ms)) { said.add(ms); live.textContent = text; }
    }
    if (left <= 0) {
      st.running = false;
      st.remaining = 0;
      st.timeUp = true;
      persist();
      beep();
      live.textContent = t('Zeit ist um: {name}', { name: phaseName(phase().name) });
      render();
    }
  }, 250);

  function render() {
    clear(body);
    const p = phase();
    add(body, h('header', { class: 'game-head' },
      h('div', null,
        h('p', { class: 'game-title' }, title),
        st.finished ? h('p', { class: 'game-phase' }, t('Spiel beendet'))
          : h('p', { class: 'game-phase' }, h('span', { class: 'phase-no' }, String(st.phase + 1)), h('span', null, t('von {n} ·', { n: r.phases.length })), h('strong', null, phaseName(p.name)))),
      h('button', { type: 'button', class: 'btn btn-ghost game-close', 'aria-label': t('Spiel schließen'), on: { click: close } }, '✕')));

    if (st.finished) {
      add(body, h('section', { class: 'game-end' },
        h('p', { class: 'game-end-big' }, r.end === 'unwrap_all' ? t('Auspacken!') : t('Fertig!')),
        h('p', null, END_LABEL[r.end]),
        h('div', { class: 'form-actions center' },
          h('button', { type: 'button', class: 'btn btn-large', on: { click: restart } }, t('Nochmal von vorn')),
          h('button', { type: 'button', class: 'btn btn-primary btn-large', on: { click: () => { st.running = false; close(); } } }, t('Schließen')))));
      return;
    }

    // Phase: Zeit oder Mitte
    const status = h('section', { class: 'game-status' });
    if (p.minutes !== null) {
      add(status,
        h('p', { class: ['timer', st.timeUp && 'timer-up'], role: 'timer', 'aria-label': t('Restzeit') }, st.timeUp ? '00:00' : fmtTime(remainingNow())),
        st.timeUp ? h('p', { class: 'notice notice-warn' }, t('Zeit ist um!')) : h('p', { class: 'hint' }, durationLabel(p)),
        h('div', { class: 'game-controls' },
          st.timeUp ? null : h('button', { type: 'button', class: ['btn', 'btn-large', !st.running && 'btn-primary'], on: { click: startPause } },
            st.running ? t('Pause') : (st.remaining < p.minutes * 60000 ? t('Weiter') : t('Zeit starten'))),
          h('button', { type: 'button', class: ['btn', 'btn-large', st.timeUp && 'btn-primary'], on: { click: nextPhase } },
            st.phase + 1 >= r.phases.length ? t('Spiel beenden') : t('Nächste Phase'))));
    } else {
      const minus = h('button', { type: 'button', class: 'btn counter-btn', 'aria-label': t('Ein Päckchen weniger'), on: { click: () => { st.center = Math.max(0, st.center - 1); persist(); render(); } } }, '−');
      const plus = h('button', { type: 'button', class: 'btn counter-btn', 'aria-label': t('Ein Päckchen mehr'), on: { click: () => { st.center += 1; persist(); render(); } } }, '+');
      add(status,
        h('p', { class: 'hint' }, t('Diese Phase läuft, bis die Mitte leer ist.')),
        h('div', { class: 'center-counter' }, minus, h('p', null, h('span', { class: 'center-count' }, String(st.center)), h('span', null, ' ', t('Päckchen in der Mitte'))), plus),
        st.center === 0 ? h('p', { class: 'notice notice-ok' }, t('Die Mitte ist leer.')) : null,
        h('div', { class: 'game-controls' },
          h('button', { type: 'button', class: ['btn', 'btn-large', st.center === 0 && 'btn-primary'], on: { click: nextPhase } },
            st.phase + 1 >= r.phases.length ? t('Spiel beenden') : t('Nächste Phase'))));
    }
    add(body, status);

    // Würfel
    const last = st.rolls[0];
    const lastAct = last ? actionFor(p, last.sum) : null;
    if (st.appDice) {
      const values = last?.values ?? Array(r.dice).fill(6);
      add(body, h('section', { class: 'dice-area' },
        h('button', { type: 'button', class: 'dice-row', 'aria-label': t('Würfeln'), on: { click: roll } }, values.map(die)),
        h('button', { type: 'button', class: 'btn btn-primary btn-large roll-btn', on: { click: roll } }, t('Würfeln')),
        last
          ? h('div', { class: ['roll-result', lastAct ? 'roll-hit' : 'roll-miss'] },
            h('span', { class: 'roll-sum' }, String(last.sum)),
            h('span', null, lastAct ? lastAct.label : t('Nichts passiert – weitergeben.')),
            lastAct?.id === 'take_center' && p.minutes === null && st.center > 0
              ? h('button', { type: 'button', class: 'btn btn-small', on: { click: () => { st.center -= 1; persist(); render(); } } }, t('Genommen (−1)'))
              : null)
          : h('p', { class: 'hint' }, t('Tippe auf „Würfeln“ und gib das Gerät dann weiter.')),
        st.rolls.length > 1 ? h('p', { class: 'roll-history' }, t('Zuletzt: '), st.rolls.slice(1).map((x) => x.sum).join(' · ')) : null,
      ));
    }

    // Aktionstabelle der aktuellen Phase
    const rows = Object.entries(p.actions).sort((a, b) => Number(b[0]) - Number(a[0]));
    add(body, h('section', { class: 'game-actions' },
      h('table', { class: 'action-table' }, h('tbody', null, rows.map(([face, act]) => h('tr', { class: last && lastAct && String(last.sum) === face ? 'is-hit' : null },
        h('th', { scope: 'row' }, h('span', { class: 'face-badge' }, face)), h('td', null, ACTIONS[act]))))),
      h('p', { class: 'hint' }, t('Alle anderen Würfe: nichts passiert.'))));

    const appToggle = h('input', { type: 'checkbox', checked: st.appDice });
    appToggle.addEventListener('change', () => { st.appDice = appToggle.checked; persist(); render(); });
    add(body, h('footer', { class: 'game-foot' },
      h('label', { class: 'check' }, appToggle, ' ', t('App-Würfel verwenden')),
      h('button', { type: 'button', class: 'btn btn-ghost btn-small', on: { click: () => { if (confirm(t('Spiel zurücksetzen?'))) restart(); } } }, t('Zurücksetzen'))));
  }

  render();
  overlay.querySelector('.game-close')?.focus();
  return { close };
}

/** Karte mit Regeln und Startknopf – für Verwaltung und Teilnahme. */
export function schrottCard({ meta, round, packages, storageKey }) {
  return card(t('Spielregeln'),
    rulesView(meta.rules),
    h('div', { class: 'form-actions' },
      h('button', {
        type: 'button', class: 'btn btn-primary btn-large',
        on: { click: () => openGame({ rules: meta.rules, title: meta.title, packages, storageKey }) },
      }, t('Spiel starten')),
      h('span', { class: 'hint' }, round.status === 'offen' ? t('Vor Ort auf einem Gerät starten und reihum weitergeben.') : '')));
}

/** Freies Würfeln ohne Runde: #wuerfel */
export function renderDiceOnly(root) {
  setTitle(t('Würfelspiel'));
  const editor = rulesEditor(fromPreset('klassisch'));
  const pk = h('input', { type: 'number', min: 0, max: 99, step: 1, inputmode: 'numeric' });
  pk.value = '8';
  const err = h('div');
  mount(root, page(
    h('h1', null, t('Schrottwichteln ohne Runde')),
    h('p', { class: 'lead' }, t('Nur Regeln, Timer und Würfel – ohne Einladungen, ohne Daten. Läuft komplett auf diesem Gerät.')),
    card(t('Regeln'), editor.el),
    card(t('Vor Ort'), field(t('Päckchen in der Mitte'), pk, t('Zahl der mitgebrachten Päckchen.')), err,
      h('button', {
        type: 'button', class: 'btn btn-primary btn-large',
        on: {
          click: () => {
            err.replaceChildren();
            try {
              openGame({ rules: editor.get(), title: t('Schrottwichteln'), packages: Math.max(0, Number(pk.value) || 0), storageKey: 'frei' });
            } catch (e) {
              err.appendChild(h('div', { class: 'notice notice-error' }, e.message));
            }
          },
        },
      }, t('Spiel starten'))),
    h('p', null, h('a', { class: 'btn btn-ghost', href: '#' }, t('← Startseite'))),
  ));
}

