// ZeroWichtel – Erinnerungsalbum als PDF (2.13), komplett im Browser.
//
// Jedes Foto wird entschlüsselt, auf seine Kennung geprüft, neu gezeichnet und als JPEG eingebettet – fremde Bytes
// gelangen so nie in die PDF. Texte (Titel, Bildunterschriften mit Emoji, Namen, Daten) werden auf einer
// Zeichenfläche in dreifacher Auflösung gerendert und verlustfrei (FlateDecode) eingebettet.
// Wählbar: 5 Layouts, 5 Designs, Hoch- oder Querformat, Titelblatt mit Titel, Untertitel, Text und Titelfoto.
import { PdfDoc, A4, A4_QUER, deflate } from './pdf.js';
import { fitSize, adventSundays, dayKey } from './photos.js';
import { formatDate } from './dates.js';
import { t, tn } from './i18n.js';

const SCALE = 3;           // Pixel je PDF-Punkt für Texte (≈ 216 dpi)
const PHOTO_EDGE = 1400;   // lange Kante der Fotos im PDF
export const COVER_TEXT_MAX = 300;

// ---------------------------------------------------------------- Designs und Layouts

const GOLD = [0.84, 0.66, 0.26];
export const DESIGNS = {
  winter: { label: 'Winterweiß', bg: [0.992, 0.98, 0.957], text: [0.13, 0.13, 0.13], muted: [0.42, 0.42, 0.42], accent: [0.62, 0.13, 0.2], second: [0.12, 0.29, 0.22], frame: [1, 1, 1], decor: 'bands' },
  tanne: { label: 'Tannengrün', bg: [0.1, 0.23, 0.17], text: [0.97, 0.95, 0.9], muted: [0.74, 0.8, 0.74], accent: GOLD, second: [0.62, 0.13, 0.2], frame: [0.98, 0.97, 0.93], decor: 'stars' },
  nacht: { label: 'Mitternacht', bg: [0.07, 0.09, 0.19], text: [0.95, 0.95, 0.98], muted: [0.68, 0.71, 0.82], accent: GOLD, second: [0.5, 0.6, 0.85], frame: [0.97, 0.97, 1], decor: 'snow' },
  lebkuchen: { label: 'Lebkuchen', bg: [0.95, 0.89, 0.8], text: [0.3, 0.17, 0.09], muted: [0.5, 0.36, 0.25], accent: [0.6, 0.27, 0.1], second: [0.98, 0.97, 0.94], frame: [0.99, 0.97, 0.93], decor: 'icing' },
  schlicht: { label: 'Schlicht', bg: [1, 1, 1], text: [0.1, 0.1, 0.1], muted: [0.45, 0.45, 0.45], accent: [0.25, 0.25, 0.25], second: [0.8, 0.8, 0.8], frame: [1, 1, 1], decor: 'none' },
};

export const LAYOUTS = {
  gross: { label: 'Ein Foto pro Seite', hint: 'Jedes Foto groß, Bildunterschrift darunter' },
  zwei: { label: 'Zwei pro Seite', hint: 'Zwei Fotos je Seite – im Hochformat untereinander, im Querformat nebeneinander' },
  raster: { label: 'Raster', hint: 'Vier Fotos je Seite mit kurzer Unterschrift' },
  polaroid: { label: 'Polaroid', hint: 'Fotos in weißen Rahmen, leicht schräg, Unterschrift im Rahmen' },
  tagebuch: { label: 'Tagebuch', hint: 'Nach Tagen geordnet, Foto und Text nebeneinander, Adventssonntage markiert' },
};

export const DEFAULT_OPTIONS = { layout: 'zwei', design: 'winter', orientation: 'hoch', title: '', subtitle: '', text: '', coverPhoto: 'first' };

