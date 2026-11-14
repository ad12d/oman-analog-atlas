// DIRECTOR: Earth, the Moon and Mars in one sky. Hover a world for its card; click to travel.
import { h, esc, fmt, setKeys } from "../core/ui.js";
import { MISSIONS, CRITERIA } from "../core/data.js";
import { SITES } from "../space/scene.js";

const WORLD_INFO = {
  earth: { title: "Earth", sub: "Oman · analog field", color: "var(--earth)" },
  moon:  { title: "Moon",  sub: "Shackleton ridge",   color: "var(--ice)" },
  mars:  { title: "Mars",  sub: "Jezero crater",      color: "var(--mars)" },
};

export default {
  mount({ view, scene, data, store, go, first }, route) {
    let alive = true;
    scene.setActive(true); scene.setMode("director");
    const root = h("section", { class: "director", "aria-label": "Director" });
    root.innerHTML = `
      ${Object.keys(WORLD_INFO).map(w => `
        <div class="wlabel" data-w="${w}" aria-hidden="true">
          <div class="wring"></div>
          <div class="wtext"><b>${WORLD_INFO[w].title}</b><span>${WORLD_INFO[w].sub}</span><em></em></div>
        </div>`).join("")}
      <aside class="brief panel ticks live" aria-labelledby="brief-h">
        <div class="brief-head"><span class="panel-title" id="brief-h">Mission brief</span><span class="eyebrow" id="bMission"></span></div>
        <div class="brief-body" id="bBody"></div>
      </aside>
      <aside class="dossier panel ticks live" id="dossier" hidden aria-live="polite"></aside>
      <div class="dcard" id="dcard" aria-hidden="true"></div>
      <div class="pin site" id="sitePin" aria-hidden="true"><div class="ring"></div><div class="lead"></div><div class="lbl"><b></b><span></span></div></div>`;
    view.appendChild(root);

    const labels = Object.fromEntries([...root.querySelectorAll(".wlabel")].map(el => [el.dataset.w, el]));
    const card = root.querySelector("#dcard"), dossier = root.querySelector("#dossier"), brief = root.querySelector(".brief");
    let hover = null, focus = null;

    const missionWorld = () => MISSIONS[store.mission].world;
    const sitePin = root.querySelector("#sitePin");
    const latLon = s => `${Math.abs(s.lat).toFixed(1)}° ${s.lat < 0 ? "S" : "N"} ${Math.abs(s.lon).toFixed(1)}° ${s.lon < 0 ? "W" : "E"}`;
    function paintPin(w) {
      if (!w) { sitePin.classList.remove("on"); return; }
      sitePin.style.setProperty("--pc", WORLD_INFO[w].color);
      sitePin.querySelector("b").textContent = SITES[w].name;
      sitePin.querySelector("span").textContent = `${WORLD_INFO[w].title} · ${latLon(SITES[w])}`;
      sitePin.classList.add("on");
    }
    const top = () => data.sites[store.mission][0];

    function paintTags() {
      for (const [w, el] of Object.entries(labels)) {
        const em = el.querySelector("em"), ring = el.querySelector(".wring");
        const isTarget = w === missionWorld(), isEarth = w === "earth";
        em.className = isTarget ? "target" : isEarth ? "analog" : "";
        em.textContent = isTarget ? "Target" : isEarth ? "Analog" : "";
        em.hidden = !isTarget && !isEarth;
        ring.className = "wring" + (isTarget ? " target" : isEarth ? " analog" : "") + (hover === w ? " hot" : "");
      }
    }
    function paintBrief() {
      const M = MISSIONS[store.mission], t = top();
      root.querySelector("#bMission").textContent = M.label;
      root.querySelector("#bBody").innerHTML = `
        <div class="cell"><span>Target</span><b>${esc(M.target)}</b></div>
        <div class="cell c-world"><span>Target world</span><b>${esc(WORLD_INFO[M.world].title)}</b></div>
        <div class="cell c-field"><span>Analog field</span><b>Oman · ${data.sites[store.mission].length} sites</b></div>
        <div class="cell"><span>Top analog</span><b><a href="#site-${t.id}">${esc(t.name)}</a> · ${t.asi.toFixed(2)}</b></div>
        <a class="btn go" href="#oman" data-travel="earth">Travel to Oman <span aria-hidden="true">▸</span></a>`;
    }
    function cardHTML(w) {
      const M = MISSIONS[store.mission];
      if (w === "earth") {
        const list = data.sites[store.mission], t = list[0];
        return `<div class="band" style="--wc:var(--earth)"><h3>Oman</h3><p>Earth · analog field</p></div>
          <div class="body">
            <p class="blurb">Ophiolite mountains, gravel plains and dry wadis scored against ${esc(M.worldName)}.</p>
            <div class="kv"><span>Candidate sites</span><span>${list.length}</span></div>
            <div class="kv"><span>Benchmark wadis</span><span>${list.filter(s => s.benchmark).length}</span></div>
            <div class="kv"><span>Top for ${esc(M.label)}</span><span>${esc(t.name)} · ${t.asi.toFixed(2)}</span></div>
          </div><div class="foot">Click to travel ▸</div>`;
      }
      const m = w === "moon" ? "moon_base" : (store.mission === "moon_base" ? "mars_science" : store.mission);
      const tt = (k) => data.target(k, m);
      return `<div class="band" style="--wc:${WORLD_INFO[w].color}"><h3>${esc(MISSIONS[m].target)}</h3><p>${WORLD_INFO[w].title} · ${esc(MISSIONS[m].label)} target</p></div>
        <div class="body">
          <div class="kv"><span>Target slope</span><span>${fmt(tt("terrain").value, 1)}°</span></div>
          <div class="kv"><span>Temperature range</span><span>${fmt(tt("thermal").value, 0)} K</span></div>
          <div class="kv"><span>Surface minerals</span><span>${esc(tt("minerals").source)}</span></div>
        </div><div class="foot">Click to open target dossier ▸</div>`;
    }
    function openDossier(w) {
      const m = w === "moon" ? "moon_base" : (store.mission === "moon_base" ? "mars_science" : store.mission);
      if (store.mission !== m) store.setMission(m);
      focus = w; brief.hidden = true; dossier.hidden = false;
      const t = data.sites[m][0];
      dossier.innerHTML = `
        <div class="band" style="--wc:${WORLD_INFO[w].color}"><h2>${esc(MISSIONS[m].target)}</h2><p>${WORLD_INFO[w].title} · ${esc(MISSIONS[m].label)} target profile</p></div>
        <div class="panel-body">
          <table>
            <thead><tr><th>Criterion</th><th style="text-align:right">Target ± range</th></tr></thead>
            <tbody>${CRITERIA.map(c => { const tg = data.target(c.k, m); return `<tr>
              <td><span class="chip-dot" style="--rc:var(--c-${c.k})"></span>${esc(c.name)}<small>${esc(tg.source)}</small></td>
              <td class="v">${fmt(tg.value, c.dp)}${esc(c.unit)} ± ${fmt(tg.tol, c.dp)}</td></tr>`; }).join("")}</tbody>
          </table>
          <p class="note" style="margin-top:12px">Best Oman analog for this profile: <a href="#site-${t.id}">${esc(t.name)}</a>, ASI ${t.asi.toFixed(2)}.</p>
        </div>
        <div class="acts">
          <button class="btn primary" type="button" data-travel="earth">Find analogs in Oman ▸</button>
          <button class="btn" type="button" data-back>Back <kbd>Esc</kbd></button>
        </div>`;
      scene.setMode("focus-" + w);
      paintPin(w);
    }
    function closeDossier() { focus = null; dossier.hidden = true; brief.hidden = false; scene.setMode("director"); paintPin(null); }
    function travelEarth() {
      card.classList.remove("on");
      scene.setMode("focus-earth").then(() => go("#oman"));
    }
    function travel(w) { if (w === "earth") travelEarth(); else openDossier(w); }

    root.addEventListener("click", e => {
      if (e.target.closest("[data-travel]")) { e.preventDefault(); travelEarth(); }
      if (e.target.closest("[data-back]")) closeDossier();
    });

    // hover + click on worlds (anywhere outside panels)
    let downAt = null;
    const onMove = e => {
      if (e.target.closest(".live, .hud-top, .hud-bottom")) { setHover(null); return; }
      setHover(scene.pick(e.clientX, e.clientY), e);
    };
    function setHover(w, e) {
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
      const w = scene.pick(e.clientX, e.clientY); if (w) travel(w);
    };
    const onKey = e => {
      if (e.key === "Escape") { if (focus) closeDossier(); else go("#orbit"); }
      if (e.key === "Enter" && !e.target.closest("a, button, input")) travelEarth();
    };
    addEventListener("pointermove", onMove); addEventListener("pointerdown", onDown); addEventListener("pointerup", onUp); addEventListener("keydown", onKey);

    const off = scene.onFrame(() => {
      if (focus) { const p = scene.sitePoint(focus); sitePin.style.transform = `translate(${p.x}px, ${p.y}px)`; sitePin.style.opacity = p.facing && p.front ? 1 : 0; }
      for (const [w, el] of Object.entries(labels)) {
        const p = scene.world(w), size = p.r * 2 + 22;
        el.style.transform = `translate(${p.x}px, ${p.y}px)`; el.style.opacity = p.front && focus !== w ? 1 : 0;
        const ring = el.firstElementChild; ring.style.width = ring.style.height = size + "px";
        const txt = el.lastElementChild; txt.style.left = (p.r * 0.75 + 18) + "px"; txt.style.top = (p.r * 0.75 + 6) + "px";
      }
    });

    scene.setTarget(missionWorld());
    paintTags(); paintBrief();
    const unsub = store.subscribe(() => { scene.setTarget(missionWorld()); paintTags(); paintBrief(); if (focus) openDossier(focus === "moon" && store.mission !== "moon_base" ? "mars" : focus === "mars" && store.mission === "moon_base" ? "moon" : focus); if (hover) card.innerHTML = cardHTML(hover); });
    // deep link (#director-moon / #director-mars): start from the Director shot, then move in
    if (route?.id) { if (first) { scene.setMode("director", true); openDossier(route.id); } else scene.setMode("director").then(() => { if (alive) openDossier(route.id); }); }
    setKeys([["Click", "Travel"], ["Enter", "Oman"], ["M", "Mission"], ["Esc", "Back"]]);

    return { cleanup() {
      alive = false; off(); unsub(); document.body.classList.remove("reticle-hot");
      removeEventListener("pointermove", onMove); removeEventListener("pointerdown", onDown); removeEventListener("pointerup", onUp); removeEventListener("keydown", onKey);
    } };
  },
};
