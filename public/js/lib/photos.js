// ZeroWichtel – Adventsalbum (2.13): Fotos im Browser aufbereiten, verschlüsseln, laden.
//
// Aufbereitung: Das Foto wird neu gezeichnet (lange Kante höchstens 1600 px, Drehung nach EXIF) und als WebP
// gespeichert, wo der Browser WebP schreiben kann, sonst als JPEG. Dabei fallen alle Metadaten weg – auch der
// GPS-Standort. Dazu eine Vorschau (lange Kante 400 px). Beides wird mit K_round verschlüsselt, AAD an Runde,
// Foto-ID und Art gebunden. Nach dem Entschlüsseln prüft jedes Gerät die Dateikennung: nur WebP und JPEG werden
// angezeigt, alles andere gilt als unlesbar (der Server kann den Inhalt nicht prüfen).
import * as C from './crypto.js';
import { api } from './api.js';
import { t } from './i18n.js';

export const PHOTO = { edge: 1600, thumbEdge: 400, maxBytes: 600 * 1024, thumbMaxBytes: 48 * 1024, caption: 140 };
export const AAD = {
  photo: (r, id) => ['photo', r, id, 'full'],
  thumb: (r, id) => ['photo', r, id, 'thumb'],
  meta: (r, id) => ['photo', r, id, 'meta'],
};

const authP = (p) => `p.${p.pid}.${p.accessToken}`;
const authA = (a) => `a.${a.roundId}.${a.adminToken}`;

/** Dateikennung prüfen: 'webp', 'jpeg' oder null. */
export function sniff(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return null;
}

/** Zielgröße: lange Kante höchstens edge, nie vergrößern. */
export function fitSize(w, h, edge) {
  const s = Math.min(1, edge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Bildunterschrift: Steuerzeichen raus, Leerraum zusammenfassen, auf 140 Zeichen kürzen. */
export function cleanCaption(v) {
  return [...String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, PHOTO.caption).join('');
}

// ---------------------------------------------------------------- Tage und Adventssonntage

/** Adventssonntage eines Jahres (Datum als „JJJJ-MM-TT“ → 1…4). */
export function adventSundays(year) {
  const d = new Date(year, 11, 24);
  d.setDate(24 - d.getDay()); // 4. Advent: Sonntag am oder vor dem 24.12.
  const out = new Map();
  for (let i = 4; i >= 1; i--) {
    out.set(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, i);
    d.setDate(d.getDate() - 7);
  }
  return out;
}

export const dayKey = (ts) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// ---------------------------------------------------------------- Aufbereitung (nur im Browser)

/** Datei als Bild lesen. Safari kann HEIC, Chrome/Firefox nicht → verständliche Meldung. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* weiter mit <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    const heic = /\.(heic|heif)$/i.test(file.name ?? '') || /hei[cf]/i.test(file.type ?? '');
    throw new Error(heic
      ? t('Dieses HEIC-Foto kann dein Browser nicht lesen. Am iPhone in Safari klappt es; sonst bitte als JPEG speichern oder ein Bildschirmfoto davon hochladen.')
      : t('Diese Datei lässt sich nicht als Bild lesen. Möglich sind Fotos als JPEG, PNG, WebP und (in Safari) HEIC.'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

/** Zeichnet neu und kodiert; versucht WebP, sonst JPEG; senkt Qualität und Größe, bis es passt. */
async function encode(src, edge, maxBytes) {
  const W = src.width;
  const H = src.height;
  let size = fitSize(W, H, edge);
  for (let round = 0; round < 6; round++) {
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; // transparente PNGs: weißer Hintergrund statt schwarz im JPEG
    g.fillRect(0, 0, size.w, size.h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, size.w, size.h);
    for (const q of [0.82, 0.72, 0.6]) {
      let blob = await canvasBlob(canvas, 'image/webp', q);
      if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, 'image/jpeg', q);
      if (blob && blob.size <= maxBytes) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!sniff(bytes)) throw new Error(t('Das Foto ließ sich nicht umwandeln.'));
        return { bytes, type: sniff(bytes), w: size.w, h: size.h };
      }
    }
    size = { w: Math.max(1, Math.round(size.w * 0.8)), h: Math.max(1, Math.round(size.h * 0.8)) };
  }
  throw new Error(t('Das Foto ließ sich nicht klein genug speichern.'));
}

