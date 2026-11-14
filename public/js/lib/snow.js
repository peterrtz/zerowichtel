// ZeroWichtel – Schneefall (rein dekorativ, abschaltbar).
// Ein Canvas über der Seite, das keine Klicks abfängt und für Screenreader unsichtbar ist.
// Bei „Bewegung reduzieren“ (prefers-reduced-motion) gibt es keinen Schnee. Die Wahl bleibt nur in diesem Browser.

const KEY = 'zw.snow';
let canvas = null;
let frame = 0;

export function reducedMotion() {
  return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function snowWanted() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setSnowWanted(on) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* privater Modus */ }
}

export function snowRunning() {
  return !!canvas;
}

export function startSnow() {
  if (canvas || reducedMotion()) return;
  canvas = document.createElement('canvas');
  canvas.className = 'snow';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let w = 0;
  let hgt = 0;
  const resize = () => {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    w = innerWidth;
    hgt = innerHeight;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  canvas._resize = resize;
  addEventListener('resize', resize);
  const flakes = Array.from({ length: Math.min(90, Math.round(innerWidth / 12)) }, () => ({
    x: Math.random() * w, y: Math.random() * hgt, r: 1 + Math.random() * 2.4, v: 0.3 + Math.random() * 0.9, p: Math.random() * 6.28,
  }));
  const color = () => (document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'rgba(255,255,255,.75)' : 'rgba(150,170,190,.7)');
  const tick = () => {
    if (!canvas) return;
    if (!document.hidden) {
      ctx.clearRect(0, 0, w, hgt);
      ctx.fillStyle = color();
      for (const f of flakes) {
        f.y += f.v;
        f.p += 0.01;
        f.x += Math.sin(f.p) * 0.35;
        if (f.y > hgt + 4) { f.y = -4; f.x = Math.random() * w; }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 6.283);
        ctx.fill();
      }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

export function stopSnow() {
  if (!canvas) return;
  cancelAnimationFrame(frame);
  removeEventListener('resize', canvas._resize);
  canvas.remove();
  canvas = null;
}
