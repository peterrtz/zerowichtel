// Schrottwichteln: Regelbaukasten und Regelanzeige.

import { h, add, clear, field } from '../lib/dom.js';
import { ACTIONS, PRESETS, END_LABEL, LIMITS, faces, fromPreset, normalizeRules, durationLabel, defaultRules, phaseName } from '../lib/rules.js';
import { t } from '../lib/i18n.js';

/** Lesbare Regelübersicht für alle Eingeladenen. */
export function rulesView(rules, { compact = false } = {}) {
  let r;
  try { r = normalizeRules(rules ?? defaultRules()); } catch { r = defaultRules(); }
  const wrap = h('div', { class: ['rules-view', compact && 'rules-compact'] });
  add(wrap, h('p', { class: 'rules-dice' }, r.dice === 2 ? t('Gewürfelt wird mit zwei Würfeln – es zählt die Summe.') : t('Gewürfelt wird mit einem Würfel.')));
  r.phases.forEach((p, i) => {
    const rows = Object.entries(p.actions).sort((a, b) => Number(b[0]) - Number(a[0]));
    add(wrap, h('div', { class: 'rules-phase' },
      h('p', { class: 'rules-phase-head' }, h('span', { class: 'phase-no' }, String(i + 1)), h('strong', null, phaseName(p.name)), h('span', { class: 'muted' }, ` · ${durationLabel(p)}`)),
      h('table', { class: 'action-table' },
        h('tbody', null, rows.map(([face, act]) => h('tr', null,
          h('th', { scope: 'row' }, h('span', { class: 'face-badge' }, face)),
          h('td', null, ACTIONS[act]))))),
      h('p', { class: 'hint' }, t('Alle anderen Würfe: nichts passiert, der Würfel geht weiter.')),
    ));
  });
  add(wrap, h('p', { class: 'rules-end' }, END_LABEL[r.end]));
  return wrap;
}

