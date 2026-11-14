// CHOOSE A MISSION: Earth, the Moon and Mars in one sky. Hover a world for its card; click to fly to its target zone.
import { h, esc, fmt, setKeys, toast } from "../core/ui.js";
import { MISSIONS, CRITERIA, score100 } from "../core/data.js";
import { LEARN, WORLD_FACTS } from "../core/learn.js";
import { SITES } from "../space/scene.js";

const WORLD_INFO = {
  earth: { title: "Earth", sub: "Oman · rehearsal ground", color: "var(--earth)" },
  moon:  { title: "Moon",  sub: "Shackleton ridge",       color: "var(--ice)" },
  mars:  { title: "Mars",  sub: "Jezero crater",          color: "var(--mars)" },
};
// each mission's real place, as a 3D destination (#destination-<id>)
const DEST = { moon_base: "moon_shackleton", mars_landing: "mars_jezero_floor", mars_science: "mars_jezero_delta", mars_sedimentary: "mars_jezero_delta" };
const slopeWords = d => d < 2 ? "flat as a car park" : d < 5 ? "a gentle ramp" : d < 10 ? "a steep driveway" : d < 20 ? "a steep hiking trail" : "a scramble";
const reliefWords = r => r < 20 ? "a flat plain" : r < 60 ? "rolling ground" : r < 150 ? "hilly" : r < 400 ? "mountain slopes" : "a huge crater wall";

