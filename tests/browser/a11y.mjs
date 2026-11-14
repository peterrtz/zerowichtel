// Barrierefreiheit (WCAG 2.2 AA) in einem echten Chromium:
//  - axe-core auf allen Hauptansichten: hell, dunkel (System) und per Umschalter
//  - Meldungen in beiden Designs (Kontrast), Fehler bleiben stehen (role=alert)
//  - Tastatur: Sprunglink, Fokus auf der Überschrift nach Seitenwechsel, Fokus bleibt beim Neuzeichnen
//  - Formularfehler: aria-invalid, Meldung verknüpft, Fokus aufs Feld
//  - Umschalter: Wahl bleibt nach Neuladen, „Design wie Gerät“ setzt zurück, kein Aufblitzen
//  - 320 px Breite (1.4.10) und vergrößerte Textabstände (1.4.12) ohne seitliches Scrollen
//
//   CHROME_PATH=/pfad/zu/chrome node tests/browser/a11y.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer } from '../helpers/server.mjs';

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.log('CHROME_PATH nicht gesetzt – übersprungen.'); process.exit(0); }
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const srv = await startServer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--lang=de-DE', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split('|') : [])] });
const problems = [];
let checked = 0;

async function newPage({ scheme = 'light', width = 390 } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage().then(deutsch);
  await page.setBypassCSP(true); // nur, damit axe eingebunden werden kann
  await page.setViewport({ width, height: 844 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  page.on('dialog', (d) => d.accept(d.defaultValue()));
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  return page;
}
const waitText = (p, t) => p.waitForFunction((s) => document.getElementById('app').textContent.includes(s), { timeout: 10000, polling: 100 }, t);
async function axe(page, name) {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  })).violations.map((x) => `${x.id} (${x.nodes.length}×: ${x.nodes[0].target.join(' ')})`));
  checked++;
  if (v.length) problems.push(`${name}: ${v.join('; ')}`);
}
async function noHorizontalScroll(page, name) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (r.sw > r.cw + 1) problems.push(`${name}: seitliches Scrollen (${r.sw} > ${r.cw})`);
}

/** Legt eine Runde mit drei Personen an und liefert Admin-Seite und eine angenommene Einladung. */
async function setup(page) {
  await page.goto(`${srv.base}/#neu`);
  await page.waitForSelector('form.form');
  await page.type('input[placeholder^="ZW-"]', srv.organizerCode());
  await page.type('input[placeholder^="z. B. Familien"]', 'Barrierefrei wichteln');
  await page.$eval('form.form', (f) => f.requestSubmit());
  await waitText(page, 'Admin-Link sichern');
  for (const n of ['Anna', 'Ben', 'Cleo']) {
    await page.type('.add-person input', n);
    await page.$eval('.add-person', (f) => f.requestSubmit());
    await page.waitForFunction((x) => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === x), { polling: 100 }, n);
  }
  return page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent === 'Selbst hier öffnen').getAttribute('href'));
}

