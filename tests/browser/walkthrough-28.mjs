// Browser-Durchlauf 2.8/2.9: Rückfragen beim Anlegen freigeben (mit Namen oder anonym), Frage mit Namen und anonym,
// Organisator:in sieht Namen bzw. „anonym“ und antwortet, Antworten bei den Fragenden, anonyme nur auf dem Gerät der
// fragenden Person, keine Klartexte in der Datenbank; nach der Auslosung „Geschenk besorgt und verpackt“ selbst
// abhaken (Zeitleiste, „Was jetzt?“, nur für die Person sichtbar), Zusagen-Datum bei früher Auslosung.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-28.mjs
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
let steps = 0;

async function newPage(ctx = null) {
  const c = ctx ?? await browser.createBrowserContext();
  const page = await deutsch(await c.newPage());
  await page.setBypassCSP(true); // nur, damit axe eingebunden werden kann
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => { if (process.env.DEBUG) console.log('Dialog:', d.message().slice(0, 120)); d.accept(d.defaultValue()); });
  return page;
}
async function shotCard(page, text, name) {
  if (!SHOTS) return;
  const handle = await page.evaluateHandle((x) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(x)), text);
  const el = handle.asElement();
  if (el) await el.screenshot({ path: join(SHOTS, `v28-card-${name}.png`) });
}
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
async function step(name, fn) {
  steps++;
  await fn();
  console.log(`ok   ${name}`);
}
async function unwrap(page) {
  await page.bringToFront();
  await page.reload();
  await page.waitForSelector('.gift, .reveal-name', { timeout: 10000 });
  if (await page.$('.gift')) await page.click('.gift');
  await waitText(page, 'Du beschenkst');
  return page.$eval('.reveal-name', (e) => e.textContent);
}
/** Einladung annehmen, Zugang als gesichert bestätigen, zusagen. */
async function accept(page, url, name) {
  await page.goto(url);
  await waitText(page, `Hallo ${name}!`);
  await clickText(page, 'Einladung annehmen');
  await waitText(page, 'Zuerst: Zugang sichern');
  await clickText(page, 'Erledigt, ich habe Link und Code gesichert');
  await waitText(page, 'Bist du dabei?');
  await clickText(page, 'Ich bin dabei');
  await waitText(page, 'Deine Antwort:');
}
try {
  const admin = await newPage();
  const names = ['Anna', 'Benedikt', 'Cleo'];
  let invites = {};

  await step('Runde anlegen mit „Rückfragen: mit Namen oder anonym“, drei Personen einladen', async () => {
    await admin.goto(`${srv.base}/#neu`);
    await admin.waitForSelector('form.form');
    await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await admin.type('input[placeholder^="z. B. Familien"]', 'Büroweihnacht');
    await admin.evaluate(() => document.querySelector('input[name="qmode-create"][value="2"]').click());
    // E-Mail-Modus an, damit die Organisator:in eine Adresse für Hinweise hinterlegen kann (2.10)
    await admin.evaluate(() => [...document.querySelectorAll('label.check')].find((l) => l.textContent.includes('auch per E-Mail')).querySelector('input').click());
    await axe(admin, 'Anlegen mit Rückfragen');
    await admin.$eval('form.form', (f) => f.requestSubmit());
    await waitText(admin, 'Zuerst: Admin-Link sichern');
    await clickText(admin, 'Erledigt, ich habe den Link gesichert');
    for (const name of names) {
      await waitText(admin, 'Teilnehmende');
      await admin.type('.add-person input', name);
      await admin.$eval('.add-person', (f) => f.requestSubmit());
      await admin.waitForFunction((x) => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === x), { polling: 100 }, name);
    }
    invites = await admin.evaluate(() => Object.fromEntries([...document.querySelectorAll('.person')].map((li) => [
      li.querySelector('.person-name').textContent,
      [...li.querySelectorAll('a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href'),
    ])));
    const mode = await admin.evaluate(() => document.querySelector('input[name="qmode"]:checked')?.value);
    if (mode !== '2') problems.push(`Rückfragen-Modus nach dem Anlegen: ${mode}`);
  });

  await step('2.10: Organisator:in hinterlegt eine Adresse für Hinweise; nach Neuladen wieder angezeigt', async () => {
    await admin.type('#q-org-email', 'orga@example.org');
    await admin.evaluate(() => [...document.querySelector('.q-mail').querySelectorAll('button')].find((b) => b.textContent === 'Speichern').click());
    await waitText(admin, 'Adresse gespeichert.');
    await admin.reload();
    await admin.waitForFunction(() => document.querySelector('#q-org-email')?.value === 'orga@example.org', { polling: 100, timeout: 10000 });
  });

  const pages = {};
  await step('Alle sagen zu; Hilfe-Knopf führt zur Fragekarte', async () => {
    for (const name of names) {
      pages[name] = await newPage();
      await accept(pages[name], `${srv.base}/${invites[name]}`, name);
    }
    const a = pages.Anna;
    await a.reload();
    await waitText(a, 'Frage an die Organisator:in');
    await clickText(a, 'Frage an die Organisator:in');
    await a.waitForFunction(() => document.activeElement?.id === 'q-text', { polling: 100, timeout: 5000 });
    await waitText(a, 'Bitte schreib nichts darüber, wen du beschenkst');
  });

  const QA = 'Wie funktioniert die Wichtelpost genau?';
  const QB = 'Darf man auch Gutscheine verschenken oder lieber nicht?';
  await step('Anna fragt mit Namen, Benedikt anonym; 700 Zeichen sind die Grenze', async () => {
    const a = pages.Anna;
    await a.type('#q-text', QA);
    await clickText(a, 'Frage senden');
    await waitText(a, 'Frage gesendet.');
    await waitText(a, 'Noch keine Antwort.');
    const b = pages.Benedikt;
    await b.reload();
    await waitText(b, 'Anonym fragen');
    await b.$eval('#q-text', (el) => { el.value = 'x'.repeat(701); el.dispatchEvent(new Event('input')); });
    await waitText(b, '701 von 700 Zeichen');
    await clickText(b, 'Frage senden');
    await waitText(b, 'Höchstens 700 Zeichen.');
    await b.$eval('#q-text', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); });
    await b.type('#q-text', QB);
    await b.click('#q-anon');
    await clickText(b, 'Frage senden');
    await waitText(b, 'Frage gesendet.');
    await waitText(b, 'anonym');
    await shotCard(b, 'Etwas unklar', 'frage-anonym');
    await axe(b, 'Teilnehmende: Rückfrage');
  });

  await step('Organisator:in sieht Anna mit Namen und die anonyme Frage ohne Namen; antwortet', async () => {
    await admin.reload();
    await waitText(admin, 'Rückfragen (2 offen)');
    await waitText(admin, QA);
    await waitText(admin, QB);
    const items = await admin.$$eval('#rueckfragen-admin .q-item', (li) => li.map((x) => ({ meta: x.querySelector('.q-meta').textContent, text: x.querySelector('.q-text')?.textContent })));
    const ia = items.find((x) => x.text === QA);
    const ib = items.find((x) => x.text === QB);
    if (!ia?.meta.includes('Anna')) problems.push(`Frage mit Namen ohne Anna: ${ia?.meta}`);
    if (!ib?.meta.includes('anonym') || /Benedikt|Anna|Cleo/.test(ib?.meta ?? '')) problems.push(`Anonyme Frage zeigt: ${ib?.meta}`);
    for (const [q, ans] of [[QA, 'Über die Karte Wichtelpost, ganz anonym.'], [QB, 'Gutscheine sind völlig in Ordnung.']]) {
      await admin.evaluate((qq, aa) => {
        const li = [...document.querySelectorAll('#rueckfragen-admin .q-item')].find((x) => x.querySelector('.q-text')?.textContent === qq);
        const ta = li.querySelector('textarea');
        ta.value = aa;
        ta.dispatchEvent(new Event('input'));
        [...li.querySelectorAll('button')].find((b) => b.textContent === 'Antworten').click();
      }, q, ans);
      await waitText(admin, 'Antwort gespeichert.');
      await admin.waitForFunction((x) => [...document.querySelectorAll('#rueckfragen-admin .q-item')].some((li) => li.querySelector('.q-text')?.textContent === x && li.textContent.includes('beantwortet')), { polling: 100 }, q);
    }
    await shotCard(admin, 'Teilnehmende können dir Fragen stellen', 'admin-rueckfragen');
    await axe(admin, 'Admin: Rückfragen');
  });

  await step('Antworten kommen an; die anonyme auf allen Geräten von Benedikt (2.14), bei Anna nicht', async () => {
    await pages.Anna.reload();
    await waitText(pages.Anna, 'Über die Karte Wichtelpost, ganz anonym.');
    await pages.Benedikt.reload();
    await waitText(pages.Benedikt, 'Gutscheine sind völlig in Ordnung.');
    if (await pages.Anna.evaluate((x) => document.body.textContent.includes(x), QB)) problems.push('Anna sieht Benedikts Frage');
    // 2.14: Benedikts Link in einem anderen Browser (zweites Gerät): anonyme Frage samt Antwort sichtbar
    const url = pages.Benedikt.url();
    const other = await newPage();
    await other.goto(url);
    await waitText(other, 'Hallo Benedikt!');
    await waitText(other, 'Gutscheine sind völlig in Ordnung.');
    if (!(await other.evaluate((x) => document.body.textContent.includes(x), QB))) problems.push('Anonyme Frage auf dem zweiten Gerät fehlt');
    // … und auch nach dem Einlösen des Wiederherstellungscodes auf einem dritten Gerät
    const code = await pages.Benedikt.evaluate(() => document.querySelector('.recovery-code')?.textContent ?? null);
    if (code) {
      const third = await newPage();
      await third.goto(`${srv.base}/#wiederherstellen/${code.replace(/-/g, '')}`);
      await clickText(third, 'Wiederherstellen');
      await waitText(third, 'Gutscheine sind völlig in Ordnung.');
      if (!(await third.evaluate((x) => document.body.textContent.includes(x), QB))) problems.push('Anonyme Frage nach Wiederherstellung fehlt');
      pages.Benedikt = third; // die bisherigen Geräte sind jetzt abgemeldet; weiter mit dem neuen
    } else problems.push('Wiederherstellungscode auf Benedikts Seite nicht gefunden');
    await other.close();
  });

  await step('Datenbank: Fragen und Antworten verschlüsselt, anonyme ohne Person', async () => {
    if (!srv.dbPath || !existsSync(srv.dbPath)) return console.log('     (externe Installation: übersprungen)');
    const raw = Buffer.concat([readFileSync(srv.dbPath), existsSync(`${srv.dbPath}-wal`) ? readFileSync(`${srv.dbPath}-wal`) : Buffer.alloc(0)]);
    for (const s of ['Wichtelpost genau', 'Gutscheine', 'völlig in Ordnung', 'Büroweihnacht']) if (raw.includes(Buffer.from(s))) problems.push(`Klartext in der Datenbank: ${s}`);
    const rows = JSON.parse(srv.sql('SELECT pid IS NULL AS anon, own_ct IS NULL AS noown, thread_hash IS NULL AS nothread FROM questions ORDER BY rowid'));
    // 2.14: auch die anonyme Frage hat eine eigene Kopie (own_ct, mit dem Antwortschlüssel) – ohne Personenbezug
    if (JSON.stringify(rows) !== JSON.stringify([{ anon: 0, noown: 0, nothread: 1 }, { anon: 1, noown: 0, nothread: 0 }])) problems.push(`Fragen-Zeilen: ${JSON.stringify(rows)}`);
  });

  await step('Auslosen; Zeitleiste zeigt bei „Zusagen“ den Tag der Auslosung', async () => {
    await admin.reload();
    await waitText(admin, 'Teilnehmende');
    await clickText(admin, 'Jetzt auslosen');
    await waitText(admin, 'Die Ziehung ist am');
    const a = pages.Anna;
    await a.bringToFront();
    await a.reload();
    await waitText(a, 'Mein Geschenk ist besorgt und verpackt');
    const dates = await a.$$eval('.tl-step', (li) => li.map((x) => [x.querySelector('.tl-label').textContent, x.querySelector('.tl-date')?.textContent ?? '']));
    const labels = dates.map((d) => d[0]);
    if (labels.join('|') !== 'Zusagen|Auslosen|Wünsche|Geschenk besorgen|Bescherung|Raten und Danke sagen|Löschung') problems.push(`Zeitleiste: ${labels.join('|')}`);
    if (dates[0][1] !== dates[1][1]) problems.push(`Zusagen-Datum ${dates[0][1]} ≠ Auslosung ${dates[1][1]}`);
  });

  await step('Anna hakt „Geschenk besorgt und verpackt“ ab – bleibt nach Neuladen, nur für sie', async () => {
    const a = pages.Anna;
    await a.click('.gift-check input');
    await waitText(a, 'Abgehakt.');
    await waitText(a, 'Alles erledigt: Geschenk besorgt und verpackt.');
    await a.reload();
    await waitText(a, 'Alles erledigt');
    const st = await a.evaluate(() => ({ checked: document.querySelector('.gift-check input').checked, done: [...document.querySelectorAll('.tl-step')].find((x) => x.textContent.includes('Geschenk besorgen')).classList.contains('tl-done') }));
    if (!st.checked || !st.done) problems.push(`Nach Neuladen: ${JSON.stringify(st)}`);
    if (SHOTS) {
      for (const scheme of ['light', 'dark']) {
        await a.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
        const el = (await a.evaluateHandle(() => document.querySelector('.gift-check').closest('.card'))).asElement();
        await el.screenshot({ path: join(SHOTS, `v28-was-jetzt-${scheme}.png`) });
      }
      await a.emulateMediaFeatures([]);
    }
    await axe(a, 'Teilnehmende: abgehakt');
    const c = pages.Cleo;
    await c.bringToFront();
    await c.reload();
    await waitText(c, 'Mein Geschenk ist besorgt und verpackt');
    if (await c.evaluate(() => document.querySelector('.gift-check input').checked)) problems.push('Cleo sieht Annas Haken');
    await admin.reload();
    await waitText(admin, 'Teilnehmende');
    if (await admin.evaluate(() => document.body.textContent.includes('verpackt'))) problems.push('Organisator:in sieht einen Haken');
    await a.bringToFront();
    await a.click('.gift-check input');
    await waitText(a, 'Haken entfernt.');
  });

  await step('2.10.1: Cleo legt ihre Wünsche fest – ihr Wichtel sieht es, Zeitleiste, Organisator:in hebt auf', async () => {
    const c = pages.Cleo;
    await c.bringToFront();
    await c.reload();
    await waitText(c, 'Speichern & festlegen');
    await c.type('.wish-item textarea', 'Ein Puzzle mit 1000 Teilen');
    await clickText(c, 'Speichern & festlegen');
    await waitText(c, 'Wünsche gespeichert und festgelegt.');
    await waitText(c, 'Kleine Korrekturen sind noch bis');
    await waitText(c, 'Deine Wünsche sind festgelegt – dein Wichtel sieht das und kann schon loslegen.');
    const wishDone = await c.evaluate(() => [...document.querySelectorAll('.tl-step')].find((x) => x.textContent.includes('Wünsche')).classList.contains('tl-done'));
    if (!wishDone) problems.push('Zeitleiste: Wünsche nach dem Festlegen nicht erledigt');
    if (await c.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Speichern & festlegen'))) problems.push('„Speichern & festlegen“ nach dem Festlegen noch da');
    await shotCard(c, 'Deine Wünsche', 'wuensche-festgelegt');
    await axe(c, 'Wünsche festgelegt');
    // Wichtel von Cleo finden
    let giver = null;
    for (const n of ['Anna', 'Benedikt']) if (await unwrap(pages[n]) === 'Cleo') giver = pages[n];
    if (!giver) throw new Error('Cleos Wichtel nicht gefunden');
    await giver.reload();
    await waitText(giver, 'Ein Puzzle mit 1000 Teilen');
    await waitText(giver, 'Deine Person hat ihre Wünsche festgelegt; kleine Korrekturen sind noch bis');
    await shotCard(giver, 'Du beschenkst', 'wichtel-sieht-festgelegt');
    // Organisator:in hebt auf
    await admin.bringToFront();
    await admin.reload();
    await waitText(admin, 'Wünsche festgelegt');
    await clickText(admin, 'Festlegung aufheben');
    await waitText(admin, 'Festlegung aufgehoben.');
    await c.bringToFront();
    await c.reload();
    await waitText(c, 'Speichern & festlegen');
    await giver.bringToFront();
    await giver.reload();
    await waitText(giver, 'Ein Puzzle mit 1000 Teilen');
    if (await giver.evaluate(() => document.body.textContent.includes('hat ihre Wünsche festgelegt'))) problems.push('Wichtel sieht nach dem Aufheben noch „festgelegt“');
  });

  await step('Organisator:in löscht Annas Frage – Anna sieht sie nicht mehr', async () => {
    await waitText(admin, QA);
    await admin.evaluate((qq) => {
      const li = [...document.querySelectorAll('#rueckfragen-admin .q-item')].find((x) => x.querySelector('.q-text')?.textContent === qq);
      [...li.querySelectorAll('button')].find((b) => b.textContent === 'Löschen').click();
    }, QA);
    await admin.waitForFunction((x) => !document.body.textContent.includes(x), { polling: 100 }, QA);
    await pages.Anna.bringToFront();
    await pages.Anna.reload();
    await waitText(pages.Anna, 'Frage an die Organisator:in');
    await new Promise((r) => setTimeout(r, 600));
    if (await pages.Anna.evaluate((x) => document.body.textContent.includes(x), QA)) problems.push('Gelöschte Frage noch sichtbar');
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
