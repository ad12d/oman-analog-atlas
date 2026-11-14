// TWIN LENS: Oman below the Moho line, the target world above, at one shared scale.
// PLACEHOLDER terrains (procedural) until Luqman's LiDAR DTM and the LOLA / HiRISE patches are exported.
import { h, esc, setKeys, showTip, hideTip } from "../core/ui.js";
import { MISSIONS } from "../core/data.js";
import { noise2, fbm, rng } from "../core/noise.js";

const TW = 640, TH = 360;
const hashId = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

function heights(kind, seed) {
  const h = new Float32Array(TW * TH), n = noise2(seed, 48), r = rng(seed + 5);
  const craters = kind === "moon" ? Array.from({ length: 30 }, () => [r() * TW, r() * TH, 10 + r() ** 2 * 90]) : [];
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
    const u = i / TW * 7, v = j / TH * 4; let z;
    if (kind === "earth") {
      const rr = 1 - Math.abs(2 * fbm(n, u, v, 5) - 1); z = rr * rr * .9;
      const d = (j / TH) - (.62 + .1 * Math.sin(i / TW * 6.5)); z -= .35 * Math.exp(-(d * d) / .004); z += fbm(n, u * 6, v * 6, 2) * .05;
    } else if (kind === "moon") {
      z = fbm(n, u * .8, v * .8, 5) * .35;
      for (const [cx, cy, cr] of craters) { const d = Math.hypot(i - cx, j - cy) / cr; if (d < 1) z -= (1 - d * d) * cr / 330; z += Math.exp(-((d - 1) ** 2) / .03) * cr / 1100; }
    } else {
      z = fbm(n, u * .9, v * .9, 5) * .45;
      const fan = Math.hypot(i / TW - .15, j / TH - .1), ang = Math.atan2(j / TH - .1, i / TW - .15);
      if (fan > .25 && fan < .85 && ang > 0 && ang < 1.3) z = z * .5 + Math.floor((.9 - fan) * 7) / 7 * .25;
      const d = (j / TH) - (.1 + (i / TW) * .7); if (i / TW < .4) z -= .25 * Math.exp(-(d * d) / .002);
    }
    h[j * TW + i] = z;
  }
  return h;
}
function grads(h) { const g = new Float32Array(TW * TH);
  for (let j = 1; j < TH - 1; j++) for (let i = 1; i < TW - 1; i++) g[j * TW + i] = Math.hypot((h[j * TW + i + 1] - h[j * TW + i - 1]) / 2, (h[(j + 1) * TW + i] - h[(j - 1) * TW + i]) / 2);
  return g; }