/** Regelbaukasten. @returns {{el: HTMLElement, get: () => object}} */
export function rulesEditor(initial) {
  let state;
  try { state = normalizeRules(initial ?? defaultRules()); } catch { state = defaultRules(); }
  const el = h('div', { class: 'rules-editor' });
  let customOpen = state.preset === 'eigene';

  const touch = () => { state.preset = 'eigene'; render(); };

  const render = () => {
    clear(el);

    // Vorlagen
    const presetPick = h('div', { class: 'preset-pick', role: 'radiogroup', 'aria-label': t('Vorlage') });
    for (const [key, p] of Object.entries(PRESETS)) {
      const input = h('input', { type: 'radio', name: 'preset', value: key, checked: state.preset === key });
      input.addEventListener('change', () => { state = fromPreset(key); customOpen = false; render(); });
      add(presetPick, h('label', { class: 'mode-option' }, input, h('span', null, h('strong', null, p.label), h('small', null, p.hint))));
    }
    const own = h('input', { type: 'radio', name: 'preset', value: 'eigene', checked: state.preset === 'eigene' });
    own.addEventListener('change', () => { state.preset = 'eigene'; customOpen = true; render(); });
    add(presetPick, h('label', { class: 'mode-option' }, own, h('span', null, h('strong', null, t('Eigene Regeln')), h('small', null, t('Phasen, Würfel und Aktionen selbst festlegen.')))));
    add(el, presetPick);

    // Anpassen
    const custom = h('details', { class: 'rules-custom', open: customOpen });
    custom.addEventListener('toggle', () => { customOpen = custom.open; });
    add(custom, h('summary', null, t('Regeln anpassen')));

    const diceSel = h('select', null,
      h('option', { value: '1', selected: state.dice === 1 }, t('Ein Würfel (1–6)')),
      h('option', { value: '2', selected: state.dice === 2 }, t('Zwei Würfel, Summe (2–12)')));
    diceSel.addEventListener('change', () => {
      state.dice = Number(diceSel.value);
      const allowed = new Set(faces(state.dice).map(String));
      state.phases.forEach((p) => { p.actions = Object.fromEntries(Object.entries(p.actions).filter(([f]) => allowed.has(f))); });
      touch();
    });
    add(custom, field(t('Würfel'), diceSel));

    state.phases.forEach((p, i) => {
      const name = h('input', { type: 'text', maxlength: LIMITS.nameLength, 'aria-label': t('Name von Phase {n}', { n: i + 1 }) });
      name.value = p.name;
      name.addEventListener('change', () => { p.name = name.value; state.preset = 'eigene'; own.checked = true; });
      const durType = h('select', { 'aria-label': t('Dauer') },
        h('option', { value: 'empty', selected: p.minutes === null }, t('bis die Mitte leer ist')),
        h('option', { value: 'timer', selected: p.minutes !== null }, t('feste Zeit')));
      const minutes = h('input', { type: 'number', min: LIMITS.minMinutes, max: LIMITS.maxMinutes, step: 1, inputmode: 'numeric', 'aria-label': t('Minuten'), disabled: p.minutes === null });
      minutes.value = p.minutes ?? '';
      durType.addEventListener('change', () => { p.minutes = durType.value === 'empty' ? null : (p.minutes ?? 10); touch(); });
      minutes.addEventListener('change', () => { p.minutes = minutes.value === '' ? 10 : Number(minutes.value); state.preset = 'eigene'; own.checked = true; });

      const table = h('table', { class: 'action-table action-edit' }, h('tbody', null, faces(state.dice).slice().reverse().map((f) => {
        const sel = h('select', { 'aria-label': t('Aktion bei {face}', { face: f }) },
          h('option', { value: '' }, t('– nichts –')),
          Object.entries(ACTIONS).map(([id, label]) => h('option', { value: id, selected: p.actions[String(f)] === id }, label)));
        sel.addEventListener('change', () => {
          if (sel.value) p.actions[String(f)] = sel.value;
          else delete p.actions[String(f)];
          state.preset = 'eigene';
          own.checked = true;
        });
        return h('tr', null, h('th', { scope: 'row' }, h('span', { class: 'face-badge' }, String(f))), h('td', null, sel));
      })));

      add(custom, h('div', { class: 'phase-edit' },
        h('div', { class: 'phase-edit-head' },
          h('span', { class: 'phase-no' }, String(i + 1)), name,
          state.phases.length > 1
            ? h('button', { type: 'button', class: 'btn btn-small btn-ghost btn-danger', on: { click: () => { state.phases.splice(i, 1); touch(); } } }, t('Entfernen'))
            : null),
        h('div', { class: 'phase-duration' }, durType, p.minutes === null ? null : h('span', { class: 'input-suffix' }, minutes, h('span', null, t('Min.')))),
        table));
    });

    if (state.phases.length < LIMITS.phases) {
      add(custom, h('button', {
        type: 'button', class: 'btn btn-small',
        on: { click: () => { state.phases.push({ name: t('Phase {n}', { n: state.phases.length + 1 }), minutes: 5, actions: { 6: 'steal' } }); touch(); } },
      }, t('+ Phase')));
    }

    const endSel = h('select', null,
      h('option', { value: 'unwrap_all', selected: state.end === 'unwrap_all' }, t('Danach packen alle aus')),
      h('option', { value: 'immediately', selected: state.end === 'immediately' }, t('Spiel endet sofort')));
    endSel.addEventListener('change', () => { state.end = endSel.value; touch(); });
    const appDice = h('input', { type: 'checkbox', checked: state.appDice });
    appDice.addEventListener('change', () => { state.appDice = appDice.checked; state.preset = 'eigene'; own.checked = true; });
    add(custom,
      field(t('Nach der letzten Phase'), endSel),
      h('label', { class: 'check' }, appDice, ' ', t('App-Würfel anbieten (echte Würfel gehen immer)')));
    add(el, custom);

    add(el, h('details', { class: 'rules-preview' }, h('summary', null, t('So sehen die Eingeladenen die Regeln')), rulesView(state)));
  };

  render();
  return { el, get: () => normalizeRules(state) };
}
