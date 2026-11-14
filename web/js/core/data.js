// Loads the data contract files. Real GIS outputs in web/data/ take priority;
// if a file is missing the app falls back to web/data/mock/ and shows the "Mock data" flag.
// Real files (team GIS hand-off): sites.geojson (55 sites x 4 profiles, 90 m analysis), weights.json (AHP tier 2),
// targets.csv (target value + tolerance + the similarity rule per criterion), target_sites.json (terrain twins).
//
// Wording: the interface speaks plainly first ("analog score", "match", "importance") and keeps the technical term
// second (ASI, similarity, AHP weight) so the science stays traceable. All plain texts live here.

export const MISSIONS = {
  moon_base:        { label: "Moon base",        short: "Moon base",  world: "moon", worldName: "the Moon", target: "Lunar south pole (Artemis III regions)",
                      plain: "Where to rehearse building and living at a base near the Moon's south pole.",
                      ramp: ["#0F1B2E", "#24456E", "#4F7FB8", "#96BDE6", "#E3EEFA"] },
  mars_landing:     { label: "Mars landing",     short: "Mars land.", world: "mars", worldName: "Mars", target: "Jezero crater floor",
                      plain: "Where to rehearse landing, driving and working on flat Martian ground like Jezero's crater floor.",
                      ramp: ["#2A0F0A", "#6E2414", "#B8442A", "#E38A66", "#F6D3C2"] },
  mars_science:     { label: "Mars science",     short: "Mars sci.",  world: "mars", worldName: "Mars", target: "Jezero's ancient river delta",
                      plain: "Where to rehearse the search for signs of past life, in rock that formed with water as at Jezero's delta.",
                      ramp: ["#2A0F0A", "#6E2414", "#B8442A", "#E38A66", "#F6D3C2"] },
  mars_sedimentary: { label: "Mars sedimentary", short: "Mars sed.",  world: "mars", worldName: "Mars", target: "Gale and Meridiani layered rocks",
                      plain: "Where to rehearse reading layered rocks laid down in water, like those at Gale crater and Meridiani.",
                      ramp: ["#22150A", "#5E3A12", "#A86F1E", "#E0AE55", "#F7E2B4"] },
};
export const MISSION_KEYS = Object.keys(MISSIONS);

// The ten criteria, fixed order (raw_* units match sites.geojson). Colours: css/theme.css --c-<k>.
//   name  = short plain name shown everywhere      tech = the technical term (shown second, for judges)
//   what  = what we measure, in one plain sentence  why  = why it matters for a Moon or Mars rehearsal
export const CRITERIA = [
  { k: "slope", name: "Slope", tech: "mean slope", word: "Terrain", unit: "°", dp: 1, min: 0, max: 30, src: "Copernicus DEM GLO-90 vs LOLA / MOLA",
    what: "How steep the ground is.",
    why: "Landers, habitats and rovers need gentle ground. Matching the target's slopes lets crews rehearse the same walking and driving." },
  { k: "tri", name: "Roughness", tech: "terrain ruggedness index (TRI)", word: "Terrain", unit: " m", dp: 1, min: 0, max: 60, src: "Copernicus DEM vs LOLA / MOLA",
    what: "How bumpy the ground is: rocks, steps and gullies.",
    why: "Rough ground is what damages wheels and trips astronauts. A good analog is about as rough as the target, not smoother or harder." },
  { k: "relief", name: "Hilliness", tech: "local relief within 1 km", word: "Terrain", unit: " m", dp: 0, min: 0, max: 400, src: "Copernicus DEM vs LOLA / MOLA",
    what: "How much the height changes within one kilometre.",
    why: "Hills cast shadows, block radio links and limit how far a crew can see, which shapes how a base is laid out." },
  { k: "dT_diurnal", name: "Day–night swing", tech: "day − night land surface temperature", word: "Climate", unit: " °C", dp: 1, min: 0, max: 25, src: "MODIS MOD11A2 LST 2025",
    what: "How much the ground cools between day and night.",
    why: "On the Moon and Mars the surface swings by 100 °C or more. No place on Earth comes close, so Oman sites with the biggest swings test equipment best." },
  { k: "dT_annual", name: "Seasonal swing", tech: "annual land surface temperature range", word: "Climate", unit: " °C", dp: 1, min: 0, max: 45, src: "MODIS MOD11A2 LST 2025",
    what: "How much the ground temperature changes over the year.",
    why: "Big seasonal swings stress seals, batteries and materials, as a long mission would." },
  { k: "wind", name: "Wind", tech: "mean wind at 10 m", word: "Climate", unit: " m/s", dp: 1, min: 0, max: 8, src: "NASA POWER WS10M",
    what: "Average wind speed.",
    why: "For Moon and landing rehearsals calm is better. For Mars science, wind-blown sand is part of what makes the site Mars-like." },
  { k: "ndvi", name: "Dryness", tech: "peak vegetation index (NDVI)", word: "Dryness", unit: "", dp: 2, min: 0, max: 0.6, src: "MODIS MOD13Q1 2025",
    what: "How little plant cover there is, measured from space.",
    why: "The Moon and Mars have no plants, so bare ground is the first sign of a good analog." },
  { k: "channels", name: "Ancient riverbeds", tech: "distance to a paleo-channel", word: "Water history", unit: " km", dp: 1, min: 0, max: 30, src: "SAGA channel network, incised ≥ 25 m",
    what: "How far the site is from old, dry river channels.",
    why: "Mars once had rivers and lakes (Jezero was a lake), so channels are where to rehearse the search for past water. The Moon never had rivers, so for a Moon base, farther is better." },
  { k: "minerals", name: "Mars-like minerals", tech: "EMIT mineral score", word: "Geology", unit: "", dp: 2, min: 0, max: 1, src: "NASA EMIT L2B MIN (ISS)",
    what: "Whether a mineral scanner on the space station sees the same water-formed minerals as the target.",
    why: "Oman's serpentine and carbonate rocks match minerals found at Jezero. On Mars, such rocks are where signs of past life would be sought." },
  { k: "access", name: "Road access", tech: "distance to the nearest road", word: "Access", unit: " km", dp: 1, min: 0, max: 60, src: "OpenStreetMap",
    what: "How far the site is from the nearest road.",
    why: "Field teams have to reach the site with vehicles and equipment. A site far from any road is slow and costly to use." },
];
export const CRIT = Object.fromEntries(CRITERIA.map(c => [c.k, c]));

