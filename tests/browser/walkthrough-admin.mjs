// Admin-Bereich (1.1) in einem echten Chromium: Anmeldung mit Passwort + TOTP, Fehlversuch,
// Code erzeugen und teilen, Code-Link öffnet „Neue Runde“ mit vorausgefülltem Code, Überblick,
// Widerrufen, Protokoll, Abmelden, Anmeldung mit Notfallcode.
//
//   CHROME_PATH=/pfad/zu/chrome SHOTS=/ordner node tests/browser/walkthrough-admin.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from '../helpers/server.mjs';

const CHROME = process.env.CHROME_PATH;
if (!CHROME) {
  console.log('CHROME_PATH nicht gesetzt – Browser-Durchlauf übersprungen.');
  process.exit(0);
}
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, t = Date.now() / 1000) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(t / 30)));
  const mac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = mac[19] & 15;
  return String((mac.readUInt32BE(off) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const srv = await startServer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--lang=de-DE', '--font-render-hinting=none', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split('|') : [])] });
const problems = [];
let n = 0;

async function newPage({ width = 390, height = 844, dark = false } = {}) {
  const page = await browser.newPage().then(deutsch);
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  // 401 beim absichtlichen Fehlversuch ist erwartet
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403)/.test(m.text())) problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.defaultValue()));
  return page;
}
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true });
}
const textOf = (page) => page.$eval('#app', (e) => e.textContent);
async function waitText(page, s, timeout = 8000) {
  await page.waitForFunction((t) => document.getElementById('app').textContent.includes(t), { timeout, polling: 100 }, s);
}
async function clickText(page, label) {
  const ok = await page.evaluate((l) => {
    const el = [...document.querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === l);
    if (el) el.click();
    return !!el;
  }, label);
  if (!ok) throw new Error(`Kein Element „${label}“`);
}
async function login(page, password, code) {
  await page.waitForSelector('input[type=password]');
  await page.$eval('input[type=password]', (e) => { e.value = ''; });
  await page.type('input[type=password]', password);
  await page.$eval('input[autocomplete=one-time-code]', (e) => { e.value = ''; });
  await page.type('input[autocomplete=one-time-code]', code);
  await page.$eval('form.form', (f) => f.requestSubmit());
}

