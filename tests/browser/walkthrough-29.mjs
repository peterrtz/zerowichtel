// Browser-Durchlauf 2.11: Wichtel-Mixtape – Lieder eintragen, gemischte Trackliste ohne Namen für alle gleich,
// Dubletten zusammengefasst, Such-Links (nur https, ohne Referrer, nichts vorab geladen), kein Klartext in der
// Datenbank, Organisator:in sieht nichts, ab der Bescherung aufdecken und wieder verbergen.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-29.mjs
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
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => { if (process.env.DEBUG) console.log('Dialog:', d.message().slice(0, 120)); d.accept(d.defaultValue()); });
  return page;
}
async function shotCard(page, text, name) {
  if (!SHOTS) return;
  const handle = await page.evaluateHandle((x) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(x)), text);
  const el = handle.asElement();
  if (el) await el.screenshot({ path: join(SHOTS, `v29-card-${name}.png`) });
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
  const names = ['Anna', 'Benedikt', 'Cleo'];
  let invites = {};
  let roundId = '';

  await step('Runde anlegen, drei Personen einladen', async () => {
    await admin.goto(`${srv.base}/#neu`);
    await admin.waitForSelector('form.form');
    await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await admin.type('input[placeholder^="z. B. Familien"]', 'Familienfest');
    await admin.$eval('form.form', (f) => f.requestSubmit());
    await waitText(admin, 'Zuerst: Admin-Link sichern');
    await clickText(admin, 'Erledigt, ich habe den Link gesichert');
    for (const name of names) {
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
  });

  const pages = {};
  const fill = async (page, songs) => {
    await page.evaluate((list) => {
      const rows = [...document.querySelectorAll('#mixtape .mix-row')];
      rows.forEach((row, i) => {
        const [ti, ar] = row.querySelectorAll('input');
        ti.value = list[i]?.[0] ?? '';
        ar.value = list[i]?.[1] ?? '';
      });
    }, songs);
    await clickText(page, 'Lieder speichern', '#mixtape');
  };
  const tracks = (page) => page.$$eval('#mixtape .mix-track', (li) => li.map((x) => ({
    no: x.querySelector('.mix-no').textContent, title: x.querySelector('.mix-title').textContent, text: x.querySelector('.mix-main').textContent,
    links: [...x.querySelectorAll('.mix-links a')].map((a) => ({ name: a.textContent, href: a.getAttribute('href'), rel: a.getAttribute('rel'), target: a.getAttribute('target'), ref: a.getAttribute('referrerpolicy') })),
  })));

  await step('Alle sagen zu; Mixtape-Karte ist leer und lädt eigene Lieder ein', async () => {
    for (const name of names) {
      pages[name] = await newPage();
      await accept(pages[name], `${srv.base}/${invites[name]}`, name);
    }
    const a = pages.Anna;
    await a.reload();
    await waitText(a, 'Wichtel-Mixtape');
    await waitText(a, 'Noch keine Lieder.');
    if ((await a.$$('#mixtape .mix-row')).length !== 3) problems.push('nicht drei Eingabezeilen');
  });

  await step('Anna trägt zwei Lieder ein, Benedikt eins (davon eins gleich), Cleo sieht drei Lieder ohne Namen', async () => {
    const a = pages.Anna;
    await fill(a, [['Last Christmas', 'Wham!'], ['Stille Nacht', '']]);
    await waitText(a, 'Lieder gespeichert.');
    await waitText(a, 'Deine Lieder ändern');
    const b = pages.Benedikt;
    await b.bringToFront();
    await b.reload();
    await waitText(b, 'Wichtel-Mixtape');
    // nur Interpret ohne Titel wird abgelehnt
    await fill(b, [['', 'Nur Interpret']]);
    await waitText(b, 'Bitte bei jedem Lied den Titel angeben.');
    await fill(b, [['last christmas', 'WHAM!'], ['Rockin\' Around the Christmas Tree', 'Brenda Lee']]);
    await waitText(b, 'Lieder gespeichert.');
    const c = pages.Cleo;
    await c.bringToFront();
    await c.reload();
    await c.waitForSelector('#mixtape .mix-track', { timeout: 10000 });
    const tl = await tracks(c);
    if (tl.length !== 3) problems.push(`Cleo sieht ${tl.length} statt 3 Lieder: ${tl.map((x) => x.title).join(', ')}`);
    if (tl.map((x) => x.no).join(',') !== 'A1,A2,B1') problems.push(`Seiten: ${tl.map((x) => x.no).join(',')}`);
    const lc = tl.find((x) => x.title.toLowerCase() === 'last christmas');
    if (!lc?.text.includes('von 2 Personen gewählt')) problems.push(`Doppeltes Lied nicht zusammengefasst: ${lc?.text}`);
    const all = tl.map((x) => x.text).join(' ');
    if (/Anna|Benedikt/.test(all)) problems.push(`Namen in der Trackliste: ${all}`);
    // Such-Links: fünf Dienste, nur https, ohne Referrer, neues Fenster
    const want = ['Qobuz', 'Spotify', 'Deezer', 'Apple Music', 'YouTube'];
    for (const x of tl) {
      if (x.links.map((l) => l.name).join('|') !== want.join('|')) problems.push(`Dienste bei ${x.title}: ${x.links.map((l) => l.name)}`);
      for (const l of x.links) {
        if (!l.href.startsWith('https://') || l.target !== '_blank' || !l.rel.includes('noopener') || !l.rel.includes('noreferrer') || l.ref !== 'no-referrer') problems.push(`Link ${l.name}: ${JSON.stringify(l)}`);
      }
    }
    const brenda = tl.find((x) => x.title.startsWith('Rockin'));
    const sp = brenda.links.find((l) => l.name === 'Spotify').href;
    if (decodeURIComponent(sp) !== "https://open.spotify.com/search/Rockin' Around the Christmas Tree Brenda Lee") problems.push(`Spotify-Link: ${sp}`);
    // Alle sehen dieselbe Reihenfolge
    await a.bringToFront();
    await a.reload();
    await a.waitForSelector('#mixtape .mix-track', { timeout: 10000 });
    const ta = await tracks(a);
    if (ta.map((x) => x.title).join('|') !== tl.map((x) => x.title).join('|')) problems.push('Anna und Cleo sehen verschiedene Reihenfolgen');
    // Keine Musikdienste geladen (nichts vorab)
    const ext = await c.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((u) => !u.startsWith(location.origin)));
    if (ext.length) problems.push(`Fremde Anfragen: ${ext.join(', ')}`);
    await c.evaluate(() => document.querySelector('#mixtape .mix-listen').setAttribute('open', ''));
    await c.evaluate(() => document.querySelector('#mixtape').scrollIntoView());
    await shotCard(c, 'Wichtel-Mixtape', 'mixtape');
    await axe(c, 'Mixtape');
  });

  await step('Datenbank: keine Liedtitel im Klartext, Einträge ohne Personen-ID im Inhalt', async () => {
    const dump = srv.sql('SELECT * FROM participants') + srv.sql('SELECT * FROM rounds');
    for (const s of ['Last Christmas', 'last christmas', 'Stille Nacht', 'Brenda', 'Wham']) if (dump.includes(s)) problems.push(`Klartext in der Datenbank: ${s}`);
    const n = JSON.parse(srv.sql('SELECT COUNT(*) AS n FROM participants WHERE mix_ct IS NOT NULL'))[0].n;
    if (n !== 2) problems.push(`${n} Mixtape-Einträge statt 2`);
  });

  await step('Organisator:in sieht kein Mixtape', async () => {
    await admin.bringToFront();
    await admin.reload();
    await waitText(admin, 'Teilnehmende');
    if (await admin.evaluate(() => /Last Christmas|Wichtel-Mixtape/.test(document.body.textContent))) problems.push('Mixtape in der Organisator-Ansicht');
  });

  await step('Benedikt entfernt seine Lieder wieder (alle Felder leer)', async () => {
    const b = pages.Benedikt;
    await b.bringToFront();
    await b.reload();
    await waitText(b, 'Deine Lieder ändern');
    await clickText(b, 'Deine Lieder ändern');
    await fill(b, []);
    await waitText(b, 'Deine Lieder sind entfernt.');
    // Erst nach dem Neuaufbau der Karte weiter (sonst landet die Eingabe in der alten Karte)
    await waitText(b, 'Deine Lieder eintragen');
    await fill(b, [['last christmas', 'WHAM!']]);
    await waitText(b, 'Lieder gespeichert.');
  });

  await step('Ab der Bescherung: keine Bearbeitung mehr; Anna deckt auf, Cleo sieht „aufgedeckt: Anna“; wieder verbergen', async () => {
    srv.sql(`UPDATE rounds SET event_date = strftime('%s','now') - 3600 WHERE id = '${roundId}'`);
    const a = pages.Anna;
    await a.bringToFront();
    await a.reload();
    await waitText(a, 'Meine Lieder aufdecken');
    if (await a.$('#mixtape .mix-row')) problems.push('Nach der Bescherung noch bearbeitbar');
    await clickText(a, 'Meine Lieder aufdecken', '#mixtape');
    await waitText(a, 'Aufgedeckt');
    const c = pages.Cleo;
    await c.bringToFront();
    await c.reload();
    await c.waitForSelector('#mixtape .mix-track', { timeout: 10000 });
    const tl = await tracks(c);
    const sn = tl.find((x) => x.title === 'Stille Nacht');
    if (!sn?.text.includes('aufgedeckt: Anna')) problems.push(`Aufdecken nicht sichtbar: ${sn?.text}`);
    const lc = tl.find((x) => x.title.toLowerCase() === 'last christmas');
    if (!lc?.text.includes('aufgedeckt: Anna') || lc.text.includes('Benedikt')) problems.push(`Gemeinsames Lied: ${lc?.text}`);
    await axe(c, 'Mixtape nach der Bescherung');
    await a.bringToFront();
    await a.reload();
    await waitText(a, 'Meine Lieder wieder verbergen');
    await clickText(a, 'Meine Lieder wieder verbergen', '#mixtape');
    await waitText(a, 'Deine Lieder sind wieder ohne Namen.');
    await c.bringToFront();
    await c.reload();
    await c.waitForSelector('#mixtape .mix-track', { timeout: 10000 });
    if ((await tracks(c)).some((x) => x.text.includes('aufgedeckt'))) problems.push('Nach dem Verbergen noch aufgedeckt');
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
