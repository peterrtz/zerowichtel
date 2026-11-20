// Browser-Durchlauf 2.12: Unterstützungslink des Betreibers – Admin-Einstellung mit Tracking-Warnung, Anzeige in
// Fußzeile und auf der Startseite (neuer Tab, ohne Referrer und Opener, nichts vorab geladen), Übersetzung des
// Standardtexts, Datenschutzhinweis, Ausschalten.
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-30.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
const problems = [];
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let axeChecks = 0;
let expect400 = false; // absichtlich abgelehnte Eingabe
let steps = 0;

async function newPage(ctx = null) {
  const c = ctx ?? await browser.createBrowserContext();
  const page = await deutsch(await c.newPage());
  await page.setBypassCSP(true); // nur, damit axe eingebunden werden kann
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error' && !(expect400 && /status of 400/.test(m.text()))) problems.push(`Konsole: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('dialog', (d) => { if (process.env.DEBUG) console.log('Dialog:', d.message().slice(0, 120)); d.accept(d.defaultValue()); });
  return page;
}
async function shotCard(page, text, name) {
  if (!SHOTS) return;
  const handle = await page.evaluateHandle((x) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(x)), text);
  const el = handle.asElement();
  if (el) await el.screenshot({ path: join(SHOTS, `v30-card-${name}.png`) });
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
async function step(name, fn) {
  steps++;
  await fn();
  console.log(`ok   ${name}`);
}
const URL1 = 'https://sharethemeal.org/challenges/00000000-0000-4000-8000-000000000000?adjust_t=abc1234&hl=de-DE';
const CLEAN = 'https://sharethemeal.org/challenges/00000000-0000-4000-8000-000000000000?hl=de-DE';
const donateCard = (page) => page.evaluateHandle(() => [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.textContent === 'Unterstützungslink'));
const footerLink = (page) => page.evaluate(() => {
  const a = document.querySelector('footer.footer a[data-donation]');
  return a && { text: a.textContent, href: a.getAttribute('href'), rel: a.getAttribute('rel'), target: a.getAttribute('target'), ref: a.getAttribute('referrerpolicy') };
});

