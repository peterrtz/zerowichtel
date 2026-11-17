// Analoge Wichtelrunde (2.7): Namen eintragen, Lose, Spielregeln und Karten ausdrucken.
// Läuft komplett im Browser; gespeichert wird nur lokal in diesem Browser, bis „Alles löschen“.

import { h, add, clear, svg, field, toast, actionButton } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { eventFromInput, formatDate, euro } from '../lib/dates.js';
import {
  ANALOG_ROUND_LIMITS, loadAnalogRound, saveAnalogRound, clearAnalogRound, emptyAnalogRound,
  addPerson, removePerson, analogRoundPrecheck, drawAnalogRound, hiddenSlips,
} from '../lib/analog-round.js';
import { page, card, mount, setTitle, notice, printSheet } from './common.js';
import { t } from '../lib/i18n.js';

// ---------------------------------------------------------------- Gestaltung der Karten (eigene Linienzeichnungen)

function star(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return svg('polygon', { points: pts.join(' ') });
}

/** Dezente Verzierung je Design; Farben kommen aus dem Druck-CSS. */
export function cardDecor(design) {
  const box = { viewBox: '0 0 120 60', class: `analog-decor analog-decor-${design}`, 'aria-hidden': 'true', focusable: 'false' };
  if (design === 'sterne') {
    return svg('svg', box,
      star(20, 22, 7), star(44, 12, 4), star(60, 30, 9), star(80, 14, 4.5), star(100, 26, 6.5), star(34, 40, 3.5), star(88, 44, 3));
  }
  if (design === 'schleife') {
    return svg('svg', box,
      svg('path', { d: 'M0 34 H120', class: 'band' }),
      svg('path', { d: 'M60 34 C44 14 30 20 36 30 C40 37 52 36 60 34 C68 36 80 37 84 30 C90 20 76 14 60 34 Z', class: 'bow' }),
      svg('path', { d: 'M60 34 L50 56 M60 34 L70 56', class: 'bow' }),
      svg('circle', { cx: 60, cy: 34, r: 3, class: 'knot' }));
  }
  // Tannenzweig
  const needles = [];
  for (let i = 0; i < 9; i++) {
    const x = 14 + i * 11;
    const y = 40 - i * 2.2;
    needles.push(svg('path', { d: `M${x} ${y} l7 -9 M${x} ${y} l7 9`, class: 'needle' }));
  }
  return svg('svg', box,
    svg('path', { d: 'M8 42 Q60 30 112 20', class: 'stem' }),
    ...needles,
    svg('circle', { cx: 30, cy: 46, r: 3.2, class: 'berry' }), svg('circle', { cx: 37, cy: 49, r: 3.2, class: 'berry' }));
}

// ---------------------------------------------------------------- Druckbögen

const factsOf = (s) => [
  s.date ? t('Wann: {date}', { date: formatDate(eventFromInput(s.date)) }) : null,
  s.place ? t('Wo: {place}', { place: s.place }) : null,
  s.budget !== null ? t('Betragslimit: {budget}', { budget: euro(s.budget) }) : null,
].filter(Boolean);
const titleOf = (s) => s.title || t('Wichteln');

function slipsSheet(s) {
  if (s.mode === 'hut') {
    return h('div', { class: 'print-sheet analog-print analog-hut' },
      s.people.map((p) => h('section', { class: 'hut-slip' },
        h('div', { class: 'hut-cover' }, h('span', null, titleOf(s))),
        h('div', { class: 'hut-name' }, p.name))));
  }
  return h('div', { class: 'print-sheet analog-print analog-slips' },
    hiddenSlips(s).map((x) => h('section', { class: 'slip' },
      h('div', { class: 'slip-out' },
        h('p', { class: 'slip-kicker' }, titleOf(s)),
        h('p', { class: 'slip-for' }, t('Los für {name}', { name: x.giver })),
        h('p', { class: 'slip-hint' }, t('Allein aufklappen und niemandem zeigen.'))),
      h('div', { class: 'slip-in' },
        h('p', { class: 'slip-you' }, t('Du beschenkst')),
        h('p', { class: 'slip-receiver' }, x.receiver),
        s.budget !== null ? h('p', { class: 'slip-hint' }, t('bis {budget}', { budget: euro(s.budget) })) : null),
      h('div', { class: 'slip-cover' }, h('span', null, t('hier nach oben falten – deckt den Namen ab'))))));
}

