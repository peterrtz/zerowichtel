// Aufruf: node tools/analyse/analog-exakt.mjs <n> <k>   (exakt, sinnvoll bis n = 12)
// Exakt: alle gerichteten Einzelkreise über n Personen, k Paare analog(2i) <-> Helfer(2i+1) ausgeschlossen.
// Helfer h0 kennt: eigenes Ziel und Ziel von a0. Kennzahl: erwartete beste Ratewahrscheinlichkeit
// für die Zuordnung einer dritten Person; Vergleich mit gewöhnlicher Person ohne analoge Mitwichtelnde: 1/(n-2).
const [n, k] = process.argv.slice(2).map(Number);
const forb = Array.from({ length: n }, () => new Uint8Array(n));
for (let i = 0; i < k; i++) { forb[2 * i][2 * i + 1] = 1; forb[2 * i + 1][2 * i] = 1; }
// Zähler: key = ziel(h0)*n + ziel(a0); counts[key][g*n+r]
const counts = new Map(); const tot = new Map(); let total = 0;
const order = [0]; const used = new Uint8Array(n); used[0] = 1; const succ = new Int8Array(n);
function rec() {
  const last = order[order.length - 1];
  if (order.length === n) {
    if (forb[last][0]) return;
    succ[last] = 0;
    total++;
    const key = k ? succ[1] * n + succ[0] : succ[n - 1];
    let c = counts.get(key); if (!c) { c = new Uint32Array(n * n); counts.set(key, c); tot.set(key, 0); }
    tot.set(key, tot.get(key) + 1);
    for (let g = 0; g < n; g++) c[g * n + succ[g]]++;
    return;
  }
  for (let w = 1; w < n; w++) {
    if (used[w] || forb[last][w]) continue;
    used[w] = 1; succ[last] = w; order.push(w);
    rec();
    order.pop(); used[w] = 0;
  }
}
rec();
const known = k ? [0, 1] : [n - 1];
let exp = 0, sure = 0;
for (const [key, c] of counts) {
  const t = tot.get(key); let best = 0;
  for (let g = 0; g < n; g++) { if (known.includes(g)) continue; for (let r = 0; r < n; r++) best = Math.max(best, c[g * n + r] / t); }
  exp += (t / total) * best; if (best === 1) sure += t / total;
}
const base = 1 / (n - 2);
console.log(JSON.stringify({ n, k, kreise: total, max: +exp.toFixed(3), sicher: +sure.toFixed(3), basis: +base.toFixed(3), faktor: +(exp / base).toFixed(2) }));
