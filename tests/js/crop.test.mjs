// 2.13.1: Zuschneiden – Rechenlogik.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASPECTS, MIN_CROP, ratioOf, fitAspect, clampRect, moveRect, resizeRect, scaleRect, applyAspect, isFull } from '../../public/js/lib/crop.js';

const W = 3000;
const H = 2000;
const inside = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H && r.w >= MIN_CROP && r.h >= MIN_CROP;

test('Seitenverhältnisse und größtes mittiges Rechteck', () => {
  assert.deepEqual(ASPECTS.map(([k]) => k), ['frei', 'orig', '1:1', '4:3', '3:4', '16:9']);
  assert.equal(ratioOf('orig', W, H), 1.5);
  assert.equal(ratioOf(null, W, H), null);
  assert.deepEqual(fitAspect(W, H, null), { x: 0, y: 0, w: 3000, h: 2000 });
  assert.deepEqual(fitAspect(W, H, 1), { x: 500, y: 0, w: 2000, h: 2000 });
  assert.deepEqual(fitAspect(W, H, 16 / 9), { x: 0, y: 156, w: 3000, h: 1688 });
  assert.deepEqual(fitAspect(W, H, 3 / 4), { x: 750, y: 0, w: 1500, h: 2000 });
  assert.equal(isFull(fitAspect(W, H, null), W, H), true);
});

test('Verschieben bleibt im Bild', () => {
  const r = { x: 500, y: 0, w: 2000, h: 2000 };
  assert.deepEqual(moveRect(r, 900, 0, W, H), { x: 1000, y: 0, w: 2000, h: 2000 });
  assert.deepEqual(moveRect(r, -900, -50, W, H), { x: 0, y: 0, w: 2000, h: 2000 });
  assert.deepEqual(clampRect({ x: -10, y: 1990, w: 10, h: 10 }, W, H), { x: 0, y: 1936, w: 64, h: 64 }, 'Mindestgröße');
});

test('Ecke ziehen: frei, mit Verhältnis, Grenzen und Mindestgröße', () => {
  const r = { x: 1000, y: 500, w: 1000, h: 1000 };
  // frei: SO-Ecke nach rechts unten, gegenüberliegende Ecke bleibt
  assert.deepEqual(resizeRect(r, 'se', 200, 100, W, H), { x: 1000, y: 500, w: 1200, h: 1100 });
  // NW-Ecke nach innen
  assert.deepEqual(resizeRect(r, 'nw', 300, 200, W, H), { x: 1300, y: 700, w: 700, h: 800 });
  // über den Rand hinaus → am Rand
  assert.deepEqual(resizeRect(r, 'se', 5000, 5000, W, H), { x: 1000, y: 500, w: 2000, h: 1500 });
  // Mindestgröße
  assert.deepEqual(resizeRect(r, 'se', -5000, -5000, W, H), { x: 1000, y: 500, w: MIN_CROP, h: MIN_CROP });
  // mit Verhältnis 1:1 bleibt es quadratisch, auch am Rand
  for (const [hd, dx, dy] of [['se', 300, 10], ['nw', -2000, -100], ['ne', 50, -900], ['sw', -10, 5000], ['se', -5000, -5000]]) {
    const q = resizeRect(r, hd, dx, dy, W, H, 1);
    assert.ok(Math.abs(q.w - q.h) <= 1, `${hd}: ${JSON.stringify(q)}`);
    assert.ok(inside(q), `${hd} im Bild: ${JSON.stringify(q)}`);
  }
  const wide = resizeRect({ x: 0, y: 0, w: 1600, h: 900 }, 'se', 400, 0, W, H, 16 / 9);
  assert.deepEqual(wide, { x: 0, y: 0, w: 2000, h: 1125 });
});

test('Tastatur: um die Mitte skalieren; Verhältnis wechseln', () => {
  const r = { x: 1000, y: 500, w: 1000, h: 1000 };
  assert.deepEqual(scaleRect(r, 0.9, W, H, 1), { x: 1050, y: 550, w: 900, h: 900 });
  const big = scaleRect(r, 10, W, H, 1);
  assert.ok(inside(big) && big.w === 2000 && big.h === 2000, JSON.stringify(big));
  const tiny = scaleRect(r, 0.001, W, H, null);
  assert.ok(inside(tiny), JSON.stringify(tiny));
  const sq = applyAspect({ x: 0, y: 0, w: 3000, h: 2000 }, 1, W, H);
  assert.deepEqual(sq, { x: 500, y: 0, w: 2000, h: 2000 });
  const left = applyAspect({ x: 0, y: 0, w: 400, h: 400 }, 4 / 3, W, H);
  assert.ok(inside(left) && Math.abs(left.w / left.h - 4 / 3) < 0.01, JSON.stringify(left));
});

test('Kleine Bilder: Mindestgröße nie größer als das Bild', () => {
  const r = clampRect({ x: 0, y: 0, w: 10, h: 10 }, 40, 30);
  assert.deepEqual(r, { x: 0, y: 0, w: 30, h: 30 });
  const q = resizeRect({ x: 0, y: 0, w: 40, h: 30 }, 'se', -100, -100, 40, 30, null);
  assert.ok(q.w <= 40 && q.h <= 30 && q.w >= 1, JSON.stringify(q));
});
