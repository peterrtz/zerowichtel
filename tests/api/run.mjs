// API-Testsuite (sprachneutral, über HTTP). Portiert aus tests/php/run.php der Version 1.2.1 und ergänzt um
// Prüfungen der Anfrageverarbeitung. Läuft unverändert gegen die Node- und die PHP-Version (siehe harness.mjs).
//   node tests/api/run.mjs [Filter]
import { isDeepStrictEqual, inspect } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { IMPL, T0, b64u, ct, h, nid, sealed, startServer, totpCode } from './harness.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
/** Funktionen ab 2.3 – nicht in der PHP-Fassung 1.2.1 vorhanden. */
const test23 = (name, fn) => { if (IMPL !== 'php') tests.push([`2.3: ${name}`, fn]); };
const SCHEMA = IMPL === 'php' ? 4 : 7;
function eq(exp, act, msg = '') {
  if (!isDeepStrictEqual(exp, act)) throw new Error(`${msg ? `${msg}: ` : ''}erwartet ${inspect(exp)}, erhalten ${inspect(act)}`);
}
function ok(c, msg) { if (!c) throw new Error(msg); }
const DAY = 86400;
let openIp = 0; // eigene Adresse je Runde ohne Code (Grenze create_open je Anschluss)

let envs = [];
class Env {
  static async make(o = {}) {
    const e = new Env();
    e.s = await startServer(o);
    e.now = T0;
    envs.push(e);
    return e;
  }

  call(method, path, body = null, auth = null, ip = '10.0.0.1') { return this.s.call(method, path, body, auth, { ip, now: this.now }); }
  async status(...a) { return (await this.call(...a))[0]; }
  sql(q, ...a) { return this.s.sql(q, ...a); }
  count(q) { return this.s.sqlValue(q); }
  code(rounds = 3, days = 60) { return this.s.code(rounds, days, this.now); }

  async round(mode = 'wichteln', code = null) {
    const id = nid();
    const token = nid();
    const [s, d] = await this.call('POST', '/rounds', {
      organizerCode: code ?? this.code(), id, adminHash: h(token), mode,
      rsvpDeadline: this.now + 5 * DAY, wishDeadline: mode === 'wichteln' ? this.now + 10 * DAY : null, eventDate: this.now + 20 * DAY, metaCt: ct(200),
    });
    eq(201, s, `Runde anlegen ${JSON.stringify(d)}`);
    return { id, admin: `a.${id}.${token}`, tok: token };
  }

  async person(r, email = undefined) {
    const pid = nid();
    const tok = nid();
    const body = { id: pid, inviteHash: h(tok), inviteCt: ct(), nameCt: ct(), ...(email ? { email, emailViewCt: ct() } : {}) };
    const [s, d] = await this.call('POST', `/rounds/${r.id}/participants`, body, r.admin);
    eq(201, s, `Person anlegen ${JSON.stringify(d)}`);
    return { pid, invite: `i.${pid}.${tok}`, tok };
  }

  /** Löst eine Einladung ein; gibt die Personen-Auth zurück und merkt sich den Wiederherstellungscode. */
  async claim(p) {
    const access = nid();
    this.recoveryToken = b64u(crypto.randomBytes(32));
    const [s, d] = await this.call('POST', '/invite/claim', {
      accessHash: h(access), pubkey: b64u(crypto.randomBytes(32)), recoveryHash: h(this.recoveryToken), recoveryCt: ct(),
    }, p.invite);
    eq(200, s, `Einlösen ${JSON.stringify(d)}`);
    return `p.${p.pid}.${access}`;
  }

  async mailRound(title = 'Familie M.') {
    const id = nid();
    const tok = nid();
    const [s, d] = await this.call('POST', '/rounds', {
      organizerCode: this.code(), id, adminHash: h(tok), mode: 'wichteln',
      rsvpDeadline: this.now + 5 * DAY, wishDeadline: this.now + 10 * DAY, eventDate: this.now + 20 * DAY,
      metaCt: ct(200), emailEnabled: true, mailTitle: title,
    });
    eq(201, s, `Mailrunde ${JSON.stringify(d)}`);
    return { id, admin: `a.${id}.${tok}`, tok };
  }
}

const drawBody = (people, boxes = null) => ({
  participants: people.map((p) => ({ id: p.pid ?? p, assignmentCt: sealed(), mailboxkeyCt: sealed() })),
  mailboxes: boxes ?? people.map(() => ({ id: nid(), giverHash: h(nid()), receiverHash: h(nid()) })),
});

/** Runde mit drei Zusagen und gespeicherter Ziehung; Postfach-Tokens je Person. */
async function drawnRound(e) {
  const r = await e.round();
  const people = [];
  for (let i = 0; i < 3; i++) {
    const p = await e.person(r);
    p.auth = await e.claim(p);
    eq(200, await e.status('PUT', '/me/rsvp', { rsvp: 'dabei' }, p.auth));
    Object.assign(p, { mid: nid(), gTok: nid(), rTok: nid() });
    people.push(p);
  }
  const boxes = people.map((p) => ({ id: p.mid, giverHash: h(p.gTok), receiverHash: h(p.rTok) }));
  const [s, d] = await e.call('PUT', `/rounds/${r.id}/draw`, drawBody(people, boxes), r.admin);
  eq(200, s, `Ziehung ${JSON.stringify(d)}`);
  return [r, people];
}

/** Gezogene Mailrunde mit drei Personen (a, b mit Adresse; c ohne). */
async function drawnMailRound(e) {
  const r = await e.mailRound('Test');
  const people = [];
  for (const mail of ['a@example.org', 'b@example.org', null]) {
    const p = await e.person(r, mail);
    p.auth = await e.claim(p);
    eq(200, await e.status('PUT', '/me/rsvp', { rsvp: 'dabei' }, p.auth));
    people.push(p);
  }
  eq(200, await e.status('PUT', `/rounds/${r.id}/draw`, drawBody(people), r.admin));
  return [r, people];
}

// ---------------------------------------------------------------- Grundlagen

test('Schema: aktuelle Version, WAL', async () => {
  const e = await Env.make();
  await e.call('GET', '/info');
  eq(SCHEMA, e.count('PRAGMA user_version'));
  eq('wal', e.count('PRAGMA journal_mode'));
});

test('Organisator-Code: ohne, falsch, aufgebraucht, abgelaufen', async () => {
  const e = await Env.make();
  const code = e.code(1);
  eq(200, await e.status('POST', '/organizer/check', { organizerCode: code.toLowerCase() }), 'Kleinschreibung akzeptiert');
  await e.round('wichteln', code);
  eq(403, await e.status('POST', '/rounds', { organizerCode: code, id: nid(), adminHash: h('x'), mode: 'schrott', rsvpDeadline: e.now + 100, eventDate: e.now + 1000, metaCt: ct() }), 'aufgebraucht');
  eq(403, await e.status('POST', '/organizer/check', { organizerCode: 'ZW-AAAA-AAAA-AAAA-AAAA' }));
  const code2 = e.code();
  e.now += 61 * DAY;
  eq(403, await e.status('POST', '/organizer/check', { organizerCode: code2 }), 'abgelaufen');
});

test('Runde anlegen: Fristen werden geprüft', async () => {
  const e = await Env.make();
  const base = { organizerCode: e.code(10), adminHash: h('t'), metaCt: ct() };
  const cases = [
    { mode: 'wichteln', rsvpDeadline: e.now + 100, wishDeadline: e.now + 50, eventDate: e.now + 1000 },
    { mode: 'wichteln', rsvpDeadline: e.now + 100, eventDate: e.now + 1000 },
    { mode: 'schrott', rsvpDeadline: e.now - 1, eventDate: e.now + 1000 },
    { mode: 'schrott', rsvpDeadline: e.now + 100, eventDate: e.now + 400 * DAY },
    { mode: 'schrott', rsvpDeadline: e.now + 2000, eventDate: e.now + 1000 },
    { mode: 'quatsch', rsvpDeadline: e.now + 100, eventDate: e.now + 1000 },
  ];
  for (const [i, c] of cases.entries()) eq(400, await e.status('POST', '/rounds', { ...base, ...c, id: nid() }), `Fall ${i}`);
  eq(201, await e.status('POST', '/rounds', { ...base, id: nid(), mode: 'schrott', rsvpDeadline: e.now + 100, eventDate: e.now + 1000 }), 'Schrottwichteln ohne Wunschfrist');
});

test('Runde anlegen: ungültige Chiffretexte und IDs', async () => {
  const e = await Env.make();
  const base = { organizerCode: e.code(10), adminHash: h('t'), mode: 'schrott', rsvpDeadline: e.now + 100, eventDate: e.now + 1000 };
  eq(400, await e.status('POST', '/rounds', { ...base, id: nid(), metaCt: '<script>' }));
  eq(400, await e.status('POST', '/rounds', { ...base, id: 'kurz', metaCt: ct() }));
  const [s, d] = await e.call('POST', '/rounds', { ...base, id: nid(), metaCt: `v1.${'a'.repeat(30000)}` });
  eq([400, 'invalid_metaCt', 'Feld „metaCt“ ist zu lang.'], [s, d.error, d.message]);
  const id = nid();
  eq(201, await e.status('POST', '/rounds', { ...base, id, metaCt: ct() }));
  eq(409, await e.status('POST', '/rounds', { ...base, id, metaCt: ct() }), 'doppelte ID');
});

test('Admin: falsches Token, fremde Runde, Rollenverwechslung → 404/401', async () => {
  const e = await Env.make();
  const r = await e.round();
  const r2 = await e.round();
  eq(200, await e.status('GET', `/rounds/${r.id}/admin`, null, r.admin));
  eq(404, await e.status('GET', `/rounds/${r.id}/admin`, null, `a.${r.id}.${nid()}`));
  eq(404, await e.status('GET', `/rounds/${r.id}/admin`, null, r2.admin));
  const [s, d] = await e.call('GET', `/rounds/${r.id}/admin`);
  eq([401, 'unauthorized', 'Zugangsdaten fehlen oder sind ungültig.'], [s, d.error, d.message]);
  eq(401, await e.status('GET', `/rounds/${r.id}/admin`, null, `p${r.admin.slice(1)}`));
});

test('Teilnehmende: anlegen, Limit 50, umbenennen, löschen', async () => {
  const e = await Env.make();
  const r = await e.round();
  const first = await e.person(r);
  for (let i = 1; i < 50; i++) await e.person(r);
  const [s, d] = await e.call('POST', `/rounds/${r.id}/participants`, { id: nid(), inviteHash: h('x'), inviteCt: ct(), nameCt: ct() }, r.admin);
  eq([409, 'full', 'Die Runde ist voll (höchstens 50 Personen).'], [s, d.error, d.message]);
  eq(204, await e.status('PATCH', `/rounds/${r.id}/participants/${first.pid}`, { nameCt: ct() }, r.admin));
  eq(204, await e.status('DELETE', `/rounds/${r.id}/participants/${first.pid}`, null, r.admin));
  const [, v] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  eq(49, v.participants.length);
  ok(typeof v.participants[0].inviteCt === 'string', 'inviteCt sichtbar, solange uneingelöst');
});

test('Einladung: ansehen, einlösen, zweites Einlösen 410, Link danach wertlos', async () => {
  const e = await Env.make();
  const r = await e.round();
  const p = await e.person(r);
  let [s, d] = await e.call('GET', '/invite', null, p.invite);
  eq(200, s);
  eq(p.pid, d.me.id);
  ok(!('adminCt' in d.round), 'adminCt darf nicht an Eingeladene gehen');
  const auth = await e.claim(p);
  eq(410, await e.status('GET', '/invite', null, p.invite));
  eq(410, await e.status('POST', '/invite/claim', { accessHash: h('z'), pubkey: b64u(crypto.randomBytes(32)), recoveryHash: h('q'), recoveryCt: ct() }, p.invite));
  [s, d] = await e.call('GET', '/me', null, auth);
  eq(200, s);
  eq('offen', d.me.rsvp);
  [, d] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  eq(true, d.participants[0].claimed);
  eq(null, d.participants[0].inviteCt, 'inviteCt nach Einlösen entfernt');
  eq(null, e.sql('SELECT invite_ct FROM participants')[0].invite_ct);
});

