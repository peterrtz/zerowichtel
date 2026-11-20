// ZeroWichtel – kleiner PDF-Erzeuger ohne Abhängigkeiten (2.13, Erinnerungsalbum).
//
// Kann genau das, was das Album braucht: A4-Seiten, JPEG-Bilder (DCTDecode), verlustfreie RGB-Bilder für Texte
// (FlateDecode, z. B. Bildunterschriften mit Emoji, im Browser auf einer Zeichenfläche gerendert) und gefüllte
// Rechtecke. Keine Schriften, keine Skripte, keine Formulare, keine Links – nichts, was ein PDF-Betrachter ausführt.

export const A4 = { w: 595.28, h: 841.89 };
export const A4_QUER = { w: 841.89, h: 595.28 };

const enc = new TextEncoder();
// 4 Nachkommastellen: Farben müssen exakt zu den gerenderten Textflächen passen (sonst sichtbare Kästen)
const num = (n) => (Math.round(n * 10000) / 10000).toString();

/** zlib-Deflate (= PDF FlateDecode) über CompressionStream – im Browser und in Node vorhanden. */
export async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class PdfDoc {
  constructor({ title = '' } = {}) {
    this.objects = [];   // [Uint8Array | string]
    this.pages = [];     // Objektnummern der Seiten
    this.title = title;
    this.pagesRef = this.#reserve();
    this.images = 0;
  }

  #reserve() {
    this.objects.push(null);
    return this.objects.length;
  }

  #set(ref, parts) {
    this.objects[ref - 1] = parts;
  }

  #add(parts) {
    const ref = this.#reserve();
    this.#set(ref, parts);
    return ref;
  }

  #stream(dict, data) {
    return [`<< ${dict} /Length ${data.length} >>\nstream\n`, data, '\nendstream'];
  }

  /** JPEG-Bild (Baseline oder progressiv), Farbe RGB. Gibt { name, ref, w, h } zurück. */
  addJpeg(bytes, w, h) {
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error('Kein JPEG');
    const ref = this.#add(this.#stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, bytes));
    return { name: `Im${++this.images}`, ref, w, h };
  }

  /** Bereits mit deflate() gepackte RGB-Daten (3 Byte je Pixel, zeilenweise). */
  addRgb(deflated, w, h) {
    const ref = this.#add(this.#stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, deflated));
    return { name: `Im${++this.images}`, ref, w, h };
  }

  /**
   * Seite mit Zeichenbefehlen. ops: Liste aus
   *   { image, x, y, w, h }           Bild an Position (Punkte, Ursprung oben links)
   *   { rect: [x, y, w, h], rgb }     gefülltes Rechteck, rgb = [r, g, b] in 0…1
   *   { poly: [[x, y], …], rgb }      gefüllte Fläche
   *   { group: [ops], rotate, cx, cy } Gruppe, um (cx, cy) gedreht
   */
  addPage(ops, { w = A4.w, h = A4.h } = {}) {
    const lines = [];
    const xobj = new Map();
    const emit = (list) => {
      for (const op of list) {
        if (!op) continue;
        if (op.image) {
          xobj.set(op.image.name, op.image.ref);
          lines.push(`q ${num(op.w)} 0 0 ${num(op.h)} ${num(op.x)} ${num(h - op.y - op.h)} cm /${op.image.name} Do Q`);
        } else if (op.rect) {
          const [x, y, rw, rh] = op.rect;
          lines.push(`q ${op.rgb.map(num).join(' ')} rg ${num(x)} ${num(h - y - rh)} ${num(rw)} ${num(rh)} re f Q`);
        } else if (op.poly) {
          // geschlossene Fläche aus Punkten (Ursprung oben links)
          const pts = op.poly.map(([x, y]) => `${num(x)} ${num(h - y)}`);
          lines.push(`q ${op.rgb.map(num).join(' ')} rg ${pts[0]} m ${pts.slice(1).map((p) => `${p} l`).join(' ')} h f Q`);
        } else if (op.group) {
          // Gruppe, um ihren Mittelpunkt (cx, cy) gedreht (Grad, im Uhrzeigersinn)
          const a = (-(op.rotate ?? 0) * Math.PI) / 180;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const px = op.cx;
          const py = h - op.cy;
          lines.push(`q 1 0 0 1 ${num(px)} ${num(py)} cm ${num(c)} ${num(s)} ${num(-s)} ${num(c)} 0 0 cm 1 0 0 1 ${num(-px)} ${num(-py)} cm`);
          emit(op.group);
          lines.push('Q');
        }
      }
    };
    emit(ops);
    const content = this.#add(this.#stream('', enc.encode(lines.join('\n'))));
    const res = [...xobj].map(([n, r]) => `/${n} ${r} 0 R`).join(' ');
    const page = this.#add(`<< /Type /Page /Parent ${this.pagesRef} 0 R /MediaBox [0 0 ${num(w)} ${num(h)}] /Resources << /XObject << ${res} >> >> /Contents ${content} 0 R >>`);
    this.pages.push(page);
    return page;
  }

  /** Fertige Datei als Bytes. */
  build() {
    this.#set(this.pagesRef, `<< /Type /Pages /Kids [${this.pages.map((p) => `${p} 0 R`).join(' ')}] /Count ${this.pages.length} >>`);
    const catalog = this.#add(`<< /Type /Catalog /Pages ${this.pagesRef} 0 R >>`);
    const info = this.#add(`<< /Title ${pdfString(this.title)} /Producer (ZeroWichtel) >>`);
    const chunks = [];
    let offset = 0;
    const push = (x) => {
      const b = typeof x === 'string' ? enc.encode(x) : x;
      chunks.push(b);
      offset += b.length;
    };
    push('%PDF-1.4\n');
    push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // Kommentar mit Binärbytes: Datei ist binär
    const offsets = [];
    this.objects.forEach((parts, i) => {
      offsets.push(offset);
      push(`${i + 1} 0 obj\n`);
      for (const p of Array.isArray(parts) ? parts : [parts]) push(p);
      push('\nendobj\n');
    });
    const xref = offset;
    push(`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`);
    for (const o of offsets) push(`${String(o).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${this.objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(offset);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** Titel als PDF-Textstring in UTF-16BE (Hex) – jedes Zeichen erlaubt, nichts zu escapen. */
export function pdfString(s) {
  const units = [0xfe, 0xff];
  for (const ch of String(s).slice(0, 200)) {
    const c = ch.codePointAt(0);
    if (c > 0xffff) {
      const v = c - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      units.push(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
    } else units.push(c >> 8, c & 0xff);
  }
  return `<${units.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
}
