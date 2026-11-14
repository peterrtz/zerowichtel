#!/usr/bin/env node
// ZeroWichtel – Release bauen.
//   node bin/release.mjs
//
// Arbeitet auf einer Kopie in dist/stage – der Quellcode bleibt unverändert.
// 1. Service Worker: Cache-Version aus Versionsnummer und Inhalts-Prüfsumme
// 2. index.html: Subresource-Integrity (sha384) für Stylesheet und Einstiegsskript
// 3. RELEASE.json: SHA-256 jeder ausgelieferten Datei (zum Nachprüfen einer Installation)
// 4. dist/zerowichtel-<version>.zip: installierbares Paket ohne Tests und Entwicklungsdateien
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, 'stage');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const item of ['public', 'server', 'docs', 'deploy', 'config.example.json', 'package.json', 'LICENSE', 'README.md', 'CHANGELOG.md']) {
  cpSync(join(ROOT, item), join(STAGE, item), { recursive: true });
}
const PUB = join(STAGE, 'public');
const version = readFileSync(join(ROOT, 'server/app.mjs'), 'utf8').match(/VERSION = '([^']+)'/)[1];
const sha = (alg, buf, enc = 'hex') => createHash(alg).update(buf).digest(enc);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p) => relative(PUB, p).split('\\').join('/');

// ---------- 1. Service Worker
const shellFiles = walk(PUB)
  .map(rel)
  .filter((f) => /\.(html|css|js|mjs|svg|png|webmanifest)$/.test(f))
  .filter((f) => f !== 'sw.js' && !f.startsWith('.') && !f.includes('/.'))
  .filter((f) => !/icon-(180|512|maskable)/.test(f))
  .sort();
const contentHash = sha('sha256', Buffer.concat(shellFiles.map((f) => readFileSync(join(PUB, f))))).slice(0, 10);
const swPath = join(PUB, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = 'zw-${version}-${contentHash}';`);
const listed = [...sw.matchAll(/^  '([^']+)',$/gm)].map((m) => m[1]).filter((f) => f !== './').sort();
if (JSON.stringify(listed) !== JSON.stringify(shellFiles)) {
  console.error('public/sw.js: SHELL-Liste passt nicht zu den Dateien. Erwartet:\n' + shellFiles.map((f) => `  '${f}',`).join('\n'));
  process.exit(1);
}
writeFileSync(swPath, sw);

// ---------- 2. Subresource-Integrity
const idxPath = join(PUB, 'index.html');
let idx = readFileSync(idxPath, 'utf8');
const sri = (f) => 'sha384-' + sha('sha384', readFileSync(join(PUB, f)), 'base64');
idx = idx.replace(/<link rel="stylesheet" href="css\/app\.css"[^>]*>/, `<link rel="stylesheet" href="css/app.css" integrity="${sri('css/app.css')}">`);
idx = idx.replace(/<script type="module" src="js\/app\.js"[^>]*><\/script>/, `<script type="module" src="js/app.js" integrity="${sri('js/app.js')}"></script>`);
idx = idx.replace(/<script src="js\/theme\.js"[^>]*><\/script>/, `<script src="js/theme.js" integrity="${sri('js/theme.js')}"></script>`);
writeFileSync(idxPath, idx);

// ---------- 3. Prüfsummen
const files = {};
for (const f of walk(PUB).map(rel).sort()) files[f] = sha('sha256', readFileSync(join(PUB, f)));
const serverFiles = {};
for (const dir of ['server']) {
  for (const p of walk(join(STAGE, dir)).sort()) serverFiles[relative(STAGE, p).split('\\').join('/')] = sha('sha256', readFileSync(p));
}
const release = { name: 'ZeroWichtel', version, date: new Date().toISOString().slice(0, 10), public: files, server: serverFiles };
const releaseJson = JSON.stringify(release, null, 2) + '\n';
writeFileSync(join(STAGE, 'RELEASE.json'), releaseJson);
writeFileSync(join(DIST, 'RELEASE.json'), releaseJson);

// ---------- 4. Paket
const zip = join(DIST, `zerowichtel-${version}.zip`);
if (existsSync(zip)) rmSync(zip);
execFileSync('zip', ['-qr', zip, '.'], { cwd: STAGE });

console.log(`ZeroWichtel ${version}`);
console.log(`  Service Worker: ${shellFiles.length} Dateien, Cache zw-${version}-${contentHash}`);
console.log(`  SRI gesetzt für css/app.css, js/app.js und js/theme.js`);
console.log(`  dist/RELEASE.json: ${Object.keys(files).length} öffentliche + ${Object.keys(serverFiles).length} Serverdateien`);
console.log(`  Paket: ${relative(ROOT, zip)}`);
