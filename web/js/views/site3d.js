// SITE 3D — Basir-style close-up of a candidate site.
// Esri World Imagery draped over AWS Terrain Tiles (Terrarium), a pitched camera, the 1 km analysis window,
// the drone survey box and labelled pins on stalks. Uses the MapLibre GL JS 4.x instance of atlas.js.
//
//   import { enterSite3D, exitSite3D, site3DOn } from "./site3d.js";
//   enterSite3D(map, site, { mission, sites: data.sites[mission], drone: DRONE[site.id] });
//   exitSite3D(map);
//
// Data credits to show while active: "Imagery © Esri, Maxar, Earthstar Geographics · Terrain: AWS Terrain Tiles (Mapzen)".

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const BASE = "s2";            // atlas.js basemap layer id
const OVERLAY = "lay-OMAN";   // atlas.js score / criterion image layer id

// Field surveys flown by the team (approximate footprints from the flight plan)
export const DRONE = {
  S05: { label: "Drone survey · 15 Nov", center: [58.354220, 22.598315], ew_m: 860, ns_m: 548 },
};

let state = null;

export const site3DOn = () => !!state;

function boxAround([lon, lat], ew_m, ns_m) {
  const dLat = ns_m / 2 / 111320, dLon = ew_m / 2 / (111320 * Math.cos(lat * Math.PI / 180));
  return [[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]];
}
function circle([lon, lat], km, n = 96) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * 2 * Math.PI;
    out.push([lon + km / (111.32 * Math.cos(lat * Math.PI / 180)) * Math.cos(a), lat + km / 110.57 * Math.sin(a)]);
  }
  return out;
}
const kmBetween = (a, b) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110.57);

function pin(map, lonlat, title, sub, color, big, stalk) {
  const el = document.createElement("div");
  el.className = "pin3d" + (big ? " big" : "");
  el.innerHTML = `<div class="pin3d-label"><b></b>${sub ? "<small></small>" : ""}</div><div class="pin3d-stalk"></div><div class="pin3d-dot"></div>`;
  el.querySelector("b").textContent = title;
  if (sub) el.querySelector("small").textContent = sub;
  el.style.setProperty("--pc", color);
  if (stalk) el.querySelector(".pin3d-stalk").style.height = stalk + "px";   // staggered so close labels don't overlap
  return new window.maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(lonlat).addTo(map);
}

function ensureStyle() {
  if (document.getElementById("pin3d-css")) return;
  const s = document.createElement("style"); s.id = "pin3d-css";
  s.textContent = `
  .pin3d{display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:default}
  .pin3d-label{background:#fff;color:#111;border-radius:6px;padding:4px 9px;box-shadow:0 2px 8px rgba(0,0,0,.35);text-align:center;white-space:nowrap;font:600 13px/1.25 Inter,system-ui,sans-serif}
  .pin3d.big .pin3d-label{font-size:15px;padding:6px 11px}
  .pin3d-label small{display:block;font:500 11px/1.2 Inter,system-ui,sans-serif;color:#555}
  .pin3d-stalk{width:2px;height:46px;background:rgba(255,255,255,.9);box-shadow:0 0 2px rgba(0,0,0,.5)}
  .pin3d.big .pin3d-stalk{height:64px}
  .pin3d-dot{width:12px;height:12px;border-radius:50%;background:var(--pc,#4ea1ff);border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.6);margin-top:-1px}
  .site3d-credit{position:absolute;right:10px;bottom:34px;z-index:5;background:rgba(255,255,255,.92);color:#111;border-radius:999px;padding:4px 10px;font:500 12px Inter,system-ui,sans-serif}`;
  document.head.appendChild(s);
}

/**
 * @param map    MapLibre map (atlas.js)
 * @param site   site object from data.js (needs id, name, lonlat, rank, asi)
 * @param opts   { mission, sites: data.sites[mission], drone: DRONE[site.id], exaggeration }
 */
