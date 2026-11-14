// Browser-Durchlauf 1.2: Nach der Ziehung sieht die Organisator:in, wer seine Seite noch nicht geöffnet hat,
// und erinnert per E-Mail. Die Mails (Hinweis nach der Ziehung, Erinnerung) enthalten nur den Direktlink
// ohne Geheimnis (#zu/<pid>); auf dem eigenen Gerät führt er zur eigenen Seite.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-remind.mjs
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

async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage().then(deutsch);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 429/.test(m.text())) problems.push(`Konsole: ${m.text()}`); }); // 429 = absichtlich zweite Erinnerung
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.defaultValue()));
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `r-${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
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
const mailsTo = (to) => srv.mails().filter((m) => m.to === to);
async function waitMail(to, pred) {
  for (let i = 0; i < 60; i++) {
    const m = mailsTo(to).find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Keine passende Mail an ${to}`);
}
const fragments = (text) => [...text.matchAll(/https?:\/\/\S+?(#\S+)/g)].map((m) => m[1]);

try {
  const admin = await newPage();
  await admin.goto(`${srv.base}/#neu`);
  await admin.waitForSelector('form.form');
  await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
  await admin.type('input[placeholder^="z. B. Familien"]', 'Erinnerungsprobe');
  await admin.waitForFunction(() => [...document.querySelectorAll('.card h2')].some((h) => h.textContent.startsWith('E-Mail')), { polling: 100 });
  await admin.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector('h2')?.textContent.startsWith('E-Mail'));
    c.querySelector('input[type="checkbox"]').click();
  });
  await admin.$eval('form.form', (f) => f.requestSubmit());
  await waitText(admin, 'Zuerst: Admin-Link sichern');
  await clickText(admin, 'Erledigt, ich habe den Link gesichert');

  const people = { Anna: 'anna@example.org', Ben: 'ben@example.org', Cleo: 'cleo@example.org' };
  for (const [name, mail] of Object.entries(people)) {
    await admin.waitForSelector('form.add-person input[type="email"]');
    await admin.type('form.add-person input[type="text"]', name);
    await admin.type('form.add-person input[type="email"]', mail);
    await admin.$eval('form.add-person', (f) => f.requestSubmit());
    await admin.waitForFunction((x) => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === x), { polling: 100 }, name);
  }
  const invites = await admin.evaluate(() => Object.fromEntries([...document.querySelectorAll('.person')].map((li) => [
    li.querySelector('.person-name').textContent,
    [...li.querySelectorAll('a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href'),
  ])));
  const pages = {};
  for (const name of Object.keys(people)) {
    const p = await newPage();
    await p.goto(`${srv.base}/${invites[name]}`);
    await waitText(p, `Hallo ${name}!`);
    await clickText(p, 'Einladung annehmen');
    await waitText(p, 'Zuerst: Zugang sichern');
    await waitText(p, 'Bist du dabei?');
    await clickText(p, 'Ich bin dabei');
    await waitText(p, 'Deine Antwort: dabei');
    await clickText(p, 'Erledigt, ich habe Link und Code gesichert');
    pages[name] = p;
  }

  await admin.reload();
  await waitText(admin, 'Auslosen');
  await clickText(admin, 'Jetzt auslosen');
  await waitText(admin, 'Schon nachgesehen: 0 von 3');

  // Hinweis nach der Ziehung (Cron bzw. Lazy-Lauf): je Person der eigene Direktlink, nie ein Schlüssel-Link
  srv.sql("UPDATE meta SET value = '0' WHERE key = 'last_cleanup'");
  await fetch(`${srv.base}/api/info`);
  const pids = {};
  for (const [name, mail] of Object.entries(people)) {
    const m = await waitMail(mail, (x) => x.subject.includes('Es wurde ausgelost'));
    const frs = fragments(m.text);
    if (frs.length !== 1 || !/^#zu\/[A-Za-z0-9_-]{22}$/.test(frs[0])) problems.push(`Hinweis an ${name}: Links ${JSON.stringify(frs)}`);
    pids[name] = frs[0].slice(4);
  }
  if (new Set(Object.values(pids)).size !== 3) problems.push('Direktlinks nicht je Person verschieden');

  // Anna öffnet ihre Seite über den Direktlink aus der Mail – auf ihrem Gerät
  const annaJump = await pages.Anna.browserContext().newPage().then(deutsch);
  await annaJump.goto(`${srv.base}/#zu/${pids.Anna}`);
  await unwrap(annaJump);

  await admin.reload();
  await waitText(admin, 'Schon nachgesehen: 1 von 3');
  await shot(admin, 'vor-erinnerung');

  // Ben per E-Mail erinnern
  await admin.evaluate(() => {
    const li = [...document.querySelectorAll('.seen-list .person')].find((x) => x.querySelector('.person-name').textContent === 'Ben');
    [...li.querySelectorAll('button')].find((b) => b.textContent === 'Per E-Mail').click();
  });
  const rem = await waitMail(people.Ben, (x) => x.subject.includes('Erinnerung: Es wurde ausgelost'));
  if (!rem.text.includes(`#zu/${pids.Ben}`) || /#[pia]\//.test(rem.text)) problems.push('Erinnerung: falscher Link');
  if (/Ben/.test(rem.text)) problems.push('Name in der Erinnerung');
  await waitText(admin, 'erinnert');
  // Am selben Tag kein zweiter E-Mail-Knopf (Server würde ohnehin mit 429 ablehnen)
  await admin.waitForFunction(() => {
    const li = [...document.querySelectorAll('.seen-list .person')].find((x) => x.querySelector('.person-name').textContent === 'Ben');
    return li && ![...li.querySelectorAll('button')].some((b) => b.textContent === 'Per E-Mail');
  }, { polling: 100 });
  const benMails = mailsTo(people.Ben).filter((x) => x.subject.includes('Erinnerung')).length;
  if (benMails !== 1) problems.push(`Ben hat ${benMails} Erinnerungen`);
  await shot(admin, 'nach-erinnerung');

  // Anna ist bereits „nachgesehen“ – kein Erinnern-Knopf
  const annaButtons = await admin.evaluate(() => [...document.querySelectorAll('.seen-list .person')].find((x) => x.querySelector('.person-name').textContent === 'Anna').querySelectorAll('button').length);
  if (annaButtons !== 0) problems.push('Anna hat Erinnern-Knöpfe, obwohl sie nachgesehen hat');

  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Browser-Durchlauf Erinnerung ok (${n} Bildschirmfotos, ${srv.mails().length} Mails).`);
} catch (e) {
  console.log(`FAIL ${e.stack}\n${problems.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