function rulesSheet(s) {
  const facts = factsOf(s);
  const steps = s.mode === 'hut'
    ? [
      t('Alle Namenszettel einmal falten und in einen Hut, eine Mütze oder eine Schale legen.'),
      t('Reihum zieht jede Person einen Zettel und schaut ihn allein an.'),
      t('Wer den eigenen Namen zieht, legt den Zettel zurück und zieht neu. Bleibt zum Schluss nur der eigene Name übrig, kommen alle Zettel zurück in den Hut und es wird neu gezogen.'),
    ]
    : [
      t('Jede Person bekommt das Los mit ihrem Namen – gefaltet, ohne hineinzuschauen.'),
      t('Los allein aufklappen und niemandem zeigen.'),
    ];
  steps.push(
    s.budget !== null
      ? t('Ein Geschenk für die gezogene Person besorgen – höchstens {budget}.', { budget: euro(s.budget) })
      : t('Ein Geschenk für die gezogene Person besorgen.'),
    t('Gut verpacken und den Namen der beschenkten Person draufschreiben, nicht den eigenen.'),
    s.date ? t('Am {date} werden die Geschenke verteilt.', { date: formatDate(eventFromInput(s.date)) }) : t('Am Wichteltag werden die Geschenke verteilt.'),
    t('Raten, wer wen beschenkt hat, ist erlaubt – verraten muss es niemand.'),
  );
  return h('div', { class: 'print-sheet analog-print analog-rules' },
    cardDecor(s.design),
    h('h1', null, titleOf(s)),
    facts.length ? h('p', { class: 'rules-facts' }, facts.join(' · ')) : null,
    s.note ? h('p', { class: 'rules-note' }, s.note) : null,
    h('h2', null, t('So wird gewichtelt')),
    h('ol', null, steps.map((x) => h('li', null, x))),
    h('p', { class: 'rules-names' }, h('strong', null, t('Dabei:')), ' ', s.people.map((p) => p.name).join(', ')));
}

function cardsSheet(s) {
  const facts = factsOf(s);
  return h('div', { class: 'print-sheet analog-print analog-cards' },
    s.people.map((p) => h('section', { class: `analog-card analog-card-${s.design}` },
      cardDecor(s.design),
      h('p', { class: 'analog-card-kicker' }, s.cardKind === 'erinnerung' ? t('Erinnerung') : t('Einladung zum Wichteln')),
      h('h2', null, titleOf(s)),
      h('p', { class: 'analog-card-name' }, t('Hallo {name}!', { name: p.name })),
      h('p', { class: 'analog-card-text' }, s.cardKind === 'erinnerung'
        ? (s.date ? t('Am {date} wird gewichtelt. Denk an dein Geschenk!', { date: formatDate(eventFromInput(s.date)) }) : t('Bald wird gewichtelt. Denk an dein Geschenk!'))
        : t('Du bist herzlich zum Wichteln eingeladen. Dein Los bekommst du rechtzeitig vorher.')),
      facts.length ? h('p', { class: 'analog-card-facts' }, facts.join(' · ')) : null,
      s.note ? h('p', { class: 'analog-card-note' }, s.note) : null)));
}

// ---------------------------------------------------------------- Ansicht

