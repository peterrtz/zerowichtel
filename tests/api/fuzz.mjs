// API-Fuzzing über HTTP: zufällige und bösartige Eingaben an alle Endpunkte.
// Erwartung: nie HTTP 500, immer ein JSON-Fehlerobjekt, keine Fehlermeldungen des Servers, Datenbank danach intakt.
//   node tests/api/fuzz.mjs [Durchläufe]          (ZW_IMPL=php … für die Gegenprobe)
import crypto from 'node:crypto';
import { IMPL, b64u, ct, h, nid, startServer } from './harness.mjs';

const runs = Number(process.argv[2] ?? 3000);
const big = 1e9;
const s = await startServer({ mail: true, lazy: true, rateLimits: { read: [big, 3600], write: [big, 3600], claim: [big, 3600], create_round: [big, 3600], recover: [big, 3600], mail: [big, 3600] } });
const now = Math.floor(Date.now() / 1000);
const call = (m, p, body, auth) => s.call(m, p, body, auth, { ip: `10.0.0.${1 + Math.floor(Math.random() * 9)}`, now });
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Eine echte Runde mit Person, damit auch tiefe Pfade erreicht werden
const code = s.code(1000, 1, now);
const rid = nid();
const adminTok = nid();
await call('POST', '/rounds', { organizerCode: code, id: rid, adminHash: h(adminTok), mode: 'wichteln', rsvpDeadline: now + 86400, wishDeadline: now + 2 * 86400, eventDate: now + 3 * 86400, metaCt: ct(), emailEnabled: true });
const pid = nid();
const inv = nid();
await call('POST', `/rounds/${rid}/participants`, { id: pid, inviteHash: h(inv), inviteCt: ct(40), nameCt: ct(40) }, `a.${rid}.${adminTok}`);
const acc = nid();
await call('POST', '/invite/claim', { accessHash: h(acc), pubkey: b64u(crypto.randomBytes(32)), recoveryHash: h('r'), recoveryCt: ct() }, `i.${pid}.${inv}`);

const auths = [null, '', 'x', `a.${rid}.${adminTok}`, `i.${pid}.${inv}`, `p.${pid}.${acc}`, `g.${rid}.${acc}`, `r.${pid}.${adminTok}`, `a.${rid}.${nid()}`, 'a..', 'a'.repeat(5000), `x.${nid()}.${nid()}`, `q.${rid}.${nid()}`, `k.${nid()}.${nid()}`];
const endpoints = [
  ['GET', '/info'], ['GET', '/ideas'], ['POST', '/organizer/check'], ['POST', '/rounds'], ['GET', `/rounds/${rid}/admin`], ['PATCH', `/rounds/${rid}`],
  ['POST', `/rounds/${rid}/participants`], ['PATCH', `/rounds/${rid}/participants/${pid}`], ['POST', `/rounds/${rid}/participants/${pid}/reinvite`],
  ['POST', `/rounds/${rid}/participants/${pid}/remind`], ['PUT', `/rounds/${rid}/participants/${pid}/email`], ['GET', `/rounds/${rid}/keys`],
  ['PUT', `/rounds/${rid}/draw`], ['GET', '/invite'], ['POST', '/invite/claim'], ['GET', '/me'], ['PUT', '/me/rsvp'], ['PUT', '/me/wishes'],
  ['PUT', '/me/recovery'], ['PUT', '/me/notify'], ['DELETE', '/me/email'], ['GET', '/mailbox'], ['PUT', '/mailbox/wish'], ['POST', '/mailbox/messages'],
  ['POST', '/recover'], ['POST', '/mail/link'], ['POST', '/stats/analog'], ['PUT', '/me/done'], ['PUT', '/me/mix'], ['GET', '/me/questions'], ['POST', '/me/questions'],
  ['POST', '/questions/anon'], ['GET', '/questions/thread'], ['PUT', `/rounds/${rid}/questions/settings`], ['GET', `/rounds/${rid}/questions`],
  ['PUT', `/rounds/${rid}/questions/${nid()}/answer`], ['PUT', `/rounds/${rid}/organizer-email`], ['POST', '/me/wishes/unlock-request'], ['POST', `/rounds/${rid}/participants/${pid}/unfreeze`], ['DELETE', `/rounds/${rid}/questions/${nid()}`], ['GET', `/rounds/${rid}/admin/../keys`], ['OPTIONS', '/info'],
  ['DELETE', `/rounds/${nid()}`], ['POST', `/admin/${'a'.repeat(26)}/login`], ['GET', '/admin/x'],
  // seit 2.3: Gruppenlink, Rätselhinweise; 2.4: Admin „Anlegen ohne Code“; 2.5: Team-Wichteln
  ['PUT', `/rounds/${rid}/join`], ['DELETE', `/rounds/${rid}/join`], ['GET', '/join'], ['POST', '/join'],
  ['POST', '/mailbox/hints'], ['DELETE', `/mailbox/hints/${nid()}`], ['PUT', `/admin/${'a'.repeat(26)}/open`], ['PUT', `/admin/${'a'.repeat(26)}/donation`], ['PUT', `/admin/${'a'.repeat(26)}/ideas`],
  ['PUT', '/me/team'], ['PUT', `/rounds/${rid}/participants/${pid}/team`],
];
const fields = ['id', 'adminHash', 'mode', 'rsvpDeadline', 'wishDeadline', 'eventDate', 'metaCt', 'adminCt', 'organizerCode', 'inviteHash', 'inviteCt',
  'nameCt', 'accessHash', 'pubkey', 'recoveryHash', 'recoveryCt', 'rsvp', 'wishCt', 'bodyCt', 'recoveryToken', 'participants', 'mailboxes',
  'email', 'emailViewCt', 'emailEnabled', 'mailTitle', 'notify', 'kind', 'link', 'pid', 'label', 'rounds', 'days', 'password', 'code', '__proto__', 'constructor',
  'teamsCt', 'teamCt', 'rev', 'withdraw', 'enabled', 'maxRounds', 'until', 'max', 'releaseAt', 'joinCt', 'joinHash', 'lang'];
