// Browser-Durchlauf Meilenstein 4: E-Mail-Modus. Mails landen im Log-Mailer und werden ausgewertet.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-m4.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
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
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.message().startsWith('E-Mail-Adresse') ? 'neu@example.org' : d.defaultValue()));
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `m4-${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const waitText = (page, s, sel = '#app', timeout = 10000) => page.waitForFunction((t, q) => document.querySelector(q)?.textContent.includes(t), { timeout, polling: 100 }, s, sel);
async function clickText(page, label, within = 'body') {
  const ok = await page.evaluate((l, w) => {
    const el = [...document.querySelector(w).querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === l);
    if (el) el.click();
    return !!el;
  }, label, within);
  if (!ok) throw new Error(`Kein Element „${label}“`);
}
const waitMails = async (count) => {
  for (let i = 0; i < 50; i++) {
    if (srv.mails().length >= count) return srv.mails();
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Erwartet ${count} Mails, vorhanden ${srv.mails().length}`);
};

try {
  const admin = await newPage();
  await admin.goto(`${srv.base}/#neu`);
  await admin.waitForSelector('form.form');
  await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
  await admin.type('input[placeholder^="z. B. Familien"]', 'Wichteln mit Mail');
  await admin.waitForFunction(() => [...document.querySelectorAll('.card h2')].some((h) => h.textContent.startsWith('E-Mail')), { polling: 100 });
  await admin.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.textContent.startsWith('E-Mail'));
    card.querySelector('input[type="checkbox"]').click();
  });
  await admin.type('input[placeholder^="leer lassen"]', 'Familie Mail');
  await shot(admin, 'anlegen-email');
  await admin.$eval('form.form', (f) => f.requestSubmit());
  await waitText(admin, 'Zuerst: Admin-Link sichern');
  await shot(admin, 'nach-anlegen');

  // Admin-Link an sich selbst
  await admin.type('.admin-mail input', 'orga@example.org');
  await clickText(admin, 'An mich mailen');
  let mails = await waitMails(1);
  if (mails[0].to !== 'orga@example.org' || !mails[0].text.includes('#a/')) problems.push('Admin-Link-Mail fehlerhaft');
  if (mails[0].subject !== 'ZeroWichtel: Dein Admin-Link' || mails[0].text.includes('Familie Mail')) problems.push('Admin-Link-Mail darf den Mail-Titel nicht enthalten (SEC-002)');
  await clickText(admin, 'Erledigt, ich habe den Link gesichert');

  // Person mit Adresse anlegen und per Mail einladen
  await waitText(admin, 'Teilnehmende');
  await admin.type('form.add-person input[type="text"]', 'Paula');
  await admin.type('form.add-person input[type="email"]', 'paula@example.org');
  await admin.$eval('form.add-person', (f) => f.requestSubmit());
  await admin.waitForFunction(() => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === 'Paula'), { polling: 100 });
  await waitText(admin, '✉ E-Mail');
  await clickText(admin, 'Per E-Mail');
  mails = await waitMails(2);
  const inviteMail = mails[1];
  if (inviteMail.to !== 'paula@example.org') problems.push('Einladung an falsche Adresse');
  if (/Paula/.test(inviteMail.text)) problems.push('Name darf nicht in der Mail stehen');
  await shot(admin, 'verwaltung-email');

  // Person öffnet den Link aus der Mail
  const link = inviteMail.text.match(/https?:\/\/\S+#i\/\S+/)[0];
  const paula = await newPage();
  await paula.goto(link);
  await waitText(paula, 'Hallo Paula!');
  await clickText(paula, 'Einladung annehmen');
  await waitText(paula, 'Zuerst: Zugang sichern');
  await clickText(paula, 'An meine hinterlegte E-Mail-Adresse schicken');
  mails = await waitMails(3);
  if (!/#p\//.test(mails[2].text)) problems.push('Persönlicher Link fehlt in Mail');
  const ownLink = mails[2].text.match(/https?:\/\/\S+#p\/\S+/)[0];
  if (ownLink !== await paula.evaluate(() => location.href)) problems.push('Mail-Link entspricht nicht dem persönlichen Link');
  await clickText(paula, 'Erledigt, ich habe Link und Code gesichert');
  await waitText(paula, 'Bist du dabei?');
  await clickText(paula, 'Ich bin dabei');
  await waitText(paula, 'Deine Antwort: dabei');
  await paula.evaluate(() => { [...document.querySelectorAll('details.card')].find((d) => d.querySelector('summary')?.textContent === 'E-Mail').open = true; });
  await shot(paula, 'teilnahme-email');
  await paula.evaluate(() => [...document.querySelectorAll('.email-box input[type="checkbox"]')][0].click());
  await paula.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Keine E-Mails mehr'), { polling: 100 });

  // Verwaltung zeigt „ohne Erinnerungen“; Adresse ändern
  await admin.reload();
  await waitText(admin, '✉ ohne Erinnerungen');
  await admin.evaluate(() => document.querySelector('.person .menu').setAttribute('open', ''));
  await clickText(admin, 'E-Mail ändern');
  await waitText(admin, '✉ E-Mail');

  // Datenbank: keine Adresse im Klartext
  srv.sql('PRAGMA wal_checkpoint(TRUNCATE)');
  const raw = readFileSync(srv.dbPath).toString('latin1');
  for (const s of ['paula@', 'neu@example', 'orga@', 'Familie Mail']) if (raw.includes(s)) problems.push(`Klartext in DB: ${s}`);

  // E-Mail-Modus ausschalten löscht Adressen
  await admin.evaluate(() => { [...document.querySelectorAll('details.card')].find((d) => d.querySelector('summary')?.textContent === 'Runde bearbeiten').open = true; });
  await admin.evaluate(() => {
    const d = [...document.querySelectorAll('details.card')].find((x) => x.querySelector('summary')?.textContent === 'Runde bearbeiten');
    [...d.querySelectorAll('label.check input')].find((i) => i.parentElement.textContent.includes('per E-Mail')).click();
  });
  await clickText(admin, 'Änderungen speichern');
  await admin.waitForFunction(() => !document.body.textContent.includes('✉'), { polling: 100 });
  const left = JSON.parse(srv.sql('SELECT COUNT(*) AS c FROM participants WHERE email_ct IS NOT NULL'))[0].c;
  if (left !== 0) problems.push('Adressen nach Abschalten nicht gelöscht');

  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Browser-Durchlauf M4 ok (${n} Bildschirmfotos, ${srv.mails().length} Mails).`);
} catch (e) {
  console.log(`FAIL ${e.stack}\n${problems.join('\n')}\n${srv.log().split('\n').filter((l) => !/Accepted|Closing/.test(l)).slice(-10).join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
