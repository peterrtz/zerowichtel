// Admin-Bereich: Organisator-Codes im Browser verwalten.
//
// - Eingerichtet wird ausschließlich auf der Kommandozeile (zw admin setup) – nie im Browser.
// - Anmeldung: Masterpasswort (Argon2id) UND TOTP-Code oder einmaliger Notfallcode.
// - Nach MAX_FAILURES Fehlversuchen in Folge ist die Anmeldung LOCK_SECONDS gesperrt (für alle).
// - Sitzung: zufälliges Token, nur als Hash gespeichert, feste Laufzeit, keine Cookies.
// - Die API liegt unter einem geheimen Pfad (/admin/<slug>/…); ohne passenden Pfad, ohne Einrichtung
//   oder mit admin.enabled = false antwortet sie wie ein unbekannter Endpunkt.
// - Der Admin-Bereich sieht keine Rundeninhalte – nur Codes, Zähler und das eigene Protokoll.
import crypto from 'node:crypto';
import { ServerCrypto, hashPassword, verifyPassword, rand22, randomFrom32, safeEqual, sha256 } from './crypto.mjs';
import { all, one, run, tx, value } from './db.mjs';
import { createCode } from './codes.mjs';
import { HttpError } from './validate.mjs';

export const MAX_FAILURES = 5;
export const LOCK_SECONDS = 15 * 60;
export const LOG_KEEP = 90 * 86400;
export const RECOVERY_COUNT = 10;
export const MIN_PASSWORD = 12;

// ------------------------------------------------------------------ TOTP (RFC 6238: HMAC-SHA1, 6 Ziffern, 30 s)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  const bits = [...buf].map((b) => b.toString(2).padStart(8, '0')).join('');
  return (bits.match(/.{1,5}/g) ?? []).map((c) => B32[parseInt(c.padEnd(5, '0'), 2)]).join('');
}

export function base32Decode(s) {
  const bits = s.replace(/[\s=-]/g, '').toUpperCase().split('').map((c) => {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error('Ungültiges Base32.');
    return v.toString(2).padStart(5, '0');
  }).join('');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

export const totp = {
  PERIOD: 30,
  /** Neues Geheimnis: 160 Bit, Base32 (wie von RFC 4226 empfohlen). */
  newSecret: () => base32Encode(crypto.randomBytes(20)),
  step: (time) => Math.floor(time / 30),

  code(secret, step, digits = 6) {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(step));
    const mac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
    const off = mac[19] & 0x0f;
    const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
  },

  /**
   * Prüft einen Code im Fenster ±1 Zeitschritt; gibt den getroffenen Schritt zurück oder null.
   * Schritte bis einschließlich lastStep werden abgelehnt (kein zweites Verwenden desselben Codes).
   */
  verify(secret, code, time, lastStep = 0) {
    const c = String(code).replace(/[ \t\n\v\f\r]+/g, '');
    if (!/^[0-9]{6}$/.test(c)) return null;
    const now = totp.step(time);
    let hit = null;
    for (const s of [now - 1, now, now + 1]) {
      if (safeEqual(totp.code(secret, s), c) && s > lastStep) hit = s;
    }
    return hit;
  },

  uri: (secret, account, issuer = 'ZeroWichtel') => `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}`
    + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
};

// ------------------------------------------------------------------ Admin-Zugang

const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normalizeRecovery = (code) => String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const recoveryHash = (code) => sha256(`zw1-admin-recovery|${normalizeRecovery(code)}`);
/** Geheimer Pfad: 26 Zeichen a–z, 2–7. */
export const newSlug = () => base32Encode(crypto.randomBytes(16)).toLowerCase();

export class Admin {
  constructor(db, serverKeyRaw) {
    this.db = db;
    this.sc = new ServerCrypto(serverKeyRaw, 'admin');
  }

  row() { return one(this.db, 'SELECT * FROM admin WHERE id = 1') ?? null; }
  isSetUp() { return this.row() !== null; }
  slugMatches(slug) {
    const r = this.row();
    return r !== null && safeEqual(r.slug, slug);
  }

  log(now, event, detail = null) {
    run(this.db, 'INSERT INTO admin_log (ts, event, detail) VALUES (?, ?, ?)', now, event, detail);
  }

  // ---------------------------------------------------------------- Einrichtung (nur Kommandozeile)

