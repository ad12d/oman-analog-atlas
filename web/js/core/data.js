// Loads the data contract files. Real GIS outputs in web/data/ take priority;
// if a file is missing the app falls back to web/data/mock/ and shows the "Mock data" flag.
// Real files (team GIS hand-off): sites.geojson (55 sites x 4 profiles, 90 m analysis), weights.json (AHP tier 2),
// targets.csv (target value + tolerance + the similarity rule per criterion), target_sites.json (terrain twins).

export const MISSIONS = {
  moon_base:        { label: "Moon base",        short: "Moon base",  world: "moon", worldName: "the Moon", target: "Lunar south pole (Artemis III regions)",
                      ramp: ["#0F1B2E", "#24456E", "#4F7FB8", "#96BDE6", "#E3EEFA"] },
  mars_landing:     { label: "Mars landing",     short: "Mars land.", world: "mars", worldName: "Mars", target: "Jezero crater floor",
                      ramp: ["#2A0F0A", "#6E2414", "#B8442A", "#E38A66", "#F6D3C2"] },
  mars_science:     { label: "Mars science",     short: "Mars sci.",  world: "mars", worldName: "Mars", target: "Jezero delta (olivine–carbonate)",
                      ramp: ["#2A0F0A", "#6E2414", "#B8442A", "#E38A66", "#F6D3C2"] },
  mars_sedimentary: { label: "Mars sedimentary", short: "Mars sed.",  world: "mars", worldName: "Mars", target: "Gale / Meridiani layered sulfates",
                      ramp: ["#22150A", "#5E3A12", "#A86F1E", "#E0AE55", "#F7E2B4"] },
};
export const MISSION_KEYS = Object.keys(MISSIONS);

// Criterion display config, fixed order (raw_* units match sites.geojson). Colours: css/theme.css --c-<k>,
// grouped by family (terrain blues, climate reds, then dryness, water history, geology, access).
export const CRITERIA = [
  { k: "slope",      name: "Slope",            metric: "mean slope",                word: "Terrain",     unit: "°",    dp: 1, min: 0, max: 30,  src: "Copernicus DEM GLO-90 vs LOLA / MOLA" },
  { k: "tri",        name: "Roughness",        metric: "terrain ruggedness (TRI)",  word: "Terrain",     unit: " m",   dp: 1, min: 0, max: 60,  src: "Copernicus DEM vs LOLA / MOLA" },
  { k: "relief",     name: "Local relief",     metric: "relief in 1 km",            word: "Terrain",     unit: " m",   dp: 0, min: 0, max: 400, src: "Copernicus DEM vs LOLA / MOLA" },
  { k: "dT_diurnal", name: "Day–night ΔT",     metric: "day − night LST",           word: "Climate",     unit: " °C",  dp: 1, min: 0, max: 25,  src: "MODIS MOD11A2 LST 2025" },
  { k: "dT_annual",  name: "Annual ΔT",        metric: "annual LST range",          word: "Climate",     unit: " °C",  dp: 1, min: 0, max: 45,  src: "MODIS MOD11A2 LST 2025" },
  { k: "wind",       name: "Wind",             metric: "mean 10 m wind",            word: "Climate",     unit: " m/s", dp: 1, min: 0, max: 8,   src: "NASA POWER WS10M" },
  { k: "ndvi",       name: "Dryness",          metric: "annual max NDVI",           word: "Dryness",     unit: "",     dp: 2, min: 0, max: 0.6, src: "MODIS MOD13Q1 2025" },
  { k: "channels",   name: "Ancient channels", metric: "distance to paleo-channel", word: "Water history", unit: " km", dp: 1, min: 0, max: 30, src: "SAGA channel network, incised ≥ 25 m" },
  { k: "minerals",   name: "Minerals",         metric: "EMIT mineral score",        word: "Geology",     unit: "",     dp: 2, min: 0, max: 1,   src: "NASA EMIT L2B MIN (ISS)" },
  { k: "access",     name: "Access",           metric: "distance to road",          word: "Access",      unit: " km",  dp: 1, min: 0, max: 60,  src: "OpenStreetMap" },
];
export const CRIT = Object.fromEntries(CRITERIA.map(c => [c.k, c]));

export const AOIS = [{ id: "OMAN", name: "Sultanate of Oman", bbox: [51.73, 16.63, 59.94, 26.39] }];

// Validation facts from the 90 m analysis (team hand-off, MAZIN_INTEGRATION.md §4)
export const VALIDATION = {
  auc: { profile: "mars_science", value: 0.84 },
  facts: [
    "Mars science AUC 0.84 against the benchmark outcrops (90 m analysis).",
    "Oman Drilling Project IGSN outcrop: 97th percentile.",
    "Wadi Laywani (independent test site): 86th percentile.",
    "Changing any weight by ±20 % moves results by at most 9 percentile points.",
  ],
  amadee: "AMADEE-18 (Kepler station) scores the 64th percentile for Mars landing and the 47th for sedimentary. It looks like Mars (iron-oxide varnish, mesas), but EMIT finds almost no sulfates or clays there. The index separates visual analogs from mineralogical ones.",
  grid: "The 1 km grid is for interaction. The ranked sites and percentiles come from the 90 m analysis.",
};

