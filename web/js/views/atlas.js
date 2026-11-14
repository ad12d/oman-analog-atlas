// OMAN DESTINATION: the working map. ASI overlay per mission, criterion layers (Strata),
// ranked candidate nodes, and the Analog Passport drawer.
import { h, esc, setKeys, rampColor, hexRgb, cssVar, reduceMotion } from "../core/ui.js";
import { MISSIONS, CRITERIA, AOIS } from "../core/data.js";
import { noise2, fbm } from "../core/noise.js";
import { renderPassport } from "./passport.js";

const BASEMAP = {
  version: 8,
  sources: {
    s2: {
      type: "raster", tileSize: 256, maxzoom: 15,
      tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
      attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)',
    },
  },
  layers: [
    { id: "void", type: "background", paint: { "background-color": "#04060A" } },
    { id: "s2", type: "raster", source: "s2", paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.7, "raster-contrast": 0.08 } },
  ],
};
const VIEW_BOUNDS = [[54.2, 17.7], [59.4, 24.9]];

let map = null;
const imgCache = new Map();

function ensureMap() {
  if (map) return map;
  map = new window.maplibregl.Map({ container: "map", style: BASEMAP, bounds: VIEW_BOUNDS, attributionControl: false, maxPitch: 55, dragRotate: true });
  map.addControl(new window.maplibregl.AttributionControl({ compact: true }), "bottom-right");
  // phones: start with the credits folded into the (i) button so they don't cover the map
  map.once("load", () => {
    if (innerWidth > 980) return;
    const a = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
    if (a) { a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); }
  });
  if (window.__oaa) window.__oaa.map = map;   // QA only
  // Add our layers as soon as the style is ready. ("load" waits for every basemap tile,
  // so on slow Wi-Fi the overlay would appear late or not at all.)
  const addLayers = () => {
    if (ready) return;
    map.addSource("aoi", { type: "geojson", data: { type: "FeatureCollection", features: AOIS.map(a => {
      const [w, s, e, n] = a.bbox; return { type: "Feature", properties: { id: a.id }, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }; }) } });
    map.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#F2C46D", "line-opacity": 0.75, "line-width": 1.2, "line-dasharray": [3, 2] } });
    // the AOI image layers are created by the first paint with their real image (see paintLayers)
    ready = true; queue.splice(0).forEach(fn => fn());
  };
  if (map.isStyleLoaded()) addLayers(); else map.once("style.load", addLayers);
  return map;
}
let ready = false;
const queue = [];
// run fn once the style is ready; a keyed call replaces an earlier queued call with the same key
const whenLoaded = (fn, key) => {
  if (ready) { fn(); return; }
  if (key) { const i = queue.findIndex(f => f.key === key); if (i >= 0) queue.splice(i, 1); fn.key = key; }
  queue.push(fn);
};

// MOCK raster: noise field with each site's score stamped in. Replaced by TiTiler tiles of the real COGs.
function layerImage(aoi, layer, mission, data) {
  const key = `${aoi.id}|${layer}|${mission}`;
  if (imgCache.has(key)) return imgCache.get(key);
  const [w, s, e, n] = aoi.bbox, W = 260, H = Math.round(W * (n - s) / (e - w));
  const seed = layer === "asi" ? 501 : 600 + CRITERIA.findIndex(c => c.k === layer) * 17;
  const nz = noise2(seed + (aoi.id === "AOI-2" ? 3 : 0), 24);
  const sites = data.sites[mission].filter(p => p.aoi.startsWith(aoi.id));
  const val = p => layer === "asi" ? p.asi : +p["s_" + layer];
  const ramp = MISSIONS[mission].ramp, col = layer === "asi" ? null : hexRgb(cssVar(`--c-${layer}`));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const lon = w + (i + .5) / W * (e - w), lat = n - (j + .5) / H * (n - s);
    let v = 0.18 + 0.42 * fbm(nz, i / W * 9, j / H * 9 * H / W, 5);
    for (const p of sites) {
      const d2 = (lon - p.lonlat[0]) ** 2 + (lat - p.lonlat[1]) ** 2, b = Math.exp(-d2 / 0.02);
      v = v * (1 - b) + val(p) * b;
    }
    const o = (j * W + i) * 4;
    if (col) { img.data.set([col[0], col[1], col[2], Math.round(Math.max(0, v - 0.15) / 0.85 * 235)], o); }
    else { const [r, g, b] = rampColor(ramp, v); img.data.set([r, g, b, Math.round(Math.max(0, Math.min(1, (v - 0.3) / 0.35)) * 225)], o); }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL("image/png"); imgCache.set(key, url); return url;
}

