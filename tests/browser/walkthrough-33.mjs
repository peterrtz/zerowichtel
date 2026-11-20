// Browser-Durchlauf 2.13.2: Eine Runde auf zwei Geräten. „Auf weiterem Gerät öffnen“ hält beide angemeldet;
// wird der Wiederherstellungscode auf einem dritten Gerät eingelöst, erklärt das alte Gerät beim nächsten Klick, was los ist,
// statt nur „Nicht gefunden oder Link ungültig“ zu melden.
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
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
  // 404 ist hier gewollt (veralteter Zugang); alles andere zählt
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => { if (process.env.DEBUG) console.log('Dialog:', d.message().slice(0, 120)); d.accept(d.defaultValue()); });
  return page;
}
async function shotCard(page, text, name) {
  if (!SHOTS) return;
  const handle = await page.evaluateHandle((x) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(x)), text);
  const el = handle.asElement();
  if (el) await el.screenshot({ path: join(SHOTS, `v33-card-${name}.png`) });
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
  let invite = '';
  await step('Runde mit Anna', async () => {
    await admin.goto(`${srv.base}/#neu`);
    await admin.waitForSelector('form.form');
    await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await admin.type('input[placeholder^="z. B. Familien"]', 'Zwei Geräte');
    await admin.$eval('form.form', (f) => f.requestSubmit());
    await waitText(admin, 'Zuerst: Admin-Link sichern');
    await clickText(admin, 'Erledigt, ich habe den Link gesichert');
    await admin.waitForSelector('.add-person input');
    await admin.type('.add-person input', 'Anna');
    await admin.$eval('.add-person', (f) => f.requestSubmit());
    await admin.waitForFunction(() => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === 'Anna'), { polling: 100 });
    invite = await admin.evaluate(() => [...document.querySelectorAll('.person a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href'));
  });

  const laptop = await newPage();
  const phone = await newPage();
  let link = '';
  await step('Laptop: QR-Code „Auf weiterem Gerät öffnen“ erst auf Knopfdruck, mit dem persönlichen Link', async () => {
    await accept(laptop, `${srv.base}/${invite}`, 'Anna');
    link = laptop.url();
    await laptop.evaluate(() => { [...document.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent === 'Mein Zugang und Wiederherstellung').open = true; });
    if (await laptop.$('.second-device-qr svg')) problems.push('QR-Code ohne Aufklappen sichtbar');
    await waitText(laptop, 'Nur für den Notfall:');
    await clickText(laptop, 'Auf weiterem Gerät öffnen');
    await laptop.waitForSelector('.second-device-qr svg.qr');
    const label = await laptop.$eval('.second-device-qr svg.qr', (s) => s.getAttribute('aria-label'));
    if (label !== 'QR-Code mit deinem persönlichen Link') problems.push(`QR-Beschriftung: ${label}`);
    // Inhalt des QR-Codes: derselbe Link wie die geöffnete Seite (QR mit gleicher Bibliothek nachgebaut und verglichen)
    const same = await laptop.evaluate(async (l) => {
      const { qrSvg } = await import('/js/views/common.js');
      return qrSvg(l).querySelector('path').getAttribute('d') === document.querySelector('.second-device-qr svg.qr path').getAttribute('d');
    }, link);
    if (!same) problems.push('QR-Code enthält nicht den persönlichen Link');
    await shotCard(laptop, 'Auf weiterem Gerät öffnen', 'zweites-geraet');
    await axe(laptop, 'Zweites Gerät');
  });

  await step('Handy öffnet den Link: beide Geräte speichern, Laptop legt fest', async () => {
    await phone.goto(link);
    await waitText(phone, 'Speichern & festlegen');
    await phone.evaluate(() => { const ta = document.querySelector('.wish-item textarea'); ta.value = 'Ein gutes Buch'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickText(phone, 'Wünsche speichern');
    await waitText(phone, 'Wünsche gespeichert.');
    await laptop.reload();
    await waitText(laptop, 'Speichern & festlegen');
    await clickText(laptop, 'Speichern & festlegen');
    await waitText(laptop, 'Wünsche gespeichert und festgelegt.');
    await phone.reload();
    await waitText(phone, 'Kleine Korrekturen sind noch bis');
  });

  await step('Wiederherstellungscode auf drittem Gerät: Laptop erklärt beim nächsten Speichern, statt „Nicht gefunden“', async () => {
    const code = await laptop.evaluate(() => document.querySelector('.recovery-code').textContent);
    const tablet = await newPage();
    await tablet.goto(`${srv.base}/#wiederherstellen/${code.replace(/-/g, '')}`);
    await clickText(tablet, 'Wiederherstellen');
    await waitText(tablet, 'Kleine Korrekturen sind noch bis');
    await laptop.bringToFront();
    await clickText(laptop, 'Wünsche speichern');
    await waitText(laptop, 'Diese Seite war nicht mehr aktuell. Sie wird neu geladen.');
    await waitText(laptop, 'Dieser Link ist nicht mehr gültig.');
    await waitText(laptop, 'hol dir von dort mit „Auf weiterem Gerät öffnen“');
    if (await laptop.evaluate(() => document.body.textContent.includes('Nicht gefunden oder Link ungültig'))) problems.push('Laptop zeigt weiter „Nicht gefunden oder Link ungültig“');
    await axe(laptop, 'Zugang ungültig');
    // Das Handy (gleicher alter Zugang) merkt es beim Neuladen ebenso
    await phone.reload();
    await waitText(phone, 'Dieser Link ist nicht mehr gültig.');
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
