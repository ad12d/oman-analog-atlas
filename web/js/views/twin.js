// TWIN LENS: an Oman site below the Moho line, a Moon or Mars target above it, at one shared scale
// (24 x 13.5 km). Real terrain: Copernicus DEM (Oman, 90 m), LRO LOLA (Moon, 80 m), MGS MOLA (Mars, 463 m),
// from data/twin/ (16-bit heights packed as R*256+G). Terrain similarity from data/target_sites.json.
import { h, esc, fmt, setKeys, showTip, hideTip } from "../core/ui.js";
import { MISSIONS } from "../core/data.js";

const DEFAULT_TARGET = { moon_base: "moon_shackleton", mars_landing: "mars_jezero_floor", mars_science: "mars_jezero_delta", mars_sedimentary: "mars_jezero_delta" };
let indexP = null;
const heightCache = new Map();
const loadIndex = () => (indexP ??= fetch("data/twin/index.json").then(r => { if (!r.ok) throw new Error("twin index missing"); return r.json(); }).catch(e => { indexP = null; throw e; }));
async function loadHeights(m) {
  if (heightCache.has(m.id)) return heightCache.get(m.id);
  const bmp = await createImageBitmap(await (await fetch("data/" + m.file)).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data, N = bmp.width * bmp.height, z = new Float32Array(N), k = (m.max_m - m.min_m) / 65535;
  for (let i = 0; i < N; i++) z[i] = m.min_m + (px[i * 4] * 256 + px[i * 4 + 1]) * k;
  const out = { z, W: bmp.width, H: bmp.height, res: m.width_km * 1000 / bmp.width };
  heightCache.set(m.id, out); return out;
}
/** slope in degrees per cell (true metres) */
function slopes(t) {
  const { z, W, H, res } = t, s = new Float32Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const dx = (z[j * W + i + 1] - z[j * W + i - 1]) / (2 * res), dy = (z[(j + 1) * W + i] - z[(j - 1) * W + i]) / (2 * res);
    s[j * W + i] = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
  }
  return s;
}
/** hillshade at true scale (no vertical exaggeration), sun from the north-west */
function shade(cv, t, [br, bg, bb]) {
  const { z, W, H, res } = t; cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H), lx = -.55, ly = -.55, lz = .63;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(W - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(H - 1, j + 1);
    const dx = (z[j * W + i1] - z[j * W + i0]) / ((i1 - i0) * res), dy = (z[j1 * W + i] - z[j0 * W + i]) / ((j1 - j0) * res), len = Math.hypot(dx, dy, 1);
    const f = .22 + .98 * Math.max(0, (-dx * lx - dy * ly + lz) / len), o = (j * W + i) * 4;
    img.data[o] = Math.min(255, br * f); img.data[o + 1] = Math.min(255, bg * f); img.data[o + 2] = Math.min(255, bb * f); img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export default {
  mount({ view, scene, data, store, go }, route) {
    scene.setActive(true); scene.setMode("orbit");
    const root = h("div", { class: "page live" });
    view.appendChild(root);
    const off = []; let alive = true, omanId = null, targetId = null, y = 46;

    async function render() {
      let idx;
      try { idx = await loadIndex(); } catch (e) { root.innerHTML = `<div class="page-inner"><p class="note">Twin Lens terrain not available: ${esc(e.message)}</p></div>`; return; }
      if (!alive) return;
      const m = store.mission, world = MISSIONS[m].world, body = world === "moon" ? "Moon" : "Mars";
      const omanMaps = idx.maps.filter(x => x.body === "Earth"), tMaps = idx.maps.filter(x => x.body === body);
      if (!targetId || !tMaps.some(t => t.id === targetId)) targetId = DEFAULT_TARGET[m];
      const tw = (data.twins?.targets || []).find(t => t.id === targetId);
      // Oman side: the passport's site if it has a terrain clip, else the target's best terrain twin
      if (!omanId) omanId = route.id && omanMaps.some(o => o.id === "oman_" + route.id) ? route.id : (tw?.oman_twins?.find(o => omanMaps.some(x => x.id === "oman_" + o.id))?.id || omanMaps[0].id.slice(5));
      const oMap = omanMaps.find(o => o.id === "oman_" + omanId), tMap = tMaps.find(t => t.id === targetId);
      const site = data.site(omanId, m), twinRow = tw?.oman_twins?.find(o => o.id === omanId);
      const noClip = route.id && route.id !== omanId && !omanMaps.some(o => o.id === "oman_" + route.id);

      root.innerHTML = `<div class="page-inner">
        <div class="page-head"><p class="eyebrow">Twin Lens · real terrain at one scale</p><h1>${esc(oMap.name)} × ${esc(tMap.name)}</h1>
          <p>Drag the gold Moho line. Oman sits below it and ${esc(MISSIONS[m].worldName)} above it, both ${tMap.width_km} × ${tMap.height_km} km at true scale, so slope and roughness compare directly.
          ${noClip ? `<br><b>${esc(data.site(route.id, m)?.name || route.id)}</b> has no terrain clip yet, so its target's best terrain twin is shown.` : ""}</p></div>
        <div class="twin-pick">
          <label>Oman site <select id="pickOman">${omanMaps.map(o => `<option value="${o.id.slice(5)}" ${o.id === oMap.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>
          <label>${body} target <select id="pickTarget">${tMaps.map(t => `<option value="${t.id}" ${t.id === tMap.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
        </div>
        <div class="grid-2">
          <div>
            <div class="lens" id="lens" style="--y:${y}%">
              <canvas id="cT"></canvas><canvas id="cE" class="earthc"></canvas>
              <span class="lab t">${esc(body)} · ${esc(tMap.name)} · ${esc(tMap.source)}</span>
              <span class="lab b">Oman · ${esc(oMap.name)} · Copernicus DEM ${oMap.native_res_m} m</span>
              <div class="scale"><i style="width:${Math.round(5 / tMap.width_km * 100)}%"></i><span>5 km · both sides</span></div>
              <div class="handle"><span class="grip" aria-hidden="true">⇕</span></div>
            </div>
            <div class="range-row"><label for="mohoRange">Moho line position</label><input type="range" id="mohoRange" min="5" max="95" value="${y}"></div>
          </div>
          <div class="panel ticks"><div class="panel-head"><span class="panel-title">Terrain match</span>${twinRow ? `<span class="eyebrow">similarity ${twinRow.terrain_similarity.toFixed(2)}</span>` : ""}</div>
            <div class="panel-body" style="display:grid;gap:12px">
              ${tw ? `<table class="twin-table"><thead><tr><th></th><th>Oman</th><th>${esc(body)}</th></tr></thead><tbody>
                <tr><td>Median slope</td><td class="v">${twinRow ? fmt(twinRow.oman_slope_deg, 1) + "°" : "–"}</td><td class="v">${fmt(tw.slope_deg, 1)}°</td></tr>
                <tr><td>Roughness (TRI)</td><td class="v">${twinRow ? fmt(twinRow.oman_tri_m, 1) + " m" : "–"}</td><td class="v">${fmt(tw.tri_m, 1)} m</td></tr>
                <tr><td>Relief in 1 km</td><td class="v">${twinRow ? fmt(twinRow.oman_relief_m, 0) + " m" : "–"}</td><td class="v">${fmt(tw.relief_m, 0)} m</td></tr></tbody></table>
                <p class="note">${twinRow ? `Rank ${tw.oman_twins.indexOf(twinRow) + 1} of ${tw.oman_twins.length} Oman terrain twins for this target.` : "This site is not among this target's top terrain twins."} ${esc(data.twins.method || "")}</p>
                <p class="note">Best twins: ${tw.oman_twins.map(o => `<a href="#" data-twin="${o.id}">${esc(o.name)}</a> ${o.terrain_similarity.toFixed(2)}`).join(" · ")}</p>` : `<p class="note">No terrain statistics for this target.</p>`}
              <div class="legend"><span><i style="background:var(--earth)"></i>Oman</span><span><i style="background:var(--accent)"></i>${esc(body)}</span></div>
              <svg class="chart" id="hist" viewBox="0 0 380 220" role="img" aria-label="Slope distribution, Oman versus target"></svg>
              <p class="note">Share of cells per 2.5° slope bin at the clips' common 75 m spacing.${body === "Mars" ? " MOLA (463 m) is smooth at this scale: it shows landforms, not boulders." : ""}</p>
              ${site ? `<a class="btn" href="#site-${esc(omanId)}">Open ${esc(site.name)} passport</a>` : ""}
            </div></div>
        </div></div>`;

      const [hE, hT] = await Promise.all([loadHeights(oMap), loadHeights(tMap)]);
      if (!alive) return;
      shade(root.querySelector("#cE"), hE, [196, 168, 128]);
      shade(root.querySelector("#cT"), hT, world === "moon" ? [172, 174, 178] : [200, 116, 80]);
      const hist = s => { const b = new Array(12).fill(0); let n = 0; for (const v of s) { if (!v) continue; b[Math.min(11, Math.floor(v / 2.5))]++; n++; } return b.map(x => x / (n || 1)); };
      drawHist(root.querySelector("#hist"), hist(slopes(hE)), hist(slopes(hT)), body);

      const lens = root.querySelector("#lens"), range = root.querySelector("#mohoRange");
      const setY = v => { y = Math.max(5, Math.min(95, v)); lens.style.setProperty("--y", y + "%"); range.value = Math.round(y); };
      range.addEventListener("input", () => setY(+range.value));
      let drag = false;
      const mv = e => { const r = lens.getBoundingClientRect(); setY((e.clientY - r.top) / r.height * 100); };
      lens.addEventListener("pointerdown", e => { drag = true; lens.setPointerCapture(e.pointerId); mv(e); });
      lens.addEventListener("pointermove", e => { if (drag) mv(e); });
      lens.addEventListener("pointerup", () => { drag = false; });
      root.querySelector("#pickOman").addEventListener("change", e => { omanId = e.target.value; render(); });
      root.querySelector("#pickTarget").addEventListener("change", e => { targetId = e.target.value; render(); });
      root.querySelectorAll("[data-twin]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); if (omanMaps.some(o => o.id === "oman_" + a.dataset.twin)) { omanId = a.dataset.twin; render(); } else go("#site-" + a.dataset.twin); }));
    }
    function drawHist(svg, e, t, name) {
      const W = 380, H = 220, L = 38, R = 10, T = 12, B = 32, max = Math.ceil(Math.max(...e, ...t) * 10) / 10 || .1;
      const x = i => L + i / 12 * (W - L - R), yy = v => T + (1 - v / max) * (H - T - B), step = a => a.map((v, i) => `${x(i)},${yy(v)} ${x(i + 1)},${yy(v)}`).join(" ");
      let g = "";
      for (let k = 0; k <= 4; k++) { const v = max * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${yy(v)}" y2="${yy(v)}" stroke="var(--hair)"/><text x="${L - 6}" y="${yy(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${Math.round(v * 100)}%</text>`; }
      for (let i = 0; i <= 12; i += 2) g += `<text x="${x(i)}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${i * 2.5}°</text>`;
      let hits = ""; for (let i = 0; i < 12; i++) hits += `<rect data-i="${i}" x="${x(i)}" y="${T}" width="${x(1) - x(0)}" height="${H - T - B}" fill="transparent"/>`;
      svg.innerHTML = `${g}<line x1="${L}" x2="${W - R}" y1="${yy(0)}" y2="${yy(0)}" stroke="var(--faint)"/>
        <polyline points="${step(t)}" fill="none" stroke="var(--accent)" stroke-width="2"/><polyline points="${step(e)}" fill="none" stroke="var(--earth)" stroke-width="2"/>
        <text x="${W - R}" y="${H - 2}" text-anchor="end" font-size="11" fill="var(--muted)">slope</text>${hits}`;
      svg.querySelectorAll("rect[data-i]").forEach(r => { const i = +r.dataset.i;
        r.addEventListener("pointermove", ev => showTip(`<b>${i * 2.5}–${(i + 1) * 2.5}°${i === 11 ? "+" : ""}</b><br><span class="mono">Oman ${(e[i] * 100).toFixed(1)}% · ${esc(name)} ${(t[i] * 100).toFixed(1)}%</span>`, ev.clientX, ev.clientY));
        r.addEventListener("pointerleave", hideTip); });
    }

    render();
    off.push(store.subscribe(() => { targetId = null; render(); }));
    const onKey = e => { if (e.key === "Escape") go(route.id ? "#site-" + route.id : "#oman"); };
    addEventListener("keydown", onKey);
    setKeys([["Drag", "Moho line"], ["M", "Mission"], ["Esc", "Back"]]);
    return { cleanup() { alive = false; off.forEach(f => f()); removeEventListener("keydown", onKey); } };
  },
};
