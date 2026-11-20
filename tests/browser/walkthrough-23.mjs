// Browser-Durchlauf 2.3: Gruppenlink, Checkliste, Zeitleiste, Steckbrief, Tracking-Bereinigung, Päckchen,
// Rätselhinweise, Ideen-Würfel, Countdown/Schnee, Raten/Auflösen/Danke, Probelauf und englische Oberfläche.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-23.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from '../helpers/server.mjs';

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.log('CHROME_PATH nicht gesetzt – übersprungen.'); process.exit(0); }
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const srv = await startServer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split('|') : [])] });
const problems = [];
let n = 0;
let steps = 0;

async function newPage({ german = true } = {}) {
  const ctx = await browser.createBrowserContext();
  let page = await ctx.newPage();
  if (german) page = await deutsch(page);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 410/.test(m.text())) problems.push(`Konsole: ${m.text()}`); }); // 410 = absichtlich voller Gruppenlink
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.defaultValue()));
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `v23-${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const waitText = (page, s, timeout = 10000) => page.waitForFunction((x) => document.body.textContent.includes(x), { timeout, polling: 100 }, s);
async function clickText(page, label, within = 'body') {
  const ok = await page.evaluate((l, w) => {
    const el = [...document.querySelector(w).querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === l);
    if (el) el.click();
    return !!el;
  }, label, within);
  if (!ok) throw new Error(`Kein Element „${label}“`);
}
/** Feld anhand der Beschriftung füllen (innerhalb eines optionalen Containers). */
async function fill(page, label, value, within = 'body') {
  const id = await page.evaluate((l, w) => [...document.querySelector(w).querySelectorAll('label')].find((x) => x.textContent.replace(' *', '').trim() === l)?.htmlFor, label, within);
  if (!id) throw new Error(`Kein Feld „${label}“`);
  await page.$eval(`#${id}`, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}
async function step(name, fn) {
  steps++;
  await fn();
  console.log(`ok   ${name}`);
}

