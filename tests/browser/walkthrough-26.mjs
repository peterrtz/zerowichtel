// Browser-Durchlauf 2.6: Ohne Smartphone mitwichteln. Organisator:in trägt Erna (ohne Smartphone) mit Helfer Peter ein,
// Peter nimmt auf seinem Gerät beide Einladungen an, Grenze bei 6 Personen (höchstens 1 mit mitwichtelnder Helfer:in,
// externe Helfer:in zählt nicht), Auslosung: Erna und Peter ziehen sich nie, Peter sieht Ernas Zuordnung und trägt
// ihre Wünsche ein, Ernas Wichtel sieht nichts von der Hilfe, Ausschlussliste enthält das Paar (für ältere Versionen).
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-26.mjs
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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `v26-${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
async function shotCard(page, text, name) {
  if (!SHOTS) return;
  const handle = await page.evaluateHandle((x) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(x)), text);
  const el = handle.asElement();
  if (el) await el.screenshot({ path: join(SHOTS, `v26-card-${name}.png`) });
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
  await page.bringToFront(); // Peter hat zwei Tabs im selben Browser – Hintergrund-Tabs rendern nicht weiter
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
/** Organisator-Daten (K_admin) im Browser der Organisator:in entschlüsseln. */
const adminData = (page) => page.evaluate(async () => {
  const L = await import('/js/lib/links.js');
  const M = await import('/js/lib/model.js');
  return (await M.loadAdmin(L.parseFragment(location.hash))).admin;
});
async function addAnalog(page, analog, helper, extName = '') {
  await page.select('select[aria-label="Wer wichtelt ohne Smartphone mit?"]', await page.$eval('select[aria-label="Wer wichtelt ohne Smartphone mit?"]', (s, x) => [...s.options].find((o) => o.textContent === x).value, analog));
  const hv = await page.$eval('select[aria-label="Wer hilft?"]', (s, x) => [...s.options].find((o) => o.textContent === x)?.value ?? null, helper);
  if (!hv) throw new Error(`${helper} steht nicht zur Wahl`);
  await page.select('select[aria-label="Wer hilft?"]', hv);
  if (extName) await page.type('input[aria-label="Name der Helfer:in"]', extName);
  await clickText(page, 'Eintragen');
}

try {
  const admin = await newPage();
  const names = ['Erna', 'Peter', 'Bea', 'Cem', 'Dan', 'Eva'];
  let invites = {};

  await step('Runde anlegen, sechs Personen einladen', async () => {
    await admin.goto(`${srv.base}/#neu`);
    await admin.waitForSelector('form.form');
    await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await admin.type('input[placeholder^="z. B. Familien"]', 'Familienwichteln');
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
  });

  await step('Erna ohne Smartphone, Peter hilft; Auswahl verhindert Doppelrollen', async () => {
    await waitText(admin, 'Ohne Smartphone mitwichteln (optional)');
    await clickText(admin, 'Ohne Smartphone mitwichteln (optional)');
    await addAnalog(admin, 'Erna', 'Peter');
    await waitText(admin, 'Erna – hilft: Peter');
    const offered = await admin.evaluate(() => ({
      analog: [...document.querySelector('select[aria-label="Wer wichtelt ohne Smartphone mit?"]').options].map((o) => o.textContent),
    }));
    if (offered.analog.includes('Erna') || offered.analog.includes('Peter')) problems.push(`Erna/Peter erneut wählbar: ${offered.analog}`);
    await admin.select('select[aria-label="Wer wichtelt ohne Smartphone mit?"]', await admin.$eval('select[aria-label="Wer wichtelt ohne Smartphone mit?"]', (s) => [...s.options].find((o) => o.textContent === 'Bea').value));
    const helpers = await admin.$eval('select[aria-label="Wer hilft?"]', (s) => [...s.options].map((o) => o.textContent));
    if (helpers.includes('Peter') || helpers.includes('Erna') || helpers.includes('Bea')) problems.push(`Als Helfer:in wählbar: ${helpers}`);
    // Ausschluss-Anzeige zeigt das Paar nicht doppelt
    if (await admin.evaluate(() => document.body.textContent.includes('Erna ⇄ Peter'))) problems.push('Paar Erna ⇄ Peter erscheint unter „Ausschlüsse“');
    await clickText(admin, 'Regeln speichern');
    await waitText(admin, 'Regeln gespeichert.');
    await shotCard(admin, 'Wer kein Smartphone hat', 'admin-analog');
    await axe(admin, 'Admin: ohne Smartphone');
    const a = await adminData(admin);
    if (JSON.stringify(a.analog) !== JSON.stringify([{ pid: a.analog[0]?.pid, helper: a.analog[0]?.helper }]) || !a.analog[0]?.helper) problems.push(`Organisator-Daten: ${JSON.stringify(a.analog)}`);
    const pair = [a.analog[0].pid, a.analog[0].helper];
    if (!a.exclusions.some(([x, y]) => (x === pair[0] && y === pair[1]) || (x === pair[1] && y === pair[0]))) problems.push('Paar fehlt in der Ausschlussliste (ältere Versionen würden es nicht beachten)');
  });

  await step('Teilnehmerliste: Erna mit „Link an Helfer:in“ und Hinweistext an Peter', async () => {
    await admin.reload();
    await waitText(admin, 'ohne Smartphone · hilft: Peter');
    await waitText(admin, 'hilft Erna');
    const text = await admin.evaluate(() => {
      const li = [...document.querySelectorAll('.person')].find((x) => x.querySelector('.person-name').textContent === 'Erna');
      return [...li.querySelectorAll('button')].map((b) => b.textContent).join('|');
    });
    if (!text.includes('Link an Helfer:in')) problems.push(`Knöpfe bei Erna: ${text}`);
    await shot(admin, 'teilnehmende');
    await axe(admin, 'Admin: Teilnehmerliste mit Helfer:in');
  });

  const pages = {};
  let peterCtx = null;
  await step('Peter nimmt seine und Ernas Einladung auf demselben Gerät an', async () => {
    pages.Peter = await newPage();
    peterCtx = pages.Peter.browserContext();
    await accept(pages.Peter, `${srv.base}/${invites.Peter}`, 'Peter');
    pages.Erna = await newPage(peterCtx);
    await accept(pages.Erna, `${srv.base}/${invites.Erna}`, 'Erna');
    const home = await newPage(peterCtx);
    await home.goto(`${srv.base}/#`);
    await waitText(home, 'Teilnahme · Erna');
    await waitText(home, 'Teilnahme · Peter');
    await shotCard(home, 'Meine Runden auf diesem Gerät', 'meine-runden');
    await home.close();
    for (const name of ['Bea', 'Cem', 'Dan', 'Eva']) {
      pages[name] = await newPage();
      await accept(pages[name], `${srv.base}/${invites[name]}`, name);
    }
  });

  await step('Grenze bei 6 Personen: zweite mitwichtelnde Helfer:in gesperrt, externe Helfer:in erlaubt', async () => {
    await admin.reload();
    await waitText(admin, 'Ohne Smartphone mitwichteln (optional)');
    await waitText(admin, 'Mit mitwichtelnder Helfer:in: 1 von höchstens 1 bei derzeit 6 Zusagen.');
    await addAnalog(admin, 'Bea', 'Cem');
    await waitText(admin, 'Bei 6 Personen dürfen höchstens 1 ohne Smartphone mitwichteln');
    if (!(await admin.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Jetzt auslosen').disabled))) problems.push('Auslosen trotz überschrittener Grenze möglich');
    await shotCard(admin, 'Auslosen', 'grenze');
    // Bea-Eintrag entfernen, mit externer Helferin Inge neu eintragen
    await admin.evaluate(() => {
      const li = [...document.querySelectorAll('.analog-list li')].find((x) => x.textContent.startsWith('Bea'));
      [...li.querySelectorAll('button')].find((b) => b.textContent === 'Entfernen').click();
    });
    await addAnalog(admin, 'Bea', 'jemand, der nicht mitwichtelt …', 'Ingeborg');
    await waitText(admin, 'Bea – hilft: Ingeborg');
    await waitText(admin, 'Ziehung möglich.');
    await clickText(admin, 'Regeln speichern');
    await waitText(admin, 'Regeln gespeichert.');
    await axe(admin, 'Admin: Grenze und externe Helferin');
  });

  await step('Team-Wichteln ist gesperrt, solange jemand ohne Smartphone eingetragen ist', async () => {
    await clickText(admin, 'Team-Wichteln (optional)');
    await waitText(admin, 'Team-Wichteln geht nicht zusammen mit Mitwichtelnden ohne Smartphone.');
    if (await admin.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Team-Wichteln einschalten'))) problems.push('Team-Wichteln trotz analoger Einträge einschaltbar');
  });

  const reveal = {};
  await step('Auslosen: Erna und Peter ziehen sich nicht; Peter sieht Ernas Zuordnung', async () => {
    await clickText(admin, 'Jetzt auslosen');
    await waitText(admin, 'Die Ziehung ist am');
    for (const name of names) {
      await pages[name].reload();
      reveal[name] = await unwrap(pages[name]);
    }
    if (reveal.Erna === 'Peter' || reveal.Peter === 'Erna') problems.push(`Erna/Peter ziehen sich: ${JSON.stringify(reveal)}`);
    if (new Set(Object.values(reveal)).size !== 6) problems.push(`Zuordnung nicht eindeutig: ${JSON.stringify(reveal)}`);
    await shot(pages.Erna, 'erna-zuordnung-bei-peter');
  });

  await step('Peter trägt Ernas Wünsche ein; Ernas Wichtel sieht sie und nichts von der Hilfe', async () => {
    const erna = pages.Erna;
    await erna.bringToFront();
    await erna.reload();
    await waitText(erna, 'Deine Wünsche');
    await erna.type('.wish-item textarea', 'Ein Kreuzworträtselheft mit großer Schrift');
    await clickText(erna, 'Wünsche speichern');
    await erna.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('gespeichert'), { polling: 100 });
    const giverName = Object.keys(reveal).find((k) => reveal[k] === 'Erna');
    const g = pages[giverName];
    await g.bringToFront();
    await g.reload();
    await waitText(g, 'Kreuzworträtselheft');
    const leak = await g.evaluate(() => ['Smartphone', 'Helfer', 'Peter hilft', 'Ingeborg'].filter((w) => document.body.textContent.includes(w)));
    if (leak.length) problems.push(`Ernas Wichtel (${giverName}) sieht: ${leak.join(', ')}`);
    await shot(g, 'ernas-wichtel');
    await axe(g, 'Ernas Wichtel');
  });

  await step('Datenbank: keine Namen im Klartext', async () => {
    if (!srv.dbPath || !existsSync(srv.dbPath)) return console.log('     (externe Installation: übersprungen)');
    const raw = Buffer.concat([readFileSync(srv.dbPath), existsSync(`${srv.dbPath}-wal`) ? readFileSync(`${srv.dbPath}-wal`) : Buffer.alloc(0)]);
    for (const s of ['Familienwichteln', 'Kreuzworträtsel', 'Smartphone', 'Peter', 'Ingeborg']) {
      const at = raw.indexOf(Buffer.from(s));
      if (at >= 0) problems.push(`Klartext in der Datenbank: ${s} – Umgebung: ${raw.subarray(Math.max(0, at - 30), at + s.length + 30).toString('latin1').replace(/[^\x20-\x7E]/g, '·')}`);
    }
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
