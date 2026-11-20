// ZeroWichtel – Rechenlogik für das Zuschneiden von Fotos (2.13.1).
// Alle Rechtecke in Pixeln des Originalbilds: { x, y, w, h }. Reine Funktionen, ohne DOM – im Test prüfbar.

/** Seitenverhältnisse zur Auswahl: [Schlüssel, Beschriftung, Verhältnis (Breite/Höhe) oder null = frei, 'orig' = wie Original]. */
export const ASPECTS = [
  ['frei', 'Frei', null],
  ['orig', 'Original', 'orig'],
  ['1:1', 'Quadrat 1:1', 1],
  ['4:3', '4:3', 4 / 3],
  ['3:4', '3:4', 3 / 4],
  ['16:9', '16:9', 16 / 9],
];

export const MIN_CROP = 64; // kleinste Kantenlänge in Pixeln des Originals

const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

/** Verhältnis auflösen: 'orig' → Verhältnis des Bilds, sonst Zahl oder null. */
export function ratioOf(aspect, W, H) {
  if (aspect === 'orig') return W / H;
  return typeof aspect === 'number' && aspect > 0 ? aspect : null;
}

/** Größtmögliches mittiges Rechteck mit Verhältnis ratio (null = ganzes Bild). */
export function fitAspect(W, H, ratio) {
  if (!ratio) return { x: 0, y: 0, w: W, h: H };
  let w = W;
  let h = w / ratio;
  if (h > H) {
    h = H;
    w = h * ratio;
  }
  return round({ x: (W - w) / 2, y: (H - h) / 2, w, h });
}

/** Rechteck ins Bild legen: Mindestgröße, nicht über den Rand. */
export function clampRect(r, W, H, min = MIN_CROP) {
  const m = Math.min(min, W, H);
  const w = Math.min(Math.max(r.w, m), W);
  const h = Math.min(Math.max(r.h, m), H);
  return round({ x: Math.min(Math.max(r.x, 0), W - w), y: Math.min(Math.max(r.y, 0), H - h), w, h });
}

/** Verschieben, am Rand anhalten. */
export function moveRect(r, dx, dy, W, H) {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy }, W, H);
}

/**
 * Größe an einer Ecke ziehen (handle: 'nw', 'ne', 'sw', 'se'); die gegenüberliegende Ecke bleibt fest.
 * Mit ratio bleibt das Seitenverhältnis erhalten.
 */
export function resizeRect(r, handle, dx, dy, W, H, ratio = null, min = MIN_CROP) {
  const east = handle.includes('e');
  const south = handle.includes('s');
  const ax = east ? r.x : r.x + r.w; // feste Ecke
  const ay = south ? r.y : r.y + r.h;
  const maxW = east ? W - ax : ax;
  const maxH = south ? H - ay : ay;
  let w = Math.min(Math.max((east ? r.w + dx : r.w - dx), 1), maxW);
  let h = Math.min(Math.max((south ? r.h + dy : r.h - dy), 1), maxH);
  if (ratio) {
    // der stärker gezogene Rand bestimmt die Größe
    if (Math.abs(dx) >= Math.abs(dy)) h = w / ratio;
    else w = h * ratio;
    if (w > maxW) { w = maxW; h = w / ratio; }
    if (h > maxH) { h = maxH; w = h * ratio; }
    const m = Math.min(min, maxW, maxH * ratio);
    if (w < m) { w = m; h = w / ratio; }
    if (h < Math.min(min, maxH)) { h = Math.min(min, maxH); w = h * ratio; }
  } else {
    w = Math.max(w, Math.min(min, maxW));
    h = Math.max(h, Math.min(min, maxH));
  }
  return round({ x: east ? ax : ax - w, y: south ? ay : ay - h, w, h });
}

/** Um den Mittelpunkt vergrößern/verkleinern (Tastatur), factor z. B. 1.1 oder 0.9. */
export function scaleRect(r, factor, W, H, ratio = null, min = MIN_CROP) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let w = r.w * factor;
  let h = ratio ? w / ratio : r.h * factor;
  const fit = Math.min(1, W / w, H / h);
  w *= fit;
  h *= fit;
  const m = Math.min(min, W, H);
  if (w < m || h < m) {
    const s = Math.max(m / w, m / h);
    w *= s;
    h *= s;
  }
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, W, H, 1);
}

/** Neues Verhältnis gewählt: größtes passendes Rechteck um den bisherigen Mittelpunkt. */
export function applyAspect(r, ratio, W, H) {
  if (!ratio) return clampRect(r, W, H);
  const base = fitAspect(W, H, ratio);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return clampRect({ ...base, x: cx - base.w / 2, y: cy - base.h / 2 }, W, H, 1);
}

/** Ganzes Bild? Dann muss nichts zugeschnitten werden. */
export const isFull = (r, W, H) => r.x === 0 && r.y === 0 && r.w === W && r.h === H;
