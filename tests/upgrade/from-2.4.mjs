// Update-Test 2.4.0 → 2.5 → 2.4.0 → 2.5 mit echten Daten der alten Version.
// 2.4.0 legt Runden in allen Lagen an (offen mit Wünschen, gezogen mit Wunschliste/Post/Hinweis, Schrottwichteln).
// Danach übernimmt die neue Version dieselbe Datenbank: Alle bisherigen Spalten müssen unverändert sein und alle
// Abläufe der alten Runden weiter funktionieren. Anschließend Rückweg auf 2.4.0 und wieder vor.
//   git worktree add /tmp/zw-24 v2.4.0 && ZW_OLD_ROOT=/tmp/zw-24 node tests/upgrade/from-2.4.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import * as NEW from '../api/harness.mjs';

const OLD_ROOT = process.env.ZW_OLD_ROOT;
if (!OLD_ROOT) { console.log('ZW_OLD_ROOT nicht gesetzt (Worktree von v2.4.0) – übersprungen.'); process.exit(0); }
const OLD = await import(join(OLD_ROOT, 'tests', 'api', 'harness.mjs'));
const { T0, ct, h, nid, sealed } = NEW;
const DAY = 86400;
const dir = mkdtempSync(join(tmpdir(), 'zw-upg-'));
const dbPath = join(dir, 'zerowichtel.sqlite');
let n = 0;
const step = (name) => { n++; console.log(`ok   ${name}`); };

async function makeRound(s, mode = 'wichteln') {
  const call = (m, p, b, a) => s.call(m, p, b, a, { now: T0 });
  const id = nid();
  const tok = nid();
  const [st] = await call('POST', '/rounds', { organizerCode: s.code(5, 60, T0), id, adminHash: h(tok), mode, rsvpDeadline: T0 + 5 * DAY, wishDeadline: mode === 'wichteln' ? T0 + 10 * DAY : null, eventDate: T0 + 20 * DAY, metaCt: ct(200) });
  assert.equal(st, 201);
  const r = { id, admin: `a.${id}.${tok}`, people: [] };
  for (let i = 0; i < 4; i++) {
    const pid = nid();
    const inv = nid();
    assert.equal((await call('POST', `/rounds/${id}/participants`, { id: pid, inviteHash: h(inv), inviteCt: ct(), nameCt: ct() }, r.admin))[0], 201);
    const access = nid();
    assert.equal((await call('POST', '/invite/claim', { accessHash: h(access), pubkey: NEW.b64u(Buffer.alloc(32, i + 1)), recoveryHash: h(nid()), recoveryCt: ct() }, `i.${pid}.${inv}`))[0], 200);
    const p = { pid, auth: `p.${pid}.${access}` };
    assert.equal((await call('PUT', '/me/rsvp', { rsvp: i === 3 ? 'raus' : 'dabei' }, p.auth))[0], 200);
    if (mode === 'wichteln' && i < 3) assert.equal((await call('PUT', '/me/wishes', { wishCt: ct(300) }, p.auth))[0], 204);
    r.people.push(p);
  }
  return r;
}

async function drawRound(s, r) {
  const call = (m, p, b, a) => s.call(m, p, b, a, { now: T0 });
  const dabei = r.people.slice(0, 3);
  for (const p of dabei) Object.assign(p, { mid: nid(), g: nid(), rt: nid(), a: sealed(), mk: sealed() });
  const [st, d] = await call('PUT', `/rounds/${r.id}/draw`, {
    participants: dabei.map((p) => ({ id: p.pid, assignmentCt: p.a, mailboxkeyCt: p.mk })),
    mailboxes: dabei.map((p) => ({ id: p.mid, giverHash: h(p.g), receiverHash: h(p.rt) })),
  }, r.admin);
  assert.equal(st, 200, JSON.stringify(d));
  for (const p of dabei) {
    assert.equal((await call('PUT', '/mailbox/wish', { wishCt: ct(300) }, `r.${p.mid}.${p.rt}`))[0], 204);
    assert.equal((await call('POST', '/mailbox/messages', { bodyCt: ct() }, `g.${p.mid}.${p.g}`))[0], 201);
  }
  assert.equal((await call('POST', '/mailbox/hints', { id: nid(), bodyCt: ct(), releaseAt: T0 }, `g.${dabei[0].mid}.${dabei[0].g}`))[0], 201);
}

/** Inhalt aller Tabellen über die Spalten der alten Version (Prüfsumme je Tabelle). */
function fingerprint(columns = null) {
  const db = new DatabaseSync(dbPath);
  try {
    const out = {};
    const cols = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      const c = columns?.[name] ?? db.prepare(`PRAGMA table_info(${name})`).all().map((x) => x.name);
      cols[name] = c;
      const rows = db.prepare(`SELECT ${c.map((x) => `"${x}"`).join(', ')} FROM ${name} ORDER BY rowid`).all();
      out[name] = `${rows.length}:${createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)}`;
    }
    return { out, cols, version: db.prepare('PRAGMA user_version').get().user_version };
  } finally { db.close(); }
}