test('Umfrage: dabei/raus, ungültig, nach Frist gesperrt', async () => {
  const e = await Env.make();
  const r = await e.round();
  const auth = await e.claim(await e.person(r));
  eq(200, await e.status('PUT', '/me/rsvp', { rsvp: 'dabei' }, auth));
  eq(400, await e.status('PUT', '/me/rsvp', { rsvp: 'vielleicht' }, auth));
  const [, d] = await e.call('GET', '/me', null, auth);
  eq('dabei', d.me.rsvp);
  eq({ invited: 1, dabei: 1 }, d.counts);
  eq(200, await e.status('PUT', '/me/rsvp', { rsvp: 'raus' }, auth));
  e.now += 6 * DAY;
  eq(409, await e.status('PUT', '/me/rsvp', { rsvp: 'dabei' }, auth));
});

test('Neu einladen: alter persönlicher Link verfällt', async () => {
  const e = await Env.make();
  const r = await e.round();
  const p = await e.person(r);
  const auth = await e.claim(p);
  eq(200, await e.status('PUT', '/me/rsvp', { rsvp: 'dabei' }, auth));
  const tok = nid();
  eq(200, await e.status('POST', `/rounds/${r.id}/participants/${p.pid}/reinvite`, { inviteHash: h(tok), inviteCt: ct() }, r.admin));
  eq(404, await e.status('GET', '/me', null, auth));
  eq(404, await e.status('GET', '/invite', null, p.invite));
  const auth2 = await e.claim({ pid: p.pid, invite: `i.${p.pid}.${tok}` });
  const [, d] = await e.call('GET', '/me', null, auth2);
  eq('offen', d.me.rsvp, 'Antwort zurückgesetzt');
});

test('Wiederherstellung: neues Zugangstoken, altes ungültig', async () => {
  const e = await Env.make();
  const r = await e.round();
  const p = await e.person(r);
  const auth = await e.claim(p);
  const rt = e.recoveryToken;
  const fresh = nid();
  const [s, d] = await e.call('POST', '/recover', { recoveryToken: rt, accessHash: h(fresh) });
  eq(200, s);
  eq([r.id, p.pid], [d.roundId, d.pid]);
  eq(404, await e.status('GET', '/me', null, auth));
  eq(200, await e.status('GET', '/me', null, `p.${p.pid}.${fresh}`));
  eq(404, await e.status('POST', '/recover', { recoveryToken: b64u(crypto.randomBytes(32)), accessHash: h('x') }));
  const rt2 = b64u(crypto.randomBytes(32));
  eq(204, await e.status('PUT', '/me/recovery', { recoveryHash: h(rt2), recoveryCt: ct() }, `p.${p.pid}.${fresh}`));
  eq(404, await e.status('POST', '/recover', { recoveryToken: rt, accessHash: h('y') }), 'alter Code ungültig');
  eq(200, await e.status('POST', '/recover', { recoveryToken: rt2, accessHash: h('y') }));
});

test('Fristen ändern: Reihenfolge, delete_after folgt', async () => {
  const e = await Env.make();
  const r = await e.round();
  const [s, d] = await e.call('PATCH', `/rounds/${r.id}`, { eventDate: e.now + 30 * DAY }, r.admin);
  eq(200, s);
  eq(e.now + 44 * DAY, d.round.deleteAfter);
  eq(400, await e.status('PATCH', `/rounds/${r.id}`, { wishDeadline: e.now + 40 * DAY }, r.admin));
  const [s2, d2] = await e.call('PATCH', `/rounds/${r.id}`, {}, r.admin);
  eq([400, 'nothing'], [s2, d2.error]);
});

test('Runde löschen: alles weg, Links tot', async () => {
  const e = await Env.make();
  const r = await e.round();
  const auth = await e.claim(await e.person(r));
  eq(204, await e.status('DELETE', `/rounds/${r.id}`, null, r.admin));
  eq(0, e.count('SELECT COUNT(*) FROM rounds'));
  eq(0, e.count('SELECT COUNT(*) FROM participants'));
  eq(404, await e.status('GET', '/me', null, auth));
  eq(404, await e.status('GET', `/rounds/${r.id}/admin`, null, r.admin));
});

test('Cleanup: Wichteldatum + 14 Tage, verwaiste Runden nach 30 Tagen', async () => {
  const e = await Env.make();
  const keep = await e.round();
  await e.claim(await e.person(keep));
  const orphan = await e.round('schrott');
  await e.person(orphan); // nie eingelöst
  e.now += 31 * DAY;
  eq(1, e.s.cleanup(e.now).rounds, 'verwaiste Runde gelöscht');
  eq(1, e.count('SELECT COUNT(*) FROM rounds'));
  eq(0, e.s.cleanup(T0 + 34 * DAY - 1).rounds, 'vor Ablauf bleibt sie');
  eq(1, e.s.cleanup(T0 + 34 * DAY).rounds, 'Wichteldatum + 14 Tage');
  eq(0, e.count('SELECT COUNT(*) FROM participants'));
});

test('Lazy-Cleanup läuft höchstens alle 10 Minuten', async () => {
  const e = await Env.make({ lazy: true });
  const meta = () => e.s.sqlValue("SELECT value FROM meta WHERE key = 'last_cleanup'");
  await e.call('GET', '/info');
  const t1 = meta();
  eq(String(e.now), t1);
  e.now += 60;
  await e.call('GET', '/info');
  eq(t1, meta());
  e.now += 600;
  await e.call('GET', '/info');
  eq(String(e.now), meta());
});

test('Rate-Limit: Einlösen begrenzt, IP nicht gespeichert', async () => {
  const e = await Env.make({ rateLimits: { claim: [3, 3600] } });
  for (let i = 0; i < 3; i++) eq(401, await e.status('POST', '/invite/claim', {}, null, '203.0.113.9'));
  const [s, d] = await e.call('POST', '/invite/claim', {}, null, '203.0.113.9');
  eq([429, 'rate_limited', 'Zu viele Anfragen. Bitte später erneut versuchen.'], [s, d.error, d.message]);
  eq(401, await e.status('POST', '/invite/claim', {}, null, '203.0.113.10'), 'andere IP unberührt');
  ok(!JSON.stringify(e.sql('SELECT * FROM rate_limits')).includes('203.0.113'), 'IP darf nicht gespeichert werden');
});

test('Unbekannter Endpunkt und Fehlerformat', async () => {
  const e = await Env.make();
  const [s, d] = await e.call('GET', '/gibtsnicht');
  eq([404, 'not_found', 'Unbekannter Endpunkt.'], [s, d.error, d.message]);
  eq(404, await e.status('OPTIONS', '/info'));
  eq(200, await e.status('GET', '/info/'), 'Schrägstrich am Ende');
});

test('Statusabhängigkeiten: nach Ziehung keine neuen Personen', async () => {
  const e = await Env.make();
  const r = await e.round();
  e.s.exec(`UPDATE rounds SET status = 'gezogen' WHERE id = '${r.id}'`);
  const [s, d] = await e.call('POST', `/rounds/${r.id}/participants`, { id: nid(), inviteHash: h('x'), inviteCt: ct(), nameCt: ct() }, r.admin);
  eq([409, 'wrong_status', 'Die Ziehung ist bereits erfolgt.'], [s, d.error, d.message]);
  eq(409, await e.status('PATCH', `/rounds/${r.id}`, { rsvpDeadline: e.now + 100 }, r.admin));
  eq(200, await e.status('PATCH', `/rounds/${r.id}`, { metaCt: ct() }, r.admin), 'Texte bleiben änderbar');
});

// ---------------------------------------------------------------- Ziehung, Wünsche, Wichtelpost

test('Schlüssel: nur angenommen + dabei', async () => {
  const e = await Env.make();
  const r = await e.round();
  const a = await e.person(r);
  const aa = await e.claim(a);
  const b = await e.person(r);
  const ba = await e.claim(b);
  await e.person(r); // nicht eingelöst
  await e.call('PUT', '/me/rsvp', { rsvp: 'dabei' }, aa);
  await e.call('PUT', '/me/rsvp', { rsvp: 'raus' }, ba);
  const [s, d] = await e.call('GET', `/rounds/${r.id}/keys`, null, r.admin);
  eq(200, s);
  eq([a.pid], d.keys.map((k) => k.id));
  ok(typeof d.keys[0].pubkey === 'string', 'pubkey');
});

test('Ziehung: Validierung der Teilnehmendenmenge und Postfächer', async () => {
  const e = await Env.make();
  const r = await e.round();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const p = await e.person(r);
    await e.call('PUT', '/me/rsvp', { rsvp: 'dabei' }, await e.claim(p));
    ids.push(p.pid);
  }
  const boxes = (n) => Array.from({ length: n }, () => ({ id: nid(), giverHash: h(nid()), receiverHash: h(nid()) }));
  const url = `/rounds/${r.id}/draw`;
  eq(409, await e.status('PUT', url, drawBody(ids.slice(0, 2), boxes(2)), r.admin), 'fehlende Person');
  eq(409, await e.status('PUT', url, drawBody([...ids, nid()], boxes(4)), r.admin), 'fremde Person');
  eq(409, await e.status('PUT', url, drawBody([ids[0], ids[0], ids[1]], boxes(3)), r.admin), 'doppelte Person');
  eq(400, await e.status('PUT', url, drawBody(ids, boxes(2)), r.admin), 'Postfachzahl');
  eq(400, await e.status('PUT', url, { participants: 'x', mailboxes: [] }, r.admin));
  eq(400, await e.status('PUT', url, { participants: [1, 2, 3], mailboxes: [] }, r.admin), 'Einträge keine Objekte');
  eq(200, await e.status('PUT', url, drawBody(ids, boxes(3)), r.admin));
  const [, d] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  eq('gezogen', d.round.status);
  eq(3, e.count('SELECT COUNT(*) FROM mailboxes'));
  eq(200, await e.status('PUT', url, drawBody(ids, boxes(3)), r.admin), 'Neuziehung');
  eq(3, e.count('SELECT COUNT(*) FROM mailboxes'), 'Neuziehung ersetzt Postfächer');
  e.now += 11 * DAY;
  eq(409, await e.status('PUT', url, drawBody(ids, boxes(3)), r.admin), 'nach der Wunschfrist');
});

test('Ziehung: zu wenige Zusagen, Schrottwichteln, Zusage nach Ziehung gesperrt', async () => {
  const e = await Env.make();
  const r = await e.round();
  const p = await e.person(r);
  await e.call('PUT', '/me/rsvp', { rsvp: 'dabei' }, await e.claim(p));
  const [s0, d0] = await e.call('PUT', `/rounds/${r.id}/draw`, { participants: [{ id: p.pid, assignmentCt: ct(), mailboxkeyCt: ct() }], mailboxes: [{ id: nid(), giverHash: h('a'), receiverHash: h('b') }] }, r.admin);
  eq([409, 'too_few'], [s0, d0.error]);
  const sr = await e.round('schrott');
  const [s1, d1] = await e.call('PUT', `/rounds/${sr.id}/draw`, { participants: [], mailboxes: [] }, sr.admin);
  eq([409, 'wrong_mode'], [s1, d1.error]);
  const [, people] = await drawnRound(e);
  eq(409, await e.status('PUT', '/me/rsvp', { rsvp: 'raus' }, people[0].auth));
});

test('/me liefert versiegelte Zuordnung und Postfachschlüssel', async () => {
  const e = await Env.make();
  const [, people] = await drawnRound(e);
  const [s, d] = await e.call('GET', '/me', null, people[0].auth);
  eq(200, s);
  ok(d.me.assignmentCt.startsWith('s1.'), 'assignmentCt');
  ok(d.me.mailboxkeyCt.startsWith('s1.'), 'mailboxkeyCt');
  ok(Number.isInteger(d.round.drawnAt), 'drawnAt');
  eq({ invited: 3, dabei: 3 }, d.counts);
});

test('Wünsche: speichern bis Frist, nicht wenn raus, nicht beim Schrottwichteln', async () => {
  const e = await Env.make();
  const r = await e.round();
  const auth = await e.claim(await e.person(r));
  eq(204, await e.status('PUT', '/me/wishes', { wishCt: ct(300) }, auth), 'auch vor Zusage');
  await e.call('PUT', '/me/rsvp', { rsvp: 'raus' }, auth);
  eq(409, await e.status('PUT', '/me/wishes', { wishCt: ct() }, auth));
  await e.call('PUT', '/me/rsvp', { rsvp: 'dabei' }, auth);
  eq(400, await e.status('PUT', '/me/wishes', { wishCt: `v1.${'A'.repeat(50000)}` }, auth), 'zu lang');
  e.now += 11 * DAY;
  eq(409, await e.status('PUT', '/me/wishes', { wishCt: ct() }, auth), 'nach Frist');
  const e2 = await Env.make();
  const s = await e2.round('schrott');
  eq(409, await e2.status('PUT', '/me/wishes', { wishCt: ct() }, await e2.claim(await e2.person(s))));
});