/** Optionen bereinigen (z. B. aus dem Browser-Speicher). */
export function normalizeOptions(o = {}) {
  const str = (v, n) => [...String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')].slice(0, n).join('');
  return {
    layout: Object.hasOwn(LAYOUTS, o.layout) ? o.layout : DEFAULT_OPTIONS.layout,
    design: Object.hasOwn(DESIGNS, o.design) ? o.design : DEFAULT_OPTIONS.design,
    orientation: o.orientation === 'quer' ? 'quer' : 'hoch',
    title: str(o.title, 60).trim(),
    subtitle: str(o.subtitle, 100).trim(),
    text: str(o.text, COVER_TEXT_MAX).trim(),
    coverPhoto: typeof o.coverPhoto === 'string' && /^(none|first|[A-Za-z0-9_-]{22})$/.test(o.coverPhoto) ? o.coverPhoto : 'first',
  };
}

// ---------------------------------------------------------------- Bausteine

function fontStack() {
  const base = typeof document !== 'undefined' ? getComputedStyle(document.body).fontFamily : 'system-ui, sans-serif';
  return `${base}, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
}

const css = (rgb) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`;

/** Zeilenumbruch nach Breite (auch harte Zeilenumbrüche); höchstens maxLines Zeilen, sonst „…“. */
function wrap(g, text, width, maxLines) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const w of para.split(' ')) {
      const next = cur ? `${cur} ${w}` : w;
      if (g.measureText(next).width <= width || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    lines.push(cur);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && g.measureText(`${last} …`).width > width) last = [...last].slice(0, -1).join('');
    kept[maxLines - 1] = `${last} …`;
    return kept;
  }
  return lines;
}

/**
 * Textblock als Bild. blocks: [{ text, size, weight, rgb, lines, gap }] untereinander.
 * Gibt { image, w, h } in Punkten zurück (Breite fest, Höhe nach Inhalt) oder null ohne Text.
 */
async function textImage(doc, blocks, widthPt, { bg, align = 'left' }) {
  const font = fontStack();
  const probe = document.createElement('canvas').getContext('2d');
  const laid = [];
  let hPt = 0;
  for (const b of blocks) {
    if (!b?.text) continue;
    probe.font = `${b.weight ?? 400} ${b.size * SCALE}px ${font}`;
    const lines = wrap(probe, b.text, widthPt * SCALE, b.lines ?? 2);
    const lh = b.size * 1.35;
    laid.push({ ...b, lines, lh, y: hPt });
    hPt += lines.length * lh + (b.gap ?? 4);
  }
  if (!laid.length) return null;
  hPt = Math.ceil(hPt);
  const W = Math.round(widthPt * SCALE);
  const H = Math.round(hPt * SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = css(bg);
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'top';
  g.textAlign = align;
  for (const b of laid) {
    g.font = `${b.weight ?? 400} ${b.size * SCALE}px ${font}`;
    g.fillStyle = css(b.rgb);
    b.lines.forEach((line, i) => g.fillText(line, align === 'center' ? W / 2 : 0, (b.y + i * b.lh) * SCALE + b.size * 0.12 * SCALE));
  }
  const rgba = g.getImageData(0, 0, W, H).data;
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return { image: doc.addRgb(await deflate(rgb), W, H), w: widthPt, h: hPt };
}

/** Foto (Blob mit geprüfter Kennung) neu zeichnen → JPEG fürs PDF. */
async function photoJpeg(doc, blob) {
  const bmp = await createImageBitmap(blob);
  try {
    const { w, h } = fitSize(bmp.width, bmp.height, PHOTO_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.84));
    return doc.addJpeg(new Uint8Array(await out.arrayBuffer()), w, h);
  } finally {
    bmp.close?.();
  }
}

/** Bild in ein Feld einpassen (Seitenverhältnis bleibt), waagrecht mittig; senkrecht mittig oder oben. */
function fit(img, box, valign = 'middle') {
  const s = Math.min(box.w / img.w, box.h / img.h);
  const w = img.w * s;
  const h = img.h * s;
  return { x: box.x + (box.w - w) / 2, y: valign === 'top' ? box.y : box.y + (box.h - h) / 2, w, h };
}

/** Stern mit fünf Zacken als Fläche. */
function star(cx, cy, r, rgb) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return { poly: pts, rgb };
}

