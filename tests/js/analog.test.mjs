// 2.6: Ohne Smartphone mitwichteln – Grenze, Vorprüfung, Ausschlüsse, Ziehung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analogLimit, normalizeAnalog, analogPairs, manualExclusions, mergeExclusions, analogChoices, analogPrecheck,
} from '../../public/js/lib/analog.js';
import { draw, verify, isSingleCycle } from '../../public/js/lib/draw.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);

test('Grenze ⌊(n − 2) / 3⌋ wie in docs/KONZEPT-ANALOG.md', () => {
  const want = { 2: 0, 3: 0, 4: 0, 5: 1, 6: 1, 7: 1, 8: 2, 9: 2, 10: 2, 11: 3, 13: 3, 14: 4, 20: 6, 30: 9, 50: 16 };
  for (const [n, k] of Object.entries(want)) assert.equal(analogLimit(Number(n)), k, `n=${n}`);
  assert.equal(analogLimit(0), 0);
});

test('Bereinigung: unbekannte Personen, doppelte Einträge, Name der externen Helfer:in begrenzt', () => {
  const r = normalizeAnalog([
    { pid: 'p0', helper: 'p1' },
    { pid: 'p0', helper: 'p2' },
    { pid: 'weg', helper: 'p1' },
    { pid: 'p3', helper: null, helperName: '  ' + 'x'.repeat(60) },
    null, 'kaputt', { helper: 'p1' },
  ], ids(5));
  assert.deepEqual(r, [{ pid: 'p0', helper: 'p1' }, { pid: 'p3', helper: null, helperName: 'x'.repeat(40) }]);
  assert.deepEqual(normalizeAnalog(undefined, ids(3)), []);
});

test('Ausschlüsse: Paare ergänzt, ohne Doppelungen, in der Anzeige getrennt', () => {
  const analog = [{ pid: 'p0', helper: 'p1' }, { pid: 'p2', helper: null, helperName: 'Inge' }];
  assert.deepEqual(analogPairs(analog), [['p0', 'p1']]);
  const merged = mergeExclusions([['p3', 'p4'], ['p1', 'p0']], analog);
  assert.deepEqual(merged, [['p3', 'p4'], ['p1', 'p0']]);
  assert.deepEqual(mergeExclusions([['p3', 'p4']], analog), [['p3', 'p4'], ['p0', 'p1']]);
  assert.deepEqual(manualExclusions([['p3', 'p4'], ['p1', 'p0']], analog), [['p3', 'p4']]);
});

test('Auswahl: analoge Personen und Helfer:innen nur einmal', () => {
  const c = analogChoices([{ pid: 'p0', helper: 'p1' }]);
  assert.equal(c.analogOk('p0'), false);
  assert.equal(c.analogOk('p1'), false);
  assert.equal(c.analogOk('p2'), true);
  assert.equal(c.helperOk('p1', 'p2'), false);
  assert.equal(c.helperOk('p0', 'p2'), false);
  assert.equal(c.helperOk('p2', 'p2'), false);
  assert.equal(c.helperOk('p3', 'p2'), true);
});

test('Vorprüfung: Grenze, externe zählen nicht, Helfer:in fehlt, doppelt, selbst analog, Team-Modus', () => {
  const names = { p0: 'Erna', p1: 'Peter', p2: 'Inge', p3: 'Max', p4: 'Lea', p5: 'Tom', p6: 'Ida', p7: 'Ben' };
  // n = 4: kein Paar mit mitwichtelnder Helfer:in, aber externe Helfer:in geht
  assert.equal(analogPrecheck([{ pid: 'p0', helper: 'p1' }], ids(4), names).ok, false);
  assert.match(analogPrecheck([{ pid: 'p0', helper: 'p1' }], ids(4), names).reason, /nicht mitwichtelt/);
  assert.equal(analogPrecheck([{ pid: 'p0', helper: null, helperName: 'Oma' }], ids(4), names).ok, true);
  // n = 5: eins ja, zwei nein; externe zusätzlich egal
  assert.equal(analogPrecheck([{ pid: 'p0', helper: 'p1' }, { pid: 'p2', helper: null }, { pid: 'p3', helper: null }], ids(5), names).ok, true);
  const two = analogPrecheck([{ pid: 'p0', helper: 'p1' }, { pid: 'p2', helper: 'p3' }], ids(5), names);
  assert.equal(two.ok, false);
  assert.match(two.reason, /höchstens 1/);
  // n = 8: zwei ja
  assert.equal(analogPrecheck([{ pid: 'p0', helper: 'p1' }, { pid: 'p2', helper: 'p3' }], ids(8), names).ok, true);
  // Helfer:in nicht dabei (abgesagt / entfernt) → gesperrt
  const gone = analogPrecheck([{ pid: 'p0', helper: 'p7' }], ids(6), names);
  assert.equal(gone.ok, false);
  assert.match(gone.reason, /Ben hilft Erna, ist aber nicht dabei/);
  // analoge Person selbst nicht dabei → zählt nicht, kein Fehler
  assert.equal(analogPrecheck([{ pid: 'p7', helper: 'p1' }], ids(5), names).ok, true);
  // doppelt Helfer:in
  assert.match(analogPrecheck([{ pid: 'p0', helper: 'p1' }, { pid: 'p2', helper: 'p1' }], ids(20), names).reason, /schon Helfer:in für Erna/);
  // Helfer:in ist selbst analog
  assert.match(analogPrecheck([{ pid: 'p0', helper: 'p1' }, { pid: 'p1', helper: null }], ids(20), names).reason, /selbst ohne Smartphone/);
  // Team-Modus
  assert.equal(analogPrecheck([{ pid: 'p0', helper: null }], ids(8), names, { teams: true }).ok, false);
  assert.equal(analogPrecheck([], ids(8), names, { teams: true }).ok, true);
});

test('Ziehung: analoge Person und Helfer:in ziehen sich nie gegenseitig (10 000 Ziehungen je Größe)', () => {
  for (const n of [5, 8, 11, 20]) {
    const people = ids(n);
    const analog = Array.from({ length: analogLimit(n) }, (_, i) => ({ pid: `p${2 * i}`, helper: `p${2 * i + 1}` }));
    assert.equal(analogPrecheck(analog, people).ok, true);
    const ex = mergeExclusions([], analog);
    let kreis = 0;
    for (let k = 0; k < 10000; k++) {
      const r = draw(people, [], ex);
      assert.ok(verify(people, r.pairs, [], ex));
      for (const [a, b] of analogPairs(analog)) {
        assert.ok(!r.pairs.some(([g, rc]) => (g === a && rc === b) || (g === b && rc === a)), `n=${n}: ${a} ↔ ${b}`);
      }
      if (isSingleCycle(r.pairs)) kreis++;
    }
    assert.equal(kreis, 10000, `n=${n}: immer ein einziger Kreis`);
  }
});
