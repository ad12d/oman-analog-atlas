// live.js — Oman Analog Atlas: recompute the Analog Similarity Index (ASI) in the browser.
// No dependencies. Data: data/grid/grid.json + pack_XX.png (3 uint8 layers per RGB PNG), data/weights.json.
//   sim layers: value/254 = similarity 0–1      dist layers: value/10 = km (254 = ≥25.4 km)      255 = no data
export const CRIT = ["slope", "tri", "relief", "dT_diurnal", "dT_annual", "wind", "ndvi", "channels", "minerals", "access"];
export const CRIT_LABEL = { slope: "Slope", tri: "Roughness (TRI)", relief: "Local relief", dT_diurnal: "Day–night ΔT",
  dT_annual: "Annual ΔT", wind: "Wind", ndvi: "Dryness (NDVI)", channels: "Ancient channels", minerals: "Minerals (EMIT)", access: "Access" };
export const CONSTRAINTS = { town: "Towns & cities", village: "Villages", hamlet: "Hamlets / residential", roads_major: "Major roads",
  farms: "Farms", oil: "Oil & gas sites" };
const R = 6378137;

export async function loadGrid(base = "data/") {
  const meta = await (await fetch(base + "grid/grid.json")).json();
  const weights = await (await fetch(base + "weights.json")).json();
  const files = [...new Set(Object.values(meta.layers).map(l => l.pack))];
  const px = {};
  await Promise.all(files.map(async f => {
    const blob = await (await fetch(base + "grid/" + f)).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    px[f] = ctx.getImageData(0, 0, bmp.width, bmp.height).data;   // RGBA
  }));
  const N = meta.width * meta.height, cache = {};
  const layer = name => {
    if (cache[name]) return cache[name];
    const L = meta.layers[name]; if (!L) throw new Error("no layer " + name);
    const src = px[L.pack], out = new Uint8Array(N);
    for (let i = 0; i < N; i++) out[i] = src[i * 4 + L.ch];
    return (cache[name] = out);
  };
  // Web-Mercator geometry of the grid
  const [tl, , br] = meta.corners_lonlat;
  const mx = lon => lon * Math.PI / 180 * R, my = lat => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const x0 = mx(tl[0]), y0 = my(tl[1]), res = (mx(br[0]) - x0) / meta.width;
  const toLonLat = (col, row) => [((x0 + (col + .5) * res) / R) * 180 / Math.PI,
    (2 * Math.atan(Math.exp((y0 - (row + .5) * res) / R)) - Math.PI / 2) * 180 / Math.PI];
  const toPx = (lon, lat) => [(mx(lon) - x0) / res, (y0 - my(lat)) / res];
  return { meta, weights, layer, N, W: meta.width, H: meta.height, resKm: res / 1000, toLonLat, toPx };
}

export function defaultWeights(G, profile) { return { ...G.weights.weights[profile] }; }
export function normalise(w) { const s = Object.values(w).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / s])); }

// opts: { buffers: {town: km, ...}, excludeProtected: bool, emitOnly: bool }
export function computeASI(G, profile, weights, opts = {}) {
  const pr = G.meta.profiles[profile], w = normalise(weights), N = G.N;
  const asi = new Float32Array(N).fill(NaN), allowed = new Uint8Array(N);
  const L = CRIT.map(c => [w[c] / 254, G.layer(c === "minerals" ? pr.minerals_layer : `${pr.criteria_prefix}.${c}`)]).filter(([k]) => k > 0);
  const buf = Object.entries(opts.buffers || {}).filter(([k, v]) => v > 0 && G.meta.layers["dist." + k]).map(([k, v]) => [G.layer("dist." + k), v * 10]);
  const prot = opts.excludeProtected && G.meta.layers["dist.protected"] ? G.layer("dist.protected") : null;
  const cov = opts.emitOnly ? G.layer("emit_coverage") : null;
  for (let i = 0; i < N; i++) {
    let s = 0, ok = true;
    for (const [k, a] of L) { const v = a[i]; if (v === 255) { ok = false; break; } s += k * v; }
    if (!ok) continue;
    asi[i] = s;
    let alw = 1;
    for (const [d, lim] of buf) if (d[i] !== 255 && d[i] < lim) { alw = 0; break; }
    if (alw && prot && prot[i] === 0) alw = 0;
    if (alw && cov && cov[i] !== 1) alw = 0;
    allowed[i] = alw;
  }
  return { asi, allowed };
}

// percentile threshold over all Oman pixels (unmasked, like the validation)
export function percentileValue(asi, q) {
  const v = asi.filter(Number.isFinite).sort();
  return v[Math.min(v.length - 1, Math.floor(v.length * q / 100))];
}
export function percentileOf(asi, x) {
  const v = asi.filter(Number.isFinite).sort(); let lo = 0, hi = v.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (v[m] < x) lo = m + 1; else hi = m; }
  return 100 * lo / v.length;
}