const evil = () => pick([
  null, true, false, 0, -1, 2 ** 53, 1.5, '', ' ', '0', 'null', 'A'.repeat(1 + Math.floor(Math.random() * 70000)),
  'v1.\0\0', `v1.${'-'.repeat(50)}`, `s1.${b64u(crypto.randomBytes(100))}`, "'; DROP TABLE rounds; --", '<script>alert(1)</script>',
  '‮gnp.exe', 'ä\u0000ö', [], [1, 2, 3], { a: { b: { c: 1 } } }, [{ id: pid, assignmentCt: 'v1.x' }], { toString: 1 },
  nid(), rid, pid, h('x'), 'dabei', 'raus', 'wichteln', 'schrott', 'invite', 'admin', 'personal',
  `https://zw.example/#i/${rid}/${pid}/${nid()}/${b64u(crypto.randomBytes(32))}`, 'a@b.de', 'a@b.de\r\nBcc: c@d.de',
]);

let bad = 0;
const statusCount = {};
for (let i = 0; i < runs; i++) {
  const [m, p] = pick(endpoints);
  const body = {};
  for (let k = 0; k < 1 + Math.floor(Math.random() * 8); k++) Object.defineProperty(body, pick(fields), { value: evil(), enumerable: true, writable: true, configurable: true });
  const [status, data] = await call(m, p, body, pick(auths));
  statusCount[status] = (statusCount[status] ?? 0) + 1;
  const okStatus = status < 500 || status === 502;
  const okShape = status < 400 || (data && typeof data.error === 'string' && typeof data.message === 'string');
  if (!okStatus || !okShape) {
    bad++;
    if (bad <= 5) console.log(`FAIL ${m} ${p} → ${status} ${JSON.stringify(data)}\n   Body: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
const integrity = s.sqlValue('PRAGMA integrity_check');
const issues = s.stop();
console.log(`${IMPL}: ${runs} Durchläufe, Statuscodes: ${JSON.stringify(statusCount)}`);
console.log(`Servermeldungen: ${issues.length}${issues.length ? `\n   ${issues.slice(0, 5).join('\n   ')}` : ''}`);
console.log(`Integrität: ${integrity}`);
const fail = bad > 0 || issues.length > 0 || integrity !== 'ok';
console.log(fail ? 'FUZZING FEHLGESCHLAGEN' : 'Fuzzing ok');
process.exit(fail ? 1 : 0);
