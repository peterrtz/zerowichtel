// Durchlauf in einem echten Chromium (Headless) mit Bildschirmfotos.
// Prüft WebCrypto/X25519 im Browser, CSP-Verträglichkeit und das Layout.
//
//   CHROME_PATH=/pfad/zu/chrome SHOTS=/ordner node tests/browser/walkthrough.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
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

const srv = await startServer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--lang=de-DE', '--font-render-hinting=none', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split('|') : [])] });
const problems = [];
let n = 0;

async function newPage({ width = 390, height = 844, dark = false } = {}) {
  const page = await browser.newPage().then(deutsch);
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`Konsole: ${m.text()}`); });
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

async function captureIcs(page) {
  // Download abfangen: den erzeugten Blob direkt lesen (fetch auf blob: verbietet die CSP – zu Recht)
  return page.evaluate(async () => {
    const origUrl = URL.createObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    let blob = null;
    URL.createObjectURL = (b) => { blob = b; return origUrl.call(URL, b); };
    const got = new Promise((resolve) => {
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && blob) { blob.text().then((t) => resolve({ name: this.download, type: blob.type, text: t })); return; }
        return origClick.call(this);
      };
    });
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'In den Kalender (.ics)').click();
    const res = await got;
    URL.createObjectURL = origUrl;
    HTMLAnchorElement.prototype.click = origClick;
    return res;
  });
}