function dot(cx, cy, r, rgb) {
  const pts = [];
  for (let i = 0; i < 12; i++) pts.push([cx + r * Math.cos((i * Math.PI) / 6), cy + r * Math.sin((i * Math.PI) / 6)]);
  return { poly: pts, rgb };
}

/** Feste Pseudo-Zufallsfolge (gleiches Album → gleiche Deko). */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Hintergrund und Deko einer Seite. cover = stärkere Deko fürs Titelblatt. */
function background(D, P, seed, cover = false) {
  const ops = [{ rect: [0, 0, P.w, P.h], rgb: D.bg }];
  const r = rng(seed);
  if (D.decor === 'bands') {
    ops.push({ rect: [0, 0, P.w, cover ? 14 : 6], rgb: D.accent }, { rect: [0, cover ? 14 : 6, P.w, cover ? 4 : 2], rgb: D.second });
    if (cover) ops.push({ rect: [0, P.h - 18, P.w, 18], rgb: D.second });
  } else if (D.decor === 'stars') {
    const n = cover ? 18 : 5;
    for (let i = 0; i < n; i++) {
      const x = r() * P.w;
      const y = cover ? r() * P.h * 0.32 + 8 : (r() < 0.5 ? r() * 26 + 6 : P.h - r() * 26 - 6);
      ops.push(star(x, y, cover ? 3 + r() * 6 : 2.5 + r() * 2.5, D.accent));
    }
  } else if (D.decor === 'snow') {
    const n = cover ? 70 : 24;
    for (let i = 0; i < n; i++) ops.push(dot(r() * P.w, r() * P.h, 0.8 + r() * (cover ? 2.2 : 1.4), [0.85, 0.88, 0.97]));
  } else if (D.decor === 'icing') {
    // Zuckerguss-Rand: Punkte entlang der Kanten
    const step = 14;
    for (let x = 10; x < P.w - 5; x += step) ops.push(dot(x, 10, 2.4, D.second), dot(x, P.h - 10, 2.4, D.second));
    for (let y = 10 + step; y < P.h - 10; y += step) ops.push(dot(10, y, 2.4, D.second), dot(P.w - 10, y, 2.4, D.second));
  }
  return ops;
}

