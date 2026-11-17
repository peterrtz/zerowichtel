// 2.7: Analoge Wichtelrunde – Bereinigung, lokale Ablage, Personen, Ziehung, Lose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyAnalogRound, normalizeAnalogRound, loadAnalogRound, saveAnalogRound, clearAnalogRound, ANALOG_ROUND_KEY,
  addPerson, removePerson, analogRoundPrecheck, drawAnalogRound, hiddenSlips, ANALOG_ROUND_LIMITS,
} from '../../public/js/lib/analog-round.js';
import { isSingleCycle } from '../../public/js/lib/draw.js';

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const withPeople = (...names) => {
  const s = emptyAnalogRound();
  for (const n of names) assert.equal(addPerson(s, n), null);
  return s;
};

test('Bereinigung: Längen, Steuerzeichen, Datum, Betrag, unbekannte Werte', () => {
  const s = normalizeAnalogRound({
    title: 'x'.repeat(200), date: '24.12.2026', place: ' Bei\nOma ', budget: '25.6', note: 'a\u0007b',
    people: [{ id: 'a1', name: ' Erna ' }, { id: 'a1', name: 'Doppelt' }, { id: '<b>', name: 'Ohne gültige ID' }, { name: '' }],
    exclusions: [['a1', 'a1'], ['a1', 'fremd']], mode: 'quatsch', design: 'tanne', cardKind: 'erinnerung', counted: 'ja',
  });
  assert.equal(s.title.length, ANALOG_ROUND_LIMITS.title);
  assert.equal(s.date, '');
  assert.equal(s.place, 'Bei Oma');
  assert.equal(s.budget, 26);
  assert.equal(s.note, 'ab');
  assert.deepEqual(s.people.map((p) => p.name), ['Erna', 'Ohne gültige ID']);
  assert.match(s.people[1].id, /^[a-z0-9]{1,12}$/);
  assert.deepEqual(s.exclusions, []);
  assert.equal(s.mode, 'verdeckt');
  assert.equal(s.cardKind, 'erinnerung');
  assert.equal(s.counted, false);
  assert.equal(normalizeAnalogRound({ budget: '' }).budget, null);
  assert.equal(normalizeAnalogRound({ budget: 99999 }).budget, ANALOG_ROUND_LIMITS.budgetMax);
  assert.deepEqual(normalizeAnalogRound('kaputt'), emptyAnalogRound());
});

test('Lokale Ablage: speichern, laden, löschen; kaputter Inhalt und gesperrter Speicher', () => {
  const st = memStore();
  const s = withPeople('Erna', 'Peter', 'Bea');
  s.title = 'Familie';
  assert.equal(saveAnalogRound(s, st), true);
  const back = loadAnalogRound(st);
  assert.equal(back.title, 'Familie');
  assert.deepEqual(back.people, s.people);
  clearAnalogRound(st);
  assert.equal(st.getItem(ANALOG_ROUND_KEY), null);
  st.setItem(ANALOG_ROUND_KEY, '{kaputt');
  assert.deepEqual(loadAnalogRound(st), emptyAnalogRound());
  const blocked = { getItem: () => { throw new Error('gesperrt'); }, setItem: () => { throw new Error('gesperrt'); }, removeItem: () => { throw new Error('gesperrt'); } };
  assert.equal(saveAnalogRound(s, blocked), false);
  assert.deepEqual(loadAnalogRound(blocked), emptyAnalogRound());
  clearAnalogRound(blocked);
});

test('Personen: leer, doppelt (ohne Groß-/Kleinschreibung), Höchstzahl; Änderung verwirft Lose', () => {
  const s = withPeople('Erna', 'Peter', 'Bea');
  assert.match(addPerson(s, '  '), /Namen/);
  assert.match(addPerson(s, 'erna'), /schon auf der Liste/);
  drawAnalogRound(s);
  assert.ok(s.pairs);
  assert.equal(addPerson(s, 'Cem'), null);
  assert.equal(s.pairs, null, 'neue Person → neu auslosen');
  drawAnalogRound(s);
  const cem = s.people.find((p) => p.name === 'Cem').id;
  s.exclusions.push([cem, s.people[0].id]);
  removePerson(s, cem);
  assert.equal(s.pairs, null);
  assert.deepEqual(s.exclusions, [], 'Ausschlüsse der entfernten Person weg');
  const full = emptyAnalogRound();
  for (let i = 0; i < ANALOG_ROUND_LIMITS.people; i++) assert.equal(addPerson(full, `P${i}`), null);
  assert.match(addPerson(full, 'Zu viel'), /Höchstens/);
});

test('Verdeckte Lose: niemand zieht sich selbst, Ausschlüsse gelten, ein Kreis; gespeicherte Lose bleiben gültig', () => {
  const s = withPeople('Erna', 'Peter', 'Bea', 'Cem', 'Dan', 'Eva');
  const [erna, peter] = s.people.map((p) => p.id);
  s.exclusions.push([erna, peter]);
  assert.equal(analogRoundPrecheck(s).ok, true);
  for (let k = 0; k < 2000; k++) {
    drawAnalogRound(s);
    assert.ok(isSingleCycle(s.pairs));
    for (const [g, r] of s.pairs) {
      assert.notEqual(g, r);
      assert.ok(!((g === erna && r === peter) || (g === peter && r === erna)));
    }
  }
  const slips = hiddenSlips(s);
  assert.deepEqual(slips.map((x) => x.giver), s.people.map((p) => p.name), 'Reihenfolge wie die Namensliste');
  assert.equal(new Set(slips.map((x) => x.receiver)).size, 6);
  // nach Speichern und Laden gleich
  const st = memStore();
  saveAnalogRound(s, st);
  assert.deepEqual(loadAnalogRound(st).pairs, s.pairs);
  // manipulierte Lose (jemand beschenkt sich selbst) werden beim Laden verworfen
  const bad = JSON.parse(st.getItem(ANALOG_ROUND_KEY));
  bad.pairs[0][1] = bad.pairs[0][0];
  assert.equal(normalizeAnalogRound(bad).pairs, null);
});

test('Vorprüfung: zu wenige Personen und unmögliche Ausschlüsse', () => {
  assert.equal(analogRoundPrecheck(withPeople('A', 'B')).ok, false);
  const s = withPeople('A', 'B', 'C');
  const [a, b, c] = s.people.map((p) => p.id);
  s.exclusions.push([a, b], [a, c]);
  const r = analogRoundPrecheck(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /A darf niemanden beschenken/);
});
