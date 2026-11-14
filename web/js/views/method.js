// METHOD: how the score works. ASI Stack, similarity rule explorer, AHP matrix, benchmark check.
import { h, esc, fmt, setKeys, rampColor, hexRgb, cssVar, showTip, hideTip } from "../core/ui.js";
import { MISSIONS, CRITERIA } from "../core/data.js";
import { noise2, fbm, normalize } from "../core/noise.js";
import { drawCurve } from "./passport.js";
import { createStack } from "../space/stack3d.js";

const P = 120;
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
      <div class="page-head"><p class="eyebrow">Method</p><h1>How the Analog Similarity Index works</h1>
        <p>Each criterion turns an Oman measurement into a 0–1 similarity with the Moon or Mars target. AHP sets how much each one counts for the chosen mission. The weighted sum is the ASI. Known analog wadis are used to check the result.</p></div>
      <div class="grid-2">
        <div class="stage" id="stage"><div class="stage-cap"><span>Placeholder terrain and layers · drag to turn</span><span id="stageState">6 criterion layers</span></div></div>
        <div class="panel ticks"><div class="panel-head"><span class="panel-title">ASI Stack</span></div><div class="panel-body" style="display:grid;gap:12px">
          <p class="note">ASI = Σ wᵢ · sᵢ. Six similarity maps of the same area are weighted and pressed into one.</p>
          <div id="stackLegend" style="display:grid;gap:4px"></div>
          <button class="btn" type="button" id="stackBtn" aria-pressed="false">Combine into ASI</button>
        </div></div>
      </div>
      <div class="grid-2b">
        <div class="panel ticks"><div class="panel-head"><span class="panel-title">Similarity rule</span><span class="eyebrow" id="ruleMission"></span></div>
          <div class="panel-body" style="display:grid;gap:12px">
            <div id="ruleTabs" style="display:flex;gap:6px;flex-wrap:wrap"></div>
            <div class="curve-box"><p class="eyebrow" data-ctitle></p><svg class="curve" viewBox="0 0 420 210" role="img" aria-label="Similarity rule"></svg><p class="src" data-csrc></p></div>
            <div class="range-row"><label for="ruleVal">Try an Oman value</label><input type="range" id="ruleVal" min="0" max="1000" value="300"><span class="mono" id="ruleOut"></span></div>
          </div></div>
        <div class="panel ticks"><div class="panel-head"><span class="panel-title">AHP weights</span><span id="crBadge"></span></div>
          <div class="panel-body" style="display:grid;gap:12px">
            <div class="src-wrap"><table class="ahp" id="ahp"></table></div>
            <p class="note">Row criterion compared with column criterion on Saaty's 1–9 scale, derived from the current weights. A consistency ratio under 0.10 is acceptable.</p>
          </div></div>
      </div>
      <div class="panel ticks"><div class="panel-head"><span class="panel-title">Benchmark check</span><span class="eyebrow" id="benchMission"></span></div>
        <div class="panel-body" style="display:grid;gap:10px">
          <div class="legend"><span><i style="background:var(--muted)"></i>Calibration wadis (used to tune)</span><span><i style="background:var(--earth)"></i>Test wadis (held out)</span></div>
          <svg class="chart" id="bench" viewBox="0 0 760 120" role="img" aria-label="Benchmark ranks"></svg>
          <p class="note" id="benchNote"></p>
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

    function paintStack() {
      const w = data.weights[store.mission], acc = new Float32Array(P * P);
      for (const c of CRITERIA) { const f = FIELDS[c.k]; for (let p = 0; p < P * P; p++) acc[p] += w[c.k] * f[p]; }
      normalize(acc);
      if (stack3d) stack3d.update({ weights: w, asi: acc, ramp: MISSIONS[store.mission].ramp, label: MISSIONS[store.mission].label });
      else paintCssStack(cssStack, acc);
      legend.innerHTML = CRITERIA.slice().reverse().map(c => `<div class="strat" style="--rc:var(--c-${c.k});cursor:default" data-k="${c.k}"><span class="band"></span><span><b>${c.name}</b><small>${esc(c.src)}</small><span class="wb" style="width:${w[c.k] * 100}%"></span></span><span class="w">w ${w[c.k].toFixed(2)}</span></div>`).join("");
      legend.querySelectorAll("[data-k]").forEach(el => {
        el.addEventListener("pointerenter", () => { stack3d?.highlight(el.dataset.k); cssStack?.querySelector(`[data-k="${el.dataset.k}"]`)?.classList.add("hl"); });
        el.addEventListener("pointerleave", () => { stack3d?.highlight(null); cssStack?.querySelector(`[data-k="${el.dataset.k}"]`)?.classList.remove("hl"); });
      });
      $r("#stageState").textContent = combined ? `ASI · ${MISSIONS[store.mission].label}` : "6 criterion layers";
    }
    $r("#stackBtn").addEventListener("click", e => {
      combined = !combined; stage.classList.toggle("combined", combined); stack3d?.setCombined(combined);
      e.currentTarget.setAttribute("aria-pressed", String(combined)); e.currentTarget.textContent = combined ? "Separate the six layers" : "Combine into ASI";
      $r("#stageState").textContent = combined ? `ASI · ${MISSIONS[store.mission].label}` : "6 criterion layers";
    });

    /* similarity rule explorer */
    let rk = "terrain";
    const box = root.querySelector(".curve-box"), slider = $r("#ruleVal");
    function paintRule() {
      const c = CRITERIA.find(x => x.k === rk), v = c.min + (c.max - c.min) * (+slider.value / 1000);
      $r("#ruleTabs").innerHTML = CRITERIA.map(x => `<button type="button" class="btn" style="padding:6px 10px;${x.k === rk ? "border-color:var(--moho)" : ""}" data-k="${x.k}" aria-pressed="${x.k === rk}"><span class="chip-dot" style="--rc:var(--c-${x.k})"></span>${x.name}</button>`).join("");
      $r("#ruleMission").textContent = MISSIONS[store.mission].label;
      drawCurve(box, data, store.mission, rk, v);
      $r("#ruleOut").textContent = `${fmt(v, c.dp)}${c.unit} → s ${data.sim(rk, store.mission, v).toFixed(2)}`;
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
      $r("#crBadge").innerHTML = cr == null ? "" : `<span class="cr-badge ${cr >= 0.1 ? "bad" : ""}">CR ${cr.toFixed(3)}</span>`;
    }

    /* benchmark check */
    function paintBench() {
      const list = data.sites[store.mission], N = list.length, svg = $r("#bench"), W = 760, L = 30, R = 30, y = 56;
      const x = r => L + (r - 1) / Math.max(1, N - 1) * (W - L - R);
      let g = `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="2"/>`;
      for (let r = 1; r <= N; r++) g += `<line x1="${x(r)}" x2="${x(r)}" y1="${y - 4}" y2="${y + 4}" stroke="var(--line)"/><text x="${x(r)}" y="${y + 22}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${r}</text>`;
      g += `<text x="${L}" y="${y + 44}" font-size="11" fill="var(--muted)">rank 1 = best match</text>`;
      const bench = list.filter(s => s.benchmark);
      bench.forEach((s, i) => {
        const cal = s.benchmark === "calibration", up = i % 2 === 0;
        g += `<g class="bm" data-id="${s.id}"><line x1="${x(s.rank)}" x2="${x(s.rank)}" y1="${y}" y2="${up ? y - 26 : y - 14}" stroke="var(--faint)"/>
          <circle cx="${x(s.rank)}" cy="${y}" r="8" fill="${cal ? "var(--bg)" : "var(--earth)"}" stroke="${cal ? "var(--muted)" : "var(--earth)"}" stroke-width="2"/>
          <text x="${x(s.rank)}" y="${up ? y - 30 : y - 18}" text-anchor="middle" font-size="11.5" fill="var(--fg)">${esc(s.name.replace("Wadi ", ""))}</text>
          <circle cx="${x(s.rank)}" cy="${y}" r="16" fill="transparent"/></g>`;
      });
      svg.innerHTML = g;
      svg.querySelectorAll(".bm").forEach(el => { const s = list.find(p => p.id === el.dataset.id);
        el.addEventListener("pointermove", e => showTip(`<b>${esc(s.name)}</b><br><span class="mono">${esc(s.benchmark)} set · rank ${s.rank} of ${N} · ASI ${s.asi.toFixed(2)}</span>`, e.clientX, e.clientY));
        el.addEventListener("pointerleave", hideTip); });
      const test = bench.filter(s => s.benchmark === "test"), share = test.filter(s => s.rank <= Math.ceil(N / 2)).length;
      $r("#benchMission").textContent = MISSIONS[store.mission].label;
      $r("#benchNote").textContent = `${share} of ${test.length} held-out test wadis rank in the top half for ${MISSIONS[store.mission].label}.` + (data.isMock ? " (Mock numbers.)" : "");
    }

    const paintAll = () => { paintStack(); paintRule(); paintAHP(); paintBench(); };
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
