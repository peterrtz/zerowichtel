// ZeroWichtel – Wiederherstellungscode als Bild (PNG) speichern und aus einem Bild wieder einlesen.
//
// Speichern: Das Bild entsteht im Browser (Canvas) – mit QR-Code, Code im Klartext und Hinweisen. Zusätzlich steht
// der Code in einem PNG-Textfeld (tEXt „zw-recovery“), damit das eigene Bild beim Hochladen sofort erkannt wird.
// Einlesen: zuerst dieses Textfeld; sonst wird der QR-Code im Bild gesucht (z. B. in einem Bildschirmfoto) –
// mit jsQR, das erst dann nachgeladen wird. Das Bild verlässt den Browser dabei nie.

import qrcode from '../vendor/qrcode.mjs';
import { t } from './i18n.js';

const KEY = 'zw-recovery';

// ---------- PNG-Textfeld

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const isPng = (u8) => SIG.every((b, i) => u8[i] === b);

/** Fügt nach dem IHDR-Block einen tEXt-Block ein (ASCII). */
export function addPngText(u8, keyword, text) {
  if (!isPng(u8)) throw new Error('Kein PNG');
  const data = new TextEncoder().encode(`${keyword}\0${text}`);
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set([116, 69, 88, 116], 4); // „tEXt“
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  const ihdrEnd = 8 + 12 + new DataView(u8.buffer, u8.byteOffset).getUint32(8);
  const out = new Uint8Array(u8.length + chunk.length);
  out.set(u8.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(u8.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/** Liest einen tEXt-Block; null, wenn es ihn nicht gibt. Prüft die Prüfsumme. */
export function readPngText(u8, keyword) {
  if (!isPng(u8)) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pos = 8;
  while (pos + 12 <= u8.length) {
    const len = dv.getUint32(pos);
    if (pos + 12 + len > u8.length) return null;
    const type = String.fromCharCode(...u8.subarray(pos + 4, pos + 8));
    if (type === 'tEXt') {
      const body = u8.subarray(pos + 8, pos + 8 + len);
      const crcOk = crc32(u8.subarray(pos + 4, pos + 8 + len)) === dv.getUint32(pos + 8 + len);
      const sep = body.indexOf(0);
      if (crcOk && sep > 0 && new TextDecoder().decode(body.subarray(0, sep)) === keyword) {
        return new TextDecoder().decode(body.subarray(sep + 1));
      }
    }
    if (type === 'IEND') return null;
    pos += 12 + len;
  }
  return null;
}

// ---------- Code aus Text herausfinden

/** Aus QR-Inhalt oder Text den Wiederherstellungscode holen (Link …#wiederherstellen/<code> oder der Code selbst). */
export function extractRecoveryCode(text) {
  const s = String(text ?? '').trim();
  const fromLink = /#wiederherstellen\/([A-Za-z0-9-]{20,80})\b/.exec(s);
  if (fromLink) return fromLink[1];
  const bare = s.replace(/[\s-]/g, '');
  return /^[A-Za-z0-9]{32}$/.test(bare) ? bare : null;
}

// ---------- Bild erzeugen

function wrap(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** PNG mit QR-Code, Code und Hinweisen; Ergebnis als Blob. */
export async function recoveryPng({ title, name, code, link }) {
  const W = 900;
  const pad = 56;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(420 / (n + 8));
  const qrSize = cell * (n + 8);

  // Texte vorbereiten (Höhe abhängig vom Umbruch)
  ctx.font = `26px ${sans}`;
  const hints = [
    t('Damit stellst du deinen persönlichen Zugang wieder her, falls du deinen Link verlierst: QR-Code mit der Kamera scannen oder auf der Startseite „Zugang wiederherstellen“ wählen und dieses Bild hochladen.'),
    t('Wie einen Schlüssel aufbewahren: Wer dieses Bild hat, kann deine Wichtelrunde öffnen. Nach der Runde löschen.'),
  ].map((x) => wrap(ctx, x, W - 2 * pad));
  const plain = String(code).replace(/[\s-]/g, '').toUpperCase();
  const groups = plain.match(/.{1,4}/g) ?? [plain];
  const codeLines = [groups.slice(0, 4).join('-'), groups.slice(4).join('-')].filter(Boolean);
  const H = pad + 50 + 46 + (name ? 40 : 0) + 30 + qrSize + 30 + codeLines.length * 52 + 30 + hints.flat().length * 36 + hints.length * 14 + pad;

  canvas.width = W;
  canvas.height = H;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f3d2b';
  ctx.fillRect(0, 0, W, 12);
  let y = pad + 30;
  ctx.fillStyle = '#1a1a1a';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 34px ${sans}`;
  ctx.fillText(t('ZeroWichtel – Wiederherstellungscode'), pad, y);
  y += 50;
  ctx.font = `bold 30px ${sans}`;
  ctx.fillText(String(title).slice(0, 60), pad, y);
  if (name) {
    y += 40;
    ctx.font = `28px ${sans}`;
    ctx.fillText(t('für {name}', { name: String(name).slice(0, 40) }), pad, y);
  }
  y += 30;
  // QR-Code mit Ruhezone
  const qx = Math.round((W - qrSize) / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qx, y, qrSize, qrSize);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(qx + (c + 4) * cell, y + (r + 4) * cell, cell, cell);
  y += qrSize + 50;
  ctx.font = `bold 40px ${mono}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1a1a1a';
  for (const l of codeLines) {
    ctx.fillText(l, W / 2, y);
    y += 52;
  }
  ctx.textAlign = 'left';
  y += 8;
  ctx.font = `26px ${sans}`;
  ctx.fillStyle = '#333333';
  for (const block of hints) {
    for (const l of block) {
      ctx.fillText(l, pad, y);
      y += 36;
    }
    y += 14;
  }

  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG'))), 'image/png'));
  const bytes = addPngText(new Uint8Array(await blob.arrayBuffer()), KEY, plain);
  return new Blob([bytes], { type: 'image/png' });
}

/** Bild speichern: auf Geräten mit Teilen-Menü (Handy) dorthin – „Bild sichern“ –, sonst als Download. */
export async function saveImage(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'aborted';
      // sonst: Download versuchen
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

// ---------- Bild einlesen

const MAX_SIDE = 2000;
/**
 * Höchstens 50 Megapixel dekodieren (48-MP-Handyfotos passen, ≈ 190 MB im Speicher). SEC-010
 * Verkleinern statt Ablehnen hilft nicht: Gemessen in Chromium 2026-11 dekodieren createImageBitmap mit resizeWidth
 * und ImageDecoder (desiredWidth für JPEG nicht unterstützt) trotzdem in voller Größe – 200 MP ≈ 770 MB Spitze.
 */
export const MAX_PIXELS = 50_000_000;

/** Fehler mit Text für die Anzeige (zu groß, unbekanntes Format). */
export class ImageRejected extends Error {}

/**
 * Breite und Höhe aus dem Dateikopf lesen, ohne das Bild zu dekodieren (PNG, JPEG, GIF, WebP); sonst null.
 * Damit lässt sich ein Bild mit riesigen Abmessungen (Dekompressionsbombe) ablehnen, bevor der Browser Speicher belegt.
 */
export function imageSize(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ascii = (o, n) => String.fromCharCode(...u8.subarray(o, o + n));
  if (u8.length >= 24 && isPng(u8) && ascii(12, 4) === 'IHDR') return { type: 'png', w: dv.getUint32(16), h: dv.getUint32(20) };
  if (u8.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return { type: 'gif', w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  if (u8.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8 ' && u8[23] === 0x9d && u8[24] === 0x01 && u8[25] === 0x2a) return { type: 'webp', w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
    if (kind === 'VP8L' && u8[20] === 0x2f) {
      const b = dv.getUint32(21, true);
      return { type: 'webp', w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { type: 'webp', w: (u8[24] | (u8[25] << 8) | (u8[26] << 16)) + 1, h: (u8[27] | (u8[28] << 8) | (u8[29] << 16)) + 1 };
    return null;
  }
  if (u8.length >= 4 && u8[0] === 0xff && u8[1] === 0xd8) {
    // JPEG: Segmente bis zum Frame-Kopf (SOF0–SOF15 außer DHT 0xC4, JPG 0xC8, DAC 0xCC) durchgehen
    let pos = 2;
    while (pos + 9 < u8.length) {
      if (u8[pos] !== 0xff) return null;
      const marker = u8[pos + 1];
      if (marker === 0xff) { pos++; continue; } // Füllbyte
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null; // Ende bzw. Bilddaten ohne Frame-Kopf
      const len = dv.getUint16(pos + 2);
      if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'jpeg', w: dv.getUint16(pos + 7), h: dv.getUint16(pos + 5) };
      pos += 2 + len;
    }
  }
  return null;
}

/**
 * Wiederherstellungscode aus einer Bilddatei (eigenes PNG oder Bildschirmfoto mit QR-Code); sonst null.
 * Wirft ImageRejected, wenn das Bild zu groß ist oder das Format nicht geprüft werden kann.
 */
export async function readRecoveryFromImage(file) {
  if (!file) return null;
  if (file.size > 25 * 1024 * 1024) throw new ImageRejected(t('Das Bild ist zu groß (höchstens 25 MB). Ein Bildschirmfoto reicht.'));
  const u8 = new Uint8Array(await file.arrayBuffer());
  const own = readPngText(u8, KEY);
  if (own && extractRecoveryCode(own)) return extractRecoveryCode(own);

  const size = imageSize(u8);
  if (!size) throw new ImageRejected(t('Dieses Bildformat wird nicht unterstützt. Bitte ein Bildschirmfoto oder ein PNG-, JPEG-, GIF- oder WebP-Bild wählen.'));
  if (!size.w || !size.h || size.w * size.h > MAX_PIXELS) {
    throw new ImageRejected(t('Das Foto ist zu groß zum Einlesen ({w} × {h} Bildpunkte). Öffne es in deiner Galerie und mach davon ein Bildschirmfoto – das reicht.', { w: size.w, h: size.h }));
  }

  let bmp;
  try {
    bmp = await createImageBitmap(new Blob([u8], { type: `image/${size.type}` }));
  } catch {
    return null;
  }
  const { default: jsQR } = await import('../vendor/jsqr.mjs');
  // Erst verkleinert (schnell), dann in voller Größe versuchen
  for (const limit of [1000, MAX_SIDE]) {
    const scale = Math.min(1, limit / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const res = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    const found = res && extractRecoveryCode(res.data);
    if (found) return found;
    if (scale === 1) break;
  }
  return null;
}