test('Wichtelpost: Rollen, Wunschübergabe, Nachrichten, Fristen', async () => {
  const e = await Env.make();
  const [, people] = await drawnRound(e);
  const p = people[0];
  const g = `g.${p.mid}.${p.gTok}`;
  const rcv = `r.${p.mid}.${p.rTok}`;
  eq(404, await e.status('GET', '/mailbox', null, `g.${p.mid}.${p.rTok}`), 'falsches Token für Rolle');
  eq(401, await e.status('GET', '/mailbox', null, `p.${p.mid}.${p.gTok}`));
  eq(401, await e.status('PUT', '/mailbox/wish', { wishCt: ct() }, g), 'Wichtel darf Wünsche nicht schreiben');
  eq(204, await e.status('PUT', '/mailbox/wish', { wishCt: ct(200) }, rcv));
  eq(201, await e.status('POST', '/mailbox/messages', { bodyCt: ct() }, g));
  eq(201, await e.status('POST', '/mailbox/messages', { bodyCt: ct() }, rcv));
  const [s, d] = await e.call('GET', '/mailbox', null, g);
  eq(200, s);
  ok(typeof d.wishCt === 'string', 'Wunsch sichtbar');
  eq(Math.floor(e.now / DAY), d.wishDay);
  eq(['frage', 'antwort'], d.messages.map((m) => m.direction));
  eq(Math.floor(e.now / DAY), d.messages[0].day);
  e.now += 11 * DAY;
  eq(409, await e.status('PUT', '/mailbox/wish', { wishCt: ct() }, rcv));
  const q = people[1];
  eq(204, await e.status('PUT', '/mailbox/wish', { wishCt: ct() }, `r.${q.mid}.${q.rTok}`), 'erste Übergabe nach Frist');
  e.now += 10 * DAY; // Wichteldatum + 1 Tag
  if (IMPL === 'php') eq(409, await e.status('POST', '/mailbox/messages', { bodyCt: ct() }, g), 'nach Wichteldatum');
  else {
    eq(201, await e.status('POST', '/mailbox/messages', { bodyCt: ct() }, g), 'eine Woche nach dem Wichteldatum noch offen');
    e.now += 7 * DAY;
    eq(409, await e.status('POST', '/mailbox/messages', { bodyCt: ct() }, g), 'danach geschlossen');
  }
});

test('Wichtelpost: höchstens 100 Nachrichten', async () => {
  const e = await Env.make();
  const [, people] = await drawnRound(e);
  const g = `g.${people[0].mid}.${people[0].gTok}`;
  for (let i = 0; i < 100; i++) await e.call('POST', '/mailbox/messages', { bodyCt: ct() }, g);
  const [s, d] = await e.call('POST', '/mailbox/messages', { bodyCt: ct() }, g);
  eq([409, 'too_many'], [s, d.error]);
});

test('Neu einladen nach Ziehung setzt Ziehung zurück, Person bleibt dabei', async () => {
  const e = await Env.make();
  const [r, people] = await drawnRound(e);
  const p = people[2];
  const [s, d] = await e.call('POST', `/rounds/${r.id}/participants/${p.pid}/reinvite`, { inviteHash: h(nid()), inviteCt: ct() }, r.admin);
  eq(200, s);
  eq(true, d.drawReset);
  eq(0, e.count('SELECT COUNT(*) FROM mailboxes'));
  eq(0, e.count('SELECT COUNT(*) FROM participants WHERE assignment_ct IS NOT NULL'));
  eq('dabei', e.sql('SELECT rsvp FROM participants WHERE id = ?', p.pid)[0].rsvp);
  const [, v] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  eq('offen', v.round.status);
  eq(404, await e.status('GET', '/mailbox', null, `g.${people[0].mid}.${people[0].gTok}`));
});

test('Löschen entfernt auch Postfächer und Nachrichten', async () => {
  const e = await Env.make();
  const [r, people] = await drawnRound(e);
  await e.call('POST', '/mailbox/messages', { bodyCt: ct() }, `g.${people[0].mid}.${people[0].gTok}`);
  eq(204, await e.status('DELETE', `/rounds/${r.id}`, null, r.admin));
  eq(0, e.count('SELECT COUNT(*) FROM mailboxes'));
  eq(0, e.count('SELECT COUNT(*) FROM messages'));
});

// ---------------------------------------------------------------- E-Mail

test('E-Mail: Verfügbarkeit, ohne Mailer nicht einschaltbar', async () => {
  const e = await Env.make({ mail: false });
  eq(false, (await e.call('GET', '/info'))[1].emailAvailable);
  const [s, d] = await e.call('POST', '/rounds', { organizerCode: e.code(), id: nid(), adminHash: h('x'), mode: 'schrott', rsvpDeadline: e.now + 100, eventDate: e.now + 1000, metaCt: ct(), emailEnabled: true });
  eq([409, 'email_unavailable'], [s, d.error]);
  const e2 = await Env.make();
  const [, info] = await e2.call('GET', '/info');
  eq(true, info.emailAvailable);
  eq(null, info.mailProvider);
  eq(true, info.requireOrganizerCode);
  eq(50, info.maxParticipants);
  eq(e2.now, info.now);
});

test('E-Mail: Adresse und Titel nur verschlüsselt in der Datenbank', async () => {
  const e = await Env.make();
  const r = await e.mailRound('Geheime Weihnacht');
  await e.person(r, 'anna.geheim@example.org');
  const dump = JSON.stringify(e.sql('SELECT * FROM participants')) + JSON.stringify(e.sql('SELECT * FROM rounds'));
  ok(!dump.includes('anna.geheim'), 'Adresse im Klartext');
  ok(!dump.includes('Geheime Weihnacht'), 'Titel im Klartext');
  const [, d] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  eq('Geheime Weihnacht', d.round.mailTitle);
  eq(true, d.participants[0].hasEmail);
  ok(typeof d.participants[0].emailViewCt === 'string', 'Anzeige-Chiffrat');
});

test('E-Mail: ungültige Adressen, Modus aus, Adresse ändern und löschen', async () => {
  const e = await Env.make();
  const r = await e.mailRound();
  for (const bad of ['kein-at', 'a@b.de\r\nBcc: x@y.de', 'a b@c.de', `${'a'.repeat(250)}@b.de`, 'x@localhost', 'ä@b.de', 42]) {
    eq(400, await e.status('POST', `/rounds/${r.id}/participants`, { id: nid(), inviteHash: h('x'), inviteCt: ct(), nameCt: ct(), email: bad, emailViewCt: ct() }, r.admin), `Adresse ${bad}`);
  }
  const p = await e.person(r);
  eq(204, await e.status('PUT', `/rounds/${r.id}/participants/${p.pid}/email`, { email: ' b@example.org ', emailViewCt: ct() }, r.admin));
  eq(1, e.count('SELECT COUNT(*) FROM participants WHERE email_ct IS NOT NULL'));
  eq(200, await e.status('PATCH', `/rounds/${r.id}`, { emailEnabled: false }, r.admin));
  eq(0, e.count('SELECT COUNT(*) FROM participants WHERE email_ct IS NOT NULL'), 'Modus aus → alle Adressen weg');
  const [s, d] = await e.call('PUT', `/rounds/${r.id}/participants/${p.pid}/email`, { email: 'b@example.org', emailViewCt: ct() }, r.admin);
  eq([409, 'email_disabled'], [s, d.error]);
});

test('E-Mail: Einladung verschicken – nur mit passendem, aktuellem Link', async () => {
  const e = await Env.make();
  const r = await e.mailRound('Bürowichteln');
  const p = await e.person(r, 'c@example.org');
  const k = b64u(crypto.randomBytes(32));
  const good = `https://zw.example/#i/${r.id}/${p.pid}/${p.tok}/${k}`;
  const send = (link) => e.status('POST', '/mail/link', { kind: 'invite', pid: p.pid, link }, r.admin);
  eq(400, await send(`https://boese.example/#i/${r.id}/${p.pid}/${p.tok}/${k}`), 'fremde Domain');
  eq(400, await send(`https://zw.example/#i/${r.id}/${p.pid}/${nid()}/${k}`), 'falsches Token');
  eq(400, await send(`${good}x`), 'Anhang');
  // PHP ließ wegen „$“ in PCRE einen Zeilenumbruch am Ende durch; die Node-Version ist hier strenger.
  if (IMPL === 'node') eq(400, await send(`${good}\n`), 'Zeilenumbruch am Ende');
  eq(200, await send(good));
  const mails = e.s.mails();
  eq(1, mails.length);
  eq('c@example.org', mails[0].to);
  eq('ZeroWichtel: Einladung zum Wichteln – Bürowichteln', mails[0].subject);
  ok(mails[0].text.includes(good), 'Link im Text');
  ok(mails[0].text.includes('Alle Daten der Runde werden spätestens am 05.12.2026 endgültig gelöscht.'), 'Löschdatum im Text');
  await e.claim(p);
  eq(400, await send(good), 'nach dem Einlösen nicht mehr');
  const dump = JSON.stringify(e.sql('SELECT * FROM participants')) + JSON.stringify(e.sql('SELECT * FROM meta'));
  ok(!dump.includes(k), 'Schlüssel gespeichert');
});

test('E-Mail: eigener Link, Admin-Link, Abbestellen, Adresse löschen', async () => {
  const e = await Env.make();
  const r = await e.mailRound();
  const p = await e.person(r, 'd@example.org');
  const access = nid();
  eq(200, await e.status('POST', '/invite/claim', { accessHash: h(access), pubkey: b64u(crypto.randomBytes(32)), recoveryHash: h(nid()), recoveryCt: ct() }, p.invite));
  const auth = `p.${p.pid}.${access}`;
  const k = b64u(crypto.randomBytes(32));
  const own = `https://zw.example/#p/${r.id}/${p.pid}/${access}/${k}/${k}`;
  eq(400, await e.status('POST', '/mail/link', { kind: 'personal', link: `https://zw.example/#p/${r.id}/${p.pid}/${nid()}/${k}/${k}` }, auth));
  eq(200, await e.status('POST', '/mail/link', { kind: 'personal', link: own }, auth));
  const adminLink = `https://zw.example/#a/${r.id}/${r.tok}/${k}/${k}`;
  eq(400, await e.status('POST', '/mail/link', { kind: 'admin', link: adminLink, email: 'nix' }, r.admin));
  eq(200, await e.status('POST', '/mail/link', { kind: 'admin', link: adminLink, email: 'orga@example.org' }, r.admin));
  const mails = e.s.mails();
  eq(['d@example.org', 'orga@example.org'], mails.map((m) => m.to));
  eq('ZeroWichtel: Dein persönlicher Link – Familie M.', mails[0].subject);
  eq('ZeroWichtel: Dein Admin-Link', mails[1].subject, 'ohne Mail-Titel der Runde (SEC-002)');
  ok(!mails[1].text.includes('Familie M.'), 'Mail-Titel nicht im Text der Admin-Link-Mail');
  const dump = JSON.stringify(e.sql('SELECT * FROM participants')) + JSON.stringify(e.sql('SELECT * FROM rounds'));
  ok(!dump.includes('orga@'), 'Admin-Adresse darf nicht gespeichert werden');
  let [, d] = await e.call('GET', '/me', null, auth);
  eq([true, true], [d.me.hasEmail, d.me.notify]);
  eq(200, await e.status('PUT', '/me/notify', { notify: false }, auth));
  eq(400, await e.status('PUT', '/me/notify', { notify: 'nein' }, auth));
  eq(204, await e.status('DELETE', '/me/email', null, auth));
  [, d] = await e.call('GET', '/me', null, auth);
  eq([false, false], [d.me.hasEmail, d.me.notify]);
  const [s, x] = await e.call('POST', '/mail/link', { kind: 'personal', link: own }, auth);
  eq([409, 'no_email'], [s, x.error]);
});

