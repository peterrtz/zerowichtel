// Parallele Schreibzugriffe mehrerer Prozesse auf dieselbe SQLite-Datei (Server + Kommandozeile gleichzeitig).
// Ohne BEGIN IMMEDIATE scheitern Lese-dann-Schreib-Transaktionen mit „database is locked“.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, value } from '../../server/db.mjs';

const WORKER = `
import { openDb } from '${new URL('../../server/db.mjs', import.meta.url).href}';
import { RateLimiter } from '${new URL('../../server/ratelimit.mjs', import.meta.url).href}';
const db = openDb(process.argv[1]);
const rl = new RateLimiter(db, Buffer.alloc(32, 'k'), { write: [1e9, 3600] });
for (let i = 0; i < Number(process.argv[2]); i++) rl.hit('write', '10.0.0.' + (i % 3), Math.floor(Date.now() / 1000));
`;

test('8 Prozesse × 300 Schreibvorgänge ohne Sperrfehler', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zw-conc-'));
  const path = join(dir, 'db.sqlite');
  openDb(path).close();
  try {
    const codes = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', WORKER, path, '300'], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('close', (code) => resolve([code, err]));
    })));
    for (const [code, err] of codes) assert.equal(code, 0, err);
    const db = openDb(path);
    assert.equal(value(db, 'SELECT SUM(hits) FROM rate_limits'), 2400);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