try {
  const admin = await newPage();
  let groupLink = '';

  await step('Runde anlegen; Checkliste und Zeitleiste sichtbar', async () => {
    await admin.goto(`${srv.base}/#neu`);
    await admin.waitForSelector('form.form');
    await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await admin.type('input[placeholder^="z. B. Familien"]', 'Teamwichteln');
    await admin.$eval('form.form', (f) => f.requestSubmit());
    await waitText(admin, 'Zuerst: Admin-Link sichern');
    await waitText(admin, 'Checkliste: 0 von 8 erledigt');
    await clickText(admin, 'Erledigt, ich habe den Link gesichert');
    await waitText(admin, 'Checkliste: 1 von 8 erledigt');
    await clickText(admin, 'Ich wichtle nicht selbst mit');
    await waitText(admin, 'Checkliste: 2 von 8 erledigt');
    const here = await admin.$eval('.timeline .tl-current .tl-label', (e) => e.textContent);
    if (here !== 'Zusagen') problems.push(`Zeitleiste: aktueller Schritt „${here}“`);
  });

  await step('Gruppenlink erstellen (höchstens 3)', async () => {
    await clickText(admin, 'Gruppenlink (optional)');
    await fill(admin, 'Höchstens so viele Personen', '3', '.group-link');
    await clickText(admin, 'Gruppenlink erstellen');
    await waitText(admin, '0 von 3 eingetragen');
    groupLink = await admin.$eval('.group-share a[href^="sms:"]', (a) => decodeURIComponent(a.getAttribute('href').split('body=')[1]).match(/https?:\/\/\S+/)[0]);
    if (!/#j\//.test(groupLink)) problems.push(`Gruppenlink unerwartet: ${groupLink}`);
    await shot(admin, 'gruppenlink');
  });

  const pages = {};
  await step('Zwei Personen tragen sich selbst ein (deutsch)', async () => {
    for (const name of ['Ada', 'Bea']) {
      const p = await newPage();
      await p.goto(groupLink);
      await waitText(p, 'Du bist eingeladen, dich selbst einzutragen.');
      await fill(p, 'Dein Name', name);
      await clickText(p, 'Mich eintragen');
      await waitText(p, 'Du bist eingetragen und dabei.');
      await waitText(p, 'Was jetzt?');
      await clickText(p, 'Erledigt, ich habe Link und Code gesichert');
      pages[name] = p;
    }
    await shot(pages.Ada, 'eingetragen');
  });

  await step('Dritte Person auf Englisch (Umschalter im Fußbereich)', async () => {
    const p = await newPage({ german: false });
    await p.goto(groupLink);
    await p.waitForSelector('#lang-toggle');
    if ((await p.$eval('#lang-toggle', (b) => b.textContent)) !== 'English') await p.$eval('#lang-toggle', (b) => b.click());
    await p.$eval('#lang-toggle', (b) => b.click());
    await waitText(p, 'You are invited to sign yourself up.');
    await fill(p, 'Your name', 'Cy');
    await clickText(p, 'Sign me up');
    await waitText(p, 'You are signed up and in.');
    await waitText(p, 'What now?');
    if ((await p.$eval('html', (h) => h.lang)) !== 'en') problems.push('html lang nicht en');
    await clickText(p, 'Done, I have saved the link and code');
    await shot(p, 'englisch');
    pages.Cy = p;
  });

  await step('Gruppenlink voll: vierte Person wird abgewiesen', async () => {
    const p = await newPage();
    await p.goto(groupLink);
    await waitText(p, 'schon alle vorgesehenen Personen eingetragen');
    await p.browserContext().close();
  });

  await step('Verwaltung: per Gruppenlink, Zähler, Einladungskarten', async () => {
    await admin.reload();
    await waitText(admin, '3 von 3 eingetragen');
    const chips = await admin.$$eval('.person .chip', (cs) => cs.filter((c) => c.textContent === 'per Gruppenlink').length);
    if (chips !== 3) problems.push(`„per Gruppenlink“ ${chips}×`);
    await admin.type('form.add-person input[type="text"]', 'Dora');
    await admin.$eval('form.add-person', (f) => f.requestSubmit());
    await admin.waitForFunction(() => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === 'Dora'), { polling: 100 });
    await admin.evaluate(() => { window.print = () => { window.__printed = document.querySelectorAll('.print-card').length; }; });
    await clickText(admin, 'Einladungskarten drucken');
    await admin.waitForFunction(() => window.__printed !== undefined, { polling: 50 });
    const cards = await admin.evaluate(() => window.__printed);
    if (cards !== 1) problems.push(`Einladungskarten: ${cards} statt 1`);
  });

  await step('Steckbrief und Tracking-Bereinigung beim Speichern', async () => {
    const p = pages.Ada;
    await p.reload();
    await waitText(p, 'Deine Wünsche');
    await p.type('.wish-editor textarea', 'Ein Kochbuch');
    await p.type('.wish-editor input[type="url"]', 'https://shop.example/buch?utm_source=newsletter&fbclid=x&format=hardcover');
    await clickText(p, 'Steckbrief (optional)');
    await fill(p, 'Lieblingsfarben', 'Grün', '.profile-edit');
    // Gesundheitsangabe (Art. 9 DSGVO): Feld erst nach Einwilligung beschreibbar
    if (!(await p.$eval('.health-consent input[type="text"]', (i) => i.disabled))) problems.push('Allergie-Feld ohne Einwilligung beschreibbar');
    await p.click('.health-consent .consent-check input');
    await p.waitForFunction(() => !document.querySelector('.health-consent input[type="text"]').disabled, { polling: 100 });
    await fill(p, 'Allergien und Unverträglichkeiten', 'Nüsse', '.profile-edit');
    if (SHOTS) { await p.$eval('.health-consent', (e) => e.scrollIntoView()); await p.screenshot({ path: join(SHOTS, 'v23-einwilligung.png') }); }
    await clickText(p, 'Wünsche speichern');
    await waitText(p, 'Aus deinen Links wurden 2 Tracking-Angaben entfernt.');
    const link = await p.$eval('.wish-editor input[type="url"]', (i) => i.value);
    if (link !== 'https://shop.example/buch?format=hardcover') problems.push(`Link nicht bereinigt: ${link}`);
  });

  const gives = {};
  await step('Ziehung; jede:r packt das Päckchen aus', async () => {
    await admin.reload();
    await waitText(admin, 'Jetzt auslosen');
    await clickText(admin, 'Jetzt auslosen');
    await waitText(admin, 'Schon nachgesehen: 0 von 3');
    for (const [name, p] of Object.entries(pages)) {
      await p.reload();
      await p.waitForSelector('.gift');
      if (name === 'Ada') await shot(p, 'paeckchen');
      await p.click('.gift');
      await p.waitForSelector('.reveal-name');
      gives[name] = await p.$eval('.reveal-name', (e) => e.textContent);
      await p.reload();
      await p.waitForSelector('.reveal-name'); // kein zweites Päckchen
      if (await p.$('.gift')) problems.push(`${name}: Päckchen erscheint erneut`);
    }
    if (new Set(Object.values(gives)).size !== 3) problems.push(`Zuordnung unplausibel: ${JSON.stringify(gives)}`);
  });

  const giverOf = (name) => Object.keys(gives).find((g) => gives[g] === name);
  await step('Wichtel sieht Steckbrief und bereinigten Link; Ideen-Würfel', async () => {
    const g = pages[giverOf('Ada')];
    await g.reload();
    await g.waitForSelector('.reveal-name');
    const text = await g.$eval('.card-reveal', (c) => c.textContent);
    if (!/Nüsse/.test(text) || !/Grün/.test(text)) problems.push('Steckbrief beim Wichtel nicht sichtbar');
    const href = await g.$eval('.card-reveal a.ext-link', (a) => a.href);
    if (/utm_|fbclid/.test(href)) problems.push(`Tracking im Link beim Wichtel: ${href}`);
    if (g !== pages.Cy) {
      await clickText(g, 'Ideen-Würfel');
      await clickText(g, 'Idee würfeln');
      await g.waitForFunction(() => document.querySelector('.idea-out')?.textContent, { timeout: 5000 }).catch(() => {});
      const idea = await g.$eval('.idea-out', (e) => e.textContent);
      if (!idea) problems.push('Ideen-Würfel ohne Vorschlag');
    }
  });

  await step('Widerruf der Einwilligung nach der Wunschfrist löscht die Allergie-Angabe auch beim Wichtel', async () => {
    srv.sql("UPDATE rounds SET wish_deadline = CAST(strftime('%s','now') AS INTEGER) - 60, event_date = CAST(strftime('%s','now') AS INTEGER) + 86400");
    const p = pages.Ada;
    await p.reload();
    await waitText(p, 'Die Wunschfrist ist abgelaufen.');
    await clickText(p, 'Einwilligung widerrufen und Allergie-Angabe löschen');
    await waitText(p, 'Einwilligung widerrufen, Angabe gelöscht.');
    const g = pages[giverOf('Ada')];
    await g.reload();
    await g.waitForSelector('.reveal-name');
    const text = await g.$eval('.card-reveal', (c) => c.textContent);
    if (/Nüsse/.test(text)) problems.push('Allergie nach Widerruf beim Wichtel noch sichtbar');
    if (!/Grün/.test(text)) problems.push('Übriger Steckbrief nach Widerruf verschwunden');
  });

  await step('Rätselhinweis planen und freischalten', async () => {
    const g = pages[giverOf('Bea')];
    await g.reload();
    await g.waitForSelector('.reveal-name');
    await clickText(g, g === pages.Cy ? 'Riddle hints (optional)' : 'Rätselhinweise (optional)');
    await g.type('.hint-form textarea', 'Ich trinke Tee mit Milch.');
    await clickText(g, g === pages.Cy ? 'Schedule hint' : 'Hinweis planen');
    await g.waitForSelector('.hints-giver .hint-item');
    const r = pages.Bea;
    srv.sql("UPDATE hints SET release_at = CAST(strftime('%s','now') AS INTEGER) + 86400");
    await r.reload();
    await waitText(r, 'Noch 1 Hinweis kommt');
    if ((await r.content()).includes('Tee mit Milch')) problems.push('Hinweis vor der Freischaltung ausgeliefert');
    srv.sql("UPDATE hints SET release_at = CAST(strftime('%s','now') AS INTEGER) - 10");
    await r.reload();
    await waitText(r, 'Ich trinke Tee mit Milch.');
    await shot(r, 'hinweis');
  });

  await step('Countdown und Schnee (an/aus)', async () => {
    const p = pages.Bea;
    await p.waitForSelector('.countdown');
    await clickText(p, 'Schneefall');
    await p.waitForSelector('canvas.snow');
    await shot(p, 'schnee');
    await clickText(p, 'Schneefall');
    await p.waitForFunction(() => !document.querySelector('canvas.snow'), { polling: 100 });
  });

  await step('Nach der Bescherung: raten, auflösen, danken', async () => {
    srv.sql("UPDATE rounds SET wish_deadline = CAST(strftime('%s','now') AS INTEGER) - 7200, event_date = CAST(strftime('%s','now') AS INTEGER) - 3600");
    const r = pages.Bea;
    const gName = giverOf('Bea');
    const g = pages[gName];
    await r.reload();
    await waitText(r, 'Wer war’s?');
    await fill(r, 'Dein Tipp', gName);
    await clickText(r, 'Tipp abgeben');
    await waitText(r, 'Tipp verschickt.');
    // Nach dem Tipp wird die Ansicht neu aufgebaut; erst danach gibt es das Feld (sonst gelegentlich „Kein Feld“)
    await r.waitForFunction(() => [...document.querySelectorAll('label')].some((x) => x.textContent.replace(' *', '').trim() === 'Dein Dankeschön'), { timeout: 10000, polling: 100 });
    await fill(r, 'Dein Dankeschön', 'Danke, der Tee ist super!');
    await clickText(r, 'Danke senden');
    await waitText(r, 'Dankeschön verschickt.');
    await g.reload();
    await g.waitForSelector('.reveal-name');
    const en = g === pages.Cy;
    await waitText(g, en ? 'Your person guesses' : 'Deine Person tippt auf');
    await waitText(g, 'Danke, der Tee ist super!');
    await clickText(g, en ? 'Reveal myself' : 'Mich zu erkennen geben');
    await waitText(g, en ? 'You have revealed yourself.' : 'Du hast dich zu erkennen gegeben.');
    await r.reload();
    await waitText(r, `Dein Wichtel hat sich zu erkennen gegeben: ${gName}`);
    await shot(r, 'aufgeloest');
    const here = await r.$eval('.timeline .tl-current .tl-label', (e) => e.textContent);
    if (here !== 'Raten und Danke sagen') problems.push(`Zeitleiste nach der Bescherung: „${here}“`);
  });

  await step('Probelauf ohne Server', async () => {
    const p = await newPage();
    await p.goto(`${srv.base}/`);
    await clickText(p, 'Ziehung ausprobieren – ohne Anmeldung →');
    await waitText(p, 'Probier die Ziehung aus');
    const api = [];
    p.on('request', (r) => { if (r.url().includes('/api/')) api.push(r.url()); });
    await clickText(p, 'Auslosen');
    await p.waitForSelector('.envelope');
    const count = await p.$$eval('.envelope', (e) => e.length);
    if (count !== 4) problems.push(`Probelauf: ${count} Umschläge`);
    await clickText(p, 'Als Anna öffnen');
    await waitText(p, 'Anna beschenkt');
    await shot(p, 'probelauf');
    if (api.length) problems.push(`Probelauf hat den Server angesprochen: ${api.join(', ')}`);
  });
} catch (e) {
  problems.push(`FAIL ${e.stack || e}`);
}

await browser.close();
srv.stop();
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log(`\n${steps} Schritte, 0 Fehler`);
