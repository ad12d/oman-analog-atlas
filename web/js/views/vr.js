// VR MISSION: a guided, interactive story. Seven chapters on a track you can follow or jump around:
//   Mission (holo-table atlas: where we go, where Oman rehearses it) · Suit up (your suit, part by part) ·
//   Journey (launch, transfer, mission clock) · Orbit (circling the landing zone) · Landing · Base · Debrief.
// VR: land on real terrain and establish a base, taught step by step.
//   Worlds: Oman (Samail ophiolite, Copernicus DEM + Sentinel-2), Moon (Shackleton connecting ridge, LOLA 5 m),
//   Mars (Jezero crater floor, HiRISE 1 m). Switching worlds flies you through space (screen) or fades (headset).
//   1. choose a landing pad   2. watch the powered descent and the touchdown check   3. build the base:
//   place modules yourself (every refusal explains the rule and recommends a better spot) or press
//   "Build the recommended base" to watch the robot grade the ground and each module go up, with narration.
import * as THREE from "three";
import { h, esc, setKeys, toast } from "../core/ui.js";
import { fx } from "../core/fx.js";
import { loadTerrain } from "../vr/terrain.js";
import { createSky, applySkin } from "../vr/skins.js";
import { createLander } from "../vr/lander.js";
import { createCamp } from "../vr/camp.js";
import { createControls } from "../vr/controls.js";
import { createJourney, LEGS } from "../vr/journey.js";
import { createBody, buildSuit, partMarkers, SUIT_PARTS } from "../vr/suit.js";
import { createHolo } from "../vr/holo.js";
import { createHands } from "../vr/hands.js";
import { MISSIONS, MISSION_KEYS, CRITERIA, score100 } from "../core/data.js";
import { LEARN, WORLD_FACTS } from "../core/learn.js";
import { getGrid } from "../core/grid.js";

const LEVEL = ["SAFE", "MARGINAL", "HAZARD"], LEVEL_COL = ["#46c37a", "#f0b040", "#e04a3a"], LEVEL_HEX = [0x46c37a, 0xf0b040, 0xe04a3a];
const WORLDS = {
  oman: { label: "Oman", place: "Samail ophiolite · Wadi Tayin", dirs: id => [id && `data/vr/${id}/`, "data/vr/oman/", "data/vr/mock/"] },
  moon: { label: "Moon", place: "Shackleton connecting ridge", dirs: () => ["data/vr/moon/", "data/vr/mock/"] },
  mars: { label: "Mars", place: "Jezero crater floor", dirs: () => ["data/vr/mars/", "data/vr/mock/"] },
};
// how each placement rule connects to the project's site-selection criteria (for the base report)
const CRITERION_LINK = {
  habitat: "Slope and Roughness: level, even ground", solar: "Hilliness: high ground escapes the shadows of hills",
  comms: "Hilliness: no ridge between the dish and Earth", rover: "Road access: a short walk from the airlock",
  drill: "Ancient riverbeds and Mars-like minerals: where the science and resources are", path: "Road access: a marked, gentle walking route",
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const CH = [{ id: "brief", label: "Mission" }, { id: "suit", label: "Suit up" }, { id: "journey", label: "Journey" }, { id: "orbit", label: "Orbit" },
  { id: "landing", label: "Landing" }, { id: "base", label: "Base" }, { id: "debrief", label: "Debrief" }];
const DEST3D = { moon_base: "moon_shackleton", mars_landing: "mars_jezero_floor", mars_science: "mars_jezero_delta", mars_sedimentary: "mars_jezero_delta" };
const cssColor = k => getComputedStyle(document.documentElement).getPropertyValue("--c-" + k).trim() || "#f2c46d";

/* canvas-texture panel used for the headset console and the info board */
function panel(wm, hm, pw, ph) {
  const cv = document.createElement("canvas"); cv.width = pw; cv.height = ph;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, fog: false, side: THREE.DoubleSide }));
  return { cv, ctx: cv.getContext("2d"), tex, mesh, pw, ph };
}
function label(text, color) {
  const p = panel(9, 2.25, 512, 128), c = p.ctx;
  c.fillStyle = "rgba(6,8,12,.72)"; c.beginPath(); c.roundRect(4, 4, 504, 120, 18); c.fill();
  c.fillStyle = color; c.fillRect(4, 4, 10, 120);
  c.font = "600 40px 'Space Grotesk', sans-serif"; c.fillStyle = "#e9e6df"; c.fillText(text[0], 34, 56);
  c.font = "500 30px 'IBM Plex Mono', monospace"; c.fillStyle = color; c.fillText(text[1], 34, 102);
  p.tex.needsUpdate = true;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: p.tex, depthWrite: false, toneMapped: false, fog: false })); s.scale.set(9, 2.25, 1);
  return s;
}
function wrapText(c, text, x, y, w, lh, max) {
  const words = String(text).split(" "); let line = "", n = 0;
  for (const wd of words) { const t = line ? line + " " + wd : wd; if (c.measureText(t).width > w && line) { c.fillText(line, x, y); y += lh; line = wd; if (++n >= max) return y; } else line = t; }
  if (line) c.fillText(line, x, y); return y + lh;
}

