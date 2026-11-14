// Browser-Durchlauf 2.5: Team-Wichteln. Organisator:in schaltet Teams ein, Teilnehmende tragen sich über den
// Gruppenlink ein und wählen ihr Team (Höchstgröße), Ziehung zwischen Teams, gemeinsamer Team-Wunschzettel
// mit Schutz vor gegenseitigem Überschreiben, Wichtelpost zwischen Teams, kein Klartext in der Datenbank.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-25.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startServer } from '../helpers/server.mjs';

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.log('CHROME_PATH nicht gesetzt – übersprungen.'); process.exit(0); }
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const srv = await startServer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split('|') : [])] });
const problems = [];
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let axeChecks = 0;
let n = 0;
let steps = 0;

async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await deutsch(await ctx.newPage());
  await page.setBypassCSP(true); // nur, damit axe eingebunden werden kann
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  // 409 = absichtlich ausgelöster Konflikt beim Team-Wunschzettel
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 409/.test(m.text())) problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.defaultValue()));
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `v25-${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
/** Einzelne Karte (enthält Text) als Bild – zum Ansehen der Gestaltung. */
async function shotCard(page, text, name) {
  if (!SHOTS) return;
  const handle = await page.evaluateHandle((x) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(x)), text);
  const el = handle.asElement();
  if (el) await el.screenshot({ path: join(SHOTS, `v25-card-${name}.png`) });
}
/** WCAG 2.2 AA mit axe-core (wie tests/browser/a11y.mjs) plus kein seitliches Scrollen bei 320 px. */
async function axe(page, name) {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  })).violations.map((x) => `${x.id} (${x.nodes.length}×: ${x.nodes[0].target.join(' ')})`));
  axeChecks++;
  if (v.length) problems.push(`axe ${name}: ${v.join('; ')}`);
  await page.setViewport({ width: 320, height: 800 });
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (r.sw > r.cw + 1) problems.push(`${name}: seitliches Scrollen bei 320 px (${r.sw} > ${r.cw})`);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
}
const waitText = (page, s, timeout = 10000) => page.waitForFunction((x) => document.body.textContent.includes(x), { timeout, polling: 100 }, s);
async function clickText(page, label, within = 'body') {
  const ok = await page.evaluate((l, w) => {
    const el = [...document.querySelector(w).querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === l);
    if (el) el.click();
    return !!el;
  }, label, within);
  if (!ok) throw new Error(`Kein Element „${label}“`);
}
async function fill(page, label, value) {
  const id = await page.evaluate((l) => [...document.querySelectorAll('label')].find((x) => x.textContent.replace(' *', '').trim() === l)?.htmlFor, label);
  if (!id) throw new Error(`Kein Feld „${label}“`);
  await page.$eval(`#${id}`, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}
async function step(name, fn) {
  steps++;
  await fn();
  console.log(`ok   ${name}`);
}
async function pickTeam(page, team) {
  await page.evaluate((tn) => {
    const label = [...document.querySelectorAll('.team-choice label')].find((l) => l.textContent.includes(tn));
    label.querySelector('input').click();
  }, team);
  await waitText(page, 'Team gespeichert.');
  await page.waitForFunction((tn) => [...document.querySelectorAll('.team-choice label.is-selected')].some((l) => l.textContent.includes(tn)), { timeout: 10000 }, team);
}

