// 2.14: Nachricht der Organisator:in an alle, eigene offene Aufgaben, Wichtelpost (offene Fragen, neue Antworten).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../public/js/lib/crypto.js';
import { validateAnnouncement, openAnnouncements, readAnnSeen, writeAnnSeen, ANNOUNCE_MAX } from '../../public/js/lib/announce.js';
import { openTodos } from '../../public/js/views/person.js';
import { openQuestions, newAnswers } from '../../public/js/views/person-draw.js';
import { anonSlot } from '../../public/js/lib/questions.js';

const DAY = 86400;
const now = 1_800_000_000;
const round = (o = {}) => ({ id: 'r1', status: 'offen', mode: 'wichteln', rsvpDeadline: now + 5 * DAY, wishDeadline: now + 10 * DAY, eventDate: now + 20 * DAY, deleteAfter: now + 34 * DAY, ...o });
const me = (o = {}) => ({ rsvp: 'offen', wishCt: null, assignmentCt: null, ...o });

test('Nachricht: Text prüfen (leer, Grenze in Zeichen, Zeilenenden)', () => {
  assert.throws(() => validateAnnouncement('   '));
  assert.equal(validateAnnouncement(' a\r\nb '), 'a\nb');
  assert.equal(validateAnnouncement('🎄'.repeat(ANNOUNCE_MAX)).length, 2 * ANNOUNCE_MAX, 'Emoji zählen als ein Zeichen');
  assert.throws(() => validateAnnouncement('x'.repeat(ANNOUNCE_MAX + 1)));
});

test('Nachricht: entschlüsseln nur mit passendem Schlüssel, Runde und ID; manipulierte fallen weg', async () => {
  const k = C.newKey();
  const ct = await C.encryptJson(k, { v: 1, text: 'Hallo', todos: true }, ['ann', 'r1', 'a1']);
  const list = [{ id: 'a1', bodyCt: ct, createdAt: 5 }];
  assert.deepEqual(await openAnnouncements(k, 'r1', list), [{ id: 'a1', createdAt: 5, text: 'Hallo', todos: true }]);
  assert.deepEqual(await openAnnouncements(k, 'r2', list), [], 'andere Runde');
  assert.deepEqual(await openAnnouncements(k, 'r1', [{ ...list[0], id: 'a2' }]), [], 'umgehängte ID');
  assert.deepEqual(await openAnnouncements(C.newKey(), 'r1', list), [], 'fremder Schlüssel');
  const odd = await C.encryptJson(k, { v: 1, text: 42 }, ['ann', 'r1', 'a3']);
  assert.deepEqual(await openAnnouncements(k, 'r1', [{ id: 'a3', bodyCt: odd, createdAt: 1 }]), [], 'kein Text');
  const plain = await C.encryptJson(k, { v: 1, text: 'x', todos: 'ja' }, ['ann', 'r1', 'a4']);
  assert.equal((await openAnnouncements(k, 'r1', [{ id: 'a4', bodyCt: plain, createdAt: 1 }]))[0].todos, false, 'todos nur bei true');
});

test('Nachricht: gelesen merkt sich das Gerät, nur vorwärts, defekter Speicher stört nicht', () => {
  const m = new Map();
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  assert.equal(readAnnSeen('r1', 'p1', st), 0);
  writeAnnSeen('r1', 'p1', 100, st);
  writeAnnSeen('r1', 'p1', 50, st);
  assert.equal(readAnnSeen('r1', 'p1', st), 100);
  assert.equal(readAnnSeen('r1', 'p2', st), 0, 'je Person getrennt');
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(readAnnSeen('r1', 'p1', broken), 0);
  assert.doesNotThrow(() => writeAnnSeen('r1', 'p1', 1, broken));
});

test('Offene Aufgaben: Zugang, Zusage, Wünsche, Team, Wichtelpost, Geschenk; Absage = nur Zugang', () => {
  const j = (o) => openTodos({ now, confirmed: true, ...o }).join('|');
  assert.match(j({ round: round(), me: me(), confirmed: false }), /Zugang sichern/);
  assert.match(j({ round: round(), me: me() }), /Zu- oder absagen/);
  assert.doesNotMatch(j({ round: round(), me: me() }), /Wünsche/, 'ohne Zusage noch keine Wünsche');
  assert.doesNotMatch(j({ round: round({ rsvpDeadline: now - 1 }), me: me() }), /absagen/, 'Frist vorbei: nichts mehr zu tun');
  assert.match(j({ round: round(), me: me({ rsvp: 'dabei' }) }), /Wünsche eintragen/);
  assert.equal(j({ round: round(), me: me({ rsvp: 'dabei', wishCt: 'x' }) }), '', 'alles erledigt');
  assert.equal(j({ round: round(), me: me({ rsvp: 'raus' }) }), '');
  assert.equal(j({ round: round(), me: me({ rsvp: 'raus' }), confirmed: false }).includes('Zugang'), true);
  const teams = [{ id: 'a' }];
  assert.match(j({ round: round(), me: me({ rsvp: 'dabei' }), teams, myTeam: null }), /Team wählen/);
  assert.doesNotMatch(j({ round: round(), me: me({ rsvp: 'dabei' }), teams, myTeam: 'a' }), /Team wählen|Wünsche/, 'Team-Wunschzettel ist gemeinsam');
  const drawn = round({ status: 'gezogen' });
  assert.match(j({ round: drawn, me: me({ rsvp: 'dabei', assignmentCt: 'x', wishCt: 'w' }) }), /Geschenk besorgen/);
  assert.equal(j({ round: drawn, me: me({ rsvp: 'dabei', assignmentCt: 'x', wishCt: 'w' }), giftDone: true }), '');
  assert.match(j({ round: drawn, me: me({ rsvp: 'dabei', assignmentCt: 'x', wishCt: 'w' }), giftDone: true, postOpen: 2 }), /2 offene Fragen/);
  assert.equal(j({ round: drawn, me: me({ rsvp: 'dabei', assignmentCt: null }) }), '', 'nicht in der Ziehung');
  assert.match(j({ round: round({ mode: 'schrott', wishDeadline: null }), me: me({ rsvp: 'dabei' }) }), /Schrottgeschenk/);
  assert.equal(j({ round: round({ status: 'gezogen', eventDate: now - 1 }), me: me({ rsvp: 'dabei', assignmentCt: 'x', wishCt: 'w' }) }), '', 'nach der Bescherung');
});