test('E-Mail: Rate-Limit für Linkversand', async () => {
  const e = await Env.make({ rateLimits: { mail: [2, 3600] } });
  const r = await e.mailRound();
  const k = b64u(crypto.randomBytes(32));
  const body = { kind: 'admin', link: `https://zw.example/#a/${r.id}/${r.tok}/${k}/${k}`, email: 'o@example.org' };
  eq(200, await e.status('POST', '/mail/link', body, r.admin));
  eq(200, await e.status('POST', '/mail/link', body, r.admin));
  eq(429, await e.status('POST', '/mail/link', body, r.admin));
});

test('E-Mail: Grenzen je Runde für Admin-Link-Mails und Mails insgesamt (SEC-002)', async () => {
  const e = await Env.make({ rateLimits: { mail: [100, 3600], mail_admin: [2, 86400], mail_round: [3, 86400] } });
  const r = await e.mailRound();
  const k = b64u(crypto.randomBytes(32));
  const body = (n) => ({ kind: 'admin', link: `https://zw.example/#a/${r.id}/${r.tok}/${k}/${k}`, email: `o${n}@example.org` });
  eq(200, await e.status('POST', '/mail/link', body(1), r.admin));
  eq(200, await e.status('POST', '/mail/link', body(2), r.admin));
  eq(429, await e.status('POST', '/mail/link', body(3), r.admin), 'Admin-Link-Mails je Runde begrenzt');
  const p = await e.person(r, 'p@example.org');
  const invite = (pp) => ({ kind: 'invite', pid: pp.pid, link: `https://zw.example/#i/${r.id}/${pp.pid}/${pp.tok}/${k}` });
  eq(200, await e.status('POST', '/mail/link', invite(p), r.admin));
  eq(429, await e.status('POST', '/mail/link', invite(p), r.admin), 'Mails je Runde insgesamt begrenzt');
  const other = await e.mailRound();
  const q = await e.person(other, 'q@example.org');
  eq(200, await e.status('POST', '/mail/link', { kind: 'invite', pid: q.pid, link: `https://zw.example/#i/${other.id}/${q.pid}/${q.tok}/${k}` }, other.admin), 'andere Runde unberührt');
});

test('E-Mail-Prüfung im Server: Angriffsmuster werden sofort abgelehnt (SEC-001)', async () => {
  const e = await Env.make();
  const r = await e.mailRound();
  const k = b64u(crypto.randomBytes(32));
  const link = `https://zw.example/#a/${r.id}/${r.tok}/${k}/${k}`;
  const t0 = Date.now();
  eq(400, await e.status('POST', '/mail/link', { kind: 'admin', link, email: `a@${'a.'.repeat(120)}!` }, r.admin));
  eq(400, await e.status('POST', `/rounds/${r.id}/participants`, { id: nid(), inviteHash: h(nid()), inviteCt: ct(), nameCt: ct(), email: `a@${'a.'.repeat(120)}!`, emailViewCt: ct() }, r.admin));
  ok(Date.now() - t0 < 2000, `Server antwortet zügig (${Date.now() - t0} ms)`);
  eq(200, await e.status('GET', '/info'), 'Server reagiert weiter');
});

