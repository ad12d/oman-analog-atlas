// App entry: loads data, starts the space scene, routes between views on the URL hash.
import { $, $$, esc, finePointer, toast } from "./core/ui.js";
import { store } from "./core/store.js";
import { fx } from "./core/fx.js";
import { loadData, MISSION_KEYS } from "./core/data.js";
import { createSpace } from "./space/scene.js";
import orbit from "./views/orbit.js";
import director from "./views/director.js";
import atlas from "./views/atlas.js";
import twin from "./views/twin.js";
import method from "./views/method.js";
import sources from "./views/sources.js";
import vr from "./views/vr.js";

// route name -> view module. "site-<ID>", "twin-<ID>" and "vr-<ID>" carry a site id.
const ROUTES = { orbit, director, oman: atlas, site: atlas, twin, method, sources, vr };

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "orbit";
  const m = raw.match(/^(site|twin|vr)-([A-Za-z0-9_]+)$/);
  if (m) return { name: m[1], id: m[2] };
  const d = raw.match(/^director-(moon|mars)$/);           // deep link straight to a target dossier
  if (d) return { name: "director", id: d[1] };
  return { name: ROUTES[raw] ? raw : "orbit" };
}

function crumbs(route, data) {
  const parts = [["#director", "Director"]];
  if (route.name === "orbit") return [["#orbit", "Orbit"]];
  if (["oman", "site", "twin", "vr"].includes(route.name)) parts.push(["#oman", "Earth · Oman"]);
  if ((route.name === "site" || route.name === "twin" || route.name === "vr") && route.id) {
    const s = data.site(route.id, store.mission);
    parts.push([`#site-${route.id}`, s ? s.name : route.id]);
  }
  if (route.name === "twin") parts.push([location.hash, "Twin Lens"]);
  if (route.name === "vr") parts.push([location.hash, "VR landing"]);
  if (route.name === "method") parts.push(["#method", "Method"]);
  if (route.name === "sources") parts.push(["#sources", "Sources"]);
  return parts;
}

async function start() {
  const view = $("#view");
  let data;
  try { data = await loadData(); }
  catch (err) {
    view.innerHTML = `<div class="page live"><div class="page-inner"><h1>Data files not found</h1><p class="note">${esc(err.message)}. Start the local server from the web folder (see README).</p></div></div>`;
    return;
  }
  $("#mockFlag").hidden = !data.isMock;

  const scene = createSpace($("#space"));
  if (new URLSearchParams(location.search).has("debug")) window.__oaa = { scene, store, data };   // QA only
  // first: true only for the view opened by the initial page load (no fly-in transitions then)
  const ctx = { view, scene, data, store, first: true, go: (hash) => { location.hash = hash; } };

  // mission switch in the top bar
  const sw = $("#mission");
  const paintSwitch = () => $$("button", sw).forEach(b => b.setAttribute("aria-checked", String(b.dataset.m === store.mission)));
  sw.addEventListener("click", e => { const b = e.target.closest("button[data-m]"); if (b) store.setMission(b.dataset.m); });
  sw.addEventListener("keydown", e => {
    if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const i = MISSION_KEYS.indexOf(store.mission), m = MISSION_KEYS[(i + (e.key === "ArrowRight" ? 1 : -1) + MISSION_KEYS.length) % MISSION_KEYS.length];
    store.setMission(m); sw.querySelector(`[data-m="${m}"]`).focus(); e.preventDefault();
  });
  store.subscribe(paintSwitch); paintSwitch();

  // graphics quality switch (footer button + G)
  const fxBtn = $("#fxBtn");
  const paintFx = () => { const hi = fx.level === "high"; fxBtn.setAttribute("aria-pressed", String(hi)); fxBtn.innerHTML = `Graphics <b>${hi ? "High" : "Light"}</b>`; };
  fxBtn.addEventListener("click", () => fx.toggle());
  fx.subscribe(paintFx); paintFx();

  // global keys
  addEventListener("keydown", e => {
    if (e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "m" || e.key === "M") { const i = MISSION_KEYS.indexOf(store.mission); store.setMission(MISSION_KEYS[(i + 1) % MISSION_KEYS.length]); }
    if (e.key === "g" || e.key === "G") { fx.toggle(); toast(`Graphics: ${fx.level === "high" ? "high (bloom on)" : "light (bloom off)"}`); }
  });

  // reticle cursor for the space views
  const ret = $("#reticle");
  if (finePointer) addEventListener("pointermove", e => { ret.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; });

  let current = null, currentMod = null;
  async function route() {
    const r = parseHash(), mod = ROUTES[r.name];
    // same module (Oman map <-> site passport): update in place
    if (current && currentMod === mod && current.update) { current.update(r); }
    else {
      current?.cleanup?.(); view.innerHTML = "";
      document.body.classList.remove("map-on", "reticle-on", "reticle-hot");
      currentMod = mod; current = (await mod.mount(ctx, r)) || {};
    }
    ctx.first = false;
    document.body.classList.toggle("reticle-on", finePointer && (r.name === "orbit" || r.name === "director"));
    $("#crumbs").innerHTML = crumbs(r, data).map(([href, label], i, a) =>
      i === a.length - 1 ? `<span class="here">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a><span class="sep">/</span>`).join("");
    $$(".menu a").forEach(a => a.toggleAttribute("aria-current", a.dataset.r === (r.name === "site" || r.name === "twin" ? "oman" : r.name)));
    if (a11yFocus) view.focus({ preventScroll: true });
  }
  let a11yFocus = false;
  addEventListener("hashchange", () => { a11yFocus = true; route(); });
  route();
}
start();
