// OMAN DESTINATION: the working map. Live ASI from the team's 1 km grids (js/core/live.js): tune the AHP
// weights, keep-away distances and filters, see the validation meter and your own top sites, click any place
// to see why it scores as it does. Official ranked sites (90 m analysis) open the Analog Passport drawer.
import { h, esc, fmt, setKeys, hexRgb, cssVar, reduceMotion, toast, showTip, hideTip } from "../core/ui.js";
import { MISSIONS, CRITERIA, CRIT, VALIDATION, TOP_N, score100, pctOf, betterThan } from "../core/data.js";
import { computeASI, render, topSites, benchmarks, defaultWeights, normalise, CONSTRAINTS } from "../core/live.js";
import { getGrid } from "../core/grid.js";
import { renderPassport } from "./passport.js";
import { enterSite3D, exitSite3D, site3DOn, DRONE } from "./site3d.js";

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
const VIEW_BOUNDS = [[52.0, 16.7], [59.9, 26.3]];                 // the whole Sultanate
const HACK = { name: "Al Bidiyah", lon: 58.80, lat: 22.45, km: 80 }; // hackathon base; drone range for field checks
const DEF_BUF = { town: 2, village: 1, hamlet: 0.5, roads_major: 0.2, farms: 0.5, oil: 2 };

let map = null;
const critImg = new Map();

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
  // our layers go in as soon as the style is ready ("load" waits for every basemap tile)
  const markReady = () => { ready = true; queue.splice(0).forEach(fn => fn()); };
  if (map.isStyleLoaded()) markReady(); else map.once("style.load", markReady);
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

