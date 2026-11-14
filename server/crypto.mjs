// Kryptografie auf dem Server – nur Bausteine aus node:crypto, keine Fremdbibliothek.
//
// Wichtig: Die Zero-Knowledge-Daten (Namen, Wünsche, Zuordnung …) entschlüsselt der Server nie.
// Hier geht es nur um Hashes, Zufallswerte, das Admin-Passwort und um die wenigen Daten,
// die der Server selbst lesen muss (E-Mail-Adressen, Mail-Titel, TOTP-Geheimnis).
import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const b64u = (buf) => Buffer.from(buf).toString('base64url');
/** 128 Bit Zufall als 22 Zeichen Base64url (IDs und Tokens). */
export const rand22 = () => b64u(crypto.randomBytes(16));

/** Vergleich in konstanter Zeit (wie PHP hash_equals). */
export function safeEqual(known, given) {
  if (typeof known !== 'string' || typeof given !== 'string') return false;
  const a = Buffer.from(known);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Zufällige Zeichenkette aus einem Alphabet mit 32 Zeichen (ohne Verzerrung, da 256 % 32 = 0). */
export function randomFrom32(alphabet, n) {
  return [...crypto.randomBytes(n)].map((b) => alphabet[b & 31]).join('');
}

// ------------------------------------------------------------------ XChaCha20-Poly1305

/**
 * HChaCha20 (draft-irtf-cfrg-xchacha): leitet aus Schlüssel und den ersten 16 Nonce-Bytes einen Teilschlüssel ab.
 * Node bringt nur ChaCha20-Poly1305 mit 12-Byte-Nonce mit; zusammen ergibt das XChaCha20-Poly1305,
 * byte-genau kompatibel mit libsodium (crypto_aead_xchacha20poly1305_ietf_*) aus der PHP-Version.
 */
function hchacha20(key, nonce16) {
  const s = new Uint32Array(16);
  s.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  for (let i = 0; i < 8; i++) s[4 + i] = key.readUInt32LE(i * 4);
  for (let i = 0; i < 4; i++) s[12 + i] = nonce16.readUInt32LE(i * 4);
  const rotl = (v, c) => (v << c) | (v >>> (32 - c));
  const qr = (a, b, c, d) => {
    s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 16);
    s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 12);
    s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 8);
    s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  const out = Buffer.alloc(32);
  [0, 1, 2, 3, 12, 13, 14, 15].forEach((w, i) => out.writeUInt32LE(s[w], i * 4));
  return out;
}

function xchacha(key, nonce, decrypt) {
  const sub = hchacha20(key, nonce.subarray(0, 16));
  const iv = Buffer.concat([Buffer.alloc(4), nonce.subarray(16, 24)]);
  const opts = { authTagLength: 16 };
  return decrypt ? crypto.createDecipheriv('chacha20-poly1305', sub, iv, opts) : crypto.createCipheriv('chacha20-poly1305', sub, iv, opts);
}

/**
 * Verschlüsselung mit dem Serverschlüssel. Schützt eine kopierte Datenbankdatei, nicht vor dem Server selbst.
 * Schlüssel je Zweck: HKDF-SHA256(server_key, info = 'zw1-server-<zweck>'). Format: 'x1.' + base64url(nonce24 ‖ ct ‖ tag16),
 * zusätzlich an 'zw1|<aad>' gebunden (z. B. 'email|<personId>'), damit Chiffrate nicht umgehängt werden können.
 */
export class ServerCrypto {
  constructor(serverKeyRaw, purpose = 'email') {
    this.key = Buffer.from(crypto.hkdfSync('sha256', serverKeyRaw, Buffer.alloc(0), `zw1-server-${purpose}`, 32));
  }

  seal(plain, aad) {
    const nonce = crypto.randomBytes(24);
    const c = xchacha(this.key, nonce, false);
    c.setAAD(Buffer.from(`zw1|${aad}`));
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final(), c.getAuthTag()]);
    return `x1.${b64u(Buffer.concat([nonce, ct]))}`;
  }

  /** Gibt null zurück bei fehlendem, fremdem oder manipuliertem Chiffrat. */
  open(token, aad) {
    if (typeof token !== 'string' || !/^x1\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const raw = Buffer.from(token.slice(3), 'base64url');
    if (raw.length < 24 + 16) return null;
    try {
      const d = xchacha(this.key, raw.subarray(0, 24), true);
      d.setAAD(Buffer.from(`zw1|${aad}`));
      d.setAuthTag(raw.subarray(-16));
      return Buffer.concat([d.update(raw.subarray(24, -16)), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

// ------------------------------------------------------------------ Argon2id (Admin-Passwort)

// OWASP-Empfehlung: 19 MiB, 2 Durchläufe, 1 Thread – dieselben Werte wie password_hash() in der PHP-Version.
const ARGON = { memory: 19456, passes: 2, parallelism: 1 };
const unpad = (b) => b.toString('base64').replace(/=+$/, '');

/** Erzeugt einen PHC-String ($argon2id$v=19$m=…,t=…,p=…$salz$hash), lesbar auch für PHP password_verify(). */
export function hashPassword(password) {
  const nonce = crypto.randomBytes(16);
  const tag = crypto.argon2Sync('argon2id', { message: password, nonce, tagLength: 32, ...ARGON });
  return `$argon2id$v=19$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${unpad(nonce)}$${unpad(tag)}`;
}

/** Prüft ein Passwort gegen einen PHC-String (auch gegen Hashes, die PHP erzeugt hat). */
export function verifyPassword(password, phc) {
  const m = /^\$(argon2id|argon2i|argon2d)\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=(\d{1,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(String(phc));
  if (!m) return false;
  const expected = Buffer.from(m[6], 'base64');
  const tag = crypto.argon2Sync(m[1], {
    message: password, nonce: Buffer.from(m[5], 'base64'), tagLength: expected.length,
    memory: Number(m[2]), passes: Number(m[3]), parallelism: Number(m[4]),
  });
  return crypto.timingSafeEqual(tag, expected);
}
