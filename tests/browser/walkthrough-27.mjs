// Browser-Durchlauf 2.7: Analoge Wichtelrunde zum Ausdrucken. Eingaben bleiben nur im Browser (auch nach Neuladen),
// verdeckte Lose mit Ausschluss, Hut-Zettel, Regeln, Karten in drei Designs, Druck als PDF, Zähler genau einmal,
// keine Namen in Anfragen oder in der Datenbank, „Alles löschen“.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-27.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
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
const NAMES = ['Erna', 'Peter', 'Bea', 'Cemil', 'Daniel', 'Evelyn'];
const requests = [];

const waitText = (page, s, timeout = 10000) => page.waitForFunction((x) => document.body.textContent.includes(x), { timeout, polling: 100 }, s);
async function clickText(page, label) {
  const ok = await page.evaluate((l) => {
    const el = [...document.querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === l && !b.disabled);
    if (el) el.click();
    return !!el;
  }, label);
  if (!ok) throw new Error(`Kein (aktives) Element „${label}“`);
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
/** Druck auslösen (window.print abgefangen), Bogen auslesen, als PDF speichern; danach wie nach dem Drucken aufräumen. */
async function printAndRead(page, button, name) {
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await clickText(page, button);
  await page.waitForFunction(() => window.__printed > 0, { timeout: 5000, polling: 50 });
  const sheet = await page.evaluate(() => {
    const s = document.querySelector('.print-sheet');
    if (!s) return null;
    const txt = (sel) => [...s.querySelectorAll(sel)].map((e) => e.textContent.trim());
    return { cls: s.className, text: s.textContent, slips: [...s.querySelectorAll('.slip')].map((x) => [x.querySelector('.slip-for').textContent, x.querySelector('.slip-receiver').textContent]), names: txt('.hut-name') };
  });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  const file = join(SHOTS || mkdtempSync(join(tmpdir(), 'zw27-')), `v27-${name}.pdf`);
  writeFileSync(file, pdf);
  let pages = null;
  try { pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file]).toString())[1]); } catch { pages = null; }
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  return { ...sheet, pages };
}