// weak match → strong match (perceptually ordered, colour-blind safe) — team brief 2, B1
const CRIT_RAMP = [[40,24,64],[87,42,110],[163,65,122],[224,112,91],[246,178,107],[251,229,160]];
function rampAt(s) {
  const f = Math.max(0, Math.min(1, s)) * (CRIT_RAMP.length - 1), i = Math.min(CRIT_RAMP.length - 2, Math.floor(f)), t = f - i;
  return CRIT_RAMP[i].map((v, k) => Math.round(v + (CRIT_RAMP[i + 1][k] - v) * t));
}
const RAMP_CSS = `linear-gradient(90deg, ${CRIT_RAMP.map(c => `rgb(${c.join(",")})`).join(", ")})`;
/** one criterion's match layer as an image: a 0–1 colour ramp; minerals not measured from space are hatched grey */
function criterionImage(G, mission, k) {
  const key = mission + "|" + k; if (critImg.has(key)) return critImg.get(key);
  const pr = G.meta.profiles[mission], L = G.layer(k === "minerals" ? pr.minerals_layer : `${pr.criteria_prefix}.${k}`);
  const cov = k === "minerals" ? G.layer("emit_coverage") : null;          // 1 measured · 0 not measured
  const c = document.createElement("canvas"); c.width = G.W; c.height = G.H;
  const ctx = c.getContext("2d"), img = ctx.createImageData(G.W, G.H), d = img.data;
  for (let i = 0; i < G.N; i++) {
    const v = L[i]; if (v === 255) continue;                                 // sea / outside Oman
    const o = i * 4, x = i % G.W, y = (i / G.W) | 0;
    if (cov && cov[i] !== 1) {                                               // not measured → grey hatch
      if ((x + y) % 6 < 2) { d[o] = d[o + 1] = d[o + 2] = 170; d[o + 3] = 150; }
      continue;
    }
    const [r, g, b] = rampAt(v / 254); d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 205;
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL("image/png"); critImg.set(key, url); return url;
}
// B3: map-list subtitles where the data needs a caveat; road access is not offered as a map
const SUBTITLE = {
  wind: m => m === "mars_science" ? "Regional climate data (≈50 km cells), broad pattern only. For Mars science stronger wind counts as better: wind-blown sand is part of what makes Mars, Mars." : "Regional climate data (≈50 km cells) – broad pattern only",
  channels: () => "How far the site is from old, dry river channels. Dune corridors in the Rub' al Khali are being removed from this layer.",
};
const HIDDEN_LAYERS = new Set(["access"]);
const ord = p => { const n = Math.round(p), s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"); return n + s; };

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
      scene.setActive(true); const landed = scene.setMode("dive");
      const end = map.cameraForBounds(VIEW_BOUNDS, { padding: pad() });
      map.jumpTo({ center: end.center, zoom: end.zoom - 1.1 });
      const reveal = () => {
        if (!alive) return;
        mapEl.classList.remove("away"); vig.classList.remove("away");
        if (route.name !== "site") map.easeTo({ center: end.center, zoom: end.zoom, duration: 2000, easing: t => 1 - Math.pow(1 - t, 3), essential: true });
        timers.push(setTimeout(() => { if (alive) scene.setActive(false); }, 1200));
      };
      // from the Moon or Mars the camera flies back first; the map fades in as it reaches Oman
      if (fromFar) landed.then(reveal); else timers.push(setTimeout(reveal, 450));
    } else {
      mapEl.classList.remove("away"); vig.classList.remove("away");
      map.fitBounds(VIEW_BOUNDS, { padding: pad(), duration: 0 });
      scene.setMode("dive", true); scene.setActive(false);
    }

    let layer = "asi", drawerId = null, tuneOpen = false, listMode = "official", alive = true;
    let G = null, W = null, buf = { ...DEF_BUF }, prot = true, emitOnly = false, topPct = 10, nearOnly = true, st = null, picks = [], bench = [];
    const markers = [], pickMarkers = [];

    const root = h("section", { class: "atlas", "aria-label": "Oman destination map" });
    root.innerHTML = `
      <aside class="rail left live"><div class="panel ticks">
        <div class="panel-head tabs" role="tablist"><button type="button" role="tab" class="tab" data-tab="layers" aria-selected="true">Layers</button><button type="button" role="tab" class="tab" data-tab="tune" aria-selected="false">Your priorities</button></div>
        <div class="scroll" id="strata"></div>
        <div class="legend-ramp"><span class="eyebrow" id="legName"></span><div class="bar" id="legBar"></div><div class="ends"><span id="legLo">no match</span><span id="legHi">1 · very alike</span></div><div class="leg-hatch" id="legHatch" hidden><i></i>not measured from space</div></div>
      </div></aside>
      <aside class="tune live" id="tune" hidden><div class="panel ticks">
        <div class="panel-head"><span class="panel-title">Try your own priorities</span><button type="button" class="vr-x tune-x" id="tuneClose" aria-label="Close">×</button></div>
        <div class="scroll tune-body" id="tuneBody"></div>
      </div></aside>
      <aside class="rail right live" id="rankRail"><div class="panel ticks">
        <button type="button" class="panel-head sheet-head" id="rankHead" aria-expanded="true"><span class="panel-title">Check &amp; sites</span><span class="eyebrow" id="rankMission"></span></button>
        <div class="scroll" id="rankScroll">
          <div class="vmeter" id="vmeter"></div>
          <div class="seg-tabs" role="tablist"><button type="button" class="tab" data-list="official" aria-selected="true">Official top 10</button><button type="button" class="tab" data-list="live" aria-selected="false">Your top 10</button></div>
          <div id="ranks"></div>
        </div>
      </div></aside>
      <aside class="drawer live" id="drawer" aria-label="Analog passport"><div class="panel ticks">
        <div class="panel-head"><span class="panel-title">Analog passport</span><span class="pp-headbtns"><button class="btn" type="button" id="ppMin" aria-pressed="false" title="Shrink the passport to a summary bar">Minimise ▾</button><button class="btn" type="button" id="closeDrawer">Close <kbd>Esc</kbd></button></span></div>
        <div class="scroll" id="pp"></div>
      </div></aside>
      <div class="dcard" id="ncard" aria-hidden="true"></div>
      <div class="explain panel live" id="explain" hidden></div>
      <div class="live-status" id="liveStatus" aria-live="polite"></div>
      <button type="button" class="btn panels-btn" id="panelsBtn" aria-pressed="false" title="Hide the side panels to see the whole map (H)">⤢ Map only</button>`;
    view.appendChild(root);
    const $r = s => root.querySelector(s);

    // phones/tablets: layer chips sit under the header and the site list is a sheet above the footer
    function pad() { const wide = innerWidth > 980, side = innerHeight <= 500 && innerWidth > innerHeight;
      if (!wide && side) return { top: 100, bottom: 50, left: 24, right: Math.min(340, innerWidth * .42) + 24 };
      return wide ? { top: 90, bottom: 80, left: 340, right: 340 } : { top: 130, bottom: Math.round(innerHeight * .34) + 70, left: 24, right: 24 }; }

    /* ---------- layers rail ---------- */
    function paintStrata() {
      const Wn = normalise(W || data.weights[store.mission]), R = MISSIONS[store.mission].ramp;
      $r("#strata").innerHTML = `
        <button type="button" class="strat chip-tune" data-tune aria-pressed="${tuneOpen}"><span class="band" style="--rc:var(--moho)"></span><span><b>Your priorities</b><small>What matters most, what to avoid</small></span><span class="w">⚙</span></button>
        <button type="button" class="strat asi" data-l="asi" aria-pressed="${layer === "asi"}" style="--r0:${R[1]};--r1:${R[2]};--r2:${R[3]};--r3:${R[4]}">
          <span class="band"></span><span><b><span class="long">Analog score</span><span class="short">Score</span></b><small>All ten criteria together · best ${topPct}% of Oman shown</small></span><span class="w">all</span></button>
        ${CRITERIA.filter(c => !HIDDEN_LAYERS.has(c.k)).map(c => `<button type="button" class="strat" data-l="${c.k}" aria-pressed="${layer === c.k}" style="--rc:var(--c-${c.k})">
          <span class="band"></span><span><b>${c.name}</b><small>${esc(SUBTITLE[c.k] ? SUBTITLE[c.k](store.mission) : c.what)}</small><span class="wb" style="width:${Wn[c.k] * 100}%"></span></span><span class="w">${Math.round(Wn[c.k] * 100)}%</span></button>`).join("")}
        <p class="note strat-note" title="Almost all of Oman is within reach of a track, so this map would be one flat colour.">Road access still counts ${Math.round(Wn.access * 100)}% in the score but has no map: almost all of Oman is within reach of a track, so it would be one flat colour.</p>`;
      const L = layer === "asi" ? null : CRIT[layer];
      $r("#legName").textContent = L ? `${L.name}: how well Oman matches` : `Analog score · ${MISSIONS[store.mission].label} · best ${topPct}%`;
      $r("#legBar").style.background = L ? RAMP_CSS : `linear-gradient(90deg, ${R.slice(2).join(", ")})`;
      $r("#legLo").textContent = L ? "0 · nothing like the target" : (st ? `score ${score100(st.cut)}` : "cut-off");
      $r("#legHi").textContent = L ? "1 · same as the target" : "best";
      $r("#legHatch").hidden = !(L && L.k === "minerals");
    }
    $r("#strata").addEventListener("click", e => {
      if (e.target.closest("[data-tune]")) { setTune(!tuneOpen); return; }
      const b = e.target.closest("[data-l]"); if (!b) return; layer = b.dataset.l; paintStrata(); paintLayers();
    });
    root.querySelector(".rail.left .tabs").addEventListener("click", e => { const t = e.target.closest("[data-tab]"); if (t) setTune(t.dataset.tab === "tune"); });

    /* ---------- tune panel ---------- */
    function setTune(on) {
      tuneOpen = on; $r("#tune").hidden = !on;
      root.querySelectorAll(".rail.left .tab").forEach(t => t.setAttribute("aria-selected", String((t.dataset.tab === "tune") === on)));
      paintStrata();
    }
    $r("#tuneClose").addEventListener("click", () => setTune(false));
    function paintTune() {
      if (!G) { $r("#tuneBody").innerHTML = `<p class="note">Loading the map data…</p>`; return; }
      const Wn = normalise(W);
      $r("#tuneBody").innerHTML = `
        <p class="note">Change how much each criterion matters and the map, the check and your top 10 update at once.</p>
        <div class="tune-top"><button type="button" class="btn" id="tuneReset">Back to the experts' choice</button><span class="note" title="Analytic Hierarchy Process; consistency ratio ${(data.cr[store.mission] ?? 0).toFixed(3)} (under 0.10 is consistent)">set with AHP</span></div>
        <h4 class="tune-h">How much each one matters</h4>
        ${CRITERIA.map(c => `<div class="trow"><label for="w_${c.k}"><i style="background:var(--c-${c.k})"></i>${c.name}</label><output id="o_${c.k}">${Math.round(Wn[c.k] * 100)}%</output>
          <input type="range" id="w_${c.k}" data-w="${c.k}" min="0" max="100" value="${Math.round(W[c.k] * 100)}"></div>`).join("")}
        <h4 class="tune-h">Keep away from (people, roads, industry)</h4>
        ${Object.entries(CONSTRAINTS).map(([k, n]) => `<div class="trow"><label for="b_${k}">${esc(n)}</label><output id="ob_${k}">${buf[k] ? buf[k] + " km" : "off"}</output>
          <input type="range" id="b_${k}" data-b="${k}" min="0" max="20" step="0.5" value="${buf[k]}"></div>`).join("")}
        <label class="tchk"><input type="checkbox" id="tProt" ${prot ? "checked" : ""}> Skip nature reserves and protected areas</label>
        <label class="tchk"><input type="checkbox" id="tEmit" ${emitOnly ? "checked" : ""}> Only where minerals were measured from space (EMIT)</label>
        <h4 class="tune-h">Show</h4>
        <div class="trow"><label for="tTop">The best … % of Oman</label><output id="oTop">${topPct}%</output><input type="range" id="tTop" min="1" max="50" value="${topPct}"></div>
        <label class="tchk"><input type="checkbox" id="tNear" ${nearOnly ? "checked" : ""}> Pick sites our drone team can reach (${HACK.km} km of ${HACK.name})</label>
        <p class="note">${esc(VALIDATION.grid)} Tap the map to see why any place scores as it does.</p>`;
    }
    $r("#tuneBody").addEventListener("input", e => {
      const t = e.target;
      if (t.dataset.w) { W[t.dataset.w] = +t.value / 100; const Wn = normalise(W); CRITERIA.forEach(c => { const o = $r("#o_" + c.k); if (o) o.textContent = Math.round(Wn[c.k] * 100) + "%"; }); }
      else if (t.dataset.b) { buf[t.dataset.b] = +t.value; $r("#ob_" + t.dataset.b).textContent = buf[t.dataset.b] ? buf[t.dataset.b] + " km" : "off"; }
      else if (t.id === "tTop") { topPct = +t.value; $r("#oTop").textContent = topPct + "%"; }
      schedule();
    });
    $r("#tuneBody").addEventListener("change", e => {
      if (e.target.id === "tProt") prot = e.target.checked; else if (e.target.id === "tEmit") emitOnly = e.target.checked; else if (e.target.id === "tNear") nearOnly = e.target.checked; else return;
      schedule(0);
    });
    $r("#tuneBody").addEventListener("click", e => { if (!e.target.closest("#tuneReset") || !G) return; W = defaultWeights(G, store.mission); buf = { ...DEF_BUF }; prot = true; emitOnly = false; topPct = 10; paintTune(); schedule(0); });

    /* ---------- live computation (debounced: sliders fire many times a second) ---------- */
    let compTimer = 0;
    function schedule(ms = 120) { clearTimeout(compTimer); $r("#liveStatus").textContent = "Updating…"; compTimer = setTimeout(recompute, ms); }
    function recompute() {
      if (!G || !alive) return;
      const t0 = performance.now(), m = store.mission;
      const s = computeASI(G, m, W, { buffers: buf, excludeProtected: prot, emitOnly });
      const img = render(G, s, { topPct, ramp: MISSIONS[m].ramp.slice(2) });
      st = { ...s, url: img.url, cut: img.cut, coordinates: img.coordinates };
      picks = topSites(G, s, 10, 4, nearOnly ? HACK : null);
      bench = benchmarks(G, s, m);
      const allowed = s.allowed.reduce((a, b) => a + b, 0), all = s.asi.reduce((a, v) => a + (Number.isFinite(v) ? 1 : 0), 0);
      $r("#liveStatus").textContent = `Map updated in ${Math.round(performance.now() - t0)} ms · ${Math.round(allowed / all * 100)}% of Oman can be used`;
      paintStrata(); paintMeter(); paintRanks(); paintPicks(); paintLayers();
    }

    /* ---------- map image layer ---------- */
    let layerTimer = 0;
    function paintLayers() { clearTimeout(layerTimer); layerTimer = setTimeout(() => whenLoaded(applyLayers, "layers"), 60); }
    function applyLayers() {
      if (!G || !alive) return;
      const url = layer === "asi" ? st?.url : criterionImage(G, store.mission, layer); if (!url) return;
      const img = { url, coordinates: G.meta.corners_lonlat }, src = map.getSource("lay-OMAN");
      if (src) { src.updateImage(img); setResampling(); return; }
      map.addSource("lay-OMAN", { type: "image", ...img });
      map.addLayer({ id: "lay-OMAN", type: "raster", source: "lay-OMAN", paint: { "raster-opacity": 0.85, "raster-fade-duration": 200, "raster-resampling": layer === "asi" ? "nearest" : "linear" } });
    }
    // crisp cells for the score, smooth for the criterion ramps (brief 2, B1)
    function setResampling() { if (map.getLayer("lay-OMAN")) map.setPaintProperty("lay-OMAN", "raster-resampling", layer === "asi" ? "nearest" : "linear"); }

    /* ---------- validation meter ---------- */
    function paintMeter() {
      const m = store.mission, el = $r("#vmeter");
      const rows = bench.length ? bench.map(b => `<li class="${b.pass ? "ok" : "no"}"><span><b>${esc(b.name.split(" – ")[0].split(" (")[0])}</b><small>${b.use === "calibrate" ? "known site, used to tune the score" : "independent test site"}</small></span>
          <span class="pct" title="${b.percentile == null ? "" : ord(b.percentile) + " percentile"}">${b.percentile == null ? "–" : `beats ${Math.round(b.percentile)}%`}<i>${b.pass ? "✓" : "✗"}</i></span></li>`).join("")
        : `<li class="none">Oman has no known analog site for this mission yet, so there is nothing to check against.</li>`;
      const extra = m === "mars_science" ? `<p class="note">Official result: ${esc(VALIDATION.facts.join(" "))}</p>`
        : (m === "mars_landing" || m === "mars_sedimentary") ? `<p class="note">${esc(VALIDATION.amadee)}</p>` : "";
      el.innerHTML = `<p class="eyebrow">Reality check · live</p><p class="note">Places scientists already use as ${esc(MISSIONS[m].worldName === "the Moon" ? "Moon" : "Mars")} analogs should score better than at least 80% of Oman. Do they, with your priorities?</p><ul class="vlist">${rows}</ul>${extra}`;
    }

    /* ---------- ranked lists ---------- */
    function paintRanks() {
      $r("#rankMission").textContent = MISSIONS[store.mission].label;
      root.querySelectorAll("[data-list]").forEach(t => t.setAttribute("aria-selected", String(t.dataset.list === listMode)));
      if (listMode === "live") {
        $r("#ranks").innerHTML = picks.length ? picks.map((p, i) => `
          <button type="button" class="rank live-pick" data-pick="${i}">
            <span class="n">L${i + 1}</span><span><b>${p.lat.toFixed(3)}° N, ${p.lon.toFixed(3)}° E</b><small>3 × 3 km area · ${nearOnly ? `within ${HACK.km} km of ${HACK.name}` : "anywhere in Oman"}</small><span class="bar"><i style="width:${Math.min(100, p.asi * 100)}%"></i></span></span>
            <span class="v">${score100(p.asi)}</span></button>`).join("") + `<p class="note" style="padding:8px 16px">Your top 10 is ranked with your own priorities on the quick 1 km map. The official ranking uses the detailed 90 m analysis.</p>`
          : `<p class="note" style="padding:12px 16px">${G ? "No usable land matches these settings. Try relaxing a keep-away distance." : "Loading the map data…"}</p>`;
        return;
      }
      const list = data.top(store.mission);
      $r("#ranks").innerHTML = `<p class="note rank-note">The ${TOP_N} best sites for ${esc(MISSIONS[store.mission].label)}, from the team's detailed 90 m analysis.</p>` + list.map(s => `
        <button type="button" class="rank" data-id="${s.id}">
          <span class="n">${String(s.rank).padStart(2, "0")}</span>
          <span><b>${esc(s.name)}${s.benchmark ? '<span class="bench-tag">B</span>' : ""}${(s.group || []).includes("drone_range") ? '<span class="bench-tag drone">80 km</span>' : ""}</b><small>${esc(s.aoi)}</small><span class="bar"><i style="width:${s.asi * 100}%"></i></span></span>
          <span class="v" title="Analog score out of 100 (ASI ${s.asi.toFixed(2)})">${score100(s.asi)}</span></button>`).join("");
    }
    root.querySelector(".seg-tabs").addEventListener("click", e => { const t = e.target.closest("[data-list]"); if (!t) return; listMode = t.dataset.list; paintRanks(); paintPicks(); });
    $r("#rankHead").addEventListener("click", () => {
      const rail = $r("#rankRail"), open = rail.classList.toggle("folded") === false;
      $r("#rankHead").setAttribute("aria-expanded", String(open));
    });
    $r("#ranks").addEventListener("click", e => {
      const b = e.target.closest("[data-id]"); if (b) { go("#site-" + b.dataset.id); return; }
      const p = e.target.closest("[data-pick]"); if (p) { const k = picks[+p.dataset.pick]; map.flyTo({ center: [k.lon, k.lat], zoom: 9, duration: 1200, essential: true }); explainAt(k.lon, k.lat); }
    });
    $r("#ranks").addEventListener("pointerover", e => { const b = e.target.closest("[data-id]"); markers.forEach(m => m.getElement().classList.toggle("hl", !!b && m.getElement().dataset.id === b.dataset.id)); });
    $r("#ranks").addEventListener("pointerleave", () => markers.forEach(m => m.getElement().classList.remove("hl")));

    /* ---------- official site nodes ---------- */
    const card = $r("#ncard");
    function nodeCard(s) {
      const Wd = data.weights[store.mission];
      return `<div class="band"><h3>${esc(s.name)}</h3><p>${esc(s.aoi)} · rank ${s.rank}${s.benchmark ? " · benchmark" : ""}</p></div>
        <div class="body">
          <div class="kv"><span>Analog score · ${esc(MISSIONS[store.mission].label)}</span><span>${score100(s.asi)} / 100</span></div>
          <div class="mini-cbar">${CRITERIA.map(c => `<div style="--sc:var(--c-${c.k});flex-grow:${Wd[c.k]}"><i style="width:${s["s_" + c.k] * 100}%"></i></div>`).join("")}</div>
          <div class="kv"><span>Best match</span><span>${esc(CRITERIA.slice().sort((a, b) => Wd[b.k] * s["s_" + b.k] - Wd[a.k] * s["s_" + a.k])[0].name)}</span></div>
        </div><div class="foot">Open passport ▸</div>`;
    }
    function paintNodes() {
      markers.splice(0).forEach(m => m.remove());
      for (const s of data.top(store.mission).slice().reverse()) {
        const el = h("button", { type: "button", class: `node ${s.rank <= 3 ? "top" : ""} ${s.benchmark ? "bench" : ""}`, "data-id": s.id, "aria-label": `${s.name}, rank ${s.rank}, ASI ${s.asi.toFixed(2)}` },
          `<span class="dia"><b>${s.rank}</b></span><span class="nlab"><b>${esc(s.name)}</b><i>score ${Math.round(s.asi * 100)}</i></span>`);
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
    /* live picks: ring markers, shown while the "Your top 10" list is open */
    function paintPicks() {
      pickMarkers.splice(0).forEach(m => m.remove());
      if (listMode !== "live") return;
      picks.forEach((p, i) => {
        const el = h("button", { type: "button", class: "pick", "aria-label": `Live pick ${i + 1}, score ${Math.round(p.asi * 100)}` }, `<b>L${i + 1}</b>`);
        el.addEventListener("click", ev => { ev.stopPropagation(); explainAt(p.lon, p.lat); });
        pickMarkers.push(new window.maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lon, p.lat]).addTo(map));
      });
    }

    /* ---------- B2: the measured value as well as the match, for the active criterion layer ---------- */
    const kmApart = (a, b) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110.57);
    function measuredLine(k, lon, lat, i) {
      const c = CRIT[k], m = store.mission, pr = G.meta.profiles[m], t = data.target(k, m);
      if (k === "minerals" && G.layer("emit_coverage")[i] !== 1) return `${c.name}: not measured from space here`;
      const s = G.layer(k === "minerals" ? pr.minerals_layer : `${pr.criteria_prefix}.${k}`)[i];
      if (s === 255) return null;
      let near = null, best = 6;                       // nearest analysed site within 6 km gives the measured value
      for (const x of data.sites[m]) { const d = kmApart([lon, lat], x.lonlat); if (d < best && Number.isFinite(+x["raw_" + k])) { best = d; near = x; } }
      const where = MISSIONS[m].world === "moon" ? "Moon" : "Mars", tv = t.world || `${fmt(t.value, c.dp)}${c.unit}`;
      const here = near ? `${fmt(+near["raw_" + k], c.dp)}${c.unit}${best > 1 ? ` (at ${near.name}, ${best.toFixed(1)} km away)` : ""}` : "match only (1 km grid)";
      return `${c.name} here: ${here} · ${where}: ${tv} · match ${Math.round(s / 254 * 100)}%`;
    }
    let hoverRaf = 0;
    const onMapMove = e => {
      if (layer === "asi" || drawerId || !G || site3DOn()) { hideTip(); return; }
      cancelAnimationFrame(hoverRaf);
      hoverRaf = requestAnimationFrame(() => {
        const [px, py] = G.toPx(e.lngLat.lng, e.lngLat.lat), col = Math.floor(px), row = Math.floor(py);
        if (col < 0 || row < 0 || col >= G.W || row >= G.H) { hideTip(); return; }
        const t = measuredLine(layer, e.lngLat.lng, e.lngLat.lat, row * G.W + col);
        if (t) showTip(`<span class="mono">${esc(t)}</span>`, e.originalEvent.clientX, e.originalEvent.clientY); else hideTip();
      });
    };
    map.on("mousemove", onMapMove); map.on("mouseout", hideTip);

    /* ---------- click a place: why does it score this way? ---------- */
    function explainAt(lon, lat) {
      const ex = $r("#explain"); if (!G || !st) return;
      const [px, py] = G.toPx(lon, lat), col = Math.floor(px), row = Math.floor(py);
      if (col < 0 || row < 0 || col >= G.W || row >= G.H) { ex.hidden = true; return; }
      const i = row * G.W + col, v = st.asi[i];
      if (!Number.isFinite(v)) { ex.innerHTML = `<button type="button" class="vr-x" data-close aria-label="Close">×</button><p class="note">No data here (outside Oman, or the satellites have a gap).</p>`; ex.hidden = false; return; }
      const pr = G.meta.profiles[store.mission], Wn = normalise(W);
      const why = Object.entries(CONSTRAINTS).filter(([k]) => buf[k] > 0).map(([k, nm]) => { const d = G.layer("dist." + k)[i]; return d !== 255 && d / 10 < buf[k] ? `${nm} ${(d / 10).toFixed(1)} km away` : null; }).filter(Boolean);
      if (prot && G.layer("dist.protected")[i] === 0) why.push("inside a protected area");
      if (emitOnly && G.layer("emit_coverage")[i] !== 1) why.push("no mineral reading from space here");
      const rows = CRITERIA.map(c => { const s = G.layer(c.k === "minerals" ? pr.minerals_layer : `${pr.criteria_prefix}.${c.k}`)[i] / 254;
        return `<tr><td><i class="chip-dot" style="--rc:var(--c-${c.k})"></i>${c.name}</td><td class="v">${Math.round(s * 100)}%</td><td class="v mut">${Math.round(Wn[c.k] * 100)}%</td></tr>`; }).join("");
      ex.innerHTML = `<button type="button" class="vr-x" data-close aria-label="Close">×</button>
        <p class="eyebrow">${lat.toFixed(3)}° N, ${lon.toFixed(3)}° E · 1 km square</p>
        ${layer !== "asi" ? `<p class="ex-measured">${esc(measuredLine(layer, lon, lat, i) || "")}</p>` : ""}
        <p class="ex-asi">Analog score <b>${score100(v)}</b> / 100${st.allowed[i] ? (v >= st.cut ? ` <span class="ok">among your best ${topPct}%</span>` : "") : ` <span class="bad">left out${why.length ? ": " + esc(why.join(", ")) : ""}</span>`}</p>
        <table class="ex-table"><thead><tr><th>Criterion</th><th>Match</th><th>Matters</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="note">Score = each match × how much it matters, added up.</p>`;
      ex.hidden = false;
    }
    $r("#explain").addEventListener("click", e => { if (e.target.closest("[data-close]")) $r("#explain").hidden = true; });
    const onMapClick = e => { if (drawerId) return; explainAt(e.lngLat.lng, e.lngLat.lat); };
    map.on("click", onMapClick);

    /* ---------- passport drawer ---------- */
    const drawer = $r("#drawer");
    function openSite(id) {
      const s = data.site(id, store.mission); if (!s) { go("#oman"); return; }
      if (site3DOn() && drawerId !== id) exit3D(true);
      if (drawerId !== id && !site3DOn()) setMini(false);
      drawerId = id; drawer.classList.add("on"); $r("#rankRail").style.visibility = "hidden"; $r("#explain").hidden = true; setTune(false);
      const pp = $r("#pp");
      renderPassport(pp, { data, mission: store.mission, id }); pp.scrollTop = 0;
      const wide = innerWidth > 980;
      map.flyTo({ center: s.lonlat, zoom: 9, duration: 1500, essential: true, padding: { top: 80, bottom: 80, left: wide ? 320 : 0, right: wide ? Math.min(660, innerWidth * .5) : 0 } });
    }
    function closeSite() {
      if (site3DOn()) { exit3D(true); map.jumpTo({ pitch: 0, bearing: 0 }); }
      setMini(false);
      drawerId = null; drawer.classList.remove("on"); $r("#rankRail").style.visibility = "";
      map.fitBounds(VIEW_BOUNDS, { padding: pad(), duration: 1300 });
    }
    $r("#closeDrawer").addEventListener("click", () => go("#oman"));

    /* ---------- panels out of the way: "Map only" hides the side panels; the passport can shrink to a summary bar ---------- */
    let panelsMin = false, before3D = null;
    function setPanels(min) {
      panelsMin = min; root.classList.toggle("panels-min", min);
      const b = $r("#panelsBtn"); b.setAttribute("aria-pressed", String(min)); b.textContent = min ? "Show panels" : "⤢ Map only";
    }
    function setMini(on) {
      drawer.classList.toggle("mini", on); const b = $r("#ppMin"); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "Details ▴" : "Minimise ▾";
    }
    $r("#panelsBtn").addEventListener("click", () => setPanels(!panelsMin));
    $r("#ppMin").addEventListener("click", () => setMini(!drawer.classList.contains("mini")));

    /* ---------- C: 3D site view (Esri imagery on AWS terrain, team brief 2) ---------- */
    function exit3D(quiet) {
      exitSite3D(map, quiet); markers.forEach(m => { m.getElement().style.visibility = ""; }); pickMarkers.forEach(m => { m.getElement().style.visibility = ""; });
      if (before3D) { setPanels(before3D.panels); setMini(before3D.mini); before3D = null; } root.classList.remove("in3d");
      root.querySelector("#exag")?.remove(); const b = $r("#pp #site3dBtn"); if (b) b.textContent = "View site in 3D";
    }
    $r("#pp").addEventListener("click", e => {
      const b = e.target.closest("#site3dBtn"); if (!b || !drawerId) return;
      if (site3DOn()) { exit3D(false); return; }
      const s = data.site(drawerId, store.mission), wide = innerWidth > 980;
      markers.forEach(m => { m.getElement().style.visibility = "hidden"; }); pickMarkers.forEach(m => { m.getElement().style.visibility = "hidden"; });
      before3D = { panels: panelsMin, mini: drawer.classList.contains("mini") }; setPanels(true); setMini(true); root.classList.add("in3d");
      enterSite3D(map, s, {
        mission: store.mission,
        sites: data.top(store.mission),            // nearby top-10 sites within 15 km get pins
        drone: DRONE[s.id],                        // S05 has the 15 Nov drone survey box
        padding: wide ? { top: 120, bottom: 90, left: 40, right: 40 } : { top: 230, bottom: 120, left: 10, right: 10 },   // the compact layout leaves the view open
      });
      b.textContent = "Back to the 2D map";
      const ex = h("div", { class: "exag panel live", id: "exag" }, `<label for="exagR">Height exaggeration <b id="exagV">1.5×</b></label><input type="range" id="exagR" min="1" max="2.5" step="0.1" value="1.5">`);
      root.appendChild(ex);
      ex.querySelector("#exagR").addEventListener("input", ev => { const v = +ev.target.value; ex.querySelector("#exagV").textContent = v.toFixed(1) + "×"; if (map.getSource("dem3d")) map.setTerrain({ source: "dem3d", exaggeration: v }); });
      toast("3D view: drag to move, right-drag or Ctrl-drag to tilt and turn");
    });

    function onMission() {
      if (G) W = defaultWeights(G, store.mission);
      paintTune(); paintNodes(); paintRanks();
      if (drawerId) renderPassport($r("#pp"), { data, mission: store.mission, id: drawerId });
      if (G) schedule(0); else paintStrata();
    }
    W = { ...data.weights[store.mission] };
    paintStrata(); paintTune(); paintMeter(); paintRanks(); paintNodes();
    const unsub = store.subscribe(onMission);
    if (route.name === "site") openSite(route.id);

    $r("#liveStatus").textContent = "Loading the map data…";
    getGrid().then(g => { if (!alive) return; G = g; W = defaultWeights(G, store.mission); paintTune(); recompute(); })
      .catch(err => { $r("#liveStatus").textContent = "The live map could not load: " + err.message; });

    const onKey = e => {
      if ((e.key === "h" || e.key === "H") && !e.target.closest("input, textarea, select") && !e.ctrlKey && !e.metaKey) { setPanels(!panelsMin); return; }
      if (e.key === "Escape") { if (!$r("#explain").hidden) $r("#explain").hidden = true; else if (drawerId) go("#oman"); else if (tuneOpen) setTune(false); else go("#director"); } };
    addEventListener("keydown", onKey);
    setKeys([["Click", "Explain"], ["H", "Map only"], ["M", "Mission"], ["Esc", "Back"]]);

    return {
      update(r) { if (r.name === "site") openSite(r.id); else if (drawerId) closeSite(); },
      cleanup() {
        alive = false; unsub(); clearTimeout(layerTimer); clearTimeout(compTimer); map.off("click", onMapClick); map.off("mousemove", onMapMove); map.off("mouseout", hideTip); hideTip();
        if (site3DOn()) exit3D(true);
        removeEventListener("keydown", onKey); markers.forEach(m => m.remove()); pickMarkers.forEach(m => m.remove()); timers.forEach(clearTimeout);
        document.body.classList.remove("map-on"); scene.setActive(true);
        // climb back out: the map fades while the next view moves the globe camera away from Oman
        mapEl.classList.add("away"); vig.classList.add("away");
        hideTimer = setTimeout(() => { mapEl.hidden = true; vig.hidden = true; }, reduceMotion ? 0 : 1000);
      },
    };
  },
};
