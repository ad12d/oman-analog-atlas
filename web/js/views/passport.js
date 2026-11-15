// ANALOG PASSPORT: one site, characterised against the current mission's target.
import { esc, fmt, bindTip, showTip, hideTip, reduceMotion } from "../core/ui.js";
import { MISSIONS, MISSION_KEYS, CRITERIA, RULE_PLAIN, score100, pctOf, betterThan } from "../core/data.js";
import { twinOf, slopeWords, reliefWords } from "./destinations.js";

const REHEARSE = { moon_base: "a Moon-base camp", mars_landing: "a Mars landing", mars_science: "the search for signs of past life on Mars", mars_sedimentary: "reading Mars rock layers" };
const CANT = { moon: "low gravity, vacuum and the deep polar cold", mars: "low gravity, thin air and the Martian cold" };
const ICON = { slope: "◢", tri: "⁂", relief: "⛰", dT_diurnal: "☀", dT_annual: "📅", wind: "≋", ndvi: "🏜", channels: "〰", minerals: "◆", access: "🛣" };
const WHY_STRONG = { slope: "the ground is as steep as the target's", tri: "the ground is about as bumpy", relief: "the hills are the right size",
  dT_diurnal: "the ground heats and cools a lot", dT_annual: "the seasons swing hard", wind: "the wind matches", ndvi: "it is almost bare of plants",
  channels: "ancient riverbeds are close", minerals: "it has the same water-formed minerals", access: "field teams can reach it easily" };
/** everyday words for a criterion value where they exist */
const everyday = (k, v) => k === "slope" ? ` (${slopeWords(v)})` : k === "relief" ? ` (${reliefWords(v)})` : "";
/** what to show as the destination's value: the real world value; Oman-only limits are never shown as targets */
function worldVal(t, c, world) {
  if (c.k === "access") return "Field logistics (Earth only)";
  return `${world === "moon" ? "On the Moon" : "On Mars"}: ${t.world || fmt(t.value, c.dp) + c.unit}`;
}

// gap / match texts from the GIS export carry "(s 0.18)"; show the match as a percentage instead
const plainGap = g => String(g).replace(/\(s ([0-9.]+)\)/, (_, v) => `(${Math.round(+v * 100)}% match)`);
const pos = (c, v) => Math.max(0, Math.min(100, ((v - c.min) / (c.max - c.min)) * 100));

