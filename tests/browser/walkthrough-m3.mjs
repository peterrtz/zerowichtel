// Browser-Durchlauf Meilenstein 3: Schrottwichteln mit eigenen Regeln, Spielansicht, Timer, Würfel.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-m3.mjs
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
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--lang=de-DE', '--autoplay-policy=no-user-gesture-required', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split('|') : [])] });
const problems = [];
let n = 0;

async function newPage({ dark = false, width = 390, height = 844 } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage().then(deutsch);
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.defaultValue()));
  return page;
}
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `m3-${String(++n).padStart(2, '0')}-${name}.png`), fullPage: full }); };
const waitText = (page, s, sel = 'body', timeout = 10000) => page.waitForFunction((t, q) => document.querySelector(q)?.textContent.includes(t), { timeout, polling: 100 }, s, sel);
async function clickText(page, label, within = 'body') {
  const ok = await page.evaluate((l, w) => {
    const el = [...document.querySelector(w).querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === l);
    if (el) el.click();
    return !!el;
  }, label, within);
  if (!ok) throw new Error(`Kein Element „${label}“`);
}

try {
  // ---- Runde anlegen mit eigenen Regeln
  const admin = await newPage();
  await admin.goto(`${srv.base}/#neu`);
  await admin.waitForSelector('form.form');
  await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
  await admin.type('input[placeholder^="z. B. Familien"]', 'Schrott-Party im Keller');
  await admin.click('input[value="schrott"]');
  await admin.waitForSelector('.rules-editor', { visible: true });
  await admin.click('input[name="preset"][value="rasant"]');
  // Anpassen: zweite Phase auf 1 Minute, bei 2 aussetzen
  await admin.evaluate(() => { document.querySelector('.rules-custom').open = true; });
  await admin.waitForSelector('.phase-edit');
  const phase2 = (await admin.$$('.phase-edit'))[1];
  const mins = await phase2.$('input[type="number"]');
  await mins.click({ count: 3 });
  await mins.type('1');
  await mins.evaluate((e) => e.dispatchEvent(new Event('change')));
  const sel2 = await phase2.$('select[aria-label="Aktion bei 2"]');
  await sel2.select('skip');
  await shot(admin, 'regelbaukasten');
  await admin.$eval('form.form', (f) => f.requestSubmit());
  await waitText(admin, 'Zuerst: Admin-Link sichern', '#app');
  await waitText(admin, 'Spielregeln', '#app');
  const adminText = await admin.$eval('#app', (e) => e.textContent);
  if (!adminText.includes('Chaos') || !adminText.includes('1 Minute') || !adminText.includes('Aussetzen')) problems.push('Regeln in der Verwaltung unvollständig');
  await clickText(admin, 'Erledigt, ich habe den Link gesichert');
  for (const name of ['Lena', 'Tom', 'Ute']) {
    await waitText(admin, 'Teilnehmende', '#app');
    await admin.type('.add-person input', name);
    await admin.$eval('.add-person', (f) => f.requestSubmit());
    await admin.waitForFunction((x) => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === x), { polling: 100 }, name);
  }
  const invite = await admin.evaluate(() => [...document.querySelectorAll('.person a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href'));

  // ---- Einladung zeigt Regeln
  const lena = await newPage();
  await lena.goto(`${srv.base}/${invite}`);
  await waitText(lena, 'Spielregeln', '#app');
  await waitText(lena, 'Noch einmal würfeln', '#app');
  await shot(lena, 'einladung-regeln');
  await clickText(lena, 'Einladung annehmen');
  await waitText(lena, 'Zuerst: Zugang sichern', '#app');
  await clickText(lena, 'Erledigt, ich habe Link und Code gesichert');
  await waitText(lena, 'Bist du dabei?', '#app');
  await clickText(lena, 'Ich bin dabei');
  await waitText(lena, 'Deine Antwort: dabei', '#app');
  if (await lena.$('.wish-editor')) problems.push('Beim Schrottwichteln darf es keine Wunschliste geben');

  // ---- Spiel starten (Organisator:in)
  await admin.reload();
  await waitText(admin, 'Spiel starten', '#app');
  await clickText(admin, 'Spiel starten');
  await admin.waitForSelector('.game');
  await waitText(admin, 'Einsammeln', '.game');
  const startCount = await admin.$eval('.center-count', (e) => Number(e.textContent));
  if (startCount !== 1) problems.push(`Päckchenzähler sollte mit 1 Zusage starten, ist ${startCount}`);
  await clickText(admin, '+', '.game');
  await clickText(admin, '+', '.game');
  // würfeln bis eine 5 oder 6 kommt (Einsammeln), höchstens 40 Versuche
  let hit = false;
  for (let i = 0; i < 40 && !hit; i++) {
    await clickText(admin, 'Würfeln', '.game');
    await admin.waitForSelector('.roll-result');
    await new Promise((r) => setTimeout(r, 650));
    hit = await admin.$eval('.roll-result', (e) => e.classList.contains('roll-hit'));
  }
  if (!hit) problems.push('In 40 Würfen keine 5/6 – unwahrscheinlich');
  await shot(admin, 'spiel-einsammeln', false);
  await clickText(admin, 'Genommen (−1)', '.game');
  await waitText(admin, '2', '.center-count');
  await clickText(admin, '−', '.game');
  await clickText(admin, '−', '.game');
  await waitText(admin, 'Die Mitte ist leer.', '.game');
  await clickText(admin, 'Nächste Phase', '.game');
  await waitText(admin, 'Chaos', '.game');
  await waitText(admin, '01:00', '.timer');
  await clickText(admin, 'Zeit starten', '.game');
  await new Promise((r) => setTimeout(r, 1300));
  const t = await admin.$eval('.timer', (e) => e.textContent);
  if (!/^00:5[89]$/.test(t)) problems.push(`Timer läuft nicht wie erwartet: ${t}`);
  await shot(admin, 'spiel-timer', false);
  // Zeit vorspulen
  await admin.evaluate(() => { const o = Date.now.bind(Date); Date.now = () => o() + 70000; });
  await waitText(admin, 'Zeit ist um!', '.game');
  await shot(admin, 'spiel-zeit-um', false);
  await clickText(admin, 'Spiel beenden', '.game');
  await waitText(admin, 'Auspacken!', '.game');
  await shot(admin, 'spiel-ende', false);
  await clickText(admin, 'Schließen', '.game');
  if (await admin.$('.game')) problems.push('Spielansicht schließt nicht');

  // ---- Freies Würfeln ohne Runde, dunkles Design, zwei Würfel
  const free = await newPage({ dark: true });
  await free.goto(`${srv.base}/#wuerfel`);
  await free.waitForSelector('.rules-editor');
  await free.click('input[name="preset"][value="eigene"]');
  await free.waitForSelector('.rules-custom[open] select');
  await free.select('.rules-custom select', '2');
  await free.waitForSelector('select[aria-label="Aktion bei 12"]');
  await free.select('select[aria-label="Aktion bei 12"]', 'steal');
  await clickText(free, 'Spiel starten');
  await free.waitForSelector('.game .die');
  const dice = await free.$$eval('.dice-row .die', (d) => d.length);
  if (dice !== 2) problems.push(`Zwei Würfel erwartet, ${dice} gefunden`);
  await clickText(free, 'Würfeln', '.game');
  await free.waitForSelector('.roll-sum');
  await new Promise((r) => setTimeout(r, 700));
  const sum = await free.$eval('.roll-sum', (e) => Number(e.textContent));
  if (!(sum >= 2 && sum <= 12)) problems.push(`Augensumme ungültig: ${sum}`);
  await shot(free, 'frei-zwei-wuerfel-dunkel', false);

  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Browser-Durchlauf M3 ok (${n} Bildschirmfotos).`);
} catch (e) {
  console.log(`FAIL ${e.stack}\n${problems.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
