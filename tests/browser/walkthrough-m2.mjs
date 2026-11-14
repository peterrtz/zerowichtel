// Browser-Durchlauf Meilenstein 2: drei Personen in getrennten Browser-Kontexten,
// Untergruppe, Ziehung, Wünsche, anonyme Rückfrage.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-m2.mjs
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
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--lang=de-DE', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split('|') : [])] });
const problems = [];
let n = 0;

async function newPage(dark = false) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage().then(deutsch);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.defaultValue()));
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `m2-${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const waitText = (page, s, timeout = 10000) => page.waitForFunction((t) => document.getElementById('app').textContent.includes(t), { timeout, polling: 100 }, s);
/** Beim ersten Ansehen nach der Ziehung liegt die Zuordnung im Päckchen (2.3). */
async function unwrap(page) {
  await page.waitForSelector('.gift, .reveal-name', { timeout: 10000 });
  if (await page.$('.gift')) await page.click('.gift');
  await waitText(page, 'Du beschenkst');
}
async function clickText(page, label, within = 'body') {
  const ok = await page.evaluate((l, w) => {
    const el = [...document.querySelector(w).querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === l);
    if (el) el.click();
    return !!el;
  }, label, within);
  if (!ok) throw new Error(`Kein Element „${label}“`);
}

try {
  const admin = await newPage();
  await admin.goto(`${srv.base}/#neu`);
  await admin.waitForSelector('form.form');
  await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
  await admin.type('input[placeholder^="z. B. Familien"]', 'Büro-Wichteln');
  await admin.$eval('form.form', (f) => f.requestSubmit());
  await waitText(admin, 'Zuerst: Admin-Link sichern');
  await clickText(admin, 'Erledigt, ich habe den Link gesichert');
  const names = ['Jule', 'Malte', 'Sven', 'Ina', 'Kai'];
  for (const name of names) {
    await waitText(admin, 'Teilnehmende');
    await admin.type('.add-person input', name);
    await admin.$eval('.add-person', (f) => f.requestSubmit());
    await admin.waitForFunction((x) => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === x), { polling: 100 }, name);
  }
  const invites = await admin.evaluate(() => Object.fromEntries([...document.querySelectorAll('.person')].map((li) => [
    li.querySelector('.person-name').textContent,
    [...li.querySelectorAll('a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href'),
  ])));

  const pages = {};
  for (const name of names) {
    const p = await newPage(name === 'Malte');
    await p.goto(`${srv.base}/${invites[name]}`);
    await waitText(p, `Hallo ${name}!`);
    await clickText(p, 'Einladung annehmen');
    await waitText(p, 'Zuerst: Zugang sichern');
    await clickText(p, 'Erledigt, ich habe Link und Code gesichert');
    await waitText(p, 'Bist du dabei?');
    await clickText(p, name === 'Kai' ? 'Diesmal raus' : 'Ich bin dabei');
    await waitText(p, 'Deine Antwort:');
    pages[name] = p;
  }

  // Jule trägt vor der Ziehung Wünsche ein
  const jule = pages.Jule;
  await waitText(jule, 'Deine Wünsche');
  await jule.type('.wish-item textarea', 'Ein **gutes** Notizbuch, gern liniert');
  await jule.type('.wish-item input[type="url"]', 'https://example.org/notizbuch');
  await jule.type('textarea[placeholder^="z. B. bitte keine"]', 'Keine Tassen');
  await clickText(jule, 'Wünsche speichern');
  await jule.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('gespeichert'), { polling: 100 });
  await shot(jule, 'wuensche-vorher');

  // Admin: Untergruppe Jule+Malte, dann auslosen
  await admin.reload();
  await waitText(admin, 'Auslosen');
  await admin.evaluate(() => { document.querySelector('details.rules-card').open = true; });
  await clickText(admin, '+ Untergruppe');
  await admin.waitForSelector('.assign-list select');
  const sels = await admin.$$('.assign-list select');
  const labels = await Promise.all(sels.map((s) => s.evaluate((e) => e.getAttribute('aria-label'))));
  for (let i = 0; i < sels.length; i++) {
    if (/Jule|Malte/.test(labels[i])) {
      const val = await sels[i].evaluate((e) => e.options[1].value);
      await sels[i].select(val);
      await admin.waitForSelector('.assign-list select');
    }
  }
  await shot(admin, 'regeln');
  await clickText(admin, 'Regeln speichern');
  await admin.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Gespeichert'), { polling: 100 });
  await shot(admin, 'vor-ziehung');
  await clickText(admin, 'Jetzt auslosen');
  await waitText(admin, 'Die Ziehung ist am');
  await waitText(admin, 'Schon nachgesehen: 0 von 4');
  await shot(admin, 'nach-ziehung');

  // Alle öffnen ihre Seite; wer Jule beschenkt, sieht danach ihre Wünsche
  const reveal = {};
  for (const name of ['Jule', 'Malte', 'Sven', 'Ina']) {
    await pages[name].reload();
    await unwrap(pages[name]);
    reveal[name] = await pages[name].$eval('.reveal-name', (e) => e.textContent);
    if (name === 'Malte') {
      // Zwischenstand: Jule und Malte haben nachgesehen, Sven und Ina noch nicht
      await admin.reload();
      await waitText(admin, 'Schon nachgesehen: 2 von 4');
      const pending = await admin.$$eval('.seen-list .person', (lis) => lis.filter((li) => li.textContent.includes('noch nicht nachgesehen')).map((li) => li.querySelector('.person-name').textContent).sort());
      if (JSON.stringify(pending) !== JSON.stringify(['Ina', 'Sven'])) problems.push(`Ausstehend falsch: ${pending}`);
      const remindButtons = await admin.$$eval('.seen-list button', (bs) => bs.filter((b) => b.textContent === 'Erinnern').length);
      if (remindButtons !== 2) problems.push(`Erinnern-Knöpfe: ${remindButtons}`);
      await shot(admin, 'nachgesehen-zwischenstand');
    }
  }
  await admin.reload();
  await waitText(admin, 'Schon nachgesehen: 4 von 4');

  // Direktlink ohne Geheimnis (#zu/<pid>) führt in diesem Browser zu Jules Seite
  const julePid = await jule.evaluate(() => {
    const own = JSON.parse(localStorage.getItem('zw.links.v1')).find((e) => e.kind === 'p' && e.fragment === location.hash);
    return own?.pid;
  });
  // gleiches „Gerät“ wie Jule (eigener Browser-Kontext je Person)
  const jump = await jule.browserContext().newPage().then(deutsch);
  await jump.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await jump.goto(`${srv.base}/#zu/${julePid}`);
  await unwrap(jump);
  if (!new URL(jump.url()).hash.startsWith('#p/')) problems.push(`Direktlink: ${jump.url()}`);
  // anderes Gerät (Malte): Jules Direktlink führt nicht zu Jules Seite, sondern erklärt den Weg
  const other = await pages.Malte.browserContext().newPage().then(deutsch);
  await other.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await other.goto(`${srv.base}/#zu/${julePid}`);
  await waitText(other, 'Dein Zugang ist auf diesem Gerät nicht gespeichert');
  await shot(other, 'direktlink-fremdes-geraet');
  if (new Set(Object.values(reveal)).size !== 4) problems.push(`Zuordnung nicht eindeutig: ${JSON.stringify(reveal)}`);
  if (reveal.Jule === 'Malte' || reveal.Malte === 'Jule') problems.push('Untergruppe verletzt');
  if (Object.values(reveal).includes('Kai')) problems.push('Kai (raus) wurde gezogen');
  const julesWichtel = Object.keys(reveal).find((k) => reveal[k] === 'Jule');
  const w = pages[julesWichtel];
  await w.reload();
  await waitText(w, 'gutes');
  await waitText(w, 'Keine Tassen');
  await w.type('.msg-compose textarea', 'Welche Farbe magst du?');
  await clickText(w, 'Anonym fragen');
  await w.waitForFunction(() => document.querySelector('.thread .msg-mine'), { polling: 100 });
  await shot(w, 'wichtel-sicht');

  await jule.reload();
  await waitText(jule, 'Welche Farbe magst du?');
  const cards = await jule.$$('.card');
  const fragenCard = await jule.evaluateHandle(() => [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.textContent === 'Post von deinem Wichtel'));
  await fragenCard.evaluate((c) => { c.querySelector('textarea').value = 'Dunkelgrün!'; });
  await fragenCard.evaluate((c) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Antworten').click());
  await jule.waitForFunction(() => [...document.querySelectorAll('.msg p')].some((p) => p.textContent === 'Dunkelgrün!'), { polling: 100 });
  await shot(jule, 'beschenkte-sicht');
  void cards;

  await pages.Malte.reload();
  await unwrap(pages.Malte);
  await shot(pages.Malte, 'dunkel');

  await pages.Kai.reload();
  await waitText(pages.Kai, 'nicht dabei');

  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Browser-Durchlauf M2 ok (${n} Bildschirmfotos). Zuordnung: ${JSON.stringify(reveal)}`);
} catch (e) {
  console.log(`FAIL ${e.stack}\n${problems.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
