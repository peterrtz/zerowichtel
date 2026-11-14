// Browser-Durchlauf 2.4: Anlegen ohne Code (Admin-Schalter, Obergrenze) und Wiederherstellungscode als Bild
// (speichern, als eigenes PNG hochladen, als Bildschirmfoto mit QR-Code hochladen).
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-24.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { startServer } from '../helpers/server.mjs';

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.log('CHROME_PATH nicht gesetzt – übersprungen.'); process.exit(0); }
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
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split('|') : [])] });
const dl = mkdtempSync(join(tmpdir(), 'zw-dl-'));
const problems = [];
let n = 0;
let steps = 0;

async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await deutsch(await ctx.newPage());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  // 403 = absichtlich volle Plätze bzw. Fehlversuch
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403)/.test(m.text())) problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.defaultValue()));
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `v24-${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const waitText = (page, s, timeout = 10000) => page.waitForFunction((x) => document.body.textContent.includes(x), { timeout, polling: 100 }, s);
async function clickText(page, label) {
  const ok = await page.evaluate((l) => {
    const el = [...document.querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === l);
    if (el) el.click();
    return !!el;
  }, label);
  if (!ok) throw new Error(`Kein Element „${label}“`);
}
async function step(name, fn) {
  steps++;
  await fn();
  console.log(`ok   ${name}`);
}
async function createWithoutCode(page, title) {
  await page.goto(`${srv.base}/#neu`);
  await page.waitForSelector('form.form');
  await waitText(page, 'Organisator-Code (optional)');
  await page.type('input[placeholder^="z. B. Familien"]', title);
  await page.$eval('form.form', (f) => f.requestSubmit());
}

