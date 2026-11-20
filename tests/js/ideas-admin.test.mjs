// 2.12: Geschenkvorschläge pflegbar – Prüfung auf dem Server, defensives Lesen und Zusammenführen in der App.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdeas, IdeasError, IDEA_LIMITS } from '../../server/ideas.mjs';
import { IDEAS, ADVENT, readIdeas, buildClasses, ideasFor, rollIdea, rollIdeaItem, readAges, fitsAge, AGE_GROUPS } from '../../public/js/lib/ideas.js';

const builtin = IDEAS.flatMap(([, l]) => l).length;

test('Server: Modus, Preisklassen, Texte, Grenzen', () => {
  assert.deepEqual(normalizeIdeas({}), { mode: 'builtin', items: [] });
  assert.deepEqual(normalizeIdeas({ mode: 'extend', items: [{ max: 5, de: '  Kerze  ', en: '' }, { de: 'Reise' }] }),
    { mode: 'extend', items: [{ max: 5, de: 'Kerze', en: '', minAge: 0, maxAge: null }, { max: null, de: 'Reise', en: '', minAge: 0, maxAge: null }] });
  for (const [bad, why] of [
    [null, 'kein Objekt'], [[], 'Liste statt Objekt'], [{ mode: 'alles' }, 'Modus'], [{ mode: 'extend', items: 'x' }, 'items kein Array'],
    [{ mode: 'extend', items: [{ max: 7, de: 'x' }] }, 'Preisklasse'], [{ mode: 'extend', items: [{ max: Infinity, de: 'x' }] }, 'Infinity'],
    [{ mode: 'extend', items: [{ max: 5, de: '' }] }, 'deutsch leer'], [{ mode: 'extend', items: [{ max: 5, de: 'a\u0007' }] }, 'Steuerzeichen'],
    [{ mode: 'extend', items: [{ max: 5, de: 'x'.repeat(IDEA_LIMITS.text + 1) }] }, 'zu lang'], [{ mode: 'extend', items: [{ max: 5, de: 'x', en: 5 }] }, 'en kein Text'],
    [{ mode: 'extend', items: Array.from({ length: IDEA_LIMITS.items + 1 }, () => ({ max: 5, de: 'x' })) }, 'zu viele'],
    [{ mode: 'replace', items: [] }, 'leere eigene Liste'], [{ mode: 'extend', items: [null] }, 'Eintrag null'],
  ]) assert.throws(() => normalizeIdeas(bad), IdeasError, why);
  assert.doesNotThrow(() => normalizeIdeas({ mode: 'extend', items: [{ max: 5, de: '🎁'.repeat(IDEA_LIMITS.text) }] }), 'Zeichen, nicht Bytes');
});

test('App: readIdeas liest defensiv, Standardliste bei Unbrauchbarem', () => {
  assert.equal(readIdeas(null), null);
  assert.equal(readIdeas({ mode: 'builtin', items: [] }), null);
  assert.equal(readIdeas({ mode: 'replace', items: [{ max: 7, de: 'x' }] }), null, 'nichts Brauchbares → Standard');
  const r = readIdeas({ mode: 'extend', items: [{ max: null, de: 'a'.repeat(300), en: 3 }, { max: 5, de: '' }, { max: 10, de: 'Tee', en: 'Tea', url: 'javascript:x' }] });
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].max, Infinity);
  assert.equal(r.items[0].de.length, 120);
  assert.equal(r.items[0].en, '');
  assert.deepEqual(Object.keys(r.items[1]).sort(), ['de', 'en', 'max', 'maxAge', 'minAge']);
});

test('Zusammenführen: ergänzen hängt an, ersetzen nimmt nur eigene; Betragslimit gilt weiter', () => {
  assert.equal(ideasFor(null, buildClasses()).length, builtin, 'ohne Quelle = Standard');
  const ext = buildClasses(readIdeas({ mode: 'extend', items: [{ max: 5, de: 'Kerze' }, { max: 50, de: 'Konzert' }] }));
  assert.equal(ideasFor(null, ext).length, builtin + 2);
  assert.ok(ideasFor(5, ext).some(([de]) => de === 'Kerze'));
  assert.ok(!ideasFor(5, ext).some(([de]) => de === 'Konzert'), '50-€-Idee nicht bei 5 €');
  const rep = buildClasses(readIdeas({ mode: 'replace', items: [{ max: 10, de: 'Tee', en: 'Tea' }, { max: null, de: 'Reise' }] }));
  assert.deepEqual(ideasFor(null, rep).map(([de]) => de), ['Tee', 'Reise']);
  assert.deepEqual(ideasFor(5, rep), [], 'bei 5 € passt die Klasse „bis 10 €“ nicht');
  assert.deepEqual(ideasFor(8, rep).map(([de]) => de), ['Tee'], 'ab einem Limit über 5 € schon');
  assert.equal(rollIdea(3, null, () => 0, buildClasses(readIdeas({ mode: 'replace', items: [{ max: 50, de: 'Teuer' }] }))), null, 'nichts passt → null');
  assert.equal(rollIdea(20, null, () => 0, rep), 'Tee');
});