try {
  const admin = await newPage();
  const people = {};
  let groupLink = '';

  await step('Runde anlegen, Team-Wichteln einschalten, Teams benennen (Einkauf höchstens 2)', async () => {
    await admin.goto(`${srv.base}/#neu`);
    await admin.waitForSelector('form.form');
    await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await admin.type('input[placeholder^="z. B. Familien"]', 'Abteilungswichteln');
    await admin.$eval('form.form', (f) => f.requestSubmit());
    await waitText(admin, 'Zuerst: Admin-Link sichern');
    await clickText(admin, 'Erledigt, ich habe den Link gesichert');
    await waitText(admin, 'Ich wichtle nicht selbst mit');
    await clickText(admin, 'Ich wichtle nicht selbst mit');
    await waitText(admin, 'Team-Wichteln (optional)');
    await clickText(admin, 'Team-Wichteln (optional)');
    await clickText(admin, 'Team-Wichteln einschalten');
    await waitText(admin, 'Team-Wichteln eingeschaltet.');
    await admin.waitForSelector('input[aria-label="Name von Team 1"]');
    for (const [i, name] of ['Einkauf', 'IT', 'Pflege'].entries()) {
      await admin.$eval(`input[aria-label="Name von Team ${i + 1}"]`, (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, name);
    }
    await admin.$eval('input[aria-label="Höchstgröße von Team 1 (optional)"]', (el) => { el.value = '2'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await clickText(admin, 'Teams speichern');
    await waitText(admin, 'Teams gespeichert.');
    await waitText(admin, 'lose deshalb nicht zu knapp vor der Wunschfrist');
    const hasRules = await admin.evaluate(() => document.body.textContent.includes('Untergruppen und Ausschlüsse'));
    if (hasRules) problems.push('Untergruppen werden bei Team-Wichteln noch angezeigt');
    await shot(admin, 'teams-admin');
    await axe(admin, 'Admin: Team-Wichteln');
    await shotCard(admin, 'Erst speichern, dann', 'admin-teams').catch(() => {});
    await shotCard(admin, 'Wer zugesagt hat, wählt auf der eigenen Seite', 'admin-teams');
  });

  await step('Gruppenlink für 5 Personen', async () => {
    await clickText(admin, 'Gruppenlink (optional)');
    await fill(admin, 'Höchstens so viele Personen', '5');
    await clickText(admin, 'Gruppenlink erstellen');
    await waitText(admin, '0 von 5 eingetragen');
    groupLink = await admin.$eval('.group-share a[href^="sms:"]', (a) => decodeURIComponent(a.getAttribute('href').split('body=')[1]).match(/https?:\/\/\S+/)[0]);
  });

  const plan = [['Ada', 'Einkauf'], ['Bea', 'Einkauf'], ['Cem', 'IT'], ['Dan', 'IT'], ['Eva', 'Pflege']];
  await step('Fünf tragen sich ein und wählen ihr Team; Einkauf ist danach voll', async () => {
    for (const [name, team] of plan) {
      const p = await newPage();
      await p.goto(groupLink);
      await waitText(p, 'Du bist eingeladen, dich selbst einzutragen.');
      await fill(p, 'Dein Name', name);
      await clickText(p, 'Mich eintragen');
      await waitText(p, 'Du bist eingetragen und dabei.');
      await waitText(p, 'Du hast noch kein Team gewählt.');
      await waitText(p, 'Wähl unten dein Team');
      if (name === 'Cem') {
        const full = await p.evaluate(() => [...document.querySelectorAll('.team-choice label')].find((l) => l.textContent.includes('Einkauf')).querySelector('input').disabled);
        if (!full) problems.push('Einkauf (höchstens 2) ist für die dritte Person nicht gesperrt');
        await waitText(p, 'voll');
        await shot(p, 'teamwahl-voll');
        await axe(p, 'Teamwahl');
        await shotCard(p, 'Bei dieser Runde beschenken sich Teams', 'teamwahl');
      }
      await pickTeam(p, team);
      people[name] = p;
    }
    if (await people.Ada.evaluate(() => document.body.textContent.includes('Bea'))) problems.push('Teamwahl verrät vor der Auslosung Namen');
    await waitText(people.Eva, '1 dabei');
  });

  await step('Organisator:in sieht Zuordnung, setzt um und lost aus', async () => {
    await admin.evaluate(() => { location.hash = '#datenschutz'; });
    await admin.evaluate(() => history.back());
    await waitText(admin, 'Ziehung möglich: 3 Teams beschenken sich im Kreis.');
    await shotCard(admin, 'Zuordnung', 'admin-zuordnung');
    await axe(admin, 'Admin: Zuordnung und Auslosen');
    const sel = await admin.$eval('select[aria-label="Team für Eva"]', (s) => s.selectedOptions[0].textContent);
    if (sel !== 'Pflege') problems.push(`Eva steht in „${sel}“`);
    await clickText(admin, 'Jetzt auslosen');
    await waitText(admin, 'Jedes Team sieht jetzt, welches Team es beschenkt');
    await shot(admin, 'ausgelost');
  });

  let target = '';
  await step('Ada sieht das beschenkte Team mit Mitgliedern und ihr eigenes Team', async () => {
    for (const p of Object.values(people)) await p.reload();
    const ada = people.Ada;
    await waitText(ada, 'Päckchen auspacken');
    await clickText(ada, 'Päckchen auspacken');
    await waitText(ada, 'Euer Team beschenkt');
    target = await ada.$eval('.reveal-name', (e) => e.textContent);
    if (!['IT', 'Pflege'].includes(target)) problems.push(`Einkauf beschenkt „${target}“`);
    await waitText(ada, target === 'IT' ? 'Mitglieder: Cem, Dan' : 'Mitglieder: Eva');
    await waitText(ada, 'Ihr seid Team Einkauf: Ada, Bea.');
    await waitText(ada, 'Das Team hat noch keinen Wunschzettel geschrieben.');
    await shot(ada, 'team-zuordnung');
    await new Promise((r) => setTimeout(r, 1200)); // Einblend-Animation abwarten, sonst misst axe halbtransparente Schrift
    await axe(ada, 'Team-Zuordnung');
    await shotCard(ada, 'Euer Team beschenkt', 'zuordnung');
  });

  await step('Team-Wunschzettel: Ada speichert, Bea mit altem Stand bekommt Konflikt statt Überschreiben', async () => {
    const [ada, bea] = [people.Ada, people.Bea];
    await waitText(bea, 'Euer Team-Wunschzettel');
    const setWish = (p, text) => p.$eval('.card .wish-editor textarea', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, text);
    if (await ada.$('.wish-editor .health-consent')) problems.push('Team-Wunschzettel fragt Gesundheitsangaben ab');
    await setWish(ada, 'Ein großes Brettspiel für die Mittagspause');
    await clickText(ada, 'Wünsche speichern');
    await waitText(ada, 'Wünsche gespeichert.');
    await setWish(bea, 'Kaffeebohnen');
    await clickText(bea, 'Wünsche speichern');
    await waitText(bea, 'Jemand aus deinem Team hat den Wunschzettel gerade geändert.');
    await shot(bea, 'konflikt');
    await axe(bea, 'Team-Wunschzettel mit Konflikt');
    await shotCard(bea, 'Euer Team-Wunschzettel', 'wunschzettel');
    await waitText(bea, 'zuletzt geändert von Ada', 15000); // lädt nach dem Konflikt selbst neu
    const text = await bea.$eval('.card .wish-editor textarea', (el) => el.value);
    if (text !== 'Ein großes Brettspiel für die Mittagspause') problems.push(`Bea sieht nach dem Neuladen „${text}“`);
  });

  await step('Schenkendes Team sieht den Team-Wunschzettel und fragt anonym nach', async () => {
    // Wer beschenkt Einkauf? Das Team, dessen Zuordnung „Einkauf“ zeigt.
    let giver = null;
    for (const name of ['Cem', 'Eva']) {
      const p = people[name];
      await clickText(p, 'Päckchen auspacken');
      await waitText(p, 'Euer Team beschenkt');
      if ((await p.$eval('.reveal-name', (e) => e.textContent)) === 'Einkauf') giver = p;
    }
    if (!giver) throw new Error('Niemand beschenkt Einkauf');
    await giver.reload(); // Seite war vor dem Speichern geladen
    await waitText(giver, 'Ein großes Brettspiel für die Mittagspause');
    await waitText(giver, 'zuletzt geändert von Ada');
    await giver.type('textarea[aria-label="Nachricht an das beschenkte Team"]', 'Lieber Tee oder Kaffee?');
    await clickText(giver, 'Anonym fragen');
    await waitText(giver, 'Gesendet.');
    await shot(giver, 'schenkendes-team');
    await axe(giver, 'Schenkendes Team mit Wunschzettel und Post');
    await people.Bea.reload();
    await waitText(people.Bea, 'Lieber Tee oder Kaffee?');
    await waitText(people.Bea, 'Euer Wichtel-Team');
  });

  await step('Datenbank: keine Team- oder Personennamen im Klartext', async () => {
    if (!srv.dbPath || !existsSync(srv.dbPath)) return console.log('     (externe Installation: übersprungen)');
    const raw = Buffer.concat([readFileSync(srv.dbPath), existsSync(`${srv.dbPath}-wal`) ? readFileSync(`${srv.dbPath}-wal`) : Buffer.alloc(0)]);
    for (const s of ['Einkauf', 'Pflege', 'Brettspiel', 'Ada', 'Kaffee']) if (raw.includes(Buffer.from(s))) problems.push(`Klartext in der Datenbank: ${s}`);
  });
} catch (e) {
  problems.push(`Abbruch: ${e.stack || e.message}`);
} finally {
  await browser.close();
  srv.stop();
}

if (problems.length) {
  console.log(`\n${problems.length} Problem(e):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`\n${steps} Schritte ohne Probleme (${axeChecks} axe-Prüfungen).`);
