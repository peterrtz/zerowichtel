// End-to-End Meilenstein 2: Regeln, Ziehung, Wünsche, Wichtelpost, Wiederherstellung, Neuziehung.
// Aufruf: node tests/e2e/draw-flow.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer } from '../helpers/server.mjs';
import { configure } from '../../public/js/lib/api.js';
import * as M from '../../public/js/lib/model.js';
import { parseFragment } from '../../public/js/lib/links.js';
import { isSingleCycle } from '../../public/js/lib/draw.js';

const srv = await startServer();
configure({ apiBase: `${srv.base}/api`, linkBase: 'https://zerowichtel.example' });
let n = 0;
async function step(name, fn) {
  await fn();
  n++;
  console.log(`ok   ${name}`);
}

try {
  const now = Math.floor(Date.now() / 1000);
  const admin = await M.createRound({
    organizerCode: srv.organizerCode(),
    mode: 'wichteln',
    meta: { title: 'Wichteln Familie Q', greeting: '', budget: 25 },
    rsvpDeadline: now + 3 * 86400,
    wishDeadline: now + 10 * 86400,
    eventDate: now + 20 * 86400,
  });
  const NAMES = ['Mama Q', 'Tochter Q', 'Papa Q', 'Oma R', 'Opa R', 'Tante S', 'Onkel S'];
  const people = {};

  await step('Einladen, annehmen, zusagen (eine Person raus)', async () => {
    for (const name of NAMES) await M.addPerson(admin, name);
    const d = await M.loadAdmin(admin);
    for (const p of d.participants) {
      const inv = parseFragment('#' + M.inviteLink(admin, p.id, p.inviteToken).split('#')[1]);
      const { pctx, recoveryCode } = await M.claimInvite(inv);
      people[p.name] = { pctx, recoveryCode, id: p.id };
      await M.setRsvp(pctx, p.name === 'Onkel S' ? 'raus' : 'dabei');
    }
  });

  await step('Wünsche vor der Ziehung speichern', async () => {
    await M.saveOwnWish(people['Oma R'].pctx, { items: [{ text: '**Strickwolle** in Blau', link: 'https://example.org/wolle' }], noGo: 'Pralinen' });
    await M.saveOwnWish(people['Papa Q'].pctx, { noIdea: true, items: [{ text: 'wird verworfen' }] });
    await assert.rejects(M.saveOwnWish(people['Mama Q'].pctx, { items: [{ text: 'x', link: 'http://unsicher.example' }] }), /https/);
    await assert.rejects(M.saveOwnWish(people['Onkel S'].pctx, { items: [{ text: 'x' }] }), (e) => e.status === 409);
    const me = await M.loadMe(people['Oma R'].pctx);
    const own = await M.loadOwnWish(people['Oma R'].pctx, me.me);
    assert.equal(own.items[0].text, '**Strickwolle** in Blau');
  });

  const groups = [
    { id: 'g1', name: 'Familie Q', members: [people['Mama Q'].id, people['Tochter Q'].id, people['Papa Q'].id] },
    { id: 'g2', name: 'Großeltern', members: [people['Oma R'].id, people['Opa R'].id] },
  ];
  const exclusions = [[people['Tante S'].id, people['Mama Q'].id]];

  let assignments;
  await step('Regeln speichern (verschlüsselt) und auslosen', async () => {
    await M.updateAdminData(admin, { v: 1, groups, exclusions });
    const d = await M.loadAdmin(admin);
    assert.deepEqual(d.admin.groups, groups);
    const names = Object.fromEntries(d.participants.map((p) => [p.id, p.name]));
    const res = await M.performDraw(admin, d.admin, names);
    assert.equal(res.count, 6);
    assert.equal(res.form, 'kreis');
  });

  await step('Jede:r sieht genau eine Person – Regeln eingehalten, ein Kreis', async () => {
    assignments = {};
    for (const [name, p] of Object.entries(people)) {
      const me = await M.loadMe(p.pctx);
      const dr = await M.openDraw(p.pctx, me.me);
      if (name === 'Onkel S') { assert.equal(dr, null); continue; }
      p.draw = dr;
      assignments[p.id] = dr.giving.receiverId;
      assert.equal(dr.giving.name, NAMES.find((x) => people[x].id === dr.giving.receiverId));
    }
    const pairs = Object.entries(assignments);
    assert.equal(pairs.length, 6);
    assert.ok(isSingleCycle(pairs));
    for (const [g, r] of pairs) {
      for (const grp of groups) assert.ok(!(grp.members.includes(g) && grp.members.includes(r)), 'Untergruppe verletzt');
      assert.ok(!exclusions.some(([a, b]) => (a === g && b === r) || (a === r && b === g)), 'Ausschluss verletzt');
    }
  });

  await step('Wunschliste erreicht den Wichtel erst nach Sync durch Beschenkte:n', async () => {
    const oma = people['Oma R'];
    const giverName = Object.keys(people).find((k) => people[k].draw?.giving.receiverId === oma.id);
    const giver = people[giverName];
    let box = await M.loadMailbox(giver.draw.giving, 'g');
    assert.equal(box.wish, null, 'vor Sync noch leer');
    // Oma öffnet die App → Sync
    const me = await M.loadMe(oma.pctx);
    const own = await M.loadOwnWish(oma.pctx, me.me);
    const recv = await M.loadMailbox(oma.draw.receiving, 'r');
    assert.equal(await M.syncWishToMailbox(own, oma.draw.receiving, recv), true);
    assert.equal(await M.syncWishToMailbox(own, oma.draw.receiving, await M.loadMailbox(oma.draw.receiving, 'r')), false, 'kein zweites Mal');
    box = await M.loadMailbox(giver.draw.giving, 'g');
    assert.equal(box.wish.items[0].link, 'https://example.org/wolle');
    assert.equal(box.wish.noGo, 'Pralinen');
    // Änderung nach der Ziehung geht direkt mit
    await M.saveOwnWish(oma.pctx, { items: [{ text: 'Doch lieber ein Hörbuch' }] }, oma.draw.receiving);
    box = await M.loadMailbox(giver.draw.giving, 'g');
    assert.equal(box.wish.items[0].text, 'Doch lieber ein Hörbuch');
    oma.giverName = giverName;
  });

  await step('Anonyme Rückfrage und Antwort', async () => {
    const oma = people['Oma R'];
    const giver = people[oma.giverName];
    await M.sendMessage(giver.draw.giving, 'g', 'Welche Hörbuch-App nutzt du?');
    await M.sendMessage(oma.draw.receiving, 'r', 'Die aus der Bibliothek 😊');
    const asReceiver = await M.loadMailbox(oma.draw.receiving, 'r');
    assert.deepEqual(asReceiver.messages.map((m) => [m.direction, m.text]), [['frage', 'Welche Hörbuch-App nutzt du?'], ['antwort', 'Die aus der Bibliothek 😊']]);
    await assert.rejects(M.sendMessage(giver.draw.giving, 'g', '   '), /Nachricht/);
  });

  await step('Fremdes Postfach ist nicht zugänglich (Rollen getrennt)', async () => {
    const oma = people['Oma R'];
    // Oma kennt M ihres Postfachs, aber nur das r-Token – als Wichtel (g) kommt sie nicht hinein
    await assert.rejects(M.loadMailbox(oma.draw.receiving, 'g'), (e) => e.status === 404);
    // Token eines anderen Postfachs passt nicht
    await assert.rejects(M.loadMailbox({ ...oma.draw.receiving, t: oma.draw.giving.t }, 'g'), (e) => e.status === 404);
    // Beschenkte:r darf keine Fragen „als Wichtel“ stellen
    await assert.rejects(M.sendMessage(oma.draw.receiving, 'g', 'Fälschung'), (e) => e.status === 404);
  });

  await step('Wiederherstellung nach Ziehung liefert dieselbe Zuordnung', async () => {
    const p = people['Opa R'];
    const restored = await M.recoverFromCode(p.recoveryCode);
    const me = await M.loadMe(restored);
    const dr = await M.openDraw(restored, me.me);
    assert.equal(dr.giving.receiverId, p.draw.giving.receiverId);
    p.pctx = restored;
  });

  await step('Datenbank enthält keine Namen, Wünsche, Nachrichten oder Zuordnungen im Klartext', async () => {
    srv.sql('PRAGMA wal_checkpoint(TRUNCATE)');
    const raw = readFileSync(srv.dbPath).toString('latin1');
    for (const s of ['Mama Q', 'Familie Q', 'Strickwolle', 'Hörbuch', 'Bibliothek', 'Pralinen', 'Großeltern', 'example.org']) {
      assert.ok(!raw.includes(s), `Klartext gefunden: ${s}`);
    }
    for (const id of Object.values(assignments)) {
      // Personen-IDs dürfen nur als eigene Zeilen-ID vorkommen, nie in Postfächern
      const boxes = JSON.parse(srv.sql('SELECT id, giver_hash, receiver_hash FROM mailboxes'));
      assert.ok(!JSON.stringify(boxes).includes(id));
    }
  });

  await step('Neu einladen nach Ziehung setzt zurück; Neuziehung funktioniert', async () => {
    const tok = await M.reinvitePerson(admin, people['Tante S'].id);
    let d = await M.loadAdmin(admin);
    assert.equal(d.round.status, 'offen');
    await assert.rejects(M.loadMailbox(people['Mama Q'].draw.giving, 'g'), (e) => e.status === 404);
    const { pctx } = await M.claimInvite({ kind: 'i', roundId: admin.roundId, pid: people['Tante S'].id, inviteToken: tok, kRound: admin.kRound });
    people['Tante S'].pctx = pctx;
    d = await M.loadAdmin(admin);
    assert.equal(d.participants.find((p) => p.name === 'Tante S').rsvp, 'dabei', 'bleibt dabei');
    const names = Object.fromEntries(d.participants.map((p) => [p.id, p.name]));
    await M.performDraw(admin, d.admin, names);
    const me = await M.loadMe(pctx);
    const dr = await M.openDraw(pctx, me.me);
    assert.ok(dr.giving.receiverId);
    assert.ok(dr.giving.receiverId !== people['Mama Q'].id, 'Ausschluss gilt weiter');
  });

  console.log(`\n${n} Schritte, 0 Fehler`);
} catch (e) {
  console.log(`FAIL\n${e.stack}\n${srv.log().split('\n').filter((l) => !/Accepted|Closing/.test(l)).slice(-20).join('\n')}`);
  process.exitCode = 1;
} finally {
  srv.stop();
}
