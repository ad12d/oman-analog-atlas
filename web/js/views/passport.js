// ANALOG PASSPORT: one site, characterised against the current mission's target.
import { esc, fmt, bindTip, showTip, hideTip, reduceMotion } from "../core/ui.js";
import { MISSIONS, MISSION_KEYS, CRITERIA } from "../core/data.js";

const pos = (c, v) => Math.max(0, Math.min(100, ((v - c.min) / (c.max - c.min)) * 100));

export function renderPassport(el, { data, mission, id }) {
  const s = data.site(id, mission);
  if (!s) { el.innerHTML = `<div class="pp-sec"><p class="note">No site with id ${esc(id)} for this mission.</p></div>`; return; }
  const W = data.weights[mission];
  let selected = el.dataset.sel || "terrain";

  const stamps = MISSION_KEYS.map(m => { const x = data.site(id, m);
    return `<div class="stamp ${m === "moon_base" ? "moon" : ""} ${m === mission ? "on" : ""}">${MISSIONS[m].label}<b>${x ? x.asi.toFixed(2) : "—"}</b></div>`; }).join("");
  const denied = (s.gaps || []).map(g => `<div class="stamp denied">Not granted<b>${esc(g)}</b></div>`).join("");
  const benchTag = s.benchmark ? `<span class="tag bench">Benchmark · ${esc(s.benchmark)} set</span>` : "";

  el.innerHTML = `
    <div class="pp">
      <div class="pp-head">
        <div>
          <p class="eyebrow">Analog passport · rank ${s.rank} of ${data.sites[mission].length}</p>
          <h2>${esc(s.name)}</h2>
          <div class="pp-meta"><span>${esc(s.aoi)}</span><span class="mono">≈ ${fmt(s.lonlat[1], 2)}° N, ${fmt(s.lonlat[0], 2)}° E</span><span>Tier ${s.tier ?? 2}</span></div>
          <div class="pp-tags">${benchTag}</div>
        </div>
        <div class="asi-big"><div class="num">${s.asi.toFixed(2)}</div><div class="lab">ASI · ${MISSIONS[mission].label}</div></div>
      </div>
      <div class="pp-sec"><h3>Mission stamps</h3><div class="stamps">${stamps}<div class="sep"></div>${denied}</div></div>
      <div class="pp-sec">
        <div class="cbar-top"><h3>Score breakdown</h3><span class="formula">width = weight · fill = similarity · Σ w·s = ${CRITERIA.reduce((a, c) => a + W[c.k] * s["s_" + c.k], 0).toFixed(3)}</span></div>
        <div class="cbar" role="img" aria-label="${esc(CRITERIA.map(c => `${c.name} weight ${W[c.k]} similarity ${s["s_" + c.k]}`).join("; "))}">
          ${CRITERIA.map(c => `<div class="seg" tabindex="0" data-k="${c.k}" style="--segc:var(--c-${c.k});flex-grow:${W[c.k]}"><div class="fill"></div></div>`).join("")}
        </div>
        <div class="cbar-labels" aria-hidden="true">${CRITERIA.map(c => `<div style="flex-grow:${W[c.k]}"><span class="k">${c.name}</span><br><span class="mono">w ${W[c.k].toFixed(2)} · s ${(+s["s_" + c.k]).toFixed(2)}</span></div>`).join("")}</div>
      </div>
      <div class="pp-sec">
        <h3>Oman vs ${esc(MISSIONS[mission].target)}</h3>
        <div class="rows-key"><span><i class="k-dot"></i>Oman value</span><span><i class="k-dia"></i>Target</span><span><i class="k-band"></i>Range that scores above 0</span></div>
        <div class="crows">${CRITERIA.map(c => {
          const t = data.target(c.k, mission), raw = +s["raw_" + c.k], sv = +s["s_" + c.k];
          const lo = Math.max(c.min, t.value - t.tol), hi = Math.min(c.max, t.value + t.tol);
          return `<button type="button" class="crow" data-k="${c.k}" style="--rc:var(--c-${c.k})" aria-pressed="${c.k === selected}"
              aria-label="${esc(`${c.name}: Oman ${fmt(raw, c.dp)}${c.unit}, target ${fmt(t.value, c.dp)}${c.unit}, similarity ${sv.toFixed(2)}`)}">
            <span class="name"><span class="chip"></span><span><b>${c.name}</b><small>${c.word}</small></span></span>
            <span class="track"><span class="base"></span><span class="tol" style="left:${pos(c, lo)}%;width:${pos(c, hi) - pos(c, lo)}%"></span>
              <span class="tgt" style="left:${pos(c, t.value)}%"></span><span class="er" style="left:${pos(c, raw)}%"></span></span>
            <span class="vals"><b>${fmt(raw, c.dp)}${c.unit}</b> Oman<br>${fmt(t.value, c.dp)}${c.unit} target</span>
            <span class="sval ${sv < 0.4 ? "weak" : ""}">${sv.toFixed(2)}</span></button>`; }).join("")}</div>
        <div class="curve-box"><p class="eyebrow" data-ctitle></p><svg class="curve" viewBox="0 0 420 210" role="img" aria-label="Similarity rule"></svg><p class="src" data-csrc></p></div>
      </div>
      <div class="pp-sec">
        <div class="mbu">
          <div class="m"><h4>Matches</h4><ul>${(s.matches || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div class="b"><h4>Breaks down</h4><ul>${(s.gaps || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div class="u"><h4>Best use</h4><p>${esc(s.best_use || "")}</p></div>
        </div>
      </div>
      <div class="pp-sec">
        <h3>Field evidence</h3>
        <p class="note">Drone LiDAR survey: not yet added. Luqman's DTM and photos will appear here (EXIF stripped).</p>
        <div class="pp-acts"><a class="btn" href="#twin-${esc(id)}">Open Twin Lens ▸</a></div>
      </div>
    </div>`;

  // animate fills
  el.querySelectorAll(".seg").forEach((seg, i) => {
    const sv = +s["s_" + seg.dataset.k], fill = seg.firstElementChild;
    if (reduceMotion) fill.style.width = sv * 100 + "%";
    else { fill.style.transitionDelay = i * 90 + "ms"; requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = sv * 100 + "%"; })); }
    const c = CRITERIA.find(x => x.k === seg.dataset.k);
    bindTip(seg, () => `<b>${c.name}</b><br><span class="mono">weight ${W[c.k].toFixed(2)} · similarity ${sv.toFixed(2)}<br>adds ${(W[c.k] * sv).toFixed(3)} to the ASI</span>`);
  });
  el.querySelectorAll(".crow").forEach(b => b.addEventListener("click", () => {
    selected = el.dataset.sel = b.dataset.k;
    el.querySelectorAll(".crow").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    drawCurve(el.querySelector(".curve-box"), data, mission, selected, +s["raw_" + selected]);
  }));
  drawCurve(el.querySelector(".curve-box"), data, mission, selected, +s["raw_" + selected]);
}

