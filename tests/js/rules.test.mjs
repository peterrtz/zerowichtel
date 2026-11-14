import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, ACTIONS, fromPreset, normalizeRules, actionFor, describe, rollDice, faces, durationLabel } from '../../public/js/lib/rules.js';

test('Alle Vorlagen sind gültig und unverändert normalisierbar', () => {
  for (const key of Object.keys(PRESETS)) {
    const r = fromPreset(key);
    const n = normalizeRules(r);
    assert.equal(n.preset, key);
    assert.deepEqual(n.phases, r.phases.map((p) => ({ ...p, actions: Object.fromEntries(Object.entries(p.actions).map(([f, a]) => [String(f), a])) })));
  }
  const k = fromPreset('klassisch');
  assert.equal(k.phases[0].minutes, null);
  assert.equal(k.phases[1].minutes, 10);
  assert.equal(actionFor(k.phases[0], 6).id, 'take_center');
  assert.equal(actionFor(k.phases[0], 5), null);
});

test('Unbekannte Vorlage fällt auf klassisch zurück, Vorlagen sind unabhängige Kopien', () => {
  assert.equal(fromPreset('gibtsnicht').preset, 'klassisch');
  const a = fromPreset('klassisch');
  a.phases[0].name = 'geändert';
  assert.equal(fromPreset('klassisch').phases[0].name, 'Einsammeln');
});

test('Validierung: Phasen, Dauer, Aktionen, Augenzahlen', () => {
  assert.throws(() => normalizeRules({ phases: [] }), /Mindestens eine Spielphase/);
  assert.throws(() => normalizeRules({ phases: Array(5).fill({ name: 'x', actions: { 6: 'steal' } }) }), /Höchstens 4/);
  assert.throws(() => normalizeRules({ phases: [{ name: 'x', minutes: 0, actions: { 6: 'steal' } }] }), /Dauer/);
  assert.throws(() => normalizeRules({ phases: [{ name: 'x', minutes: 2.5, actions: { 6: 'steal' } }] }), /Dauer/);
  assert.throws(() => normalizeRules({ phases: [{ name: 'x', actions: { 6: 'tanzen' } }] }), /Aktion/);
  // Augenzahl 7 gibt es bei einem Würfel nicht → verworfen
  const r = normalizeRules({ dice: 1, phases: [{ name: 'A', actions: { 7: 'steal', 6: 'take_center' } }] });
  assert.deepEqual(r.phases[0].actions, { 6: 'take_center' });
  // bei zwei Würfeln gibt es 2 … 12
  const r2 = normalizeRules({ dice: 2, phases: [{ name: 'A', minutes: '5', actions: { 12: 'steal', 1: 'skip' } }] });
  assert.deepEqual(r2.phases[0].actions, { 12: 'steal' });
  assert.equal(r2.phases[0].minutes, 5);
  assert.equal(r2.preset, 'eigene');
});

test('Namen werden bereinigt und gekürzt, Steuerzeichen entfernt', () => {
  const r = normalizeRules({ phases: [{ name: '  Ein\u0007sammeln ' + 'x'.repeat(50), actions: { 6: 'steal' } }, { name: '', actions: { 6: 'steal' } }] });
  assert.equal(r.phases[0].name.length, 30);
  assert.ok(!r.phases[0].name.includes('\u0007'));
  assert.equal(r.phases[1].name, 'Phase 2');
});

test('Beschreibung und Dauer-Text', () => {
  const lines = describe(fromPreset('klassisch'));
  assert.equal(lines[0], 'Ein Würfel.');
  assert.match(lines[1], /Phase 1 – Einsammeln \(bis die Mitte leer ist\): 6: Päckchen aus der Mitte nehmen/);
  assert.match(lines[2], /10 Minuten/);
  assert.match(lines.at(-1), /packen alle/);
  assert.equal(durationLabel({ minutes: 1 }), '1 Minute');
  assert.deepEqual(faces(2), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(Object.keys(ACTIONS).length, 9);
});

test('Würfel: Wertebereich und Gleichverteilung (Chi-Quadrat)', () => {
  const c = new Array(7).fill(0);
  const N = 60000;
  for (let i = 0; i < N; i++) c[rollDice(1)[0]]++;
  assert.equal(c[0], 0);
  const exp = N / 6;
  const chi2 = c.slice(1).reduce((s, x) => s + (x - exp) ** 2 / exp, 0);
  assert.ok(chi2 < 20.5, `chi² = ${chi2.toFixed(1)}`); // 5 FG, 99,9 %
  const two = rollDice(2);
  assert.equal(two.length, 2);
  assert.ok(two.every((x) => x >= 1 && x <= 6));
});
