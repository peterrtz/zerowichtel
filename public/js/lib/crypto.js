// ZeroWichtel – Krypto-Modul
// Läuft unverändert im Browser und in Node ≥ 22 (globalThis.crypto).
// Nur WebCrypto, keine Fremdbibliothek.
//
// Formate:
//   v1.<b64url(iv[12] || ciphertext)>            AES-256-GCM, symmetrisch
//   s1.<b64url(ephPub[32] || iv[12] || ct)>      X25519 + HKDF-SHA-256 + AES-256-GCM
// Jede Verschlüsselung ist per AAD an ihren Zweck gebunden (z. B. ['name', rundenId, personId]),
// damit Chiffretexte nicht zwischen Feldern oder Runden vertauscht werden können.

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder('utf-8', { fatal: true });

export const PROTOCOL = 'zw1';
export const ID_BYTES = 16;     // Runden-, Personen-IDs, Tokens: 128 Bit
export const KEY_BYTES = 32;    // Schlüssel und Personen-Geheimnis: 256 Bit
export const RECOVERY_BYTES = 20; // Wiederherstellungscode: 160 Bit

// ---------- Zufall und Kodierung ----------

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function b64uEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) {
    throw new Error('Ungültige Base64url-Zeichenkette');
  }
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Zufällige ID bzw. zufälliges Token (128 Bit, 22 Zeichen). */
export function newId() {
  return b64uEncode(randomBytes(ID_BYTES));
}

/** Zufälliger Schlüssel (256 Bit, 43 Zeichen). */
export function newKey() {
  return b64uEncode(randomBytes(KEY_BYTES));
}

export function isId(s) {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);
}

export function isKey(s) {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') return te.encode(v);
  throw new Error('Erwartet Uint8Array oder String');
}

function keyBytes(k) {
  const b = typeof k === 'string' ? b64uDecode(k) : k;
  if (!(b instanceof Uint8Array) || b.length !== KEY_BYTES) throw new Error('Schlüssel muss 32 Byte lang sein');
  return b;
}

function aadBytes(parts) {
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('AAD fehlt');
  for (const p of parts) {
    if (typeof p !== 'string' || p.includes('|')) throw new Error('Ungültiger AAD-Bestandteil');
  }
  return te.encode([PROTOCOL, ...parts].join('|'));
}

// ---------- Hashes und Ableitungen ----------

/** SHA-256 als Hex – so speichert der Server Tokens (server/crypto.mjs: sha256). */
export async function sha256Hex(v) {
  const h = new Uint8Array(await subtle.digest('SHA-256', toBytes(v)));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function tokenHash(token) {
  return sha256Hex(token);
}

/** HKDF-SHA-256. Salt standardmäßig 32 Nullbytes (RFC 5869). */
export async function hkdf(ikm, info, length = 32, salt = new Uint8Array(32)) {
  const base = await subtle.importKey('raw', toBytes(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toBytes(salt), info: te.encode(`${PROTOCOL}-${info}`) },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ---------- Symmetrisch: AES-256-GCM ----------

async function aesKey(raw, usage) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
}

export async function encryptBytes(key, plain, aad) {
  const iv = randomBytes(12);
  const k = await aesKey(keyBytes(key), 'encrypt');
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadBytes(aad) }, k, toBytes(plain)));
  return 'v1.' + b64uEncode(concat(iv, ct));
}

export async function decryptBytes(key, token, aad) {
  if (typeof token !== 'string' || !token.startsWith('v1.')) throw new Error('Unbekanntes Chiffretext-Format');
  const raw = b64uDecode(token.slice(3));
  if (raw.length < 12 + 16) throw new Error('Chiffretext zu kurz');
  const k = await aesKey(keyBytes(key), 'decrypt');
  try {
    const pt = await subtle.decrypt(
      { name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: aadBytes(aad) },
      k,
      raw.subarray(12),
    );
    return new Uint8Array(pt);
  } catch {
    throw new Error('Entschlüsselung fehlgeschlagen');
  }
}

export async function encryptJson(key, value, aad) {
  return encryptBytes(key, JSON.stringify(value), aad);
}

