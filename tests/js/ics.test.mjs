import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, escapeText, fold, localDate, icsFilename } from '../../public/js/lib/ics.js';

const ts = (y, m, d, h, min) => Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);
const base = {
  roundId: 'Zzkkn5LWL5xRjbWwZZa9xQ',
  title: 'Familie, Freunde; & „Wichteln“ – mit einem sehr langen Titel, der gefaltet werden muss 🎁',
  mode: 'wichteln',
  rsvpDeadline: ts(2026, 12, 3, 23, 59),
  wishDeadline: ts(2026, 12, 17, 23, 59),
  eventDate: ts(2026, 12, 24, 12, 0),
  budget: 30,
  role: 'person',
  url: 'https://wichteln.example.org/#zu/Zzkkn5LWL5xRjbWwZZa9xQ',
  now: Date.UTC(2026, 9, 21, 10, 0, 0),
};
const unfold = (s) => s.replace(/\r\n /g, '');

test('ICS: Struktur, CRLF, Zeilenlänge, drei Termine beim Wichteln', async () => {
  const ics = await buildIcs(base);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'nur CRLF');
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `Zeile zu lang: ${line}`);
  const flat = unfold(ics);
  assert.equal((flat.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.equal((flat.match(/BEGIN:VALARM/g) || []).length, 3);
  assert.ok(flat.includes('DTSTART;VALUE=DATE:20261203') && flat.includes('DTEND;VALUE=DATE:20261204'));
  assert.ok(flat.includes('DTSTART;VALUE=DATE:20261217'));
  assert.ok(flat.includes('DTSTART;VALUE=DATE:20261224') && flat.includes('DTEND;VALUE=DATE:20261225'));
  assert.ok(flat.includes('Betragslimit: 30 €'));
  assert.ok(flat.includes('🎁'), 'UTF-8 beim Falten nicht zerteilt');
});

test('ICS: Maskierung und Faltung umkehrbar', async () => {
  assert.equal(escapeText('a,b;c\\d\ne'), String.raw`a\,b\;c\\d\ne`);
  const long = 'X'.repeat(200) + 'ä'.repeat(50);
  assert.equal(unfold(fold(long)), long);
  const flat = unfold(await buildIcs(base));
  assert.ok(flat.includes(String.raw`SUMMARY:Wunschfrist: Familie\, Freunde\; & „Wichteln“`));
});

test('ICS: keine Schlüssel-Links, keine Runden-ID im Klartext, stabile UIDs', async () => {
  const a = await buildIcs(base);
  const b = await buildIcs({ ...base, now: base.now + 3600_000, eventDate: ts(2026, 12, 23, 12, 0) });
  for (const ics of [a, b]) {
    assert.ok(!/#[pia]\//.test(unfold(ics)), 'kein #p/, #i/, #a/');
    assert.ok(!unfold(ics).includes(`UID:${base.roundId}`), 'UID verrät die Runden-ID nicht');
  }
  const uids = (s) => [...unfold(s).matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(uids(a), uids(b), 'gleiche UIDs → Kalender aktualisiert statt doppelt');
  const seq = (s) => Number(unfold(s).match(/^SEQUENCE:(\d+)$/m)[1]);
  assert.ok(seq(b) > seq(a), 'höhere SEQUENCE beim erneuten Laden');
});

test('ICS: Schrottwichteln ohne Wunschfrist; Organisator-Texte', async () => {
  const flat = unfold(await buildIcs({ ...base, mode: 'schrott', wishDeadline: null, role: 'admin', url: 'https://wichteln.example.org/' }));
  assert.equal((flat.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(flat.includes('SUMMARY:Schrottwichteln:'));
  assert.ok(flat.includes('Danach kannst du auslosen'));
  assert.ok(!flat.includes('Dein Geschenk'));
});

test('ICS: Hilfsfunktionen', () => {
  assert.equal(localDate(ts(2026, 12, 31, 23, 59), 1), '20270101');
  assert.equal(icsFilename('Weihnachten bei Müllers & Co.'), 'zerowichtel-weihnachten-bei-mullers-co.ics');
  assert.equal(icsFilename(''), 'zerowichtel-wichtelrunde.ics');
});
