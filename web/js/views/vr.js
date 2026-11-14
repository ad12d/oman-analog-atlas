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
import { createTravel } from "../vr/travel.js";

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

    const root = h("section", { class: "vr live", "aria-label": "VR landing and base building" });
    root.innerHTML = `
      <canvas class="vr-canvas" aria-label="3D view of the landing site"></canvas>
      <div class="vr-fade" id="vrFade"></div>
      <div class="vr-load" id="vrLoad"><span class="eyebrow" id="vrLoadW">VR</span><b>Loading the real terrain…</b><small>Heights, slopes and shading come from the elevation data.</small></div>
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
    const sky = createSky(scene, renderer), travel = createTravel();
    function resize() { renderer.setPixelRatio(Math.min(devicePixelRatio, fx.level === "high" ? 2 : 1.25)); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
    resize(); addEventListener("resize", resize);
    const unFx = fx.subscribe(resize);
    // headset fade (a black shell around the eyes)
    const xrFade = new THREE.Mesh(new THREE.SphereGeometry(.4, 16, 8), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, fog: false }));
    xrFade.renderOrder = 999; xrFade.visible = false; camera.add(xrFade);

    let terrain = null, lander = null, camp = null, controls, rules, menu, board, pads = [], padMarker, padHover, moveMarker, chosen = null;
    let step = "pad", tool = "pad", overlay = false, speed = 1, lastMsg = "", boardT = 0, loading = false, touring = false, flying = false, skipTour = false;
    const tmpV = new THREE.Vector3();

    function msg(t) { lastMsg = t; const m = $r("#vrMsg"); if (m) m.textContent = t; drawMenu(); }

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
    function actions() {
      const A = [];
      if (touring) A.push({ id: "skip", label: "Skip tour", primary: true });
      else {
        if (step === "pad") A.push({ id: "tool:pad", label: "Pick pad", on: tool === "pad" }, { id: "land", label: "Start landing ▸", primary: true, off: !chosen });
        if (step === "descent") A.push({ id: "speed", label: speed === 1 ? "Speed ×1" : "Speed ×4", on: speed > 1 });
        if (step === "camp") { A.push({ id: "tour", label: "Build the recommended base ▸", primary: true });
          for (const m of camp.modules) A.push({ id: "tool:" + m.id, label: m.name, on: tool === m.id, group: "mod" }); }
        A.push({ id: "tool:move", label: "Move", on: tool === "move" });
        if (step === "camp") A.push({ id: "undo", label: "Undo" });
      }
      for (const k of Object.keys(WORLDS)) A.push({ id: "world:" + k, label: WORLDS[k].label, on: world === k, group: "world", off: touring || flying });
      A.push({ id: "overlay", label: "Slope map", on: overlay }, { id: "reset", label: "Restart", off: touring });
      return A;
    }
    function run(id) {
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
      else if (k === "skip") skipTour = true;
      paint();
    }
    function paint() {
      const bar = $r("#vrBar"); if (!bar) return;
      const A = actions();
      const grp = g => A.filter(a => (a.group || "main") === g).map(a => `<button type="button" class="btn${a.primary ? " primary" : ""}" data-a="${a.id}" aria-pressed="${!!a.on}" ${a.off ? "disabled" : ""}>${esc(a.label)}</button>`).join("");
      bar.innerHTML = `<div class="vr-row">${grp("main")}</div>${step === "camp" && !touring ? `<div class="vr-row">${grp("mod")}</div>` : ""}<div class="vr-row vr-skins"><span class="eyebrow">World</span>${grp("world")}</div>`;
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
      msg(`${name}: slope ${r.slope.toFixed(1)}°, bumps ${Math.round(r.roughness * 100)} cm, the lander would lean ${r.tilt.toFixed(1)}° → ${LEVEL[r.level]}. A lander needs flat, smooth ground so it stands level and can take off again. Press Start landing.`);
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
      step = "camp"; tool = "move"; camp.setLander({ x: chosen.x, z: chosen.z });
      const L = rules.landing, col = LEVEL_COL[r.level];
      const row = (n, v, s, hz, g) => `<tr><td>${n}</td><td class="v">${v}</td><td class="lim">${s} / ${hz}</td><td><i class="dot" style="background:${LEVEL_COL[g]}"></i></td></tr>`;
      $r("#vrCard").innerHTML = `<div class="vr-card-head" style="--lc:${col}"><button type="button" class="vr-x" data-a="close" aria-label="Close">×</button><span class="eyebrow">Touchdown · ${esc(chosen.name)}</span><b>${LEVEL[r.level]}</b></div>
        <table class="vr-table"><thead><tr><th>Check</th><th>Measured</th><th>Safe up to / danger from</th><th></th></tr></thead><tbody>
        ${row("Lander tilt", r.tilt.toFixed(1) + "°", L.tilt_safe_deg + "°", L.tilt_hazard_deg + "°", r.grades[0])}
        ${row("Ground slope", r.slope.toFixed(1) + "°", L.slope_safe_deg + "°", L.slope_hazard_deg + "°", r.grades[1])}
        ${row("Surface bumps", Math.round(r.roughness * 100) + " cm", Math.round(L.roughness_safe_m * 100) + " cm", Math.round(L.roughness_hazard_m * 100) + " cm", r.grades[2])}
        </tbody></table>
        <p class="note">Why it matters: a lander leaning more than about 8° could tip over or be unable to take off again, and rocks under a foot can puncture it. Measured on the ${L.pad_radius_m} m pad from ${esc(terrain.meta.source || "the terrain tile")}. Limits set by our team from published Moon and Mars landing practice.</p>
        <div class="vr-card-acts"><button type="button" class="btn primary" data-a="tour">Build the recommended base ▸</button><button type="button" class="btn" data-a="tool:habitat">Place modules myself</button></div>`;
      $r("#vrCard").hidden = false;
      showBoard(`Touchdown · ${LEVEL[r.level]}`, [`Leaning ${r.tilt.toFixed(1)}°, slope ${r.slope.toFixed(1)}°, bumps ${Math.round(r.roughness * 100)} cm.`, "Next: build the base from the console."], col);
      msg(`Touchdown ${LEVEL[r.level].toLowerCase()}. Now establish the base: place each module where the rules allow, or watch the recommended base being built.`);
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
      step = "pad"; tool = "pad"; chosen = null; padMarker.visible = false; speed = 1;
      pads.forEach(p => p.g.visible = true); $r("#vrCard").hidden = true; caption(null);
      if (pads[0]) choosePad(pads[0], pads[0].name);
      msg("Choose a landing pad: point at the ground or pick a suggested ring.");
      paint();
    }

    /* ---------- select / hover ---------- */
    let lastHoverMsg = "";
    function onSelect(ray) {
      if (renderer.xr.isPresenting) { const m = menuHit(ray); if (m) { if (m.i >= 0 && !menuBtns[m.i].off) run(menuBtns[m.i].id); return; } }
      if (!terrain || loading || flying || touring) return;
      const p = rayGround(ray); if (!p) return;
      if (tool === "move") { if (terrain.inNear(p.x, p.z, 4) && Math.hypot(p.x - controls.rig.position.x, p.z - controls.rig.position.z) < 120) { controls.teleport(p.x, p.y, p.z); if (renderer.xr.isPresenting && menu.mesh.visible) consoleDue = .3; } else toast("Stay inside the landing area"); return; }
      if (tool === "pad" && step === "pad") {
        if (!terrain.inNear(p.x, p.z, rules.landing.pad_radius_m + 2)) { toast("Pick a pad inside the landing area"); return; }
        const near = pads.find(q => Math.hypot(q.x - p.x, q.z - p.z) < rules.landing.pad_radius_m * 1.3);
        choosePad(near || p, near ? near.name : "Custom pad"); return;
      }
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
      else if (tool === "pad" && step === "pad" && terrain.inNear(p.x, p.z, 8)) { const r = padGrade(p); padHover.visible = true; padHover.position.set(p.x, p.y + .12, p.z); padHover.material.color.setHex(LEVEL_HEX[r.level]); }
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

    /* ---------- guided build of the recommended base ---------- */
    function whyHere(c) {
      const keys = { habitat: ["slope", "relief", "keepout"], solar: ["sun", "distance", "slope"], comms: ["home", "distance", "slope"], rover: ["distance", "slope"], drill: ["shadow", "distance", "slope"], path: ["slope"] }[c.id] || ["slope"];
      const rs = keys.map(k => c.rules.find(r => r.key === k)).filter(Boolean);
      const lead = rs.find(r => r.why);
      return `<p>${esc(c.role || "")}</p><ul class="vr-why">${rs.map(r => `<li>${r.ok ? (r.warn ? "⚠" : "✓") : "✗"} <b>${esc(r.label)}</b>: ${esc(r.value)} (rule ${esc(r.limit)})</li>`).join("")}</ul>${lead ? `<p class="why-lead">${esc(lead.why)}</p>` : ""}`;
    }
    async function buildTour() {
      if (step !== "camp" || touring) return;
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

    /* ---------- worlds ---------- */
    async function loadWorld(w, { quiet = false } = {}) {
      loading = true; world = w; drawMenu(); paint();
      const load = $r("#vrLoad"); if (!quiet) { load.hidden = false; $r("#vrLoadW").textContent = `VR · ${WORLDS[w].label} · ${WORLDS[w].place}`; }
      await wait(30);                                                 // let the loading card paint first
      let t;
      try { t = await loadTerrain(WORLDS[w].dirs(route.id)); }
      catch (err) { load.hidden = false; load.innerHTML = `<b>Could not load the terrain.</b><small>${esc(err.message)}</small>`; loading = false; return; }
      if (!alive) { t.dispose(); return; }
      if (terrain) { scene.remove(terrain.group); terrain.dispose(); }
      lander?.dispose(); camp?.dispose(); clearPads();
      terrain = t; scene.add(terrain.group);
      lander = createLander(scene, terrain, rules); lander.onTouchdown = onTouchdown;
      camp = createCamp(scene, terrain, rules, w);
      overlay = false; terrain.setOverlay(false);
      const sk = applySkin(w, { scene, renderer, sky, terrain });
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
      $r("#vrSrc").innerHTML = m.placeholder ? `Ground: a <b>placeholder</b> made-up terrain.` : `Ground: <b>real</b> satellite height map (${esc(m.source)}). ${esc(m.note || "")}`;
      load.hidden = true; root.querySelector(".vr-brief").hidden = false; $r("#vrBar").hidden = false;
      loading = false; if (renderer.xr.isPresenting && menu?.mesh.visible) consoleDue = .5;
      restart();
      msg(`${WORLDS[w].label}: ${WORLDS[w].place}. ${rules.worlds[w].gravity} m/s² gravity. Choose a landing pad.`);
    }

    /* spectator flight between worlds: lift off, cross space, close in, descend to the site */
    async function switchWorld(w) {
      if (flying || loading) return;
      const from = world;
      if (renderer.xr.isPresenting) {                       // headset: fade through black (no camera flight)
        flying = true; await fadeXR(1); await loadWorld(w, { quiet: true }); await fadeXR(0); flying = false; paint(); return;
      }
      flying = true; paint(); $r("#vrCard").hidden = true; caption(null);
      // 1. lift-off: the camera climbs away from the ground and whites out
      const p0 = new THREE.Vector3(); camera.getWorldPosition(p0); let t = 0;
      await new Promise(res => setCine({ update(dt) {
        t += dt; const e = Math.min(1, t / 1.6), up = Math.pow(e, 2.2) * 900;
        controls.look(new THREE.Vector3(p0.x, p0.y + up, p0.z + up * .3), new THREE.Vector3(p0.x, p0.y - 80, p0.z - 200 + up * .2));
        fadeEl.style.opacity = Math.max(0, (e - .6) / .4);
        if (e >= 1) res();
      } }));
      // 2. the flight through space (while the new terrain loads)
      const flight = travel.start(from, w, { duration: 6.4 });
      const loadP = loadWorld(w, { quiet: true });
      await Promise.all([flight, loadP]);
      if (!alive) return;
      // 3. descent onto the landing area from high above, ending where you stand
      const target = new THREE.Vector3(); camera.getWorldPosition(target);
      const lx = pads[0]?.x ?? 0, lz = pads[0]?.z ?? 0, look = new THREE.Vector3(lx, terrain.heightAt(lx, lz), lz);
      const away = new THREE.Vector3(target.x - lx, 0, target.z - lz).normalize();
      t = 0; fadeEl.style.opacity = 1;
      await new Promise(res => setCine({ update(dt) {
        t += dt; const e = Math.min(1, t / 3.4), k = 1 - Math.pow(1 - e, 3);
        const p = target.clone().addScaledVector(away, (1 - k) * 160); p.y += (1 - k) * 650;
        controls.look(p, look);
        fadeEl.style.opacity = Math.max(0, 1 - t / .8);
        if (e >= 1) res();
      } }));
      setCine(null); controls.teleport(target.x, terrain.heightAt(target.x, target.z), target.z); controls.face(lx, lz);
      fadeEl.style.opacity = 0; flying = false; paint();
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
      await loadWorld("oman");
      if (new URLSearchParams(location.search).has("debug")) window.__vr = { get terrain() { return terrain; }, get lander() { return lander; }, get camp() { return camp; }, controls, run, get step() { return step; }, choosePad, get pads() { return pads; }, rules, get world() { return world; }, get loading() { return loading; }, get flying() { return flying; }, get touring() { return touring; }, placeConsole, menuHit, get menuBtns() { return menuBtns; }, get menu() { return menu; }, onSelect, switchWorld, buildTour, skip() { skipTour = true; }, endCine };   // QA only
    })();

    /* ---------- frame loop ---------- */
    let last = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
      if (travel.active && !renderer.xr.isPresenting) {                 // spectator flight through space
        travel.update(dt, innerWidth / innerHeight); fadeEl.style.opacity = travel.fade;
        renderer.render(travel.scene, travel.camera); return;
      }
      if (terrain && controls && !loading) {
        const lim = terrain.near / 2 - 3, clampN = v => Math.max(-lim, Math.min(lim, v));
        if (cine && !renderer.xr.isPresenting) cine.update(dt);
        else {
          controls.update(dt, (x, z) => terrain.heightAt(clampN(x), clampN(z)));
          if (!renderer.xr.isPresenting) { const rp = controls.rig.position; rp.x = clampN(rp.x); rp.z = clampN(rp.z); }
        }
        terrain.updatePebbles(controls.rig.position.x, controls.rig.position.z);
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

    const onKey = e => { if (e.key === "Escape" && !renderer.xr.isPresenting) { if (touring) skipTour = true; else go(route.id ? "#site-" + route.id : "#oman"); } };
    addEventListener("keydown", onKey);
    setKeys([["Drag", "Look"], ["WASD", "Walk"], ["Click", "Select"], ["Esc", "Back"]]);

    return {
      cleanup() {
        alive = false; skipTour = true; unFx(); removeEventListener("resize", resize); removeEventListener("keydown", onKey);
        renderer.xr.getSession?.()?.end().catch(() => {});
        renderer.setAnimationLoop(null);
        controls?.dispose(); lander?.dispose(); camp?.dispose(); terrain?.dispose(); clearPads(); sky.dispose(); travel.dispose();
        scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
        renderer.dispose(); space.setActive(true);
      },
    };
  },
};
