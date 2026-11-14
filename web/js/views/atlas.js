// OMAN DESTINATION: the working map. Live ASI from the team's 1 km grids (js/core/live.js): tune the AHP
// weights, keep-away distances and filters, see the validation meter and your own top sites, click any place
// to see why it scores as it does. Official ranked sites (90 m analysis) open the Analog Passport drawer.
import { h, esc, setKeys, hexRgb, cssVar, reduceMotion, toast } from "../core/ui.js";
import { MISSIONS, CRITERIA, CRIT, VALIDATION } from "../core/data.js";
import { computeASI, render, topSites, benchmarks, defaultWeights, normalise, CONSTRAINTS } from "../core/live.js";
import { getGrid } from "../core/grid.js";
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

/** one criterion's similarity layer as an image: criterion colour, opacity grows with similarity */
function criterionImage(G, mission, k) {
  const key = mission + "|" + k; if (critImg.has(key)) return critImg.get(key);
  const pr = G.meta.profiles[mission], L = G.layer(k === "minerals" ? pr.minerals_layer : `${pr.criteria_prefix}.${k}`);
  const [r, g, b] = hexRgb(cssVar(`--c-${k}`));
  const c = document.createElement("canvas"); c.width = G.W; c.height = G.H;
  const ctx = c.getContext("2d"), img = ctx.createImageData(G.W, G.H), d = img.data;
  for (let i = 0; i < G.N; i++) { const v = L[i]; if (v === 255) continue; const s = v / 254; if (s < .12) continue; const o = i * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = Math.round(30 + s * 200); }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL("image/png"); critImg.set(key, url); return url;
}
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

    let layer = "asi", drawerId = null, tuneOpen = false, listMode = "official", alive = true;
    let G = null, W = null, buf = { ...DEF_BUF }, prot = true, emitOnly = false, topPct = 10, nearOnly = true, st = null, picks = [], bench = [];
    const markers = [], pickMarkers = [];

    const root = h("section", { class: "atlas", "aria-label": "Oman destination map" });
    root.innerHTML = `
      <aside class="rail left live"><div class="panel ticks">
        <div class="panel-head tabs" role="tablist"><button type="button" role="tab" class="tab" data-tab="layers" aria-selected="true">Layers</button><button type="button" role="tab" class="tab" data-tab="tune" aria-selected="false">Tune live</button></div>
        <div class="scroll" id="strata"></div>
        <div class="legend-ramp"><span class="eyebrow" id="legName"></span><div class="bar" id="legBar"></div><div class="ends"><span id="legLo">0 · not alike</span><span id="legHi">1 · very alike</span></div></div>
      </div></aside>
      <aside class="tune live" id="tune" hidden><div class="panel ticks">
        <div class="panel-head"><span class="panel-title">Tune the index</span><button type="button" class="vr-x tune-x" id="tuneClose" aria-label="Close">×</button></div>
        <div class="scroll tune-body" id="tuneBody"></div>
      </div></aside>
      <aside class="rail right live" id="rankRail"><div class="panel ticks">
        <button type="button" class="panel-head sheet-head" id="rankHead" aria-expanded="true"><span class="panel-title">Validation &amp; sites</span><span class="eyebrow" id="rankMission"></span></button>
        <div class="scroll" id="rankScroll">
          <div class="vmeter" id="vmeter"></div>
          <div class="seg-tabs" role="tablist"><button type="button" class="tab" data-list="official" aria-selected="true">Official · 90 m</button><button type="button" class="tab" data-list="live" aria-selected="false">Your picks · live</button></div>
          <div id="ranks"></div>
        </div>
      </div></aside>
      <aside class="drawer live" id="drawer" aria-label="Analog passport"><div class="panel ticks">
        <div class="panel-head"><span class="panel-title">Analog passport</span><button class="btn" type="button" id="closeDrawer">Close <kbd>Esc</kbd></button></div>
        <div class="scroll" id="pp"></div>
      </div></aside>
      <div class="dcard" id="ncard" aria-hidden="true"></div>
      <div class="explain panel live" id="explain" hidden></div>
      <div class="live-status" id="liveStatus" aria-live="polite"></div>`;
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
        <button type="button" class="strat chip-tune" data-tune aria-pressed="${tuneOpen}"><span class="band" style="--rc:var(--moho)"></span><span><b>Tune live</b><small>Weights, keep-away, filters</small></span><span class="w">⚙</span></button>
        <button type="button" class="strat asi" data-l="asi" aria-pressed="${layer === "asi"}" style="--r0:${R[1]};--r1:${R[2]};--r2:${R[3]};--r3:${R[4]}">
          <span class="band"></span><span><b><span class="long">Analog Similarity Index</span><span class="short">ASI</span></b><small>Top ${topPct}% of allowed land · ${esc(MISSIONS[store.mission].label)}</small></span><span class="w">Σ</span></button>
        ${CRITERIA.map(c => `<button type="button" class="strat" data-l="${c.k}" aria-pressed="${layer === c.k}" style="--rc:var(--c-${c.k})">
          <span class="band"></span><span><b>${c.name}</b><small>${esc(c.src)}</small><span class="wb" style="width:${Wn[c.k] * 100}%"></span></span><span class="w">${Math.round(Wn[c.k] * 100)}%</span></button>`).join("")}`;
      const L = layer === "asi" ? null : CRIT[layer];
      $r("#legName").textContent = L ? `${L.name} similarity` : `ASI · ${MISSIONS[store.mission].label} · top ${topPct}%`;
      $r("#legBar").style.background = L ? `linear-gradient(90deg, transparent, var(--c-${L.k}))` : `linear-gradient(90deg, ${R.slice(2).join(", ")})`;
      $r("#legLo").textContent = L ? "0 · not alike" : (st ? `ASI ${st.cut.toFixed(2)}` : "cut-off");
      $r("#legHi").textContent = L ? "1 · very alike" : "best";
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
      if (!G) { $r("#tuneBody").innerHTML = `<p class="note">Loading the 1 km grids…</p>`; return; }
      const Wn = normalise(W);
      $r("#tuneBody").innerHTML = `
        <div class="tune-top"><button type="button" class="btn" id="tuneReset">Reset to AHP</button><span class="note">AHP default · CR ${(data.cr[store.mission] ?? 0).toFixed(3)}</span></div>
        <h4 class="tune-h">Criterion weights</h4>
        ${CRITERIA.map(c => `<div class="trow"><label for="w_${c.k}"><i style="background:var(--c-${c.k})"></i>${c.name}</label><output id="o_${c.k}">${Math.round(Wn[c.k] * 100)}%</output>
          <input type="range" id="w_${c.k}" data-w="${c.k}" min="0" max="100" value="${Math.round(W[c.k] * 100)}"></div>`).join("")}
        <h4 class="tune-h">Keep away from</h4>
        ${Object.entries(CONSTRAINTS).map(([k, n]) => `<div class="trow"><label for="b_${k}">${esc(n)}</label><output id="ob_${k}">${buf[k] ? buf[k] + " km" : "off"}</output>
          <input type="range" id="b_${k}" data-b="${k}" min="0" max="20" step="0.5" value="${buf[k]}"></div>`).join("")}
        <label class="tchk"><input type="checkbox" id="tProt" ${prot ? "checked" : ""}> Exclude protected areas</label>
        <label class="tchk"><input type="checkbox" id="tEmit" ${emitOnly ? "checked" : ""}> Only where EMIT measured minerals</label>
        <h4 class="tune-h">Display</h4>
        <div class="trow"><label for="tTop">Show the top … % of allowed land</label><output id="oTop">${topPct}%</output><input type="range" id="tTop" min="1" max="50" value="${topPct}"></div>
        <label class="tchk"><input type="checkbox" id="tNear" ${nearOnly ? "checked" : ""}> Pick sites within ${HACK.km} km of ${HACK.name} (drone range)</label>
        <p class="note">${esc(VALIDATION.grid)} Click the map to see why a place scores as it does.</p>`;
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
      $r("#liveStatus").textContent = `Live index recomputed in ${Math.round(performance.now() - t0)} ms · ${Math.round(allowed / all * 100)}% of Oman allowed`;
      paintStrata(); paintMeter(); paintRanks(); paintPicks(); paintLayers();
    }

    /* ---------- map image layer ---------- */
    let layerTimer = 0;
    function paintLayers() { clearTimeout(layerTimer); layerTimer = setTimeout(() => whenLoaded(applyLayers, "layers"), 60); }
    function applyLayers() {
      if (!G || !alive) return;
      const url = layer === "asi" ? st?.url : criterionImage(G, store.mission, layer); if (!url) return;
      const img = { url, coordinates: G.meta.corners_lonlat }, src = map.getSource("lay-OMAN");
      if (src) { src.updateImage(img); return; }
      map.addSource("lay-OMAN", { type: "image", ...img });
      map.addLayer({ id: "lay-OMAN", type: "raster", source: "lay-OMAN", paint: { "raster-opacity": 0.85, "raster-fade-duration": 200, "raster-resampling": "nearest" } });
    }

    /* ---------- validation meter ---------- */
    function paintMeter() {
      const m = store.mission, el = $r("#vmeter");
      const rows = bench.length ? bench.map(b => `<li class="${b.pass ? "ok" : "no"}"><span><b>${esc(b.name.split(" – ")[0].split(" (")[0])}</b><small>${b.use === "calibrate" ? "calibration" : "independent test"}</small></span>
          <span class="pct">${b.percentile == null ? "–" : ord(b.percentile)}<i>${b.pass ? "✓" : "✗"}</i></span></li>`).join("")
        : `<li class="none">No Omani benchmark exists for this profile.</li>`;
      const extra = m === "mars_science" ? `<p class="note">Official (90 m): ${esc(VALIDATION.facts.join(" "))}</p>`
        : (m === "mars_landing" || m === "mars_sedimentary") ? `<p class="note">${esc(VALIDATION.amadee)}</p>` : "";
      el.innerHTML = `<p class="eyebrow">Validation meter · live</p><p class="note">Do your settings still rank the known analog sites in Oman's top 20 %?</p><ul class="vlist">${rows}</ul>${extra}`;
    }

    /* ---------- ranked lists ---------- */
    function paintRanks() {
      $r("#rankMission").textContent = MISSIONS[store.mission].label;
      root.querySelectorAll("[data-list]").forEach(t => t.setAttribute("aria-selected", String(t.dataset.list === listMode)));
      if (listMode === "live") {
        $r("#ranks").innerHTML = picks.length ? picks.map((p, i) => `
          <button type="button" class="rank live-pick" data-pick="${i}">
            <span class="n">L${i + 1}</span><span><b>${p.lat.toFixed(3)}° N, ${p.lon.toFixed(3)}° E</b><small>3 × 3 km mean · ${nearOnly ? `within ${HACK.km} km of ${HACK.name}` : "all of Oman"}</small><span class="bar"><i style="width:${Math.min(100, p.asi * 100)}%"></i></span></span>
            <span class="v">${p.asi.toFixed(2)}</span></button>`).join("") + `<p class="note" style="padding:8px 16px">Live picks from the 1 km grid with your settings. Official ranks use the 90 m analysis.</p>`
          : `<p class="note" style="padding:12px 16px">${G ? "No allowed land matches these settings." : "Loading the 1 km grids…"}</p>`;
        return;
      }
      const list = data.sites[store.mission];
      $r("#ranks").innerHTML = list.map(s => `
        <button type="button" class="rank" data-id="${s.id}">
          <span class="n">${String(s.rank).padStart(2, "0")}</span>
          <span><b>${esc(s.name)}${s.benchmark ? '<span class="bench-tag">B</span>' : ""}${(s.group || []).includes("drone_range") ? '<span class="bench-tag drone">80 km</span>' : ""}</b><small>${esc(s.aoi)}</small><span class="bar"><i style="width:${s.asi * 100}%"></i></span></span>
          <span class="v">${s.asi.toFixed(2)}</span></button>`).join("");
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
          <div class="kv"><span>ASI · ${esc(MISSIONS[store.mission].label)}</span><span>${s.asi.toFixed(2)}</span></div>
          <div class="mini-cbar">${CRITERIA.map(c => `<div style="--sc:var(--c-${c.k});flex-grow:${Wd[c.k]}"><i style="width:${s["s_" + c.k] * 100}%"></i></div>`).join("")}</div>
          <div class="kv"><span>Strongest</span><span>${esc(CRITERIA.slice().sort((a, b) => Wd[b.k] * s["s_" + b.k] - Wd[a.k] * s["s_" + a.k])[0].name)}</span></div>
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
    /* live picks: ring markers, shown while the "Your picks" list is open */
    function paintPicks() {
      pickMarkers.splice(0).forEach(m => m.remove());
      if (listMode !== "live") return;
      picks.forEach((p, i) => {
        const el = h("button", { type: "button", class: "pick", "aria-label": `Live pick ${i + 1}, ASI ${p.asi.toFixed(2)}` }, `<b>L${i + 1}</b>`);
        el.addEventListener("click", ev => { ev.stopPropagation(); explainAt(p.lon, p.lat); });
        pickMarkers.push(new window.maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lon, p.lat]).addTo(map));
      });
    }

    /* ---------- click a place: why does it score this way? ---------- */
    function explainAt(lon, lat) {
      const ex = $r("#explain"); if (!G || !st) return;
      const [px, py] = G.toPx(lon, lat), col = Math.floor(px), row = Math.floor(py);
      if (col < 0 || row < 0 || col >= G.W || row >= G.H) { ex.hidden = true; return; }
      const i = row * G.W + col, v = st.asi[i];
      if (!Number.isFinite(v)) { ex.innerHTML = `<button type="button" class="vr-x" data-close aria-label="Close">×</button><p class="note">No data here (outside Oman or a data gap).</p>`; ex.hidden = false; return; }
      const pr = G.meta.profiles[store.mission], Wn = normalise(W);
      const why = Object.entries(CONSTRAINTS).filter(([k]) => buf[k] > 0).map(([k, nm]) => { const d = G.layer("dist." + k)[i]; return d !== 255 && d / 10 < buf[k] ? `${nm} ${(d / 10).toFixed(1)} km away` : null; }).filter(Boolean);
      if (prot && G.layer("dist.protected")[i] === 0) why.push("inside a protected area");
      if (emitOnly && G.layer("emit_coverage")[i] !== 1) why.push("no EMIT mineral measurement");
      const rows = CRITERIA.map(c => { const s = G.layer(c.k === "minerals" ? pr.minerals_layer : `${pr.criteria_prefix}.${c.k}`)[i] / 254;
        return `<tr><td><i class="chip-dot" style="--rc:var(--c-${c.k})"></i>${c.name}</td><td class="v">${s.toFixed(2)}</td><td class="v mut">× ${Math.round(Wn[c.k] * 100)}%</td></tr>`; }).join("");
      ex.innerHTML = `<button type="button" class="vr-x" data-close aria-label="Close">×</button>
        <p class="eyebrow">${lat.toFixed(3)}° N, ${lon.toFixed(3)}° E · 1 km cell</p>
        <p class="ex-asi">ASI <b>${v.toFixed(3)}</b>${st.allowed[i] ? (v >= st.cut ? ` <span class="ok">in your top ${topPct}%</span>` : "") : ` <span class="bad">excluded${why.length ? ": " + esc(why.join(", ")) : ""}</span>`}</p>
        <table class="ex-table"><thead><tr><th>Criterion</th><th>Similarity</th><th>Weight</th></tr></thead><tbody>${rows}</tbody></table>`;
      ex.hidden = false;
    }
    $r("#explain").addEventListener("click", e => { if (e.target.closest("[data-close]")) $r("#explain").hidden = true; });
    const onMapClick = e => { if (drawerId) return; explainAt(e.lngLat.lng, e.lngLat.lat); };
    map.on("click", onMapClick);

    /* ---------- passport drawer ---------- */
    const drawer = $r("#drawer");
    function openSite(id) {
      const s = data.site(id, store.mission); if (!s) { go("#oman"); return; }
      drawerId = id; drawer.classList.add("on"); $r("#rankRail").style.visibility = "hidden"; $r("#explain").hidden = true; setTune(false);
      const pp = $r("#pp");
      renderPassport(pp, { data, mission: store.mission, id }); pp.scrollTop = 0;
      const wide = innerWidth > 980;
      map.flyTo({ center: s.lonlat, zoom: 9, duration: 1500, essential: true, padding: { top: 80, bottom: 80, left: wide ? 320 : 0, right: wide ? Math.min(660, innerWidth * .5) : 0 } });
    }
    function closeSite() {
      drawerId = null; drawer.classList.remove("on"); $r("#rankRail").style.visibility = "";
      map.fitBounds(VIEW_BOUNDS, { padding: pad(), duration: 1300 });
    }
    $r("#closeDrawer").addEventListener("click", () => go("#oman"));

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

    $r("#liveStatus").textContent = "Loading the 1 km grids…";
    getGrid().then(g => { if (!alive) return; G = g; W = defaultWeights(G, store.mission); paintTune(); recompute(); })
      .catch(err => { $r("#liveStatus").textContent = "Live grids unavailable: " + err.message; });

    const onKey = e => { if (e.key === "Escape") { if (!$r("#explain").hidden) $r("#explain").hidden = true; else if (drawerId) go("#oman"); else if (tuneOpen) setTune(false); else go("#director"); } };
    addEventListener("keydown", onKey);
    setKeys([["Click", "Explain"], ["M", "Mission"], ["Esc", "Back"]]);

    return {
      update(r) { if (r.name === "site") openSite(r.id); else if (drawerId) closeSite(); },
      cleanup() {
        alive = false; unsub(); clearTimeout(layerTimer); clearTimeout(compTimer); map.off("click", onMapClick);
        removeEventListener("keydown", onKey); markers.forEach(m => m.remove()); pickMarkers.forEach(m => m.remove()); timers.forEach(clearTimeout);
        document.body.classList.remove("map-on"); scene.setActive(true);
        // climb back out: the map fades while the next view moves the globe camera away from Oman
        mapEl.classList.add("away"); vig.classList.add("away");
        hideTimer = setTimeout(() => { mapEl.hidden = true; vig.hidden = true; }, reduceMotion ? 0 : 1000);
      },
    };
  },
};
