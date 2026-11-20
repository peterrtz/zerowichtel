// 2.12: Geschenkvorschläge pflegbar – Prüfung auf dem Server, defensives Lesen und Zusammenführen in der App.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdeas, IdeasError, IDEA_LIMITS } from '../../server/ideas.mjs';
import { IDEAS, readIdeas, buildClasses, ideasFor, rollIdea } from '../../public/js/lib/ideas.js';

const builtin = IDEAS.flatMap(([, l]) => l).length;

test('Server: Modus, Preisklassen, Texte, Grenzen', () => {
  assert.deepEqual(normalizeIdeas({}), { mode: 'builtin', items: [] });
  assert.deepEqual(normalizeIdeas({ mode: 'extend', items: [{ max: 5, de: '  Kerze  ', en: '' }, { de: 'Reise' }] }),
    { mode: 'extend', items: [{ max: 5, de: 'Kerze', en: '' }, { max: null, de: 'Reise', en: '' }] });
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
  assert.deepEqual(Object.keys(r.items[1]).sort(), ['de', 'en', 'max']);
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