/** Abläufe, die nach jedem Versionswechsel funktionieren müssen. */
async function checkOldRounds(s, { offen, gezogen, schrott }, label) {
  const call = (m, p, b, a) => s.call(m, p, b, a, { now: T0 + DAY });
  for (const p of gezogen.people.slice(0, 3)) {
    const [st, me] = await call('GET', '/me', null, p.auth);
    assert.equal(st, 200);
    assert.equal(me.me.assignmentCt, p.a, `${label}: Zuordnung unverändert`);
    assert.equal(me.me.mailboxkeyCt, p.mk);
    const [st2, mb] = await call('GET', '/mailbox', null, `g.${p.mid}.${p.g}`);
    assert.equal(st2, 200);
    assert.ok(mb.wishCt && mb.messages.length >= 1, `${label}: Wunschliste und Post da`);
    assert.equal((await call('POST', '/mailbox/messages', { bodyCt: ct() }, `r.${p.mid}.${p.rt}`))[0], 201, `${label}: Antwort möglich`);
    assert.equal((await call('PUT', '/mailbox/wish', { wishCt: ct(300) }, `r.${p.mid}.${p.rt}`))[0], 204, `${label}: Wunschliste ohne Stand (Personen-Runde)`);
  }
  const [, mb0] = await call('GET', '/mailbox', null, `r.${gezogen.people[0].mid}.${gezogen.people[0].rt}`);
  assert.equal(mb0.hints.length, 1, `${label}: Rätselhinweis freigeschaltet`);
  for (const r of [offen, gezogen, schrott]) {
    const [st] = await call('GET', `/rounds/${r.id}/admin`, null, r.admin);
    assert.equal(st, 200, `${label}: Admin-Ansicht`);
    assert.equal((await call('GET', '/me', null, r.people[0].auth))[0], 200);
  }
  assert.equal((await call('PUT', '/me/wishes', { wishCt: ct(300) }, offen.people[0].auth))[0], 204, `${label}: Wünsche in offener Runde`);
}

try {
  // 1. Alte Version legt Daten an
  let s = await OLD.startServer({ dbPath });
  const offen = await makeRound(s);
  const gezogen = await makeRound(s);
  await drawRound(s, gezogen);
  const schrott = await makeRound(s, 'schrott');
  const spaeter = await makeRound(s); // wird nach dem Update auf Team-Wichteln umgestellt
  const rounds = { offen, gezogen, schrott };
  await checkOldRounds(s, rounds, '2.4.0');
  s.stop();
  const before = fingerprint();
  assert.equal(before.version, 6);
  step(`2.4.0: ${Object.entries(before.out).filter(([, v]) => !v.startsWith('0:')).length} Tabellen mit Daten angelegt (offen, gezogen mit Post/Hinweis, Schrottwichteln)`);

  // 2. Neue Version übernimmt
  s = await NEW.startServer({ dbPath });
  const after = fingerprint(before.cols);
  assert.equal(after.version, 7, 'Schema 7');
  // rate_limits ausgenommen: Die Startprobe des neuen Servers zählt dort eine Anfrage – Laufzeitdaten, keine Migration.
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'rate_limits'));
  assert.deepEqual(strip(after.out), strip(before.out), 'alle bisherigen Spalten unverändert');
  step('2.5: Schema 6 → 7, alle bisherigen Daten unverändert (außer dem Zähler der Anfragebegrenzung)');
  await checkOldRounds(s, rounds, '2.5');
  step('2.5: alte Runden funktionieren (Zuordnung, Wunschliste, Post, Hinweis, Admin, Wünsche)');
  const call = (m, p, b, a) => s.call(m, p, b, a, { now: T0 + DAY });
  // Alte offene Runde: normale Ziehung wie bisher
  const dabei = offen.people.slice(0, 3);
  let [st, d] = await call('PUT', `/rounds/${offen.id}/draw`, {
    participants: dabei.map((p) => ({ id: p.pid, assignmentCt: sealed(), mailboxkeyCt: sealed() })),
    mailboxes: dabei.map(() => ({ id: nid(), giverHash: h(nid()), receiverHash: h(nid()) })),
  }, offen.admin);
  assert.equal(st, 200, JSON.stringify(d));
  // Weitere alte offene Runde: auf Team-Wichteln umstellen und als Team-Runde ziehen
  assert.equal((await call('PATCH', `/rounds/${spaeter.id}`, { teamsCt: ct(300) }, spaeter.admin))[0], 200);
  for (const p of spaeter.people.slice(0, 3)) assert.equal((await call('PUT', '/me/team', { teamCt: ct() }, p.auth))[0], 204);
  [st, d] = await call('PUT', `/rounds/${spaeter.id}/draw`, {
    kind: 'team',
    participants: spaeter.people.slice(0, 3).map((p) => ({ id: p.pid, assignmentCt: sealed(), mailboxkeyCt: sealed() })),
    mailboxes: [0, 1].map(() => ({ id: nid(), giverHash: h(nid()), receiverHash: h(nid()) })),
  }, spaeter.admin);
  assert.equal(st, 200, JSON.stringify(d));
  step('2.5: alte offene Runden lassen sich normal oder als Team-Wichteln auslosen');
  s.stop();

  // 3. Rückweg auf 2.4.0
  s = await OLD.startServer({ dbPath });
  assert.equal(fingerprint().version, 7, 'Schema bleibt 7 (2.4.0 ignoriert die neuen Spalten)');
  await checkOldRounds(s, { ...rounds, offen: { ...offen } }, 'Rückweg 2.4.0');
  step('Rückweg auf 2.4.0: Datenbank wird gelesen, alte Runden funktionieren weiter');
  s.stop();

  // 4. Wieder vor
  s = await NEW.startServer({ dbPath });
  await checkOldRounds(s, rounds, 'erneut 2.5');
  assert.equal((await s.call('GET', '/me', null, spaeter.people[0].auth, { now: T0 + DAY }))[1].round.teamsCt !== null, true, 'Team-Runde blieb Team-Runde');
  s.stop();
  step('Erneut 2.5: alles da, Team-Runde unverändert');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${n} Schritte ohne Fehler.`);