export function enterSite3D(map, site, opts = {}) {
  ensureStyle();
  if (state) exitSite3D(map, true);
  const before = map.getLayer(OVERLAY) ? OVERLAY : undefined;
  if (!map.getSource("esri")) map.addSource("esri", { type: "raster", tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" });
  if (!map.getLayer("esri")) map.addLayer({ id: "esri", type: "raster", source: "esri" }, before);
  if (!map.getSource("dem3d")) map.addSource("dem3d", { type: "raster-dem", tiles: [DEM], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: AWS Terrain Tiles (Mapzen)" });

  state = {
    pitch: map.getPitch(), bearing: map.getBearing(), maxPitch: map.getMaxPitch(),
    overlayOpacity: map.getLayer(OVERLAY) ? map.getPaintProperty(OVERLAY, "raster-opacity") : null, markers: [],
  };
  if (map.getLayer(BASE)) map.setLayoutProperty(BASE, "visibility", "none");
  map.setLayoutProperty("esri", "visibility", "visible");
  if (map.getLayer(OVERLAY)) map.setPaintProperty(OVERLAY, "raster-opacity", 0.25);   // keep a hint of the score map
  map.setMaxPitch(80);
  map.setTerrain({ source: "dem3d", exaggeration: opts.exaggeration ?? 1.5 });
  try { map.setSky({ "sky-color": "#86b3e8", "horizon-color": "#dfe9f4", "fog-color": "#e9e1d3", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.3 }); } catch (e) { /* older style spec */ }

  // outlines: 1 km analysis window (what the score describes), 5 km zone, drone survey box
  const c = site.lonlat, feats = [
    { type: "Feature", properties: { kind: "window" }, geometry: { type: "Polygon", coordinates: [boxAround(c, 1000, 1000)] } },
    { type: "Feature", properties: { kind: "zone" }, geometry: { type: "LineString", coordinates: circle(c, 5) } },
  ];
  if (opts.drone) feats.push({ type: "Feature", properties: { kind: "drone" }, geometry: { type: "Polygon", coordinates: [boxAround(opts.drone.center, opts.drone.ew_m, opts.drone.ns_m)] } });
  const data = { type: "FeatureCollection", features: feats };
  if (map.getSource("site3d")) map.getSource("site3d").setData(data); else map.addSource("site3d", { type: "geojson", data });
  if (!map.getLayer("site3d-fill")) {
    map.addLayer({ id: "site3d-fill", type: "fill", source: "site3d", filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": ["match", ["get", "kind"], "drone", "#3ea8ff", "#f2c46d"], "fill-opacity": ["match", ["get", "kind"], "drone", 0.22, 0.10] } });
    map.addLayer({ id: "site3d-line", type: "line", source: "site3d", filter: ["!=", ["get", "kind"], "zone"],
      paint: { "line-color": ["match", ["get", "kind"], "drone", "#3ea8ff", "#f2c46d"], "line-width": 2.5 } });
    map.addLayer({ id: "site3d-zone", type: "line", source: "site3d", filter: ["==", ["get", "kind"], "zone"],
      paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [3, 2] } });
  }

  // pins: this site (big), the drone box, other ranked sites within 15 km
  state.markers.push(pin(map, c, site.name, `Rank ${site.rank} · score ${Math.round(site.asi * 100)}/100`, "#f2c46d", true, 70));
  if (opts.drone) state.markers.push(pin(map, opts.drone.center, opts.drone.label, "LiDAR / photos", "#3ea8ff", false, 140));
  let k = 0;
  for (const s of opts.sites || []) {
    if (s.id === site.id) continue;
    const d = kmBetween(c, s.lonlat);
    if (d < 15) state.markers.push(pin(map, s.lonlat, s.name, `#${s.rank} · ${d.toFixed(1)} km`, "#9fd27a", false, [46, 96, 146][k++ % 3]));
  }
  const credit = document.createElement("div"); credit.className = "site3d-credit";
  credit.textContent = "Esri World Imagery · AWS Terrain Tiles"; map.getContainer().appendChild(credit); state.credit = credit;

  const fly = { center: c, zoom: opts.zoom ?? 14, pitch: 65, bearing: opts.bearing ?? -20, duration: 2600, essential: true };
  if (opts.padding) fly.padding = opts.padding;
  map.flyTo(fly);
}

export function exitSite3D(map, quiet) {
  if (!state) return;
  state.markers.forEach(m => m.remove()); state.credit?.remove();
  map.setTerrain(null);
  if (map.getLayer("esri")) map.setLayoutProperty("esri", "visibility", "none");
  if (map.getLayer(BASE)) map.setLayoutProperty(BASE, "visibility", "visible");
  if (map.getLayer(OVERLAY) && state.overlayOpacity != null) map.setPaintProperty(OVERLAY, "raster-opacity", state.overlayOpacity);
  for (const id of ["site3d-zone", "site3d-line", "site3d-fill"]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource("site3d")) map.removeSource("site3d");
  const s = state; state = null;
  if (quiet) { map.setMaxPitch(s.maxPitch); return; }
  map.once("moveend", () => map.setMaxPitch(s.maxPitch));
  map.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
}
