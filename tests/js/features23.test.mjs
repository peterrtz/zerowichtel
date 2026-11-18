// 2.3: Übersetzungen, Tracking-Bereinigung, Ideen-Würfel, Zeitleiste, Checkliste, „Was jetzt?“, Wunsch-Steckbrief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontendKeys, serverKeys } from '../../bin/i18n-keys.mjs';
import { EN, EN_PATTERNS } from '../../public/js/lib/en.js';
import { t, tn, setLang, lang } from '../../public/js/lib/i18n.js';
import { cleanUrl, cleanTextUrls } from '../../public/js/lib/cleanurl.js';
import { ideasFor, rollIdea, ADVENT, IDEAS } from '../../public/js/lib/ideas.js';
import { validateWish, cleanProfile, PROFILE_FIELDS } from '../../public/js/lib/model.js';
import { timelineSteps } from '../../public/js/views/common.js';
import { organizerChecklist } from '../../public/js/views/admin.js';
import { nextSteps } from '../../public/js/views/person.js';

const DAY = 86400;
const now = 1_800_000_000;

test('i18n: jeder Schlüssel hat eine englische Übersetzung mit denselben Platzhaltern', () => {
  const keys = new Map([...frontendKeys(), ...serverKeys()]);
  assert.ok(keys.size > 700, `nur ${keys.size} Schlüssel gefunden`);
  const missing = [...keys.keys()].filter((k) => !(k in EN));
  assert.deepEqual(missing, [], `ohne Übersetzung: ${missing.join(' | ')}`);
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [de, en] of Object.entries(EN)) assert.equal(ph(en), ph(de), `Platzhalter in „${de}“`);
});

test('i18n: Umschalten, Platzhalter, Mehrzahl, Muster für Servermeldungen', () => {
  const before = lang();
  setLang('de');
  assert.equal(t('Hallo {name}!', { name: 'Ida' }), 'Hallo Ida!');
  assert.equal(tn(1, '{n} Person', '{n} Personen'), '1 Person');
  setLang('en');
  assert.equal(t('Hallo {name}!', { name: 'Ida' }), 'Hello Ida!');
  assert.equal(tn(3, '{n} Person', '{n} Personen'), '3 people');
  assert.equal(t('Die Runde ist voll (höchstens 50 Personen).'), 'The round is full (at most 50 people).');
  assert.equal(t('Feld „max“ 1 bis 50 Personen.'), 'Field “max”: 1 to 50 people.');
  assert.equal(t('Gibt es nicht'), 'Gibt es nicht');
  assert.ok(EN_PATTERNS.length >= 3);
  setLang(before);
});

test('Tracking-Parameter: entfernt, was sicher Tracking ist, und lässt Produktangaben stehen', () => {
  assert.deepEqual(cleanUrl('https://shop.example/p/123?utm_source=x&utm_medium=y&color=red&fbclid=abc'),
    { url: 'https://shop.example/p/123?color=red', removed: 3 });
  assert.deepEqual(cleanUrl('https://www.amazon.de/dp/B0ABC/ref=sr_1_3?tag=foo-21&th=1&keywords=x'),
    { url: 'https://www.amazon.de/dp/B0ABC?keywords=x', removed: 3 });
  assert.equal(cleanUrl('https://example.org/?th=1').removed, 0, 'th ist nur bei Shops Tracking');
  assert.equal(cleanUrl('https://example.org/a?si=abc').url, 'https://example.org/a');
  assert.deepEqual(cleanUrl('https://example.org/x'), { url: 'https://example.org/x', removed: 0 });
  assert.deepEqual(cleanUrl('kein Link'), { url: 'kein Link', removed: 0 });
  const r = cleanTextUrls('Schau mal https://x.example/a?utm_campaign=q. Und https://y.example/b?gclid=1!');
  assert.equal(r.text, 'Schau mal https://x.example/a. Und https://y.example/b!');
  assert.equal(r.removed, 2);
});

test('Wunschliste: Steckbrief wird bereinigt, Links werden von Tracking befreit', () => {
  const stats = {};
  const w = validateWish({
    items: [{ text: 'Buch https://b.example/x?utm_source=a', link: 'https://shop.example/y?fbclid=1&size=M' }],
    noGo: 'Nichts von https://n.example/?mc_cid=2',
    profile: { size: ' M ', shoe: '', colors: 'grün\nblau', unknown: 'x' },
  }, stats);
  assert.equal(stats.removed, 3);
  assert.equal(w.items[0].link, 'https://shop.example/y?size=M');
  assert.equal(w.items[0].text, 'Buch https://b.example/x');
  assert.deepEqual(w.profile, { size: 'M', colors: 'grün blau' });
  assert.deepEqual(cleanProfile({ likes: 'x'.repeat(999) }).likes.length, PROFILE_FIELDS.likes[1]);
});