test('Benachrichtigungen: Antwortfrist, Ziehung, Wunschfrist, Wichtelpost – je einmal', async () => {
  const e = await Env.make();
  const r = await e.mailRound('Test');
  const people = [];
  for (const mail of ['a@example.org', 'b@example.org', 'c@example.org', null]) {
    const p = await e.person(r, mail);
    p.auth = await e.claim(p);
    people.push(p);
  }
  const run = async () => (await e.s.notify(e.now)).sent;
  eq(0, await run(), 'weit vor der Frist: nichts');
  await e.call('PUT', '/me/rsvp', { rsvp: 'dabei' }, people[0].auth);
  e.now += 4 * DAY;
  eq(2, await run(), 'Erinnerung Antwortfrist an b und c');
  eq(0, await run(), 'nur einmal');
  await e.call('PUT', '/me/notify', { notify: false }, people[1].auth);
  for (const i of [1, 2, 3]) await e.call('PUT', '/me/rsvp', { rsvp: 'dabei' }, people[i].auth);
  const tok = people.map(() => [nid(), nid(), nid()]);
  const body = drawBody(people, tok.map(([mid, g, rr]) => ({ id: mid, giverHash: h(g), receiverHash: h(rr) })));
  eq(200, await e.status('PUT', `/rounds/${r.id}/draw`, body, r.admin));
  const before = e.s.mails().length;
  eq(2, await run(), 'Hinweis Ziehung an a und c (b abbestellt, d ohne Adresse)');
  eq('ZeroWichtel: Es wurde ausgelost – Test', e.s.mails()[before].subject);
  eq(0, await run());
  await e.call('POST', '/mailbox/messages', { bodyCt: ct() }, `g.${tok[0][0]}.${tok[0][1]}`);
  eq(2, await run(), 'Tageshinweis');
  await e.call('POST', '/mailbox/messages', { bodyCt: ct() }, `g.${tok[1][0]}.${tok[1][1]}`);
  eq(0, await run(), 'am selben Tag kein zweiter');
  e.now += DAY;
  eq(2, await run(), 'am nächsten Tag für die neue Nachricht');
  e.now = T0 + 9 * DAY;
  eq(2, await run(), 'Erinnerung Wunschfrist');
  eq(0, await run());
  for (const m of e.s.mails()) {
    const links = [...m.text.matchAll(/https:\/\/zw\.example\/#(\S*)/g)].map((x) => x[1]);
    eq(1, links.length, 'genau ein Direktlink je Mail');
    ok(/^zu\/[A-Za-z0-9_-]{22}$/.test(links[0]), `Erinnerungen enthalten keine Schlüssel-Links: ${links[0]}`);
  }
  const subjects = [...new Set(e.s.mails().map((m) => m.subject))].sort();
  eq(['ZeroWichtel: Bist du dabei? – Test', 'ZeroWichtel: Es wurde ausgelost – Test', 'ZeroWichtel: Neue Wichtelpost – Test', 'ZeroWichtel: Wunschliste prüfen – Test'], subjects);
});

test('Benachrichtigungen: nicht im ausgeschalteten E-Mail-Modus', async () => {
  const e = await Env.make();
  const r = await e.mailRound();
  await e.claim(await e.person(r, 'x@example.org'));
  await e.call('PATCH', `/rounds/${r.id}`, { emailEnabled: false }, r.admin);
  e.now += 4 * DAY;
  eq(0, (await e.s.notify(e.now)).sent);
});

test('Mailtexte: Wortlaut identisch (Einladung, Erinnerungen, Ziehung)', async () => {
  const e = await Env.make();
  const [r, people] = await drawnMailRound(e);
  await e.s.notify(e.now);
  const notice = e.s.mails().find((m) => m.to === 'a@example.org');
  eq([
    'Hallo!',
    '',
    'Bei der Wichtelrunde „Test“ wurde ausgelost. Öffne deine Seite, um zu sehen, wen du beschenkst.',
    '',
    'Direkt zu deiner Seite:',
    `https://zw.example/#zu/${people[0].pid}`,
    '(Funktioniert auf dem Gerät, auf dem du die Einladung angenommen hast. Auf anderen Geräten öffne deinen persönlichen Link oder nutze deinen Wiederherstellungscode.)',
    '',
    'Wichtig: Erst wenn du deine Seite einmal geöffnet hast, sieht dein Wichtel deine Wunschliste.',
    'Wünsche kannst du bis zum 11.11.2026 ändern.',
    '–',
    'Diese Nachricht hat ZeroWichtel (https://zw.example) automatisch verschickt. Bitte nicht antworten.',
    'Keine Erinnerungen mehr? Öffne deinen persönlichen Link und schalte unter „E-Mail“ die Erinnerungen aus.',
    'Alle Daten der Runde werden spätestens am 05.12.2026 endgültig gelöscht.',
  ].join('\n'), notice.text);
  await e.call('POST', `/rounds/${r.id}/participants/${people[1].pid}/remind`, {}, r.admin);
  const rem = e.s.mails().at(-1);
  eq('ZeroWichtel: Erinnerung: Es wurde ausgelost – Test', rem.subject);
  ok(rem.text.startsWith('Hallo!\n\nBei der Wichtelrunde „Test“ wurde schon ausgelost – du hast aber noch nicht nachgesehen, wen du beschenkst.\n'), 'Erinnerung Wortlaut');
  ok(rem.text.includes(`#zu/${people[1].pid}\n(Funktioniert`), 'Direktlink');
  ok(rem.text.includes('\n\nWünsche kannst du bis zum 11.11.2026 ändern.\n–\n'), 'Wunschfrist');
});

test('ServerCrypto: Bindung an Zweck und Manipulationsschutz', async () => {
  const e = await Env.make();
  const t = e.s.serverCrypto('seal', 'k', 'a@b.de', 'email|P1');
  ok(t.startsWith('x1.'), 'Format');
  eq('a@b.de', e.s.serverCrypto('open', 'k', t, 'email|P1'));
  eq(null, e.s.serverCrypto('open', 'k', t, 'email|P2'));
  eq(null, e.s.serverCrypto('open', 'j', t, 'email|P1'));
  eq(null, e.s.serverCrypto('open', 'k', `${t.slice(0, -2)}AA`, 'email|P1'));
  eq(null, e.s.serverCrypto('open', 'k', 'quatsch', 'email|P1'));
});

test('Schema: Upgrade einer bestehenden Version-1-Datenbank auf die aktuelle Version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zw-mig-'));
  const file = join(dir, 'v1.sqlite');
  const db = new DatabaseSync(file);
  db.exec(V1_SCHEMA);
  db.exec('PRAGMA user_version = 1');
  db.exec("INSERT INTO rounds (id, mode, admin_hash, rsvp_deadline, event_date, delete_after, meta_ct, created_at) VALUES ('r', 'schrott', 'h', 1, 2, 3, 'v1.x', 0)");
  db.close();
  try {
    const e = await Env.make({ dbPath: file });
    await e.call('GET', '/info');
    eq(SCHEMA, e.count('PRAGMA user_version'));
    eq(0, e.count("SELECT digest_msg_id FROM rounds WHERE id = 'r'"), 'neue Spalte mit Standardwert');
    const cols = e.sql('PRAGMA table_info(participants)').map((c) => c.name);
    ok(cols.includes('email_view_ct') && cols.includes('draw_seen'), 'neue Spalten');
  } finally {
    for (const x of envs) x.s.stop();
    envs = [];
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- Admin-Bereich

const PW = 'korrekt pferd batterie heftklammer';
async function adminEnv(enabled = true) {
  const env = await Env.make({ admin: enabled });
  return { env, pw: PW, ...env.s.adminSetup(PW, env.now) };
}
function adminLogin(a, code = null, pw = null, ip = '10.0.0.9') {
  return a.env.call('POST', `/admin/${a.slug}/login`, { password: pw ?? a.pw, code: code ?? totpCode(a.secret, Math.floor(a.env.now / 30)) }, null, ip);
}

test23('Anlegen ohne Code: Admin-Einstellung, Obergrenze gleichzeitiger Runden, mit Code geht immer', async () => {
  const a = await adminEnv();
  const e = a.env;
  const [, d] = await adminLogin(a);
  const session = d.session;
  const body = (over = {}) => {
    const id = nid();
    const tok = nid();
    const b = { id, adminHash: h(tok), mode: 'schrott', rsvpDeadline: e.now + DAY, eventDate: e.now + 3 * DAY, metaCt: ct(), ...over };
    Object.defineProperty(b, 'auth', { value: `a.${id}.${tok}`, enumerable: false });
    return b;
  };
  let [, info] = await e.call('GET', '/info');
  eq([true, false], [info.requireOrganizerCode, info.openCreation.available], 'Standard: aus');
  eq(403, await e.status('POST', '/rounds', body(), null, `10.7.0.${++openIp}`), 'ohne Code abgelehnt');
  // Einstellung: nur mit Admin-Sitzung, Werte geprüft
  eq(401, await e.status('PUT', `/admin/${a.slug}/open`, { enabled: true, maxRounds: 2, email: false }));
  eq(400, await e.status('PUT', `/admin/${a.slug}/open`, { enabled: true, maxRounds: 0, email: false }, session));
  eq(400, await e.status('PUT', `/admin/${a.slug}/open`, { enabled: 'ja', maxRounds: 2, email: false }, session));
  let [s, o] = await e.call('PUT', `/admin/${a.slug}/open`, { enabled: true, maxRounds: 2, email: false }, session);
  eq([200, true, 2, 0, 2], [s, o.openCreation.enabled, o.openCreation.maxRounds, o.openCreation.used, o.openCreation.free]);
  [, info] = await e.call('GET', '/info');
  eq([false, true, false], [info.requireOrganizerCode, info.openCreation.available, info.openCreation.email]);
  ok(!('free' in info.openCreation) && !('used' in info.openCreation), 'keine Zahlen öffentlich');
  // E-Mail ohne Code gesperrt
  const [s1, x1] = await e.call('POST', '/rounds', body({ emailEnabled: true }), null, `10.7.0.${++openIp}`);
  eq([409, 'email_needs_code'], [s1, x1.error]);
  const first = body();
  eq(201, await e.status('POST', '/rounds', first, null, `10.7.0.${++openIp}`));
  eq(201, await e.status('POST', '/rounds', body(), null, `10.7.0.${++openIp}`));
  const [s2, x2] = await e.call('POST', '/rounds', body(), null, `10.7.0.${++openIp}`);
  eq([403, 'open_full'], [s2, x2.error], 'Obergrenze erreicht');
  [, info] = await e.call('GET', '/info');
  eq([true, false], [info.requireOrganizerCode, info.openCreation.available]);
  eq(201, await e.status('POST', '/rounds', body({ organizerCode: e.code() }), null, `10.7.0.${++openIp}`), 'mit Code geht immer');
  eq(1, e.count('SELECT COUNT(*) FROM rounds WHERE without_code = 0'));
  // Löschen gibt einen Platz frei
  eq(204, await e.status('DELETE', `/rounds/${first.id}`, null, first.auth));
  eq(201, await e.status('POST', '/rounds', body(), null, `10.7.0.${++openIp}`), 'Platz wieder frei');
  // Ausschalten, Protokoll
  eq(200, await e.status('PUT', `/admin/${a.slug}/open`, { enabled: false, maxRounds: 2, email: false }, session));
  eq(403, await e.status('POST', '/rounds', body(), null, `10.7.0.${++openIp}`));
  const [, ov] = await e.call('GET', `/admin/${a.slug}/overview`, null, session);
  eq([false, 2, 2], [ov.openCreation.enabled, ov.openCreation.used, ov.stats.roundsWithoutCode]);
  ok(ov.log.some((l) => l.event === 'Anlegen ohne Code' && /höchstens 2/.test(l.detail)), 'protokolliert');
});

test23('Anlegen ohne Code mit E-Mail erlaubt; nachträgliches Einschalten bei gesperrter E-Mail abgelehnt', async () => {
  const a = await adminEnv();
  const e = a.env;
  const [, d] = await adminLogin(a);
  eq(200, await e.status('PUT', `/admin/${a.slug}/open`, { enabled: true, maxRounds: 5, email: false }, d.session));
  const id = nid();
  const tok = nid();
  eq(201, await e.status('POST', '/rounds', { id, adminHash: h(tok), mode: 'schrott', rsvpDeadline: e.now + DAY, eventDate: e.now + 3 * DAY, metaCt: ct() }));
  const [s, x] = await e.call('PATCH', `/rounds/${id}`, { emailEnabled: true }, `a.${id}.${tok}`);
  eq([409, 'email_needs_code'], [s, x.error]);
  eq(false, (await e.call('GET', `/rounds/${id}/admin`, null, `a.${id}.${tok}`))[1].emailAvailable);
  eq(200, await e.status('PUT', `/admin/${a.slug}/open`, { enabled: true, maxRounds: 5, email: true }, d.session));
  eq(201, await e.status('POST', '/rounds', { id: nid(), adminHash: h(nid()), mode: 'schrott', rsvpDeadline: e.now + DAY, eventDate: e.now + 3 * DAY, metaCt: ct(), emailEnabled: true }));
});

test('Admin: ausgeschaltet, nicht eingerichtet oder falscher Pfad = unbekannter Endpunkt', async () => {
  const off = await adminEnv(false);
  const [s, d] = await adminLogin(off);
  eq([404, 'not_found'], [s, d.error]);
  const env = await Env.make({ admin: true });
  eq(404, await env.status('POST', `/admin/${'a'.repeat(26)}/login`, { password: 'x', code: '123456' }), 'nicht eingerichtet');
  const a = await adminEnv();
  eq(404, await a.env.status('POST', `/admin/${'b'.repeat(26)}/login`, { password: a.pw, code: '123456' }), 'falscher Pfad');
  eq(401, await a.env.status('GET', `/admin/${a.slug}/overview`), 'ohne Sitzung');
  ok(/^[a-z2-7]{26}$/.test(a.slug), 'Pfadformat');
});

test('Admin: Anmeldung braucht Passwort UND Code; Sitzung läuft nach 30 Minuten ab', async () => {
  const a = await adminEnv();
  let [s, d] = await adminLogin(a, null, 'falsch falsch falsch');
  eq([401, 'Anmeldung fehlgeschlagen.'], [s, d.message]);
  [s, d] = await adminLogin(a, '000000');
  eq([401, 'Anmeldung fehlgeschlagen.'], [s, d.message], 'gleiche Meldung – verrät nicht, was falsch war');
  [s, d] = await adminLogin(a);
  eq(200, s);
  ok(/^x\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/.test(d.session), 'Sitzungs-Token');
  eq(a.env.now + 1800, d.expiresAt);
  const session = d.session;
  const [s2, o] = await a.env.call('GET', `/admin/${a.slug}/overview`, null, session);
  eq(200, s2);
  eq(0, o.stats.rounds);
  eq(10, o.stats.recoveryLeft);
  eq(null, o.stats.nextDeletion);
  eq('Anmeldung', o.log[0].event);
  eq([a.env.now, a.env.now + 1800], [o.now, o.expiresAt]);
  eq(401, (await adminLogin(a))[0], 'Code-Wiederverwendung');
  a.env.now += 1801;
  const [s3, x] = await a.env.call('GET', `/admin/${a.slug}/overview`, null, session);
  eq([401, 'admin_session'], [s3, x.error]);
  eq(401, await a.env.status('GET', `/admin/${a.slug}/overview`, null, `x.${nid()}.${nid()}`), 'gefälschtes Token');
});

test('Admin: Sperre nach 5 Fehlversuchen, auch mit richtigem Passwort; danach wieder frei', async () => {
  const a = await adminEnv();
  for (let i = 0; i < 5; i++) eq(401, (await adminLogin(a, '000000', null, `10.1.0.${i}`))[0], `Versuch ${i}`);
  const [s, d] = await adminLogin(a);
  eq([429, 'admin_locked'], [s, d.error], 'gesperrt trotz richtiger Daten');
  eq('Zu viele Fehlversuche. Die Anmeldung ist vorübergehend gesperrt – bitte in 15 Minuten erneut versuchen.', d.message);
  a.env.now += 15 * 60 + 1;
  eq(200, (await adminLogin(a))[0], 'nach Ablauf der Sperre');
  const log = a.env.sql('SELECT event FROM admin_log ORDER BY id').map((r) => r.event);
  ok(log.includes('Anmeldung gesperrt (5 Fehlversuche)'), 'Sperre protokolliert');
  eq(4, log.filter((x) => x === 'Fehlgeschlagene Anmeldung').length);
});

test('Admin: Notfallcode funktioniert genau einmal', async () => {
  const a = await adminEnv();
  const rc = a.recovery[3].toLowerCase();
  const [s, d] = await adminLogin(a, rc);
  eq(200, s, 'Notfallcode (Kleinschreibung egal)');
  eq(401, (await adminLogin(a, rc))[0], 'zweites Mal');
  const [, o] = await a.env.call('GET', `/admin/${a.slug}/overview`, null, d.session);
  eq(9, o.stats.recoveryLeft);
  ok(o.log.some((l) => l.event === 'Anmeldung mit Notfallcode (noch 9 übrig)'), 'protokolliert');
  ok(a.recovery.every((c) => /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(c)), 'Format der Notfallcodes');
});

test('Admin: Codes erzeugen, auflisten, widerrufen; erzeugter Code legt Runde an', async () => {
  const a = await adminEnv();
  const [, d] = await adminLogin(a);
  const auth = d.session;
  const env = a.env;
  const [s, c] = await env.call('POST', `/admin/${a.slug}/codes`, { label: ' Familie M. ', rounds: 2, days: 30 }, auth);
  eq(201, s);
  ok(/^ZW-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(c.code), 'Format');
  eq([2, env.now + 30 * DAY], [c.rounds, c.expiresAt]);
  await env.round('wichteln', c.code);
  const [, o] = await env.call('GET', `/admin/${a.slug}/overview`, null, auth);
  eq(1, o.codes.length);
  eq(['Familie M.', 2, 1, 'aktiv'], [o.codes[0].label, o.codes[0].maxRounds, o.codes[0].usedRounds, o.codes[0].status]);
  eq(1, o.stats.rounds);
  eq(1, o.stats.activeCodes);
  eq(env.now + 34 * DAY, o.stats.nextDeletion);
  ok(!JSON.stringify(o).includes(c.code), 'Klartext-Code nie wieder ausgeliefert');
  ok(o.log.some((l) => l.event === 'Code erzeugt' && l.detail === 'Familie M. · 2 Runden · 30 Tage'), 'protokolliert');
  for (const bad of [{ rounds: 0, days: 30 }, { rounds: 2, days: 400 }, { label: 'x'.repeat(61), rounds: 1, days: 1 }, { label: 'a\nb', rounds: 1, days: 1 }, { rounds: 1.5, days: 1 }, { rounds: '1', days: 1 }]) {
    eq(400, await env.status('POST', `/admin/${a.slug}/codes`, bad, auth), JSON.stringify(bad));
  }
  eq(204, await env.status('DELETE', `/admin/${a.slug}/codes/${o.codes[0].ref}`, null, auth));
  eq(403, await env.status('POST', '/organizer/check', { organizerCode: c.code }), 'widerrufen');
  eq(404, await env.status('DELETE', `/admin/${a.slug}/codes/${o.codes[0].ref}`, null, auth));
  eq(204, await env.status('POST', `/admin/${a.slug}/logout`, {}, auth));
  eq(401, await env.status('GET', `/admin/${a.slug}/overview`, null, auth), 'nach Abmeldung');
});

test('Admin: Datenbank enthält weder Passwort noch TOTP-Geheimnis im Klartext', async () => {
  const a = await adminEnv();
  const dump = JSON.stringify(a.env.sql('SELECT * FROM admin')) + JSON.stringify(a.env.sql('SELECT * FROM admin_recovery'));
  ok(!dump.includes(a.secret), 'TOTP-Geheimnis');
  ok(!dump.includes('korrekt pferd'), 'Passwort');
  ok(!dump.includes(a.recovery[0].replaceAll('-', '')) && !dump.includes(a.recovery[0]), 'Notfallcode');
  ok(a.env.s.sqlValue('SELECT pw_hash FROM admin').startsWith('$argon2id$v=19$m=19456,t=2,p=1$'), 'Argon2id mit OWASP-Parametern');
});

test('Admin: neue Adresse und neues Passwort beenden alle Sitzungen', async () => {
  const a = await adminEnv();
  const [, d] = await adminLogin(a);
  const slug = a.env.s.adminNewPath(a.env.now);
  eq(404, await a.env.status('GET', `/admin/${a.slug}/overview`, null, d.session), 'alte Adresse');
  eq(401, await a.env.status('GET', `/admin/${slug}/overview`, null, d.session), 'Sitzung beendet');
});

test('Cleanup: alte Codes, abgelaufene Admin-Sitzungen und Protokoll werden entfernt', async () => {
  const a = await adminEnv();
  await adminLogin(a);
  a.env.s.code(1, 1, a.env.now, 'alt');
  a.env.s.cleanup(a.env.now + 92 * DAY);
  eq(0, a.env.count('SELECT COUNT(*) FROM organizer_codes'));
  eq(0, a.env.count('SELECT COUNT(*) FROM admin_sessions'));
  eq(0, a.env.count('SELECT COUNT(*) FROM admin_log'));
});

// ---------------------------------------------------------------- 1.2: Wer hat die Auslosung angesehen?

async function seenMap(e, r) {
  const [, d] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  return Object.fromEntries(d.participants.map((p) => [p.id, p.drawSeen]));
}

test('Auslosung angesehen: erst nach /me, nur ja/nein, Neuziehung setzt zurück', async () => {
  const e = await Env.make();
  const [r, people] = await drawnRound(e);
  eq(Object.fromEntries(people.map((p) => [p.pid, false])), await seenMap(e, r));
  await e.call('GET', '/me', null, people[1].auth);
  const seen = await seenMap(e, r);
  eq([false, true, false], people.map((p) => seen[p.pid]));
  const [, d] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  ok(!JSON.stringify(d).includes('assignmentCt') && !JSON.stringify(d).includes('mailbox'), 'Admin-Ansicht ohne Zuordnungsdaten');
  ok(d.participants.every((p) => p.inDraw === true && p.drawRemindedAt === null), 'inDraw, drawRemindedAt');
  eq(200, await e.status('PUT', `/rounds/${r.id}/draw`, drawBody(people), r.admin));
  eq([false], [...new Set(Object.values(await seenMap(e, r)))], 'nach Neuziehung wieder „noch nicht“');
});

test('Erinnern per E-Mail: nur gezogen, nicht gesehen, mit Adresse, einmal am Tag; Mail mit Direktlink', async () => {
  const e = await Env.make();
  const [r, people] = await drawnMailRound(e);
  const url = (p) => `/rounds/${r.id}/participants/${p.pid}/remind`;
  const before = e.s.mails().length;
  const [s, d] = await e.call('POST', url(people[0]), {}, r.admin);
  eq(200, s, JSON.stringify(d));
  eq(e.now, d.remindedAt);
  const m = e.s.mails().at(-1);
  eq('a@example.org', m.to);
  ok(m.subject.includes('Erinnerung: Es wurde ausgelost'), 'Betreff');
  ok(m.text.includes(`https://zw.example/#zu/${people[0].pid}`), 'Direktlink zur eigenen Seite');
  ok(!/#[pia]\//.test(m.text), 'kein Schlüssel-Link');
  eq(before + 1, e.s.mails().length);
  const [s1, d1] = await e.call('POST', url(people[0]), {}, r.admin);
  eq([429, 'reminded'], [s1, d1.error], 'heute schon erinnert');
  const [, v] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  eq(e.now, v.participants[0].drawRemindedAt);
  e.now += 21 * 3600;
  eq(200, await e.status('POST', url(people[0]), {}, r.admin), 'am nächsten Tag wieder');
  const [s2, d2] = await e.call('POST', url(people[2]), {}, r.admin);
  eq([409, 'no_email'], [s2, d2.error], 'ohne Adresse');
  await e.call('GET', '/me', null, people[1].auth);
  const [s3, d3] = await e.call('POST', url(people[1]), {}, r.admin);
  eq([409, 'already_seen'], [s3, d3.error], 'schon angesehen');
  eq(401, await e.status('POST', url(people[0]), {}, people[0].auth), 'nur Organisator:in');
  e.now += 21 * 3600;
  await e.call('PUT', '/me/notify', { notify: false }, people[0].auth);
  const [s4, d4] = await e.call('POST', url(people[0]), {}, r.admin);
  eq([409, 'unsubscribed'], [s4, d4.error]);
});

test('Hinweis nach der Ziehung: je Person der eigene Direktlink', async () => {
  const e = await Env.make();
  const [, people] = await drawnMailRound(e);
  const before = e.s.mails().length;
  await e.s.notify(e.now);
  const sent = e.s.mails().slice(before);
  const byTo = Object.fromEntries(sent.map((m) => [m.to, m.text]));
  eq(['a@example.org', 'b@example.org'], sent.map((m) => m.to));
  ok(byTo['a@example.org'].includes(`#zu/${people[0].pid}`) && !byTo['a@example.org'].includes(people[1].pid), 'a bekommt nur den eigenen Link');
  ok(byTo['b@example.org'].includes(`#zu/${people[1].pid}`), 'b bekommt den eigenen Link');
});

// ---------------------------------------------------------------- 2.3: Gruppenlink, Rätselhinweise, Sprache

const joinBody = (name = ct()) => ({
  id: nid(), nameCt: name, accessHash: h(nid()), pubkey: b64u(crypto.randomBytes(32)), recoveryHash: h(nid()), recoveryCt: ct(),
});

test23('Gruppenlink: anlegen, selbst eintragen (angenommen + dabei), Grenzen, widerrufen', async () => {
  const e = await Env.make();
  const r = await e.round();
  const tok = nid();
  const join = `j.${r.id}.${tok}`;
  eq(404, await e.status('GET', '/join', null, join), 'ohne Gruppenlink');
  eq(400, await e.status('PUT', `/rounds/${r.id}/join`, { joinHash: h(tok), joinCt: ct(), until: e.now - 1, max: 5 }, r.admin), 'Ablauf in der Vergangenheit');
  eq(400, await e.status('PUT', `/rounds/${r.id}/join`, { joinHash: h(tok), joinCt: ct(), until: e.now + 30 * DAY, max: 5 }, r.admin), 'nach dem Wichteldatum');
  eq(400, await e.status('PUT', `/rounds/${r.id}/join`, { joinHash: h(tok), joinCt: ct(), until: e.now + DAY, max: 51 }, r.admin), 'zu viele');
  eq(204, await e.status('PUT', `/rounds/${r.id}/join`, { joinHash: h(tok), joinCt: ct(), until: e.now + 4 * DAY, max: 2 }, r.admin));
  let [s, d] = await e.call('GET', '/join', null, join);
  eq([200, 2, r.id], [s, d.free, d.round.id]);
  eq(404, await e.status('GET', '/join', null, `j.${r.id}.${nid()}`), 'falsches Token');
  const a = joinBody();
  eq(201, await e.status('POST', '/join', a, join));
  eq(409, await e.status('POST', '/join', { ...joinBody(), id: a.id }, join), 'doppelte ID');
  eq(201, await e.status('POST', '/join', joinBody(), join));
  [s, d] = await e.call('POST', '/join', joinBody(), join);
  eq([410, 'join_closed'], [s, d.error], 'Höchstzahl erreicht');
  [, d] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  eq([2, true, true, 'dabei', null], [d.participants.length, d.participants[0].viaGroup, d.participants[0].claimed, d.participants[0].rsvp, d.participants[0].inviteCt]);
  eq(2, d.round.join.used);
  eq(e.now + 4 * DAY, d.round.join.until);
  // Persönlicher Zugang funktioniert wie nach dem Einlösen einer Einladung
  const [s2, me] = await e.call('GET', '/me', null, `p.${a.id}.${'x'.repeat(22)}`);
  eq(404, s2, 'falsches Zugangstoken');
  void me;
  // Ablauf, Widerruf, nach der Ziehung
  e.now += 5 * DAY;
  [s, d] = await e.call('GET', '/join', null, join);
  eq([410, 'join_closed'], [s, d.error], 'abgelaufen');
  e.now -= 5 * DAY;
  eq(204, await e.status('DELETE', `/rounds/${r.id}/join`, null, r.admin));
  eq(404, await e.status('GET', '/join', null, join), 'widerrufen');
  [, d] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  eq(null, d.round.join);
  eq(401, await e.status('POST', '/join', joinBody(), `i.${r.id}.${tok}`), 'falsche Rolle');
});

test23('Gruppenlink: Zugang, Zusage und Ziehung wie bei eingeladenen Personen', async () => {
  const e = await Env.make();
  const r = await e.round();
  const tok = nid();
  eq(204, await e.status('PUT', `/rounds/${r.id}/join`, { joinHash: h(tok), joinCt: ct(), until: e.now + 4 * DAY, max: 10 }, r.admin));
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const access = nid();
    const body = { ...joinBody(), accessHash: h(access) };
    eq(201, await e.status('POST', '/join', body, `j.${r.id}.${tok}`));
    const [s, d] = await e.call('GET', '/me', null, `p.${body.id}.${access}`);
    eq([200, 'dabei'], [s, d.me.rsvp]);
    ids.push(body.id);
  }
  eq(3, (await e.call('GET', `/rounds/${r.id}/keys`, null, r.admin))[1].keys.length);
  eq(200, await e.status('PUT', `/rounds/${r.id}/draw`, drawBody(ids), r.admin));
  const [s, d] = await e.call('GET', '/join', null, `j.${r.id}.${tok}`);
  eq([410, 'join_closed'], [s, d.error], 'nach der Ziehung');
});

test23('Rätselhinweise: nur der Wichtel schreibt, Freischaltung nach Zeit, Inhalt vorher nicht sichtbar', async () => {
  const e = await Env.make();
  const [, people] = await drawnRound(e);
  const p = people[0];
  const g = `g.${p.mid}.${p.gTok}`;
  const rcv = `r.${p.mid}.${p.rTok}`;
  const hint = (releaseAt) => ({ id: nid(), bodyCt: ct(), releaseAt });
  eq(401, await e.status('POST', '/mailbox/hints', hint(e.now + DAY), rcv), 'Beschenkte:r darf keine Hinweise schreiben');
  eq(400, await e.status('POST', '/mailbox/hints', hint(e.now + 30 * DAY), g), 'nach dem Wichteldatum');
  const h1 = hint(e.now);
  const h2 = hint(e.now + 2 * DAY);
  eq(201, await e.status('POST', '/mailbox/hints', h1, g));
  eq(201, await e.status('POST', '/mailbox/hints', h2, g));
  let [, d] = await e.call('GET', '/mailbox', null, rcv);
  eq([[h1.id], 1, e.now + 2 * DAY], [d.hints.map((x) => x.id), d.hintsPending, d.nextHintAt], 'nur freigeschaltete');
  ok(!JSON.stringify(d).includes(h2.bodyCt), 'künftiger Inhalt nicht ausgeliefert');
  [, d] = await e.call('GET', '/mailbox', null, g);
  eq(2, d.hints.length, 'Wichtel sieht alle');
  eq(409, await e.status('DELETE', `/mailbox/hints/${h1.id}`, null, g), 'freigeschaltet bleibt');
  eq(204, await e.status('DELETE', `/mailbox/hints/${h2.id}`, null, g));
  for (let i = 0; i < 4; i++) eq(201, await e.status('POST', '/mailbox/hints', hint(e.now + DAY), g));
  eq(409, await e.status('POST', '/mailbox/hints', hint(e.now + DAY), g), 'höchstens 5');
  e.now += DAY;
  [, d] = await e.call('GET', '/mailbox', null, rcv);
  eq([5, 0, null], [d.hints.length, d.hintsPending, d.nextHintAt]);
});

/** Team-Runde: 5 Zusagen, Teamliste gesetzt, Teams gewählt. */
async function teamRound(e, n = 5) {
  const r = await e.round();
  eq(200, await e.status('PATCH', `/rounds/${r.id}`, { teamsCt: ct(300) }, r.admin), 'Teams einschalten');
  const people = [];
  for (let i = 0; i < n; i++) {
    const p = await e.person(r);
    p.auth = await e.claim(p);
    eq(200, await e.status('PUT', '/me/rsvp', { rsvp: 'dabei' }, p.auth));
    eq(204, await e.status('PUT', '/me/team', { teamCt: ct() }, p.auth), 'Team wählen');
    people.push(p);
  }
  return [r, people];
}

test23('Team-Wichteln: Teamliste, Teamwahl durch Person und Organisator:in, nur vor der Ziehung', async () => {
  const e = await Env.make();
  const plain = await e.round();
  const pp = await e.person(plain);
  pp.auth = await e.claim(pp);
  eq(409, await e.status('PUT', '/me/team', { teamCt: ct() }, pp.auth), 'ohne Teamliste kein Team');
  eq(409, await e.status('PUT', `/rounds/${plain.id}/participants/${pp.pid}/team`, { teamCt: ct() }, plain.admin));
  const schrott = await e.round('schrott');
  eq(409, await e.status('PATCH', `/rounds/${schrott.id}`, { teamsCt: ct() }, schrott.admin), 'nicht beim Schrottwichteln');

  const [r, people] = await teamRound(e, 4);
  let [, me] = await e.call('GET', '/me', null, people[0].auth);
  ok(typeof me.round.teamsCt === 'string' && typeof me.me.teamCt === 'string', 'Teamliste und eigenes Team');
  eq(4, me.teamCts.length, 'Teamwahlen aller für die Zählung');
  ok(me.teamCts.every((x) => Object.keys(x).join() === 'id,teamCt'), 'nur ID und Chiffretext, keine Namen');
  const [, adm] = await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  ok(adm.participants.every((p) => typeof p.teamCt === 'string'), 'Organisator:in sieht Teamwahl (verschlüsselt)');
  eq(204, await e.status('PUT', `/rounds/${r.id}/participants/${people[1].pid}/team`, { teamCt: null }, r.admin), 'Organisator:in nimmt aus dem Team');
  eq(204, await e.status('PUT', '/me/team', { teamCt: null }, people[2].auth), 'Person verlässt Team');
  eq(400, await e.status('PUT', '/me/team', { teamCt: 'kein-chiffretext' }, people[0].auth));
  eq(400, await e.status('PUT', '/me/team', { teamCt: ct(600) }, people[0].auth), 'zu lang');
  [, me] = await e.call('GET', '/me', null, people[0].auth);
  eq(2, me.teamCts.length);
  eq(200, await e.status('PUT', '/me/rsvp', { rsvp: 'raus' }, people[3].auth));
  eq(409, await e.status('PUT', '/me/team', { teamCt: ct() }, people[3].auth), 'wer raus ist, wählt kein Team');
  [, me] = await e.call('GET', '/me', null, people[0].auth);
  eq(1, me.teamCts.length, 'Absagen zählen nicht mit');
  // Ausschalten löscht alle Teamwahlen
  eq(200, await e.status('PATCH', `/rounds/${r.id}`, { teamsCt: null }, r.admin));
  eq(0, e.count(`SELECT COUNT(*) FROM participants WHERE round_id = '${r.id}' AND team_ct IS NOT NULL`));
  [, me] = await e.call('GET', '/me', null, people[0].auth);
  eq([null, undefined], [me.round.teamsCt, me.teamCts]);
});

test23('Team-Wichteln: Ziehung mit einem Postfach je Team, Art muss passen, danach gesperrt', async () => {
  const e = await Env.make();
  const [r, people] = await teamRound(e, 5);
  const box = () => ({ id: nid(), giverHash: h(nid()), receiverHash: h(nid()) });
  const body = (n, kind) => ({ ...drawBody(people, Array.from({ length: n }, box)), ...(kind ? { kind } : {}) });
  let [s, d] = await e.call('PUT', `/rounds/${r.id}/draw`, body(5), r.admin);
  eq([409, 'draw_kind'], [s, d.error], 'ältere App (ohne kind) wird abgewiesen');
  eq(400, await e.status('PUT', `/rounds/${r.id}/draw`, body(1, 'team'), r.admin), 'ein Team reicht nicht');
  eq(400, await e.status('PUT', `/rounds/${r.id}/draw`, body(6, 'team'), r.admin), 'mehr Postfächer als Personen');
  eq(200, await e.status('PUT', `/rounds/${r.id}/draw`, body(2, 'team'), r.admin), 'zwei Teams erlaubt');
  eq(200, await e.status('PUT', `/rounds/${r.id}/draw`, body(3, 'team'), r.admin), 'Neuziehung mit drei Teams');
  eq(3, e.count(`SELECT COUNT(*) FROM mailboxes WHERE round_id = '${r.id}'`));
  eq(409, await e.status('PUT', '/me/team', { teamCt: ct() }, people[0].auth), 'nach der Ziehung gesperrt');
  eq(409, await e.status('PUT', `/rounds/${r.id}/participants/${people[0].pid}/team`, { teamCt: ct() }, r.admin));
  eq(409, await e.status('PATCH', `/rounds/${r.id}`, { teamsCt: null }, r.admin), 'Teams nach der Ziehung nicht abschaltbar');
  // Personen-Runde: kind team abgelehnt, Anzahl weiter streng
  const [r2] = await (async () => {
    const x = await e.round();
    const ps = [];
    for (let i = 0; i < 3; i++) { const p = await e.person(x); p.auth = await e.claim(p); await e.call('PUT', '/me/rsvp', { rsvp: 'dabei' }, p.auth); ps.push(p); }
    x.people = ps;
    return [x];
  })();
  eq(409, await e.status('PUT', `/rounds/${r2.id}/draw`, { ...drawBody(r2.people), kind: 'team' }, r2.admin));
  eq(400, await e.status('PUT', `/rounds/${r2.id}/draw`, drawBody(r2.people, [box(), box()]), r2.admin), 'Personen-Runde: Postfach je Person');
  eq(200, await e.status('PUT', `/rounds/${r2.id}/draw`, drawBody(r2.people), r2.admin));
});

test23('Team-Wunschzettel: gemeinsamer Stand, kein stilles Überschreiben', async () => {
  const e = await Env.make();
  const [r, people] = await teamRound(e, 4);
  const m = { id: nid(), g: nid(), r: nid() };
  const m2 = { id: nid(), g: nid(), r: nid() };
  const boxes = [m, m2].map((x) => ({ id: x.id, giverHash: h(x.g), receiverHash: h(x.r) }));
  eq(200, await e.status('PUT', `/rounds/${r.id}/draw`, { ...drawBody(people, boxes), kind: 'team' }, r.admin));
  const rcv = `r.${m.id}.${m.r}`;
  let [, d] = await e.call('GET', '/mailbox', null, rcv);
  eq(0, d.wishRev);
  eq(409, await e.status('PUT', '/mailbox/wish', { wishCt: ct() }, rcv), 'ohne Stand (ältere App) abgewiesen');
  eq(204, await e.status('PUT', '/mailbox/wish', { wishCt: ct(), rev: 0 }, rcv), 'Mitglied 1 speichert');
  const [s, err] = await e.call('PUT', '/mailbox/wish', { wishCt: ct(), rev: 0 }, rcv);
  eq([409, 'conflict'], [s, err.error], 'Mitglied 2 mit altem Stand');
  [, d] = await e.call('GET', '/mailbox', null, `g.${m.id}.${m.g}`);
  eq(1, d.wishRev);
  eq(204, await e.status('PUT', '/mailbox/wish', { wishCt: ct(), rev: 1 }, rcv), 'mit aktuellem Stand');
  eq(400, await e.status('PUT', '/mailbox/wish', { wishCt: ct(), rev: '2' }, rcv));
  // Personen-Runde: ohne rev wie bisher
  const [, ps] = await drawnRound(e);
  eq(204, await e.status('PUT', '/mailbox/wish', { wishCt: ct() }, `r.${ps[0].mid}.${ps[0].rTok}`));
});

test23('Sicherheit 2.5: Team-Zuordnung bis 12000 Zeichen, Widerruf umgeht die Frist beim Team-Wunschzettel nicht', async () => {
  const e = await Env.make();
  const [r, people] = await teamRound(e, 3);
  const big = (n) => `s1.${'A'.repeat(n - 3)}`;
  const body = (len) => ({
    kind: 'team',
    participants: people.map((p) => ({ id: p.pid, assignmentCt: big(len), mailboxkeyCt: sealed() })),
    mailboxes: [0, 1].map(() => ({ id: nid(), giverHash: h(nid()), receiverHash: h(nid()) })),
  });
  eq(400, await e.status('PUT', `/rounds/${r.id}/draw`, body(12001), r.admin), 'über 12000 abgelehnt');
  eq(200, await e.status('PUT', `/rounds/${r.id}/draw`, body(9100), r.admin), 'gemessener schlimmster Fall (9053) passt');
  const [, ps] = await drawnRound(e);
  // Personen-Runde: Zuordnung bleibt bei 2000
  const r3 = await e.round();
  const qs = [];
  for (let i = 0; i < 3; i++) { const q = await e.person(r3); q.auth = await e.claim(q); await e.call('PUT', '/me/rsvp', { rsvp: 'dabei' }, q.auth); qs.push(q); }
  const b3 = drawBody(qs);
  b3.participants[0].assignmentCt = big(2001);
  eq(400, await e.status('PUT', `/rounds/${r3.id}/draw`, b3, r3.admin), 'Personen-Runde: über 2000 abgelehnt');
  // Widerruf
  const m = { id: nid(), g: nid(), r: nid() };
  const teamBoxes = [m, { id: nid(), g: nid(), r: nid() }].map((x) => ({ id: x.id, giverHash: h(x.g), receiverHash: h(x.r) }));
  eq(200, await e.status('PUT', `/rounds/${r.id}/draw`, { ...drawBody(people, teamBoxes), kind: 'team' }, r.admin));
  const rcv = `r.${m.id}.${m.r}`;
  eq(204, await e.status('PUT', '/mailbox/wish', { wishCt: ct(), rev: 0 }, rcv));
  e.now += 11 * DAY; // nach der Wunschfrist
  eq(409, await e.status('PUT', '/mailbox/wish', { wishCt: ct(), rev: 1 }, rcv), 'Frist gilt');
  eq(409, await e.status('PUT', '/mailbox/wish', { wishCt: ct(), rev: 1, withdraw: true }, rcv), 'withdraw hebelt die Frist beim Team-Wunschzettel nicht aus');
  eq(204, await e.status('PUT', '/mailbox/wish', { wishCt: ct(), withdraw: true }, `r.${ps[0].mid}.${ps[0].rTok}`), 'Personen-Runde: Widerruf weiter möglich');
});

test23('Sicherheit 2.5: Runden ohne Code höchstens 2 je Anschluss und Tag, IPv6 je /64 (SEC-007)', async () => {
  const e = await Env.make({ admin: true });
  e.sql("INSERT INTO meta (key, value) VALUES ('open_creation', '{\"enabled\":true,\"maxRounds\":50,\"email\":false}')");
  const create = (ip) => e.call('POST', '/rounds', {
    id: nid(), adminHash: h(nid()), mode: 'wichteln', rsvpDeadline: e.now + 5 * DAY, wishDeadline: e.now + 10 * DAY, eventDate: e.now + 20 * DAY, metaCt: ct(200),
  }, null, ip).then(([st]) => st);
  eq([201, 201, 429], [await create('10.9.9.9'), await create('10.9.9.9'), await create('10.9.9.9')], 'IPv4: dritte Runde am Tag abgewiesen');
  eq(201, await create('10.9.9.8'), 'anderer Anschluss');
  eq([201, 201, 429], [await create('2001:db8:1:2::1'), await create('2001:db8:1:2:ffff::9'), await create('2001:db8:1:2::abcd')], 'IPv6: gleiches /64 zählt gemeinsam');
  eq(201, await create('2001:db8:1:3::1'), 'anderes /64');
  const code = e.code();
  const [st] = await e.call('POST', '/rounds', {
    organizerCode: code, id: nid(), adminHash: h(nid()), mode: 'wichteln', rsvpDeadline: e.now + 5 * DAY, wishDeadline: e.now + 10 * DAY, eventDate: e.now + 20 * DAY, metaCt: ct(200),
  }, null, '10.9.9.9');
  eq(201, st, 'mit Code weiter möglich');
  e.now += DAY;
  eq(201, await create('10.9.9.9'), 'am nächsten Tag wieder');
});

test23('Sicherheit 2.5.2: Runden ohne Code verschicken keine Admin-Link-Mails, wenn E-Mail für sie gesperrt ist (SEC-012)', async () => {
  const e = await Env.make({ admin: true });
  const setOpen = (email) => e.sql(`INSERT INTO meta (key, value) VALUES ('open_creation', '{"enabled":true,"maxRounds":50,"email":${email}}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  setOpen(false);
  const make = async (ip) => {
    const id = nid();
    const tok = nid();
    const [st] = await e.call('POST', '/rounds', { id, adminHash: h(tok), mode: 'wichteln', rsvpDeadline: e.now + 5 * DAY, wishDeadline: e.now + 10 * DAY, eventDate: e.now + 20 * DAY, metaCt: ct(200) }, null, ip);
    eq(201, st);
    const key = b64u(crypto.randomBytes(32));
    return { id, auth: `a.${id}.${tok}`, link: `https://zw.example/#a/${id}/${tok}/${key}/${key}` };
  };
  const r = await make('10.8.0.1');
  const before = e.s.mails().length;
  const [st, d] = await e.call('POST', '/mail/link', { kind: 'admin', link: r.link, email: 'fremd@example.org' }, r.auth, '10.8.0.1');
  eq([409, 'email_needs_code'], [st, d.error], 'ohne Code und E-Mail gesperrt: keine Mail an frei gewählte Adressen');
  eq(before, e.s.mails().length, 'nichts verschickt');
  // Erlaubt der Admin E-Mail für Runden ohne Code, geht es (in den Grenzen von SEC-002)
  setOpen(true);
  eq(200, await e.status('POST', '/mail/link', { kind: 'admin', link: r.link, email: 'ich@example.org' }, r.auth, '10.8.0.1'));
  // Runden mit Code: unverändert möglich
  setOpen(false);
  const withCode = await e.round();
  const key = b64u(crypto.randomBytes(32));
  const tok = withCode.admin.split('.')[2];
  eq(200, await e.status('POST', '/mail/link', { kind: 'admin', link: `https://zw.example/#a/${withCode.id}/${tok}/${key}/${key}`, email: 'ich@example.org' }, withCode.admin));
});

test('2.7: Analoge Wichtelrunde – nur ein Zähler, ohne Inhalte, begrenzt je Anschluss und Tag', async () => {
  const a = await adminEnv();
  const e = a.env;
  const meta = () => e.count("SELECT value FROM meta WHERE key = 'stat_analog'");
  eq(undefined, meta(), 'vorher kein Eintrag');
  eq(204, await e.status('POST', '/stats/analog', undefined, null, '10.9.0.1'));
  // Ein mitgeschickter Inhalt wird nicht gespeichert
  eq(204, await e.status('POST', '/stats/analog', { names: ['Erna', 'Peter'], title: 'Geheim' }, null, '10.9.0.1'));
  const year = String(new Date(e.now * 1000).getUTCFullYear());
  eq({ total: 2, years: { [year]: 2 } }, JSON.parse(meta()));
  ok(!/Erna|Peter|Geheim/.test(e.sql('SELECT * FROM meta').map((r) => JSON.stringify(r)).join()), 'keine Inhalte in meta');
  for (let i = 0; i < 3; i++) eq(204, await e.status('POST', '/stats/analog', undefined, null, '10.9.0.1'));
  eq(429, await e.status('POST', '/stats/analog', undefined, null, '10.9.0.1'), 'sechster Zählversuch am Tag');
  eq(204, await e.status('POST', '/stats/analog', undefined, null, '10.9.0.2'), 'anderer Anschluss');
  eq(6, JSON.parse(meta()).total);
  e.now += 86400 + 1;
  eq(204, await e.status('POST', '/stats/analog', undefined, null, '10.9.0.1'), 'nächster Tag');
  // Nur POST
  eq(404, await e.status('GET', '/stats/analog'));
  // Admin-Überblick zeigt den Zähler
  const [, d] = await adminLogin(a);
  const [st, o] = await e.call('GET', `/admin/${a.slug}/overview`, null, d.session);
  eq(200, st);
  eq(7, o.stats.analog.total);
  // Kaputter Eintrag (z. B. von Hand geändert) wird wie 0 behandelt statt abzustürzen
  e.sql("UPDATE meta SET value = 'kaputt' WHERE key = 'stat_analog'");
  eq(204, await e.status('POST', '/stats/analog', undefined, null, '10.9.0.3'));
  eq(1, JSON.parse(meta()).total);
});

test23('Widerruf einer Einwilligung: Wunschliste auch nach der Wunschfrist änderbar, nur mit withdraw', async () => {
  const e = await Env.make();
  const [, people] = await drawnRound(e);
  const p = people[0];
  eq(204, await e.status('PUT', '/me/wishes', { wishCt: ct() }, p.auth));
  eq(204, await e.status('PUT', '/mailbox/wish', { wishCt: ct() }, `r.${p.mid}.${p.rTok}`));
  e.now += 11 * DAY; // nach der Wunschfrist
  eq(409, await e.status('PUT', '/me/wishes', { wishCt: ct() }, p.auth), 'normale Änderung gesperrt');
  eq(409, await e.status('PUT', '/mailbox/wish', { wishCt: ct() }, `r.${p.mid}.${p.rTok}`), 'normale Übergabe gesperrt');
  eq(204, await e.status('PUT', '/me/wishes', { withdraw: true, wishCt: ct() }, p.auth), 'Widerruf erlaubt');
  eq(204, await e.status('PUT', '/mailbox/wish', { withdraw: true, wishCt: ct() }, `r.${p.mid}.${p.rTok}`), 'Widerruf in der Wichtel-Kopie erlaubt');
  eq(409, await e.status('PUT', '/me/wishes', { withdraw: 'ja', wishCt: ct() }, p.auth), 'nur true zählt');
  eq(401, await e.status('PUT', '/mailbox/wish', { withdraw: true, wishCt: ct() }, `g.${p.mid}.${p.gTok}`), 'nicht als Wichtel');
});

test23('Sprache der Runde: englische Mails', async () => {
  const e = await Env.make();
  const id = nid();
  const tok = nid();
  eq(400, await e.status('POST', '/rounds', { organizerCode: e.code(), id: nid(), adminHash: h(tok), mode: 'schrott', rsvpDeadline: e.now + DAY, eventDate: e.now + 3 * DAY, metaCt: ct(), lang: 'fr' }), 'unbekannte Sprache');
  eq(201, await e.status('POST', '/rounds', {
    organizerCode: e.code(), id, adminHash: h(tok), mode: 'wichteln', lang: 'en', emailEnabled: true, mailTitle: 'Office',
    rsvpDeadline: e.now + 5 * DAY, wishDeadline: e.now + 10 * DAY, eventDate: e.now + 20 * DAY, metaCt: ct(),
  }));
  const r = { id, admin: `a.${id}.${tok}`, tok };
  const p = await e.person(r, 'en@example.org');
  const k = b64u(crypto.randomBytes(32));
  eq(200, await e.status('POST', '/mail/link', { kind: 'invite', pid: p.pid, link: `https://zw.example/#i/${r.id}/${p.pid}/${p.tok}/${k}` }, r.admin));
  const m = e.s.mails().at(-1);
  eq('ZeroWichtel: Secret Santa invitation – Office', m.subject);
  ok(m.text.startsWith('Hello!\n\nYou are invited to the Secret Santa “Office”.'), 'englischer Text');
  ok(m.text.includes('permanently deleted on 5 December 2026'), 'englisches Datum');
  eq('en', (await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin))[1].round.lang);
  eq(200, await e.status('PATCH', `/rounds/${r.id}`, { lang: 'de' }, r.admin));
  eq('de', (await e.call('GET', `/rounds/${r.id}/admin`, null, r.admin))[1].round.lang);
});

// ---------------------------------------------------------------- Anfrageverarbeitung (HTTP)

test('Anfrage: ungültiges JSON, kein Objekt, zu tief, zu groß', async () => {
  const e = await Env.make();
  const raw = (body) => e.s.call('POST', '/rounds', null, null, { now: e.now, raw: body });
  let [s, d] = await raw('{"a":');
  eq([400, 'bad_json', 'Ungültiges JSON.'], [s, d.error, d.message]);
  [s, d] = await raw('"text"');
  eq([400, 'bad_json', 'JSON-Objekt erwartet.'], [s, d.error, d.message]);
  [s, d] = await raw('null');
  eq([400, 'JSON-Objekt erwartet.'], [s, d.message]);
  eq('bad_json', (await raw(`${'['.repeat(16)}${']'.repeat(16)}`))[1].error, '16 Ebenen sind zu viel');
  eq('invalid_id', (await raw(`{"x":${'['.repeat(14)}${']'.repeat(14)}}`))[1].error, '15 Ebenen sind erlaubt');
  [s, d] = await raw('[]');
  eq('invalid_id', d.error, 'leere Liste = Objekt ohne Felder');
  eq('bad_json', (await raw('﻿{}'))[1].error, 'BOM');
  eq('bad_json', (await raw(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])))[1].error, 'kein UTF-8');
  eq('bad_json', (await raw('{"a":"\\ud800"}'))[1].error, 'einzelnes Surrogat');
  [s, d] = await raw(`{"a":"${'x'.repeat(70000)}"}`);
  eq([413, 'too_large', 'Anfrage zu groß.'], [s, d.error, d.message]);
  [s, d] = await e.s.call('POST', '/rounds', null, null, { now: e.now, raw: '' });
  eq('invalid_id', d.error, 'leerer Körper = keine Felder');
});