// RGBA image: only the top X % (of allowed pixels) is coloured; excluded pixels optionally hatched grey
export function render(G, { asi, allowed }, { topPct = 20, ramp = ["#FFEDA0", "#FEB24C", "#F03B20", "#800026"], showExcluded = true } = {}) {
  const vals = []; for (let i = 0; i < G.N; i++) if (allowed[i] && Number.isFinite(asi[i])) vals.push(asi[i]);
  vals.sort((a, b) => a - b);
  const at = q => vals[Math.min(vals.length - 1, Math.floor(vals.length * q))] ?? 1;
  const cut = at(1 - topPct / 100), hi = at(0.995);
  const rgb = ramp.map(h => [1, 3, 5].map(j => parseInt(h.slice(j, j + 2), 16)));
  const c = document.createElement("canvas"); c.width = G.W; c.height = G.H;
  const ctx = c.getContext("2d"), img = ctx.createImageData(G.W, G.H), d = img.data;
  for (let i = 0; i < G.N; i++) {
    const v = asi[i]; if (!Number.isFinite(v)) continue;
    const o = i * 4;
    if (!allowed[i]) { if (showExcluded && ((i % G.W) + Math.floor(i / G.W)) % 4 === 0) { d[o] = d[o + 1] = d[o + 2] = 140; d[o + 3] = 120; } continue; }
    if (v < cut) continue;
    const f = Math.max(0, Math.min(1, (v - cut) / Math.max(1e-6, hi - cut))) * (rgb.length - 1), k = Math.min(rgb.length - 2, Math.floor(f)), t = f - k;
    d[o] = rgb[k][0] + (rgb[k + 1][0] - rgb[k][0]) * t; d[o + 1] = rgb[k][1] + (rgb[k + 1][1] - rgb[k][1]) * t;
    d[o + 2] = rgb[k][2] + (rgb[k + 1][2] - rgb[k][2]) * t; d[o + 3] = 225;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, url: c.toDataURL("image/png"), cut, coordinates: G.meta.corners_lonlat };
}

// best allowed sites: 3×3 km mean, greedy, at least sepKm apart (same idea as 07_validate_and_find_sites.py)
export function topSites(G, { asi, allowed }, n = 10, sepKm = 4, near = null) {
  const W = G.W, H = G.H, sm = new Float32Array(G.N).fill(NaN);
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    const i = r * W + c; if (!allowed[i]) continue; let s = 0, k = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const v = asi[i + dr * W + dc]; if (Number.isFinite(v)) { s += v; k++; } }
    sm[i] = s / k;
  }
  let idx = []; for (let i = 0; i < G.N; i++) if (Number.isFinite(sm[i])) idx.push(i);
  if (near) { const [px, py] = G.toPx(near.lon, near.lat), rr = (near.km / G.resKm) ** 2;
    idx = idx.filter(i => ((i % W) - px) ** 2 + (Math.floor(i / W) - py) ** 2 <= rr); }
  idx.sort((a, b) => sm[b] - sm[a]);
  const out = [], sep2 = (sepKm / G.resKm) ** 2;
  for (const i of idx) {
    const c = i % W, r = Math.floor(i / W);
    if (out.some(o => (o.col - c) ** 2 + (o.row - r) ** 2 < sep2)) continue;
    const [lon, lat] = G.toLonLat(c, r); out.push({ col: c, row: r, lon, lat, asi: sm[i] });
    if (out.length >= n) break;
  }
  return out;
}

// validation meter: median percentile of each benchmark zone for this profile (unmasked, like 07)
export function benchmarks(G, { asi }, profile) {
  const sorted = asi.filter(Number.isFinite).sort();
  const pct = x => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; } return 100 * lo / sorted.length; };
  return G.meta.benchmarks.filter(b => b.profile === profile).map(b => {
    const [x, y] = b.px, r = Math.max(1, b.radius_km / G.resKm), z = [];
    for (let row = Math.floor(y - r); row <= Math.ceil(y + r); row++) for (let col = Math.floor(x - r); col <= Math.ceil(x + r); col++) {
      if ((col - x) ** 2 + (row - y) ** 2 > r * r) continue; const v = asi[row * G.W + col]; if (Number.isFinite(v)) z.push(v);
    }
    z.sort((a, b) => a - b); const p = z.length ? pct(z[z.length >> 1]) : null;
    return { name: b.name, use: b.use, percentile: p, pass: p !== null && p >= 80 };
  });
}
