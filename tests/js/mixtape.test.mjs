// 2.11: Wichtel-Mixtape – Prüfung, defensives Lesen, Trackliste, Such-Links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIX_LIMITS, validateMix, readMix, buildTracklist, trackLabel, searchLinks, tracklistText, SERVICES } from '../../public/js/lib/mixtape.js';

test('validateMix: leere Zeilen fallen weg, Steuerzeichen und Leerraum werden bereinigt', () => {
  const m = validateMix([{ title: '  Last\u0007 Christmas ', artist: 'Wham!\n' }, { title: '', artist: '' }, { title: 'Stille Nacht' }]);
  assert.deepEqual(m, { v: 1, songs: [{ title: 'Last Christmas', artist: 'Wham!' }, { title: 'Stille Nacht', artist: '' }] });
  assert.deepEqual(validateMix([]), { v: 1, songs: [] });
  assert.deepEqual(validateMix(null), { v: 1, songs: [] });
  assert.equal(validateMix([{ title: 'A' }], '  Erna  ').by, 'Erna');
  assert.equal(validateMix([{ title: 'A' }], '🎄'.repeat(90)).by, '🎄'.repeat(80), 'kein halbiertes Emoji');
});

test('validateMix: Fehler bei fehlendem Titel, zu lang, zu viele', () => {
  assert.throws(() => validateMix([{ title: '', artist: 'Nur Interpret' }]), /Titel/);
  assert.throws(() => validateMix([{ title: 'x'.repeat(MIX_LIMITS.title + 1) }]), /Zeichen/);
  assert.doesNotThrow(() => validateMix([{ title: '🎄'.repeat(MIX_LIMITS.title) }]));
  assert.throws(() => validateMix(Array.from({ length: MIX_LIMITS.songs + 1 }, (_, i) => ({ title: `S${i}` }))), /Höchstens/);
});

test('readMix: fremde Einträge defensiv – falsche Version, zu viele Lieder, fremde Felder', () => {
  assert.equal(readMix(null), null);
  assert.equal(readMix({ v: 2, songs: [] }), null);
  assert.equal(readMix({ v: 1, songs: 'x' }), null);
  const r = readMix({ v: 1, songs: [{ title: 'a'.repeat(500), artist: 7, url: 'javascript:alert(1)' }, { title: '' }, { title: 'B' }, { title: 'C' }, { title: 'D' }], by: { x: 1 } });
  assert.equal(r.songs.length, 2);
  assert.equal(r.songs[0].title.length, MIX_LIMITS.title);
  assert.equal(r.songs[0].artist, '7');
  assert.ok(!('url' in r.songs[0]));
  assert.equal(r.by, null);
  assert.equal(readMix({ v: 1, songs: [{ title: '🎄'.repeat(150) }] }).songs[0].title, '🎄'.repeat(MIX_LIMITS.title));
});

test('buildTracklist: für alle gleich, unabhängig von der Reihenfolge der Einträge; Dubletten zusammengefasst', () => {
  const a = { songs: [{ title: 'Last Christmas', artist: 'Wham!' }, { title: 'Jingle Bells', artist: '' }], by: null };
  const b = { songs: [{ title: 'last christmas', artist: 'WHAM!' }], by: 'Peter' };
  const c = { songs: [{ title: 'O Tannenbaum', artist: '' }], by: null };
  const one = buildTracklist([a, b, c, null], 'r1');
  const two = buildTracklist([c, null, b, a], 'r1');
  assert.deepEqual(one, two);
  assert.equal(one.length, 3);
  const lc = one.find((x) => x.title.toLowerCase() === 'last christmas');
  assert.equal(lc.count, 2);
  assert.deepEqual(lc.by, ['Peter']);
  // Andere Runde → (sehr wahrscheinlich) andere Reihenfolge, aber dieselben Lieder
  const other = buildTracklist([a, b, c], 'r2');
  assert.deepEqual(other.map((x) => x.title).sort(), one.map((x) => x.title).sort());
  assert.deepEqual(buildTracklist([], 'r1'), []);
});

test('buildTracklist: Reihenfolge verrät nicht, wer was eingetragen hat (Lieder einer Person nicht am Stück)', () => {
  // 10 Personen à 3 Lieder: wie oft stehen alle 3 Lieder einer Person direkt hintereinander? Über 200 Runden selten.
  let together = 0;
  for (let r = 0; r < 200; r++) {
    const entries = Array.from({ length: 10 }, (_, p) => ({ songs: [0, 1, 2].map((k) => ({ title: `P${p}S${k}`, artist: '' })), by: null }));
    const order = buildTracklist(entries, `runde-${r}`).map((x) => x.title);
    for (let p = 0; p < 10; p++) {
      const pos = order.map((tt, i) => (tt.startsWith(`P${p}S`) ? i : -1)).filter((i) => i >= 0);
      if (pos[2] - pos[0] === 2) together++;
    }
  }
  // Zufällig erwartet: 10 · 28 · 3! · 27! / 30! ≈ 0,069 je Runde → ~14 von 2000; großzügige Grenze
  assert.ok(together < 60, `zu oft am Stück: ${together}`);
});

test('trackLabel: Seiten A und B', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => trackLabel(i, 5)), ['A1', 'A2', 'A3', 'B1', 'B2']);
  assert.equal(trackLabel(0, 1), 'A1');
});

test('searchLinks: nur https, Suchtext kodiert, nur Titel und Interpret', () => {
  const links = searchLinks({ title: 'Rock & Roll "X-Mas"/?#', artist: 'Bänd' });
  assert.equal(links.length, SERVICES.length);
  assert.deepEqual(links.map((l) => l.name), ['Qobuz', 'Spotify', 'Deezer', 'Apple Music', 'YouTube']);
  for (const l of links) {
    const u = new URL(l.url);
    assert.equal(u.protocol, 'https:');
    assert.ok(!l.url.includes(' ') && !l.url.includes('"') && !l.url.includes('#'), l.url);
    assert.ok(decodeURIComponent(l.url).includes('Rock & Roll "X-Mas"/?# Bänd'), l.url);
  }
  assert.ok(searchLinks({ title: 'Nur Titel', artist: '' })[0].url.endsWith(encodeURIComponent('Nur Titel')));
});

test('tracklistText', () => {
  assert.equal(tracklistText('Mix', [{ title: 'A', artist: 'X' }, { title: 'B', artist: '' }]), 'Mix\n\nA1  A – X\nB1  B');
});
