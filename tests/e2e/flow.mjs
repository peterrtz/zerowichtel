// End-to-End-Lauf: echter Server (Node) + echter Browser-Krypto-Code (in Node).
// Aufruf: node tests/e2e/flow.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { configure } from '../../public/js/lib/api.js';
import * as M from '../../public/js/lib/model.js';
import { parseFragment } from '../../public/js/lib/links.js';
import { startServer } from '../helpers/server.mjs';

const srv = await startServer();
const BASE = srv.base;
const dbPath = srv.dbPath;
const sql = (q) => String(Object.values(JSON.parse(srv.sql(q))[0] ?? {})[0] ?? '');
const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push(['ok', name]);
    console.log(`ok   ${name}`);
  } catch (e) {
    steps.push(['FAIL', name]);
    console.log(`FAIL ${name}\n     ${e.stack || e}`);
    throw e;
  }
}

try {
  configure({ apiBase: `${BASE}/api`, linkBase: 'https://zerowichtel.example' });
  const organizerCode = srv.organizerCode(2);
  const now = Math.floor(Date.now() / 1000);
  const TITLE = 'Familienwichteln Geheimtitel 7f3a';
  const NAMES = ['Anna Geheimname', 'Ben Geheimname', 'Carla Geheimname'];
  let admin, data, invites = [], persons = [];

  await step('Statische Seite liefert Sicherheitsheader', async () => {
    const r = await fetch(`${BASE}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    const api = await fetch(`${BASE}/api/info`);
    assert.equal(api.headers.get('cache-control'), 'no-store');
  });

  await step('Runde anlegen (Organisator-Code, verschlüsselte Metadaten)', async () => {
    admin = await M.createRound({
      organizerCode,
      mode: 'wichteln',
      meta: { title: TITLE, greeting: '**Hallo** zusammen!\n- Punkt 1', budget: 30 },
      rsvpDeadline: now + 5 * 86400,
      wishDeadline: now + 10 * 86400,
      eventDate: now + 20 * 86400,
    });
    const frag = M.adminFragment(admin);
    assert.deepEqual(parseFragment(frag), { kind: 'a', ...admin });
  });

  await step('Teilnehmende hinzufügen, Admin-Ansicht entschlüsselt Namen und Einladungen', async () => {
    for (const n of NAMES) await M.addPerson(admin, n);
    data = await M.loadAdmin(admin);
    assert.equal(data.meta.title, TITLE);
    assert.equal(data.meta.budget, 30);
    assert.deepEqual(data.participants.map((p) => p.name), NAMES);
    invites = data.participants.map((p) => parseFragment('#' + M.inviteLink(admin, p.id, p.inviteToken).split('#')[1]));
    assert.ok(invites.every((i) => i && i.kind === 'i'));
  });

  await step('Einladung ansehen und annehmen', async () => {
    for (const inv of invites) {
      const v = await M.loadInvite(inv);
      assert.equal(v.meta.title, TITLE);
      const { pctx, recoveryCode } = await M.claimInvite(inv);
      persons.push({ pctx, recoveryCode, name: v.name });
    }
    assert.deepEqual(persons.map((p) => p.name), NAMES);
    await assert.rejects(M.loadInvite(invites[0]), (e) => e.status === 410);
    await assert.rejects(M.claimInvite(invites[0]), (e) => e.status === 410);
  });

  await step('Umfrage: zwei dabei, eine raus', async () => {
    await M.setRsvp(persons[0].pctx, 'dabei');
    await M.setRsvp(persons[1].pctx, 'dabei');
    await M.setRsvp(persons[2].pctx, 'raus');
    const me = await M.loadMe(persons[0].pctx);
    assert.equal(me.me.rsvp, 'dabei');
    assert.deepEqual(me.counts, { invited: 3, dabei: 2 });
    data = await M.loadAdmin(admin);
    assert.deepEqual(data.participants.map((p) => p.rsvp), ['dabei', 'dabei', 'raus']);
    assert.ok(data.participants.every((p) => p.claimed && p.inviteToken === null));
  });

  await step('Wiederherstellung: neuer Link, alter ungültig, Schlüsselpaar identisch', async () => {
    const p = persons[1];
    const restored = await M.recoverFromCode(p.recoveryCode.toLowerCase());
    assert.equal(restored.pid, p.pctx.pid);
    assert.equal(restored.secret, p.pctx.secret);
    assert.notEqual(restored.accessToken, p.pctx.accessToken);
    await assert.rejects(M.loadMe(p.pctx), (e) => e.status === 404);
    assert.equal((await M.loadMe(restored)).me.rsvp, 'dabei');
    const newCode = await M.renewRecovery(restored);
    await assert.rejects(M.recoverFromCode(p.recoveryCode), (e) => e.status === 404);
    const again = await M.recoverFromCode(newCode);
    assert.equal(again.secret, p.pctx.secret);
    persons[1].pctx = again;
  });

  await step('Runde bearbeiten: Titel und Fristen', async () => {
    await M.updateRound(admin, { meta: { ...data.meta, title: TITLE + ' (neu)' }, eventDate: now + 25 * 86400 });
    const d = await M.loadAdmin(admin);
    assert.equal(d.meta.title, TITLE + ' (neu)');
    assert.equal(d.round.deleteAfter, now + 39 * 86400);
  });

  await step('Neu einladen macht alten Personen-Link ungültig', async () => {
    const tok = await M.reinvitePerson(admin, persons[2].pctx.pid);
    await assert.rejects(M.loadMe(persons[2].pctx), (e) => e.status === 404);
    const inv = { kind: 'i', roundId: admin.roundId, pid: persons[2].pctx.pid, inviteToken: tok, kRound: admin.kRound };
    const { pctx } = await M.claimInvite(inv);
    assert.equal((await M.loadMe(pctx)).me.rsvp, 'offen');
  });

  await step('Datenbank enthält keine Klartexte', async () => {
    sql('PRAGMA wal_checkpoint(TRUNCATE)');
    const raw = readFileSync(dbPath).toString('latin1');
    for (const s of ['Geheimtitel', 'Geheimname', 'Hallo', admin.kRound, admin.kAdmin, admin.adminToken, persons[0].pctx.secret, persons[0].pctx.accessToken]) {
      assert.ok(!raw.includes(s), `Klartext in DB gefunden: ${s}`);
    }
  });

  await step('Runde löschen: Daten und Links weg', async () => {
    await M.deleteRound(admin);
    await assert.rejects(M.loadAdmin(admin), (e) => e.status === 404);
    await assert.rejects(M.loadMe(persons[0].pctx), (e) => e.status === 404);
    const count = sql('SELECT (SELECT COUNT(*) FROM rounds) + (SELECT COUNT(*) FROM participants)');
    assert.equal(count, '0');
    // Der Server hält die Datenbank dauerhaft offen; das WAL enthält danach höchstens neue Zähler,
    // aber keine Spur der gelöschten Runde (secure_delete + Checkpoint + VACUUM).
    const files = [dbPath, `${dbPath}-wal`].filter(existsSync).map((f) => readFileSync(f).toString('latin1')).join('');
    for (const s of [admin.roundId, persons[0].pctx.pid]) assert.ok(!files.includes(s), `Spur der gelöschten Runde: ${s}`);
  });

  console.log(`\n${steps.length} Schritte, 0 Fehler`);
} catch {
  console.log(`\nAbbruch. Server-Log:\n${srv.log().slice(-2000)}`);
  process.exitCode = 1;
} finally {
  srv.stop();
}
