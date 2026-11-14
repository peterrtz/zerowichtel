// Datenübernahme: Eine Datenbank der PHP-Version 1.2.1 läuft unverändert mit der Node-Version weiter –
// und umgekehrt (Rückfall auf 1.2.1 nach einem Update). Geprüft wird alles, was der Server selbst
// verschlüsselt oder hasht: E-Mail-Adressen, Mail-Titel, Admin-Passwort (Argon2id), TOTP-Geheimnis,
// Notfallcodes, Organisator-Codes, Zugangs- und Wiederherstellungs-Tokens.
//   ZW_PHP_ROOT=/tmp/zw-php node tests/api/migration.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { T0, b64u, ct, h, nid, sealed, startServer, totpCode } from './harness.mjs';

const DAY = 86400;
const dir = mkdtempSync(join(tmpdir(), 'zw-mig-'));
const dbPath = join(dir, 'zerowichtel.sqlite');
const opts = { dbPath, admin: true, mail: true };
let now = T0;
const PW = 'übernahme passwort lang genug';
const steps = [];
const step = (name) => { steps.push(name); console.log(`ok   ${name}`); };

/** Legt mit dem gegebenen Server eine gezogene Mailrunde an. */
async function populate(s, title, emails) {
  const call = (m, p, b, a) => s.call(m, p, b, a, { now });
  const id = nid();
  const tok = nid();
  const code = s.code(3, 60, now);
  let [st] = await call('POST', '/rounds', { organizerCode: code, id, adminHash: h(tok), mode: 'wichteln', rsvpDeadline: now + 5 * DAY, wishDeadline: now + 10 * DAY, eventDate: now + 20 * DAY, metaCt: ct(), emailEnabled: true, mailTitle: title });
  assert.equal(st, 201);
  const r = { id, admin: `a.${id}.${tok}` };
  const people = [];
  for (const email of emails) {
    const pid = nid();
    const inv = nid();
    [st] = await call('POST', `/rounds/${id}/participants`, { id: pid, inviteHash: h(inv), inviteCt: ct(), nameCt: ct(), email, emailViewCt: ct() }, r.admin);
    assert.equal(st, 201);
    const access = nid();
    const recovery = b64u(crypto.randomBytes(32));
    [st] = await call('POST', '/invite/claim', { accessHash: h(access), pubkey: b64u(crypto.randomBytes(32)), recoveryHash: h(recovery), recoveryCt: ct() }, `i.${pid}.${inv}`);
    assert.equal(st, 200);
    const auth = `p.${pid}.${access}`;
    await call('PUT', '/me/rsvp', { rsvp: 'dabei' }, auth);
    people.push({ pid, auth, recovery, mid: nid(), g: nid(), rTok: nid() });
  }
  [st] = await call('PUT', `/rounds/${id}/draw`, {
    participants: people.map((p) => ({ id: p.pid, assignmentCt: sealed(), mailboxkeyCt: sealed() })),
    mailboxes: people.map((p) => ({ id: p.mid, giverHash: h(p.g), receiverHash: h(p.rTok) })),
  }, r.admin);
  assert.equal(st, 200);
  await call('POST', '/mailbox/messages', { bodyCt: ct() }, `g.${people[0].mid}.${people[0].g}`);
  return { r, people, code };
}