export default {
  mount({ view, scene, data, store, go, first }, route) {
    let alive = true;
    scene.setActive(true); scene.setMode("director");
    const root = h("section", { class: "director", "aria-label": "Choose a mission" });
    root.innerHTML = `
      ${Object.keys(WORLD_INFO).map(w => `
        <div class="wlabel" data-w="${w}" aria-hidden="true">
          <div class="wring"></div>
          <div class="wtext"><b>${WORLD_INFO[w].title}</b><span>${WORLD_INFO[w].sub}</span><em></em></div>
        </div>`).join("")}
      <aside class="brief panel ticks live" aria-labelledby="brief-h">
        <div class="brief-head"><span class="panel-title" id="brief-h">Choose a mission</span><span class="eyebrow" id="bMission"></span></div>
        <div class="brief-body" id="bBody"></div>
      </aside>
      <aside class="dossier panel ticks live" id="dossier" hidden aria-live="polite"></aside>
      <div class="dcard" id="dcard" aria-hidden="true"></div>
      <div class="pin site" id="sitePin" aria-hidden="true"><div class="ring"></div><div class="lead"></div><div class="lbl"><b></b><span></span></div></div>`;
    view.appendChild(root);

    const labels = Object.fromEntries([...root.querySelectorAll(".wlabel")].map(el => [el.dataset.w, el]));
    const card = root.querySelector("#dcard"), dossier = root.querySelector("#dossier"), brief = root.querySelector(".brief");
    let hover = null, focus = null, tab = "learn";

    const missionWorld = () => MISSIONS[store.mission].world;
    const sitePin = root.querySelector("#sitePin");
    const latLon = s => `${Math.abs(s.lat).toFixed(1)}° ${s.lat < 0 ? "S" : "N"} ${Math.abs(s.lon).toFixed(1)}° ${s.lon < 0 ? "W" : "E"}`;
    function paintPin(w) {
      if (!w) { sitePin.classList.remove("on"); return; }
      sitePin.style.setProperty("--pc", WORLD_INFO[w].color);
      sitePin.querySelector("b").textContent = SITES[w].name;
      sitePin.querySelector("span").textContent = `${WORLD_INFO[w].title} · ${latLon(SITES[w])}${w === "moon" ? " (approx.)" : ""}`;
      sitePin.classList.add("on");
    }
    const top = () => data.sites[store.mission][0];
    const missionFor = w => w === "moon" ? "moon_base" : (store.mission === "moon_base" ? "mars_science" : store.mission);

    function paintTags() {
      for (const [w, el] of Object.entries(labels)) {
        const em = el.querySelector("em"), ring = el.querySelector(".wring");
        const isTarget = w === missionWorld(), isEarth = w === "earth";
        em.className = isTarget ? "target" : isEarth ? "analog" : "";
        em.textContent = isTarget ? "Destination" : isEarth ? "Rehearsal" : "";
        em.hidden = !isTarget && !isEarth;
        ring.className = "wring" + (isTarget ? " target" : isEarth ? " analog" : "") + (hover === w ? " hot" : "");
      }
    }
    function paintBrief() {
      const M = MISSIONS[store.mission], t = top();
      root.querySelector("#bMission").textContent = M.label;
      root.querySelector("#bBody").innerHTML = `
        <div class="cell"><span>Astronauts are going to</span><b>${esc(M.target)}</b></div>
        <div class="cell c-world"><span>World</span><b>${esc(WORLD_INFO[M.world].title)}</b></div>
        <div class="cell c-field"><span>Rehearsal ground</span><b>Oman · ${data.sites[store.mission].length} sites</b></div>
        <div class="cell"><span>Best match in Oman</span><b><a href="#site-${t.id}">${esc(t.name)}</a> · ${score100(t.asi)}/100</b></div>
        <a class="btn go" href="#director-${M.world}">Fly to ${esc(WORLD_INFO[M.world].title)} <span aria-hidden="true">▸</span></a>`;
    }
    function cardHTML(w) {
      const M = MISSIONS[store.mission];
      if (w === "earth") {
        const list = data.sites[store.mission], t = list[0];
        return `<div class="band" style="--wc:var(--earth)"><h3>Oman</h3><p>Earth · where crews rehearse</p></div>
          <div class="body">
            <p class="blurb">A slice of the Earth's deep mantle sits at the surface in Oman's mountains, next to gravel plains and dry valleys. We score how much each place resembles ${esc(M.worldName)}.</p>
            <div class="kv"><span>Best for ${esc(M.label)}</span><span>${esc(t.name)} · ${score100(t.asi)}/100</span></div>
          </div><div class="foot">Click to fly to Oman ▸</div>`;
      }
      const m = missionFor(w), L = LEARN[m], sl = data.target("slope", m), rl = data.target("relief", m);
      return `<div class="band" style="--wc:${WORLD_INFO[w].color}"><h3>${esc(MISSIONS[m].target)}</h3><p>${WORLD_INFO[w].title} · ${esc(MISSIONS[m].label)}</p></div>
        <div class="body">
          <p class="blurb">${esc(L.place)}</p>
          <div class="kv"><span>The ground</span><span>${slopeWords(sl.value)} (${fmt(sl.value, 1)}°)</span></div>
          <div class="kv"><span>The landscape</span><span>${reliefWords(rl.value)}</span></div>
        </div><div class="foot">Click to fly there ▸</div>`;
    }

    // "On the Moon / On Mars" rows: the real world value; Oman-only limits are explained, never shown as targets
    function worldRows(m, w) {
      const where = w === "moon" ? "On the Moon" : "On Mars";
      return `<table class="wtable"><thead><tr><th>What we compare</th><th style="text-align:right">${where}</th></tr></thead><tbody>${CRITERIA.map(c => {
        const t = data.target(c.k, m);
        if (c.k === "access") return `<tr><td><span class="chip-dot" style="--rc:var(--c-${c.k})"></span>Field logistics (Earth only)<small>How far an Oman site is from a road. Not a property of ${w === "moon" ? "the Moon" : "Mars"}.</small></td><td class="v">n/a</td></tr>`;
        const val = t.world || (fmt(t.value, c.dp) + c.unit);
        return `<tr><td><span class="chip-dot" style="--rc:var(--c-${c.k})"></span>${esc(c.name)}<small>${esc(c.what)}${t.worldSrc ? ` Source: ${esc(t.worldSrc)}.` : ""}</small>${t.omanNote ? `<small class="onote">Earth can't reach this; Oman's own best counts as 100%.</small>` : ""}</td><td class="v">${esc(val)}</td></tr>`;
      }).join("")}</tbody></table>`;
    }
    function learnHTML(m, w) {
      const L = LEARN[m];
      return `<p class="lead">${esc(L.place)}</p>
        <h4>Why astronauts are going</h4><ul class="why">${L.why.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        <h4>What it is like there</h4>
        <div class="wfacts">${WORLD_FACTS[w].map(f => `<div class="wfact"><span>${esc(f.k)}</span><b>${esc(f.v)}</b><small>${esc(f.d)}</small></div>`).join("")}</div>
        <h4>How Oman helps crews rehearse</h4><p>${esc(L.oman)}</p>
        <p class="cant"><span>What Earth can't copy:</span> ${L.cant.map(c => `<i>${esc(c)}</i>`).join("")}</p>
        <div class="didyou"><b>Did you know?</b> ${esc(L.did)}</div>
        <p class="note">${esc(L.learn)}</p>`;
    }
    function openDossier(w) {
      const m = missionFor(w);
      if (store.mission !== m) store.setMission(m);
      focus = w; brief.hidden = true; dossier.hidden = false;
      const t = data.sites[m][0];
      dossier.innerHTML = `
        <div class="band" style="--wc:${WORLD_INFO[w].color}"><h2>${esc(MISSIONS[m].target)}</h2><p>${WORLD_INFO[w].title} · ${esc(MISSIONS[m].label)}</p></div>
        <div class="dtabs" role="tablist">
          <button type="button" role="tab" data-dtab="learn" aria-selected="${tab === "learn"}">Learn</button>
          <button type="button" role="tab" data-dtab="data" aria-selected="${tab === "data"}">${w === "moon" ? "On the Moon" : "On Mars"} vs Oman</button>
        </div>
        <div class="dbody">
          <div data-dpane="learn" ${tab === "learn" ? "" : "hidden"}>${learnHTML(m, w)}</div>
          <div data-dpane="data" ${tab === "data" ? "" : "hidden"}>
            <p class="note" style="margin-bottom:10px">The real conditions at the destination, the things each Oman site is compared with.</p>
            ${worldRows(m, w)}
            <p class="note" style="margin-top:12px">Best match in Oman for this mission: <a href="#site-${t.id}">${esc(t.name)}</a>, analog score ${score100(t.asi)}/100.</p>
          </div>
        </div>
        <div class="acts">
          <button class="btn primary" type="button" data-travel="earth">Find matching places in Oman ▸</button>
          <a class="btn" href="#destination-${DEST[m]}">See it in 3D</a>
          <button class="btn" type="button" data-back>Back <kbd>Esc</kbd></button>
        </div>`;
      scene.setMode("focus-" + w);
      paintPin(w);
    }
    function closeDossier() { focus = null; dossier.hidden = true; brief.hidden = false; scene.setMode("director"); paintPin(null); }
    // the flight starts at once; the Oman map takes over when the camera arrives
    function travelEarth() {
      card.classList.remove("on"); dossier.hidden = true; brief.hidden = true; paintPin(null);
      toast("Flying to Oman…");
      go("#oman");
    }
    // a dossier has its own address (#director-moon / #director-mars), so Back and the menu link both close it
    function travel(w) { if (w === "earth") travelEarth(); else go("#director-" + w); }

    root.addEventListener("click", e => {
      const tb = e.target.closest("[data-dtab]");
      if (tb) { tab = tb.dataset.dtab; dossier.querySelectorAll("[data-dtab]").forEach(b => b.setAttribute("aria-selected", String(b === tb)));
        dossier.querySelectorAll("[data-dpane]").forEach(p => { p.hidden = p.dataset.dpane !== tab; }); dossier.querySelector(".dbody").scrollTop = 0; return; }
      if (e.target.closest("[data-travel]")) { e.preventDefault(); travelEarth(); }
      if (e.target.closest("[data-back]")) go("#director");
    });

    // hover + click on worlds (anywhere outside panels)
    let downAt = null;
    const onMove = e => {
      if (e.target.closest(".live, .hud-top, .hud-bottom")) { setHover(null); return; }
      setHover(scene.pick(e.clientX, e.clientY), e);
    };
    function setHover(w, e) {
      if (w === focus) w = null;
      if (w !== hover) { hover = w; paintTags(); document.body.classList.toggle("reticle-hot", !!w); if (w) card.innerHTML = cardHTML(w); }
      card.classList.toggle("on", !!w);
      if (w && e) {
        const r = card.getBoundingClientRect(); let x = e.clientX + 28, y = e.clientY - 40;
        if (x + r.width > innerWidth - 12) x = e.clientX - r.width - 28;
        if (y + r.height > innerHeight - 70) y = innerHeight - 70 - r.height;
        card.style.left = Math.max(12, x) + "px"; card.style.top = Math.max(70, y) + "px";
      }
    }
    const onDown = e => { downAt = [e.clientX, e.clientY]; };
    const onUp = e => {
      if (!downAt || e.target.closest(".live, .hud-top, .hud-bottom")) return;
      if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
      const w = scene.pick(e.clientX, e.clientY); if (w && w !== focus) travel(w);
    };
    const onKey = e => {
      if (e.key === "Escape") go(focus ? "#director" : "#orbit");
      if (e.key === "Enter" && !e.target.closest("a, button, input")) travelEarth();
    };
    addEventListener("pointermove", onMove); addEventListener("pointerdown", onDown); addEventListener("pointerup", onUp); addEventListener("keydown", onKey);

    const off = scene.onFrame(() => {
      if (focus) { const p = scene.sitePoint(focus); sitePin.style.transform = `translate(${p.x}px, ${p.y}px)`; sitePin.style.opacity = p.facing && p.front && !scene.flying ? 1 : 0; }
      for (const [w, el] of Object.entries(labels)) {
        const p = scene.world(w), size = p.r * 2 + 22;
        el.style.transform = `translate(${p.x}px, ${p.y}px)`; el.style.opacity = p.front && !focus && !scene.flying ? 1 : 0;
        const ring = el.firstElementChild; ring.style.width = ring.style.height = size + "px";
        // label sits lower right of the world; near the right edge (phones) it flips to the left side
        const txt = el.lastElementChild, off = p.r * 0.75 + 18, tw = txt.offsetWidth;
        const flip = p.x + off + tw > innerWidth - 10;
        txt.style.left = (flip ? -off - tw : off) + "px"; txt.style.top = (p.r * 0.75 + 6) + "px";
        txt.style.textAlign = flip ? "right" : ""; txt.style.justifyItems = flip ? "end" : "";
      }
    });

    scene.setTarget(missionWorld());
    paintTags(); paintBrief();
    const unsub = store.subscribe(() => { scene.setTarget(missionWorld()); paintTags(); paintBrief(); if (focus) { const w = focus === "moon" && store.mission !== "moon_base" ? "mars" : focus === "mars" && store.mission === "moon_base" ? "moon" : focus; if (w !== focus) go("#director-" + w); else openDossier(w); } if (hover) card.innerHTML = cardHTML(hover); });
    // deep link (#director-moon / #director-mars): start from the overview shot, then fly in
    if (route?.id) { if (first) { scene.setMode("director", true); openDossier(route.id); } else openDossier(route.id); }
    setKeys([["Click", "Fly there"], ["Enter", "Oman"], ["M", "Mission"], ["Esc", "Back"]]);

    return {
      update(r) { if (r.id) { if (focus !== r.id) openDossier(r.id); } else if (focus) closeDossier(); },
      cleanup() {
        alive = false; off(); unsub(); document.body.classList.remove("reticle-hot");
        removeEventListener("pointermove", onMove); removeEventListener("pointerdown", onDown); removeEventListener("pointerup", onUp); removeEventListener("keydown", onKey);
      } };
  },
};