try {
  const ctx = await browser.createBrowserContext();
  const page = await deutsch(await ctx.newPage());
  await page.setBypassCSP(true);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  page.on('request', (r) => { if (r.url().includes('/api/')) requests.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' }); });

  await step('Einstieg über „Neue Runde“ ohne Code; Startseite verlinkt ebenfalls', async () => {
    await page.goto(`${srv.base}/#neu`);
    await page.waitForSelector('.mode-link[href="#analog"]');
    await page.click('.mode-link[href="#analog"]');
    await waitText(page, 'Für Runden ganz ohne Handy');
    if (!page.url().endsWith('#analog')) problems.push(`Adresse: ${page.url()}`);
    await page.goto(`${srv.base}/#`);
    await waitText(page, 'Analoge Wichtelrunde zum Ausdrucken – ganz ohne Handy →');
    await clickText(page, 'Analoge Wichtelrunde zum Ausdrucken – ganz ohne Handy →');
    await waitText(page, 'Eckdaten');
  });

  await step('Eckdaten und sechs Namen; doppelter Name abgelehnt', async () => {
    await fill(page, 'Titel', 'Familienwichteln am Kamin');
    await fill(page, 'Datum', '2026-12-24');
    await fill(page, 'Ort (optional)', 'Bei Oma Erna');
    await fill(page, 'Betragslimit (optional)', '25');
    await fill(page, 'Notiz für Regeln und Karten (optional)', 'Bitte nichts Selbstgebackenes');
    for (const n of NAMES) {
      await page.type('.add-person input', n);
      await page.$eval('.add-person', (f) => f.requestSubmit());
      await page.waitForFunction((x) => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === x), { polling: 100 }, n);
    }
    await page.type('.add-person input', 'erna');
    await page.$eval('.add-person', (f) => f.requestSubmit());
    await waitText(page, 'erna steht schon auf der Liste');
    await waitText(page, '6 von höchstens 50 Personen.');
    await axe(page, 'Analoge Runde: Eingabe');
  });

  await step('Verdeckt: Erna und Peter ausschließen, auslosen; Zuordnung nicht auf dem Bildschirm', async () => {
    await clickText(page, 'Paare ausschließen (optional)');
    const val = (n) => page.$eval('select[aria-label="Erste Person"]', (s, x) => [...s.options].find((o) => o.textContent === x).value, n);
    await page.select('select[aria-label="Erste Person"]', await val('Erna'));
    await page.select('select[aria-label="Zweite Person"]', await val('Peter'));
    await clickText(page, 'Ausschließen');
    await waitText(page, 'Erna ⇄ Peter');
    await clickText(page, 'Auslosen');
    await waitText(page, 'Ausgelost für 6 Personen.');
    const screen = await page.$eval('#app', (a) => a.innerText);
    if (/Du beschenkst/.test(screen)) problems.push('Zuordnung auf dem Bildschirm sichtbar');
    await axe(page, 'Analoge Runde: ausgelost');
  });

  await step('Lose drucken: 6 Lose auf einer Seite, niemand beschenkt sich, Ausschluss beachtet', async () => {
    const r = await printAndRead(page, 'Lose drucken', 'lose-verdeckt');
    if (!r?.cls.includes('analog-slips')) throw new Error(`Bogen: ${r?.cls}`);
    const pairs = r.slips.map(([f, rc]) => [f.replace(/^Los für /, ''), rc]);
    if (pairs.length !== 6) problems.push(`Lose: ${pairs.length} statt 6 – ${JSON.stringify(pairs)}`);
    for (const [g, rc] of pairs) {
      if (g === rc) problems.push(`${g} beschenkt sich selbst`);
      if ((g === 'Erna' && rc === 'Peter') || (g === 'Peter' && rc === 'Erna')) problems.push(`Ausschluss verletzt: ${g} → ${rc}`);
    }
    if (new Set(pairs.map((p) => p[1])).size !== 6) problems.push('Beschenkte doppelt');
    if (r.pages !== null && r.pages !== 1) problems.push(`Lose: ${r.pages} PDF-Seiten statt 1`);
    if (!/bis 25 €/.test(r.text)) problems.push('Betragslimit fehlt auf den Losen');
  });

  await step('Neu laden und Browser neu starten (gleiches Profil): alles noch da', async () => {
    await page.reload();
    await waitText(page, 'Ausgelost für 6 Personen.');
    const t = await page.$eval('input[placeholder="z. B. Familienwichteln 2026"]', (i) => i.value);
    if (t !== 'Familienwichteln am Kamin') problems.push(`Titel nach Neuladen: ${t}`);
    const p2 = await deutsch(await ctx.newPage());
    await p2.goto(`${srv.base}/#analog`);
    await waitText(p2, 'Erna ⇄ Peter');
    await p2.close();
  });

  await step('Spielregeln und Karten in drei Designs', async () => {
    const rules = await printAndRead(page, 'Spielregeln drucken', 'regeln');
    for (const x of ['Familienwichteln am Kamin', 'Bei Oma Erna', 'höchstens 25 €', 'Bitte nichts Selbstgebackenes', 'Los allein aufklappen', 'Evelyn']) {
      if (!rules.text.includes(x)) problems.push(`Regeln ohne „${x}“`);
    }
    if (rules.pages !== null && rules.pages !== 1) problems.push(`Regeln: ${rules.pages} Seiten`);
    for (const [design, label] of [['tanne', 'Tannenzweig'], ['sterne', 'Sterne'], ['schleife', 'Schleife']]) {
      await page.evaluate((l) => [...document.querySelectorAll('.design-option')].find((x) => x.textContent.includes(l)).querySelector('input').click(), label);
      const c = await printAndRead(page, 'Karten drucken', `karten-${design}`);
      if ((c.text.match(/Einladung zum Wichteln/g) || []).length !== 6) problems.push(`${design}: Karten ≠ 6`);
      if (c.pages !== null && c.pages !== 2) problems.push(`${design}: ${c.pages} Seiten statt 2`);
      const has = await page.$$eval(`.analog-decor-${design}`, (x) => x.length);
      if (!has) problems.push(`${design}: Verzierung fehlt`);
    }
    await page.evaluate(() => [...document.querySelectorAll('input[name="cardkind"]')].find((x) => x.value === 'erinnerung').click());
    const rem = await printAndRead(page, 'Karten drucken', 'erinnerung');
    if (!/wird gewichtelt\. Denk an dein Geschenk!/.test(rem.text)) problems.push('Erinnerungskarte ohne Text');
    await axe(page, 'Analoge Runde: Karten');
  });

  await step('Hut-Zettel: ein Zettel je Name, Regeln mit „eigenen Namen gezogen“', async () => {
    await page.evaluate(() => [...document.querySelectorAll('input[name="slipmode"]')].find((x) => x.value === 'hut').click());
    await waitText(page, 'Namenszettel drucken');
    const r = await printAndRead(page, 'Namenszettel drucken', 'hut');
    if (JSON.stringify(r.names) !== JSON.stringify(NAMES)) problems.push(`Hut-Zettel: ${r.names}`);
    if (r.pages !== null && r.pages !== 1) problems.push(`Hut-Zettel: ${r.pages} Seiten`);
    if (/Du beschenkst/.test(r.text)) problems.push('Hut-Zettel verraten eine Zuordnung');
    const rules = await printAndRead(page, 'Spielregeln drucken', 'regeln-hut');
    if (!rules.text.includes('Wer den eigenen Namen zieht')) problems.push('Hut-Regeln fehlen');
  });

  await step('Server: genau ein Zähler, keine Namen in Anfragen oder in der Datenbank', async () => {
    const stats = requests.filter((r) => r.url.endsWith('/api/stats/analog'));
    if (stats.length !== 1) problems.push(`Zähler-Anfragen: ${stats.length}`);
    const other = requests.filter((r) => !r.url.endsWith('/api/stats/analog') && !r.url.endsWith('/api/info'));
    if (other.length) problems.push(`Weitere API-Anfragen: ${other.map((r) => `${r.method} ${r.url}`).join(', ')}`);
    for (const r of requests) for (const n of [...NAMES, 'Kamin', 'Oma']) if (r.body.includes(n) || r.url.includes(n)) problems.push(`„${n}“ in Anfrage ${r.url}`);
    if (srv.dbPath && existsSync(srv.dbPath)) {
      const raw = Buffer.concat([readFileSync(srv.dbPath), existsSync(`${srv.dbPath}-wal`) ? readFileSync(`${srv.dbPath}-wal`) : Buffer.alloc(0)]);
      for (const s of ['Familienwichteln', 'Evelyn', 'Daniel', 'Selbstgebackenes']) if (raw.includes(Buffer.from(s))) problems.push(`Klartext in der Datenbank: ${s}`);
      const total = JSON.parse(JSON.parse(srv.sql("SELECT value FROM meta WHERE key = 'stat_analog'"))[0]?.value ?? '{}').total;
      if (total !== 1) problems.push(`Zähler: ${total}`);
    }
  });

  await step('Alles löschen: Eingaben und Lose weg, lokaler Speicher leer', async () => {
    await clickText(page, 'Alles löschen');
    await waitText(page, 'Gelöscht.');
    await waitText(page, '0 von höchstens 50 Personen.');
    const left = await page.evaluate(() => localStorage.getItem('zw.analogRound.v1'));
    if (left !== null) {
      const s = JSON.parse(left);
      if (s.people?.length || s.title || s.pairs) problems.push(`Nach dem Löschen noch gespeichert: ${left.slice(0, 120)}`);
    }
    await page.reload();
    await waitText(page, '0 von höchstens 50 Personen.');
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
