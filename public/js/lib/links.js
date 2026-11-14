// ZeroWichtel – Links
// Alle Geheimnisse stehen im URL-Fragment (#…). Browser senden das Fragment nie an den Server,
// es landet weder in Server-Logs noch im Referrer.
//
//   #a/{rundenId}/{adminToken}/{kRunde}/{kAdmin}                     Admin-Link
//   #i/{rundenId}/{personId}/{einladeToken}/{kRunde}                 Einladungslink
//   #p/{rundenId}/{personId}/{zugangsToken}/{kRunde}/{geheimnis}     Persönlicher Link
//   #j/{rundenId}/{gruppenToken}/{kRunde}                            Gruppenlink (optional, zum Selbst-Eintragen)

import { isId, isKey } from './crypto.js';

const SPEC = {
  a: ['roundId', 'adminToken', 'kRound', 'kAdmin'],
  i: ['roundId', 'pid', 'inviteToken', 'kRound'],
  p: ['roundId', 'pid', 'accessToken', 'kRound', 'secret'],
  j: ['roundId', 'joinToken', 'kRound'],
};

const KEY_FIELDS = new Set(['kRound', 'kAdmin', 'secret']);

export function buildFragment(kind, data) {
  const fields = SPEC[kind];
  if (!fields) throw new Error('Unbekannter Linktyp');
  const parts = fields.map((f) => {
    const v = data[f];
    const ok = KEY_FIELDS.has(f) ? isKey(v) : isId(v);
    if (!ok) throw new Error(`Feld ${f} ungültig`);
    return v;
  });
  return `#${kind}/${parts.join('/')}`;
}

export function buildLink(baseUrl, kind, data) {
  return baseUrl.replace(/[#/]+$/, '') + '/' + buildFragment(kind, data);
}

/** Zerlegt ein Fragment. Gibt null zurück, wenn es kein gültiger Geheimnis-Link ist. */
export function parseFragment(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const [kind, ...parts] = h.split('/');
  const fields = SPEC[kind];
  if (!fields || parts.length !== fields.length) return null;
  const out = { kind };
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const v = parts[i];
    if (KEY_FIELDS.has(f) ? !isKey(v) : !isId(v)) return null;
    out[f] = v;
  }
  return out;
}