test('Ideen-Würfel: passt zum Betragslimit, wiederholt sich nicht direkt; 24 Adventstürchen', () => {
  const cheap = ideasFor(5).length;
  assert.equal(cheap, IDEAS[0][1].length);
  assert.ok(ideasFor(30).length > ideasFor(10).length);
  assert.equal(ideasFor(null).length, IDEAS.flatMap(([, l]) => l).length);
  assert.ok(ideasFor(0).length > 0);
  let last = null;
  for (let i = 0; i < 50; i++) {
    const idea = rollIdea(20, last);
    assert.notEqual(idea, last);
    last = idea;
  }
  assert.equal(ADVENT.length, 24);
});

const round = (over = {}) => ({
  mode: 'wichteln', status: 'offen', rsvpDeadline: now + 5 * DAY, wishDeadline: now + 10 * DAY,
  eventDate: now + 20 * DAY, deleteAfter: now + 34 * DAY, drawnAt: null, ...over,
});

test('Zeitleiste: „Du bist hier“ wandert mit Status und Zeit', () => {
  const cur = (r, at) => timelineSteps(r, at).findIndex((s) => !s.done);
  assert.equal(cur(round(), now), 0);
  assert.equal(cur(round(), now + 6 * DAY), 1, 'nach Antwortfrist: Auslosen');
  const drawn = round({ status: 'gezogen', drawnAt: now + DAY });
  assert.equal(cur(drawn, now + 2 * DAY), 2, 'Wünsche');
  // 2.8: Geschenk-Schritt zwischen Wünsche und Bescherung (Organisator-Sicht: erledigt mit dem Wichteltag)
  assert.equal(cur(drawn, now + 12 * DAY), 3, 'Geschenk besorgen (Organisator-Sicht)');
  assert.equal(cur(drawn, now + 21 * DAY), 5, 'Raten und Danke');
  assert.equal(cur(drawn, now + 28 * DAY), 6, 'Löschung');
  assert.equal(timelineSteps(round({ mode: 'schrott' }), now).length, 4);
});

test('2.8: Geschenk-Schritt selbst abhaken; Zusagen-Datum bei früher Auslosung', () => {
  const cur = (r, at, o) => timelineSteps(r, at, o).findIndex((s) => !s.done);
  const drawn = round({ status: 'gezogen', drawnAt: now + DAY });
  const steps = timelineSteps(drawn, now + 2 * DAY, { gift: false });
  assert.deepEqual(steps.map((s) => s.label), ['Zusagen', 'Auslosen', 'Wünsche', 'Geschenk besorgen & verpacken', 'Bescherung', 'Raten und Danke sagen', 'Löschung']);
  assert.equal(cur(drawn, now + 12 * DAY, { gift: false }), 3, 'nach der Wunschfrist: Geschenk');
  assert.equal(cur(drawn, now + 12 * DAY, { gift: true }), 4, 'abgehakt: Bescherung');
  assert.equal(cur(drawn, now + 2 * DAY, { gift: true }), 2, 'früh abgehakt: noch Wünsche');
  assert.equal(timelineSteps(drawn, now + 2 * DAY, { gift: true })[3].done, true);
  assert.equal(cur(drawn, now + 21 * DAY, { gift: false }), 5, 'nach dem Wichteltag gilt er als erledigt');
  // vor der Ziehung nie erledigt, auch nicht mit Haken
  assert.equal(timelineSteps(round(), now, { gift: true })[3].done, false);
  // Zusagen: Antwortfrist, außer es wurde vorher ausgelost
  assert.equal(timelineSteps(round(), now)[0].date, now + 5 * DAY);
  assert.equal(timelineSteps(drawn, now + 2 * DAY)[0].date, now + DAY);
  assert.equal(timelineSteps(round({ status: 'gezogen', drawnAt: now + 6 * DAY }), now + 7 * DAY)[0].date, now + 5 * DAY);
  // Schrottwichteln: „Geschenk finden“
  const schrott = round({ mode: 'schrott' });
  assert.deepEqual(timelineSteps(schrott, now, { gift: false }).map((s) => s.label), ['Zusagen', 'Geschenk finden & verpacken', 'Spieleabend', 'Löschung']);
  assert.equal(cur(schrott, now + 6 * DAY, { gift: false }), 1);
  assert.equal(cur(schrott, now + 6 * DAY, { gift: true }), 2);
});

test('Checkliste der Organisator:in', () => {
  const p = (o) => ({ claimed: true, rsvp: 'dabei', inDraw: false, drawSeen: false, ...o });
  let items = organizerChecklist({ round: round(), participants: [], confirmed: false, selfDone: false, now });
  assert.deepEqual(items.map((i) => i.done), [false, false, false, false, false, false, false, false]);
  items = organizerChecklist({ round: round(), participants: [p(), p(), p({ rsvp: 'offen' })], confirmed: true, selfDone: true, now });
  assert.deepEqual(items.map((i) => i.done), [true, true, true, true, false, false, false, false]);
  const drawn = round({ status: 'gezogen' });
  items = organizerChecklist({ round: drawn, participants: [p({ inDraw: true, drawSeen: true }), p({ inDraw: true, drawSeen: true }), p({ inDraw: true, drawSeen: false })], confirmed: true, selfDone: false, now });
  assert.deepEqual(items.map((i) => i.done), [true, true, true, true, true, true, false, false]);
  assert.equal(organizerChecklist({ round: round({ mode: 'schrott' }), participants: [], confirmed: true, selfDone: true, now }).length, 6);
});