async function getJSON(paths) {
  for (const p of paths) {
    try { const r = await fetch(p, { cache: "no-cache" }); if (r.ok) return { body: await r.json(), path: p }; } catch { /* try next */ }
  }
  throw new Error("Missing data file: " + paths.join(" or "));
}
async function getText(paths) {
  for (const p of paths) {
    try { const r = await fetch(p, { cache: "no-cache" }); if (r.ok) return { body: await r.text(), path: p }; } catch { /* try next */ }
  }
  throw new Error("Missing data file: " + paths.join(" or "));
}
/** CSV with quoted fields ("a, b" and "" escapes) */
function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some(x => x !== "")) rows.push(row); row = []; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
function centroid(geom) {
  if (geom.type === "Point") return geom.coordinates;
  const ring = geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates[0][0];
  const n = ring.length; return [ring.reduce((a, p) => a + p[0], 0) / n, ring.reduce((a, p) => a + p[1], 0) / n];
}
/** similarity rule kind from targets.csv "rule" text: gaussian, one-sided (higher / lower is better), or mineral score */
function ruleKind(rule = "") {
  const r = rule.toLowerCase();
  if (r.startsWith("gaussian")) return "gauss";
  if (r.startsWith("class score")) return "score";
  if (/larger is better|stronger is better|far from/.test(r)) return "high";
  if (/calmer|near |s=1 within|s=1 at ndvi|smaller/.test(r)) return "low";
  return r ? "low" : "linear";            // old mock files have no rule: linear ramp
}

export async function loadData() {
  const sites = await getJSON(["data/sites.geojson", "data/mock/sites.geojson"]);
  const weights = await getJSON(["data/weights.json", "data/mock/weights.json"]);
  const targets = await getText(["data/targets.csv", "data/mock/targets.csv"]);
  let twins = null; try { twins = (await getJSON(["data/target_sites.json"])).body; } catch { /* optional */ }
  const isMock = [sites, weights, targets].some(f => f.path.includes("/mock/")) || sites.body.mock === true;

  const byMission = Object.fromEntries(MISSION_KEYS.map(m => [m, []]));
  const byId = {};
  for (const f of sites.body.features) {
    const p = { ...f.properties, lonlat: centroid(f.geometry), geometry: f.geometry };
    if (!byMission[p.profile]) continue;
    byMission[p.profile].push(p);
    (byId[p.id] ??= {})[p.profile] = p;
  }
  for (const m of MISSION_KEYS) byMission[m].sort((a, b) => a.rank - b.rank);

  const tgt = {};
  for (const r of parseCSV(targets.body)) (tgt[r.profile] ??= {})[r.criterion] = { value: +r.value, tol: +r.tolerance, unit: r.unit, body: r.body, site: r.site, source: r.source, rule: r.rule || "", kind: ruleKind(r.rule) };

  const W = weights.body.weights, CRv = weights.body.cr || {};
  /** display-only similarity curve; the s_* values in sites.geojson are the official ones (computed at 90 m) */
  function sim(k, m, x) {
    const t = tgt[m]?.[k]; if (!t) return 0;
    const clamp = v => Math.max(0, Math.min(1, v));
    switch (t.kind) {
      case "gauss": return Math.exp(-((x - t.value) ** 2) / (2 * t.tol * t.tol));
      case "high": return x >= t.value ? 1 : clamp(1 - (t.value - x) / t.tol);
      case "low": return x <= t.value ? 1 : clamp(1 - (x - t.value) / t.tol);
      case "score": return clamp(x);
      default: return clamp(1 - Math.abs(x - t.value) / t.tol);
    }
  }
  /** the range of x that scores above zero (or above 1 % for the gaussian), for the passport band */
  function band(k, m) {
    const t = tgt[m]?.[k]; if (!t) return [0, 0];
    switch (t.kind) {
      case "gauss": return [t.value - 3 * t.tol, t.value + 3 * t.tol];
      case "high": return [t.value - t.tol, Infinity];
      case "low": return [-Infinity, t.value + t.tol];
      case "score": return [0, 1];
      default: return [t.value - t.tol, t.value + t.tol];
    }
  }
  return {
    isMock,
    sites: byMission,
    site: (id, m) => byId[id]?.[m],
    siteIds: Object.keys(byId),
    weights: W, weightsTier1: weights.body.weights_tier1 || null, groups: weights.body.groups || null, cr: CRv, method: weights.body.method || "",
    target: (k, m) => tgt[m]?.[k],
    sim, band,
    twins,                                   // target_sites.json: Moon / Mars targets with their best Oman terrain twins
  };
}