  /** Legt den Admin-Zugang neu an (ersetzt einen bestehenden vollständig). */
  setup(password, totpSecret, now) {
    const slug = newSlug();
    const recovery = tx(this.db, () => {
      this.db.exec('DELETE FROM admin');
      this.db.exec('DELETE FROM admin_sessions');
      run(this.db, 'INSERT INTO admin (id, slug, pw_hash, totp_ct, totp_last_step, failures, locked_until, created_at) VALUES (1, ?, ?, ?, 0, 0, 0, ?)',
        slug, hashPassword(password), this.sc.seal(totpSecret, 'totp'), now);
      const codes = this.#replaceRecoveryCodes();
      this.log(now, 'eingerichtet');
      return codes;
    });
    return { slug, recovery };
  }

  setPassword(password, now) {
    run(this.db, 'UPDATE admin SET pw_hash = ? WHERE id = 1', hashPassword(password));
    this.logoutAll();
    this.log(now, 'Passwort geändert');
  }

  setTotp(secret, now) {
    run(this.db, 'UPDATE admin SET totp_ct = ?, totp_last_step = 0 WHERE id = 1', this.sc.seal(secret, 'totp'));
    this.logoutAll();
    this.log(now, 'Authenticator neu eingerichtet');
  }

  newRecoveryCodes(now) {
    return tx(this.db, () => {
      const codes = this.#replaceRecoveryCodes();
      this.log(now, 'Notfallcodes neu erzeugt');
      return codes;
    });
  }

  newPath(now) {
    const slug = newSlug();
    run(this.db, 'UPDATE admin SET slug = ? WHERE id = 1', slug);
    this.logoutAll();
    this.log(now, 'Adresse geändert');
    return slug;
  }

  unlock(now) {
    this.db.exec('UPDATE admin SET failures = 0, locked_until = 0 WHERE id = 1');
    this.log(now, 'Sperre aufgehoben (Konsole)');
  }

  logoutAll() { return run(this.db, 'DELETE FROM admin_sessions').changes; }

  remove() {
    tx(this.db, () => {
      for (const t of ['admin', 'admin_sessions', 'admin_recovery', 'admin_log']) this.db.exec(`DELETE FROM ${t}`);
    });
  }

  unusedRecoveryCount() { return value(this.db, 'SELECT COUNT(*) FROM admin_recovery WHERE used_at IS NULL'); }
  activeSessionCount(now) { return value(this.db, 'SELECT COUNT(*) FROM admin_sessions WHERE expires_at > ?', now); }

