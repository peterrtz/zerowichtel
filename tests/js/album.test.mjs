// 2.13: Adventsalbum – Dateikennung, Größen, Bildunterschrift, Adventssonntage, PDF-Grundgerüst, PDF-Optionen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sniff, fitSize, cleanCaption, readMeta, adventSundays, PHOTO } from '../../public/js/lib/photos.js';
import { PdfDoc, A4, A4_QUER, deflate, pdfString } from '../../public/js/lib/pdf.js';
import { normalizeOptions, LAYOUTS, DESIGNS, DEFAULT_OPTIONS } from '../../public/js/lib/album-pdf.js';

test('Dateikennung: nur WebP und JPEG', () => {
  const webp = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
  assert.equal(sniff(webp), 'webp');
  assert.equal(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  for (const bad of ['<script>', '%PDF-1.4', 'GIF89a', '\u0089PNG\r\n', 'RIFF\u0000\u0000\u0000\u0000WAVE', '']) {
    assert.equal(sniff(new TextEncoder().encode(bad)), null, JSON.stringify(bad));
  }
  assert.equal(sniff(Uint8Array.from([0xff, 0xd8])), null, 'zu kurz');
});

test('Größen: lange Kante höchstens 1600, nie vergrößern', () => {
  assert.deepEqual(fitSize(3000, 2000, PHOTO.edge), { w: 1600, h: 1067 });
  assert.deepEqual(fitSize(1200, 1800, PHOTO.edge), { w: 1067, h: 1600 });
  assert.deepEqual(fitSize(800, 600, PHOTO.edge), { w: 800, h: 600 });
  assert.deepEqual(fitSize(10000, 10, 400), { w: 400, h: 1 });
});

test('Bildunterschrift und Metadaten defensiv', () => {
  assert.equal(cleanCaption('  Erste\n\tPlätzchen  🍪 '), 'Erste Plätzchen 🍪');
  assert.equal([...cleanCaption('🎄'.repeat(200))].length, PHOTO.caption, 'Zeichen, nicht Code-Einheiten');
  assert.equal(readMeta(null), null);
  assert.equal(readMeta({ v: 2 }), null);
  assert.deepEqual(readMeta({ v: 1, caption: 5, name: 'Anna', w: 99999, h: 1067, extra: '<b>' }), { caption: '5', name: 'Anna', w: null, h: 1067 });
});

test('Adventssonntage: 4. Advent ist der Sonntag am oder vor dem 24.12.', () => {
  const y2026 = [...adventSundays(2026)].sort((a, b) => a[1] - b[1]).map(([d]) => d);
  assert.deepEqual(y2026, ['2026-11-29', '2026-12-6', '2026-12-13', '2026-12-20']);
  // 2023: 24.12. ist selbst ein Sonntag → 4. Advent = Heiligabend
  assert.equal(adventSundays(2023).get('2023-12-24'), 4);
  assert.equal(adventSundays(2023).get('2023-12-3'), 1);
});

test('PDF: gültige Datei mit Seiten, Bildern, Flächen und Drehung (qpdf, pdfinfo)', async () => {
  const d = new PdfDoc({ title: 'Advent 🎄 – „Plätzchen“ (Test)' });
  // echtes 2×2-JPEG (qpdf dekodiert die Bilddaten)
  const jpg = d.addJpeg(Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgqKKK8Q/YD//Z', 'base64')), 2, 2);
  const rgb = d.addRgb(await deflate(new Uint8Array(4 * 2 * 3).fill(200)), 4, 2);
  d.addPage([{ rect: [0, 0, A4.w, A4.h], rgb: [1, 1, 1] }, { image: jpg, x: 10, y: 10, w: 100, h: 100 }]);
  d.addPage([{ group: [{ rect: [100, 100, 200, 150], rgb: [0.9, 0.9, 0.9] }, { image: rgb, x: 120, y: 120, w: 40, h: 20 }], rotate: 3, cx: 200, cy: 175 },
    { poly: [[10, 10], [30, 10], [20, 30]], rgb: [0.5, 0, 0] }], A4_QUER);
  assert.throws(() => d.addJpeg(Uint8Array.from([1, 2, 3]), 1, 1), /JPEG/);
  const dir = mkdtempSync(join(tmpdir(), 'zw-pdf-'));
  try {
    const file = join(dir, 't.pdf');
    writeFileSync(file, d.build());
    execFileSync('qpdf', ['--check', file]);
    const info = execFileSync('pdfinfo', [file]).toString();
    assert.match(info, /Pages:\s+2/);
    assert.match(info, /Title:\s+Advent 🎄 – „Plätzchen“ \(Test\)/);
    assert.match(execFileSync('pdfinfo', ['-f', '2', '-l', '2', file]).toString(), /Page\s+2 size:\s+841\.89 x 595\.28/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(pdfString('A'), '<feff0041>');
  assert.equal(pdfString('🎄'), '<feffd83cdf84>', 'Ersatzpaar für Zeichen außerhalb der BMP');
});

test('PDF-Optionen: 5 Layouts, 5 Designs, bereinigt', () => {
  assert.equal(Object.keys(LAYOUTS).length, 5);
  assert.equal(Object.keys(DESIGNS).length, 5);
  assert.deepEqual(normalizeOptions({}), DEFAULT_OPTIONS);
  const o = normalizeOptions({ layout: 'polaroid', design: 'nacht', orientation: 'quer', title: 'x'.repeat(80), text: 'Zeile 1\nZeile 2\u0007', coverPhoto: 'AAAAAAAAAAAAAAAAAAAAAA' });
  assert.deepEqual([o.layout, o.design, o.orientation, o.title.length, o.text, o.coverPhoto], ['polaroid', 'nacht', 'quer', 60, 'Zeile 1\nZeile 2', 'AAAAAAAAAAAAAAAAAAAAAA']);
  const bad = normalizeOptions({ layout: '__proto__', design: 'toString', orientation: 'schräg', coverPhoto: '../x' });
  assert.deepEqual([bad.layout, bad.design, bad.orientation, bad.coverPhoto], ['zwei', 'winter', 'hoch', 'first']);
});