try {
  const code = srv.organizerCode();
  const page = await newPage();

  await page.goto(`${srv.base}/`, { waitUntil: 'networkidle0' });
  await waitText(page, 'Wichteln ohne Konto');
  await shot(page, 'start');

  // „verschlüsselt“ öffnet die Erklärung als Dialog; Esc schließt, Fokus zurück aufs Schloss; auch über den Fußbereich
  await page.click('#crypto-info');
  await page.waitForFunction(() => document.querySelector('dialog.modal')?.open, { polling: 100 });
  const dlg = await page.$eval('dialog.modal', (d) => ({ text: d.textContent, label: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent }));
  if (dlg.label !== 'Wie ZeroWichtel verschlüsselt' || !dlg.text.includes('Fragment') || !dlg.text.includes('Was der Server trotzdem weiß')) problems.push('Verschlüsselungs-Dialog: Inhalt');
  await shot(page, 'verschluesselung');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.modal').open && document.activeElement?.id === 'crypto-info', { polling: 100 });
  await page.click('#crypto-info-footer');
  await page.waitForFunction(() => document.querySelector('dialog.modal').open, { polling: 100 });
  await page.click('.dialog-close');
  await page.waitForFunction(() => !document.querySelector('dialog.modal').open, { polling: 100 });

  // Hintergrundmusik: aus beim Laden, Notensymbol schaltet ein und aus; Quelle unter #lizenzen
  const pressed = () => page.$eval('#music-toggle', (b) => b.getAttribute('aria-pressed'));
  if (await pressed() !== 'false') problems.push('Musik beim Laden nicht aus');
  await page.click('#music-toggle');
  // aria-pressed wird erst „true“, wenn die Wiedergabe wirklich läuft (play() erfolgreich)
  await page.waitForFunction(() => document.getElementById('music-toggle').getAttribute('aria-pressed') === 'true', { polling: 100, timeout: 8000 });
  await page.click('#music-toggle');
  if (await pressed() !== 'false') problems.push('Musik lässt sich nicht ausschalten');
  await page.goto(`${srv.base}/#lizenzen`);
  await waitText(page, 'Christmas Background Music');
  if (!(await textOf(page)).includes('Pixabay-Inhaltslizenz') || !(await page.$('footer a[href="#lizenzen"]'))) problems.push('Lizenzseite/Fußzeile unvollständig');
  await page.goto(`${srv.base}/`);
  await waitText(page, 'Wichteln ohne Konto');

  await page.goto(`${srv.base}/#neu`);
  await page.waitForSelector('form.form');
  await page.type('input[placeholder^="ZW-"]', code);
  await page.type('input[placeholder^="z. B. Familien"]', 'Weihnachten bei Müllers');
  await page.type('textarea', 'Ihr Lieben, dieses Jahr wichteln wir **wieder**!\n- Limit beachten\n- Bitte *nichts* Selbstgebackenes');
  await shot(page, 'anlegen');
  await page.$eval('form.form', (f) => f.requestSubmit());
  await waitText(page, 'Zuerst: Admin-Link sichern');
  const adminUrl = page.url();
  for (const name of ['Anna', 'Ben', 'Carla', 'Opa Heinz']) {
    await page.type('.add-person input', name);
    await page.$eval('.add-person', (f) => f.requestSubmit());
    await page.waitForFunction((n2) => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === n2), { polling: 100 }, name);
  }
  await shot(page, 'verwaltung');
  if (!(await textOf(page)).includes('Wichtelst du selbst mit?')) problems.push('Hinweis „selbst eintragen“ fehlt');
  const icsAdmin = await captureIcs(page);
  if (icsAdmin.name !== 'zerowichtel-weihnachten-bei-mullers.ics' || !icsAdmin.text.includes('SUMMARY:Wichteln: Weihnachten bei Müllers')
    || (icsAdmin.text.match(/BEGIN:VEVENT/g) || []).length !== 3 || /#[pia]\//.test(icsAdmin.text)) problems.push(`ICS Verwaltung: ${icsAdmin.name}`);

  // Anna nimmt an
  const inviteHref = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.person')].find((x) => x.querySelector('.person-name').textContent === 'Anna');
    return [...li.querySelectorAll('a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href');
  });
  const p2 = await newPage();
  await p2.goto(`${srv.base}/${inviteHref}`);
  await waitText(p2, 'Hallo Anna!');
  await shot(p2, 'einladung');
  await clickText(p2, 'Einladung annehmen');
  await waitText(p2, 'Zuerst: Zugang sichern');
  await shot(p2, 'zugang-sichern');
  await clickText(p2, 'Ich bin dabei');
  await waitText(p2, 'Deine Antwort: dabei');
  await clickText(p2, 'Erledigt, ich habe Link und Code gesichert');
  await waitText(p2, 'Mein Zugang und Wiederherstellung');
  await shot(p2, 'teilnahme');
  const icsPerson = await captureIcs(p2);
  if (!/URL:https?:\/\/\S+#zu\/[A-Za-z0-9_-]{22}/.test(icsPerson.text.replace(/\r\n /g, '')) || /#[pia]\//.test(icsPerson.text)) problems.push('ICS Teilnahme: Link');

  await page.reload();
  await waitText(page, '1 dabei');
  // Auf diesem Gerät ist jetzt eine eigene Teilnahme gespeichert (Anna = „Selbst hier öffnen“) → Hinweis weg
  if ((await textOf(page)).includes('Wichtelst du selbst mit?')) problems.push('Hinweis „selbst eintragen“ trotz eigener Teilnahme');
  await page.evaluate(() => document.querySelector('.person .menu').setAttribute('open', ''));
  await shot(page, 'verwaltung-status');

  // Admin-Link sichern: auf dem Anlege-Gerät bleibt die Frage bis zur Bestätigung …
  if (!(await textOf(page)).includes('Zuerst: Admin-Link sichern')) problems.push('Anlege-Gerät: Frage fehlt vor der Bestätigung');
  // … auf einem anderen Gerät (eigener Browser-Kontext) gilt ein von außen geöffneter Admin-Link als gesichert
  const other = await (await browser.createBrowserContext()).newPage().then(deutsch);
  await other.goto(adminUrl);
  await waitText(other, '1 dabei');
  if ((await textOf(other)).includes('Zuerst: Admin-Link sichern')) problems.push('Anderes Gerät: Admin-Link-Frage erscheint trotz geöffnetem Link');
  if (!(await other.$('details.card summary'))) problems.push('Anderes Gerät: Admin-Link nicht mehr aufrufbar');
  await other.reload();
  await waitText(other, '1 dabei');
  if ((await textOf(other)).includes('Zuerst: Admin-Link sichern')) problems.push('Anderes Gerät: Frage nach erneutem Aufruf');
  // „Ich wichtle nicht selbst mit“ blendet den Hinweis auf diesem Gerät dauerhaft aus
  if (!(await textOf(other)).includes('Wichtelst du selbst mit?')) problems.push('Anderes Gerät: Hinweis „selbst eintragen“ fehlt');
  await clickText(other, 'Ich wichtle nicht selbst mit');
  await other.waitForFunction(() => !document.getElementById('app').textContent.includes('Wichtelst du selbst mit?'), { polling: 100 });
  await other.reload();
  await waitText(other, '1 dabei');
  if ((await textOf(other)).includes('Wichtelst du selbst mit?')) problems.push('Hinweis nach „nicht mit“ wieder da');
  await other.browserContext().close();
  // Bestätigen auf dem Anlege-Gerät: danach nicht mehr gefragt, Link bleibt zum Teilen erreichbar
  await clickText(page, 'Erledigt, ich habe den Link gesichert');
  await page.reload();
  await waitText(page, '1 dabei');
  if ((await textOf(page)).includes('Zuerst: Admin-Link sichern')) problems.push('Anlege-Gerät: Frage trotz Bestätigung');
  if (!(await page.$$eval('details.card summary', (s) => s.some((x) => x.textContent === 'Admin-Link')))) problems.push('Admin-Link-Bereich fehlt nach Bestätigung');

  const dark = await newPage({ dark: true });
  await dark.goto(adminUrl);
  await waitText(dark, '1 dabei');
  await shot(dark, 'verwaltung-dunkel');

  const desk = await newPage({ width: 1280, height: 900 });
  await desk.goto(`${srv.base}/`);
  await waitText(desk, 'Meine Runden');
  await shot(desk, 'start-desktop');

  const text = await textOf(page);
  if (!text.includes('Weihnachten bei Müllers')) problems.push('Titel fehlt in Verwaltung');
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Browser-Durchlauf ok (${n} Bildschirmfotos).`);
} catch (e) {
  console.log(`FAIL ${e.stack}\n${problems.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
