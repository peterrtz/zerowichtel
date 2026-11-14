#!/usr/bin/env node
// Prüft, ob eine laufende Installation genau die Dateien eines Releases ausliefert.
//   node bin/verify-release.mjs https://wichteln.example.org [dist/RELEASE.json]
//
// RELEASE.json sollte aus einer vertrauenswürdigen Quelle stammen (Repository/Release), nicht vom geprüften Server.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [base, releasePath = new URL('../dist/RELEASE.json', import.meta.url).pathname] = process.argv.slice(2);
if (!base) {
  console.error('Aufruf: node bin/verify-release.mjs <basis-url> [RELEASE.json]');
  process.exit(2);
}
const release = JSON.parse(readFileSync(releasePath, 'utf8'));
let ok = 0;
let bad = 0;
let skipped = 0;
for (const [file, hash] of Object.entries(release.public)) {
  if (file.startsWith('.')) { skipped++; continue; } // versteckte Dateien (z. B. .well-known) nicht prüfen
  const url = new URL(file, base.replace(/\/?$/, '/')).href;
  try {
    const res = await fetch(url, { cache: 'no-store', redirect: 'error' });
    const buf = Buffer.from(await res.arrayBuffer());
    const got = createHash('sha256').update(buf).digest('hex');
    if (res.ok && got === hash) ok++;
    else { bad++; console.log(`ABWEICHUNG  ${file}  (HTTP ${res.status})`); }
  } catch (e) {
    bad++;
    console.log(`FEHLER      ${file}  ${e.message}`);
  }
}
console.log(`\nZeroWichtel ${release.version}: ${ok} Dateien identisch, ${bad} abweichend, ${skipped} nicht geprüft.`);
process.exit(bad ? 1 : 0);
