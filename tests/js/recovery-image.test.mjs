// 2.4: Wiederherstellungscode als Bild – PNG-Textfeld, Code-Erkennung, QR-Lesen mit jsQR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { addPngText, readPngText, extractRecoveryCode } from '../../public/js/lib/recovery-image.js';
import qrcode from '../../public/js/vendor/qrcode.mjs';
import jsQR from '../../public/js/vendor/jsqr.mjs';

/** Minimales gültiges PNG (1×1, weiß). */
function tinyPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const idat = zlib.deflateSync(Buffer.from([0, 255, 255, 255]));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}

test('PNG-Textfeld: schreiben, lesen, Prüfsumme', () => {
  const png = tinyPng();
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const withText = addPngText(png, 'zw-recovery', code);
  assert.equal(readPngText(withText, 'zw-recovery'), code);
  assert.equal(readPngText(png, 'zw-recovery'), null);
  assert.equal(readPngText(withText, 'anderes'), null);
  const broken = withText.slice();
  broken[40] ^= 0xff; // Text verfälscht → Prüfsumme passt nicht
  assert.equal(readPngText(broken, 'zw-recovery'), null);
  assert.equal(readPngText(new Uint8Array([1, 2, 3]), 'zw-recovery'), null, 'kein PNG');
  assert.throws(() => addPngText(new Uint8Array(10), 'k', 'v'));
});

test('Code aus QR-Inhalt oder Text', () => {
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  assert.equal(extractRecoveryCode(`https://wichteln.example.org/#wiederherstellen/${code}`), code);
  assert.equal(extractRecoveryCode(code.match(/.{4}/g).join('-')), code);
  assert.equal(extractRecoveryCode(' abcd efgh '), null);
  assert.equal(extractRecoveryCode('https://wichteln.example.org/#p/abc'), null);
  assert.equal(extractRecoveryCode(null), null);
});

test('jsQR liest die eigenen QR-Codes (Wiederherstellungslink), auch verkleinert und mit Rand', () => {
  const link = 'https://wichteln.example.org/#wiederherstellen/ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  const n = qr.getModuleCount();
  for (const cell of [3, 6]) {
    const margin = 40;
    const size = (n + 8) * cell + 2 * margin;
    const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const i = (((r + 4) * cell + y + margin) * size + (c + 4) * cell + x + margin) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
    }
    const res = jsQR(rgba, size, size);
    assert.equal(res?.data, link, `Modulgröße ${cell}`);
    assert.equal(extractRecoveryCode(res.data), 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  }
});

// ---------- SEC-010: Abmessungen aus dem Dateikopf, bevor dekodiert wird
import { imageSize, MAX_PIXELS } from '../../public/js/lib/recovery-image.js';

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));
const le16 = (n) => [n & 255, n >> 8];
const be16 = (n) => [n >> 8, n & 255];

test('Abmessungen: PNG, GIF, JPEG (Baseline, progressiv, mit Füllbytes), WebP (VP8, VP8L, VP8X)', () => {
  const png = tinyPng();
  new DataView(png.buffer).setUint32(16, 30000);
  new DataView(png.buffer).setUint32(20, 30000);
  assert.deepEqual(imageSize(png), { type: 'png', w: 30000, h: 30000 });
  assert.deepEqual(imageSize(bytes('GIF89a', le16(640), le16(480), [0, 0, 0])), { type: 'gif', w: 640, h: 480 });
  const app0 = [0xff, 0xe0, ...be16(16), ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = (m, h, w) => [0xff, m, ...be16(17), 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  assert.deepEqual(imageSize(bytes([0xff, 0xd8], app0, sof(0xc0, 2796, 1290), [0xff, 0xda])), { type: 'jpeg', w: 1290, h: 2796 });
  assert.deepEqual(imageSize(bytes([0xff, 0xd8], app0, [0xff, 0xff], sof(0xc2, 6048, 8064))), { type: 'jpeg', w: 8064, h: 6048 }, 'progressiv, Füllbyte');
  const dht = [0xff, 0xc4, ...be16(4), 0, 0];
  assert.deepEqual(imageSize(bytes([0xff, 0xd8], dht, sof(0xc1, 10, 20))), { type: 'jpeg', w: 20, h: 10 }, 'DHT (0xC4) ist kein Frame-Kopf');
  assert.equal(imageSize(bytes([0xff, 0xd8], app0, [0xff, 0xda, 0, 2])), null, 'Bilddaten ohne Frame-Kopf');
  assert.equal(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0])), null, 'abgeschnitten / Länge 0');
  const riff = (kind, body) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', kind, [0, 0, 0, 0], body);
  assert.deepEqual(imageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(1290), ...le16(2796)])), { type: 'webp', w: 1290, h: 2796 });
  const l = ((1290 - 1) | ((2796 - 1) << 14)) >>> 0;
  assert.deepEqual(imageSize(riff('VP8L', [0x2f, l & 255, (l >> 8) & 255, (l >> 16) & 255, l >>> 24, 0, 0, 0, 0, 0])), { type: 'webp', w: 1290, h: 2796 });
  assert.deepEqual(imageSize(riff('VP8X', [0, 0, 0, 0, ...[29999 & 255, (29999 >> 8) & 255, 29999 >> 16], ...[29999 & 255, (29999 >> 8) & 255, 29999 >> 16]])), { type: 'webp', w: 30000, h: 30000 });
  assert.equal(imageSize(bytes('BM', new Array(40).fill(0))), null, 'BMP: nicht unterstützt');
  assert.equal(imageSize(new Uint8Array(0)), null);
  assert.ok(8064 * 6048 <= MAX_PIXELS, '48-MP-Foto erlaubt');
  assert.ok(30000 * 30000 > MAX_PIXELS);
});