try {
  const admin = srv.adminSetup();
  const url = `${srv.base}/#backend/${admin.slug}`;
  const page = await newPage();

  // Unvollständige Adresse
  await page.goto(`${srv.base}/#backend/kaputt`, { waitUntil: 'networkidle0' });
  await waitText(page, 'Diese Adresse ist unvollständig.');

  await page.goto(url);
  await waitText(page, 'Masterpasswort');
  await shot(page, 'anmeldung');

  // Fehlversuch
  await login(page, admin.password, '000000');
  await waitText(page, 'Anmeldung fehlgeschlagen.');

  // Richtig
  await login(page, admin.password, totp(admin.secret));
  await waitText(page, 'Neuer Code');
  if (!srv.external && !(await textOf(page)).includes('Noch keine Codes.')) problems.push('Leere Liste fehlt');
  const roundsCount = () => page.evaluate(() => {
    const dt = [...document.querySelectorAll('.facts dt')].find((e) => e.textContent === 'Runden');
    return Number.parseInt(dt?.nextElementSibling.textContent ?? 'NaN', 10);
  });
  const roundsBefore = await roundsCount();
  await shot(page, 'panel-leer');

  // Code erzeugen
  await page.type('input[placeholder^="z. B. Familie M."]', 'Familie Test');
  await page.$eval('input[type=number][max="20"]', (e) => { e.value = '2'; });
  await page.$eval('input[type=number][max="365"]', (e) => { e.value = '30'; });
  await page.$eval('.card form.form', (f) => f.requestSubmit());
  await waitText(page, 'Neuer Code – wird nur jetzt angezeigt.');
  await page.waitForFunction(() => document.querySelector('.people .person-name')?.textContent === 'Familie Test', { polling: 100 });
  const firstCode = () => page.$eval('.people li', (e) => e.textContent);
  const code = await page.$eval('.new-code .recovery-code', (e) => e.textContent.trim());
  if (!/^ZW-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code)) problems.push(`Codeformat: ${code}`);
  if (!(await page.$('.new-code svg.qr'))) problems.push('QR-Code fehlt');
  const listText = await firstCode();
  if (!listText.includes('0/2 Runden') || !listText.includes('aktiv')) problems.push(`Liste: ${listText}`);
  await shot(page, 'code-erzeugt');

  // Code-Link öffnet „Neue Runde“ mit vorausgefülltem Code; Code verschwindet aus der Adresse
  const p2 = await newPage();
  await p2.goto(`${srv.base}/#neu/${code}`);
  await p2.waitForSelector('input[placeholder^="ZW-"]');
  const prefilled = await p2.$eval('input[placeholder^="ZW-"]', (e) => e.value);
  if (prefilled !== code) problems.push(`Code nicht vorausgefüllt: ${prefilled}`);
  if (new URL(p2.url()).hash !== '#neu') problems.push(`Code noch in der Adresse: ${p2.url()}`);
  await p2.type('input[placeholder^="z. B. Familien"]', 'Testrunde aus Admin-Code');
  await p2.$eval('form.form', (f) => f.requestSubmit());
  await waitText(p2, 'Zuerst: Admin-Link sichern');

  // Überblick aktualisiert (gleiche Sitzung, Seitenwechsel innerhalb der App)
  await page.evaluate(() => { location.hash = '#'; });
  await waitText(page, 'Wichteln ohne Konto');
  await page.evaluate((h) => { location.hash = h; }, `#backend/${admin.slug}`);
  await waitText(page, '1/2 Runden');
  if ((await roundsCount()) !== roundsBefore + 1) problems.push(`Überblick zählt die Runde nicht (${roundsBefore} → ${await roundsCount()})`);
  if ((await textOf(page)).includes('Testrunde aus Admin-Code')) problems.push('Rundentitel im Admin-Bereich sichtbar!');

  // Widerrufen
  await page.evaluate(() => [...document.querySelectorAll('.people li')].find((li) => li.querySelector('.person-name').textContent === 'Familie Test').querySelector('button').click());
  await page.waitForFunction(() => document.querySelector('.people') && document.querySelector('details.card')
    && ![...document.querySelectorAll('.people .person-name')].some((e) => e.textContent === 'Familie Test'), { polling: 100 });
  await page.evaluate(() => document.querySelector('details.card').setAttribute('open', ''));
  const t = await textOf(page);
  for (const ev of ['Fehlgeschlagene Anmeldung', 'Anmeldung', 'Code erzeugt', 'Familie Test · 2 Runden · 30 Tage', 'Code widerrufen']) {
    if (!t.includes(ev)) problems.push(`Protokoll ohne „${ev}“`);
  }
  await shot(page, 'protokoll');

  // Widerrufener Code funktioniert nicht mehr
  const chk = await page.evaluate(async (c) => (await fetch('/api/organizer/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizerCode: c }) })).status, code);
  if (chk !== 403) problems.push(`Widerrufener Code: HTTP ${chk}`);

  // Abmelden
  await clickText(page, 'Abmelden');
  await waitText(page, 'Abgemeldet.');

  // Notfallcode (dunkles Design)
  const dark = await newPage({ dark: true });
  await dark.goto(url);
  await login(dark, admin.password, admin.recovery[0].toLowerCase());
  await waitText(dark, 'Neuer Code');
  if (!(await textOf(dark)).includes('9 von 10')) problems.push('Notfallcode nicht gezählt');
  await shot(dark, 'panel-dunkel');

  const desk = await newPage({ width: 1280, height: 900 });
  await desk.goto(url);
  await shot(desk, 'anmeldung-desktop');

  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Browser-Durchlauf Admin ok (${n} Bildschirmfotos).`);
} catch (e) {
  console.log(`FAIL ${e.stack}\n${problems.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