test('Wichtelpost: offene Fragen = Nachrichten des Wichtels nach der letzten Antwort; neue Antworten nach gesehener ID', () => {
  const m = (id, direction, kind = 'msg') => ({ id, direction, kind });
  assert.equal(openQuestions([]).length, 0);
  assert.deepEqual(openQuestions([m(1, 'frage'), m(2, 'frage')]).map((x) => x.id), [1, 2]);
  assert.deepEqual(openQuestions([m(1, 'frage'), m(2, 'antwort'), m(3, 'frage')]).map((x) => x.id), [3]);
  assert.equal(openQuestions([m(1, 'frage'), m(2, 'antwort')]).length, 0, 'beantwortet');
  assert.equal(openQuestions([m(1, 'frage', 'reveal')]).length, 0, 'Auflösung ist keine Frage');
  assert.deepEqual(newAnswers([m(1, 'frage'), m(2, 'antwort'), m(5, 'antwort', 'thanks')], 2).map((x) => x.id), [5]);
  assert.equal(newAnswers([m(2, 'antwort')], 0).length, 1);
});

test('Anonyme Rückfragen (2.14): abgeleitete Nummern – gleich auf jedem Gerät, verschieden je Nummer, Runde und Person', async () => {
  const secret = C.newKey();
  const p = { roundId: 'r1', secret };
  const a0 = await anonSlot(p, 0);
  assert.deepEqual(await anonSlot({ ...p, pid: 'egal', accessToken: 'neu' }, 0), a0, 'Zugangstoken (Wiederherstellung) ändert nichts');
  assert.ok(C.isId(a0.id) && C.isId(a0.token) && C.isKey(a0.rk), 'Formate wie zufällige Werte');
  const a1 = await anonSlot(p, 1);
  const other = await anonSlot({ roundId: 'r2', secret }, 0);
  const stranger = await anonSlot({ roundId: 'r1', secret: C.newKey() }, 0);
  const all = [a0, a1, other, stranger].flatMap((x) => [x.id, x.token, x.rk]);
  assert.equal(new Set(all).size, all.length, 'keine Wiederholung zwischen Nummern, Runden, Personen und Feldern');
});

test('Anonyme Rückfrage (2.14): nimmt die Nummer nach der höchsten belegten; bei „gibt es schon“ die nächste', async () => {
  const { askQuestion } = await import('../../public/js/lib/questions.js');
  const { configure } = await import('../../public/js/lib/api.js');
  configure({ apiBase: 'https://zw.test/api' });
  const pctx = { roundId: 'r1', pid: 'p1', secret: C.newKey(), kRound: C.newKey() };
  const slots = await Promise.all([0, 1, 2, 3, 4].map((n) => anonSlot(pctx, n)));
  const kp = await C.keypairFromSecret(C.newKey());
  const round = { id: 'r1', questions: { mode: 2, pub: kp.publicB64 } };
  const posted = [];
  let failFirst = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const json = (status, data) => ({ status, ok: status < 300, json: async () => data });
    if (url.endsWith('/questions/threads')) {
      // Nummer 0 aktiv, Nummer 2 von der Organisator:in gelöscht (bleibt belegt), 1 nie benutzt
      return json(200, { threads: [{ id: slots[0].id, ownCt: null, aCt: null, day: 1 }, { id: slots[2].id, deleted: true }] });
    }
    if (url.endsWith('/questions/anon')) {
      posted.push(body.id);
      assert.equal(body.threadHash, await C.tokenHash(slots.find((s) => s.id === body.id).token));
      const s = slots.find((x) => x.id === body.id);
      assert.deepEqual(await C.decryptJson(s.rk, body.ownCt, ['qownanon', 'r1', s.id]), { v: 1, text: 'Wann ist Bescherung?' });
      if (failFirst) { failFirst = false; return json(409, { error: 'exists', message: 'Diese Frage gibt es schon.' }); }
      return json(201, { id: body.id });
    }
    throw new Error(`unerwartet: ${url}`);
  };
  try {
    const res = await askQuestion(pctx, round, 'Wann ist Bescherung?', true);
    assert.deepEqual(posted, [slots[3].id, slots[4].id], 'nach der gelöschten Nummer 2; bei Kollision Nummer 4');
    assert.equal(res.id, slots[4].id);
  } finally {
    globalThis.fetch = realFetch;
  }
});