/** Prüft eine von der jeweils anderen Version angelegte Runde. */
async function verify(s, label, { r, people, code }, title, emails, admin) {
  const call = (m, p, b, a) => s.call(m, p, b, a, { now });
  const [st, d] = await call('GET', `/rounds/${r.id}/admin`, null, r.admin);
  assert.equal(st, 200, `${label}: Admin-Link`);
  assert.equal(d.round.mailTitle, title, `${label}: Mail-Titel entschlüsselt`);
  assert.equal(d.participants.length, emails.length);

  const [s2, me] = await call('GET', '/me', null, people[1].auth);
  assert.equal(s2, 200, `${label}: persönlicher Link`);
  assert.ok(me.me.assignmentCt.startsWith('s1.') && me.me.hasEmail);
  const [s3, mb] = await call('GET', '/mailbox', null, `r.${people[0].mid}.${people[0].rTok}`);
  assert.equal(s3, 200, `${label}: Wichtelpost`);
  assert.equal(mb.messages.length, 1);

  // Erinnerung an Person 3 (hat ihre Seite noch nicht geöffnet): Adresse muss entschlüsselt werden
  const before = s.mails().length;
  const [s4] = await call('POST', `/rounds/${r.id}/participants/${people[2].pid}/remind`, {}, r.admin);
  assert.equal(s4, 200, `${label}: Erinnerung`);
  const m = s.mails().at(-1);
  assert.equal(s.mails().length, before + 1);
  assert.equal(m.to, emails[2], `${label}: Adresse entschlüsselt`);
  assert.ok(m.subject.endsWith(`– ${title}`), `${label}: Titel im Betreff`);

  // Wiederherstellung mit dem Code der anderen Version
  const [s5, rec] = await call('POST', '/recover', { recoveryToken: people[0].recovery, accessHash: h(nid()) });
  assert.equal(s5, 200, `${label}: Wiederherstellung`);
  assert.equal(rec.pid, people[0].pid);

  // Organisator-Code der anderen Version (1 von 3 verbraucht)
  const [s6, chk] = await call('POST', '/organizer/check', { organizerCode: code });
  assert.deepEqual([s6, chk.remaining], [200, 2], `${label}: Organisator-Code`);

  // Admin-Bereich: Passwort-Hash und TOTP-Geheimnis der anderen Version
  now += 60; // neuer TOTP-Schritt
  const [s7, login] = await call('POST', `/admin/${admin.slug}/login`, { password: PW, code: totpCode(admin.secret, Math.floor(now / 30)) });
  assert.equal(s7, 200, `${label}: Admin-Anmeldung mit Passwort und App-Code`);
  const [s8, ov] = await call('GET', `/admin/${admin.slug}/overview`, null, login.session);
  assert.equal(s8, 200);
  assert.ok(ov.codes.length >= 1 && ov.stats.rounds >= 1);
  now += 60;
  const [s9] = await call('POST', `/admin/${admin.slug}/login`, { password: PW, code: admin.recovery.pop() });
  assert.equal(s9, 200, `${label}: Notfallcode`);
}

try {
  // 1) PHP 1.2.1 legt Daten an
  const php = await startServer({ ...opts, impl: 'php' });
  const admin = php.adminSetup(PW, now);
  const a = await populate(php, 'Übernahme „PHP“', ['a@example.org', 'b@example.org', 'c@example.org']);
  assert.deepEqual(php.stop(), []);
  step('PHP 1.2.1: Runde, Adressen, Admin-Zugang, Codes angelegt');

  // 2) Node übernimmt dieselbe Datei
  const node = await startServer({ ...opts, impl: 'node' });
  await verify(node, 'Node liest PHP-Daten', a, 'Übernahme „PHP“', ['a@example.org', 'b@example.org', 'c@example.org'], admin);
  step('Node 2.0 liest alles, was PHP verschlüsselt und gehasht hat');
  const before = node.mails().length;
  await node.notify(now);
  const drawn = node.mails().slice(before).filter((m) => m.subject.startsWith('ZeroWichtel: Es wurde ausgelost')).map((m) => m.to).sort();
  assert.deepEqual(drawn, ['a@example.org', 'b@example.org', 'c@example.org'], 'Hinweis nach der Ziehung an alle drei');
  step('Node 2.0 verschickt die ausstehenden Benachrichtigungen an die PHP-Adressen');

  // Node legt eigene Daten an und setzt ein neues Admin-Passwort (über einen neuen Zugang)
  const adminNode = node.adminSetup(PW, now);
  now += DAY;
  const b = await populate(node, 'Übernahme „Node“', ['x@example.org', 'y@example.org', 'z@example.org']);
  assert.deepEqual(node.stop(), []);
  step('Node 2.0: weitere Runde und neuer Admin-Zugang angelegt');

  // 3) Rückfall: PHP 1.2.1 liest, was Node geschrieben hat
  const back = await startServer({ ...opts, impl: 'php' });
  await verify(back, 'PHP liest Node-Daten', b, 'Übernahme „Node“', ['x@example.org', 'y@example.org', 'z@example.org'], adminNode);
  assert.deepEqual(back.stop(), []);
  step('Rückfall auf PHP 1.2.1: liest alles, was Node verschlüsselt und gehasht hat');
  console.log(`\nDatenübernahme ok (${steps.length} Schritte)`);
} catch (e) {
  console.log(`FAIL ${e.stack}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
