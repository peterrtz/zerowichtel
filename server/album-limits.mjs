// Grenzen des Adventsalbums (2.13.1): Fotos je Person und Speicher je Runde.
//
// Ausgangswerte stehen in config.json unter album (person_photos, round_mb). Im Admin-Bereich oder per
// „zw album“ lassen sie sich ändern; das gilt sofort für alle Runden. Schon gespeicherte Fotos bleiben, auch wenn
// eine Runde danach über der neuen Grenze liegt – dann geht nur nichts Neues mehr hinzu.
import { getMeta, setMeta } from './cleanup.mjs';
import { run } from './db.mjs';

export const ALBUM_RANGES = { personPhotos: [1, 50], roundMb: [1, 500] };

export class AlbumLimitsError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

function check(v, field, [lo, hi], label) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new AlbumLimitsError(field, `${label} muss eine ganze Zahl von ${lo} bis ${hi} sein.`);
  return v;
}

export function normalizeAlbumLimits({ personPhotos, roundMb } = {}) {
  return {
    personPhotos: check(personPhotos, 'personPhotos', ALBUM_RANGES.personPhotos, 'Fotos je Person'),
    roundMb: check(roundMb, 'roundMb', ALBUM_RANGES.roundMb, 'Speicher je Runde (MB)'),
  };
}

/** Gültige Grenzen: eigene Einstellung, sonst Konfiguration. */
export function albumLimits(db, config) {
  const fallback = { personPhotos: config.album.person_photos, roundMb: config.album.round_mb, source: 'config' };
  const raw = getMeta(db, 'album_limits');
  if (!raw) return fallback;
  try {
    return { ...normalizeAlbumLimits(JSON.parse(raw)), source: 'admin' };
  } catch {
    return fallback;
  }
}

export function saveAlbumLimits(db, input) {
  const s = normalizeAlbumLimits(input);
  setMeta(db, 'album_limits', JSON.stringify(s));
  return s;
}

export function resetAlbumLimits(db) {
  run(db, "DELETE FROM meta WHERE key = 'album_limits'");
}

export function describeAlbumLimits(l) {
  return `${l.personPhotos} Fotos je Person, ${l.roundMb} MB je Runde${l.source === 'config' ? ' (aus config.json)' : ''}`;
}