/** how a target's similarity rule works, in plain words (kinds come from targets.csv "rule") */
export const RULE_PLAIN = {
  gauss: "Best when Oman matches the target closely; the match falls off smoothly the further away it is.",
  high: "Higher is better, up to the target value.",
  low: "Lower is better; full marks at or below the target value.",
  score: "Full marks where the space-station scanner clearly detects the matching minerals.",
  linear: "Full marks at the target value, falling to zero at the edge of the allowed range.",
};

/* display helpers: scores out of 100, matches and importance as percentages, percentiles as "better than X %" */
export const score100 = v => Math.round(+v * 100);
export const pctOf = v => Math.round(+v * 100) + "%";
export const betterThan = p => `better than ${Math.round(p)}% of Oman`;

// Readable site names: descriptive names from the team's destination twins; generic "Ibra site 8" reads as "Near Ibra · candidate 8".
const FRIENDLY = { S07: "Mahalih ophiolite (near Ibra)", S11: "Al Mudairib ophiolite hills", S21: "Al Mudairib plain", S29: "Al Qabil plain",
  S34: "Mizayra, Wahiba Sands edge", S43: "Manah gravel plains", S45: "Mabrah foothills", S55: "Uwaybiyat (Al Buraimi)" };
export function friendlyName(id, name) {
  if (FRIENDLY[id]) return FRIENDLY[id];
  const m = String(name).match(/^(.+?) site(?: (\d+))?$/);
  return m ? `Near ${m[1]} · candidate ${m[2] || 1}` : name;
}

export const AOIS = [{ id: "OMAN", name: "Sultanate of Oman", bbox: [51.73, 16.63, 59.94, 26.39] }];

// Validation, from the 90 m analysis (team hand-off, MAZIN_INTEGRATION.md §4), in plain words
export const VALIDATION = {
  auc: { profile: "mars_science", value: 0.84 },
  facts: [
    "Against known analog sites, a real analog spot outranks a random spot in Oman 84 times out of 100 (AUC 0.84, Mars science).",
    "The Oman Drilling Project outcrop (IGSN sample site) scores better than 97% of Oman, and Wadi Laywani, kept aside as an independent test, better than 86%.",
    "Wadi Mansah scores better than 70% of Oman: it is a gravel wadi, a known weak benchmark, so a middling result is expected.",
    "Changing any importance by ±20% moves a site's standing by at most 9 points, so the result is stable.",
  ],
  amadee: "AMADEE-18 (the Austrian Space Forum's 2018 Mars simulation in Dhofar) looks like Mars, with dark iron-oxide varnish and flat-topped hills, but NASA's EMIT mineral scanner finds almost no sulfates or clays there. It scores better than 64% of Oman for Mars landing and 47% for Mars sedimentary. Our index separates looking like Mars from being chemically like Mars.",
  // External benchmark: the Mars Desert Research Station (Utah), scored with exactly the Oman method and no tuning (utah/MDRS_benchmark_results.json)
  mdrs: { moon_base: 98.9, mars_landing: 89.3, mars_science: 88.8, mars_sedimentary: 94.8 },
  mdrsStory: "Built only on Oman, our index independently ranks NASA-famous MDRS (Mars Desert Research Station, Utah) in the top 11%. For Jezero-type astrobiology, Oman's Samail ophiolite beats it: the IGSN outcrop scores 78 against MDRS 54, because MDRS has no serpentine. Utah's colder continental climate gives it bigger temperature swings than anywhere in Oman.",
  grid: "The live map uses a 1 km grid so it can update instantly. The ranked sites and the validation numbers come from the finer 90 m analysis.",
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
    p.name = friendlyName(p.id, p.name);
    if (!byMission[p.profile]) continue;
    byMission[p.profile].push(p);
    (byId[p.id] ??= {})[p.profile] = p;
  }
  for (const m of MISSION_KEYS) byMission[m].sort((a, b) => a.rank - b.rank);

  const tgt = {};
  for (const r of parseCSV(targets.body)) (tgt[r.profile] ??= {})[r.criterion] = { value: +r.value, tol: +r.tolerance, unit: r.unit, body: r.body, site: r.site, source: r.source, rule: r.rule || "", world: r.world_value || "", worldSrc: r.world_source || "", omanNote: r.oman_note || "", kind: ruleKind(r.rule) };

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