export function renderPassport(el, { data, mission, id }) {
  const s = data.site(id, mission);
  if (!s) { el.innerHTML = `<div class="pp-sec"><p class="note">No site with id ${esc(id)} for this mission.</p></div>`; return; }
  const W = data.weights[mission];
  let selected = CRITERIA.some(c => c.k === el.dataset.sel) ? el.dataset.sel : "slope";

  const stamps = MISSION_KEYS.map(m => { const x = data.site(id, m);
    return `<div class="stamp ${m === "moon_base" ? "moon" : ""} ${m === mission ? "on" : ""}">${MISSIONS[m].label}<b>${x ? score100(x.asi) : "—"}</b></div>`; }).join("");
  // physical gaps the index cannot close (gravity, atmosphere, radiation) become "not granted" stamps; weak matches stay in the list below
  const denied = (s.gaps || []).filter(g => !/^weak/i.test(g)).map(g => `<div class="stamp denied">Earth can't copy<b>${esc(g)}</b></div>`).join("");
  const GROUP = { benchmark: "Known analog site", drone_range: "Within reach of our drone team (80 km of Al Bidiyah)", national_top: "Among Oman's best sites" };
  const benchTag = s.benchmark ? `<span class="tag bench">Known analog site · ${s.benchmark === "calibrate" ? "used to tune the score" : "independent test"}${s.validation_percentile != null && Number.isFinite(+s.validation_percentile) ? ` · ${betterThan(s.validation_percentile)}` : ""}</span>` : "";
  const groupTags = (s.group || []).filter(g => g !== "benchmark").map(g => `<span class="tag">${esc(GROUP[g] || g)}</span>`).join("");
  const emitTag = s.emit_covered === false ? `<span class="tag" title="EMIT, a mineral scanner on the International Space Station, has no reading here">No mineral reading here: Oman average used</span>` : s.emit_covered ? `<span class="tag" title="EMIT: a mineral scanner on the International Space Station">Minerals measured from space</span>` : "";

  const world = MISSIONS[mission].world;
  const strong = CRITERIA.map(c => ({ c, pts: W[c.k] * s["s_" + c.k], sv: s["s_" + c.k] })).filter(x => x.sv >= 0.5).sort((a, b) => b.pts - a.pts).slice(0, 3);
  const lead = `Good for rehearsing ${REHEARSE[mission]}${strong.length ? ` because ${strong.slice(0, 2).map(x => WHY_STRONG[x.c.k]).join(" and ")}` : ""}; it can't copy ${CANT[world]}.`;
  el.innerHTML = `
    <div class="pp">
      <div class="pp-head">
        <div>
          <p class="eyebrow">Analog passport · ranked ${s.rank} of ${data.sites[mission].length} shortlisted sites for ${esc(MISSIONS[mission].label)}</p>
          <h2>${esc(s.name)}</h2>
          <div class="pp-meta"><span>${esc(s.aoi)}</span><span class="mono">≈ ${fmt(s.lonlat[1], 2)}° N, ${fmt(s.lonlat[0], 2)}° E</span>${s.km_from_hackathon != null ? `<span>${fmt(s.km_from_hackathon, 0)} km from Al Bidiyah</span>` : ""}</div>
          <div class="pp-tags">${benchTag}${groupTags}${emitTag}<span data-twinchip></span></div>
        </div>
        <div class="asi-big"><button type="button" class="btn site3d-btn" id="site3dBtn">View site in 3D</button><div class="num">${score100(s.asi)}</div><div class="lab">Analog score / 100</div><div class="lab tech">${MISSIONS[mission].label}</div></div>
      </div>
      <div class="pp-sec pp-lead"><p class="lead">${esc(lead)}</p>
        <div class="strong">${strong.map(x => `<div class="sitem" style="--rc:var(--c-${x.c.k})"><span class="ic" aria-hidden="true">${ICON[x.c.k]}</span><span><b>${esc(x.c.name)}</b><small>${pctOf(x.sv)} match</small></span></div>`).join("")}</div></div>
      <div class="pp-sec"><h3>Score for each mission</h3><div class="stamps">${stamps}<div class="sep"></div>${denied}</div>
        <p class="note">${esc(MISSIONS[mission].plain)} Grey stamps show what no place on Earth can copy.</p></div>
      <details class="pp-more"><summary>See the full breakdown</summary>
      <div class="pp-sec">
        <div class="cbar-top"><h3>What makes up the score</h3><span class="formula">bar width = how much it matters · coloured part = how well this site matches</span></div>
        <div class="cbar" role="img" aria-label="${esc(CRITERIA.map(c => `${c.name} matters ${pctOf(W[c.k])}, match ${pctOf(s["s_" + c.k])}`).join("; "))}">
          ${CRITERIA.map(c => `<div class="seg" tabindex="0" data-k="${c.k}" style="--segc:var(--c-${c.k});flex-grow:${W[c.k]}"><div class="fill"></div></div>`).join("")}
        </div>
        <div class="cbar-labels" aria-hidden="true">${CRITERIA.map(c => `<div style="flex-grow:${W[c.k]}">${W[c.k] >= .06 ? `<span class="k">${c.name}</span><br><span class="mono">matters ${pctOf(W[c.k])} · match ${pctOf(s["s_" + c.k])}</span>` : ""}</div>`).join("")}</div>
        <p class="note">Small criteria are unlabelled; hover a segment for its values.</p>
        <details class="experts"><summary>For experts</summary><p class="tech">ASI = sum over all criteria of weight × similarity = ${CRITERIA.reduce((a, c) => a + W[c.k] * s["s_" + c.k], 0).toFixed(3)}; weights from the AHP method (90 m analysis).</p></details>
      </div>
      <div class="pp-sec">
        <h3>This site compared with ${esc(MISSIONS[mission].target)}</h3>
        <div class="rows-key"><span><i class="k-dot"></i>This site</span><span><i class="k-dia"></i>Full marks</span><span><i class="k-band"></i>Range that still counts as a match</span></div>
        <div class="crows">${CRITERIA.map(c => {
          const t = data.target(c.k, mission), raw = +s["raw_" + c.k], sv = +s["s_" + c.k];
          const [b0, b1] = data.band(c.k, mission), lo = Math.max(c.min, b0), hi = Math.min(c.max, b1);
          return `<button type="button" class="crow" data-k="${c.k}" style="--rc:var(--c-${c.k})" aria-pressed="${c.k === selected}"
              aria-label="${esc(`${c.name}: this site ${fmt(raw, c.dp)}${c.unit}, ${worldVal(t, c, world)}, match ${pctOf(sv)}`)}">
            <span class="name"><span class="chip"></span><span><b>${c.name}</b><small>${c.word}</small></span></span>
            <span class="track"><span class="base"></span><span class="tol" style="left:${pos(c, lo)}%;width:${pos(c, hi) - pos(c, lo)}%"></span>
              <span class="tgt" style="left:${pos(c, t.value)}%"></span><span class="er" style="left:${pos(c, raw)}%"></span></span>
            <span class="vals"><b>${fmt(raw, c.dp)}${c.unit}</b> here${everyday(c.k, raw)}<br>${esc(worldVal(t, c, world))}${t.omanNote ? `<br><i class="onote">Earth can't reach this; Oman's own best counts as 100%</i>` : ""}</span>
            <span class="sval ${sv < 0.4 ? "weak" : ""}">${pctOf(sv)}</span></button>`; }).join("")}</div>
        <p class="note">Tap a row to see what it measures, why it matters and how the match is scored.</p>
        <div class="curve-box"><p class="eyebrow" data-ctitle></p><svg class="curve" viewBox="0 0 420 210" role="img" aria-label="How the match is scored"></svg><p class="src" data-csrc></p></div>
      </div>
      </details>
      <div class="pp-sec">
        <div class="mbu">
          <div class="m"><h4>Where it matches</h4><ul>${(s.matches || []).map(x => `<li>${esc(plainGap(x))}</li>`).join("")}</ul></div>
          <div class="b"><h4>Where it falls short</h4><ul>${(s.gaps || []).map(x => `<li>${esc(plainGap(x))}</li>`).join("")}</ul></div>
          <div class="u"><h4>Best used for</h4><p>${esc(s.best_use || "")}</p></div>
        </div>
      </div>
      <div class="pp-sec">
        <h3>Field survey</h3>
        <p class="note">Our drone survey (LiDAR, a laser scanner) will add centimetre-scale terrain and photos here. Until then the scores come from satellite data.</p>
        <div class="pp-acts"><a class="btn primary" href="#vr-${esc(id)}">Land here in VR ▸</a><a class="btn" href="#twin-${esc(id)}">Compare terrain ▸</a></div>
      </div>
    </div>`;

  // "This site is the Oman twin of …" (from the destinations data)
  twinOf(id).then(list => {
    const chip = el.querySelector("[data-twinchip]"); if (!chip || !list.length) return;
    const main = list.filter(x => x.main), show = main.length ? main : list;
    chip.outerHTML = `<span class="tag twinchip">${main.length ? "This site is the Oman twin of" : "A close Oman match for"} ${show.map(x => `<a href="#destination-${x.id}">${esc(x.name)}</a>`).join(", ")}</span>`;
  });

  // animate fills
  el.querySelectorAll(".seg").forEach((seg, i) => {
    const sv = +s["s_" + seg.dataset.k], fill = seg.firstElementChild;
    if (reduceMotion) fill.style.width = sv * 100 + "%";
    else { fill.style.transitionDelay = i * 90 + "ms"; requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = sv * 100 + "%"; })); }
    const c = CRITERIA.find(x => x.k === seg.dataset.k);
    bindTip(seg, () => `<b>${c.name}</b><br>matters ${pctOf(W[c.k])} for this mission · match ${pctOf(sv)}<br><span class="mono">adds ${(W[c.k] * sv * 100).toFixed(1)} points to the score</span>`);
  });
  el.querySelectorAll(".crow").forEach(b => b.addEventListener("click", () => {
    selected = el.dataset.sel = b.dataset.k;
    el.querySelectorAll(".crow").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    drawCurve(el.querySelector(".curve-box"), data, mission, selected, +s["raw_" + selected], +s["s_" + selected]);
  }));
  drawCurve(el.querySelector(".curve-box"), data, mission, selected, +s["raw_" + selected], +s["s_" + selected]);
}