export async function decryptJson(key, token, aad) {
  return JSON.parse(td.decode(await decryptBytes(key, token, aad)));
}

// ---------- Asymmetrisch: X25519 ----------

// PKCS#8-Präfix für einen rohen X25519-Privatschlüssel (RFC 8410).
const X25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

export async function x25519Supported() {
  try {
    await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministisches Schlüsselpaar aus dem Personen-Geheimnis.
 * Dasselbe Geheimnis ergibt auf jedem Gerät dasselbe Schlüsselpaar – Voraussetzung für die Wiederherstellung.
 */
export async function keypairFromSecret(secret) {
  const seed = await hkdf(keyBytes(secret), 'x25519-person', 32);
  const pkcs8 = concat(X25519_PKCS8_PREFIX, seed);
  const extractable = await subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
  const jwk = await subtle.exportKey('jwk', extractable);
  const publicRaw = b64uDecode(jwk.x);
  const privateKey = await subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
  return { privateKey, publicRaw, publicB64: b64uEncode(publicRaw) };
}

async function x25519Shared(privateKey, publicRaw) {
  if (!(publicRaw instanceof Uint8Array) || publicRaw.length !== 32) throw new Error('Öffentlicher Schlüssel ungültig');
  const pub = await subtle.importKey('raw', publicRaw, { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: pub }, privateKey, 256));
  if (shared.every((b) => b === 0)) throw new Error('Ungültiger öffentlicher Schlüssel');
  return shared;
}

/** Verschlüsselt einen Wert für den Inhaber eines öffentlichen X25519-Schlüssels (ECIES). */
export async function sealTo(recipientPub, value, aad) {
  const recipient = typeof recipientPub === 'string' ? b64uDecode(recipientPub) : recipientPub;
  const eph = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const ephPub = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const shared = await x25519Shared(eph.privateKey, recipient);
  const k = await hkdf(shared, 'seal', 32, concat(ephPub, recipient));
  const inner = await encryptJson(k, value, aad);
  const innerRaw = b64uDecode(inner.slice(3));
  return 's1.' + b64uEncode(concat(ephPub, innerRaw));
}

/** Öffnet einen mit sealTo verschlüsselten Wert. */
export async function openSealed(keypair, token, aad) {
  if (typeof token !== 'string' || !token.startsWith('s1.')) throw new Error('Unbekanntes Format');
  const raw = b64uDecode(token.slice(3));
  if (raw.length < 32 + 12 + 16) throw new Error('Chiffretext zu kurz');
  const ephPub = raw.slice(0, 32);
  const shared = await x25519Shared(keypair.privateKey, ephPub);
  const k = await hkdf(shared, 'seal', 32, concat(ephPub, keypair.publicRaw));
  return decryptJson(k, 'v1.' + b64uEncode(raw.slice(32)), aad);
}

// ---------- Wiederherstellungscode ----------

// 32 Symbole ohne die leicht verwechselbaren 0, 1, I und O.
const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function encodeRecoveryCode(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== RECOVERY_BYTES) throw new Error('Wiederherstellungsschlüssel muss 20 Byte haben');
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += RC_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out.match(/.{4}/g).join('-');
}

export function decodeRecoveryCode(code) {
  const clean = String(code).toUpperCase().replace(/[\s-]/g, '');
  if (clean.length !== 32) throw new Error('Der Code muss 32 Zeichen haben');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = RC_ALPHABET.indexOf(ch);
    if (idx < 0) {
      if ('01IO'.includes(ch)) throw new Error(`„${ch}“ kommt im Code nicht vor – bitte genau abschreiben`);
      throw new Error(`Ungültiges Zeichen „${ch}“ im Code`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

/** Aus dem Wiederherstellungsschlüssel: Token für den Server und Schlüssel für recovery_ct. */
export async function recoveryMaterial(rk) {
  const auth = b64uEncode(await hkdf(rk, 'recovery-auth', 32));
  const encKey = await hkdf(rk, 'recovery-enc', 32);
  return { authToken: auth, authHash: await tokenHash(auth), encKey };
}