export default {
  mount({ view, scene: space, data, store, go }, route) {
    space.setActive(false);
    let alive = true, world = "oman";

    const root = h("section", { class: "vr live vr-mission", "aria-label": "VR mission: from Oman to the Moon or Mars" });
    root.innerHTML = `
      <canvas class="vr-canvas" aria-label="3D view of the landing site"></canvas>
      <div class="vr-fade" id="vrFade"></div>
      <div class="vr-load" id="vrLoad"><span class="eyebrow" id="vrLoadW">VR</span><b>Loading the real terrain… <span id="vrLoadPct">0%</span></b><div class="vr-prog"><i id="vrLoadBar"></i></div><small id="vrLoadStep">Heights, slopes and shading come from the elevation data.</small></div>
      <aside class="vr-brief panel ticks" hidden>
        <div class="panel-head"><span class="panel-title">Landing &amp; base</span><span class="eyebrow" id="vrPlace"></span></div>
        <div class="panel-body">
          <ol class="vr-steps"><li data-s="pad">Choose a pad</li><li data-s="descent">Watch the landing</li><li data-s="camp">Build the base</li></ol>
          <p class="vr-msg" id="vrMsg" aria-live="polite"></p>
          <p class="vr-src" id="vrSrc"></p>
        </div>
      </aside>
      <aside class="vr-card panel ticks" id="vrCard" hidden></aside>
      <div class="vr-caption panel" id="vrCap" hidden><p class="eyebrow" id="vrCapK"></p><h3 id="vrCapT"></h3><div id="vrCapB"></div><button type="button" class="btn" id="vrCapSkip">Skip</button></div>
      <div class="vr-bar" id="vrBar" role="toolbar" aria-label="VR controls" hidden></div>
      <nav class="vr-track" id="vrTrack" aria-label="Mission track">${CH.map((c, i) => `<button type="button" data-ch="${c.id}"><i>${i + 1}</i><span>${c.label}</span></button>`).join("")}</nav>
      <aside class="vr-guide panel ticks" id="vrGuide" aria-live="polite">
        <div class="g-head"><span class="eyebrow" id="gK"></span><button type="button" class="vr-x" id="gHide" aria-label="Hide the guide" title="Hide the guide (explore freely)">–</button></div>
        <h3 id="gT"></h3><div class="g-body" id="gB"></div>
        <div class="g-acts" id="gActs"></div>
        <div class="g-nav"><button type="button" class="btn" data-a="ch:prev">◂ Back</button><button type="button" class="btn primary" data-a="ch:next" id="gNext">Next ▸</button></div>
      </aside>
      <button type="button" class="btn vr-guide-show" id="gShow" hidden>Show the guide</button>
      <div class="vr-hud" id="vrHud" hidden><b id="hudClock"></b><div class="hud-bar"><i id="hudBar"></i></div><span id="hudDist"></span></div>
      <button type="button" class="btn primary vr-enter" id="vrEnter" hidden>Enter VR</button>`;
    view.appendChild(root);
    const $r = s => root.querySelector(s);
    const canvas = $r(".vr-canvas"), fadeEl = $r("#vrFade");

    /* ---------- renderer / scene ---------- */
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
    catch { $r("#vrLoad").innerHTML = "<b>WebGL is not available on this device.</b>"; return { cleanup() { space.setActive(true); } }; }
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType("local-floor"); renderer.xr.setFoveation(1);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 1, .05, 7000);
    const sky = createSky(scene, renderer), journey = createJourney(); journey.setRenderer(renderer);
    // sharp real-time shadows: a tight shadow box that follows you (baked terrain shading covers the distance)
    sky.sun.shadow.mapSize.set(fx.level === "high" ? 4096 : 2048, fx.level === "high" ? 4096 : 2048);
    { const sc = sky.sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.updateProjectionMatrix(); }
    sky.sun.shadow.normalBias = .15; let sunDir = new THREE.Vector3(0, 1, 0);
    function resize() { renderer.setPixelRatio(Math.min(devicePixelRatio, fx.level === "high" ? 2 : 1.25)); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
    resize(); addEventListener("resize", resize);
    const unFx = fx.subscribe(resize);
    // headset fade (a black shell around the eyes)
    const xrFade = new THREE.Mesh(new THREE.SphereGeometry(.4, 16, 8), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, fog: false }));
    xrFade.renderOrder = 999; xrFade.visible = false; camera.add(xrFade);

    let terrain = null, lander = null, camp = null, controls, rules, menu, board, pads = [], padMarker, padHover, moveMarker, chosen = null;
    let step = "pad", tool = "pad", overlay = false, speed = 1, lastMsg = "", boardT = 0, loading = false, touring = false, flying = false, skipTour = false;
    // mission track
    let ch = null, mission = store.mission, siteId = route.id && data.site(route.id, store.mission) ? route.id : data.sites[store.mission][0].id;
    let part = null, guideOn = true, G = null, journeyOn = false, jCap = { title: "", text: "" }, groundWorld = null, baseDone = false, busy = false;
    const doneCh = new Set();
    const dest = () => MISSIONS[mission].world;
    const site = () => data.site(siteId, mission) || data.sites[mission][0];
    let body, holo, mannequin, mannequinMarks, hands;
    const tmpV = new THREE.Vector3();

    function msg(t) { lastMsg = t; const m = $r("#vrMsg"); if (m) m.textContent = t; drawMenu(); if (ch === "landing" || ch === "base") paintGuide(); }

    /* ---------- ground picking: march along the ray against the height field (cheap on Quest) ---------- */
    function rayGround(ray, max = 400) {
      if (!terrain) return null;
      const o = ray.ray.origin, d = ray.ray.direction; let prev = 0;
      for (let t = .5; t < max; t += t < 40 ? .5 : t < 150 ? 1.5 : 4) {
        const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
        if (!terrain.inside(x, z)) return null;
        if (y <= terrain.heightAt(x, z)) {
          let a = prev, b = t;
          for (let k = 0; k < 12; k++) { const m = (a + b) / 2; (o.y + d.y * m <= terrain.heightAt(o.x + d.x * m, o.z + d.z * m)) ? b = m : a = m; }
          return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
        }
        prev = t;
      }
      return null;
    }

    /* ---------- actions (shared by the screen buttons and the headset console) ---------- */
    function missionActions() {
      const A = [], xr = renderer.xr.isPresenting;
      if (ch === "brief") for (const m of MISSION_KEYS) A.push({ id: "m:mission:" + m, label: MISSIONS[m].label, on: m === mission, group: "m" });
      if (ch === "suit") { for (const p of SUIT_PARTS) A.push({ id: "m:part:" + p.id, label: p.name.split(" and ")[0], on: part === p.id, group: "m" }); }
      if (ch === "journey") A.push({ id: "m:speed", label: journey.speed > 1 ? "Time ×4" : "Time ×1", on: journey.speed > 1, group: "m" }, { id: "m:skip", label: "Skip to orbit", group: "m" });
      if (ch === "orbit") A.push({ id: "m:descend", label: "Begin descent ▸", primary: true, group: "m" });
      if (ch === "landing" && step === "descent") A.push({ id: "speed", label: speed === 1 ? "Speed ×1" : "Speed ×4", on: speed > 1, group: "m" });
      if ((ch === "landing" || ch === "base") && (touring || exiting)) A.push({ id: "skip", label: "Skip ▸", group: "m" });
      if (ch === "debrief") A.push({ id: "m:home", label: "Fly home & rehearse in Oman", primary: true, group: "m" }, { id: "m:other", label: dest() === "moon" ? "Now try Mars" : "Now try the Moon", group: "m" },
        { id: "m:passport", label: "Open the site passport", group: "m" }, { id: "m:dest3d", label: "See the destination in 3D", group: "m" });
      if (!xr && ch !== "journey" && ch !== "orbit") A.push({ id: "m:view", label: body?.mode === "third" ? "First-person view" : "See yourself (3rd person)", on: body?.mode === "third", group: "m" });
      return A;
    }
    function actions() {
      const A = [];
      if (renderer.xr.isPresenting && ch) {                 // the headset console leads with the chapter's own buttons and Back / Next
        A.push(...missionActions().map(a => ({ ...a, group: "main" })));
        A.push({ id: "ch:prev", label: "◂ Back", off: chIndex() <= 0 }, { id: "ch:next", label: nextLabel(), primary: !A.some(a => a.primary), off: !canNext() });
        if (ch !== "landing" && ch !== "base") return A;
      }
      if (touring) A.push({ id: "skip", label: "Skip tour", primary: true });
      else {
        if (step === "descent") A.push({ id: "speed", label: speed === 1 ? "Speed ×1" : "Speed ×4", on: speed > 1 });
        A.push({ id: "tool:move", label: "Walk here", on: tool === "move" });
      }
      for (const k of Object.keys(WORLDS)) A.push({ id: "world:" + k, label: WORLDS[k].label, on: world === k, group: "world", off: touring || flying });
      A.push({ id: "overlay", label: "Slope map", on: overlay }, { id: "reset", label: "Restart", off: touring });
      return A;
    }
    function run(id) {
      if (id.startsWith("ch:") || id.startsWith("m:")) { missionRun(id); return; }
      if (loading || flying) return;
      const [k, v] = id.split(":");
      if (k === "tool") {
        tool = v; camp.setTool(camp.modules.some(m => m.id === v) ? v : null); camp.clearHint();
        if (v === "move") msg("Point at the ground and press to move there.");
        else if (v === "pad") msg("Point at the ground to test a landing pad. Green rings are the best spots.");
        else { const m = camp.MODS[v]; msg(`${m.name}: ${m.role} Green ring = every rule passes; amber = allowed with a caution; red = a rule fails (click to see why).`); }
      }
      else if (k === "world") { if (v !== world && !touring) switchWorld(v); return; }
      else if (k === "overlay") { overlay = !overlay; terrain.setOverlay(overlay); msg(overlay ? "Slope map: green < 5°, amber 5–10°, red > 10°, computed from the elevation data." : "Slope map off."); }
      else if (k === "land") startLanding();
      else if (k === "speed") speed = speed === 1 ? 4 : 1;
      else if (k === "undo") { const p = camp.undo(); msg(p ? "Removed the last module." : "Nothing to undo."); showCamp(); }
      else if (k === "reset") restart();
      else if (k === "tour") buildTour();
      else if (k === "skip") { skipTour = true; skipExit = true; }
      paint();
    }
    function paint() {
      const bar = $r("#vrBar"); if (!bar) return;
      const A = actions();
      const grp = g => A.filter(a => (a.group || "main") === g).map(a => `<button type="button" class="btn${a.primary ? " primary" : ""}" data-a="${a.id}" aria-pressed="${!!a.on}" ${a.off ? "disabled" : ""}>${esc(a.label)}</button>`).join("");
      const ground = !guideOn;
      bar.innerHTML = `${ground ? `<div class="vr-row">${grp("main")}</div>` : ""}${step === "camp" && !touring && ground ? `<div class="vr-row">${grp("mod")}</div>` : ""}<div class="vr-row vr-skins"><span class="eyebrow">Fly to</span>${grp("world")}</div>`;
      bar.hidden = journeyOn || loading;
      root.querySelectorAll(".vr-steps li").forEach(li => li.classList.toggle("on", li.dataset.s === step));
      drawMenu();
    }
    $r("#vrBar").addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (b && !b.disabled) run(b.dataset.a); });

    /* ---------- headset console: waist height, below your line of sight; grip shows / hides it ---------- */
    let menuBtns = [], menuHot = -1;
    function drawMenu() {
      if (!menu) return;
      const c = menu.ctx, W = 512, H = 520, A = actions();
      c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, W, H);
      c.fillStyle = "rgba(10,12,16,.92)"; c.beginPath(); c.roundRect(0, 0, W, H, 22); c.fill();
      c.fillStyle = "#f2c46d"; c.fillRect(0, 0, W, 6);
      c.font = "600 26px 'Space Grotesk', sans-serif"; c.fillStyle = "#e9e6df";
      c.fillText(loading ? "Loading terrain…" : touring ? "Building the base" : { pad: "1 · Choose a pad", descent: "2 · Landing", camp: "3 · Build the base" }[step], 24, 48);
      c.font = "500 12.5px 'IBM Plex Mono', monospace"; c.fillStyle = "#f2c46d";
      c.fillText(`${WORLDS[world].label} · ${WORLDS[world].place}`.toUpperCase(), 24, 72);
      c.font = "400 16px 'IBM Plex Sans', sans-serif"; c.fillStyle = "#c9cdd2";
      wrapText(c, lastMsg, 24, 98, W - 48, 20, 4);
      menuBtns = []; let y = 182;
      const cols = 3, bw = (W - 48 - 16) / cols, bh = 46;
      A.forEach((a, i) => {
        const col = i % cols, x = 24 + col * (bw + 8); if (col === 0 && i) y += bh + 8;
        const hot = i === menuHot;
        c.fillStyle = a.off ? "rgba(255,255,255,.04)" : a.on ? "rgba(242,196,109,.25)" : a.primary ? "#e9e6df" : hot ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.08)";
        c.beginPath(); c.roundRect(x, y, bw, bh, 10); c.fill();
        if (a.on || hot) { c.strokeStyle = "#f2c46d"; c.lineWidth = 3; c.stroke(); }
        c.font = "600 13px 'Space Grotesk', sans-serif"; c.fillStyle = a.primary && !a.on ? "#0d0f12" : a.off ? "#555" : "#e9e6df";
        c.textAlign = "center"; const lbl = a.label.toUpperCase(); c.fillText(lbl.length > 22 ? lbl.slice(0, 21) + "…" : lbl, x + bw / 2, y + 28); c.textAlign = "left";
        menuBtns.push({ x, y, w: bw, h: bh, id: a.id, off: a.off });
      });
      c.font = "500 11.5px 'IBM Plex Mono', monospace"; c.fillStyle = "#8a929c";
      c.fillText("TRIGGER = SELECT   GRIP = SHOW / HIDE THIS CONSOLE   RIGHT STICK = TURN", 24, H - 16);
      menu.tex.needsUpdate = true;
    }
    function menuHit(ray) {
      if (!menu || !menu.mesh.visible) return null;
      const hit = ray.intersectObject(menu.mesh, false)[0]; if (!hit) return null;
      const px = hit.uv.x * 512, py = (1 - hit.uv.y) * 520;
      const i = menuBtns.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
      return { i, d: hit.distance };
    }
    let consoleDue = 0;
    const headPos = new THREE.Vector3(), headDir = new THREE.Vector3();
    function headPose() {
      camera.getWorldPosition(headPos); camera.getWorldDirection(headDir); headDir.y = 0;
      if (headDir.lengthSq() < 1e-4) headDir.set(0, 0, -1); headDir.normalize();
    }
    function placeConsole() {          // waist height, half a metre ahead, tilted up toward the eyes: look down to use it
      if (!menu) return; headPose();
      menu.mesh.position.copy(headPos).addScaledVector(headDir, .5); menu.mesh.position.y = headPos.y - .58;
      menu.mesh.lookAt(headPos.x, headPos.y + .1, headPos.z);
      menu.mesh.visible = true; drawMenu();
    }
    function toggleConsole() { if (!menu) return; if (menu.mesh.visible) menu.mesh.visible = false; else placeConsole(); }

    /* ---------- in-headset info board: beside the console, below eye level ---------- */
    function showBoard(title, lines, color, secs = 14) {
      if (!board || !renderer.xr.isPresenting) return;
      const c = board.ctx, W = board.pw, H = board.ph;
      c.clearRect(0, 0, W, H); c.fillStyle = "rgba(8,10,14,.92)"; c.beginPath(); c.roundRect(0, 0, W, H, 24); c.fill();
      c.fillStyle = color; c.fillRect(0, 0, W, 10);
      c.font = "700 40px 'Space Grotesk', sans-serif"; c.fillStyle = color; c.fillText(title, 32, 66);
      c.font = "400 24px 'IBM Plex Sans', sans-serif"; c.fillStyle = "#e9e6df"; let y = 112;
      for (const l of lines) y = wrapText(c, l, 32, y, W - 64, 30, 3) + 6;
      board.tex.needsUpdate = true;
      headPose(); const right = new THREE.Vector3(-headDir.z, 0, headDir.x);
      board.mesh.position.copy(headPos).addScaledVector(headDir, .75).addScaledVector(right, .62); board.mesh.position.y = headPos.y - .3;
      board.mesh.lookAt(headPos.x, headPos.y - .1, headPos.z);
      board.mesh.visible = true; boardT = secs;
    }

    /* ---------- pads ---------- */
    const padGrade = p => lander.report(p);
    function clearPads() { pads.forEach(p => { scene.remove(p.g); p.g.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }); }); pads = []; }
    function buildPads() {
      const L = rules.landing; clearPads();
      terrain.suggestPads(L.pad_radius_m, 3).forEach((c, i) => {
        const r = padGrade(c), g = new THREE.Group(), col = LEVEL_HEX[r.level];
        const ring = new THREE.Mesh(new THREE.RingGeometry(L.pad_radius_m - .3, L.pad_radius_m, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = .15;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, 26, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        beam.position.y = 13;
        const tag = label([`Pad ${"ABC"[i]}`, `slope ${r.slope.toFixed(1)}° · ${LEVEL[r.level]}`], LEVEL_COL[r.level]); tag.position.y = 7;
        g.add(ring, beam, tag); g.position.set(c.x, terrain.heightAt(c.x, c.z), c.z); scene.add(g);
        pads.push({ x: c.x, z: c.z, g, r, name: `Pad ${"ABC"[i]}` });
      });
    }
    function choosePad(p, name) {
      const r = padGrade(p);
      chosen = { x: p.x, z: p.z, r, name };
      padMarker.visible = true; padMarker.position.set(p.x, terrain.heightAt(p.x, p.z) + .16, p.z); padMarker.material.color.setHex(LEVEL_HEX[r.level]);
      msg(`The computer chose ${name}: slope ${r.slope.toFixed(1)}°, bumps ${Math.round(r.roughness * 100)} cm, the lander will lean ${r.tilt.toFixed(1)}° → ${LEVEL[r.level]}. A lander needs flat, smooth ground so it stands level and can take off again.`);
      paint();
    }

    function startLanding() {
      if (!chosen) return;
      step = "descent"; tool = "move"; camp.setTool(null); padHover.visible = false;
      pads.forEach(p => { p.g.visible = Math.hypot(p.x - chosen.x, p.z - chosen.z) < 1; });
      camera.getWorldPosition(tmpV);
      lander.start(chosen, world, tmpV);
      msg(`Lander inbound to ${chosen.name}: powered descent under ${rules.worlds[world].gravity} m/s² gravity. In the last metres the high-mounted thrusters take over, so less regolith is blasted from under the pad.`);
      $r("#vrCard").hidden = true;
    }
    function onTouchdown(r) {
      step = "camp"; tool = "move"; camp.setLander({ x: chosen.x, z: chosen.z }); pads.forEach(p => p.g.visible = false); padMarker.visible = false;
      const L = rules.landing, col = LEVEL_COL[r.level];
      const row = (n, v, s, hz, g) => `<tr><td>${n}</td><td class="v">${v}</td><td class="lim">${s} / ${hz}</td><td><i class="dot" style="background:${LEVEL_COL[g]}"></i></td></tr>`;
      $r("#vrCard").innerHTML = `<div class="vr-card-head" style="--lc:${col}"><button type="button" class="vr-x" data-a="close" aria-label="Close">×</button><span class="eyebrow">Touchdown · ${esc(chosen.name)}</span><b>${LEVEL[r.level]}</b></div>
        <table class="vr-table"><thead><tr><th>Check</th><th>Measured</th><th>Safe up to / danger from</th><th></th></tr></thead><tbody>
        ${row("Lander tilt", r.tilt.toFixed(1) + "°", L.tilt_safe_deg + "°", L.tilt_hazard_deg + "°", r.grades[0])}
        ${row("Ground slope", r.slope.toFixed(1) + "°", L.slope_safe_deg + "°", L.slope_hazard_deg + "°", r.grades[1])}
        ${row("Surface bumps", Math.round(r.roughness * 100) + " cm", Math.round(L.roughness_safe_m * 100) + " cm", Math.round(L.roughness_hazard_m * 100) + " cm", r.grades[2])}
        </tbody></table>
        <p class="note">Why it matters: a lander leaning more than about 8° could tip over or be unable to take off again, and rocks under a foot can puncture it. Measured on the ${L.pad_radius_m} m pad from the real satellite height map. Limits set by our team from published Moon and Mars landing practice.</p>
        <details class="experts"><summary>For experts</summary><p class="tech">Terrain: ${esc(terrain.meta.source || "terrain tile")}. Small rocks, pebbles and the sky are illustrated.</p></details>
`;
      $r("#vrCard").hidden = false;
      showBoard(`Touchdown · ${LEVEL[r.level]}`, [`Leaning ${r.tilt.toFixed(1)}°, slope ${r.slope.toFixed(1)}°, bumps ${Math.round(r.roughness * 100)} cm.`, "Next: build the base from the console."], col);
      msg(`Touchdown ${LEVEL[r.level].toLowerCase()}. The engines are off; the crew checks the lander, then opens the hatch.`);
      setTimeout(async () => { if (!alive) return; $r("#vrCard").hidden = true; await exitSequence(); if (alive && step === "camp") enterCh("base"); }, 3200);
      paint();
    }
    $r("#vrCard").addEventListener("click", e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      if (b.dataset.a === "close") { $r("#vrCard").hidden = true; return; }
      if (b.dataset.a.startsWith("rec:")) { const [, id, x, z] = b.dataset.a.split(":"); showRecommendation(id, +x, +z); return; }
      run(b.dataset.a); if (b.dataset.a.startsWith("tool:")) showCamp();
    });

    /* ---------- the educational "why" card for a placement ---------- */
    function whyCard(c, rec) {
      const ex = camp.explain(c, rec), col = LEVEL_COL[c.level];
      const rows = c.rules.map(r => `<tr><td>${esc(r.label)}</td><td class="v">${esc(r.value)}</td><td class="lim">${esc(r.limit)}</td><td><i class="dot" style="background:${LEVEL_COL[r.ok ? (r.warn ? 1 : 0) : 2]}"></i></td></tr>`).join("");
      const reasons = c.rules.filter(r => !r.ok || r.warn).map(r => `<li><b>${esc(r.label)}.</b> ${esc(r.why || "")}</li>`).join("");
      return `<div class="vr-card-head" style="--lc:${col}"><button type="button" class="vr-x" data-a="close" aria-label="Close">×</button><span class="eyebrow">${c.ok ? "Placed" : "Why not here?"} · ${esc(c.name)}</span><b>${c.ok ? "Good site" : "Not allowed"}</b></div>
        <p class="note role">${esc(c.role || "")}</p>
        <table class="vr-table"><thead><tr><th>Rule</th><th>Here</th><th>Needs</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        ${reasons ? `<ul class="vr-why">${reasons}</ul>` : `<p class="note">Every rule passes here.</p>`}
        ${ex.tip ? `<p class="note tip">${esc(ex.tip)}</p>` : ""}
        ${rec && !c.ok ? `<div class="vr-card-acts"><button type="button" class="btn primary" data-a="rec:${c.id}:${rec.x.toFixed(2)}:${rec.z.toFixed(2)}">Show me that spot</button></div>` : ""}`;
    }
    function showRecommendation(id, x, z) {
      camp.showHint({ x, z }, id);
      if (!renderer.xr.isPresenting) {             // stand a few metres away, looking at the suggested spot
        const p = controls.rig.position, dx = x - p.x, dz = z - p.z, L = Math.hypot(dx, dz) || 1, sx = x - dx / L * 14, sz = z - dz / L * 14;
        if (terrain.inNear(sx, sz, 3)) controls.teleport(sx, terrain.heightAt(sx, sz), sz);
        controls.face(x, z);
      }
      msg(`The pulsing green ring marks a spot where the ${camp.MODS[id].name.toLowerCase()} passes every rule. Point at it and press to build.`);
    }

    function showCamp(last, rec) {
      if (step !== "camp") return;
      const card = $r("#vrCard");
      if (last) { card.innerHTML = whyCard(last, rec); card.hidden = false; return; }
      const s = camp.status();
      card.innerHTML = `<div class="vr-card-head" style="--lc:${s.pct === 100 ? LEVEL_COL[0] : "var(--moho)"}"><button type="button" class="vr-x" data-a="close" aria-label="Close">×</button><span class="eyebrow">Base</span><b>${s.pct}% established</b></div>
        <ul class="vr-needs">${s.needs.map(n => `<li class="${n.done ? "ok" : ""}"><i></i>${esc(n.name)}</li>`).join("")}</ul>
        <p class="note">${s.total} module${s.total === 1 ? "" : "s"} placed · rules from data/vr/rules.json</p>`;
      card.hidden = false;
    }

    function restart() {
      lander.reset(); camp.clear(); camp.setTool(null); camp.setLander(null);
      step = "pad"; tool = "move"; chosen = null; padMarker.visible = false; speed = 1; baseDone = false;
      pads.forEach(p => p.g.visible = true); $r("#vrCard").hidden = true; caption(null);
      if (pads[0]) choosePad(pads[0], pads[0].name);
      msg("The lander's computer checks candidate pads against the height map: green safe, amber marginal, red hazard. It will pick the safest one.");
      paint();
    }

    /* ---------- select / hover ---------- */
    let lastHoverMsg = "";
    function onSelect(ray) {
      if (renderer.xr.isPresenting) { const m = menuHit(ray); if (m) { if (m.i >= 0 && !menuBtns[m.i].off) run(menuBtns[m.i].id); return; } }
      if (ch === "brief" && holo?.group.visible) { const hit = ray.intersectObject(holo.screen, false)[0]; if (hit) { const id = holo.pick(hit.uv); if (id) { siteId = id; drawHolo(); paintGuide(); toast(`Rehearsal site: ${site().name}`); } return; } }
      if (ch === "suit" && mannequin?.visible) { const hit = ray.intersectObjects(mannequinMarks.markers, false)[0]; if (hit) { showPart(hit.object.userData.part); return; } }
      if (ch !== "landing" && ch !== "base" && guideOn && tool !== "move") return;
      if (!terrain || loading || flying || touring) return;
      const p = rayGround(ray); if (!p) return;
      if (tool === "move") { if (terrain.inNear(p.x, p.z, 4) && Math.hypot(p.x - controls.rig.position.x, p.z - controls.rig.position.z) < 120) { controls.teleport(p.x, p.y, p.z); if (renderer.xr.isPresenting && menu.mesh.visible) consoleDue = .3; } else toast("Stay inside the landing area"); return; }

      if (step === "camp" && camp.tool) {
        const c = camp.place(p); if (!c) return;
        if (c.ok) { showCamp(c); msg(`${c.name} going up. ${c.role}`); if (camp.status().pct === 100) camp.addCrew(); }
        else {
          const rec = camp.recommend(c.id, p.x, p.z), ex = camp.explain(c, rec);
          showCamp(c, rec); if (rec) camp.showHint(rec, c.id);
          msg(`${ex.lead} ${c.fails[0]?.label}: ${c.fails[0]?.value} (rule ${c.fails[0]?.limit}). ${ex.tip}`);
          showBoard("Why not here?", [ex.lead, ...ex.lines.slice(0, 2), ex.tip], LEVEL_COL[2], 18);
        }
      }
    }
    function hover() {
      const ray = controls.hoverRay(); moveMarker.visible = false; padHover.visible = false;
      if (!ray) { camp?.hover(null); return; }
      if (renderer.xr.isPresenting) {
        const m = menuHit(ray); const hot = m ? m.i : -1;
        if (hot !== menuHot) { menuHot = hot; drawMenu(); }
        if (m) { controls.setPointerLength(m.d); camp?.hover(null); return; }
      }
      if (!terrain || loading || touring) return;
      const p = rayGround(ray, 220);
      controls.setPointerLength(p ? ray.ray.origin.distanceTo(p) : 8);
      if (!p) { camp.hover(null); return; }
      if (tool === "move") { moveMarker.visible = terrain.inNear(p.x, p.z, 4); moveMarker.position.set(p.x, p.y + .06, p.z); }

      if (step === "camp" && camp.tool) {
        const c = camp.hover(p);
        if (c) { const t = c.ok ? `${c.name}: every rule passes here${c.warns.length ? ` (caution: ${c.warns[0].label.toLowerCase()})` : ""}. Press to build.` : `${c.name}: ${c.fails[0].label.toLowerCase()} ${c.fails[0].value}, needs ${c.fails[0].limit}.`;
          if (t !== lastHoverMsg) { lastHoverMsg = t; msg(t); } }
      }
    }

    /* ---------- captions (screen) for the guided build ---------- */
    function caption(k, title, body) {
      const cap = $r("#vrCap");
      if (!k) { cap.hidden = true; return; }
      $r("#vrCapK").textContent = k; $r("#vrCapT").textContent = title; $r("#vrCapB").innerHTML = body; cap.hidden = false;
    }
    $r("#vrCapSkip").addEventListener("click", () => { skipTour = true; });

    /* ---------- cinematic camera (screen mode) ---------- */
    let cine = null;
    const setCine = c => { cine = c; controls.setCine(!!c); };
    function orbitCam(cx, cz, r, hgt, speedA = .12) {
      const cy = terrain.heightAt(cx, cz), cur = new THREE.Vector3(); camera.getWorldPosition(cur);
      let a = Math.atan2(cur.z - cz, cur.x - cx);
      setCine({ interruptible: false, update(dt) {
        a += dt * speedA;
        const tx = cx + Math.cos(a) * r, tz = cz + Math.sin(a) * r;
        const target = new THREE.Vector3(tx, Math.max(terrain.heightAt(tx, tz) + 2, cy + hgt), tz);
        cur.lerp(target, Math.min(1, dt * 1.6));
        controls.look(cur, new THREE.Vector3(cx, cy + 2, cz));
      } });
    }
    function endCine() {
      if (!cine) return;
      setCine(null);
      const p = controls.rig.position, lim = terrain.near / 2 - 4, gx = Math.max(-lim, Math.min(lim, p.x)), gz = Math.max(-lim, Math.min(lim, p.z));
      controls.teleport(gx, terrain.heightAt(gx, gz), gz);
    }

    /* ---------- you climb out: hatch, porch, ladder, first steps; then the view becomes your own eyes ---------- */
    let exiting = false, skipExit = false, walker = null;
    const FIRST = {
      moon: "Moon dust is fine and sharp like broken glass. With no wind or rain, a footprint here can last for millions of years.",
      mars: "Mars dust is rich in iron oxide, which is why the ground looks red. In 38% gravity every step feels light and bouncy.",
      oman: "In Oman, crews rehearse this same climb-down in a heavy suit, in heat and dust, before anyone does it for real.",
    };
    async function exitSequence() {
      if (!lander || !terrain) return;
      exiting = true; skipExit = false; paintGuide();
      const xr = renderer.xr.isPresenting, m = lander.root; m.updateMatrixWorld(true);
      const W = (x, y, z) => m.localToWorld(new THREE.Vector3(x, y, z)), gnd = v => { v.y = terrain.heightAt(v.x, v.z); return v; };
      const P = { door: W(0, 4.04, -1.9), porch: W(0, 4.04, -2.75), top: W(0, 3.98, -3.15), bottom: W(0, .5, -3.5), foot: gnd(W(0, 0, -4.3)), out: gnd(W(0, 0, -10)) };
      const me = buildSuit(); me.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(me);
      const outDir = new THREE.Vector3().subVectors(P.out, P.foot).setY(0).normalize(), faceOut = Math.atan2(outDir.x, outDir.z), faceIn = faceOut + Math.PI;
      const side = new THREE.Vector3(-outDir.z, 0, outDir.x);
      const segs = [
        { a: "door", b: "porch", t: 2.2, face: faceOut, kind: "walk", cap: ["The hatch opens", "Before stepping out, the crew checks suit pressure, oxygen and radio. The hatch keeps the cabin air in while it is closed."] },
        { a: "porch", b: "top", t: 1.2, face: faceIn, kind: "turn" },
        { a: "top", b: "bottom", t: 4.6, face: faceIn, kind: "ladder", cap: ["Down the ladder", "Climbing in a stiff, pressurised suit is slow work: one rung at a time, always holding on with three limbs."] },
        { a: "bottom", b: "foot", t: 1.4, face: faceIn, kind: "step" },
        { a: "foot", b: "out", t: 4.4, face: faceOut, kind: "walk", cap: ["First steps", FIRST[world] || FIRST.mars] },
      ];
      if (xr) { const v = gnd(P.foot.clone().addScaledVector(side, 7).addScaledVector(outDir, -2)); controls.teleport(v.x, v.y, v.z); controls.face(P.porch.x, P.porch.z); }
      const cam = new THREE.Vector3(); camera.getWorldPosition(cam); const look = P.door.clone();
      if (!xr) setCine({ interruptible: false, update(dt) {
        if (!walker) return;
        const w = walker.position, want = w.clone().addScaledVector(side, 3.6).addScaledVector(outDir, 1.6); want.y = Math.max(terrain.heightAt(want.x, want.z) + 1.4, w.y + 1.1);
        cam.lerp(want, Math.min(1, dt * 2.2)); look.lerp(w.clone().setY(w.y + 1.2), Math.min(1, dt * 3)); controls.look(cam, look);
      } });
      walker = me;
      for (const sg of segs) {
        if (!alive) break;
        if (sg.cap) { caption(`${WORLDS[world].label} · stepping out`, sg.cap[0], `<p>${esc(sg.cap[1])}</p>`); msg(sg.cap[1]); if (xr) showBoard(sg.cap[0], [sg.cap[1]], "#f2c46d", 10); }
        const A = P[sg.a], B = P[sg.b], dur = skipExit ? .01 : sg.t; let t = 0;
        await new Promise(res => { const step = () => {
          if (!alive) return res();
          t += 1 / 60; const e = Math.min(1, t / dur), k = e < .5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
          me.position.lerpVectors(A, B, sg.kind === "ladder" ? e : k);
          if (sg.kind === "walk" || sg.kind === "step") me.position.y = sg.kind === "walk" && sg.a === "foot" ? terrain.heightAt(me.position.x, me.position.z) : me.position.y;
          me.rotation.y = sg.kind === "turn" ? faceOut + (faceIn - faceOut) * k : sg.face;
          const sw = Math.sin(t * (sg.kind === "ladder" ? 7 : 6));
          me.userData.legs.forEach((l, i) => { l.rotation.x = (sg.kind === "turn" ? 0 : (i ? -sw : sw) * (sg.kind === "ladder" ? .55 : .4)); });
          me.userData.arms.forEach((a, i) => { a.rotation.x = sg.kind === "ladder" ? -2.4 + (i ? sw : -sw) * .35 : (i ? sw : -sw) * .3; });
          if (e >= 1 || skipExit) { if (skipExit) me.position.copy(B); res(); } else setTimeout(step, 1000 / 60);
        }; step(); });
        if (sg.cap && !skipExit) await wait(400);
      }
      // the view becomes yours: you stand where the astronaut stopped, looking out at the site
      walker = null; scene.remove(me); me.traverse(o => o.geometry?.dispose?.());
      if (!xr) setCine(null);
      const ahead = P.out.clone().addScaledVector(outDir, 10);
      if (xr) { await fadeXR(1); controls.teleport(P.out.x, P.out.y, P.out.z); controls.face(ahead.x, ahead.z); await fadeXR(0); }
      else { controls.teleport(P.out.x, P.out.y, P.out.z); controls.face(ahead.x, ahead.z); }
      caption(null); exiting = false; paintGuide();
      msg("You are on the surface. Look down: that is your suit. Next, the base goes up around you, one module at a time.");
    }

    /* ---------- guided build of the recommended base ---------- */
    function whyHere(c) {
      const keys = { habitat: ["slope", "relief", "keepout"], solar: ["sun", "distance", "slope"], comms: ["home", "distance", "slope"], rover: ["distance", "slope"], drill: ["shadow", "distance", "slope"], path: ["slope"] }[c.id] || ["slope"];
      const rs = keys.map(k => c.rules.find(r => r.key === k)).filter(Boolean);
      const lead = rs.find(r => r.why);
      return `<p>${esc(c.role || "")}</p><ul class="vr-why">${rs.map(r => `<li>${r.ok ? (r.warn ? "⚠" : "✓") : "✗"} <b>${esc(r.label)}</b>: ${esc(r.value)} (rule ${esc(r.limit)})</li>`).join("")}</ul>${lead ? `<p class="why-lead">${esc(lead.why)}</p>` : ""}`;
    }
    async function buildTour() {
      if (step !== "camp" || touring || baseDone) return;
      touring = true; skipTour = false; camp.setTool(null); camp.clearHint(); tool = "move"; $r("#vrCard").hidden = true; paint();
      const plan = camp.plan();
      if (!plan.length) { msg("No part of the landing area passes the rules for a habitat. Try a different pad or world."); touring = false; paint(); return; }
      const xr = renderer.xr.isPresenting, mods = plan.filter(p => p.id !== "path"), paths = plan.filter(p => p.id === "path");
      caption(`${WORLDS[world].label} · ${WORLDS[world].place}`, "Establishing the base", `<p>The planner tests every spot in the landing area against the placement rules (ground slope, unevenness, distance from the landing pad, sunlight${world === "moon" ? ", line of sight to Earth, cold-trap shadow" : ""}) and picks the best site for each module, in building order.</p>`);
      msg("Building the recommended base: watch each module go up and read why its site was chosen.");
      if (!xr) orbitCam(plan[0].x, plan[0].z, 55, 30, .05);
      if (!skipTour) await wait(4200);
      let k = 0;
      for (const p of mods) {
        if (!alive) return;
        k++;
        const c = camp.check(p.id, p.x, p.z), m = camp.MODS[p.id];
        caption(`Step ${k} of ${mods.length + (paths.length ? 1 : 0)} · ${m.name}`, `Why here: ${linkFor(p.id)}`, whyHere(c));
        if (xr) showBoard(`${k}. ${m.name}`, [m.role, ...c.rules.filter(r => ["slope", "sun", "home", "shadow", "distance", "keepout"].includes(r.key)).slice(0, 2).map(r => `${r.label}: ${r.value} (rule ${r.limit})`)], "#f2c46d", 9);
        else if (!skipTour) orbitCam(p.x, p.z, p.id === "rover" ? 16 : 20, p.id === "solar" || p.id === "comms" ? 9 : 7, .18);
        msg(`${m.name}: ${m.role}`);
        const r = camp.placeAt(p.id, p.x, p.z, { animate: !skipTour, force: true });
        await r.done; if (!skipTour) await wait(2600);
      }
      if (paths.length) {
        caption(`Step ${mods.length + 1} of ${mods.length + 1} · Path markers`, "Why here: " + CRITERION_LINK.path, `<p>Beacons every 14 m mark a gentle walking route from the habitat toward the pad, stopping at the edge of the ${camp.keepout} m blast zone.</p>`);
        for (const p of paths) { camp.placeAt("path", p.x, p.z, { animate: !skipTour, force: true }); if (!skipTour) await wait(260); }
        if (!skipTour) await wait(1600);
      }
      camp.addCrew();
      const s = camp.status();
      const cx = s.placed.reduce((a, p) => a + p.x, 0) / s.placed.length, cz = s.placed.reduce((a, p) => a + p.z, 0) / s.placed.length;
      if (!xr) orbitCam(cx, cz, 75, 38, .06);
      caption(null);
      baseReport();
      touring = false; paint();
      if (cine) cine.interruptible = true;        // the overview keeps turning until you drag or press a key
      msg("The base is established. Drag or press a key to take back the camera; place more modules or switch worlds to compare.");
      baseDone = true; paintGuide();
      setTimeout(() => { if (alive && ch === "base" && !touring) enterCh("debrief"); }, 9000);
    }
    const linkFor = id => id === "comms" && world !== "moon" ? (world === "mars" ? "Road access: the link runs through orbiting relay satellites, so the mast stays close to the habitat" : "Road access: a short cable run to the habitat") : CRITERION_LINK[id] || "";
    function baseReport() {
      const s = camp.status(), card = $r("#vrCard");
      const rows = s.placed.filter((p, i, a) => a.findIndex(q => q.id === p.id) === i).map(p => {
        const c = p.check || camp.check(p.id, p.x, p.z), key = c.rules.find(r => ["sun", "home", "shadow"].includes(r.key)) || c.rules.find(r => r.key === "slope");
        return `<tr><td>${esc(camp.MODS[p.id].name)}${p.id === "path" ? ` ×${s.counts.path}` : ""}</td><td>${esc(key ? `${key.label}: ${key.value}` : "")}</td><td class="lim">${esc(linkFor(p.id))}</td></tr>`;
      }).join("");
      card.innerHTML = `<div class="vr-card-head" style="--lc:${LEVEL_COL[0]}"><button type="button" class="vr-x" data-a="close" aria-label="Close">×</button><span class="eyebrow">Base report · ${esc(WORLDS[world].label)}</span><b>Base established</b></div>
        <table class="vr-table report"><thead><tr><th>Module</th><th>Key measurement</th><th>Which Oman criterion it rehearses</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="note">What this teaches: the things our analog score measures across Oman (slope, roughness, hilliness, access, ancient riverbeds) are the same things that decide where a real base can stand. ${world === "moon" ? "At the lunar south pole, sunlight and line of sight to Earth come from relief: the ridges that make the terrain hard are also what keep the base powered and in contact." : world === "mars" ? "On Mars, the flat crater floor that made Jezero a safe landing site also makes building easy; the science lies a short drive away at the delta." : "In Oman, level wadi floors take the habitat while ridges carry the antennas: the same layout a Moon or Mars crew would rehearse."}</p>`;
      card.hidden = false;
      showBoard("Base established", ["Every module stands where the rules allow.", "Switch worlds from the console to compare the same steps on the Moon, Mars and Oman."], LEVEL_COL[0], 16);
    }

    /* ================= MISSION TRACK ================= */
    const chIndex = () => CH.findIndex(c => c.id === ch);
    const canNext = () => ch === "landing" ? step === "camp" && !exiting : ch === "base" ? baseDone : ch !== "debrief";
    const nextLabel = () => ({ brief: "Suit up ▸", suit: "Launch ▸", journey: "Skip to orbit ▸", orbit: "Begin descent ▸", landing: step === "camp" ? "Build the base ▸" : "Landing…", base: baseDone ? "Debrief ▸" : "Building…", debrief: "—" })[ch] || "Next ▸";
    function holoCard() {
      const M = MISSIONS[mission], s = site(), w = dest(), L = LEARN[mission], leg = LEGS[w], W = data.weights[mission];
      const matches = CRITERIA.map(c => ({ c, pts: W[c.k] * s["s_" + c.k], sv: +s["s_" + c.k] })).filter(x => x.sv >= .5).sort((a, b) => b.pts - a.pts).slice(0, 3)
        .map(x => ({ name: x.c.name, pct: Math.round(x.sv * 100), color: cssColor(x.c.k) }));
      return { dest: M.target, world: w, worldLine: `${w === "moon" ? "The Moon" : "Mars"} · ${M.label}`, journey: `About ${leg.total} ${leg.unit}s in space · ${leg.dist}`, why: L.why[0], matches };
    }
    function drawHolo() { if (!holo) return; const M = MISSIONS[mission]; holo.draw({ G, mission, label: M.label, ramp: M.ramp.slice(1), sites: data.top(mission), site: site(), card: holoCard() }); }
    function placeAhead(obj, dist) {
      headPose(); const x = headPos.x + headDir.x * dist, z = headPos.z + headDir.z * dist, y = terrain ? terrain.heightAt(x, z) : 0;
      if (obj === holo) holo.place(x, y, z, headPos.x, headPos.z);
      else { obj.position.set(x, y, z); obj.rotation.set(0, Math.atan2(headPos.x - x, headPos.z - z), 0); }
    }
    function showPart(id) {
      part = id; const P = SUIT_PARTS.find(p => p.id === id);
      mannequinMarks.markers.forEach(m => { const on = m.userData.part === id; m.material.color.setHex(on ? 0x46c37a : 0xf2c46d); m.scale.setScalar(on ? 1.5 : 1); });
      paintGuide(); if (P) showBoard(P.name, [P.text], "#f2c46d", 20);
    }
    function narration() {
      const M = MISSIONS[mission], w = dest(), L = LEARN[mission], s = site(), leg = LEGS[w], xr = renderer.xr.isPresenting;
      const rehearsal = groundWorld === "oman" && (ch === "landing" || ch === "base");
      switch (ch) {
        case "brief": return { k: "1 · Where are we going?", t: M.target, plain: `${M.target}. ${L.place} About ${leg.total} ${leg.unit}s in space. Rehearse first in Oman at ${s.name} (score ${score100(s.asi)}/100).`,
          html: `<p class="lead">${esc(L.place)}</p><p>${esc(L.why[0])}</p>
            <div class="g-facts"><div><span>Time in space</span><b>about ${leg.total} ${leg.unit}s</b></div><div><span>Distance</span><b>${esc(leg.dist)}</b></div>
            <div class="wide"><span>Where crews rehearse it in Oman</span><b>${esc(s.name)} · ${score100(s.asi)}/100</b></div></div>
            <p class="note">The holo-table is the atlas: Oman's best places for this mission, top sites numbered. ${xr ? "Point at one and pull the trigger" : "Click one"} to choose where to rehearse; change the mission below.</p>` };
        case "suit": { const P = SUIT_PARTS.find(p => p.id === part);
          return { k: "2 · Suit up", t: P ? P.name : "Your space suit", plain: P ? P.text : "Outside the base the suit is your personal spacecraft. Point at a gold marker to learn what each part does.",
            html: `<p class="lead">${P ? esc(P.text) : "Outside the base you never take it off: the suit is your own small spacecraft, with air, pressure, cooling and radio. Point at a gold marker or pick a part below."}</p>
              <p class="note">${xr ? "Look down: that is your suit. Your gloves follow your hands." : "You are wearing the same suit: look down, or press “See yourself” to watch yourself walk in it (WASD)."}</p>` }; }
        case "journey": { const c = journey.clock();
          return { k: "3 · How we get there", t: jCap.title || "Launch", plain: jCap.text,
            html: `<p class="lead">${esc(jCap.text)}</p>${c ? `<div class="g-clock"><b>${c.text}</b><div><i style="width:${Math.round(c.f * 100)}%"></i></div><span>${esc(c.dist)}</span></div>` : ""}
              <p class="note">The gold dashes are the ship's path. Distances are squeezed so the whole trip fits on screen; times and facts are real.</p>` }; }
        case "orbit": return { k: "4 · In orbit", t: LEGS[w].orbit[0], plain: LEGS[w].orbit[1],
          html: `<p class="lead">${esc(LEGS[w].orbit[1])}</p><div class="g-facts">${WORLD_FACTS[w].slice(0, 4).map(f => `<div><span>${esc(f.k)}</span><b>${esc(f.v)}</b></div>`).join("")}</div>` };
        case "landing": return { k: `5 · Landing${rehearsal ? " · Oman rehearsal" : ""}`, t: exiting ? "Stepping out" : step === "pad" ? "Choosing a safe pad" : step === "descent" ? "Powered descent" : "Touchdown", plain: lastMsg,
          html: `<p class="lead">${rehearsal ? "The same check on real Omani ground: this is how crews rehearse it. " : ""}A lander needs flat, firm ground: leaning more than about 8° it could tip over or fail to take off again. Its computer checks the pads against the real height map (green safe, amber marginal, red hazard), picks the safest and lands. Then you climb out.</p><p class="g-msg">${esc(lastMsg)}</p><p class="note">The ground's shape is real satellite elevation data; small rocks, pebbles and the sky are illustrated.</p>` };
        case "base": return { k: `6 · Build the base${rehearsal ? " · Oman rehearsal" : ""}`, t: baseDone ? "The base is established" : "The base goes up, step by step", plain: lastMsg,
          html: `<p class="lead">Robots and crew build the base in order, and each step explains why that spot was chosen. Each module has rules: level ground for the habitat, sunlight for the solar array${groundWorld === "moon" ? ", a clear view of Earth for the antenna" : ""}, and a safe distance from the pad's rocket blast. These are the same terrain properties our atlas measures across Oman.</p><p class="g-msg">${esc(lastMsg)}</p>` };
        case "debrief": return { k: "7 · Debrief", t: baseDone ? "Mission complete" : "What we learned",
          plain: `${L.oman} Earth can't copy: ${L.cant.join(", ")}.`,
          html: `<p class="lead">You flew about ${leg.total} ${leg.unit}s to ${esc(M.target)}, landed on real terrain${baseDone ? " and built a base where the rules allow" : ""}.</p>
            <h4>How Oman helps crews rehearse</h4><p>${esc(L.oman)}</p>
            <p class="cant"><span>What Earth can't copy:</span> ${L.cant.map(c => `<i>${esc(c)}</i>`).join("")}</p>
            <div class="didyou"><b>Did you know?</b> ${esc(L.did)}</div>
            <p class="note">Rehearsal site: ${esc(s.name)}, analog score ${score100(s.asi)}/100 for ${esc(M.label)}.</p>` };
      }
      return { k: "", t: "", html: "", plain: "" };
    }
    function paintGuide() {
      if (!ch) return;
      const n = narration(), gd = $r("#vrGuide");
      $r("#gK").textContent = n.k; $r("#gT").textContent = n.t; $r("#gB").innerHTML = n.html;
      $r("#gActs").innerHTML = missionActions().map(a => `<button type="button" class="btn${a.primary ? " primary" : ""}" data-a="${a.id}" aria-pressed="${!!a.on}" ${a.off ? "disabled" : ""}>${esc(a.label)}</button>`).join("");
      const nx = $r("#gNext"); nx.textContent = nextLabel(); nx.disabled = !canNext(); nx.hidden = ch === "debrief";
      gd.querySelector('[data-a="ch:prev"]').disabled = chIndex() <= 0;
      gd.hidden = !guideOn; $r("#gShow").hidden = guideOn;
      root.querySelectorAll("#vrTrack [data-ch]").forEach(b => { b.classList.toggle("on", b.dataset.ch === ch); b.classList.toggle("done", doneCh.has(b.dataset.ch) && b.dataset.ch !== ch); });
      if (renderer.xr.isPresenting) { lastMsg = n.plain || lastMsg; drawMenu(); }
      paint();
    }
    root.addEventListener("click", e => {
      const c = e.target.closest("#vrTrack [data-ch]"); if (c) { enterCh(c.dataset.ch); return; }
      const b = e.target.closest("#vrGuide [data-a]"); if (b && !b.disabled) { run(b.dataset.a); return; }
    });
    $r("#gHide").addEventListener("click", () => { guideOn = false; tool = "move"; paintGuide(); msg("Free exploring: walk around, use the tools below, or fly to another world. The track at the top takes you back into the story."); });
    $r("#gShow").addEventListener("click", () => { guideOn = true; paintGuide(); });

    function missionRun(id) {
      const [k, v, w] = id.split(":");
      if (k === "ch") { const i = chIndex();
        if (v === "next") { if (ch === "journey") { journey.skip(); return; } if (ch === "orbit") { descendNow(); return; } if (canNext() && CH[i + 1]) enterCh(CH[i + 1].id); }
        else if (v === "prev" && i > 0) enterCh(CH[i - 1].id);
        return; }
      if (v === "mission") { store.setMission(w); return; }
      if (v === "part") { showPart(w); return; }
      if (v === "view") { body.setMode(body.mode === "third" ? "first" : "third"); paintGuide(); return; }
      if (v === "speed") { journey.setSpeed(journey.speed > 1 ? 1 : 4); paintGuide(); return; }
      if (v === "skip") { journey.skip(); return; }
      if (v === "descend") { descendNow(); return; }
      if (v === "home") { flyHome(); return; }
      if (v === "other") { const to = dest() === "moon" ? "mars_science" : "moon_base"; store.setMission(to); enterCh("journey"); return; }
      if (v === "passport") { go("#site-" + site().id); return; }
      if (v === "dest3d") { go("#destination-" + DEST3D[mission]); return; }
    }

    /* the journey: Earth → destination (or back home), rendered instead of the ground while it runs */
    let jRun = null, preload = null;
    function startJourney(to, from) {
      journeyOn = true; $r("#vrCard").hidden = true; caption(null); endCine(); hideGroundExtras();
      xrInJourney(true);
      jRun = journey.start(to === "oman" ? "earth" : to, { from: from === "oman" ? "earth" : from, onCaption: (kind, title, text) => {
        jCap = { title, text }; journey.setCaption(text); paintGuide(); } });
      $r("#vrHud").hidden = false; paint();
      return jRun;
    }
    // headset: while flying, your controllers, gloves and the console move into the cockpit so you can still see and use them
    function xrInJourney(on) {
      const rig = controls.rig, ck = journey.cockpit;
      if (on) { rig.children.filter(o => o !== camera).forEach(o => ck.add(o)); if (menu) journey.scene.add(menu.mesh); if (renderer.xr.isPresenting) consoleDue = .8; }
      else { ck.children.filter(o => o.userData.xrPart).forEach(o => rig.add(o)); if (menu) scene.add(menu.mesh); }
    }
    function hideGroundExtras() { if (holo) holo.group.visible = false; if (mannequin) mannequin.visible = false; }
    async function groundArrival() {
      // from the journey's last frame down onto the landing area (screen); a short fade in the headset
      journeyOn = false; $r("#vrHud").hidden = true; xrInJourney(false);
      if (renderer.xr.isPresenting) { xrFade.material.opacity = 1; xrFade.visible = true; await fadeXR(0); paint(); return; }
      const target = new THREE.Vector3(); camera.getWorldPosition(target);
      const lx = pads[0]?.x ?? 0, lz = pads[0]?.z ?? 0, look = new THREE.Vector3(lx, terrain.heightAt(lx, lz), lz);
      const away = new THREE.Vector3(target.x - lx, 0, target.z - lz).normalize(); let t = 0; fadeEl.style.opacity = 1;
      await new Promise(res => setCine({ update(dt) {
        t += dt; const e = Math.min(1, t / 3), k = 1 - Math.pow(1 - e, 3);
        const p = target.clone().addScaledVector(away, (1 - k) * 160); p.y += (1 - k) * 650;
        controls.look(p, look); fadeEl.style.opacity = Math.max(0, 1 - t / .8);
        if (e >= 1) res();
      } }));
      setCine(null); controls.teleport(target.x, terrain.heightAt(target.x, target.z), target.z); controls.face(lx, lz);
      fadeEl.style.opacity = 0; paint();
    }
    async function descendNow() {
      if (busy || !jRun || journey.phase !== "orbit") return;
      busy = true; journey.descend(); await jRun.done;
      if (preload) await preload; if (!alive) return;
      busy = false; await groundArrival(); flying = false; enterCh("landing", { arrived: true });
    }
    async function flyHome() {
      if (busy) return; busy = true; const from = world;
      ch = "journey"; paintGuide();
      const run = startJourney("oman", from); groundWorld = "oman"; preload = loadWorld("oman", { quiet: true });
      await run.done; await preload; if (!alive) return;
      busy = false; await groundArrival(); enterCh("landing", { arrived: true });
      msg("Back in Oman. Rehearse the same steps on real Omani ground: choose a pad, land, build the base.");
    }

    /** go to a chapter: sets up the world, the camera and the guide; any chapter can be reached from any other */
    async function enterCh(id, { arrived = false } = {}) {
      if (busy || loading) return;
      if (ch && ch !== id) doneCh.add(ch);
      const prev = ch; ch = id; part = id === "suit" ? part : null;
      if (renderer.xr.isPresenting) consoleDue = .4;
      if (id === "brief" || id === "suit") {
        if (journeyOn) { journey.setSpeed(1); journeyOn = false; $r("#vrHud").hidden = true; xrInJourney(false); }
        if (world !== "oman") { busy = true; await fadeXR(1); fadeEl.style.opacity = 1; await loadWorld("oman", { quiet: true }); fadeEl.style.opacity = 0; await fadeXR(0); busy = false; }
        groundWorld = "oman"; pads.forEach(p => p.g.visible = false); padMarker.visible = false; tool = "move"; camp.setTool(null);
        hideGroundExtras();
        if (id === "brief") { holo.group.visible = true; placeAhead(holo, 3.6); drawHolo(); }
        else { mannequin.visible = true; placeAhead(mannequin, 2.4); }
        showBoard(narration().t, [narration().plain], "#f2c46d", 18);
      }
      if (id === "journey") {
        groundWorld = dest();
        const run = startJourney(dest(), "oman"); preload = loadWorld(dest(), { quiet: true });
        run.orbit.then(() => { if (alive && ch === "journey") enterCh("orbit"); });
      }
      if (id === "orbit" && (!journeyOn || journey.phase !== "orbit")) {
        groundWorld = dest();
        const run = startJourney(dest(), "oman"); preload = loadWorld(dest(), { quiet: true }); journey.skip(); ch = "orbit";
        run.orbit.then(() => paintGuide());
      }
      if (id === "landing" || id === "base") {
        if (journeyOn) { journeyOn = false; $r("#vrHud").hidden = true; xrInJourney(false); }
        const want = groundWorld || dest();
        if (world !== want && !arrived) { busy = true; await fadeXR(1); fadeEl.style.opacity = 1; await loadWorld(want, { quiet: true }); fadeEl.style.opacity = 0; await fadeXR(0); busy = false; }
        hideGroundExtras();
        if (id === "landing" && (step !== "pad" || !pads.some(p => p.g.visible))) restart();
        if (id === "base" && step !== "camp") {               // reaching the base chapter directly: land on the best pad first, fast
          if (step === "pad") { restart(); if (pads[0]) choosePad(pads[0], pads[0].name); speed = 4; startLanding(); }
          ch = "landing"; msg("Landing first on the safest pad, then you step out and the base goes up.");
        }
        if (id === "landing" && step === "pad") {                // the lander picks the safest pad and lands by itself
          if (pads[0]) choosePad(pads[0], pads[0].name);
          setTimeout(() => { if (alive && ch === "landing" && step === "pad" && chosen) startLanding(); }, 4000);
        }
        if (id === "base" && step === "camp" && !touring && !baseDone && !exiting) setTimeout(() => { if (alive && ch === "base") buildTour(); }, 800);
      }
      if (id === "debrief") { hideGroundExtras(); $r("#vrCard").hidden = true; showBoard("Mission debrief", [narration().plain], "#46c37a", 24); }
      paintGuide(); drawMenu();
      if (prev !== id && id !== "journey" && id !== "orbit") paint();
    }
    async function loadWorld(w, { quiet = false } = {}) {
      loading = true; world = w; drawMenu(); paint();
      const load = $r("#vrLoad"); if (!quiet) { load.hidden = false; $r("#vrLoadW").textContent = `VR · ${WORLDS[w].label} · ${WORLDS[w].place}`; }
      await wait(30);                                                 // let the loading card paint first
      let t;
      const prog = (p, step) => { const pc = $r("#vrLoadPct"), bar = $r("#vrLoadBar"), st = $r("#vrLoadStep");
        if (pc) pc.textContent = Math.round(p * 100) + "%"; if (bar) bar.style.width = Math.round(p * 100) + "%"; if (st && step) st.textContent = step + "…"; };
      prog(0, "Finding the terrain tile");
      try { t = await loadTerrain(WORLDS[w].dirs(route.id), prog); }
      catch (err) { load.hidden = false; load.innerHTML = `<b>Could not load the terrain.</b><small>${esc(err.message)}</small>`; loading = false; return; }
      if (!alive) { t.dispose(); return; }
      if (terrain) { scene.remove(terrain.group); terrain.dispose(); }
      lander?.dispose(); camp?.dispose(); clearPads();
      terrain = t; scene.add(terrain.group);
      lander = createLander(scene, terrain, rules); lander.onTouchdown = onTouchdown;
      camp = createCamp(scene, terrain, rules, w);
      overlay = false; terrain.setOverlay(false);
      const sk = applySkin(w, { scene, renderer, sky, terrain }); sunDir = sk.dir.clone();
      camp.setSky(sk.dir, w === "moon" ? sky.earth.userData.offset : null, w === "moon" ? 0x8a8884 : w === "mars" ? 0x8a4e32 : 0x7a6a58);
      buildPads();
      const best = pads[0] || { x: 0, z: 0 };
      let start = null, bestS = Infinity;
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, x = best.x + Math.cos(a) * 45, z = best.z + Math.sin(a) * 45;
        if (!terrain.inNear(x, z, 10)) continue; const s = terrain.stats(x, z, 2).slope; if (s < bestS) { bestS = s; start = { x, z }; } }
      start = start || { x: best.x + 20, z: best.z + 20 };
      controls.teleport(start.x, terrain.heightAt(start.x, start.z), start.z); controls.face(best.x, best.z);
      const m = terrain.meta;
      $r("#vrPlace").textContent = `${WORLDS[w].label} · ${WORLDS[w].place}`;
      $r("#vrSrc").innerHTML = m.placeholder ? `Ground: a <b>placeholder</b> made-up terrain.` : `Ground shape: <b>real</b> satellite height map. Small rocks and the sky are illustrated.`;
      load.hidden = true; $r("#vrBar").hidden = false;
      loading = false; if (renderer.xr.isPresenting && menu?.mesh.visible) consoleDue = .5;
      restart();
      msg(`${WORLDS[w].label}: ${WORLDS[w].place}. ${rules.worlds[w].gravity} m/s² gravity. The lander is checking the pads.`);
      if (ch === "brief" || ch === "suit") { pads.forEach(p => p.g.visible = false); padMarker.visible = false; tool = "move"; }
    }

    /* switching worlds from the toolbar is a real journey too: lift off, cross space, orbit, descend (screen and headset) */
    async function switchWorld(w) {
      if (flying || loading || busy || w === world) return;
      flying = true; busy = true; const from = world;
      groundWorld = w; ch = w === "oman" ? "journey" : "journey"; paintGuide();
      const run = startJourney(w, from); preload = loadWorld(w, { quiet: true });
      if (w !== "oman") { await run.orbit; await wait(2500); journey.descend(); }
      await run.done; await preload; if (!alive) return;
      busy = false; flying = false; await groundArrival(); enterCh("landing", { arrived: true });
    }
    function fadeXR(to) {
      return new Promise(res => { const m = xrFade.material, from = m.opacity; let t = 0;
        const tick = () => { t += 1 / 30; m.opacity = from + (to - from) * Math.min(1, t / .5); xrFade.visible = m.opacity > .01; if (t < .5) setTimeout(tick, 33); else res(); }; tick(); });
    }

    /* ---------- XR session ---------- */
    const enterBtn = $r("#vrEnter");
    navigator.xr?.isSessionSupported?.("immersive-vr").then(ok => { if (ok && alive) enterBtn.hidden = false; }).catch(() => {});
    enterBtn.addEventListener("click", async () => {
      try {
        const s = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] });
        endCine(); await renderer.xr.setSession(s);
        consoleDue = 1.2; msg("The console sits at your waist: look down to use it, point and pull the trigger. Squeeze the grip to hide it or bring it back.");
        s.addEventListener("end", () => { camera.position.set(0, 1.65, 0); if (board) board.mesh.visible = false; if (menu) menu.mesh.visible = false; });
      } catch (err) { toast("Could not start VR: " + err.message); }
    });

    /* ---------- start ---------- */
    (async () => {
      try { rules = await (await fetch("data/vr/rules.json", { cache: "no-cache" })).json(); }
      catch (err) { $r("#vrLoad").innerHTML = `<b>Could not load the rules.</b><small>${esc(err.message)}</small>`; return; }
      if (!alive) return;
      controls = createControls({ renderer, camera, scene, dom: canvas, onSelect, onSqueeze: () => toggleConsole(), onUserInput: () => { if (cine?.interruptible) endCine(); } });
      const ringGeo = (a, b) => new THREE.RingGeometry(a, b, 48).rotateX(-Math.PI / 2);
      const flat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide, fog: false });
      padMarker = new THREE.Mesh(ringGeo(rules.landing.pad_radius_m - .6, rules.landing.pad_radius_m + .2), flat(0x46c37a));
      padHover = new THREE.Mesh(ringGeo(rules.landing.pad_radius_m - .15, rules.landing.pad_radius_m), flat(0xffffff)); padHover.material.opacity = .55;
      moveMarker = new THREE.Mesh(ringGeo(.35, .5), flat(0xf2c46d));
      padMarker.visible = padHover.visible = moveMarker.visible = false; scene.add(padMarker, padHover, moveMarker);
      menu = panel(.58, .59, 1024, 1040); menu.mesh.visible = false; menu.mesh.renderOrder = 5; scene.add(menu.mesh);
      board = panel(.8, .36, 880, 400); board.mesh.visible = false; scene.add(board.mesh);
      body = createBody(scene, renderer, camera); body.setMode("first");
      hands = createHands(renderer);
      for (let i = 0; i < 2; i++) { const hd = renderer.xr.getHand(i); hd.userData.xrPart = true; controls.rig.add(hd); }   // tracked hands ride with you
      holo = createHolo(scene);
      mannequin = buildSuit(); mannequin.visible = false; mannequinMarks = partMarkers(mannequin); scene.add(mannequin);
      getGrid().then(g => { if (!alive) return; G = g; drawHolo(); }).catch(() => {});
      await loadWorld("oman");
      if (!alive) return;
      enterCh("brief");
      if (new URLSearchParams(location.search).has("debug")) window.__vr = { get terrain() { return terrain; }, get lander() { return lander; }, get camp() { return camp; }, controls, run, get step() { return step; }, choosePad, get pads() { return pads; }, rules, get world() { return world; }, get loading() { return loading; }, get flying() { return flying; }, get touring() { return touring; }, scene, renderer, camera, get holo() { return holo; }, get ch() { return ch; }, enterCh, get journeyOn() { return journeyOn; }, journey, get body() { return body; }, get site() { return site(); }, placeConsole, menuHit, get menuBtns() { return menuBtns; }, get menu() { return menu; }, onSelect, switchWorld, buildTour, skip() { skipTour = true; }, endCine };   // QA only
    })();

    /* ---------- frame loop ---------- */
    let last = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
      if (journeyOn) {                                                  // the journey replaces the ground scene while it runs
        journey.update(dt);
        const c = journey.clock(); if (c) { $r("#hudClock").textContent = c.text; $r("#hudBar").style.width = Math.round(c.f * 100) + "%"; $r("#hudDist").textContent = c.dist;
          const gc = $r("#gB .g-clock"); if (gc) { gc.querySelector("b").textContent = c.text; gc.querySelector("i").style.width = Math.round(c.f * 100) + "%"; } }
        if (renderer.xr.isPresenting) { hands?.update(true); journey.placeForXR(controls.rig); renderer.render(journey.scene, camera); }
        else {
          // keep the planet clear of the panels: move the picture right of the guide (wide screens) or above it (phones)
          const gOn = guideOn && !$r("#vrGuide").hidden, wide = innerWidth > 760;
          journey.placeForScreen(innerWidth / innerHeight, innerWidth, innerHeight, gOn && wide ? .14 : 0, gOn && !wide ? .2 : 0);
          renderer.render(journey.scene, journey.camera);
        }
        $r("#vrHud").hidden = ch === "orbit" || journey.phase === "orbit" || journey.phase === "descend";
        if (renderer.xr.isPresenting && menu && consoleDue > 0 && (consoleDue -= dt) <= 0) placeConsole();
        return;
      }
      if (terrain && controls && !loading) {
        const lim = terrain.near / 2 - 3, clampN = v => Math.max(-lim, Math.min(lim, v));
        const xrOn = renderer.xr.isPresenting, third = body?.mode === "third" && !xrOn && !cine;
        if (!xrOn) camera.position.set(0, third ? 2.7 : 1.65, third ? 4.6 : 0);
        const rp0 = controls.rig.position.clone();
        if (cine && !renderer.xr.isPresenting) cine.update(dt);
        else {
          controls.update(dt, (x, z) => terrain.heightAt(clampN(x), clampN(z)));
          if (!renderer.xr.isPresenting) { const rp = controls.rig.position; rp.x = clampN(rp.x); rp.z = clampN(rp.z); }
        }
        if (third) camera.rotation.x -= .24;
        if (body) { body.suit.userData.speed = rp0.distanceTo(controls.rig.position) / Math.max(dt, 1e-3) / 3; body.update(controls.rig, xrOn); body.suit.visible = !cine || body.mode === "third"; }
        holo?.update(dt); hands?.update(xrOn);
        if (mannequin?.visible) { mannequin.rotation.y += dt * .15; mannequinMarks.markers.forEach((m, i) => m.children[0].lookAt(camera.getWorldPosition(tmpV))); }
        terrain.updatePebbles(controls.rig.position.x, controls.rig.position.z);
        { const rp = controls.rig.position, snap = 140 / sky.sun.shadow.mapSize.x, cx = Math.round(rp.x / snap) * snap, cz = Math.round(rp.z / snap) * snap;   // snapped: no shimmering
          sky.sun.target.position.set(cx, rp.y, cz); sky.sun.position.set(cx, rp.y, cz).addScaledVector(sunDir, 700); sky.sun.target.updateMatrixWorld(); }
        hover();
        lander.update(dt * (step === "descent" ? speed : 1), now / 1000);
        camp.update(dt, now / 1000);
        if (padMarker.visible) padMarker.material.opacity = .55 + .35 * Math.sin(now / 260);
        if (board?.mesh.visible && (boardT -= dt) < 0) board.mesh.visible = false;
      }
      if (renderer.xr.isPresenting && menu && consoleDue > 0 && (consoleDue -= dt) <= 0) placeConsole();
      camera.getWorldPosition(tmpV);
      sky.sky.position.copy(tmpV); sky.stars.position.copy(tmpV); sky.earth.position.copy(tmpV).add(sky.earth.userData.offset);
      renderer.render(scene, camera);
    });

    const unsub = store.subscribe(() => {
      if (store.mission === mission) return;
      mission = store.mission; if (!data.site(siteId, mission)) siteId = data.sites[mission][0].id;
      drawHolo(); paintGuide();
    });
    const onKey = e => { if (e.key === "Escape" && !renderer.xr.isPresenting) { if (touring) skipTour = true; else go(route.id ? "#site-" + route.id : "#oman"); } };
    addEventListener("keydown", onKey);
    setKeys([["Drag", "Look"], ["WASD", "Walk"], ["Click", "Select"], ["Esc", "Back"]]);

    return {
      cleanup() {
        alive = false; skipTour = true; unFx(); unsub(); body?.dispose(); holo?.dispose(); removeEventListener("resize", resize); removeEventListener("keydown", onKey);
        renderer.xr.getSession?.()?.end().catch(() => {});
        renderer.setAnimationLoop(null);
        controls?.dispose(); lander?.dispose(); camp?.dispose(); terrain?.dispose(); clearPads(); sky.dispose(); journey.dispose();
        scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
        renderer.dispose(); space.setActive(true);
      },
    };
  },
};