try {
  const creds = srv.adminSetup();
  const admin = await newPage();
  let roundAdmin;
  let person;
  let pngPath = '';
  let expectedCode = '';

  await step('Admin: Anlegen ohne Code einschalten, höchstens 1 Runde, ohne E-Mail', async () => {
    await admin.goto(`${srv.base}/#backend/${creds.slug}`);
    await admin.waitForSelector('input[type=password]');
    await admin.type('input[type=password]', creds.password);
    await admin.type('input[autocomplete=one-time-code]', totp(creds.secret));
    await admin.$eval('form.form', (f) => f.requestSubmit());
    await waitText(admin, 'Anlegen ohne Code erlauben');
    await waitText(admin, 'aus');
    await admin.evaluate(() => {
      const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.textContent === 'Anlegen ohne Code');
      const [on, mail] = card.querySelectorAll('input[type=checkbox]');
      on.checked = true;
      mail.checked = false;
      card.querySelector('input[type=number]').value = '1';
    });
    await clickText(admin, 'Speichern');
    await waitText(admin, 'Anlegen ohne Code eingeschaltet.');
    await waitText(admin, 'belegt: 0 von 1');
    if (await admin.$$eval('.card', (cs) => cs.some((c) => [...c.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim() === 'null')))) problems.push('„null“ als Text in einer Karte');
    await shot(admin, 'admin-ohne-code');
  });

  await step('Runde ohne Code anlegen; E-Mail-Versand nur mit Code', async () => {
    roundAdmin = await newPage();
    await roundAdmin.goto(`${srv.base}/#neu`);
    await roundAdmin.waitForSelector('form.form');
    await waitText(roundAdmin, 'Organisator-Code (optional)');
    await waitText(roundAdmin, 'E-Mail-Versand gibt es nur mit Organisator-Code.');
    await shot(roundAdmin, 'anlegen-optional');
    await createWithoutCode(roundAdmin, 'Offene Runde');
    await waitText(roundAdmin, 'Zuerst: Admin-Link sichern');
    await clickText(roundAdmin, 'Erledigt, ich habe den Link gesichert');
  });

  await step('Zweite Runde ohne Code: alle Plätze belegt; mit Code klappt es', async () => {
    const p = await newPage();
    await p.goto(`${srv.base}/#neu`);
    await p.waitForSelector('form.form');
    await waitText(p, 'Ohne Code sind gerade alle Plätze belegt.');
    await p.type('input[placeholder^="z. B. Familien"]', 'Zu viel');
    await shot(p, 'plaetze-belegt');
    await p.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await p.$eval('form.form', (f) => f.requestSubmit());
    await waitText(p, 'Zuerst: Admin-Link sichern');
    // Admin-Sitzung lebt nur im Speicher: per Hash neu laden statt reload()
    await admin.evaluate(() => { location.hash = '#datenschutz'; });
    await admin.evaluate((slug) => { location.hash = `#backend/${slug}`; }, creds.slug);
    await waitText(admin, 'belegt: 1 von 1');
    await waitText(admin, 'Runden ohne Code');
  });

  await step('Teilnehmerin trägt sich ein und speichert den Code als Bild', async () => {
    await clickText(roundAdmin, 'Gruppenlink (optional)');
    const id = await roundAdmin.evaluate(() => [...document.querySelectorAll('.group-link label')].find((x) => x.textContent.replace(' *', '').trim() === 'Höchstens so viele Personen')?.htmlFor);
    await roundAdmin.$eval(`#${id}`, (el) => { el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickText(roundAdmin, 'Gruppenlink erstellen');
    await waitText(roundAdmin, '0 von 3 eingetragen');
    const groupLink = await roundAdmin.$eval('.group-share a[href^="sms:"]', (a) => decodeURIComponent(a.getAttribute('href').split('body=')[1]).match(/https?:\/\/\S+/)[0]);
    person = await newPage();
    await person.goto(groupLink);
    await waitText(person, 'Du bist eingeladen, dich selbst einzutragen.');
    const nameId = await person.evaluate(() => [...document.querySelectorAll('label')].find((x) => x.textContent.replace(' *', '').trim() === 'Dein Name')?.htmlFor);
    await person.type(`#${nameId}`, 'Ada');
    await clickText(person, 'Mich eintragen');
    await waitText(person, 'Du bist eingetragen und dabei.');
    expectedCode = await person.$eval('.recovery .recovery-code', (e) => e.textContent.replace(/[\s-]/g, '').toUpperCase());
    const cdp = await person.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, browserContextId: person.browserContext().id });
    await clickText(person, 'Als Bild speichern');
    await waitText(person, 'Bild erstellt.');
    for (let i = 0; i < 50 && !readdirSync(dl).some((f) => f.endsWith('.png')); i++) await new Promise((r) => setTimeout(r, 100));
    const name = readdirSync(dl).find((f) => /^zerowichtel-wiederherstellung-[A-Za-z0-9_-]{6}\.png$/.test(f));
    if (!name) throw new Error(`Kein Bild heruntergeladen: ${readdirSync(dl).join(', ')}`);
    pngPath = join(dl, name);
    if (SHOTS) writeFileSync(join(SHOTS, `v24-${String(++n).padStart(2, '0')}-wiederherstellungsbild.png`), readFileSync(pngPath));
    if (!readFileSync(pngPath).includes(Buffer.from(`zw-recovery\0${expectedCode}`))) problems.push('PNG-Textfeld fehlt oder falsch');
  });

  await step('Bildschirmfoto des Bildes (ohne Textfeld): QR-Code wird erkannt', async () => {
    const p = await newPage();
    await p.setContent(`<body style="margin:0;background:#ddd"><img src="data:image/png;base64,${readFileSync(pngPath).toString('base64')}" style="width:390px;margin:40px 0 0 0"></body>`);
    await p.waitForFunction(() => document.querySelector('img').complete);
    const shotPath = join(dl, 'bildschirmfoto.png');
    await p.screenshot({ path: shotPath, fullPage: true });
    if (readFileSync(shotPath).includes(Buffer.from('zw-recovery'))) throw new Error('Bildschirmfoto enthält das Textfeld');
    await p.goto(`${srv.base}/#wiederherstellen`);
    await p.waitForSelector('#recover-image');
    const input = await p.$('#recover-image');
    await input.uploadFile(shotPath);
    await waitText(p, 'Code aus dem Bild übernommen.', 20000);
    const got = await p.$eval('input.mono', (e) => e.value.replace(/-/g, ''));
    if (got !== expectedCode) problems.push(`QR aus Bildschirmfoto: ${got} statt ${expectedCode}`);
  });

  await step('SEC-010: JPEG- und WebP-Bildschirmfoto werden gelesen, riesige Bilder abgelehnt ohne zu dekodieren', async () => {
    const p = await newPage();
    await p.setContent(`<body style="margin:0;background:#fff"><img src="data:image/png;base64,${readFileSync(pngPath).toString('base64')}" style="width:390px"></body>`);
    await p.waitForFunction(() => document.querySelector('img').complete);
    const files = {};
    for (const type of ['jpeg', 'webp']) {
      files[type] = join(dl, `foto.${type === 'jpeg' ? 'jpg' : 'webp'}`);
      await p.screenshot({ path: files[type], type, quality: 80, fullPage: true });
    }
    // „Bombe“: PNG-Kopf mit 30000 × 30000 Bildpunkten (900 MP), danach Datenmüll. Aus dem Bildschirmfoto (ohne
    // Textfeld) – beim eigenen PNG würde der Code schon aus dem Textfeld gelesen, ganz ohne Dekodieren.
    const bomb = Buffer.from(readFileSync(join(dl, 'bildschirmfoto.png')));
    bomb.writeUInt32BE(30000, 16);
    bomb.writeUInt32BE(30000, 20);
    files.bomb = join(dl, 'bombe.png');
    writeFileSync(files.bomb, bomb.subarray(0, 4000));
    await p.goto(`${srv.base}/#wiederherstellen`);
    await p.waitForSelector('#recover-image');
    for (const type of ['jpeg', 'webp']) {
      await (await p.$('#recover-image')).uploadFile(files[type]);
      await waitText(p, 'Code aus dem Bild übernommen.', 20000);
      const got = await p.$eval('input.mono', (e) => e.value.replace(/-/g, ''));
      if (got !== expectedCode) problems.push(`${type}: ${got} statt ${expectedCode}`);
      await p.$eval('input.mono', (e) => { e.value = ''; });
      await p.evaluate(() => { document.querySelector('.recover-image .hint[aria-live]').textContent = ''; });
    }
    await (await p.$('#recover-image')).uploadFile(files.bomb);
    await waitText(p, 'Das Foto ist zu groß zum Einlesen (30000 × 30000 Bildpunkte).');
    if (process.env.ZW_BIG_JPEG && existsSync(process.env.ZW_BIG_JPEG)) {
      await p.evaluate(() => { document.querySelector('.recover-image .hint[aria-live]').textContent = ''; });
      await (await p.$('#recover-image')).uploadFile(process.env.ZW_BIG_JPEG);
      await waitText(p, 'Das Foto ist zu groß zum Einlesen (16320 × 12240 Bildpunkte).');
    }
    await shot(p, 'zu-gross');
  });

  await step('Fremdes Bild ohne QR-Code: verständlicher Hinweis', async () => {
    const p = await newPage();
    await p.setContent('<body style="margin:0;background:#c33"><h1 style="color:#fff">Kein QR</h1></body>');
    const leer = join(dl, 'leer.png');
    await p.screenshot({ path: leer });
    await p.goto(`${srv.base}/#wiederherstellen`);
    await p.waitForSelector('#recover-image');
    await (await p.$('#recover-image')).uploadFile(leer);
    await waitText(p, 'Im Bild wurde kein Wiederherstellungscode gefunden.', 20000);
  });

  await step('Eigenes PNG hochladen stellt den Zugang auf einem neuen Gerät wieder her', async () => {
    const p = await newPage();
    await p.goto(`${srv.base}/#wiederherstellen`);
    await p.waitForSelector('#recover-image');
    await (await p.$('#recover-image')).uploadFile(pngPath);
    await waitText(p, 'Code aus dem Bild übernommen.');
    await shot(p, 'code-aus-bild');
    await clickText(p, 'Wiederherstellen');
    await waitText(p, 'Offene Runde');
    await waitText(p, 'Ada');
    await shot(p, 'wiederhergestellt');
  });
} catch (e) {
  problems.push(`Abbruch: ${e.stack || e.message}`);
} finally {
  await browser.close();
  srv.stop();
  rmSync(dl, { recursive: true, force: true });
}

if (problems.length) {
  console.log(`\n${problems.length} Problem(e):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`\n${steps} Schritte ohne Probleme.`);
