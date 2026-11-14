// Sammelt alle Übersetzungsschlüssel: t('…') und tn(n, '…', '…') im Frontend, dazu Texte, die nur über Variablen
// in t() landen (EXTRA), und die Fehlermeldungen des Servers (werden im Browser übersetzt).
// Aufruf: node bin/i18n-keys.mjs [--missing]   (--missing: nur Schlüssel ohne englischen Eintrag)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'vendor') walk(p, out); } else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

const LIT = String.raw`'((?:[^'\\\n]|\\.)*)'`;
const unescape = (s) => JSON.parse(`"${s.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);

/** Texte, die über Tabellen in t() gelangen. */
export const EXTRA = [
  'Wichteln', 'Schrottwichteln', 'dabei', 'raus', 'keine Antwort', 'Tipp', 'Auflösung', 'Dankeschön',
  'Kleidergröße', 'Schuhgröße', 'Lieblingsfarben', 'Mag ich', 'Allergien und Unverträglichkeiten',
];

export function frontendKeys() {
  const keys = new Map();
  for (const file of walk(join(root, 'public/js'))) {
    if (file.endsWith('/en.js')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.])t\(` + LIT, 'g'))) keys.set(unescape(m[1]), file);
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.])tn\([^,]+,\s*` + LIT + String.raw`,\s*` + LIT, 'g'))) {
      keys.set(unescape(m[1]), file);
      keys.set(unescape(m[2]), file);
    }
  }
  for (const k of EXTRA) keys.set(k, 'EXTRA');
  // Feste Texte in index.html (data-i18n, data-i18n-label, data-i18n-title)
  const html = readFileSync(join(root, 'public/index.html'), 'utf8');
  for (const m of html.matchAll(/<\w+[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]+)</g)) if (m[1].trim()) keys.set(m[1], 'index.html');
  for (const m of html.matchAll(/<[^>]*\saria-label="([^"]+)"[^>]*\sdata-i18n-label[^>]*>/g)) keys.set(m[1], 'index.html');
  for (const m of html.matchAll(/<[^>]*\stitle="([^"]+)"[^>]*\sdata-i18n-title[^>]*>/g)) keys.set(m[1], 'index.html');
  return keys;
}

/** Feste Fehlermeldungen des Servers (HttpError, fail, closed) – nur reine Literale. */
export function serverKeys() {
  const keys = new Map();
  for (const f of ['server/app.mjs', 'server/validate.mjs', 'server/ratelimit.mjs', 'server/http.mjs']) {
    let src;
    try { src = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(new RegExp(String.raw`(?:HttpError\(\s*\d+,\s*'[\w-]+',\s*|closed\(|deny\(|err\(|\?\? |(?:gezogen|beendet): )` + LIT, 'g'))) {
      if (/[A-ZÄÖÜ]/.test(m[1][0]) && m[1].includes(' ')) keys.set(unescape(m[1]), f);
    }
  }
  return keys;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { EN } = await import('../public/js/lib/en.js');
  const all = new Map([...frontendKeys(), ...serverKeys()]);
  const missing = process.argv.includes('--missing');
  for (const [k, f] of all) if (!missing || !(k in EN)) console.log(JSON.stringify(k), '//', f.replace(root + '/', ''));
  console.error(`${all.size} Schlüssel, ${[...all.keys()].filter((k) => !(k in EN)).length} ohne Übersetzung`);
}
