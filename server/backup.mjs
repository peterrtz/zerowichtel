// Konsistente Sicherung der Datenbank (zw backup) mit rotierender Aufbewahrung.
//
// VACUUM INTO schreibt eine vollständige, in sich konsistente Kopie – auch während der Server läuft (WAL).
// Die Kopie enthält dieselben verschlüsselten Inhalte wie die Datenbank selbst; ohne config.json (Serverschlüssel)
// sind gespeicherte E-Mail-Adressen und das TOTP-Geheimnis darin nicht lesbar, Namen/Wünsche/Zuordnungen ohnehin nie.
// Alte Sicherungen werden nach „keep“ Tagen gelöscht, damit das Löschversprechen nur um diese Frist verlängert wird.
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const NAME = /^zerowichtel-\d{8}-\d{6}\.sqlite$/;
const pad = (n) => String(n).padStart(2, '0');

export function backupName(d = new Date()) {
  return `zerowichtel-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.sqlite`;
}

/** Sicherung schreiben und alte löschen. Rückgabe: { file, removed: [Dateinamen] }. */
export function backup(db, dbPath, { dir = null, keepDays = 14, now = Date.now() } = {}) {
  const target = resolve(dir ?? join(dirname(dbPath), 'backup'));
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const file = join(target, backupName(new Date(now)));
  if (existsSync(file)) throw new Error(`${file} gibt es schon`);
  db.prepare('VACUUM INTO ?').run(file);
  chmodSync(file, 0o600);
  const removed = [];
  if (keepDays > 0) {
    for (const f of readdirSync(target)) {
      if (!NAME.test(f)) continue; // nur eigene Dateien anfassen
      const p = join(target, f);
      if (p !== file && now - statSync(p).mtimeMs > keepDays * 86400_000) {
        unlinkSync(p);
        removed.push(f);
      }
    }
  }
  return { file, removed };
}
