// ZeroWichtel – Wichtel-Mixtape der Runde (2.11).
//
// Jede Person trägt 1–3 Lieblings-Weihnachtslieder ein (Titel und Interpret, keine Links). Verschlüsselt mit K_round,
// AAD ['mix', rundenId] – bewusst ohne Personen-ID, damit sich die Einträge untereinander nicht zuordnen lassen.
// Der Server liefert alle Einträge sortiert nach Chiffretext (Reihenfolge verrät nichts); die App mischt die Lieder
// mit einer festen, aus der Runde abgeleiteten Reihenfolge – alle sehen dieselbe Trackliste.
// Ab der Bescherung kann jede Person ihre Lieder „aufdecken“ (eigener Name im eigenen Eintrag).
// Anhören: nur Such-Links zu Musikdiensten, geöffnet erst beim Klick. Nichts wird eingebettet oder vorab geladen.
import { t } from './i18n.js';

export const MIX_LIMITS = { songs: 3, title: 100, artist: 100 };

const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const chars = (s) => [...s].length;
// Kürzen nach Zeichen (Codepunkten), damit kein Emoji halbiert wird
const cut = (s, n) => [...s].slice(0, n).join('');

/** Prüft die eigenen Lieder; leere Zeilen fallen weg. Wirft bei zu langen Angaben. */
export function validateMix(songs, by = null) {
  const out = [];
  for (const s of Array.isArray(songs) ? songs : []) {
    const title = clean(s?.title);
    const artist = clean(s?.artist);
    if (!title && !artist) continue;
    if (!title) throw new Error(t('Bitte bei jedem Lied den Titel angeben.'));
    if (chars(title) > MIX_LIMITS.title || chars(artist) > MIX_LIMITS.artist) throw new Error(t('Titel und Interpret höchstens je {n} Zeichen.', { n: MIX_LIMITS.title }));
    out.push({ title, artist });
  }
  if (out.length > MIX_LIMITS.songs) throw new Error(t('Höchstens {n} Lieder.', { n: MIX_LIMITS.songs }));
  const mix = { v: 1, songs: out };
  if (by) mix.by = cut(clean(by), 80);
  return mix;
}

/** Eingelesenen Eintrag eines anderen Geräts defensiv lesen (nie dem Inhalt vertrauen). */
export function readMix(raw) {
  if (!raw || raw.v !== 1 || !Array.isArray(raw.songs)) return null;
  const songs = raw.songs.slice(0, MIX_LIMITS.songs)
    .map((s) => ({ title: cut(clean(s?.title), MIX_LIMITS.title), artist: cut(clean(s?.artist), MIX_LIMITS.artist) }))
    .filter((s) => s.title);
  return { songs, by: typeof raw.by === 'string' && raw.by.trim() ? cut(clean(raw.by), 80) : null };
}

// FNV-1a, 32 Bit, mit Murmur3-Finalizer – nur für eine feste, für alle gleiche Reihenfolge (keine Sicherheitsfunktion).
// Ohne Finalizer liegen ähnliche Titel („… 1“, „… 2“) dicht beieinander, die Lieder einer Person also oft am Stück.
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Trackliste der Runde: alle Lieder aller Einträge, gemischt nach einem Wert aus Runde und Lied.
 * Gleiche Lieder (Titel + Interpret) erscheinen einmal, mit allen, die sie aufgedeckt haben.
 */
export function buildTracklist(entries, roundId) {
  const map = new Map();
  for (const e of entries) {
    if (!e) continue;
    for (const s of e.songs) {
      const key = `${s.title.toLocaleLowerCase()}|${s.artist.toLocaleLowerCase()}`;
      const cur = map.get(key) ?? { title: s.title, artist: s.artist, by: [], count: 0 };
      // Schreibweise unabhängig von der Reihenfolge der Einträge: die im Codepunkt-Vergleich kleinste
      if (`${s.title}|${s.artist}` < `${cur.title}|${cur.artist}`) Object.assign(cur, { title: s.title, artist: s.artist });
      cur.count++;
      if (e.by && !cur.by.includes(e.by)) cur.by.push(e.by);
      map.set(key, cur);
    }
  }
  for (const v of map.values()) v.by.sort();
  return [...map.entries()].sort(([a], [b]) => fnv(`${roundId}|${a}`) - fnv(`${roundId}|${b}`) || (a < b ? -1 : 1)).map(([, v]) => v);
}

/** Seiten A und B wie auf einer Kassette: A1, A2, … B1, B2, … */
export function trackLabel(i, total) {
  const half = Math.ceil(total / 2);
  return i < half ? `A${i + 1}` : `B${i - half + 1}`;
}

/** Such-Links. Nur Titel und Interpret gehen an den Dienst – und erst beim Klick. */
export const SERVICES = [
  ['Qobuz', (q) => `https://www.qobuz.com/de-de/search?q=${encodeURIComponent(q)}`],
  ['Spotify', (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`],
  ['Deezer', (q) => `https://www.deezer.com/search/${encodeURIComponent(q)}`],
  ['Apple Music', (q) => `https://music.apple.com/search?term=${encodeURIComponent(q)}`],
  ['YouTube', (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`],
];

export function searchLinks(song) {
  const q = [song.title, song.artist].filter(Boolean).join(' ');
  return SERVICES.map(([name, url]) => ({ name, url: url(q) }));
}

/** Text zum Kopieren in die eigene Musik-App. */
export function tracklistText(title, tracks) {
  return [title, '', ...tracks.map((x, i) => `${trackLabel(i, tracks.length)}  ${x.title}${x.artist ? ` – ${x.artist}` : ''}`)].join('\n');
}