test('Anfrage: Zahlen müssen Ganzzahlen sein (1.0, 1e3 und Zeichenketten abgelehnt)', async () => {
  const e = await Env.make();
  const base = { organizerCode: e.code(10), adminHash: h('t'), mode: 'schrott', eventDate: e.now + 1000, metaCt: ct() };
  const raw = (rsvp) => e.s.call('POST', '/rounds', null, null, { now: e.now, raw: JSON.stringify({ ...base, id: nid() }).replace(/}$/, `,"rsvpDeadline":${rsvp}}`) });
  for (const v of [`${e.now + 100}.0`, '1e9', `"${e.now + 100}"`, 'true', '99999999999999999999']) {
    const [s, d] = await raw(v);
    eq([400, 'invalid_rsvpDeadline'], [s, d.error], v);
  }
  eq(201, (await raw(String(e.now + 100)))[0]);
});

test('Anfrage: Sicherheitsheader der API', async () => {
  const e = await Env.make();
  const [, , res] = await e.call('GET', '/info');
  eq('no-store', res.headers.get('cache-control'));
  eq('nosniff', res.headers.get('x-content-type-options'));
  eq('no-referrer', res.headers.get('referrer-policy'));
  ok(/default-src 'none'/.test(res.headers.get('content-security-policy')), 'CSP');
  eq('application/json; charset=utf-8', res.headers.get('content-type'));
  const [s, , r2] = await e.call('PUT', '/me/notify', { notify: true }, 'p.aaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaa');
  eq(404, s);
  eq('no-store', r2.headers.get('cache-control'));
});