test('„Was jetzt?“ für Teilnehmende', () => {
  setLang('de');
  const me = (o) => ({ rsvp: 'offen', wishCt: null, assignmentCt: null, ...o });
  let s = nextSteps({ round: round(), me: me(), confirmed: false, now, budget: 30 });
  assert.match(s[0], /Sichere deinen Zugang/);
  assert.match(s[1], /Sag zu oder ab/);
  s = nextSteps({ round: round(), me: me({ rsvp: 'dabei' }), confirmed: true, now, budget: 30 });
  assert.match(s[0], /Trag deine Wünsche ein/);
  s = nextSteps({ round: round({ status: 'gezogen' }), me: me({ rsvp: 'dabei', assignmentCt: 'x' }), confirmed: true, now: now + 11 * DAY, budget: 30 });
  assert.match(s[0], /besorg ein Geschenk/);
  s = nextSteps({ round: round({ status: 'gezogen' }), me: me({ rsvp: 'dabei', assignmentCt: 'x' }), confirmed: true, now: now + 21 * DAY, budget: 30 });
  assert.match(s[0], /Rate, wer dein Wichtel war/);
  s = nextSteps({ round: round(), me: me({ rsvp: 'raus' }), confirmed: true, now, budget: 30 });
  assert.match(s[0], /diesmal raus/);
});

test('2.8: „Was jetzt?“ nach dem Abhaken', () => {
  setLang('de');
  const me = (o) => ({ rsvp: 'dabei', wishCt: 'w', assignmentCt: 'x', ...o });
  const drawn = round({ status: 'gezogen' });
  let s = nextSteps({ round: drawn, me: me(), confirmed: true, now: now + 2 * DAY, budget: 30, giftDone: true });
  assert.match(s[0], /Alles erledigt/);
  assert.match(s[1], /eigenen Wünsche kannst du noch/);
  s = nextSteps({ round: drawn, me: me(), confirmed: true, now: now + 12 * DAY, budget: 30, giftDone: true });
  assert.deepEqual(s.length, 1);
  s = nextSteps({ round: drawn, me: me(), confirmed: true, now: now + 2 * DAY, budget: 30, giftDone: true, teams: [{ id: 't1' }] });
  assert.match(s[1], /Team-Wunschzettel/);
  s = nextSteps({ round: drawn, me: me(), confirmed: true, now: now + 21 * DAY, budget: 30, giftDone: true });
  assert.match(s[0], /Rate, wer dein Wichtel war/, 'nach dem Wichteltag zählt der Haken nicht mehr');
  s = nextSteps({ round: round({ mode: 'schrott' }), me: me({ assignmentCt: null }), confirmed: true, now, budget: 30, giftDone: true });
  assert.match(s[0], /gefunden und verpackt/);
});

test('Gesundheitsangaben (Art. 9 DSGVO): nur mit Einwilligung, Anzeige und Widerruf', async () => {
  const M = await import('../../public/js/lib/model.js');
  const base = { items: [{ text: 'Buch', link: '' }], noGo: '' };
  assert.throws(() => validateWish({ ...base, profile: { allergies: 'Nüsse' } }), /Einwilligung/);
  assert.throws(() => validateWish({ ...base, profile: { allergies: 'Nüsse', consent: { v: 99, at: 1 } } }), /Einwilligung/, 'andere Textfassung');
  const at = Date.now();
  const w = validateWish({ ...base, profile: { allergies: 'Nüsse', size: 'M', consent: { v: M.CONSENT_VERSION, at } } });
  assert.deepEqual(w.profile, { size: 'M', allergies: 'Nüsse', consent: { v: M.CONSENT_VERSION, at } });
  // ohne Gesundheitsangabe kein Einwilligungseintrag
  assert.deepEqual(validateWish({ ...base, profile: { size: 'M', consent: { v: M.CONSENT_VERSION, at } } }).profile, { size: 'M' });
  // Anzeige beim Wichtel: ohne gültige Einwilligung (z. B. aus 2.3.0) keine Gesundheitsangabe
  assert.deepEqual(M.visibleProfile({ size: 'M', allergies: 'Nüsse' }), { size: 'M' });
  assert.deepEqual(M.visibleProfile(w.profile), { size: 'M', allergies: 'Nüsse' });
  // Widerruf entfernt Angabe und Einwilligung, der Rest bleibt
  const r = M.withoutHealthData(w);
  assert.deepEqual(r.profile, { size: 'M' });
  assert.deepEqual(r.items, w.items);
  assert.ok(r.updatedAt >= w.updatedAt);
});