  #replaceRecoveryCodes() {
    this.db.exec('DELETE FROM admin_recovery');
    const codes = [];
    for (let i = 0; i < RECOVERY_COUNT; i++) {
      const code = randomFrom32(RC_ALPHABET, 12).match(/.{4}/g).join('-');
      run(this.db, 'INSERT INTO admin_recovery (hash, used_at) VALUES (?, NULL)', recoveryHash(code));
      codes.push(code);
    }
    return codes;
  }

  // ---------------------------------------------------------------- Anmeldung

  /** Prüft Passwort und zweiten Faktor. Bei Erfolg: [sessionId, token, expiresAt]. */
  login(password, second, now, sessionSeconds) {
    const r = this.row();
    if (!r) throw new HttpError(404, 'not_found', 'Unbekannter Endpunkt.');
    if (r.locked_until > now) {
      throw new HttpError(429, 'admin_locked', `Zu viele Fehlversuche. Die Anmeldung ist vorübergehend gesperrt – bitte in ${Math.ceil((r.locked_until - now) / 60)} Minuten erneut versuchen.`);
    }

    // Immer beide Prüfungen ausführen – die Antwort verrät nicht, welcher Teil falsch war.
    const pwOk = verifyPassword(password, r.pw_hash);
    const secret = this.sc.open(r.totp_ct, 'totp');
    const step = secret !== null ? totp.verify(secret, second, now, r.totp_last_step) : null;
    let recovery = null;
    if (step === null && normalizeRecovery(second).length === 12) {
      recovery = recoveryHash(second);
      if (!one(this.db, 'SELECT 1 FROM admin_recovery WHERE hash = ? AND used_at IS NULL', recovery)) recovery = null;
    }

    if (!pwOk || (step === null && recovery === null)) {
      tx(this.db, () => {
        const f = value(this.db, 'SELECT failures FROM admin WHERE id = 1') + 1;
        if (f >= MAX_FAILURES) {
          run(this.db, 'UPDATE admin SET failures = 0, locked_until = ? WHERE id = 1', now + LOCK_SECONDS);
          this.log(now, `Anmeldung gesperrt (${MAX_FAILURES} Fehlversuche)`);
        } else {
          run(this.db, 'UPDATE admin SET failures = ? WHERE id = 1', f);
          this.log(now, 'Fehlgeschlagene Anmeldung');
        }
      });
      throw new HttpError(401, 'admin_login', 'Anmeldung fehlgeschlagen.');
    }

    const sid = rand22();
    const token = rand22();
    const exp = now + sessionSeconds;
    tx(this.db, () => {
      if (step !== null) {
        run(this.db, 'UPDATE admin SET failures = 0, totp_last_step = ? WHERE id = 1', step);
      } else {
        run(this.db, 'UPDATE admin_recovery SET used_at = ? WHERE hash = ? AND used_at IS NULL', now, recovery);
        this.db.exec('UPDATE admin SET failures = 0 WHERE id = 1');
      }
      run(this.db, 'DELETE FROM admin_sessions WHERE expires_at <= ?', now);
      run(this.db, 'INSERT INTO admin_sessions (id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)', sid, sha256(token), exp, now);
      this.log(now, step !== null ? 'Anmeldung' : `Anmeldung mit Notfallcode (noch ${this.unusedRecoveryCount()} übrig)`);
    });
    return [sid, token, exp];
  }

  /** Prüft das Sitzungstoken (Header X-ZW-Auth: x.<id>.<token>) und gibt das Ablaufdatum zurück. */
  session(sid, token, now) {
    const s = one(this.db, 'SELECT token_hash, expires_at FROM admin_sessions WHERE id = ?', sid);
    if (!s || s.expires_at <= now || !safeEqual(s.token_hash, sha256(token))) {
      throw new HttpError(401, 'admin_session', 'Sitzung abgelaufen. Bitte neu anmelden.');
    }
    return s.expires_at;
  }

  logout(sid, now) {
    run(this.db, 'DELETE FROM admin_sessions WHERE id = ?', sid);
    this.log(now, 'Abmeldung');
  }

  // ---------------------------------------------------------------- Codes und Überblick

  codes(now) {
    return all(this.db, 'SELECT code_hash, label, max_rounds, used_rounds, expires_at, created_at FROM organizer_codes ORDER BY created_at DESC')
      .map((r) => ({
        ref: r.code_hash.slice(0, 12),
        label: r.label ?? '',
        maxRounds: r.max_rounds,
        usedRounds: r.used_rounds,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        status: r.expires_at <= now ? 'abgelaufen' : r.used_rounds >= r.max_rounds ? 'aufgebraucht' : 'aktiv',
      }));
  }

  createCode(label, rounds, days, now) {
    const code = createCode(this.db, label, rounds, days, now);
    this.log(now, 'Code erzeugt', `${label !== '' ? label : '–'} · ${rounds} Runden · ${days} Tage`);
    return code;
  }

  revokeCode(ref, now) {
    const rows = all(this.db, 'SELECT code_hash, label FROM organizer_codes WHERE substr(code_hash, 1, 12) = ?', ref);
    if (rows.length !== 1) throw new HttpError(404, 'not_found', 'Code nicht gefunden.');
    run(this.db, 'DELETE FROM organizer_codes WHERE code_hash = ?', rows[0].code_hash);
    this.log(now, 'Code widerrufen', rows[0].label || '–');
  }

  /** Zähler ohne Inhalte. */
  stats(now) {
    const q = (sql) => value(this.db, sql);
    return {
      rounds: q('SELECT COUNT(*) FROM rounds'),
      roundsOpen: q("SELECT COUNT(*) FROM rounds WHERE status = 'offen'"),
      roundsDrawn: q("SELECT COUNT(*) FROM rounds WHERE status = 'gezogen'"),
      participants: q('SELECT COUNT(*) FROM participants'),
      claimed: q('SELECT COUNT(*) FROM participants WHERE claimed_at IS NOT NULL'),
      emailRounds: q('SELECT COUNT(*) FROM rounds WHERE email_enabled = 1'),
      nextDeletion: q('SELECT MIN(delete_after) FROM rounds') ?? null,
      activeCodes: this.codes(now).filter((c) => c.status === 'aktiv').length,
      roundsWithoutCode: q('SELECT COUNT(*) FROM rounds WHERE without_code = 1'),
      recoveryLeft: this.unusedRecoveryCount(),
    };
  }

  recentLog(limit = 30) {
    return all(this.db, 'SELECT ts, event, detail FROM admin_log ORDER BY id DESC LIMIT ?', limit)
      .map((r) => ({ ts: r.ts, event: r.event, detail: r.detail ?? null }));
  }
}

/** Für das Aufräumen: abgelaufene Sitzungen und altes Protokoll entfernen. */
export function pruneAdmin(db, now) {
  run(db, 'DELETE FROM admin_sessions WHERE expires_at <= ?', now);
  run(db, 'DELETE FROM admin_log WHERE ts < ?', now - LOG_KEEP);
}
