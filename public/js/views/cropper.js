// Zuschneiden eines Fotos vor dem Hochladen (2.13.1).
// Rahmen mit vier Eckgriffen über einer verkleinerten Ansicht; Maus, Finger (Pointer Events) und Tastatur.
// Alles bleibt im Browser; das Ergebnis ist ein Rechteck in Pixeln des Originals.
import { h } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { ASPECTS, ratioOf, fitAspect, moveRect, resizeRect, scaleRect, applyAspect } from '../lib/crop.js';

let seq = 0;

/**
 * source: { src, w, h } aus photos.openSource(); start: bisheriger Zuschnitt oder null.
 * Gibt { el, value() } zurück; value() = Rechteck { x, y, w, h } in Pixeln des Originals.
 */
export function cropper(source, start = null) {
  const { src, w: W, h: H } = source;
  const id = `crop-${++seq}`;
  let aspect = 'frei';
  let rect = start ?? fitAspect(W, H, null);

  // Ansicht: verkleinerte Kopie (lange Kante höchstens 900 px), passt sich per CSS der Breite an
  const scale = Math.min(1, 900 / Math.max(W, H));
  const canvas = h('canvas', { class: 'crop-canvas', 'aria-hidden': 'true' });
  canvas.width = Math.max(1, Math.round(W * scale));
  canvas.height = Math.max(1, Math.round(H * scale));
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);

  const size = h('p', { class: 'hint crop-size', id: `${id}-size`, 'aria-live': 'polite' });
  const handles = ['nw', 'ne', 'sw', 'se'].map((k) => h('span', { class: `crop-handle crop-${k}`, 'data-handle': k, 'aria-hidden': 'true' }));
  const frame = h('div', {
    class: 'crop-rect', tabindex: '0', role: 'group',
    'aria-label': t('Zuschnitt. Pfeiltasten verschieben, Plus und Minus ändern die Größe, mit Umschalttaste in größeren Schritten.'),
    'aria-describedby': `${id}-size`,
  }, handles);
  const box = h('div', { class: 'crop-box' }, canvas, frame);

  const ratio = () => ratioOf(ASPECTS.find(([k]) => k === aspect)?.[2] ?? null, W, H);
  const draw = () => {
    // Prozentwerte über CSSOM (keine Inline-Styles im HTML; mit der Content-Security-Policy verträglich)
    frame.style.left = `${(rect.x / W) * 100}%`;
    frame.style.top = `${(rect.y / H) * 100}%`;
    frame.style.width = `${(rect.w / W) * 100}%`;
    frame.style.height = `${(rect.h / H) * 100}%`;
    size.textContent = t('Ausschnitt {w} × {h} Pixel von {W} × {H}', { w: rect.w, h: rect.h, W, H });
  };

  // Ziehen mit Maus oder Finger
  let drag = null;
  const toSource = (dxPx, dyPx) => {
    const b = box.getBoundingClientRect();
    return [dxPx * (W / b.width), dyPx * (H / b.height)];
  };
  box.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest('[data-handle]')?.dataset.handle ?? (ev.target.closest('.crop-rect') ? 'move' : null);
    if (!handle) return;
    ev.preventDefault();
    drag = { handle, x: ev.clientX, y: ev.clientY, start: { ...rect } };
    box.setPointerCapture(ev.pointerId);
    frame.focus({ preventScroll: true });
  });
  box.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const [dx, dy] = toSource(ev.clientX - drag.x, ev.clientY - drag.y);
    rect = drag.handle === 'move' ? moveRect(drag.start, dx, dy, W, H) : resizeRect(drag.start, drag.handle, dx, dy, W, H, ratio());
    draw();
  });
  const end = (ev) => {
    if (!drag) return;
    drag = null;
    if (box.hasPointerCapture?.(ev.pointerId)) box.releasePointerCapture(ev.pointerId);
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);

  // Tastatur
  frame.addEventListener('keydown', (ev) => {
    const step = (ev.shiftKey ? 0.1 : 0.02) * Math.max(W, H);
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[ev.key]) rect = moveRect(rect, ...moves[ev.key], W, H);
    else if (ev.key === '+' || ev.key === '=') rect = scaleRect(rect, ev.shiftKey ? 1.25 : 1.05, W, H, ratio());
    else if (ev.key === '-' || ev.key === '_') rect = scaleRect(rect, ev.shiftKey ? 0.8 : 0.95, W, H, ratio());
    else return;
    ev.preventDefault();
    draw();
  });

  // Seitenverhältnis
  const options = ASPECTS.map(([k, label]) => {
    const input = h('input', { type: 'radio', name: `${id}-aspect`, value: k, checked: k === aspect });
    input.addEventListener('change', () => {
      aspect = k;
      rect = applyAspect(rect, ratio(), W, H);
      draw();
    });
    return h('label', { class: 'crop-aspect' }, input, ' ', t(label));
  });
  const reset = h('button', { type: 'button', class: 'btn btn-small btn-ghost', on: { click: () => { rect = applyAspect(fitAspect(W, H, null), ratio(), W, H); draw(); } } }, t('Ganzes Bild'));

  draw();
  const el = h('div', { class: 'cropper' },
    h('fieldset', { class: 'crop-aspects' }, h('legend', null, t('Seitenverhältnis')), options),
    box,
    h('div', { class: 'crop-foot' }, size, reset));
  return { el, value: () => ({ ...rect }), focus: () => frame.focus() };
}