try {
  const admin = srv.adminSetup();
  // ---------- axe auf allen Ansichten, drei Varianten
  for (const variant of ['hell', 'dunkel', 'umgeschaltet']) {
    const page = await newPage({ scheme: variant === 'dunkel' ? 'dark' : 'light' });
    await page.goto(`${srv.base}/`, { waitUntil: 'networkidle0' });
    if (variant === 'umgeschaltet') {
      await page.click('#theme-toggle');
      const t = await page.evaluate(() => document.documentElement.dataset.theme);
      if (t !== 'dark') problems.push(`Umschalter: data-theme=${t}`);
    }
    await axe(page, `Start (${variant})`);
    await page.click('#crypto-info');
    await page.waitForFunction(() => document.querySelector('dialog.modal')?.open, { polling: 100 });
    await axe(page, `Verschlüsselung (${variant})`);
    await page.keyboard.press('Escape');
    await page.goto(`${srv.base}/#neu`); await page.waitForSelector('form.form'); await axe(page, `Anlegen (${variant})`);
    const inv = await setup(page);
    await axe(page, `Verwaltung (${variant})`);
    // Meldungen sichtbar machen und prüfen (Kontrast der Toasts)
    await page.evaluate(async () => {
      const dom = await import('/js/lib/dom.js');
      dom.toast('Gespeichert.', 'ok'); dom.toast('Hinweis.', 'info'); dom.toast('Etwas ist schiefgegangen.', 'error');
    });
    await axe(page, `Meldungen (${variant})`);
    const p2 = await newPage({ scheme: variant === 'dunkel' ? 'dark' : 'light' });
    if (variant === 'umgeschaltet') { await p2.goto(`${srv.base}/`); await p2.click('#theme-toggle'); }
    await p2.goto(`${srv.base}/${inv}`); await waitText(p2, 'Hallo'); await axe(p2, `Einladung (${variant})`);
    await p2.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Einladung annehmen').click());
    await waitText(p2, 'Zugang sichern'); await axe(p2, `Eigene Seite (${variant})`);
    for (const [hash, text, name] of [['#datenschutz', 'Datenschutzerklärung', 'Datenschutz'], ['#impressum', 'Impressum', 'Impressum'],
      ['#barrierefreiheit', 'Erklärung zur Barrierefreiheit', 'Barrierefreiheit'], ['#hilfe', 'Hilfe', 'Hilfe'], ['#lizenzen', 'Lizenzen und Quellen', 'Lizenzen'],
      ['#wiederherstellen', 'Wiederherstellungscode', 'Wiederherstellen'], [`#backend/${admin.slug}`, 'Masterpasswort', 'Admin'],
      ['#zu/AAAAAAAAAAAAAAAAAAAAAA', 'nicht gespeichert', 'Direktlink']]) {
      await page.goto(`${srv.base}/${hash}`); await waitText(page, text); await axe(page, `${name} (${variant})`);
    }
    await page.goto(`${srv.base}/#wuerfel`); await new Promise((r) => setTimeout(r, 400)); await axe(page, `Würfeln (${variant})`);
    await page.goto(`${srv.base}/#demo`); await waitText(page, 'Probier die Ziehung aus');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent === 'Auslosen').click());
    await page.waitForSelector('.envelope');
    await page.evaluate(() => document.querySelector('.envelope button').click());
    await waitText(page, 'beschenkt'); await axe(page, `Probelauf (${variant})`);
  }

  // ---------- 2.3: Gruppenlink, Päckchen, Rätselhinweise, nach der Bescherung, englische Oberfläche
  {
    const o = await newPage();
    await setup(o, []);
    await o.evaluate(() => [...document.querySelectorAll('summary')].find((x) => x.textContent === 'Gruppenlink (optional)').click());
    await axe(o, 'Gruppenlink anlegen');
    await o.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent === 'Gruppenlink erstellen').click());
    await waitText(o, 'von');
    await o.waitForSelector('.group-share');
    await axe(o, 'Gruppenlink aktiv');
    const link = await o.$eval('.group-share a[href^="sms:"]', (x) => decodeURIComponent(x.getAttribute('href').split('body=')[1]).match(/https?:\/\/\S+/)[0]);
    const people = [];
    for (const name of ['Ada', 'Bea', 'Cy']) {
      const p = await newPage();
      await p.goto(link); await waitText(p, 'selbst einzutragen');
      if (!people.length) await axe(p, 'Gruppenlink: Eintragen');
      await p.type('.join-form input', name);
      await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent === 'Mich eintragen').click());
      await waitText(p, 'Was jetzt?');
      people.push(p);
    }
    await o.reload(); await waitText(o, 'Jetzt auslosen');
    await o.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent === 'Jetzt auslosen').click());
    await waitText(o, 'Schon nachgesehen');
    const [pa] = people;
    await pa.reload(); await pa.waitForSelector('.gift'); await axe(pa, 'Päckchen');
    await pa.click('.gift'); await pa.waitForSelector('.reveal-name');
    const focused = await pa.evaluate(() => document.activeElement?.classList.contains('reveal-name'));
    if (!focused) problems.push('Nach dem Auspacken steht der Fokus nicht auf dem Namen');
    await pa.evaluate(() => [...document.querySelectorAll('summary')].filter((x) => /Rätselhinweise|Ideen-Würfel|Steckbrief/.test(x.textContent)).forEach((x) => x.click()));
    await axe(pa, 'Nach der Ziehung mit Hinweisen, Würfel, Steckbrief');
    srv.sql("UPDATE rounds SET wish_deadline = CAST(strftime('%s','now') AS INTEGER) - 7200, event_date = CAST(strftime('%s','now') AS INTEGER) - 3600");
    await pa.reload(); await waitText(pa, 'Wer war’s?'); await axe(pa, 'Nach der Bescherung');
    const z2 = await newPage({ width: 320 });
    for (const url of [link, `${srv.base}/#demo`]) {
      await z2.goto(url); await new Promise((r) => setTimeout(r, 500)); await noHorizontalScroll(z2, `320 px ${url.includes('#j') ? 'Gruppenlink' : 'Probelauf'}`);
    }
    const en = await newPage();
    await en.goto(`${srv.base}/`, { waitUntil: 'networkidle0' });
    await en.click('#lang-toggle');
    await waitText(en, 'Secret Santa without an account.');
    if ((await en.$eval('html', (h) => h.lang)) !== 'en') problems.push('Englisch: html lang fehlt');
    await axe(en, 'Start (englisch)');
    await en.goto(`${srv.base}/#datenschutz`); await waitText(en, 'only available in German'); await axe(en, 'Datenschutz mit englischem Hinweis');
  }

  // ---------- Tastatur: Sprunglink und Fokus nach Seitenwechsel
  const k = await newPage();
  await k.goto(`${srv.base}/#hilfe`, { waitUntil: 'networkidle0' });
  // Erstes Laden: Fokus bleibt oben, erster Tab landet auf dem Sprunglink
  await k.keyboard.press('Tab');
  const skip = await k.evaluate(() => ({ id: document.activeElement.id, top: document.activeElement.getBoundingClientRect().top }));
  if (skip.id !== 'skip-link' || skip.top < 0) problems.push(`Sprunglink nicht erstes sichtbares Fokusziel: ${JSON.stringify(skip)}`);
  await k.keyboard.press('Enter');
  const afterSkip = await k.evaluate(() => ({ tag: document.activeElement.tagName, hash: location.hash }));
  if (afterSkip.tag !== 'H1' || afterSkip.hash !== '#hilfe') problems.push(`Sprunglink: ${JSON.stringify(afterSkip)}`);
  await k.evaluate(() => { location.hash = '#datenschutz'; });
  await waitText(k, 'Datenschutzerklärung');
  await k.waitForFunction(() => document.activeElement.tagName === 'H1', { polling: 100 });
  const ann = await k.$eval('#announcer', (e) => e.textContent);
  if (!ann.includes('Datenschutz')) problems.push(`Seitenwechsel nicht angesagt: "${ann}"`);
  // Tabelle per Tastatur erreichbar
  const tableFocusable = await k.$eval('.table-scroll', (e) => e.tabIndex === 0 && e.getAttribute('aria-label') !== null);
  if (!tableFocusable) problems.push('Tabelle nicht fokussierbar');

  // ---------- Fokus bleibt beim Neuzeichnen (Person hinzufügen per Tastatur)
  const f = await newPage();
  await setup(f);
  await f.focus('.add-person input');
  await f.keyboard.type('Dora');
  await f.keyboard.press('Enter');
  await f.waitForFunction(() => [...document.querySelectorAll('.person-name')].some((e) => e.textContent === 'Dora'), { polling: 100 });
  const stay = await f.evaluate(() => document.activeElement.matches('.add-person input'));
  if (!stay) problems.push('Fokus nach „Hinzufügen“ nicht wieder im Namensfeld');

  // ---------- Fehlermeldungen bleiben, Erfolgsmeldungen verschwinden
  await f.evaluate(async () => { const dom = await import('/js/lib/dom.js'); dom.toast('Kurz', 'ok'); dom.toast('Fehler bleibt', 'error'); });
  const roles = await f.evaluate(() => [...document.querySelectorAll('.toast-stack')].map((s) => s.getAttribute('role')));
  if (!roles.includes('alert') || !roles.includes('status')) problems.push(`Meldungsbereiche: ${roles}`);
  await new Promise((r) => setTimeout(r, 7600));
  const left = await f.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.querySelector('.toast-text').textContent));
  if (left.includes('Kurz') || !left.includes('Fehler bleibt')) problems.push(`Meldungen nach 7,6 s: ${left}`);
  await f.evaluate(() => [...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('Fehler bleibt')).querySelector('.toast-close').click());
  await f.waitForFunction(() => ![...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Fehler bleibt')), { polling: 100 });

  // ---------- Formularfehler
  const g = await newPage();
  await g.goto(`${srv.base}/#neu`); await g.waitForSelector('form.form');
  await g.$eval('form.form', (f2) => f2.requestSubmit());
  await g.waitForSelector('#create-errors-msg');
  const inv2 = await g.evaluate(() => ({
    invalid: [...document.querySelectorAll('[aria-invalid="true"]')].map((e) => e.placeholder || e.type),
    active: document.activeElement.getAttribute('aria-invalid'),
    linked: document.activeElement.getAttribute('aria-describedby')?.includes('create-errors-msg'),
    stars: document.querySelectorAll('.req').length,
  }));
  if (inv2.invalid.length < 2 || inv2.active !== 'true' || !inv2.linked || inv2.stars < 3) problems.push(`Formularfehler: ${JSON.stringify(inv2)}`);
  await axe(g, 'Anlegen mit Fehlern');

  // ---------- Umschalter: bleibt nach Neuladen, ohne Aufblitzen; „wie Gerät“ setzt zurück
  const t = await newPage({ scheme: 'light' });
  await t.goto(`${srv.base}/`, { waitUntil: 'networkidle0' });
  const label1 = await t.$eval('#theme-toggle', (b) => b.getAttribute('aria-label'));
  if (label1 !== 'Dunkles Design einschalten') problems.push(`Umschalter-Beschriftung: ${label1}`);
  await t.click('#theme-toggle');
  await t.reload({ waitUntil: 'domcontentloaded' });
  const early = await t.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
  if (early.theme !== 'dark' || early.bg !== 'rgb(17, 22, 18)') problems.push(`Nach Neuladen nicht dunkel: ${JSON.stringify(early)}`);
  const resetVisible = await t.$eval('#theme-reset', (b) => !b.hidden);
  if (!resetVisible) problems.push('„Design wie Gerät“ nicht sichtbar');
  await t.click('#theme-reset');
  const after = await t.evaluate(() => ({ theme: document.documentElement.dataset.theme ?? null, stored: localStorage.getItem('zw.theme'), resetHidden: document.getElementById('theme-reset').hidden }));
  if (after.theme !== null || after.stored !== null || !after.resetHidden) problems.push(`Zurücksetzen: ${JSON.stringify(after)}`);
  // Hell erzwingen bei dunklem Gerät
  const t2 = await newPage({ scheme: 'dark' });
  await t2.goto(`${srv.base}/`, { waitUntil: 'networkidle0' });
  await t2.click('#theme-toggle');
  const forcedLight = await t2.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (forcedLight !== 'rgb(247, 243, 234)') problems.push(`Hell bei dunklem Gerät: ${forcedLight}`);

  // ---------- 320 px und Textabstände
  const z = await newPage({ width: 320 });
  const invZ = await setup(z);
  await noHorizontalScroll(z, 'Verwaltung 320 px');
  await z.evaluate(() => { const st = document.createElement('style'); st.textContent = '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }'; document.head.appendChild(st); });
  await noHorizontalScroll(z, 'Verwaltung 320 px mit Textabständen');
  for (const hash of ['', '#neu', invZ.replace(/^\//, ''), '#datenschutz', '#barrierefreiheit', '#lizenzen', `#backend/${admin.slug}`, '#wuerfel']) {
    await z.goto(`${srv.base}/${hash}`);
    await z.waitForFunction(() => !document.querySelector('#app .loading') && document.querySelector('#app h1, #app .hero, #app .dice-only, #app form'), { timeout: 10000, polling: 100 });
    await new Promise((r) => setTimeout(r, 200));
    await z.evaluate(() => { const st = document.createElement('style'); st.textContent = '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }'; document.head.appendChild(st); });
    await noHorizontalScroll(z, `320 px ${hash || 'Start'}`);
  }

  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Barrierefreiheit ok (${checked} axe-Prüfungen, Tastatur, Meldungen, Formularfehler, Umschalter, 320 px, Textabstände).`);
} catch (e) {
  console.log(`FAIL ${e.stack}\n${problems.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