let hideTimer = 0;

export default {
  mount({ view, scene, data, store, go, first }, route) {
    document.body.classList.add("map-on");
    const mapEl = document.getElementById("map"), vig = document.getElementById("map-vignette");
    clearTimeout(hideTimer);
    mapEl.hidden = false; vig.hidden = false;
    ensureMap(); map.resize();
    const timers = [];
    if (!first && !reduceMotion) {
      // Dive: the globe camera drops straight onto Oman, the map fades in at matching scale and keeps zooming.
      const fromFar = scene.mode === "director" || scene.mode.startsWith("focus-m");
      mapEl.classList.add("away"); vig.classList.add("away");
      scene.setActive(true); scene.setMode("dive");
      const end = map.cameraForBounds(VIEW_BOUNDS, { padding: pad() });
      map.jumpTo({ center: end.center, zoom: end.zoom - 1.1 });
      timers.push(setTimeout(() => {
        mapEl.classList.remove("away"); vig.classList.remove("away");
        if (route.name !== "site") map.easeTo({ center: end.center, zoom: end.zoom, duration: 2000, easing: t => 1 - Math.pow(1 - t, 3), essential: true });
      }, fromFar ? 1100 : 450));
      timers.push(setTimeout(() => scene.setActive(false), fromFar ? 2300 : 1600));
    } else {
      mapEl.classList.remove("away"); vig.classList.remove("away");
      map.fitBounds(VIEW_BOUNDS, { padding: pad(), duration: 0 });
      scene.setMode("dive", true); scene.setActive(false);
    }

    let layer = "asi", drawerId = null;
    const markers = [];

    const root = h("section", { class: "atlas", "aria-label": "Oman destination map" });
    root.innerHTML = `
      <aside class="rail left live"><div class="panel ticks">
        <div class="panel-head"><span class="panel-title">Strata</span><span class="eyebrow">Layer</span></div>
        <div class="scroll" id="strata"></div>
        <div class="legend-ramp"><span class="eyebrow" id="legName"></span><div class="bar" id="legBar"></div><div class="ends"><span>0 · not alike</span><span>1 · very alike</span></div></div>
      </div></aside>
      <aside class="rail right live" id="rankRail"><div class="panel ticks">
        <button type="button" class="panel-head sheet-head" id="rankHead" aria-expanded="true"><span class="panel-title">Ranked sites</span><span class="eyebrow" id="rankMission"></span></button>
        <div class="scroll" id="ranks"></div>
      </div></aside>
      <aside class="drawer live" id="drawer" aria-label="Analog passport"><div class="panel ticks">
        <div class="panel-head"><span class="panel-title">Analog passport</span><button class="btn" type="button" id="closeDrawer">Close <kbd>Esc</kbd></button></div>
        <div class="scroll" id="pp"></div>
      </div></aside>
      <div class="dcard" id="ncard" aria-hidden="true"></div>`;
    view.appendChild(root);
    const $r = s => root.querySelector(s);

    // phones/tablets: layer chips sit under the header and the site list is a sheet above the footer
    function pad() { const wide = innerWidth > 980, side = innerHeight <= 500 && innerWidth > innerHeight;
      if (!wide && side) return { top: 100, bottom: 50, left: 24, right: Math.min(340, innerWidth * .42) + 24 };
      return wide ? { top: 90, bottom: 80, left: 340, right: 340 } : { top: 130, bottom: Math.round(innerHeight * .34) + 70, left: 24, right: 24 }; }

    /* Strata rail */
    function paintStrata() {
      const W = data.weights[store.mission], R = MISSIONS[store.mission].ramp;
      $r("#strata").innerHTML = `
        <button type="button" class="strat asi" data-l="asi" aria-pressed="${layer === "asi"}" style="--r0:${R[1]};--r1:${R[2]};--r2:${R[3]};--r3:${R[4]}">
          <span class="band"></span><span><b><span class="long">Analog Similarity Index</span><span class="short">ASI</span></b><small>All six criteria, ${esc(MISSIONS[store.mission].label)} weights</small></span><span class="w">Σ</span></button>
        ${CRITERIA.map(c => `<button type="button" class="strat" data-l="${c.k}" aria-pressed="${layer === c.k}" style="--rc:var(--c-${c.k})">
          <span class="band"></span><span><b>${c.name}</b><small>${esc(c.src)}</small><span class="wb" style="width:${W[c.k] * 100}%"></span></span><span class="w">w ${W[c.k].toFixed(2)}</span></button>`).join("")}`;
      const L = layer === "asi" ? null : CRITERIA.find(c => c.k === layer);
      $r("#legName").textContent = L ? `${L.name} similarity` : `ASI · ${MISSIONS[store.mission].label}`;
      $r("#legBar").style.background = L ? `linear-gradient(90deg, transparent, var(--c-${L.k}))` : `linear-gradient(90deg, ${R.join(", ")})`;
    }
    $r("#strata").addEventListener("click", e => { const b = e.target.closest("[data-l]"); if (!b) return; layer = b.dataset.l; paintStrata(); paintLayers(); });

    // debounced: quick layer / mission switches would otherwise cancel each other's image loads (AbortError)
    let layerTimer = 0;
    function paintLayers() { clearTimeout(layerTimer); layerTimer = setTimeout(() => whenLoaded(applyLayers, "layers"), 90); }
    function applyLayers() {
      for (const a of AOIS) {
        const [w, s, e, n] = a.bbox, id = "lay-" + a.id, img = { url: layerImage(a, layer, store.mission, data), coordinates: [[w, n], [e, n], [e, s], [w, s]] };
        const src = map.getSource(id);
        if (src) { src.updateImage(img); continue; }
        map.addSource(id, { type: "image", ...img });
        map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.82, "raster-fade-duration": 250, "raster-resampling": "linear" } }, "aoi-line");
      }
    }

    /* ranked list */
    function paintRanks() {
      const list = data.sites[store.mission];
      $r("#rankMission").textContent = MISSIONS[store.mission].label;
      $r("#ranks").innerHTML = list.map(s => `
        <button type="button" class="rank" data-id="${s.id}">
          <span class="n">${String(s.rank).padStart(2, "0")}</span>
          <span><b>${esc(s.name)}${s.benchmark ? '<span class="bench-tag">B</span>' : ""}</b><small>${esc(s.aoi)}</small><span class="bar"><i style="width:${s.asi * 100}%"></i></span></span>
          <span class="v">${s.asi.toFixed(2)}</span></button>`).join("");
    }
    // on phones the list header folds the sheet down so the whole map is visible
    $r("#rankHead").addEventListener("click", () => {
      const rail = $r("#rankRail"), open = rail.classList.toggle("folded") === false;
      $r("#rankHead").setAttribute("aria-expanded", String(open));
    });
    $r("#ranks").addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (b) go("#site-" + b.dataset.id); });
    $r("#ranks").addEventListener("pointerover", e => { const b = e.target.closest("[data-id]"); markers.forEach(m => m.getElement().classList.toggle("hl", !!b && m.getElement().dataset.id === b.dataset.id)); });
    $r("#ranks").addEventListener("pointerleave", () => markers.forEach(m => m.getElement().classList.remove("hl")));

    /* nodes */
    const card = $r("#ncard");
    function nodeCard(s) {
      const W = data.weights[store.mission];
      return `<div class="band"><h3>${esc(s.name)}</h3><p>${esc(s.aoi)} · rank ${s.rank}${s.benchmark ? " · benchmark" : ""}</p></div>
        <div class="body">
          <div class="kv"><span>ASI · ${esc(MISSIONS[store.mission].label)}</span><span>${s.asi.toFixed(2)}</span></div>
          <div class="mini-cbar">${CRITERIA.map(c => `<div style="--sc:var(--c-${c.k});flex-grow:${W[c.k]}"><i style="width:${s["s_" + c.k] * 100}%"></i></div>`).join("")}</div>
          <div class="kv"><span>Strongest</span><span>${esc(CRITERIA.slice().sort((a, b) => W[b.k] * s["s_" + b.k] - W[a.k] * s["s_" + a.k])[0].name)}</span></div>
        </div><div class="foot">Open passport ▸</div>`;
    }
    function paintNodes() {
      markers.splice(0).forEach(m => m.remove());
      for (const s of data.sites[store.mission].slice().reverse()) {
        const el = h("button", { type: "button", class: `node ${s.rank <= 3 ? "top" : ""} ${s.benchmark ? "bench" : ""}`, "data-id": s.id, "aria-label": `${s.name}, rank ${s.rank}, ASI ${s.asi.toFixed(2)}` },
          `<span class="dia"><b>${s.rank}</b></span><span class="nlab"><b>${esc(s.name)}</b><i>ASI ${s.asi.toFixed(2)}</i></span>`);
        el.addEventListener("pointerenter", () => {
          card.innerHTML = nodeCard(s); card.classList.add("on");
          const r = el.getBoundingClientRect(); let x = r.right + 18, y = r.top - 20;
          const cr = card.getBoundingClientRect(); if (x + cr.width > innerWidth - 12) x = r.left - cr.width - 18; if (y + cr.height > innerHeight - 70) y = innerHeight - 70 - cr.height;
          card.style.left = Math.max(12, x) + "px"; card.style.top = Math.max(70, y) + "px";
          $r(`.rank[data-id="${s.id}"]`)?.classList.add("hl");
        });
        el.addEventListener("pointerleave", () => { card.classList.remove("on"); $r(`.rank[data-id="${s.id}"]`)?.classList.remove("hl"); });
        el.addEventListener("click", ev => { ev.stopPropagation(); go("#site-" + s.id); });
        markers.push(new window.maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(s.lonlat).addTo(map));
      }
    }

    /* drawer */
    const drawer = $r("#drawer");
    function openSite(id) {
      const s = data.site(id, store.mission); if (!s) { go("#oman"); return; }
      drawerId = id; drawer.classList.add("on"); $r("#rankRail").style.visibility = "hidden";
      const pp = $r("#pp"); pp.dataset.sel = pp.dataset.sel || "terrain";
      renderPassport(pp, { data, mission: store.mission, id }); pp.scrollTop = 0;
      const wide = innerWidth > 980;
      map.flyTo({ center: s.lonlat, zoom: 8.4, duration: 1500, essential: true, padding: { top: 80, bottom: 80, left: wide ? 320 : 0, right: wide ? Math.min(660, innerWidth * .5) : 0 } });
    }
    function closeSite() {
      drawerId = null; drawer.classList.remove("on"); $r("#rankRail").style.visibility = "";
      map.fitBounds(VIEW_BOUNDS, { padding: pad(), duration: 1300 });
    }
    $r("#closeDrawer").addEventListener("click", () => go("#oman"));

    function paintAll() { paintStrata(); paintRanks(); paintNodes(); paintLayers(); if (drawerId) renderPassport($r("#pp"), { data, mission: store.mission, id: drawerId }); }
    paintAll();
    const unsub = store.subscribe(paintAll);
    if (route.name === "site") openSite(route.id);

    const onKey = e => { if (e.key === "Escape") { if (drawerId) go("#oman"); else go("#director"); } };
    addEventListener("keydown", onKey);
    setKeys([["Click", "Passport"], ["M", "Mission"], ["Esc", "Back"]]);

    return {
      update(r) { if (r.name === "site") openSite(r.id); else if (drawerId) closeSite(); },
      cleanup() {
        unsub(); clearTimeout(layerTimer); removeEventListener("keydown", onKey); markers.forEach(m => m.remove()); timers.forEach(clearTimeout);
        document.body.classList.remove("map-on"); scene.setActive(true);
        // climb back out: the map fades while the next view moves the globe camera away from Oman
        mapEl.classList.add("away"); vig.classList.add("away");
        hideTimer = setTimeout(() => { mapEl.hidden = true; vig.hidden = true; }, reduceMotion ? 0 : 1000);
      },
    };
  },
};