/** Foto aufbereiten: großes Bild und Vorschau, ohne Metadaten. */
export async function preparePhoto(file) {
  if (!file || file.size > 40 * 1024 * 1024) throw new Error(t('Die Datei ist zu groß (höchstens 40 MB).'));
  const src = await decode(file);
  try {
    const full = await encode(src, PHOTO.edge, PHOTO.maxBytes);
    const thumb = await encode(src, PHOTO.thumbEdge, PHOTO.thumbMaxBytes);
    return { full, thumb };
  } finally {
    src.close?.();
  }
}

// ---------------------------------------------------------------- Server

export async function uploadPhoto(pctx, prepared, caption, name) {
  const id = C.newId();
  const r = pctx.roundId;
  const meta = { v: 1, caption: cleanCaption(caption), name: cleanCaption(name).slice(0, 80), type: prepared.full.type, w: prepared.full.w, h: prepared.full.h };
  const body = {
    id,
    photoCt: await C.encryptBytes(pctx.kRound, prepared.full.bytes, AAD.photo(r, id)),
    thumbCt: await C.encryptBytes(pctx.kRound, prepared.thumb.bytes, AAD.thumb(r, id)),
    metaCt: await C.encryptJson(pctx.kRound, meta, AAD.meta(r, id)),
  };
  return api('POST', '/me/photos', { auth: authP(pctx), body });
}

/** Metadaten defensiv lesen. */
export function readMeta(raw) {
  if (!raw || raw.v !== 1) return null;
  return {
    caption: cleanCaption(raw.caption),
    name: cleanCaption(raw.name).slice(0, 80),
    w: Number.isInteger(raw.w) && raw.w > 0 && raw.w <= 4000 ? raw.w : null,
    h: Number.isInteger(raw.h) && raw.h > 0 && raw.h <= 4000 ? raw.h : null,
  };
}

/** Liste entschlüsseln: Vorschau als Blob-URL (nur bei gültiger Kennung), Metadaten. */
export async function openList(kRound, roundId, photos) {
  const out = [];
  for (const f of photos) {
    let meta = null;
    let thumbUrl = null;
    try {
      meta = readMeta(await C.decryptJson(kRound, f.metaCt, AAD.meta(roundId, f.id)));
      const bytes = await C.decryptBytes(kRound, f.thumbCt, AAD.thumb(roundId, f.id));
      const kind = sniff(bytes);
      if (kind) thumbUrl = URL.createObjectURL(new Blob([bytes], { type: `image/${kind}` }));
    } catch { /* unlesbar */ }
    out.push({ id: f.id, at: f.at, own: Boolean(f.own), pid: f.pid ?? null, bytes: f.bytes, meta, thumbUrl, broken: !meta || !thumbUrl });
  }
  return out;
}

/** Großes Bild holen und entschlüsseln → { blob, kind } oder Fehler. */
export async function openFull(kRound, roundId, id, path, auth) {
  const { photoCt } = await api('GET', path, { auth });
  const bytes = await C.decryptBytes(kRound, photoCt, AAD.photo(roundId, id));
  const kind = sniff(bytes);
  if (!kind) throw new Error(t('Diese Datei ist kein lesbares Foto.'));
  return { blob: new Blob([bytes], { type: `image/${kind}` }), kind };
}

export const loadMine = (pctx) => api('GET', '/me/photos', { auth: authP(pctx) });
export const fullMine = (pctx, id) => openFull(pctx.kRound, pctx.roundId, id, `/me/photos/${id}`, authP(pctx));
export const deleteMine = (pctx, id) => api('DELETE', `/me/photos/${id}`, { auth: authP(pctx) });

// ---------------------------------------------------------------- Organisator:in

export const setAlbum = (ctx, enabled, pdf) => api('PUT', `/rounds/${ctx.roundId}/album`, { auth: authA(ctx), body: { enabled, pdf } });
export const loadAdmin = (ctx) => api('GET', `/rounds/${ctx.roundId}/photos`, { auth: authA(ctx) });
export const fullAdmin = (ctx, id) => openFull(ctx.kRound, ctx.roundId, id, `/rounds/${ctx.roundId}/photos/${id}`, authA(ctx));
export const deleteAdmin = (ctx, id) => api('DELETE', `/rounds/${ctx.roundId}/photos/${id}`, { auth: authA(ctx) });