// Membership curve for one criterion: linear ramp around the target. Exported for the Method page.
export function drawCurve(box, data, mission, k, earth) {
  const c = CRITERIA.find(x => x.k === k), t = data.target(k, mission);
  const svg = box.querySelector("svg"), W = 420, H = 210, L = 40, R = 14, T = 16, B = 34;
  const x = v => L + (v - c.min) / (c.max - c.min) * (W - L - R), y = v => T + (1 - v) * (H - T - B);
  const sAt = v => Math.max(0, 1 - Math.abs(v - t.value) / t.tol);
  const pts = []; for (let i = 0; i <= 160; i++) { const v = c.min + (c.max - c.min) * i / 160; pts.push(`${x(v).toFixed(1)},${y(sAt(v)).toFixed(1)}`); }
  const dp = (c.max - c.min) < 2 ? 2 : 0;
  let g = "";
  for (let i = 0; i <= 5; i++) { const v = c.min + (c.max - c.min) * i / 5;
    g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}" stroke="var(--hair)"/><text x="${x(v)}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${fmt(v, dp)}</text>`; }
  for (const v of [0, .5, 1]) g += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${v}</text>`;
  const hasEarth = Number.isFinite(earth), s = hasEarth ? sAt(earth) : 0;
  svg.innerHTML = `${g}
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--faint)"/>
    <polygon points="${x(c.min)},${y(0)} ${pts.join(" ")} ${x(c.max)},${y(0)}" fill="color-mix(in oklab, var(--accent) 16%, transparent)"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    <rect x="${x(t.value) - 6}" y="${y(1) - 6}" width="12" height="12" transform="rotate(45 ${x(t.value)} ${y(1)})" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>
    ${hasEarth ? `<line x1="${x(earth)}" x2="${x(earth)}" y1="${y(s)}" y2="${y(0)}" stroke="var(--c-${k})" stroke-width="1.5" stroke-dasharray="3 3"/>
    <line x1="${L}" x2="${x(earth)}" y1="${y(s)}" y2="${y(s)}" stroke="var(--c-${k})" stroke-width="1.5" stroke-dasharray="3 3"/>
    <circle cx="${x(earth)}" cy="${y(s)}" r="7" fill="var(--c-${k})" stroke="var(--bg)" stroke-width="2"/>
    <text x="${Math.min(x(earth) + 11, W - R - 66)}" y="${Math.max(T + 10, y(s) - 10)}" font-size="12" fill="var(--fg)" font-family="var(--f-mono)">s = ${s.toFixed(2)}</text>` : ""}
    <text x="${W - R}" y="${H - 2}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(c.metric)}${c.unit ? " (" + c.unit.trim() + ")" : ""}</text>
    <text x="${L}" y="${T - 4}" font-size="11" fill="var(--muted)">similarity s</text>
    <line class="cx" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--fg)" stroke-opacity=".35" visibility="hidden"/>
    <rect class="chit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>`;
  box.querySelector("[data-ctitle]").textContent = `Similarity rule · ${c.name}`;
  box.querySelector("[data-csrc]").textContent = `Oman: ${c.src}. Target: ${t.source}. Linear ramp: 1 at the target, 0 beyond ±${fmt(t.tol, c.dp)}${c.unit}.`;
  const hit = svg.querySelector(".chit"), cx = svg.querySelector(".cx");
  hit.addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, v = c.min + (px - L) / (W - L - R) * (c.max - c.min);
    cx.setAttribute("x1", px); cx.setAttribute("x2", px); cx.setAttribute("visibility", "visible");
    showTip(`<span class="mono">${esc(c.metric)}: ${fmt(v, c.dp)}${c.unit}<br>similarity: ${sAt(v).toFixed(2)}</span>`, e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", () => { cx.setAttribute("visibility", "hidden"); hideTip(); });
}
