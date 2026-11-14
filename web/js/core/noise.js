// Seeded value noise for placeholder layers and terrains (replaced by real rasters later).
export function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function noise2(seed, G = 32) {
  const r = rng(seed), g = new Float32Array((G + 1) * (G + 1));
  for (let i = 0; i < g.length; i++) g[i] = r();
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    x = ((x % G) + G) % G; y = ((y % G) + G) % G;
    const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    const a = g[yi * (G + 1) + xi], b = g[yi * (G + 1) + xi + 1], c = g[(yi + 1) * (G + 1) + xi], d = g[(yi + 1) * (G + 1) + xi + 1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}
export function fbm(n, x, y, oct = 5) { let s = 0, a = .5, f = 1, tot = 0; for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f); tot += a; a *= .5; f *= 2; } return s / tot; }
export function normalize(arr) {
  let lo = Infinity, hi = -Infinity;
  for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const d = hi - lo || 1; for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) / d; return arr;
}
