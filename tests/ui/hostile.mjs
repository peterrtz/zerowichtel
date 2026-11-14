// Feindliche Inhalte von anderen Teilnehmenden dürfen die Ansicht weder kapern noch zum Absturz bringen.
//   node tests/ui/hostile.mjs
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://zw.example/' });
for (const k of ['window', 'document', 'Node', 'location', 'sessionStorage', 'localStorage']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k] ?? dom.window, configurable: true, writable: true });
}
localStorage.setItem('zw.lang', 'de'); // Oberfläche auf Deutsch, unabhängig von der Sprache des Rechners
const { wishView } = await import('../../public/js/views/person-draw.js');
const { md } = await import('../../public/js/views/common.js');
const { rulesView } = await import('../../public/js/views/rules-editor.js');

const evil = {
  v: 1,
  noIdea: false,
  profile: { size: '<script>alert(1)</script>', likes: '"><img src=x onerror=alert(2)>', __proto__x: 'x' },
  items: [
    { text: '<img src=x onerror=alert(1)> **fett**', link: 'javascript:alert(1)' },
    { text: 'protokollrelativ', link: '//evil.example/x' },
    { text: 'mit Zugangsdaten', link: 'https://user:pw@evil.example/' },
    { text: 'data', link: 'data:text/html,<script>alert(1)</script>' },
    { text: 'gut', link: 'https://example.org/buch' },
  ],
  noGo: '<script>alert(2)</script>',
  updatedAt: Date.now(),
};
const el = wishView(evil);
document.body.appendChild(el);
assert.equal(document.querySelectorAll('img, script').length, 0, 'kein HTML aus Inhalten');
const links = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
assert.deepEqual(links, ['https://example.org/buch'], 'nur der sichere Link bleibt');
assert.equal(document.querySelector('a').getAttribute('rel'), 'noopener noreferrer nofollow');
assert.ok(document.body.textContent.includes('<script>alert(2)</script>'), 'als Text sichtbar');

// Kaputte oder fremde Regeln in Metadaten fallen auf die Standardregeln zurück
const rv = rulesView({ dice: 9, phases: [{ name: '<b>x</b>', actions: { 6: 'rm -rf' } }] });
assert.ok(rv.textContent.includes('Päckchen aus der Mitte nehmen'));
assert.equal(md('<iframe src="https://evil.example">').querySelectorAll('iframe').length, 0);

console.log('Feindliche Inhalte: ok');
