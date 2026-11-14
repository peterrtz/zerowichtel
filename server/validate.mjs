// Eingabeprüfung und JSON-Lesen. Jede Verletzung führt zu HTTP 400 mit deutscher Meldung.
// Die Regeln entsprechen der PHP-Version; wo PHP etwas großzügiger war (z. B. ein Zeilenumbruch
// am Ende einer ID), ist diese Version strenger – nie umgekehrt.

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const RE = {
  ID: /^[A-Za-z0-9_-]{22}$/,
  HASH: /^[0-9a-f]{64}$/,
  PUBKEY: /^[A-Za-z0-9_-]{43}$/,
  CT: /^(v1|s1)\.[A-Za-z0-9_-]{40,}$/,
};

/** Markiert JSON-Zahlen, die keine Ganzzahlen sind (1.0, 1e3, zu groß) – wie PHP sie als float liest. */
export const FLOAT = Symbol('float');
const INT64 = [-(2n ** 63n), 2n ** 63n - 1n];

/**
 * Liest den Anfragekörper wie json_decode(…, true, 16) in PHP:
 * gültiges UTF-8, keine einzelnen Surrogate, höchstens 15 Ebenen, Ergebnis ein Objekt oder eine Liste.
 */
export function parseBody(buf) {
  if (buf.length === 0) return {};
  let data;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
    data = JSON.parse(text, (key, v, ctx) => {
      if (!key.isWellFormed() || (typeof v === 'string' && !v.isWellFormed())) throw new SyntaxError('UTF-16');
      if (typeof v === 'number') {
        const src = ctx?.source ?? '';
        if (!/^-?\d+$/.test(src) || BigInt(src) < INT64[0] || BigInt(src) > INT64[1]) return FLOAT;
      }
      return v;
    });
    if (depth(data) > 15) throw new SyntaxError('Tiefe');
  } catch {
    throw new HttpError(400, 'bad_json', 'Ungültiges JSON.');
  }
  if (data === null || typeof data !== 'object') throw new HttpError(400, 'bad_json', 'JSON-Objekt erwartet.');
  return data;
}

function depth(v) {
  if (v === null || typeof v !== 'object') return 0;
  let max = 0;
  for (const c of Object.values(v)) max = Math.max(max, depth(c));
  return max + 1;
}

/** Feld aus dem Körper lesen; fehlend = null (wie $b[$f] ?? null). */
export const get = (b, f) => (b !== null && typeof b === 'object' && Object.hasOwn(b, f) ? b[f] ?? null : null);
export const has = (b, f) => b !== null && typeof b === 'object' && Object.hasOwn(b, f);
export const isArr = (v) => v !== null && typeof v === 'object';
export const bytes = (s) => Buffer.byteLength(s);
/** Zeichenzahl wie mb_strlen. */
export const chars = (s) => [...s].length;
/** trim() wie in PHP: nur Leerzeichen, Tab, Zeilenumbrüche, NUL und vertikaler Tab. */
export const phpTrim = (s) => s.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');

export function fail(field, msg = 'ungültig') {
  throw new HttpError(400, `invalid_${field}`, `Feld „${field}“ ${msg}.`);
}

function match(b, f, re) {
  const v = get(b, f);
  if (typeof v !== 'string' || !re.test(v)) fail(f);
  return v;
}

export const V = {
  id: (b, f) => match(b, f, RE.ID),
  hash: (b, f) => match(b, f, RE.HASH),
  pubkey: (b, f) => match(b, f, RE.PUBKEY),

  /** Chiffretext aus dem Browser (v1./s1.), mit Höchstlänge. */
  ct(b, f, max, optional = false) {
    const v = get(b, f);
    if (v === null && optional) return null;
    if (typeof v !== 'string' || bytes(v) > max || !RE.CT.test(v)) fail(f, typeof v === 'string' && bytes(v) > max ? 'ist zu lang' : 'ungültig');
    return v;
  },

  int(b, f, optional = false) {
    const v = get(b, f);
    if (v === null && optional) return null;
    if (!Number.isInteger(v)) fail(f);
    return v;
  },

  enum(b, f, allowed) {
    const v = get(b, f);
    if (typeof v !== 'string' || !allowed.includes(v)) fail(f);
    return v;
  },

  str(b, f, max) {
    const v = get(b, f);
    if (typeof v !== 'string' || v === '' || bytes(v) > max) fail(f);
    return v;
  },
};