// How one criterion is scored (bell curve, one-sided or mineral score, from targets.csv), in plain words. Exported for the Method page.
// sOfficial: the site's computed similarity (90 m analysis); the dot sits there rather than on a recomputed value.
export function drawCurve(box, data, mission, k, earth, sOfficial) {
  const c = CRITERIA.find(x => x.k === k), t = data.target(k, mission);
  const svg = box.querySelector("svg"), W = 420, H = 210, L = 40, R = 14, T = 16, B = 34;
  const x = v => L + (v - c.min) / (c.max - c.min) * (W - L - R), y = v => T + (1 - v) * (H - T - B);
  const sAt = v => data.sim(k, mission, v);
  const pts = []; for (let i = 0; i <= 160; i++) { const v = c.min + (c.max - c.min) * i / 160; pts.push(`${x(v).toFixed(1)},${y(sAt(v)).toFixed(1)}`); }
  const dp = (c.max - c.min) < 2 ? 2 : 0;
  let g = "";
  for (let i = 0; i <= 5; i++) { const v = c.min + (c.max - c.min) * i / 5;
    g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}" stroke="var(--hair)"/><text x="${x(v)}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${fmt(v, dp)}</text>`; }
  for (const v of [0, .5, 1]) g += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${v * 100}%</text>`;
  const hasEarth = Number.isFinite(earth), s = hasEarth ? (Number.isFinite(sOfficial) ? sOfficial : sAt(earth)) : 0;
  svg.innerHTML = `${g}
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--faint)"/>
    <polygon points="${x(c.min)},${y(0)} ${pts.join(" ")} ${x(c.max)},${y(0)}" fill="color-mix(in oklab, var(--accent) 16%, transparent)"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    <rect x="${x(t.value) - 6}" y="${y(1) - 6}" width="12" height="12" transform="rotate(45 ${x(t.value)} ${y(1)})" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>
    ${hasEarth ? `<line x1="${x(earth)}" x2="${x(earth)}" y1="${y(s)}" y2="${y(0)}" stroke="var(--c-${k})" stroke-width="1.5" stroke-dasharray="3 3"/>
    <line x1="${L}" x2="${x(earth)}" y1="${y(s)}" y2="${y(s)}" stroke="var(--c-${k})" stroke-width="1.5" stroke-dasharray="3 3"/>
    <circle cx="${x(earth)}" cy="${y(s)}" r="7" fill="var(--c-${k})" stroke="var(--bg)" stroke-width="2"/>
    <text x="${Math.min(x(earth) + 11, W - R - 66)}" y="${Math.max(T + 10, y(s) - 10)}" font-size="12" fill="var(--fg)" font-family="var(--f-mono)">match ${Math.round(s * 100)}%</text>` : ""}
    <text x="${W - R}" y="${H - 2}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(c.name)}${c.unit ? " (" + c.unit.trim() + ")" : ""}</text>
    <text x="${L}" y="${T - 4}" font-size="11" fill="var(--muted)">match with the target</text>
    <line class="cx" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--fg)" stroke-opacity=".35" visibility="hidden"/>
    <rect class="chit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>`;
  box.querySelector("[data-ctitle]").textContent = `How the match is scored · ${c.name}`;
  const onWorld = k === "access" ? "Field logistics (Earth only): not a property of the Moon or Mars." : t.world ? `${t.body === "Moon" ? "On the Moon" : "On Mars"}: ${t.world}${t.worldSrc ? ` (${t.worldSrc})` : ""}.` : "";
  box.querySelector("[data-csrc]").innerHTML = `<b>What it measures:</b> ${esc(c.what)} <b>Why it matters:</b> ${esc(c.why)}<br><b>Scoring:</b> ${esc(RULE_PLAIN[t.kind] || RULE_PLAIN.linear)} Full marks at ${fmt(t.value, c.dp)}${c.unit}. ${esc(onWorld)}${t.omanNote ? ` <i class="onote">Earth can't reach this; Oman's own best counts as 100%.</i>` : ""}
    <details class="experts"><summary>For experts</summary><span class="tech">Data: ${esc(c.src)} (Oman) · ${esc(t.source)} (target)${t.rule ? ` · rule: ${esc(t.rule)}` : ""}</span></details>`;
  const hit = svg.querySelector(".chit"), cx = svg.querySelector(".cx");
  hit.addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, v = c.min + (px - L) / (W - L - R) * (c.max - c.min);
    cx.setAttribute("x1", px); cx.setAttribute("x2", px); cx.setAttribute("visibility", "visible");
    showTip(`<span class="mono">${esc(c.name)}: ${fmt(v, c.dp)}${c.unit}<br>match: ${Math.round(sAt(v) * 100)}%</span>`, e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", () => { cx.setAttribute("visibility", "hidden"); hideTip(); });
}
