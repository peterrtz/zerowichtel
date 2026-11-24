// Browser-Durchlauf 2.14: Nachricht der Organisator:in an alle mit eigenen offenen Aufgaben, präsentere Wichtelpost
// (offene Fragen oben, Zahl im Sprungmenü, „Jetzt antworten“, neue Antworten beim Wichtel), Zugang gilt als gesichert,
// wenn er von außen geöffnet oder wiederhergestellt wurde.
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
  if (el) await el.screenshot({ path: join(SHOTS, `v34-card-${name}.png`) });
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
const badge = (page, key) => page.evaluate((k) => document.querySelector(`#section-nav .nav-item[data-key="${k}"] .nav-badge`)?.textContent ?? null, key);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cardOrder(page) {
  return page.evaluate(() => [...document.querySelectorAll('main .card, main details.card')].map((c) => c.querySelector('h2, summary')?.textContent ?? ''));
}
try {
  const admin = await newPage();
  const names = ['Anna', 'Ben', 'Cleo'];
  let invites = {};
  await step('Runde mit drei Personen; alle sagen zu, nur Anna trägt Wünsche ein', async () => {
    await admin.goto(`${srv.base}/#neu`);
    await admin.waitForSelector('form.form');
    await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await admin.type('input[placeholder^="z. B. Familien"]', 'Rundbrief');
    await admin.$eval('form.form', (f) => f.requestSubmit());
    await waitText(admin, 'Zuerst: Admin-Link sichern');
    await clickText(admin, 'Erledigt, ich habe den Link gesichert');
    for (const name of names) {
      await admin.waitForSelector('.add-person input');
      await admin.type('.add-person input', name);
      await admin.$eval('.add-person', (f) => f.requestSubmit());
      await admin.waitForFunction((x) => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === x), { polling: 100 }, name);
    }
    invites = await admin.evaluate(() => Object.fromEntries([...document.querySelectorAll('.person')].map((li) => [
      li.querySelector('.person-name').textContent,
      [...li.querySelectorAll('a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href'),
    ])));
  });
  const pages = {};
  for (const n of names) {
    pages[n] = await newPage();
    await accept(pages[n], `${srv.base}/${invites[n]}`, n);
  }
  await step('Anna trägt Wünsche ein', async () => {
    const a = pages.Anna;
    await a.evaluate(() => { const ta = document.querySelector('.wish-item textarea'); ta.value = 'Ein gutes Buch'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickText(a, 'Wünsche speichern');
    await waitText(a, 'Wünsche gespeichert.');
  });

  await step('Organisator:in: Vorlage, „offene Aufgaben“ an, ohne E-Mail-Modus keine Mail; senden', async () => {
    await admin.reload();
    await waitText(admin, 'Nachricht an alle');
    if (!(await admin.$eval('#announce-mail', (x) => x.disabled))) problems.push('Mail-Häkchen ohne E-Mail-Modus bedienbar');
    if (!(await admin.$eval('#announce-todos', (x) => x.checked))) problems.push('„offene Aufgaben“ nicht vorausgewählt');
    await clickText(admin, 'Vorlage: Erinnerung an offene Aufgaben');
    const v = await admin.$eval('#announce-text', (x) => x.value);
    if (!v.startsWith('Hallo zusammen!')) problems.push(`Vorlage: ${v.slice(0, 40)}`);
    await admin.$eval('#announce-text', (x) => { x.value += '\n\n**Treffpunkt:** 18 Uhr <script>alert(1)</script>'; });
    await clickText(admin, 'An alle senden');
    await waitText(admin, 'Gesendet. Alle sehen die Nachricht');
    await admin.waitForSelector('.announce-item');
    if (await admin.$('.announce-item script')) problems.push('Skript in der Nachricht wurde als HTML eingefügt');
    if (!(await admin.$eval('.announce-item', (x) => x.textContent.includes('mit offenen Aufgaben')))) problems.push('Kennzeichnung „mit offenen Aufgaben“ fehlt');
    await shotCard(admin, 'Nachricht an alle', 'admin');
    await axe(admin, 'Verwaltung: Nachricht an alle');
  });

  await step('Ben sieht die Nachricht oben, „neu“, Zahl im Menü; seine offenen Aufgaben: Wünsche', async () => {
    const b = pages.Ben;
    await b.reload();
    await waitText(b, 'Nachricht von der Organisator:in');
    const order = await cardOrder(b);
    if (order[0] !== 'Nachricht von der Organisator:in') problems.push(`Reihenfolge: ${order.slice(0, 3).join(' / ')}`);
    const card = await b.$eval('.card-announce', (c) => ({ text: c.textContent, strong: c.querySelector('strong')?.textContent, neu: !!c.querySelector('.chip'), att: c.classList.contains('card-attention') }));
    if (!card.text.includes('Bei dir noch offen') || !card.text.includes('Wünsche eintragen')) problems.push(`Bens Aufgaben: ${card.text.slice(0, 300)}`);
    if (card.text.includes('Zugang sichern')) problems.push('Ben hat den Zugang gesichert, steht trotzdem in den Aufgaben');
    if (card.strong !== 'Treffpunkt:') problems.push('Markdown nicht dargestellt');
    if (!card.text.includes('<script>alert(1)</script>')) problems.push('Spitze Klammern nicht als Text');
    if (!card.neu || !card.att) problems.push('nicht als neu markiert');
    if ((await badge(b, 'nachricht')) !== '1') problems.push(`Menüzahl Nachricht: ${await badge(b, 'nachricht')}`);
    await shotCard(b, 'Nachricht von der Organisator:in', 'person');
    await axe(b, 'Person: Nachricht');
    await sleep(2200); // 1,5 s sichtbar = gelesen
    if ((await badge(b, 'nachricht')) !== '') problems.push('Menüzahl bleibt nach dem Lesen');
    await b.reload();
    await waitText(b, 'Nachricht von der Organisator:in');
    if (await b.$('.card-announce .chip')) problems.push('nach dem Lesen weiter „neu“');
  });

  await step('Anna (Wünsche da): „Bei dir ist gerade nichts offen.“', async () => {
    await pages.Anna.reload();
    await waitText(pages.Anna, 'Bei dir ist gerade nichts offen.');
  });

  const reveal = {};
  await step('Auslosen; Bens Wichtel fragt anonym', async () => {
    await admin.reload();
    await waitText(admin, 'Teilnehmende');
    await clickText(admin, 'Jetzt auslosen');
    await waitText(admin, 'Die Ziehung ist am');
    for (const n of names) {
      await pages[n].reload();
      await pages[n].waitForSelector('.gift, .reveal-name', { timeout: 10000 });
      if (await pages[n].$('.gift')) await pages[n].click('.gift');
      await pages[n].waitForSelector('.reveal-name', { timeout: 10000 });
      reveal[n] = await pages[n].$eval('.reveal-name', (e) => e.textContent);
    }
    const giver = names.find((n) => reveal[n] === 'Ben');
    const g = pages[giver];
    await g.type('.msg-input-g', 'Welche Farbe magst du?');
    await clickText(g, 'Anonym fragen');
    await g.waitForFunction(() => document.querySelector('.thread .msg-mine'), { polling: 100 });
  });

  await step('Ben: Frage ganz oben in „Was jetzt?“, Wichtelpost direkt darunter, „offen“, Zahl im Menü', async () => {
    const b = pages.Ben;
    await b.reload();
    await waitText(b, 'Dein Wichtel hat dir eine Frage gestellt.');
    const first = await b.$eval('.next-steps li', (li) => li.textContent);
    if (!first.startsWith('Dein Wichtel hat dir eine Frage gestellt.')) problems.push(`Erster Schritt: ${first}`);
    const order = await cardOrder(b);
    const i = order.indexOf('Was jetzt?');
    if (order[i + 1] !== 'Post von deinem Wichtel') problems.push(`Wichtelpost nicht unter „Was jetzt?“: ${order.join(' / ')}`);
    const post = await b.$eval('.card-post', (c) => ({ att: c.classList.contains('card-attention'), text: c.textContent }));
    if (!post.att || !post.text.includes('Dein Wichtel wartet auf deine Antwort (1 offene Frage).') || !post.text.includes('offen')) problems.push(`Wichtelpost: ${post.text.slice(0, 200)}`);
    if ((await badge(b, 'post')) !== '1') problems.push(`Menüzahl Wichtelpost: ${await badge(b, 'post')}`);
    const label = await b.$eval('#section-nav .nav-item[data-key="post"]', (x) => x.getAttribute('aria-label'));
    if (label !== 'Wichtelpost, 1 offene Frage') problems.push(`Menü-Beschriftung: ${label}`);
    // Nachricht der Organisator:in nennt jetzt auch die offene Frage
    const todos = await b.$eval('.card-announce', (c) => c.textContent);
    if (!todos.includes('Wichtelpost beantworten: 1 offene Frage.')) problems.push('offene Frage fehlt in den Aufgaben');
    await clickText(b, 'Jetzt antworten');
    await b.waitForFunction(() => document.activeElement?.classList.contains('msg-input-r'), { timeout: 3000, polling: 100 });
    await shotCard(b, 'Post von deinem Wichtel', 'post-offen');
    await axe(b, 'Person: offene Wichtelpost');
    await b.keyboard.type('Dunkelgrün!');
    await clickText(b, 'Antworten', '.card-post');
    await b.waitForFunction(() => [...document.querySelectorAll('.msg p')].some((p) => p.textContent === 'Dunkelgrün!'), { polling: 100 });
    if (await b.evaluate(() => document.body.textContent.includes('Dein Wichtel hat dir eine Frage gestellt.'))) problems.push('nach der Antwort weiter offen');
    if (await b.$('.card-post.card-attention')) problems.push('Karte nach der Antwort weiter hervorgehoben');
    const after = await cardOrder(b);
    if (after[after.indexOf('Was jetzt?') + 1] === 'Post von deinem Wichtel') problems.push('Karte bleibt oben, obwohl nichts offen ist');
  });

  await step('Wichtel sieht die Antwort als „neu“ mit Zahl; nach dem Lesen nicht mehr', async () => {
    const giver = names.find((n) => reveal[n] === 'Ben');
    const g = pages[giver];
    await g.reload();
    await waitText(g, 'Dunkelgrün!');
    const neu = await g.evaluate(() => [...document.querySelectorAll('.card-reveal .msg')].find((m) => m.textContent.includes('Dunkelgrün!'))?.querySelector('.chip')?.textContent);
    if (neu !== 'neu') problems.push(`Antwort nicht als neu markiert: ${neu}`);
    if ((await badge(g, 'wichtel')) !== '1') problems.push(`Menüzahl Wichtel: ${await badge(g, 'wichtel')}`);
    await g.evaluate(() => document.querySelector('.card-reveal .thread').scrollIntoView({ block: 'center' }));
    await sleep(2200);
    if ((await badge(g, 'wichtel')) !== '') problems.push('Menüzahl Wichtel bleibt nach dem Lesen');
    await g.reload();
    await waitText(g, 'Dunkelgrün!');
    if (await g.$('.card-reveal .msg .chip')) problems.push('Antwort nach dem Lesen weiter „neu“');
  });

  await step('Wichtelpost auf Bens zweitem Gerät: Frage und Antwort da, nichts offen', async () => {
    const second = await newPage();
    await second.goto(pages.Ben.url());
    await waitText(second, 'Dunkelgrün!');
    if (!(await second.evaluate(() => document.body.textContent.includes('Welche Farbe magst du?')))) problems.push('Frage fehlt auf dem zweiten Gerät');
    if (await second.$('.card-post.card-attention')) problems.push('zweites Gerät zeigt die beantwortete Frage als offen');
    await second.close();
  });

  await step('Zugang gilt als gesichert, wenn der Link von außen geöffnet oder der Code eingelöst wird', async () => {
    const link = pages.Cleo.url();
    const other = await newPage();
    await other.goto(link);
    await waitText(other, 'Mein Zugang und Wiederherstellung');
    if (await other.evaluate(() => document.body.textContent.includes('Zuerst: Zugang sichern'))) problems.push('Link von außen: fragt erneut nach „Zugang sichern“');
    const code = await pages.Cleo.evaluate(() => { [...document.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent === 'Mein Zugang und Wiederherstellung').open = true; return document.querySelector('.recovery-code').textContent; });
    const tablet = await newPage();
    await tablet.goto(`${srv.base}/#wiederherstellen/${code.replace(/-/g, '')}`);
    await clickText(tablet, 'Wiederherstellen');
    await waitText(tablet, 'Zugang wiederhergestellt. Dein Wiederherstellungscode bleibt gültig');
    if (await tablet.evaluate(() => document.body.textContent.includes('Zuerst: Zugang sichern') || document.body.textContent.includes('Einladung angenommen'))) problems.push('nach Wiederherstellung: falsche Hinweise');
    await axe(tablet, 'Nach Wiederherstellung');
  });

  await step('Organisator:in löscht die Nachricht – sie verschwindet bei allen', async () => {
    await admin.reload();
    await admin.waitForSelector('.announce-item');
    await clickText(admin, 'Löschen', '.announce-item');
    await waitText(admin, 'Noch keine Nachricht gesendet.');
    await pages.Anna.reload();
    await waitText(pages.Anna, 'Was jetzt?');
    if (await pages.Anna.$('.card-announce')) problems.push('Nachricht nach dem Löschen noch sichtbar');
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
