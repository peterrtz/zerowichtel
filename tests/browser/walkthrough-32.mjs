// Browser-Durchlauf 2.13.1: Sprungmenü rechts (Handy: Knopf mit Liste, Desktop: Leiste), Sprünge, Tastatur,
// Zahlen für neue Fotos im Adventsalbum (eigene zählen nicht, nach dem Ansehen weg, gemerkt im Browser).
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-32.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

try {
  const admin = await newPage();
  let invites = {};
  let roundId = '';
  const pages = {};

  await step('Runde mit Album; Anna und Benedikt sagen zu', async () => {
    await admin.goto(`${srv.base}/#neu`);
    await admin.waitForSelector('form.form');
    await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await admin.type('input[placeholder^="z. B. Familien"]', 'Menürunde');
    await admin.$eval('form.form', (f) => f.requestSubmit());
    await waitText(admin, 'Zuerst: Admin-Link sichern');
    await clickText(admin, 'Erledigt, ich habe den Link gesichert');
    for (const name of ['Anna', 'Benedikt']) {
      await waitText(admin, 'Teilnehmende');
      await admin.type('.add-person input', name);
      await admin.$eval('.add-person', (f) => f.requestSubmit());
      await admin.waitForFunction((x) => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === x), { polling: 100 }, name);
    }
    invites = await admin.evaluate(() => Object.fromEntries([...document.querySelectorAll('.person')].map((li) => [
      li.querySelector('.person-name').textContent,
      [...li.querySelectorAll('a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href'),
    ])));
    roundId = JSON.parse(srv.sql('SELECT id FROM rounds'))[0].id;
    srv.sql(`UPDATE rounds SET album_mode = 1 WHERE id = '${roundId}'`);
    for (const name of ['Anna', 'Benedikt']) {
      pages[name] = await newPage();
      await accept(pages[name], `${srv.base}/${invites[name]}`, name);
    }
  });

  const navKeys = (p) => p.$$eval('#section-nav .nav-item[data-key]', (b) => b.map((x) => x.dataset.key));
  const badge = (p) => p.evaluate(() => {
    const b = document.querySelector('#section-nav .nav-item[data-key="album"]');
    return { n: b?.querySelector('.nav-badge').textContent ?? null, label: b?.getAttribute('aria-label'), toggle: document.querySelector('#section-nav .nav-toggle .nav-badge').textContent };
  });

  await step('Handy: runder Knopf unten rechts, Liste mit Abschnitten, Sprung und Escape', async () => {
    const a = pages.Anna;
    await a.bringToFront();
    await a.reload();
    await a.waitForSelector('#section-nav');
    const keys = await navKeys(a);
    for (const k of ['start', 'zugang', 'album', 'mixtape', 'infos']) if (!keys.includes(k)) problems.push(`Abschnitt ${k} fehlt im Menü (${keys})`);
    if (await a.$eval('#section-nav .nav-list', (e) => getComputedStyle(e).display) !== 'none') problems.push('Liste auf dem Handy nicht eingeklappt');
    await a.click('#section-nav .nav-toggle');
    if (await a.$eval('#section-nav .nav-toggle', (e) => e.getAttribute('aria-expanded')) !== 'true') problems.push('aria-expanded nicht gesetzt');
    if (await a.evaluate(() => document.activeElement?.classList.contains('nav-item')) !== true) problems.push('Fokus nicht im Menü');
    if (SHOTS) await a.screenshot({ path: join(SHOTS, 'v32-menue-handy.png') });
    await axe(a, 'Sprungmenü (Handy, offen)');
    await a.keyboard.press('Escape');
    if (await a.$eval('#section-nav', (e) => e.classList.contains('open'))) problems.push('Escape schließt nicht');
    // Sprung zum Mixtape
    await a.click('#section-nav .nav-toggle');
    await a.click('#section-nav .nav-item[data-key="mixtape"]');
    await a.waitForFunction(() => { const r = document.getElementById('mixtape').getBoundingClientRect(); return r.top >= -2 && r.top < 200; }, { timeout: 5000 }).catch(() => problems.push('Sprung zum Mixtape nicht angekommen'));
    if (await a.evaluate(() => document.activeElement?.id) !== 'mixtape') problems.push('Fokus nicht am Ziel');
    if (await a.evaluate(() => location.hash.length) < 30) problems.push('Fragment verändert');
  });

  await step('Neue Fotos: Zahl am Album, „neu“ in der Timeline, nach dem Ansehen weg; eigene zählen nicht', async () => {
    const b = pages.Benedikt;
    await b.bringToFront();
    await b.reload();
    await waitText(b, 'Adventsalbum');
    for (const c of ['Plätzchen', 'Markt']) {
      await (await b.$('#album-file')).uploadFile(join(FIX, 'kerze.png'));
      await b.waitForFunction(() => /Hochladen/.test(document.querySelector('#adventsalbum .album-stage')?.textContent ?? ''), { timeout: 20000 });
      await b.type('#album-caption', c);
      await clickText(b, 'Hochladen', '#adventsalbum');
      await waitText(b, 'Foto geteilt.');
      await b.waitForFunction(() => !document.querySelector('#adventsalbum .album-preview'), { timeout: 10000 });
    }
    await b.waitForFunction(() => document.querySelectorAll('#adventsalbum .album-thumb').length === 2, { timeout: 10000 });
    const own = await badge(b);
    if (own.n !== '') problems.push(`Eigene Fotos als neu gezählt: ${JSON.stringify(own)}`);
    const a = pages.Anna;
    await a.bringToFront();
    await a.reload();
    await a.waitForSelector('#section-nav');
    await a.evaluate(() => window.scrollTo(0, 0));
    await a.waitForFunction(() => document.querySelector('#section-nav .nav-item[data-key="album"] .nav-badge')?.textContent === '2', { timeout: 10000 })
      .catch(async () => problems.push(`Zahl am Album: ${JSON.stringify(await badge(a))}`));
    const bd = await badge(a);
    if (bd.toggle !== '2' || !/2 neue Fotos/.test(bd.label)) problems.push(`Knopf/Beschriftung: ${JSON.stringify(bd)}`);
    if (await a.$$eval('#adventsalbum .album-new', (x) => x.length) !== 2) problems.push('„neu“ fehlt an den Fotos');
    if (SHOTS) await a.screenshot({ path: join(SHOTS, 'v32-zahl-handy.png') });
    // Album ansehen → nach 1,5 s gesehen
    await a.click('#section-nav .nav-toggle');
    await a.click('#section-nav .nav-item[data-key="album"]');
    await a.waitForFunction(() => document.querySelector('#section-nav .nav-item[data-key="album"] .nav-badge')?.textContent === '', { timeout: 6000 })
      .catch(async () => problems.push(`Zahl bleibt nach dem Ansehen: ${JSON.stringify(await badge(a))}`));
    await a.reload();
    await a.waitForSelector('#section-nav');
    await new Promise((r) => setTimeout(r, 800));
    if ((await badge(a)).n !== '') problems.push('Nach dem Neuladen wieder als neu gezählt');
    if (await a.$$eval('#adventsalbum .album-new', (x) => x.length) !== 0) problems.push('„neu“ nach dem Ansehen noch da');
  });

  await step('Desktop: Leiste rechts mit Beschriftung bei Fokus, aktueller Abschnitt markiert; Organisator:in ebenso', async () => {
    const a = pages.Anna;
    await a.setViewport({ width: 1366, height: 900 });
    await a.reload();
    await a.waitForSelector('#section-nav');
    const vis = await a.evaluate(() => ({
      toggle: getComputedStyle(document.querySelector('#section-nav .nav-toggle')).display,
      list: getComputedStyle(document.querySelector('#section-nav .nav-list')).display,
      right: Math.round(window.innerWidth - document.getElementById('section-nav').getBoundingClientRect().right),
    }));
    if (vis.toggle !== 'none' || vis.list !== 'flex' || vis.right > 30) problems.push(`Desktop-Leiste: ${JSON.stringify(vis)}`);
    await a.click('#section-nav .nav-item[data-key="infos"]');
    await a.waitForFunction(() => document.querySelector('#section-nav .nav-item[aria-current="true"]'), { timeout: 5000 }).catch(() => problems.push('kein aktueller Abschnitt markiert'));
    // per Tastatur auf „Adventsalbum“ (Tab vom Menüpunkt davor) – dann gilt :focus-visible
    await a.evaluate(() => { const b = document.querySelector('#section-nav .nav-item[data-key="album"]'); b.previousElementSibling.focus(); });
    await a.keyboard.press('Tab');
    await new Promise((r) => setTimeout(r, 300)); // Einblenden dauert 0,15 s
    const op = await a.$eval('#section-nav .nav-item[data-key="album"] .nav-label', (e) => getComputedStyle(e).opacity);
    if (op !== '1') problems.push(`Beschriftung bei Fokus unsichtbar (${op})`);
    if (SHOTS) await a.screenshot({ path: join(SHOTS, 'v32-menue-desktop.png') });
    await axe(a, 'Sprungmenü (Desktop)');
    await admin.bringToFront();
    await admin.setViewport({ width: 1366, height: 900 });
    await admin.reload();
    await admin.waitForSelector('#section-nav');
    const keys = await navKeys(admin);
    for (const k of ['zugang', 'checkliste', 'teilnehmende', 'ziehung', 'album', 'bearbeiten', 'loeschen']) if (!keys.includes(k)) problems.push(`Verwaltung: ${k} fehlt (${keys})`);
    // Organisator:in: Fotos sind neu, bis die Album-Karte sichtbar war
    await admin.waitForFunction(() => document.querySelector('#section-nav .nav-item[data-key="album"] .nav-badge')?.textContent === '2', { timeout: 10000 })
      .catch(() => problems.push('Verwaltung: keine Zahl am Album'));
    await axe(admin, 'Sprungmenü Verwaltung');
    // Startseite: kein Menü
    await admin.goto(`${srv.base}/#`);
    await waitText(admin, 'Wichteln ohne Konto.');
    if (await admin.$('#section-nav')) problems.push('Menü auf der Startseite');
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