function dayLabel(ts, eventDate) {
  const k = dayKey(ts);
  const advent = adventSundays(new Date(ts * 1000).getFullYear()).get(k);
  return [formatDate(ts), advent ? t('{n}. Advent', { n: advent }) : null, eventDate && dayKey(eventDate) === k ? t('Bescherung') : null].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- Album

/**
 * Album bauen. items: entschlüsselte Liste, getFull(id) → { blob }, options: siehe DEFAULT_OPTIONS.
 * onProgress(done, total). Gibt die PDF als Blob zurück.
 */
export async function buildAlbumPdf({ title, eventDate, items, getFull, options = {}, onProgress = () => {} }) {
  const o = normalizeOptions(options);
  const D = DESIGNS[o.design];
  const P = o.orientation === 'quer' ? A4_QUER : A4;
  const M = 40;
  const year = new Date((eventDate ?? Date.now() / 1000) * 1000).getFullYear();
  const usable = [...items].filter((x) => !x.broken).sort((a, b) => a.at - b.at);
  const coverTitle = o.title || t('Adventsalbum');
  const doc = new PdfDoc({ title: `${coverTitle} – ${title}` });
  const page = (ops, cover = false) => doc.addPage([...background(D, P, doc.pages.length + 7, cover), ...ops], P);
  const caption = (it, width, { lines = 2, bg = D.bg, small = false, color = D.text, muted = D.muted } = {}) => textImage(doc, [
    { text: it.meta.caption, size: small ? 10.5 : 13, weight: 600, rgb: color, lines, gap: 2 },
    { text: [it.meta.name, formatDate(it.at)].filter(Boolean).join(' · '), size: small ? 8.5 : 10, rgb: muted, lines: 1 },
  ], width, { bg });

  // Fotos vorbereiten (nacheinander; unlesbare auslassen)
  const photos = [];
  for (const [i, it] of usable.entries()) {
    onProgress(i, usable.length);
    try {
      photos.push({ it, img: await photoJpeg(doc, (await getFull(it.id)).blob) });
    } catch { /* unlesbar */ }
  }
  onProgress(usable.length, usable.length);

  // ---------- Titelblatt
  const coverPick = o.coverPhoto === 'none' ? null : (o.coverPhoto === 'first' ? photos[0] : photos.find((p) => p.it.id === o.coverPhoto) ?? photos[0]);
  const tw = P.w - 2 * M;
  const head = await textImage(doc, [
    { text: coverTitle, size: o.orientation === 'quer' ? 36 : 40, weight: 700, rgb: D.accent, lines: 2, gap: 8 },
    { text: o.subtitle || title, size: 20, weight: 600, rgb: D.text, lines: 2, gap: 12 },
    { text: o.text, size: 12, rgb: D.text, lines: 8, gap: 12 },
    { text: `${tn(photos.length, '{n} Foto', '{n} Fotos')} · ${t('Advent {year}', { year })}`, size: 11, rgb: D.muted, lines: 1 },
  ], o.orientation === 'quer' && coverPick ? (P.w - 3 * M) / 2 : tw, { bg: D.bg, align: o.orientation === 'quer' && coverPick ? 'left' : 'center' });
  const foot = await textImage(doc, [
    { text: t('Erstellt mit ZeroWichtel. Alle Fotos stammen aus eurer Wichtelrunde und waren nur für sie sichtbar.'), size: 8.5, rgb: D.muted, lines: 2 },
  ], tw, { bg: D.bg, align: 'center' });
  const coverOps = [{ image: foot.image, x: M, y: P.h - M - foot.h, w: foot.w, h: foot.h }];
  if (coverPick) {
    if (o.orientation === 'quer') {
      const box = { x: M, y: M + 10, w: (P.w - 3 * M) / 2, h: P.h - 2 * M - foot.h - 30 };
      const f = fit(coverPick.img, box);
      coverOps.push({ rect: [f.x - 8, f.y - 8, f.w + 16, f.h + 16], rgb: D.frame }, { image: coverPick.img, ...f });
      coverOps.push({ image: head.image, x: P.w / 2 + M / 2, y: Math.max(M, (P.h - head.h) / 2 - 20), w: head.w, h: head.h });
    } else {
      const box = { x: M + 30, y: M + 40, w: tw - 60, h: P.h * 0.46 };
      const f = fit(coverPick.img, box);
      coverOps.push({ rect: [f.x - 9, f.y - 9, f.w + 18, f.h + 18], rgb: D.frame }, { image: coverPick.img, ...f });
      coverOps.push({ image: head.image, x: M, y: f.y + f.h + 40, w: head.w, h: head.h });
    }
  } else {
    coverOps.push({ image: head.image, x: M, y: Math.max(M + 60, (P.h - head.h) / 2 - 30), w: head.w, h: head.h });
  }
  page(coverOps, true);

  // ---------- Fotoseiten
  const area = { x: M, y: M + 6, w: P.w - 2 * M, h: P.h - 2 * M - 6 };

  if (o.layout === 'gross') {
    for (const p of photos) {
      const cap = await caption(p.it, area.w);
      const f = fit(p.img, { x: area.x, y: area.y, w: area.w, h: area.h - (cap?.h ?? 0) - 12 });
      page([{ image: p.img, ...f }, cap && { image: cap.image, x: area.x, y: f.y + f.h + 10, w: cap.w, h: cap.h }]);
    }
  } else if (o.layout === 'zwei' || o.layout === 'raster' || o.layout === 'polaroid') {
    const quer = o.orientation === 'quer';
    const [cols, rows] = o.layout === 'raster' ? [2, 2] : quer ? [2, 1] : [1, 2];
    const gap = o.layout === 'polaroid' ? 34 : 20;
    const cw = (area.w - gap * (cols - 1)) / cols;
    const ch = (area.h - gap * (rows - 1)) / rows;
    for (let i = 0; i < photos.length; i += cols * rows) {
      const ops = [];
      for (const [k, p] of photos.slice(i, i + cols * rows).entries()) {
        const cx = area.x + (k % cols) * (cw + gap);
        const cy = area.y + Math.floor(k / cols) * (ch + gap);
        if (o.layout === 'polaroid') {
          // Weißer Rahmen, unten breiter mit Unterschrift; leicht gedreht
          const pad = 12;
          const capH = 60; // fester Unterrand wie beim Sofortbild; Text darin auf Fotobreite
          const f = fit(p.img, { x: cx + pad + 10, y: cy + pad + 10, w: cw - 2 * pad - 20, h: ch - 2 * pad - 20 - capH });
          const cap = await caption(p.it, f.w, { lines: 2, bg: D.frame, small: true, color: [0.15, 0.15, 0.15], muted: [0.42, 0.42, 0.42] });
          const frame = [f.x - pad, f.y - pad, f.w + 2 * pad, f.h + pad + capH];
          const rot = ((i + k) % 2 ? 1 : -1) * (1.2 + ((i + k) % 3) * 0.6);
          ops.push({
            group: [
              { rect: [frame[0] + 3, frame[1] + 4, frame[2], frame[3]], rgb: D.bg.map((v) => v * 0.82) },
              { rect: frame, rgb: D.frame },
              { image: p.img, ...f },
              cap && { image: cap.image, x: f.x, y: f.y + f.h + 10, w: cap.w, h: cap.h },
            ],
            rotate: rot, cx: frame[0] + frame[2] / 2, cy: frame[1] + frame[3] / 2,
          });
        } else {
          const cap = await caption(p.it, cw, o.layout === 'raster' ? { lines: 1, small: true } : {});
          const f = fit(p.img, { x: cx, y: cy, w: cw, h: ch - (cap?.h ?? 0) - 8 }, 'top');
          ops.push({ image: p.img, ...f }, cap && { image: cap.image, x: cx, y: f.y + f.h + 6, w: cap.w, h: cap.h });
        }
      }
      page(ops);
    }
  } else if (o.layout === 'tagebuch') {
    // Fließender Satz: Tagesüberschrift, dann Einträge mit Foto links und Text rechts
    const imgW = area.w * (o.orientation === 'quer' ? 0.42 : 0.5);
    const txtW = area.w - imgW - 18;
    let ops = [];
    let y = area.y;
    let lastDay = null;
    const newPage = () => {
      if (ops.length) page(ops);
      ops = [];
      y = area.y;
    };
    for (const p of photos) {
      const day = dayKey(p.it.at);
      const label = day !== lastDay ? await textImage(doc, [{ text: dayLabel(p.it.at, eventDate), size: 15, weight: 700, rgb: D.accent, lines: 1 }], area.w, { bg: D.bg }) : null;
      const s = Math.min(imgW / p.img.w, (area.h * (o.orientation === 'quer' ? 0.62 : 0.4)) / p.img.h);
      const ih = p.img.h * s;
      const iw = p.img.w * s;
      const cap = await textImage(doc, [
        { text: p.it.meta.caption, size: 13, weight: 600, rgb: D.text, lines: 6, gap: 4 },
        { text: p.it.meta.name, size: 10.5, rgb: D.muted, lines: 1 },
      ], txtW, { bg: D.bg });
      const need = (label ? label.h + 10 : 0) + Math.max(ih, cap?.h ?? 0) + 22;
      if (y + need > area.y + area.h && ops.length) newPage();
      if (label) {
        ops.push({ image: label.image, x: area.x, y, w: label.w, h: label.h }, { rect: [area.x, y + label.h + 3, area.w, 1.2], rgb: D.second });
        y += label.h + 12;
        lastDay = day;
      }
      ops.push({ image: p.img, x: area.x, y, w: iw, h: ih });
      if (cap) ops.push({ image: cap.image, x: area.x + imgW + 18, y: y + 2, w: cap.w, h: cap.h });
      y += Math.max(ih, cap?.h ?? 0) + 22;
    }
    newPage();
  }
  return new Blob([doc.build()], { type: 'application/pdf' });
}