function shade(cv, h, [br, bg, bb]) {
  const ctx = cv.getContext("2d"), img = ctx.createImageData(TW, TH), k = 70, lx = -.6, ly = -.6, lz = .53;
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(TW - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(TH - 1, j + 1);
    const dx = (h[j * TW + i1] - h[j * TW + i0]) * k, dy = (h[j1 * TW + i] - h[j0 * TW + i]) * k, len = Math.hypot(dx, dy, 1);
    const f = .26 + .95 * Math.max(0, (-dx * lx - dy * ly + lz) / len), o = (j * TW + i) * 4;
    img.data[o] = Math.min(255, br * f); img.data[o + 1] = Math.min(255, bg * f); img.data[o + 2] = Math.min(255, bb * f); img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export default {
  mount({ view, scene, data, store, go }, route) {
    scene.setActive(true); scene.setMode("orbit");
    const id = route.id;
    const root = h("div", { class: "page live" });
    view.appendChild(root);
    const off = [];

    function render() {
      const s = data.site(id, store.mission);
      const w = MISSIONS[store.mission].world;
      if (!s) { root.innerHTML = `<div class="page-inner"><p class="note">Unknown site.</p></div>`; return; }
      root.innerHTML = `<div class="page-inner">
        <div class="page-head"><p class="eyebrow">Twin Lens · ${esc(s.aoi)}</p><h1>${esc(s.name)} × ${esc(MISSIONS[store.mission].target)}</h1>
          <p>Drag the gold Moho line. Oman sits below it and ${esc(MISSIONS[store.mission].worldName)} above it, at the same scale, so slope and roughness compare directly. These terrains are placeholders until the LiDAR DTM and the ${w === "moon" ? "LOLA" : "HiRISE"} patch are exported.</p></div>
        <div class="grid-2">
          <div>
            <div class="lens" id="lens" style="--y:46%">
              <canvas id="cT" width="${TW}" height="${TH}"></canvas><canvas id="cE" class="earthc" width="${TW}" height="${TH}"></canvas>
              <span class="lab t">${w === "moon" ? "Moon · Shackleton ridge" : "Mars · Jezero"} (placeholder)</span>
              <span class="lab b">Oman · ${esc(s.name)} (placeholder)</span>
              <div class="scale"><i></i><span>500 m · both sides</span></div>
              <div class="handle"><span class="grip" aria-hidden="true">⇕</span></div>
            </div>
            <div class="range-row"><label for="mohoRange">Moho line position</label><input type="range" id="mohoRange" min="5" max="95" value="46"></div>
          </div>
          <div class="panel ticks"><div class="panel-head"><span class="panel-title">Slope distribution</span></div>
            <div class="panel-body" style="display:grid;gap:10px">
              <div class="legend"><span><i style="background:var(--earth)"></i>Oman site</span><span><i style="background:var(--accent)"></i>${esc(MISSIONS[store.mission].worldName)} target</span></div>
              <svg class="chart" id="hist" viewBox="0 0 380 220" role="img" aria-label="Slope histogram, Oman versus target"></svg>
              <p class="note">Share of cells per 2.5° slope bin. Hover a bin for values.</p>
              <a class="btn" href="#site-${esc(id)}">Back to passport</a>
            </div></div>
        </div></div>`;

      const seed = hashId(id), hE = heights("earth", seed), hT = heights(w, seed + (w === "moon" ? 11 : 23));
      shade(root.querySelector("#cE"), hE, [196, 168, 128]);
      shade(root.querySelector("#cT"), hT, w === "moon" ? [170, 172, 176] : [196, 112, 78]);
      const gE = grads(hE), gT = grads(hT);
      const sorted = [...gE].filter(v => v > 0).sort((a, b) => a - b), kS = Math.tan((+s.raw_terrain || 7) * Math.PI / 180) / sorted[sorted.length >> 1];
      const hist = g => { const b = new Array(12).fill(0); let n = 0; for (const v of g) { if (!v) continue; b[Math.min(11, Math.floor(Math.atan(v * kS) * 180 / Math.PI / 2.5))]++; n++; } return b.map(x => x / n); };
      drawHist(root.querySelector("#hist"), hist(gE), hist(gT), MISSIONS[store.mission].worldName);

      const lens = root.querySelector("#lens"), range = root.querySelector("#mohoRange");
      const setY = v => { v = Math.max(5, Math.min(95, v)); lens.style.setProperty("--y", v + "%"); range.value = Math.round(v); };
      range.addEventListener("input", () => setY(+range.value));
      let drag = false;
      const mv = e => { const r = lens.getBoundingClientRect(); setY((e.clientY - r.top) / r.height * 100); };
      lens.addEventListener("pointerdown", e => { drag = true; lens.setPointerCapture(e.pointerId); mv(e); });
      lens.addEventListener("pointermove", e => { if (drag) mv(e); });
      lens.addEventListener("pointerup", () => { drag = false; });
    }
    function drawHist(svg, e, t, name) {
      const W = 380, H = 220, L = 38, R = 10, T = 12, B = 32, max = Math.ceil(Math.max(...e, ...t) * 10) / 10 || .1;
      const x = i => L + i / 12 * (W - L - R), y = v => T + (1 - v / max) * (H - T - B), step = a => a.map((v, i) => `${x(i)},${y(v)} ${x(i + 1)},${y(v)}`).join(" ");
      let g = "";
      for (let k = 0; k <= 4; k++) { const v = max * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--hair)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${Math.round(v * 100)}%</text>`; }
      for (let i = 0; i <= 12; i += 2) g += `<text x="${x(i)}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${i * 2.5}°</text>`;
      let hits = ""; for (let i = 0; i < 12; i++) hits += `<rect data-i="${i}" x="${x(i)}" y="${T}" width="${x(1) - x(0)}" height="${H - T - B}" fill="transparent"/>`;
      svg.innerHTML = `${g}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--faint)"/>
        <polyline points="${step(t)}" fill="none" stroke="var(--accent)" stroke-width="2"/><polyline points="${step(e)}" fill="none" stroke="var(--earth)" stroke-width="2"/>
        <text x="${W - R}" y="${H - 2}" text-anchor="end" font-size="11" fill="var(--muted)">slope</text>${hits}`;
      svg.querySelectorAll("rect[data-i]").forEach(r => { const i = +r.dataset.i;
        r.addEventListener("pointermove", ev => showTip(`<b>${i * 2.5}–${(i + 1) * 2.5}°</b><br><span class="mono">Oman ${(e[i] * 100).toFixed(1)}% · ${esc(name)} ${(t[i] * 100).toFixed(1)}%</span>`, ev.clientX, ev.clientY));
        r.addEventListener("pointerleave", hideTip); });
    }

    render();
    off.push(store.subscribe(render));
    const onKey = e => { if (e.key === "Escape") go("#site-" + id); };
    addEventListener("keydown", onKey);
    setKeys([["Drag", "Moho line"], ["M", "Mission"], ["Esc", "Passport"]]);
    return { cleanup() { off.forEach(f => f()); removeEventListener("keydown", onKey); } };
  },
};