export function renderAnalogRound(root) {
  setTitle(t('Analoge Wichtelrunde'));
  let s = loadAnalogRound();
  let storageOk = true;
  const persist = () => {
    storageOk = saveAnalogRound(s);
  };

  // Zähler: einmal je Vorbereitung, beim ersten Druck. Ohne Inhalte; Fehler (z. B. Begrenzung) sind egal.
  const countOnce = () => {
    if (s.counted) return;
    s.counted = true;
    persist();
    api('POST', '/stats/analog').catch(() => {});
  };
  const print = (sheet) => {
    countOnce();
    printSheet(sheet);
  };

  const body = h('div');
  const render = () => {
    clear(body);
    const change = () => { persist(); render(); };

    // Eckdaten
    const title = h('input', { type: 'text', maxlength: ANALOG_ROUND_LIMITS.title, placeholder: t('z. B. Familienwichteln 2026') });
    title.value = s.title;
    const date = h('input', { type: 'date' });
    date.value = s.date;
    const place = h('input', { type: 'text', maxlength: ANALOG_ROUND_LIMITS.place, placeholder: t('z. B. bei Oma') });
    place.value = s.place;
    const budget = h('input', { type: 'number', min: 0, max: ANALOG_ROUND_LIMITS.budgetMax, step: 1, inputmode: 'numeric', placeholder: t('leer = kein Limit') });
    budget.value = s.budget ?? '';
    const note = h('textarea', { maxlength: ANALOG_ROUND_LIMITS.note, rows: 2, placeholder: t('z. B. Bitte nichts Selbstgebackenes') });
    note.value = s.note;
    const keep = () => {
      s.title = title.value.trim().slice(0, ANALOG_ROUND_LIMITS.title);
      s.date = date.value;
      s.place = place.value.trim().slice(0, ANALOG_ROUND_LIMITS.place);
      s.budget = budget.value === '' ? null : Math.max(0, Math.min(ANALOG_ROUND_LIMITS.budgetMax, Math.round(Number(budget.value)) || 0));
      s.note = note.value.slice(0, ANALOG_ROUND_LIMITS.note);
      persist();
    };
    [title, date, place, budget, note].forEach((el) => el.addEventListener('change', keep));

    // Personen
    const nameIn = h('input', { type: 'text', maxlength: ANALOG_ROUND_LIMITS.name, placeholder: t('Name'), autocomplete: 'off', 'aria-label': t('Name') });
    const addForm = h('form', { class: 'add-person' }, nameIn, h('button', { type: 'submit', class: 'btn btn-primary' }, t('Hinzufügen')));
    addForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const hadPairs = !!s.pairs;
      const err = addPerson(s, nameIn.value);
      if (err) return toast(err, 'error');
      if (hadPairs) toast(t('Die Liste hat sich geändert – bitte neu auslosen.'), 'info');
      change();
      body.querySelector('.add-person input')?.focus();
    });
    const list = h('ul', { class: 'people' }, s.people.map((p) => h('li', { class: 'person' },
      h('div', { class: 'person-main' }, h('span', { class: 'person-name' }, p.name)),
      h('div', { class: 'person-actions' },
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', 'aria-label': t('{name} entfernen', { name: p.name }),
          on: { click: () => { const had = !!s.pairs; removePerson(s, p.id); if (had) toast(t('Die Liste hat sich geändert – bitte neu auslosen.'), 'info'); change(); } } }, t('Entfernen'))))));

    // Lose
    const modeV = h('input', { type: 'radio', name: 'slipmode', value: 'verdeckt', checked: s.mode === 'verdeckt' });
    const modeH = h('input', { type: 'radio', name: 'slipmode', value: 'hut', checked: s.mode === 'hut' });
    [modeV, modeH].forEach((el) => el.addEventListener('change', () => { s.mode = el.value; change(); }));
    const enough = s.people.length >= 3;
    const pre = enough ? analogRoundPrecheck(s) : { ok: false, reason: t('Für Lose braucht es mindestens 3 Personen.') };
    const names = Object.fromEntries(s.people.map((p) => [p.id, p.name]));
    const opts = () => [h('option', { value: '' }, t('Person wählen')), ...s.people.map((p) => h('option', { value: p.id }, p.name))];
    const selA = h('select', { 'aria-label': t('Erste Person') }, opts());
    const selB = h('select', { 'aria-label': t('Zweite Person') }, opts());
    const exPart = s.mode === 'verdeckt'
      ? h('details', { class: 'inline-details', open: s.exclusions.length > 0 },
        h('summary', null, t('Paare ausschließen (optional)')),
        h('p', { class: 'hint' }, t('Zwei Personen, die sich nicht gegenseitig ziehen sollen – etwa Partner:innen.')),
        s.exclusions.length
          ? h('ul', { class: 'ex-list' }, s.exclusions.map(([a, b], i) => h('li', null, h('span', null, `${names[a]} ⇄ ${names[b]}`),
            h('button', { type: 'button', class: 'btn btn-small btn-ghost', on: { click: () => { s.exclusions.splice(i, 1); s.pairs = null; change(); } } }, t('Entfernen')))))
          : null,
        h('div', { class: 'ex-add' }, selA, selB, h('button', {
          type: 'button', class: 'btn btn-small',
          on: {
            click: () => {
              const [a, b] = [selA.value, selB.value];
              if (!a || !b || a === b) return toast(t('Bitte zwei verschiedene Personen wählen.'), 'error');
              if (s.exclusions.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return toast(t('Dieser Ausschluss besteht schon.'), 'error');
              s.exclusions.push([a, b]);
              s.pairs = null;
              change();
            },
          },
        }, t('Ausschließen'))))
      : null;

    const slipActions = s.mode === 'verdeckt'
      ? [
        !pre.ok ? notice(pre.reason, 'warn') : null,
        s.pairs
          ? notice(t('Ausgelost für {n} Personen. Die Zuordnung siehst du nicht – sie steht nur auf den gedruckten Losen.', { n: s.people.length }), 'ok')
          : null,
        h('div', { class: 'form-actions' },
          h('button', { type: 'button', class: s.pairs ? 'btn' : 'btn btn-primary', disabled: !pre.ok, on: { click: () => {
            if (s.pairs && !confirm(t('Neu auslosen? Bereits gedruckte Lose gelten dann nicht mehr.'))) return;
            try {
              const form = drawAnalogRound(s);
              toast(form === 'kreis' ? t('Ausgelost – alle bilden einen großen Kreis.') : t('Ausgelost. Ein Kreis war wegen der Ausschlüsse nicht möglich, es gibt freie Paare.'), 'ok');
              change();
            } catch (e) { toast(e.message, 'error'); }
          } } }, s.pairs ? t('Neu auslosen') : t('Auslosen')),
          h('button', { type: 'button', class: s.pairs ? 'btn btn-primary' : 'btn', disabled: !s.pairs, on: { click: () => print(slipsSheet(s)) } }, t('Lose drucken'))),
        h('p', { class: 'hint' }, t('Wer druckt und schneidet, könnte die Namen sehen. Am besten erledigt das jemand, der nicht mitwichtelt – oder du faltest die untere Klappe um, bevor du hinschaust. Die Lose bleiben bis zum Löschen in diesem Browser gespeichert, damit du sie nachdrucken kannst.')),
      ]
      : [
        !enough ? notice(pre.reason, 'warn') : null,
        h('div', { class: 'form-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', disabled: !enough, on: { click: () => print(slipsSheet(s)) } }, t('Namenszettel drucken'))),
      ];

    // Karten
    const designPick = h('div', { class: 'design-pick', role: 'radiogroup', 'aria-label': t('Design der Karten') },
      [['tanne', t('Tannenzweig')], ['sterne', t('Sterne')], ['schleife', t('Schleife')]].map(([v, label]) => {
        const r = h('input', { type: 'radio', name: 'design', value: v, checked: s.design === v });
        r.addEventListener('change', () => { s.design = v; change(); });
        return h('label', { class: ['design-option', s.design === v && 'is-selected'] }, r, cardDecor(v), h('span', null, label));
      }));
    const kindPick = h('div', { class: 'mode-pick', role: 'radiogroup', 'aria-label': t('Art der Karten') },
      [['einladung', t('Einladung')], ['erinnerung', t('Erinnerung')]].map(([v, label]) => {
        const r = h('input', { type: 'radio', name: 'cardkind', value: v, checked: s.cardKind === v });
        r.addEventListener('change', () => { s.cardKind = v; change(); });
        return h('label', { class: 'mode-option' }, r, h('span', null, h('strong', null, label)));
      }));

    add(body,
      card(t('Analoge Wichtelrunde'),
        h('p', null, t('Für Runden ganz ohne Handy: Namen eintragen, Lose, Spielregeln und auf Wunsch kleine Karten ausdrucken – fertig.')),
        h('p', { class: 'hint' }, t('Alles bleibt in diesem Browser. Der Server sieht keine Namen, Termine oder Lose; er zählt nur, dass eine Runde vorbereitet wurde. Gespeichert wird bis „Alles löschen“ – auch über einen Neustart des Browsers hinweg.')),
        storageOk ? null : notice(t('Dieser Browser speichert nichts (z. B. privater Modus). Deine Eingaben sind beim Schließen weg.'), 'warn')),
      card(t('Eckdaten'),
        field(t('Titel'), title),
        field(t('Datum'), date),
        field(t('Ort (optional)'), place),
        h('div', { class: 'field' }, h('label', { for: 'analog-budget' }, t('Betragslimit (optional)')),
          h('div', { class: 'input-suffix' }, Object.assign(budget, { id: 'analog-budget' }), h('span', null, '€'))),
        field(t('Notiz für Regeln und Karten (optional)'), note)),
      card(t('Wer macht mit?'),
        h('p', { class: 'hint' }, t('{n} von höchstens {max} Personen.', { n: s.people.length, max: ANALOG_ROUND_LIMITS.people })),
        list, addForm),
      card(t('Lose'),
        h('div', { class: 'mode-pick', role: 'radiogroup', 'aria-label': t('Art der Lose') },
          h('label', { class: 'mode-option' }, modeV, h('span', null, h('strong', null, t('Verdeckt vorgelost')),
            h('small', null, t('Die App lost aus. Auf jedem Los steht außen, für wen es ist, innen verdeckt, wen diese Person beschenkt. Niemand zieht sich selbst.')))),
          h('label', { class: 'mode-option' }, modeH, h('span', null, h('strong', null, t('Klassisch aus dem Hut')),
            h('small', null, t('Ein Zettel je Name zum Falten. Gezogen wird vor Ort; die Regeln erklären, was passiert, wenn jemand sich selbst zieht.'))))),
        exPart,
        ...slipActions),
      card(t('Spielregeln'),
        h('p', null, t('Eine Seite mit Eckdaten, Notiz und den Regeln passend zur Art der Lose.')),
        h('div', { class: 'form-actions' },
          h('button', { type: 'button', class: 'btn', disabled: !s.people.length, on: { click: () => print(rulesSheet(s)) } }, t('Spielregeln drucken')))),
      card(t('Karten (optional)'),
        h('p', null, t('Kleine Karten für alle auf der Liste, vier pro Seite.')),
        kindPick, designPick,
        h('div', { class: 'form-actions' },
          h('button', { type: 'button', class: 'btn', disabled: !s.people.length, on: { click: () => print(cardsSheet(s)) } }, t('Karten drucken')))),
      card(t('Fertig?'),
        h('p', null, t('Wenn alles gedruckt ist, lösch die Daten aus diesem Browser.')),
        actionButton(t('Alles löschen'), () => {
          if (!confirm(t('Alle Eingaben und Lose aus diesem Browser löschen?'))) return;
          clearAnalogRound();
          s = emptyAnalogRound();
          toast(t('Gelöscht.'), 'ok');
          render();
        }, { cls: 'btn btn-danger' })),
    );
  };
  render();
  mount(root, page(h('h1', null, t('Analoge Wichtelrunde')), body));
}
