import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, newKey } from '../../public/js/lib/crypto.js';
import { buildLink, buildFragment, parseFragment } from '../../public/js/lib/links.js';
import { parse, parseInline, toPlain } from '../../public/js/lib/markdown.js';

test('Links: Aufbau und Zerlegung', () => {
  const d = { roundId: newId(), pid: newId(), accessToken: newId(), kRound: newKey(), secret: newKey() };
  const link = buildLink('https://wichteln.example.org/', 'p', d);
  assert.ok(link.startsWith('https://wichteln.example.org/#p/'));
  const parsed = parseFragment(new URL(link).hash);
  assert.deepEqual(parsed, { kind: 'p', ...d });
  const a = { roundId: newId(), adminToken: newId(), kRound: newKey(), kAdmin: newKey() };
  assert.deepEqual(parseFragment(buildFragment('a', a)), { kind: 'a', ...a });
});

test('Links: ungültige Fragmente', () => {
  assert.equal(parseFragment(''), null);
  assert.equal(parseFragment('#x/1/2'), null);
  assert.equal(parseFragment(`#i/${newId()}/${newId()}/${newId()}`), null); // Schlüssel fehlt
  assert.equal(parseFragment(`#i/${newId()}/${newId()}/${newId()}/${newId()}`), null); // Schlüssel zu kurz
  assert.throws(() => buildFragment('a', { roundId: 'x' }));
});

test('Markdown-light: Inline-Formate', () => {
  assert.deepEqual(parseInline('a **b** c'), [
    { t: 'text', v: 'a ' }, { t: 'b', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' },
  ]);
  assert.deepEqual(parseInline('*k* ++u++'), [
    { t: 'i', c: [{ t: 'text', v: 'k' }] }, { t: 'text', v: ' ' }, { t: 'u', c: [{ t: 'text', v: 'u' }] },
  ]);
  assert.deepEqual(parseInline('**fett *kursiv***'), [
    { t: 'b', c: [{ t: 'text', v: 'fett ' }, { t: 'i', c: [{ t: 'text', v: 'kursiv' }] }] },
  ]);
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ t: 'text', v: '2 * 3 * 4' }]);
  assert.deepEqual(parseInline('\\*nicht\\*'), [{ t: 'text', v: '*nicht*' }]);
  assert.deepEqual(parseInline('**offen'), [{ t: 'text', v: '**offen' }]);
});

test('Markdown-light: HTML bleibt Text', () => {
  const tree = parse('<img src=x onerror=alert(1)> **<b>x</b>**');
  assert.equal(tree[0].c[0].v, '<img src=x onerror=alert(1)> ');
  assert.equal(tree[0].c[1].c[0].v, '<b>x</b>');
});

test('Markdown-light: Blöcke', () => {
  const tree = parse('Hallo\nZeile 2\n\n- eins\n- **zwei**\nDanach');
  assert.equal(tree.length, 3);
  assert.equal(tree[0].t, 'p');
  assert.deepEqual(tree[0].c[1], { t: 'br' });
  assert.equal(tree[1].t, 'ul');
  assert.equal(tree[1].items.length, 2);
  assert.equal(tree[2].t, 'p');
  assert.equal(toPlain('**a** und\n- b'), 'a und • b');
});

test('Wunschliste: Gesamtgröße begrenzt, Links nur https', async () => {
  const { validateWish } = await import('../../public/js/lib/model.js');
  const big = { items: Array.from({ length: 20 }, () => ({ text: 'ä'.repeat(2000) })) };
  assert.throws(() => validateWish(big), /zu lang/);
  assert.throws(() => validateWish({ items: [{ text: 'x', link: 'javascript:alert(1)' }] }), /https/);
  const ok = validateWish({ items: [{ text: 'Buch', link: 'https://example.org/a b' }] });
  assert.equal(ok.items[0].link, 'https://example.org/ab');
});