test('Alter: Server prüft Mindest- und Höchstalter', () => {
  assert.deepEqual(normalizeIdeas({ mode: 'extend', items: [{ max: 5, de: 'Glühwein-Gewürz', minAge: 18 }] }).items[0], { max: 5, de: 'Glühwein-Gewürz', en: '', minAge: 18, maxAge: null });
  assert.deepEqual(normalizeIdeas({ mode: 'extend', items: [{ max: 5, de: 'Knete', minAge: 3, maxAge: 10 }] }).items[0].maxAge, 10);
  for (const [it, why] of [[{ minAge: -1 }, 'negativ'], [{ minAge: 100 }, 'über 99'], [{ minAge: 1.5 }, 'keine ganze Zahl'], [{ minAge: '18' }, 'Text'],
    [{ minAge: 10, maxAge: 8 }, 'Höchstalter unter Mindestalter'], [{ maxAge: 120 }, 'Höchstalter über 99']]) {
    assert.throws(() => normalizeIdeas({ mode: 'extend', items: [{ max: 5, de: 'x', ...it }] }), IdeasError, why);
  }
});

test('Alter: App liest defensiv, Mindestalter streng, Höchstalter als Empfehlung', () => {
  assert.deepEqual(readAges(18, null), { minAge: 18, maxAge: null });
  assert.deepEqual(readAges('18', 5), { minAge: 0, maxAge: 5 });
  assert.deepEqual(readAges(10, 8), { minAge: 10, maxAge: null }, 'Höchstalter unter Mindestalter fällt weg');
  const groups = Object.fromEntries(AGE_GROUPS.map(([k, , v]) => [k, v]));
  assert.equal(fitsAge(['Messer', '', 18, null], groups.erwachsen), true);
  assert.equal(fitsAge(['Messer', '', 18, null], groups.jugend), false);
  assert.equal(fitsAge(['Messer', '', 18, null], groups.egal), true, 'egal: alles, mit Altershinweis');
  assert.equal(fitsAge(['Knete', '', 3, 10], groups.kind), true);
  assert.equal(fitsAge(['Knete', '', 3, 10], groups.erwachsen), false);
  assert.equal(fitsAge(['Spiel', '', 10, null], groups.kind), false, 'ab 10 nicht für die Gruppe ab 6');
  // Würfel mit Alter, auch für eigene Listen
  const own = buildClasses(readIdeas({ mode: 'replace', items: [{ max: 10, de: 'Wein-Zubehör', minAge: 18 }, { max: 10, de: 'Malbuch', minAge: 3, maxAge: 9 }] }));
  assert.equal(rollIdea(20, null, () => 0, own, 6), 'Malbuch');
  assert.equal(rollIdea(20, null, () => 0, own, 18), 'Wein-Zubehör');
  assert.equal(rollIdea(20, null, () => 0, own, 13), null, 'nichts für 13');
  assert.deepEqual(rollIdeaItem(20, null, () => 0, own, 6), { text: 'Malbuch', minAge: 3, maxAge: 9 });
  // Standardliste: für jede Altersgruppe und jedes Limit ab 10 € gibt es etwas
  for (const [, , g] of AGE_GROUPS) for (const b of [10, 20, 30, 50, null]) assert.ok(rollIdea(b, null, () => 0, buildClasses(), g), `Gruppe ${g}, Limit ${b}`);
});

test('Standardliste: kein Alkohol, jeder Eintrag mit Altersangabe', () => {
  const ALC = /wein|bier|sekt|likör|schnaps|alkohol|\bgin\b|\brum\b|whisk|wodka|vodka|prosecco|champagner|cocktail|spirituose|wine|beer|liquor|spirits|alcohol/i;
  for (const [, list] of IDEAS) {
    for (const e of list) {
      assert.ok(!ALC.test(`${e[0]} ${e[1]}`), `Alkohol in: ${e[0]}`);
      assert.ok(Number.isInteger(e[2]) && e[2] >= 0 && e[2] <= 18, `Mindestalter: ${e[0]}`);
      assert.ok(e[3] === null || (Number.isInteger(e[3]) && e[3] >= e[2]), `Höchstalter: ${e[0]}`);
    }
  }
  for (const tip of ADVENT) assert.ok(!ALC.test(tip.join(' ')), `Alkohol im Adventstipp: ${tip[0]}`);
});
