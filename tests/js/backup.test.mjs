// 2.4: zw backup – konsistente Kopie, Rotation nur eigener Dateien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../server/db.mjs';
import { backup } from '../../server/backup.mjs';

test('Sicherung ist vollständig, nur für den Besitzer lesbar, alte werden rotiert', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zw-bak-'));
  try {
    const dbPath = join(dir, 'zerowichtel.sqlite');
    const db = openDb(dbPath);
    db.exec("INSERT INTO meta (key, value) VALUES ('probe', 'x')");
    const bdir = join(dir, 'backup');
    const now = Date.UTC(2026, 10, 10, 12);
    const first = backup(db, dbPath, { now: now - 20 * 86400_000 });
    utimesSync(first.file, (now - 20 * 86400_000) / 1000, (now - 20 * 86400_000) / 1000);
    writeFileSync(join(bdir, 'fremd.sqlite'), 'x');
    utimesSync(join(bdir, 'fremd.sqlite'), 0, 0);
    const r = backup(db, dbPath, { now });
    assert.deepEqual(r.removed, [first.file.split('/').pop()]);
    assert.deepEqual(readdirSync(bdir).sort(), ['fremd.sqlite', r.file.split('/').pop()].sort());
    assert.equal(statSync(r.file).mode & 0o777, 0o600);
    const copy = new DatabaseSync(r.file, { readOnly: true });
    assert.equal(copy.prepare("SELECT value FROM meta WHERE key = 'probe'").get().value, 'x');
    assert.equal(copy.prepare('PRAGMA user_version').get().user_version, 7);
    copy.close();
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
