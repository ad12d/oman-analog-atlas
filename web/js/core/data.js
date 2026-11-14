// Loads the data contract files. Real GIS outputs in web/data/ take priority;
// if a file is missing the app falls back to web/data/mock/ and shows the "Mock data" flag.

export const MISSIONS = {
  moon_base:    { label: "Moon base",    world: "moon", worldName: "the Moon", target: "Shackleton connecting ridge",
                  ramp: ["#0F1B2E", "#24456E", "#4F7FB8", "#96BDE6", "#E3EEFA"] },
  mars_landing: { label: "Mars landing", world: "mars", worldName: "Mars", target: "Jezero crater floor",
                  ramp: ["#2A0F0A", "#6E2414", "#B8442A", "#E38A66", "#F6D3C2"] },
  mars_science: { label: "Mars science", world: "mars", worldName: "Mars", target: "Jezero delta front",
                  ramp: ["#2A0F0A", "#6E2414", "#B8442A", "#E38A66", "#F6D3C2"] },
};
export const MISSION_KEYS = Object.keys(MISSIONS);

// Criterion display config (order = validated colour order).
export const CRITERIA = [
  { k: "terrain",  name: "Terrain",         metric: "mean slope",          word: "Topography",  unit: "°",   dp: 1, min: 0,   max: 30,  src: "Copernicus DEM GLO-30" },
  { k: "dryness",  name: "Dryness",         metric: "annual max NDVI",     word: "Environment", unit: "",    dp: 2, min: 0,   max: 0.6, src: "MODIS MOD13Q1" },
  { k: "minerals", name: "Minerals",        metric: "serpentine–carbonate index", word: "Geology", unit: "", dp: 2, min: 0, max: 1, src: "ASTER band ratios · EMIT L2B MIN" },
  { k: "thermal",  name: "Thermal range",   metric: "day − night LST",     word: "Environment", unit: " K",  dp: 0, min: 0,   max: 300, src: "MODIS MOD11A2 LST" },
  { k: "radar",    name: "Radar roughness", metric: "σ⁰ backscatter",      word: "Topography",  unit: " dB", dp: 1, min: -25, max: 0,   src: "RADARSAT-1 (CSA) · Sentinel-1" },
  { k: "access",   name: "Access",          metric: "distance to road",    word: "Operations",  unit: " km", dp: 1, min: 0,   max: 30,  src: "OpenStreetMap" },
];
export const CRIT = Object.fromEntries(CRITERIA.map(c => [c.k, c]));

export const AOIS = [
  { id: "AOI-1", name: "Samail ophiolite belt", bbox: [56.2, 22.4, 59.0, 24.6] },
  { id: "AOI-2", name: "Dhofar / Marmul zone", bbox: [54.5, 18.0, 56.0, 19.5] },
];

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
function parseCSV(text) {
  const [head, ...rows] = text.trim().split(/\r?\n/).map(l => l.split(","));
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]?.trim()])));
}
function centroid(geom) {
  if (geom.type === "Point") return geom.coordinates;
  const ring = geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates[0][0];
  const n = ring.length; return [ring.reduce((a, p) => a + p[0], 0) / n, ring.reduce((a, p) => a + p[1], 0) / n];
}

export async function loadData() {
  const sites = await getJSON(["data/sites.geojson", "data/mock/sites.geojson"]);
  const weights = await getJSON(["data/weights.json", "data/mock/weights.json"]);
  const targets = await getText(["data/targets.csv", "data/mock/targets.csv"]);
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
  for (const r of parseCSV(targets.body)) (tgt[r.profile] ??= {})[r.criterion] = { value: +r.value, tol: +r.tolerance, unit: r.unit, body: r.body, site: r.site, source: r.source };

  const W = weights.body.weights, CRv = weights.body.cr || {};
  return {
    isMock,
    sites: byMission,
    site: (id, m) => byId[id]?.[m],
    siteIds: Object.keys(byId),
    weights: W, cr: CRv,
    target: (k, m) => tgt[m]?.[k],
    sim(k, m, x) { const t = tgt[m]?.[k]; return t ? Math.max(0, 1 - Math.abs(x - t.value) / t.tol) : 0; },
  };
}
