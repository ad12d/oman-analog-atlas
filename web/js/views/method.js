// METHOD: how the score works. ASI Stack (real 1 km similarity grids), similarity rules, AHP matrix, validation.
import { h, esc, fmt, setKeys, rampColor, hexRgb, cssVar, showTip, hideTip } from "../core/ui.js";
import { MISSIONS, CRITERIA, VALIDATION, RULE_PLAIN, pctOf } from "../core/data.js";
import { getGrid } from "../core/grid.js";
import { normalise } from "../core/live.js";
import { noise2, fbm, normalize } from "../core/noise.js";
import { drawCurve } from "./passport.js";
import { createStack } from "../space/stack3d.js";

const P = 96;                                   // 96 x 96 cells of the 1 km grid around Al Bidiyah
const CENTRE = { lon: 58.80, lat: 22.45, name: "Al Bidiyah" };
// placeholder fields until the real grids load
const FIELDS = (() => {
  const out = {};
  CRITERIA.forEach((c, idx) => {
    const n = noise2(11 + idx * 13), a = new Float32Array(P * P);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const u = i / P, v = j / P; let val = fbm(n, u * 6, v * 6);
      if (c.k === "minerals") { const d = Math.abs((v - .5) - .35 * Math.sin(u * 3.2) + (u - .5) * .3); val = val * .45 + Math.exp(-(d * d) / .02) * .75; }
      if (c.k === "access") { const d = Math.abs(v - (.3 + .25 * u)); val = 1 - Math.min(1, d * 2.4) + val * .2; }
      a[j * P + i] = val;
    }
    out[c.k] = normalize(a);
  });
  return out;
})();
const SAATY = [1 / 9, 1 / 8, 1 / 7, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const saaty = r => SAATY.reduce((b, v) => Math.abs(Math.log(v / r)) < Math.abs(Math.log(b / r)) ? v : b, 1);
const frac = v => v >= 1 ? String(Math.round(v)) : "1/" + Math.round(1 / v);

export default {
  mount({ view, scene, data, store }) {
    // the globe sits blurred behind this page: settle it, then pause it so the 3D stack gets the GPU
    let alive = true;
    scene.setActive(true); scene.setMode("director").then(() => { if (alive) scene.setActive(false); });
    const root = h("div", { class: "page live" });
    root.innerHTML = `<div class="page-inner">
      <div class="page-head"><p class="eyebrow">Method</p><h1>How the analog score works</h1>
        <p>The score answers one question: how much does this place in Oman resemble the Moon or Mars site a mission is heading to? It is built in five steps.</p>
        <ol class="steps5">
          <li><b>Measure.</b> Satellites measure ten things across all of Oman: slope, roughness, hilliness, temperature swings, wind, plant cover, old riverbeds, minerals and road access.</li>
          <li><b>Compare.</b> Each measurement is compared with the same measurement at the Moon or Mars target and turned into a match from 0 to 100%.</li>
          <li><b>Weigh.</b> For each mission, experts decide how much each criterion matters: terrain counts most for a Moon base, minerals for Mars science.</li>
          <li><b>Add up.</b> Matches times importance, added together, give the analog score out of 100.</li>
          <li><b>Check.</b> Places scientists already use as analogs must come out near the top; they do.</li>
        </ol>
        <p class="tech">For experts: ASI = Σ wᵢ·sᵢ; sᵢ from Gaussian (slope, TRI, relief) or one-sided rules against LOLA / MOLA / MODIS targets plus an EMIT L2B mineral score; wᵢ from hierarchical AHP; computed at 90 m; AUC 0.84 against benchmark outcrops.</p></div>
      <div class="grid-2">
        <div class="stage" id="stage"><div class="stage-cap"><span id="stageSrc">Loading the real 1 km grids… · drag to turn</span><span id="stageState">10 criterion layers</span></div></div>
        <div class="panel ticks"><div class="panel-head"><span class="panel-title">Ten maps become one</span></div><div class="panel-body" style="display:grid;gap:12px">
          <p class="note">Each layer is a real match map of the same ${P} × ${P} km area around ${CENTRE.name}: bright where Oman matches the target. Weighted by importance and pressed together, they become the analog score.</p>
          <div id="stackLegend" style="display:grid;gap:4px"></div>
          <button class="btn" type="button" id="stackBtn" aria-pressed="false">Press into one score</button>
        </div></div>
      </div>
      <div class="grid-2b">
        <div class="panel ticks"><div class="panel-head"><span class="panel-title">How a match is scored</span><span class="eyebrow" id="ruleMission"></span></div>
          <div class="panel-body" style="display:grid;gap:12px">
            <div id="ruleTabs" style="display:flex;gap:6px;flex-wrap:wrap"></div>
            <div class="curve-box"><p class="eyebrow" data-ctitle></p><svg class="curve" viewBox="0 0 420 210" role="img" aria-label="Similarity rule"></svg><p class="src" data-csrc></p></div>
            <div class="range-row"><label for="ruleVal">Try a value for Oman</label><input type="range" id="ruleVal" min="0" max="1000" value="300"><span class="mono" id="ruleOut"></span></div>
          </div></div>
        <div class="panel ticks"><div class="panel-head"><span class="panel-title">How much each criterion matters</span><span id="crBadge"></span></div>
          <div class="panel-body" style="display:grid;gap:12px">
            <div class="src-wrap"><table class="ahp" id="ahp"></table></div>
            <p class="note">Experts compared every pair of criteria for this mission ("how much more does slope matter than wind?") on a 1 to 9 scale; read each row against each column. From these comparisons the method (AHP, the Analytic Hierarchy Process) derives one importance per criterion. A built-in consistency check (CR) must stay under 0.10 so the judgements do not contradict each other.</p>
          </div></div>
      </div>
      <div class="panel ticks"><div class="panel-head"><span class="panel-title">Does it work?</span><span class="eyebrow" id="benchMission"></span></div>
        <div class="panel-body" style="display:grid;gap:10px">
          <div class="legend"><span><i style="background:var(--muted)"></i>Known site used to tune the score</span><span><i style="background:var(--earth)"></i>Independent test site</span><span><i style="background:var(--moho)"></i>Pass line: better than 80% of Oman</span></div>
          <svg class="chart" id="bench" viewBox="0 0 760 150" role="img" aria-label="Benchmark percentiles"></svg>
          <ul class="vfacts" id="benchFacts"></ul>
        </div></div>
    </div>`;
    view.appendChild(root);
    const $r = s => root.querySelector(s);

    /* stack: 3D (three.js), or flat CSS plates if WebGL is unavailable */
    const stage = $r("#stage"), legend = $r("#stackLegend");
    let stack3d = null, cssStack = null;
    try { stack3d = createStack(stage, { P, fields: FIELDS, criteria: CRITERIA }); }
    catch { cssStack = buildCssStack(stage); }
    if (window.__oaa) window.__oaa.stack = stack3d;   // QA only
    stack3d?.onHover(k => legend.querySelectorAll("[data-k]").forEach(el => el.classList.toggle("hl", el.dataset.k === k)));
    let combined = false;

    // real fields: the mission's 10 similarity layers cropped around the centre (nodata -> 0)
    let G = null, real = false;
    function loadFields() {
      if (!G) return;
      const pr = G.meta.profiles[store.mission], [cx, cy] = G.toPx(CENTRE.lon, CENTRE.lat), x0 = Math.round(cx - P / 2), y0 = Math.round(cy - P / 2);
      for (const c of CRITERIA) {
        const L = G.layer(c.k === "minerals" ? pr.minerals_layer : `${pr.criteria_prefix}.${c.k}`), f = FIELDS[c.k];
        for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) { const v = L[(y0 + j) * G.W + x0 + i]; f[j * P + i] = v === 255 || v == null ? 0 : v / 254; }
      }
      real = true; stack3d?.setFields(FIELDS);
      $r("#stageSrc").textContent = `Real 1 km similarity grids · ${P} × ${P} km around ${CENTRE.name} · block relief illustrative · drag to turn`;
    }
    getGrid().then(g => { if (!alive) return; G = g; loadFields(); paintStack(); }).catch(() => { $r("#stageSrc").textContent = "Placeholder layers (grids unavailable) · drag to turn"; });

    function paintStack() {
      const w = normalise(data.weights[store.mission]), acc = new Float32Array(P * P);
      for (const c of CRITERIA) { const f = FIELDS[c.k]; for (let p = 0; p < P * P; p++) acc[p] += w[c.k] * f[p]; }
      normalize(acc);                              // colour stretched to this window
      if (stack3d) stack3d.update({ weights: w, asi: acc, ramp: MISSIONS[store.mission].ramp, label: MISSIONS[store.mission].label });
      else paintCssStack(cssStack, acc);
      legend.innerHTML = CRITERIA.slice().reverse().map(c => `<div class="strat" style="--rc:var(--c-${c.k});cursor:default" data-k="${c.k}"><span class="band"></span><span><b>${c.name}</b><small>${esc(c.what)}</small><span class="wb" style="width:${w[c.k] * 100}%"></span></span><span class="w">${Math.round(w[c.k] * 100)}%</span></div>`).join("");
      legend.querySelectorAll("[data-k]").forEach(el => {
        el.addEventListener("pointerenter", () => { stack3d?.highlight(el.dataset.k); cssStack?.querySelector(`[data-k="${el.dataset.k}"]`)?.classList.add("hl"); });
        el.addEventListener("pointerleave", () => { stack3d?.highlight(null); cssStack?.querySelector(`[data-k="${el.dataset.k}"]`)?.classList.remove("hl"); });
      });
      $r("#stageState").textContent = combined ? `ASI · ${MISSIONS[store.mission].label}` : `${CRITERIA.length} criterion layers`;
    }
    $r("#stackBtn").addEventListener("click", e => {
      combined = !combined; stage.classList.toggle("combined", combined); stack3d?.setCombined(combined);
      e.currentTarget.setAttribute("aria-pressed", String(combined)); e.currentTarget.textContent = combined ? "Separate the layers" : "Press into one score";
      $r("#stageState").textContent = combined ? `ASI · ${MISSIONS[store.mission].label}` : `${CRITERIA.length} criterion layers`;
    });

    /* similarity rule explorer */
    let rk = "slope";
    const box = root.querySelector(".curve-box"), slider = $r("#ruleVal");
    function paintRule() {
      const c = CRITERIA.find(x => x.k === rk), v = c.min + (c.max - c.min) * (+slider.value / 1000);
      $r("#ruleTabs").innerHTML = CRITERIA.map(x => `<button type="button" class="btn" style="padding:6px 10px;${x.k === rk ? "border-color:var(--moho)" : ""}" data-k="${x.k}" aria-pressed="${x.k === rk}"><span class="chip-dot" style="--rc:var(--c-${x.k})"></span>${x.name}</button>`).join("");
      $r("#ruleMission").textContent = MISSIONS[store.mission].label;
      drawCurve(box, data, store.mission, rk, v);
      $r("#ruleOut").textContent = `${fmt(v, c.dp)}${c.unit} → ${Math.round(data.sim(rk, store.mission, v) * 100)}% match`;
    }
    $r("#ruleTabs").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (b) { rk = b.dataset.k; paintRule(); } });
    slider.addEventListener("input", paintRule);

    /* AHP matrix */
    function paintAHP() {
      const w = data.weights[store.mission];
      let html = `<thead><tr><th></th>${CRITERIA.map(c => `<th>${c.name.split(" ")[0]}</th>`).join("")}</tr></thead><tbody>`;
      for (const a of CRITERIA) {
        html += `<tr><th style="text-align:left"><span class="chip-dot" style="--rc:var(--c-${a.k})"></span>${a.name.split(" ")[0]}</th>`;
        for (const b of CRITERIA) {
          const v = saaty(w[a.k] / w[b.k]), t = Math.log(v) / Math.log(9);
          const bg = t > 0 ? `color-mix(in oklab, var(--accent) ${Math.round(t * 55)}%, transparent)` : t < 0 ? `color-mix(in oklab, var(--line) ${Math.round(-t * 100)}%, transparent)` : "transparent";
          html += `<td style="background:${bg}">${frac(v)}</td>`;
        }
        html += "</tr>";
      }
      $r("#ahp").innerHTML = html + "</tbody>";
      const cr = data.cr[store.mission];
      $r("#crBadge").innerHTML = cr == null ? "" : `<span class="cr-badge ${cr >= 0.1 ? "bad" : ""}" title="Consistency ratio: under 0.10 means the expert judgements agree with each other">consistency ${cr < 0.1 ? "✓" : "✗"} ${cr.toFixed(3)}</span>`;
    }

    /* validation: benchmark outcrops' percentile in the 90 m ASI (pass = 80th percentile or better) */
    function paintBench() {
      const m = store.mission, list = data.sites[m].filter(s => s.benchmark && s.validation_percentile != null), svg = $r("#bench");
      const W = 760, L = 230, R = 40, rowH = 26, top = 20, x = p => L + p / 100 * (W - L - R), n = Math.max(1, list.length);
      let g = "";
      for (let p = 0; p <= 100; p += 20) g += `<line x1="${x(p)}" x2="${x(p)}" y1="${top - 4}" y2="${top + n * rowH}" stroke="var(--hair)"/><text x="${x(p)}" y="${top - 8}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${p}</text>`;
      g += `<line x1="${x(80)}" x2="${x(80)}" y1="${top - 4}" y2="${top + n * rowH}" stroke="var(--moho)" stroke-dasharray="4 3"/>`;
      list.forEach((s, i) => {
        const y = top + i * rowH + rowH / 2, p = +s.validation_percentile, test = s.benchmark === "test";
        g += `<g class="bm" data-id="${s.id}"><text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="var(--fg)">${esc(s.name.split(" – ")[0])}</text>
          <line x1="${x(0)}" x2="${x(Math.max(1, p))}" y1="${y}" y2="${y}" stroke="${test ? "var(--earth)" : "var(--muted)"}" stroke-width="6" stroke-linecap="round"/>
          <text x="${x(p) + 8}" y="${y + 4}" font-size="11.5" fill="var(--fg)" font-family="var(--f-mono)">${Math.round(p)}</text>
          <rect x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" fill="transparent"/></g>`;
      });
      if (!list.length) g += `<text x="${L}" y="${top + 16}" font-size="12" fill="var(--muted)">Oman has no known analog site for this mission yet, so there is nothing to check against.</text>`;
      svg.setAttribute("viewBox", `0 0 ${W} ${top + n * rowH + 10}`);
      svg.innerHTML = g;
      svg.querySelectorAll(".bm").forEach(el => { const s = list.find(p => p.id === el.dataset.id);
        el.addEventListener("pointermove", e => showTip(`<b>${esc(s.name)}</b><br><span class="mono">${s.benchmark === "test" ? "independent test site" : "known site used to tune the score"} · better than ${Math.round(s.validation_percentile)}% of Oman</span>`, e.clientX, e.clientY));
        el.addEventListener("pointerleave", hideTip); });
      $r("#benchMission").textContent = MISSIONS[m].label;
      const facts = m === "mars_science" ? VALIDATION.facts : (m === "mars_landing" || m === "mars_sedimentary") ? [VALIDATION.amadee] : [];
      $r("#benchFacts").innerHTML = [...facts, VALIDATION.grid].map(f => `<li>${esc(f)}</li>`).join("");
    }

    const paintAll = () => { if (G) loadFields(); paintStack(); paintRule(); paintAHP(); paintBench(); };
    paintAll();
    const unsub = store.subscribe(paintAll);
    setKeys([["M", "Mission"]]);
    return { cleanup() { alive = false; unsub(); stack3d?.dispose(); scene.setActive(true); } };
  },
};

