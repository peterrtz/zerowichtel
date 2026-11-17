// Aufruf: node tools/analyse/analog-stichprobe.mjs <n> <k> <stichprobe>   (z. B. 50 16 300000)
// Stichprobe für große n: gleichverteilte Einzelkreise unter der Bedingung, dass Helfer h0(=1) -> x und a0(=0) -> y.
// Blöcke [1,x] und [0,y] fest, übrige Personen einzeln; zufällige Reihenfolge + Zurückweisung = gleichverteilt.
const [n, k, N] = process.argv.slice(2).map(Number);
const forb = (a, b) => (a >> 1) === (b >> 1) && (a >> 1) < k && a !== b;
function run(x, y) {
  const blocks = [[1, x], [0, y], ...[...Array(n).keys()].filter((v) => ![0, 1, x, y].includes(v)).map((v) => [v])];
  const c = new Uint32Array(n * n); let acc = 0;
  const seq = new Int16Array(n);
  while (acc < N) {
    for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
    let p = 0; for (const b of blocks) for (const v of b) seq[p++] = v;
    let ok = true; for (let i = 0; i < n; i++) if (forb(seq[i], seq[(i + 1) % n])) { ok = false; break; }
    if (!ok) continue;
    acc++; for (let i = 0; i < n; i++) c[seq[i] * n + seq[(i + 1) % n]]++;
  }
  let best = 0;
  for (let g = 2; g < n; g++) for (let r = 0; r < n; r++) best = Math.max(best, c[g * n + r] / N);
  return best;
}
const types = { 'x,y gewöhnlich': [n - 1, n - 2], 'x=a1, y=h1': [2, 3], 'x=h1, y=a1': [3, 2], 'x=a1, y=a2': [2, 4] };
const base = 1 / (n - 2); let worst = 0; const out = {};
for (const [name, [x, y]] of Object.entries(types)) { const b = run(x, y); out[name] = +(b / base).toFixed(2); worst = Math.max(worst, b / base); }
console.log(JSON.stringify({ n, k, stichprobe: N, faktor_je_fall: out, schlechtester: +worst.toFixed(2) }));