try {
  const creds = srv.adminSetup();
  const admin = await newPage();
  const visitor = await newPage();

  await step('Ohne Einstellung: kein Link in Fußzeile und Startseite', async () => {
    await visitor.goto(`${srv.base}/#`);
    await waitText(visitor, 'Wichteln ohne Konto.');
    await new Promise((r) => setTimeout(r, 600));
    if (await footerLink(visitor)) problems.push('Link ohne Einstellung sichtbar');
    if (await visitor.evaluate(() => document.body.textContent.includes('ZeroWichtel unterstützen'))) problems.push('Karte ohne Einstellung sichtbar');
  });

  await step('Admin: Link mit Tracking-Angabe eintragen, Warnung, bereinigen, speichern', async () => {
    await admin.goto(`${srv.base}/#backend/${creds.slug}`);
    await admin.waitForSelector('input[type=password]');
    await admin.type('input[type=password]', creds.password);
    await admin.type('input[autocomplete=one-time-code]', totp(creds.secret));
    await admin.$eval('form.form', (f) => f.requestSubmit());
    await waitText(admin, 'Unterstützungslink');
    const card = await donateCard(admin);
    const url = await card.$('input[type=url]');
    // http wird abgelehnt
    await url.type('http://example.org');
    await card.$eval('input[type=checkbox]', (c) => { c.checked = true; });
    expect400 = true;
    await admin.evaluate((c) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Speichern').click(), card);
    expect400 = true;
    await waitText(admin, 'Nur Adressen mit https:// sind erlaubt.');
    expect400 = false;
    await url.evaluate((i, v) => { i.value = v; i.dispatchEvent(new Event('input')); }, URL1);
    await waitText(admin, 'Tracking-Angabe');
    await shotCard(admin, 'Tracking-Angabe', 'admin-tracking');
    await admin.evaluate((c) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Tracking-Angaben entfernen').click(), card);
    const v = await card.$eval('input[type=url]', (i) => i.value);
    if (v !== CLEAN) problems.push(`Bereinigt: ${v}`);
    if (await admin.evaluate((c) => c.textContent.includes('Tracking-Angabe'), card)) problems.push('Warnung nach dem Bereinigen noch da');
    await card.$eval('input[type=text]', (i) => { i.value = 'Mahlzeit teilen'; });
    await card.$eval('textarea', (i) => { i.value = 'ZeroWichtel ist kostenlos. Statt eines Kaffees: teil eine Mahlzeit über ShareTheMeal.'; });
    await admin.evaluate((c) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Speichern').click(), card);
    await waitText(admin, 'Unterstützungslink eingeschaltet.');
    await waitText(admin, 'Gespeichert:');
    await shotCard(admin, 'Gespeichert:', 'admin');
    await axe(admin, 'Admin-Bereich mit Unterstützungslink');
  });

  await step('Startseite: Karte und Fußzeilen-Link mit sicheren Attributen, nichts vorab geladen', async () => {
    await visitor.goto(`${srv.base}/#`);
    await visitor.reload();
    await waitText(visitor, 'ZeroWichtel unterstützen');
    const f = await footerLink(visitor);
    if (!f) { problems.push('kein Fußzeilen-Link'); return; }
    if (f.text !== 'Mahlzeit teilen' || f.href !== CLEAN || f.target !== '_blank' || !/noopener/.test(f.rel) || !/noreferrer/.test(f.rel) || f.ref !== 'no-referrer') problems.push(`Fußzeile: ${JSON.stringify(f)}`);
    const home = await visitor.evaluate(() => {
      const c = [...document.querySelectorAll('.card')].find((x) => x.textContent.includes('ZeroWichtel unterstützen'));
      const a = c.querySelector('a[data-donation]');
      return { text: c.textContent, href: a?.getAttribute('href'), rel: a?.getAttribute('rel') };
    });
    if (!home.text.includes('Statt eines Kaffees') || !home.text.includes('sharethemeal.org') || home.href !== CLEAN || !/noreferrer/.test(home.rel)) problems.push(`Startseite: ${JSON.stringify(home)}`);
    const ext = await visitor.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((u) => !u.startsWith(location.origin)));
    if (ext.length) problems.push(`Fremde Anfragen: ${ext.join(', ')}`);
    await shotCard(visitor, 'ZeroWichtel unterstützen', 'home');
    if (SHOTS) {
      const foot = await visitor.$('footer.footer');
      await foot.screenshot({ path: join(SHOTS, 'v30-footer.png') });
    }
    await axe(visitor, 'Startseite mit Unterstützungslink');
  });

  await step('Runden: ohne Option keine Karte; mit „Zusätzlich in den Runden zeigen“ ganz unten auf Teilnehmer- und Verwaltungsseite', async () => {
    const org = await newPage();
    await org.goto(`${srv.base}/#neu`);
    await org.waitForSelector('form.form');
    await org.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await org.type('input[placeholder^="z. B. Familien"]', 'Büro');
    await org.$eval('form.form', (f) => f.requestSubmit());
    await waitText(org, 'Zuerst: Admin-Link sichern');
    await org.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Erledigt, ich habe den Link gesichert').click());
    await org.waitForSelector('.add-person input');
    await org.type('.add-person input', 'Erna');
    await org.$eval('.add-person', (f) => f.requestSubmit());
    await org.waitForFunction(() => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === 'Erna'), { polling: 100 });
    const invite = await org.evaluate(() => [...document.querySelectorAll('.person a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href'));
    const person = await newPage();
    await person.goto(`${srv.base}/${invite}`);
    await waitText(person, 'Hallo Erna!');
    await person.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Einladung annehmen').click());
    await waitText(person, 'Zuerst: Zugang sichern');
    await person.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Erledigt, ich habe Link und Code gesichert').click());
    await waitText(person, 'Bist du dabei?');
    const inRound = (page) => page.evaluate(() => {
      const cards = [...document.querySelectorAll('main .card')];
      const i = cards.findIndex((c) => c.textContent.includes('ZeroWichtel unterstützen'));
      return { found: i >= 0, fromEnd: i >= 0 ? cards.length - 1 - i : -1 };
    });
    await new Promise((r) => setTimeout(r, 600));
    for (const [name, page] of [['Teilnehmer', person], ['Verwaltung', org]]) {
      if ((await inRound(page)).found) problems.push(`${name}: Karte ohne Option sichtbar`);
    }
    if (!(await footerLink(person))) problems.push('Fußzeile in der Runde fehlt');
    // Option einschalten
    await admin.bringToFront();
    const card = await donateCard(admin);
    const boxes = await card.$$('input[type=checkbox]');
    await boxes[1].evaluate((c) => { c.checked = true; });
    await admin.evaluate((c) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Speichern').click(), card);
    await waitText(admin, 'auch in den Runden');
    for (const [name, page] of [['Teilnehmer', person], ['Verwaltung', org]]) {
      await page.bringToFront();
      await page.reload();
      await waitText(page, 'ZeroWichtel unterstützen');
      const r = await inRound(page);
      // Teilnehmer: danach nur noch „Entfernen“-Knopf (kein Card); Verwaltung: danach die Gefahrenzone
      if (r.fromEnd > 1) problems.push(`${name}: Karte nicht unten (${r.fromEnd} Karten danach)`);
      await axe(page, `${name}seite mit Unterstützungskarte`);
    }
    await shotCard(person, 'ZeroWichtel unterstützen', 'runde');
    await person.close();
    await org.close();
  });

  await step('Klick öffnet neuen Tab ohne Opener; Anfrage an den Dienst ohne Referer (im Test abgefangen)', async () => {
    // Fremde Anfragen dieses Browserkontexts werden abgefangen und mit einer leeren Seite beantwortet;
    // so prüft der Test, was der Browser senden würde, ohne den Dienst wirklich aufzurufen.
    const ctx = visitor.browserContext();
    const seen = [];
    const target = new Promise((res) => ctx.once('targetcreated', res));
    // Browserweit: nur Anfragen an sharethemeal.org abfangen
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://sharethemeal.org/*' }] });
    cdp.on('Fetch.requestPaused', (ev) => {
      seen.push({ url: ev.request.url, referer: ev.request.headers.Referer ?? ev.request.headers.referer ?? null });
      cdp.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<p>ok</p>').toString('base64') }).catch(() => {});
    });
    await visitor.evaluate(() => document.querySelector('footer.footer a[data-donation]').click());
    const tgt = await target;
    const tab = await tgt.page();
    await tab.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }).catch(() => {});
    const info = await tab.evaluate(() => ({ opener: window.opener, ref: document.referrer, url: location.href })).catch((e) => ({ error: e.message }));
    if (info.error) problems.push(`Neuer Tab nicht prüfbar: ${info.error}`);
    else if (info.opener !== null || info.ref !== '' || !info.url.startsWith('https://sharethemeal.org/')) problems.push(`Neuer Tab: ${JSON.stringify(info)}`);
    if (!seen.length) problems.push('keine Anfrage gesehen');
    // Nur die Navigation zählt (spätere Anfragen der fremden Seite, etwa favicon.ico, tragen deren eigene Adresse)
    else if (seen.find((x) => x.url === CLEAN)?.referer !== null) problems.push(`Referer gesendet: ${JSON.stringify(seen)}`);
    if (process.env.DEBUG) console.log(JSON.stringify({ info, seen }));
    await tab.close();
    await cdp.send('Fetch.disable');
    await cdp.detach();
  });

  await step('Englisch: eigener Linktext bleibt; ohne Linktext „Support“', async () => {
    await visitor.evaluate(() => document.getElementById('lang-toggle').click());
    await waitText(visitor, 'Support ZeroWichtel');
    if ((await footerLink(visitor)).text !== 'Mahlzeit teilen') problems.push('Eigener Linktext geändert');
    srv.sql(`UPDATE meta SET value = json_set(value, '$.label', '') WHERE key = 'donation'`);
    await visitor.reload();
    await waitText(visitor, 'Support ZeroWichtel');
    await visitor.waitForFunction(() => document.querySelector('footer.footer a[data-donation]')?.textContent === 'Support', { timeout: 5000 }).catch(() => problems.push('Standardtext englisch nicht „Support“'));
    await visitor.evaluate(() => document.getElementById('lang-toggle').click());
    await visitor.waitForFunction(() => document.querySelector('footer.footer a[data-donation]')?.textContent === 'Unterstützen', { timeout: 5000 }).catch(() => problems.push('Standardtext deutsch nicht „Unterstützen“'));
  });

  await step('Datenschutz nennt den Link', async () => {
    await visitor.goto(`${srv.base}/#datenschutz`);
    await waitText(visitor, 'Unterstützungslink: Fußzeile, Startseite und die Seiten der Wichtelrunden enthalten einen Link zu sharethemeal.org');
  });

  await step('Geschenkvorschläge: im Admin-Bereich eigene Liste anlegen; der Ideen-Würfel nimmt sie', async () => {
    await admin.bringToFront(); // Sitzung lebt nur im Speicher: kein Neuladen
    await waitText(admin, 'Geschenkvorschläge (Ideen-Würfel)');
    await admin.evaluate(() => { document.getElementById('ideen').open = true; });
    const btn = async (text) => admin.evaluate((x) => [...document.querySelectorAll('#ideen button')].find((b) => b.textContent === x).click(), text);
    // Vorlage übernehmen → Modus „Nur eigene“, Standardliste im Editor
    await btn('Standardliste als Vorlage übernehmen');
    await waitText(admin, 'Standardliste übernommen');
    const n0 = await admin.$$eval('#ideen .ideas-row', (r) => r.length);
    if (n0 < 20) problems.push(`Vorlage: nur ${n0} Zeilen`);
    // Alles entfernen bis auf einen neuen Vorschlag bis 5 €
    await admin.evaluate(() => { while (document.querySelector('#ideen .ideas-row button')) document.querySelector('#ideen .ideas-row button').click(); });
    await btn('+ Vorschlag bis 5 €');
    await admin.evaluate(() => {
      const [de, en] = document.querySelectorAll('#ideen .ideas-row input');
      de.value = 'Selbstgebackene Plätzchen in einer Dose'; de.dispatchEvent(new Event('input'));
      en.value = 'Home-baked cookies in a tin'; en.dispatchEvent(new Event('input'));
    });
    await btn('+ Vorschlag über 50 €'); // leer → wird beim Speichern weggelassen
    await shotCard(admin, 'Geschenkvorschläge (Ideen-Würfel)', 'ideen');
    await axe(admin, 'Admin: Geschenkvorschläge');
    await btn('Speichern');
    await waitText(admin, 'Gespeichert: 1 eigene Vorschläge.');
    const stored = JSON.parse(JSON.parse(srv.sql("SELECT value FROM meta WHERE key = 'ideas'"))[0].value);
    if (stored.mode !== 'replace' || stored.items.length !== 1 || stored.items[0].max !== 5) problems.push(`Gespeichert: ${JSON.stringify(stored)}`);
    // Ideen-Würfel in der App (gleiches Modul wie auf der Teilnehmerseite), Limit 5 € und 3 €
    await visitor.bringToFront();
    await visitor.goto(`${srv.base}/#`);
    await visitor.reload();
    const rolled = await visitor.evaluate(async () => {
      const { ideaDice } = await import('/js/views/extras.js');
      const out = [];
      for (const budget of [5, 3]) {
        const el = ideaDice(budget);
        document.querySelector('main').append(el);
        out.push(el.querySelectorAll('select option').length);
        el.querySelector('select').value = 'kind';
        el.querySelector('button').click();
        await new Promise((r) => setTimeout(r, 400));
        out.push(el.querySelector('.idea-out').textContent);
        el.remove();
      }
      return out;
    });
    if (rolled[0] !== 4 || rolled[2] !== 4) problems.push(`Altersauswahl: ${rolled[0]} Optionen`);
    if (rolled[1] !== 'Selbstgebackene Plätzchen in einer Dose') problems.push(`Würfel bei 5 €: ${rolled[1]}`);
    if (rolled[3] !== 'Selbstgebackene Plätzchen in einer Dose') problems.push(`Würfel bei 3 €: ${rolled[3]} (Klasse bis 5 € passt immer)`);
  });

  await step('Adventsalbum-Grenzen im Admin-Bereich (2.13.1): Standard 20/60, ändern, zurücksetzen', async () => {
    await admin.bringToFront();
    await waitText(admin, 'Grenzen für alle Runden.');
    const v = await admin.evaluate(() => [document.getElementById('album-limit-photos').value, document.getElementById('album-limit-mb').value]);
    if (v.join() !== '20,60') problems.push(`Standard: ${v}`);
    await admin.evaluate(() => { document.getElementById('album-limit-photos').value = '8'; document.getElementById('album-limit-mb').value = '25'; });
    await admin.evaluate(() => [...document.getElementById('album-limit-mb').closest('.card').querySelectorAll('button')].find((b) => b.textContent === 'Speichern').click());
    await waitText(admin, 'Gespeichert: 8 Fotos je Person, 25 MB je Runde.');
    const stored = JSON.parse(JSON.parse(srv.sql("SELECT value FROM meta WHERE key = 'album_limits'"))[0].value);
    if (stored.personPhotos !== 8 || stored.roundMb !== 25) problems.push(`Gespeichert: ${JSON.stringify(stored)}`);
    await axe(admin, 'Admin: Adventsalbum-Grenzen');
    await admin.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Auf Werte aus config.json zurücksetzen').click());
    await waitText(admin, 'Zurückgesetzt.');
    if (srv.sql("SELECT value FROM meta WHERE key = 'album_limits'") !== '[]') problems.push('Zurücksetzen hat den Eintrag nicht entfernt');
  });

  await step('Ausschalten: Link verschwindet überall', async () => {
    await admin.bringToFront();
    const card = await donateCard(admin);
    await card.$eval('input[type=checkbox]', (c) => { c.checked = false; });
    await admin.evaluate((c) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Speichern').click(), card);
    await waitText(admin, 'Unterstützungslink ausgeschaltet.');
    await visitor.bringToFront();
    await visitor.goto(`${srv.base}/#`);
    await visitor.reload();
    await waitText(visitor, 'Wichteln ohne Konto.');
    await new Promise((r) => setTimeout(r, 600));
    if (await footerLink(visitor)) problems.push('Link nach dem Ausschalten sichtbar');
    await visitor.goto(`${srv.base}/#datenschutz`);
    await waitText(visitor, '5. Empfänger');
    if (await visitor.evaluate(() => document.body.textContent.includes('Unterstützungslink'))) problems.push('Datenschutz nennt ausgeschalteten Link');
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