// ---------------------------------------------------------------- Ausführen

const V1_SCHEMA = `
CREATE TABLE organizer_codes (code_hash TEXT PRIMARY KEY, label TEXT, max_rounds INTEGER NOT NULL DEFAULT 3, used_rounds INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE rounds (id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('wichteln','schrott')), status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','gezogen','beendet')),
  admin_hash TEXT NOT NULL, email_enabled INTEGER NOT NULL DEFAULT 0, rsvp_deadline INTEGER NOT NULL, wish_deadline INTEGER, event_date INTEGER NOT NULL, delete_after INTEGER NOT NULL,
  meta_ct TEXT NOT NULL, admin_ct TEXT, drawn_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX rounds_delete_after ON rounds(delete_after);
CREATE TABLE participants (id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE, invite_hash TEXT NOT NULL, invite_ct TEXT, claimed_at INTEGER,
  access_hash TEXT, pubkey TEXT, name_ct TEXT NOT NULL, rsvp TEXT NOT NULL DEFAULT 'offen' CHECK (rsvp IN ('offen','dabei','raus')), email_ct TEXT, notify INTEGER NOT NULL DEFAULT 1,
  wish_ct TEXT, assignment_ct TEXT, mailboxkey_ct TEXT, recovery_hash TEXT UNIQUE, recovery_ct TEXT, last_seen_day INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX participants_round ON participants(round_id);
CREATE TABLE mailboxes (id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE, giver_hash TEXT NOT NULL, receiver_hash TEXT NOT NULL, wish_ct TEXT, wish_day INTEGER);
CREATE INDEX mailboxes_round ON mailboxes(round_id);
CREATE TABLE messages (id INTEGER PRIMARY KEY, mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE, direction TEXT NOT NULL CHECK (direction IN ('frage','antwort')), body_ct TEXT NOT NULL, created_day INTEGER NOT NULL);
CREATE INDEX messages_mailbox ON messages(mailbox_id);
CREATE TABLE rate_limits (bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, hits INTEGER NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

const filter = process.argv[2] ?? '';
let failures = 0;
let count = 0;
const start = Date.now();
console.log(`API-Testsuite gegen ${IMPL === 'php' ? `PHP (${process.env.ZW_PHP_ROOT || 'Arbeitsverzeichnis'})` : 'Node'}\n`);
for (const [name, fn] of tests) {
  if (filter && !name.includes(filter)) continue;
  count++;
  try {
    await fn();
    const issues = envs.flatMap((e) => e.s.stop());
    envs = [];
    if (issues.length) throw new Error(`Server meldete:\n     ${[...new Set(issues)].slice(0, 5).join('\n     ')}`);
    console.log(`ok   ${name}`);
  } catch (e) {
    for (const x of envs) x.s.stop();
    envs = [];
    failures++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}
console.log(`\n${count} Tests, ${failures} Fehler (${((Date.now() - start) / 1000).toFixed(1)}s)`);
process.exit(failures ? 1 : 0);
