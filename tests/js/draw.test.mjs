import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, verify, isSingleCycle, precheck, cryptoRandomInt, shuffle } from '../../public/js/lib/draw.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `P${i}`);

// Deterministischer Zufall für reproduzierbare Grenzfall-Tests
function seeded(seed) {
  let s = seed >>> 0;
  return (n) => { s = (s * 1664525 + 1013904223) >>> 0; return s % n; };
}

test('cryptoRandomInt: Bereich und grobe Gleichverteilung', () => {
  const c = new Array(6).fill(0);
  for (let i = 0; i < 60000; i++) c[cryptoRandomInt(6)]++;
  for (const x of c) assert.ok(x > 9300 && x < 10700, `Häufigkeit ${x}`);
  assert.throws(() => cryptoRandomInt(0));
});

test('Ohne Regeln: immer ein gültiger Kreis, für n = 3 … 50', () => {
  for (let n = 3; n <= 50; n++) {
    const r = draw(ids(n));
    assert.equal(r.form, 'kreis');
    assert.ok(verify(ids(n), r.pairs));
    assert.ok(isSingleCycle(r.pairs));
  }
});

test('Untergruppen und Ausschlüsse werden eingehalten', () => {
  const p = ids(10);
  const groups = [{ name: 'Familie A', members: ['P0', 'P1', 'P2'] }, { name: 'Familie B', members: ['P3', 'P4'] }];
  const ex = [['P5', 'P6'], ['P7', 'P8']];
  for (let i = 0; i < 300; i++) {
    const r = draw(p, groups, ex);
    assert.ok(verify(p, r.pairs, groups, ex));
    assert.ok(isSingleCycle(r.pairs));
    for (const [g, rc] of r.pairs) {
      assert.ok(!(groups[0].members.includes(g) && groups[0].members.includes(rc)));
      assert.ok(!['P5,P6', 'P6,P5', 'P7,P8', 'P8,P7'].includes(`${g},${rc}`));
    }
  }
});

test('Untergruppe genau n/2 ist möglich, mehr nicht', () => {
  const p = ids(6);
  const half = [{ name: 'H', members: ['P0', 'P1', 'P2'] }];
  const r = draw(p, half);
  assert.ok(verify(p, r.pairs, half));
  const tooBig = [{ name: 'Zu groß', members: ['P0', 'P1', 'P2', 'P3'] }];
  const pre = precheck(p, tooBig);
  assert.equal(pre.ok, false);
  assert.match(pre.reason, /Zu groß.*4 von 6/);
  assert.throws(() => draw(p, tooBig), /höchstens die Hälfte/);
});

test('Weniger als 3 Zusagen und isolierte Person werden erkannt', () => {
  assert.match(precheck(ids(2)).reason, /mindestens 3/);
  const p = ids(3);
  const ex = [['P0', 'P1'], ['P0', 'P2']];
  const pre = precheck(p, [], ex, { P0: 'Opa' });
  assert.equal(pre.ok, false);
  assert.match(pre.reason, /Opa/);
});

test('Kein Kreis möglich → Rückfall auf freie Zuordnung', () => {
  // 4 Personen, Ausschlüsse lassen nur die Paare (P0↔P1) und (P2↔P3) zu → nur Paartausch möglich
  const p = ids(4);
  const ex = [['P0', 'P2'], ['P0', 'P3'], ['P1', 'P2'], ['P1', 'P3']];
  const r = draw(p, [], ex, { rnd: seeded(1) });
  assert.equal(r.form, 'frei');
  assert.ok(verify(p, r.pairs, [], ex));
  assert.ok(!isSingleCycle(r.pairs));
});

test('Völlig unmögliche Konstellation → verständlicher Fehler', () => {
  // 3 Personen: jede darf nur eine bestimmte, aber nicht zyklisch auflösbar
  const p = ids(3);
  const ex = [['P0', 'P1']];
  // P0 darf nur P2, P1 nur P2 → beide wollen P2
  assert.throws(() => draw(p, [], ex), /keine Ziehung möglich/);
});

test('Viele Ausschlüsse: Suche findet Kreis, wo Zurückweisung scheitert', () => {
  // Erlaubt ist nur der Kreis P0→P1→…→P9→P0 und seine Umkehrung (dünner Graph)
  const p = ids(10);
  const ex = [];
  for (let i = 0; i < 10; i++) {
    for (let j = i + 1; j < 10; j++) {
      const d = Math.min((j - i + 10) % 10, (i - j + 10) % 10);
      if (d !== 1) ex.push([p[i], p[j]]);
    }
  }
  const r = draw(p, [], ex);
  assert.equal(r.form, 'kreis');
  assert.ok(verify(p, r.pairs, [], ex));
});

test('Verteilung: bei 5 Personen sind alle 24 Kreise etwa gleich häufig (Chi-Quadrat)', () => {
  const p = ids(5);
  const counts = new Map();
  const N = 24000;
  for (let i = 0; i < N; i++) {
    const { pairs } = draw(p);
    // Kreis kanonisch: Nachfolger von P0, P1, … als Schlüssel
    const next = new Map(pairs);
    const key = p.map((x) => next.get(x)).join(',');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.equal(counts.size, 24);
  const exp = N / 24;
  const chi2 = [...counts.values()].reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
  // 23 Freiheitsgrade, 99,9 %-Quantil ≈ 49,7
  assert.ok(chi2 < 49.7, `chi² = ${chi2.toFixed(1)}`);
});

test('shuffle verändert das Original nicht', () => {
  const a = [1, 2, 3, 4];
  shuffle(a);
  assert.deepEqual(a, [1, 2, 3, 4]);
});
