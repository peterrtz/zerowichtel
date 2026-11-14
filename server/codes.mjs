// Organisator-Codes: Format ZW-XXXX-XXXX-XXXX-XXXX (80 Bit). Gespeichert wird nur der Hash.
import { sha256, randomFrom32 } from './crypto.mjs';
import { one, run } from './db.mjs';
import { HttpError } from './validate.mjs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVALID = () => new HttpError(403, 'organizer_code', 'Organisator-Code ungültig, abgelaufen oder aufgebraucht.');

/** Groß/klein, Bindestriche und das Präfix „ZW“ spielen beim Eintippen keine Rolle. */
export function normalizeCode(code) {
  const c = String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return c.startsWith('ZW') ? c.slice(2) : c;
}

export const codeHash = (code) => sha256(`zw1-organizer|${normalizeCode(code)}`);

export function createCode(db, label, maxRounds, days, now) {
  const code = `ZW-${randomFrom32(ALPHABET, 16).match(/.{4}/g).join('-')}`;
  run(db, 'INSERT INTO organizer_codes (code_hash, label, max_rounds, used_rounds, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)',
    codeHash(code), label, maxRounds, now + days * 86400, now);
  return code;
}

/** Verbraucht eine Runde des Codes. Muss innerhalb einer Transaktion laufen. */
export function consumeCode(db, code, now) {
  const r = run(db, 'UPDATE organizer_codes SET used_rounds = used_rounds + 1 WHERE code_hash = ? AND expires_at > ? AND used_rounds < max_rounds',
    codeHash(code), now);
  if (r.changes !== 1) throw INVALID();
}

export function checkCode(db, code, now) {
  const row = one(db, 'SELECT max_rounds, used_rounds, expires_at FROM organizer_codes WHERE code_hash = ?', codeHash(code));
  if (!row || row.expires_at <= now || row.used_rounds >= row.max_rounds) throw INVALID();
  return { remaining: row.max_rounds - row.used_rounds, expiresAt: row.expires_at };
}
