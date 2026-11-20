// Browser-Durchlauf 2.13: Adventsalbum – Einschalten durch die Organisator:in, Hochladen (großes JPEG mit GPS-Daten,
// PNG mit Transparenz, falsches HEIC), Verkleinerung und WebP, Metadaten entfernt, nur für Zusagende sichtbar,
// fremde Daten statt Foto werden nicht angezeigt, Löschen, PDF-Erinnerungsalbum (pdfinfo, qpdf, pdfimages).
//   CHROME_PATH=… SHOTS=… node tests/browser/walkthrough-31.mjs
import { deutsch } from './lang.mjs';
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  if (el) await el.screenshot({ path: join(SHOTS, `v31-card-${name}.png`) });
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
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const DL = mkdtempSync(join(tmpdir(), 'zw31-dl-'));

try {
  const admin = await newPage();
  const names = ['Anna', 'Benedikt', 'Cleo'];
  let invites = {};
  let roundId = '';
  const pages = {};

  await step('Runde anlegen, drei einladen; Anna und Benedikt sagen zu, Cleo noch nicht', async () => {
    await admin.goto(`${srv.base}/#neu`);
    await admin.waitForSelector('form.form');
    await admin.type('input[placeholder^="ZW-"]', srv.organizerCode());
    await admin.type('input[placeholder^="z. B. Familien"]', 'Adventsrunde');
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
    for (const name of ['Anna', 'Benedikt']) {
      pages[name] = await newPage();
      await accept(pages[name], `${srv.base}/${invites[name]}`, name);
    }
    pages.Cleo = await newPage();
    await pages.Cleo.goto(`${srv.base}/${invites.Cleo}`);
    await waitText(pages.Cleo, 'Hallo Cleo!');
    await clickText(pages.Cleo, 'Einladung annehmen');
    await waitText(pages.Cleo, 'Zuerst: Zugang sichern');
    await clickText(pages.Cleo, 'Erledigt, ich habe Link und Code gesichert');
    await waitText(pages.Cleo, 'Bist du dabei?');
  });

  await step('Ohne Einschalten kein Album; Organisator:in schaltet Album und PDF ein', async () => {
    const a = pages.Anna;
    await a.bringToFront();
    await a.reload();
    await waitText(a, 'Deine Antwort:');
    if (await a.$('#adventsalbum')) problems.push('Album ohne Einschalten sichtbar');
    await admin.bringToFront();
    await admin.evaluate(() => { document.getElementById('adventsalbum-admin').open = true; });
    await admin.click('#album-on');
    await admin.click('#album-pdf');
    await clickText(admin, 'Speichern', '#adventsalbum-admin');
    await waitText(admin, 'Gespeichert.');
    const r = JSON.parse(srv.sql(`SELECT album_mode, album_pdf FROM rounds WHERE id = '${roundId}'`))[0];
    if (r.album_mode !== 1 || r.album_pdf !== 1) problems.push(`Schalter: ${JSON.stringify(r)}`);
  });

  const upload = async (page, file, caption) => {
    const input = await page.$('#album-file');
    await input.uploadFile(join(FIX, file));
    await page.waitForFunction(() => document.querySelector('#adventsalbum .album-stage')?.textContent.length > 0, { timeout: 15000 });
    await page.waitForFunction(() => /Hochladen|nicht|lässt sich/.test(document.querySelector('#adventsalbum .album-stage').textContent), { timeout: 20000 });
    if (caption === null) return page.$eval('#adventsalbum .album-stage', (e) => e.textContent);
    const info = await page.$eval('#adventsalbum .album-preview .hint', (e) => e.textContent);
    if (caption) await page.type('#album-caption', caption);
    await clickText(page, 'Hochladen', '#adventsalbum');
    await waitText(page, 'Foto geteilt.');
    return info;
  };

  await step('Anna lädt ein großes JPEG mit Kamera- und GPS-Daten hoch: verkleinert, WebP, Metadaten weg', async () => {
    const a = pages.Anna;
    await a.bringToFront();
    await a.reload();
    await waitText(a, 'Adventsalbum');
    await waitText(a, 'Noch keine Fotos.');
    const orig = readFileSync(join(FIX, 'advent-gps.jpg'));
    if (!orig.includes('ZWTestKamera')) problems.push('Testbild ohne Kameradaten');
    const info = await upload(a, 'advent-gps.jpg', 'Erste Plätzchen 🍪⭐');
    if (!/1600 × 1067 Pixel/.test(info)) problems.push(`Größe: ${info}`);
    await a.waitForSelector('#adventsalbum .album-thumb img', { timeout: 10000 });
    await a.click('#adventsalbum .album-thumb');
    await a.waitForFunction(() => document.querySelector('dialog.album-viewer img')?.src.startsWith('blob:'), { timeout: 10000 });
    const full = await a.evaluate(async () => {
      const img = document.querySelector('dialog.album-viewer img');
      await img.decode();
      const b = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
      const txt = new TextDecoder('latin1').decode(b);
      return { head: txt.slice(0, 4) + txt.slice(8, 12), size: b.length, exif: /Exif|ZWTestKamera|GPS/.test(txt), w: img.naturalWidth, h: img.naturalHeight };
    });
    if (full.head !== 'RIFFWEBP') problems.push(`Kein WebP: ${full.head}`);
    if (full.exif) problems.push('Metadaten im hochgeladenen Foto');
    if (full.w !== 1600 || full.h !== 1067) problems.push(`Abmessungen: ${full.w}×${full.h}`);
    if (full.size > 600 * 1024) problems.push(`Zu groß: ${full.size}`);
    await waitText(a, 'Erste Plätzchen 🍪⭐');
    await shotCard(a, 'Erste Plätzchen', 'viewer');
    await axe(a, 'Großansicht');
    await a.keyboard.press('Escape');
    const stored = JSON.parse(srv.sql('SELECT bytes, length(photo) AS p, length(thumb) AS t, meta_ct FROM photos'))[0];
    if (stored.p > 600 * 1024 + 28 || stored.t > 48 * 1024 + 28) problems.push(`Gespeichert: ${JSON.stringify(stored)}`);
    const dump = srv.sql('SELECT hex(photo) AS x FROM photos');
    if (/5A5754657374/.test(dump)) problems.push('Klartext-Kameraname in der Datenbank');
    if (/Plätzchen/.test(srv.sql('SELECT meta_ct FROM photos'))) problems.push('Bildunterschrift im Klartext');
  });

  await step('Zuschneiden (2.13.1): Quadrat, Ziehen mit der Maus, Tastatur, Ganzes Bild; Abbrechen lädt nichts hoch', async () => {
    const a = pages.Anna;
    await a.bringToFront();
    const n0 = JSON.parse(srv.sql('SELECT COUNT(*) AS n FROM photos'))[0].n;
    const input = await a.$('#album-file');
    await input.uploadFile(join(FIX, 'advent-gps.jpg'));
    await a.waitForFunction(() => /Hochladen/.test(document.querySelector('#adventsalbum .album-stage')?.textContent ?? ''), { timeout: 20000 });
    await clickText(a, 'Zuschneiden', '#adventsalbum');
    await a.waitForSelector('#adventsalbum .crop-rect');
    const sizeText = () => a.$eval('#adventsalbum .crop-size', (e) => e.textContent);
    if (!/3000 × 2000 Pixel von 3000 × 2000/.test(await sizeText())) problems.push(`Start: ${await sizeText()}`);
    // Quadrat
    await a.evaluate(() => [...document.querySelectorAll('#adventsalbum .crop-aspect')].find((l) => l.textContent.includes('Quadrat')).querySelector('input').click());
    if (!/2000 × 2000 Pixel/.test(await sizeText())) problems.push(`Quadrat: ${await sizeText()}`);
    // Mit der Maus die rechte untere Ecke nach innen ziehen
    const hd = await a.$('#adventsalbum .crop-se');
    const bb = await hd.boundingBox();
    await a.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await a.mouse.down();
    await a.mouse.move(bb.x - 80, bb.y - 60, { steps: 5 });
    await a.mouse.up();
    const dragged = await sizeText();
    const m = /(\d+) × (\d+) Pixel von/.exec(dragged);
    if (!m || Number(m[1]) >= 2000 || m[1] !== m[2]) problems.push(`Ziehen (quadratisch, kleiner): ${dragged}`);
    // Tastatur: verkleinern und verschieben
    await a.focus('#adventsalbum .crop-rect');
    await a.keyboard.press('Minus');
    await a.keyboard.press('ArrowLeft');
    const keyed = /(\d+) × (\d+) Pixel von/.exec(await sizeText());
    if (!keyed || Number(keyed[1]) >= Number(m?.[1] ?? 0) || keyed[1] !== keyed[2]) problems.push(`Tastatur: ${await sizeText()}`);
    await axe(a, 'Zuschneiden');
    await shotCard(a, 'Seitenverhältnis', 'zuschneiden');
    // Ganzes Bild (bei Quadrat: größtes Quadrat) und übernehmen → 1600 × 1600
    await clickText(a, 'Ganzes Bild', '#adventsalbum');
    if (!/2000 × 2000 Pixel/.test(await sizeText())) problems.push(`Ganzes Bild (quadratisch): ${await sizeText()}`);
    await clickText(a, 'Zuschnitt übernehmen', '#adventsalbum');
    await waitText(a, 'Zuschnitt übernommen.');
    const info = await a.$eval('#adventsalbum .album-preview .hint', (e) => e.textContent);
    if (!/1600 × 1600 Pixel/.test(info)) problems.push(`Nach dem Zuschnitt: ${info}`);
    if (await a.$eval('#adventsalbum .crop-panel', (e) => !e.hidden)) problems.push('Zuschnitt-Bereich bleibt offen');
    // Abbrechen: nichts hochgeladen
    await a.evaluate(() => [...document.querySelectorAll('#adventsalbum .album-preview button')].find((b) => b.textContent === 'Abbrechen').click());
    await a.waitForFunction(() => !document.querySelector('#adventsalbum .album-preview'), { timeout: 5000 });
    const n1 = JSON.parse(srv.sql('SELECT COUNT(*) AS n FROM photos'))[0].n;
    if (n1 !== n0) problems.push(`Abbrechen hat hochgeladen (${n0} → ${n1})`);
  });

  await step('Benedikt: PNG im Hochformat mit Transparenz; falsches HEIC wird verständlich abgelehnt', async () => {
    const b = pages.Benedikt;
    await b.bringToFront();
    await b.reload();
    await waitText(b, 'Adventsalbum');
    const msg = await upload(b, 'fake.heic', null);
    if (!/HEIC-Foto kann dein Browser nicht lesen/.test(msg)) problems.push(`HEIC-Meldung: ${msg}`);
    const info = await upload(b, 'kerze.png', 'Die erste Kerze');
    if (!/1067 × 1600 Pixel/.test(info)) problems.push(`PNG-Größe: ${info}`);
    await b.waitForFunction(() => document.querySelectorAll('#adventsalbum .album-thumb img').length === 2, { timeout: 10000 });
    const caps = await b.$$eval('#adventsalbum .album-cap', (c) => c.map((x) => x.textContent));
    if (!caps.some((c) => c.includes('Die erste Kerze') && c.includes('Benedikt')) || !caps.some((c) => c.includes('Anna'))) problems.push(`Bildunterschriften: ${caps}`);
    // Benedikt darf Annas Foto nicht löschen, das eigene schon
    await b.evaluate(() => [...document.querySelectorAll('#adventsalbum .album-thumb')].find((x) => x.getAttribute('aria-label').includes('Anna')).click());
    await b.waitForSelector('dialog.album-viewer');
    if (await b.evaluate(() => [...document.querySelectorAll('dialog.album-viewer button')].some((x) => x.textContent === 'Foto löschen'))) problems.push('Fremdes Foto löschbar');
    await b.keyboard.press('Escape');
    await shotCard(b, 'Adventsalbum', 'album');
    await axe(b, 'Adventsalbum');
  });

  await step('Cleo hat noch nicht zugesagt: sieht nur den Hinweis, keine Fotos', async () => {
    const c = pages.Cleo;
    await c.bringToFront();
    await c.reload();
    await waitText(c, 'Das Adventsalbum der Runde sehen alle, die zugesagt haben.');
    if (await c.$('#adventsalbum .album-thumb')) problems.push('Cleo sieht Fotos');
  });

  await step('Fremde Daten, Bildbombe und falscher Name (direkt über die Schnittstelle): abgewiesen bzw. echter Name', async () => {
    const a = pages.Anna;
    await a.bringToFront();
    const bomb = readFileSync(join(FIX, 'bildbombe.webp')).toString('base64');
    const small = readFileSync(join(FIX, '..', '..', 'js', 'images.fixture.mjs'), 'utf8').match(/"jpeg": "([^"]+)"/)[1];
    const res = await a.evaluate(async (hash, bombB64, smallB64) => {
      const { parseFragment } = await import('/js/lib/links.js');
      const C = await import('/js/lib/crypto.js');
      const P = await import('/js/lib/photos.js');
      const { api } = await import('/js/lib/api.js');
      const ctx = parseFragment(hash);
      const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const post = async (photo, thumb, meta) => {
        const id = C.newId();
        await api('POST', '/me/photos', {
          auth: `p.${ctx.pid}.${ctx.accessToken}`,
          body: {
            id,
            photoCt: await C.encryptBytes(ctx.kRound, photo, P.AAD.photo(ctx.roundId, id)),
            thumbCt: await C.encryptBytes(ctx.kRound, thumb, P.AAD.thumb(ctx.roundId, id)),
            metaCt: await C.encryptJson(ctx.kRound, { v: 1, name: 'Anna', ...meta }, P.AAD.meta(ctx.roundId, id)),
          },
        });
      };
      const junk = new TextEncoder().encode('<script>alert(1)</script>'.repeat(20));
      await post(junk, junk, { caption: 'Kein Bild' });
      // 5,5 KB, aber 12000 × 12000 Pixel: würde ausgepackt rund 576 MB belegen
      await post(bytes(bombB64), bytes(bombB64), { caption: 'Bildbombe' });
      // gültiges Bild, aber als „Benedikt“ ausgegeben
      await post(bytes(smallB64), bytes(smallB64), { caption: 'Gefälscht', name: 'Benedikt' });
      return Object.keys(ctx);
    }, await a.evaluate(() => location.hash), bomb, small);
    if (!res.includes('kRound')) problems.push(`Link-Kontext: ${res}`);
    await a.reload();
    await a.waitForFunction(() => document.querySelectorAll('#adventsalbum .album-thumb').length === 5, { timeout: 10000 });
    const broken = await a.$$eval('#adventsalbum .album-thumb', (b) => b.filter((x) => x.querySelector('.album-broken')).length);
    if (broken !== 2) problems.push(`Unlesbare Datei und Bildbombe nicht als unlesbar markiert (${broken} statt 2)`);
    const imgs = await a.$$eval('#adventsalbum .album-thumb img', (i) => i.length);
    if (imgs !== 3) problems.push(`${imgs} Bilder angezeigt statt 3`);
    const fake = await a.$$eval('#adventsalbum .album-cap', (c) => c.map((x) => x.textContent).find((x) => x.includes('Gefälscht')));
    if (!fake || !fake.includes('Anna') || fake.includes('Benedikt')) problems.push(`Falscher Name übernommen: ${fake}`);
  });

  await step('Organisator:in sieht alle Fotos mit Namen, löscht ein Foto, die unlesbaren Dateien und die Fälschung', async () => {
    await admin.bringToFront();
    await admin.reload();
    await waitText(admin, 'Teilnehmende');
    await admin.evaluate(() => { document.getElementById('adventsalbum-admin').open = true; });
    await admin.waitForFunction(() => document.querySelectorAll('#adventsalbum-admin .album-thumb').length === 5, { timeout: 10000 });
    for (const who of ['Benedikt', 'Gefälscht']) {
      const n0 = await admin.$$eval('#adventsalbum-admin .album-thumb', (x) => x.length);
      await admin.evaluate((w) => [...document.querySelectorAll('#adventsalbum-admin .album-thumb')].find((x) => x.getAttribute('aria-label').includes(w)).click(), who);
      await admin.waitForSelector('dialog.album-viewer');
      // Bestätigungsdialoge nimmt newPage() automatisch an
      await admin.evaluate(() => [...document.querySelectorAll('dialog.album-viewer button')].find((x) => x.textContent === 'Foto löschen').click());
      await admin.waitForFunction((n) => document.querySelectorAll('#adventsalbum-admin .album-thumb').length === n - 1, { timeout: 10000 }, n0);
    }
    for (let k = 0; k < 2; k++) {
      const n0 = await admin.$$eval('#adventsalbum-admin .album-thumb', (x) => x.length);
      await admin.evaluate(() => document.querySelector('#adventsalbum-admin .album-thumb .album-broken').closest('button').click());
      await admin.waitForFunction((n) => document.querySelectorAll('#adventsalbum-admin .album-thumb').length === n - 1, { timeout: 10000 }, n0);
    }
    const n = JSON.parse(srv.sql('SELECT COUNT(*) AS n FROM photos'))[0].n;
    if (n !== 1) problems.push(`${n} Fotos nach dem Löschen`);
  });

  await step('Nach der Bescherung: weitere Fotos; PDF-Dialog mit 5 Layouts, 5 Designs, Hoch/Quer, Titelblatt', async () => {
    srv.sql(`UPDATE rounds SET event_date = strftime('%s','now') - 3600 WHERE id = '${roundId}'`);
    // Hochladen geht nach der Bescherung weiter
    const b = pages.Benedikt;
    await b.bringToFront();
    await b.reload();
    await waitText(b, 'Adventsalbum');
    await upload(b, 'kerze.png', 'Nach der Bescherung');
    const a = pages.Anna;
    await a.bringToFront();
    await a.reload();
    await waitText(a, 'Adventsalbum');
    for (const c of ['Weihnachtsmarkt mit Reibekuchen', 'Kinderpunsch 🧃 am Stand', 'Zweiter Advent – Kerzen an 🕯️🕯️']) await upload(a, 'advent-gps.jpg', c);
    await a.reload();
    await waitText(a, 'Erinnerungsalbum als PDF');
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, ...(a.browserContext().id ? { browserContextId: a.browserContext().id } : {}) });
    const runs = [
      // [Layout, Design, Format, Titel, Text, Titelfoto, erwartete Seiten]
      ['gross', 'winter', 'hoch', '', '', 'first', 1 + 5],
      ['zwei', 'tanne', 'quer', 'Unser Advent', 'Danke für die schönen Momente! 🎄', 'first', 1 + 3],
      ['raster', 'nacht', 'hoch', '', '', 'none', 1 + 2],
      ['polaroid', 'lebkuchen', 'quer', 'Plätzchen & Punsch', '', 'first', 1 + 3],
      ['tagebuch', 'schlicht', 'hoch', '', 'Ein Jahr, viele Lichter.', 'first', null],
    ];
    for (const [n, [layout, design, format, title, text, coverPhoto, want]] of runs.entries()) {
      await clickText(a, 'Erinnerungsalbum als PDF', '#adventsalbum');
      await a.waitForSelector('dialog.pdf-dialog[open]');
      if (n === 0) {
        const counts = await a.evaluate(() => ['pdf-layout', 'pdf-design', 'pdf-format'].map((x) => document.querySelectorAll(`input[name="${x}"]`).length));
        if (counts.join() !== '5,5,2') problems.push(`Auswahl im Dialog: ${counts}`);
        await axe(a, 'PDF-Dialog');
        if (SHOTS) await (await a.$('dialog.pdf-dialog')).screenshot({ path: join(SHOTS, 'v31-pdf-dialog.png') });
      }
      await a.evaluate((o) => {
        for (const [name, v] of [['pdf-layout', o.layout], ['pdf-design', o.design], ['pdf-format', o.format]]) document.querySelector(`input[name="${name}"][value="${v}"]`).checked = true;
        document.getElementById('pdf-title').value = o.title;
        document.getElementById('pdf-text').value = o.text;
        document.getElementById('pdf-cover').value = o.coverPhoto;
      }, { layout, design, format, title, text, coverPhoto });
      const before = new Set(readdirSync(DL));
      // Ab dem zweiten Album: Chrome fragt bei mehreren automatischen Downloads nach. Deshalb wird der Blob
      // im Test direkt abgegriffen (der erste Durchlauf prüft den echten Download).
      if (n === 1) {
        await a.evaluate(() => {
          HTMLAnchorElement.prototype.click = function () {
            if (!this.download) return;
            fetch(this.href).then((r) => r.arrayBuffer()).then((buf) => { window.__pdf = { name: this.download, b64: btoa(Array.from(new Uint8Array(buf), (c) => String.fromCharCode(c)).join('')) }; });
          };
        });
      }
      await a.evaluate(() => { window.__pdf = null; });
      await a.evaluate(() => [...document.querySelectorAll('dialog.pdf-dialog button')].find((x) => x.textContent === 'PDF erstellen').click());
      let file = null;
      for (let i = 0; i < 150 && !file; i++) {
        await new Promise((r) => setTimeout(r, 200));
        file = readdirSync(DL).find((f) => f.endsWith('.pdf') && !before.has(f));
        if (!file && n >= 1) {
          const got = await a.evaluate(() => window.__pdf);
          if (got) {
            file = got.name;
            writeFileSync(join(DL, file), Buffer.from(got.b64, 'base64'));
          }
        }
      }
      await a.evaluate(() => document.querySelector('dialog.pdf-dialog')?.close());
      if (!file) { problems.push(`${layout}: keine PDF heruntergeladen ${await a.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | '))}`); continue; }
      const path = join(DL, file);
      const renamed = join(DL, `run${n}-${layout}.pdf`);
      execFileSync('mv', [path, renamed]);
      const info = execFileSync('pdfinfo', [renamed]).toString();
      const pagesN = Number(/Pages:\s+(\d+)/.exec(info)[1]);
      if (want !== null && pagesN !== want) problems.push(`${layout}: ${pagesN} Seiten statt ${want}`);
      if (layout === 'tagebuch' && pagesN < 2) problems.push(`tagebuch: nur ${pagesN} Seiten`);
      const size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
      const quer = Number(size[1]) > Number(size[2]);
      if (quer !== (format === 'quer')) problems.push(`${layout}: Format ${size[0]}`);
      try { execFileSync('qpdf', ['--check', renamed]); } catch (e) { problems.push(`${layout} qpdf: ${e.stdout}`); }
      const imgs = execFileSync('pdfimages', ['-list', renamed]).toString().trim().split('\n').slice(2);
      const jpegs = imgs.filter((l) => /\sjpeg\s/.test(l)).length;
      // pdfimages zählt jede Verwendung: das Titelfoto ist ein zweites Mal eingesetzt (dasselbe Bildobjekt)
      const wantJpegs = 5 + (coverPhoto === 'none' ? 0 : 1);
      if (jpegs !== wantJpegs) problems.push(`${layout}: ${jpegs} JPEG-Verwendungen statt ${wantJpegs}`);
      const objs = new Set(imgs.filter((l) => /\sjpeg\s/.test(l)).map((l) => l.trim().split(/\s+/).slice(10, 12).join(' ')));
      if (objs.size !== 5) problems.push(`${layout}: ${objs.size} JPEG-Objekte statt 5`);
      if (/<script>/.test(readFileSync(renamed, 'latin1'))) problems.push(`${layout}: fremde Bytes in der PDF`);
      if (title && !info.includes(`Title:           ${title} – Adventsrunde`)) problems.push(`${layout}: Titel ${/Title:.*/.exec(info)}`);
      if (SHOTS) execFileSync('pdftoppm', ['-r', '36', '-png', '-f', '1', '-l', '2', renamed, join(SHOTS, `v31-pdf-${n}-${layout}`)]);
    }
    // Auswahl bleibt im Browser gespeichert
    const pref = await a.evaluate((r) => localStorage.getItem(`zw.albumPdf.${r}`), roundId);
    if (!pref || !pref.includes('"layout":"tagebuch"')) problems.push(`Gespeicherte Auswahl: ${pref}`);
  });

  await step('Album ausschalten: Teilnehmende sehen nichts mehr, Fotos bleiben gespeichert', async () => {
    await admin.bringToFront();
    await admin.reload();
    await waitText(admin, 'Teilnehmende');
    await admin.evaluate(() => { document.getElementById('adventsalbum-admin').open = true; });
    await admin.click('#album-on');
    await clickText(admin, 'Speichern', '#adventsalbum-admin');
    await waitText(admin, 'Gespeichert.');
    const a = pages.Anna;
    await a.bringToFront();
    await a.reload();
    await waitText(a, 'Deine Antwort:');
    if (await a.$('#adventsalbum')) problems.push('Album nach dem Ausschalten sichtbar');
    const n = JSON.parse(srv.sql('SELECT COUNT(*) AS n FROM photos'))[0].n;
    if (n !== 5) problems.push(`${n} Fotos nach dem Ausschalten`);
  });
} catch (e) {
  problems.push(`Abbruch: ${e.stack || e.message}`);
} finally {
  await browser.close();
  srv.stop();
  rmSync(DL, { recursive: true, force: true });
}

if (problems.length) {
  console.log(`\n${problems.length} Problem(e):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`\n${steps} Schritte ohne Probleme (${axeChecks} axe-Prüfungen).`);
