// UI-Rauchtest: die echte PWA in jsdom gegen einen echten ZeroWichtel-Server (Node).
// Klickt sich durch Anlegen, Einladen, Annehmen, Zusagen, Wiederherstellen und Löschen.
// Aufruf: node tests/ui/smoke.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { startServer, ROOT } from '../helpers/server.mjs';

const srv = await startServer();
const errors = [];
const vc = new VirtualConsole();
vc.on('error', (e) => errors.push(String(e)));
vc.on('jsdomError', (e) => errors.push(String(e.stack || e)));

const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: `${srv.base}/`, pretendToBeVisual: true, virtualConsole: vc,
  // Oberfläche auf Deutsch (jsdom meldet sonst en-US)
  beforeParse: (w) => Object.defineProperty(w.navigator, 'languages', { value: ['de-DE'] }),
});
const w = dom.window;
for (const k of ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'Node', 'Event', 'HashChangeEvent', 'HTMLElement', 'DocumentFragment']) {
  Object.defineProperty(globalThis, k, { value: w[k] ?? w, configurable: true, writable: true });
}
globalThis.window = w;
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
w.confirm = globalThis.confirm = () => true;
w.prompt = globalThis.prompt = (_m, d) => d;
w.print = () => {};
w.scrollTo = () => {};

const { configure } = await import('../../public/js/lib/api.js');
configure({ apiBase: `${srv.base}/api` });
await import('../../public/js/app.js');

const $ = (sel) => w.document.querySelector(sel);
const $$ = (sel) => [...w.document.querySelectorAll(sel)];
const text = () => w.document.getElementById('app').textContent;
async function until(pred, what, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Zeitüberschreitung: ${what}\nSeite: ${text().slice(0, 400)}`);
}
const button = (label) => $$('button, a').find((b) => b.textContent.trim() === label);
const setHash = (h) => { w.location.hash = h; };
let n = 0;
async function step(name, fn) {
  await fn();
  n++;
  console.log(`ok   ${name}`);
}

try {
  const code = srv.organizerCode();
  let adminFrag, recoveryCode, personFrag;

  await step('Startseite', async () => {
    await until(() => text().includes('Wichteln ohne Konto'), 'Startseite');
  });

  await step('Runde anlegen über das Formular', async () => {
    setHash('#neu');
    await until(() => $('form.form'), 'Formular');
    $('input[placeholder^="ZW-"]').value = code;
    $('input[placeholder^="z. B. Familien"]').value = 'Weihnachten bei Müllers';
    $('textarea').value = '**Hallo** ihr Lieben!\n- Bitte <b>nett</b> sein';
    $('form.form').requestSubmit();
    await until(() => w.location.hash.startsWith('#a/') && text().includes('Admin-Link sichern'), 'Admin-Ansicht');
    adminFrag = w.location.hash;
    const strong = $$('.md strong').find((s) => s.textContent === 'Hallo');
    assert.ok(strong, 'Markdown fett gerendert');
    assert.ok(text().includes('<b>nett</b>'), 'HTML bleibt Text');
    assert.equal($$('.md b').length, 0, 'kein HTML-Element erzeugt');
  });

  await step('Personen hinzufügen', async () => {
    for (const name of ['Anna', 'Ben']) {
      $('.add-person input').value = name;
      $('.add-person').requestSubmit();
      await until(() => $$('.person-name').some((e) => e.textContent === name), `Person ${name}`);
    }
    assert.ok(text().includes('Einladung offen'));
    assert.ok(text().includes('Teilnehmende (2/50)'));
  });

  await step('Admin-Link als gesichert markieren', async () => {
    button('Erledigt, ich habe den Link gesichert').click();
    await until(() => text().includes('Teilnehmende (2/50)') && !text().includes('Zuerst: Admin-Link sichern'), 'Hinweis verschwindet');
  });

  await step('Eigene Einladung öffnen und annehmen', async () => {
    const anna = $$('.person').find((li) => li.querySelector('.person-name').textContent === 'Anna');
    const open = [...anna.querySelectorAll('a')].find((a) => a.textContent === 'Selbst hier öffnen');
    setHash(open.getAttribute('href'));
    await until(() => text().includes('Hallo Anna! Du bist eingeladen.'), 'Einladung');
    button('Einladung annehmen').click();
    await until(() => w.location.hash.startsWith('#p/') && text().includes('Zuerst: Zugang sichern'), 'Personenansicht');
    personFrag = w.location.hash;
    recoveryCode = $('.recovery-code').textContent;
    assert.match(recoveryCode, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    assert.ok($('svg.qr path').getAttribute('d').length > 100, 'QR-Code gezeichnet');
  });

  await step('Zusagen', async () => {
    button('Ich bin dabei').click();
    await until(() => text().includes('Deine Antwort: dabei'), 'Antwort');
    assert.ok(text().includes('1 von 2 dabei'));
  });

  await step('Admin sieht Status', async () => {
    setHash(adminFrag);
    await until(() => text().includes('1 angenommen') && text().includes('1 dabei'), 'Status');
  });

  await step('Startseite listet beide Rollen', async () => {
    setHash('');
    await until(() => $$('.round-link').length === 2, 'Liste');
    assert.ok(text().includes('Organisation') && text().includes('Teilnahme'));
  });

  await step('Wiederherstellen per Code', async () => {
    setHash('#wiederherstellen/' + recoveryCode.replace(/-/g, ''));
    await until(() => $('form.form input'), 'Formular');
    assert.equal($('form.form input').value, recoveryCode.replace(/-/g, ''));
    $('form.form').requestSubmit();
    await until(() => w.location.hash.startsWith('#p/') && w.location.hash !== personFrag && text().includes('Hallo Anna!'), 'wiederhergestellt');
  });

  await step('Runde löschen', async () => {
    setHash(adminFrag);
    await until(() => text().includes('Runde beenden und löschen'), 'Admin');
    const det = $('details.card-danger');
    det.querySelector('input').value = 'Weihnachten bei Müllers';
    button('Runde beenden und endgültig löschen').click();
    await until(() => text().includes('Wichteln ohne Konto'), 'zurück zur Startseite');
    assert.equal(JSON.parse(srv.sql('SELECT COUNT(*) AS c FROM rounds'))[0].c, 0);
  });

  await step('Gelöschter Personen-Link zeigt Hinweis', async () => {
    setHash(personFrag);
    await until(() => text().includes('nicht mehr gültig'), 'Hinweis');
  });

  await step('Keine innerHTML-Nutzung im Quelltext, keine Konsolenfehler', async () => {
    const { execSync } = await import('node:child_process');
    const hits = execSync(`grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\\.write|eval\\(|new Function" ${join(ROOT, 'public/js')} --include=*.js --include=*.mjs || true`)
      .toString().split('\n').filter((l) => l && !/^[^:]+:\d+:\s*(\/\/|\/\*|\*)/.test(l));
    assert.deepEqual(hits, []);
    assert.deepEqual(errors, []);
  });

  console.log(`\n${n} Schritte, 0 Fehler`);
} catch (e) {
  console.log(`FAIL\n${e.stack}\n\nKonsole:\n${errors.join('\n')}\nServer:\n${srv.log().slice(-1500)}`);
  process.exitCode = 1;
} finally {
  srv.stop();
  w.close();
}