// Fallback ASI Stack: flat CSS 3D plates (used only when WebGL is unavailable).
function buildCssStack(stage) {
  const stack = h("div", { class: "stack" });
  CRITERIA.forEach((c, i) => { const p = h("div", { class: "plate crit", "data-k": c.k, "--i": i }); p.appendChild(h("canvas", { width: P, height: P })); stack.appendChild(p); });
  const asi = h("div", { class: "plate asi" }); asi.appendChild(h("canvas", { width: P, height: P })); stack.appendChild(asi);
  stage.prepend(stack); stage.classList.add("flat");
  return stack;
}
function paintCssStack(stack, acc) {
  CRITERIA.forEach((c, i) => {
    const ctx = stack.children[i].firstChild.getContext("2d"), img = ctx.createImageData(P, P), [r, g, b] = hexRgb(cssVar(`--c-${c.k}`)), f = FIELDS[c.k];
    for (let p = 0; p < P * P; p++) img.data.set([r, g, b, Math.round(30 + f[p] * 225)], p * 4);
    ctx.putImageData(img, 0, 0);
  });
  const mission = document.documentElement.dataset.mission, ctx = stack.lastChild.firstChild.getContext("2d"), img = ctx.createImageData(P, P);
  for (let p = 0; p < P * P; p++) { const [r, g, b] = rampColor(MISSIONS[mission].ramp, acc[p]); img.data.set([r, g, b, 255], p * 4); }
  ctx.putImageData(img, 0, 0);
}
