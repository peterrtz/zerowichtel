// 2.12: Unterstützungslink – Prüfung auf dem Server, defensives Lesen in der App, Tracking-Angaben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDonation, checkDonationUrl, DonationError } from '../../server/donation.mjs';
import { readDonation } from '../../public/js/lib/donation.js';
import { cleanUrl } from '../../public/js/lib/cleanurl.js';

const STM = 'https://sharethemeal.org/challenges/00000000-0000-4000-8000-000000000000?adjust_t=abc1234&hl=de-DE';

test('Server: gültige Adressen werden normalisiert', () => {
  assert.equal(checkDonationUrl('  https://Example.org  '), 'https://example.org/');
  assert.equal(checkDonationUrl('https://www.buymeacoffee.com/name'), 'https://www.buymeacoffee.com/name');
  assert.equal(checkDonationUrl('https://bücher.de/x'), 'https://xn--bcher-kva.de/x');
  assert.equal(checkDonationUrl(STM), STM);
});

test('Server: abgelehnte Adressen', () => {
  for (const u of ['', 'http://example.org', 'javascript:alert(1)', 'data:text/html,x', 'https://a:b@example.org/', 'https://10.0.0.1/',
    'https://[::1]/', 'https://localhost/', 'https://example.org./', 'https://example.org/a b', 'https://example.org/a\u2028b', `https://example.org/${'x'.repeat(490)}`, 'nichts']) {
    assert.throws(() => checkDonationUrl(u), DonationError, JSON.stringify(u));
  }
});

test('Server: Texte und Schalter', () => {
  assert.deepEqual(normalizeDonation({ enabled: false }), { enabled: false, url: '', label: '', note: '', inRounds: false });
  assert.equal(normalizeDonation({ enabled: true, url: STM, inRounds: true }).inRounds, true);
  assert.throws(() => normalizeDonation({ enabled: true, url: STM, inRounds: 1 }), /inRounds/);
  assert.deepEqual(normalizeDonation({ enabled: true, url: STM, label: ' Mahlzeit\n teilen ', note: '' }).label, 'Mahlzeit teilen');
  assert.equal(normalizeDonation({ enabled: true, url: STM, label: '🍲'.repeat(40) }).label.length, 80, '40 Zeichen, nicht 40 Code-Einheiten');
  assert.throws(() => normalizeDonation({ enabled: true, url: STM, label: '🍲'.repeat(41) }), /40/);
  assert.throws(() => normalizeDonation({ enabled: true, url: STM, note: 'x'.repeat(201) }), /200/);
  assert.throws(() => normalizeDonation({ enabled: true }), /Adresse/);
  assert.throws(() => normalizeDonation({ enabled: 'ja', url: STM }), /enabled/);
  assert.throws(() => normalizeDonation({ enabled: false, url: 'http://x.org' }), /https/, 'auch ausgeschaltet keine ungültige Adresse speichern');
});

test('App: readDonation liest defensiv', () => {
  assert.equal(readDonation(null), null);
  assert.equal(readDonation({ url: 'javascript:alert(1)' }), null);
  assert.equal(readDonation({ url: 'http://example.org/' }), null);
  assert.equal(readDonation({ url: 'https://u:p@example.org/' }), null);
  assert.equal(readDonation({ url: 42 }), null);
  const d = readDonation({ url: 'https://example.org/x', label: 'a'.repeat(99), note: { x: 1 } });
  assert.deepEqual(d, { url: 'https://example.org/x', label: 'a'.repeat(40), note: '', inRounds: false });
  assert.equal(readDonation({ url: 'https://example.org/', inRounds: 'true' }).inRounds, false, 'nur echtes true');
});

test('Tracking: adjust_… wird entfernt, hl bleibt (gilt auch für Wunschlinks)', () => {
  const r = cleanUrl(STM);
  assert.equal(r.removed, 1);
  assert.equal(r.url, 'https://sharethemeal.org/challenges/00000000-0000-4000-8000-000000000000?hl=de-DE');
  assert.equal(cleanUrl('https://shop.example/p?adjust_campaign=x&adjust_adgroup=y').url, 'https://shop.example/p');
});
