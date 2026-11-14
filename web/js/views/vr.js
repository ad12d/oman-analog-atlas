// VR: land on real terrain and build a camp. Three worlds, each a real terrain tile:
//   Oman  (Samail ophiolite, Copernicus DEM + Sentinel-2; the team's LiDAR replaces it when processed)
//   Moon  (Shackleton connecting ridge, LOLA 5 m)      Mars (Jezero crater floor, HiRISE 1 m)
// Pick a pad, watch the lander touch down, read the touchdown check, then place camp modules.
// Runs in a Meta Quest (Enter VR: floating console + controller rays) or on screen (drag, tap, WASD).
import * as THREE from "three";
import { h, esc, setKeys, toast } from "../core/ui.js";
import { fx } from "../core/fx.js";
import { loadTerrain } from "../vr/terrain.js";
import { createSky, applySkin } from "../vr/skins.js";
import { createLander } from "../vr/lander.js";
import { createCamp } from "../vr/camp.js";
import { createControls } from "../vr/controls.js";

const LEVEL = ["SAFE", "MARGINAL", "HAZARD"], LEVEL_COL = ["#46c37a", "#f0b040", "#e04a3a"], LEVEL_HEX = [0x46c37a, 0xf0b040, 0xe04a3a];
const WORLDS = {
  oman: { label: "Oman", place: "Samail ophiolite · Wadi Tayin", dirs: id => [id && `data/vr/${id}/`, "data/vr/oman/", "data/vr/mock/"] },
  moon: { label: "Moon", place: "Shackleton connecting ridge", dirs: () => ["data/vr/moon/", "data/vr/mock/"] },
  mars: { label: "Mars", place: "Jezero crater floor", dirs: () => ["data/vr/mars/", "data/vr/mock/"] },
};

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

export default {
  mount({ view, scene: space, data, store, go }, route) {
    space.setActive(false);
    const site = route.id ? data.site(route.id, store.mission) : null;
    let alive = true, world = "oman";

    const root = h("section", { class: "vr live", "aria-label": "VR landing and camp" });
    root.innerHTML = `
      <canvas class="vr-canvas" aria-label="3D view of the landing site"></canvas>
      <div class="vr-load" id="vrLoad"><span class="eyebrow" id="vrLoadW">VR</span><b>Loading the real terrain…</b><small>Heights, slopes and shading come from the elevation data.</small></div>
      <aside class="vr-brief panel ticks" hidden>
        <div class="panel-head"><span class="panel-title">Landing &amp; camp</span><span class="eyebrow" id="vrPlace"></span></div>
        <div class="panel-body">
          <ol class="vr-steps"><li data-s="pad">Choose a pad</li><li data-s="descent">Watch the landing</li><li data-s="camp">Build the camp</li></ol>
          <p class="vr-msg" id="vrMsg" aria-live="polite"></p>
          <p class="vr-src" id="vrSrc"></p>
        </div>
      </aside>
      <aside class="vr-card panel ticks" id="vrCard" hidden></aside>
      <div class="vr-bar" id="vrBar" role="toolbar" aria-label="VR controls" hidden></div>
      <button type="button" class="btn primary vr-enter" id="vrEnter" hidden>Enter VR</button>`;
    view.appendChild(root);
    const $r = s => root.querySelector(s);
    const canvas = $r(".vr-canvas");

    /* ---------- renderer / scene ---------- */
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
    catch { $r("#vrLoad").innerHTML = "<b>WebGL is not available on this device.</b>"; return { cleanup() { space.setActive(true); } }; }
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType("local-floor"); renderer.xr.setFoveation(1);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 1, .05, 7000);
    const sky = createSky(scene, renderer);
    function resize() { renderer.setPixelRatio(Math.min(devicePixelRatio, fx.level === "high" ? 2 : 1.25)); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
    resize(); addEventListener("resize", resize);
    const unFx = fx.subscribe(resize);

    let terrain = null, lander = null, camp = null, controls, rules, menu, board, pads = [], padMarker, padHover, moveMarker, chosen = null;
    let step = "pad", tool = "pad", overlay = false, speed = 1, lastMsg = "", boardT = 0, loading = false;
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
      if (step === "pad") A.push({ id: "tool:pad", label: "Pick pad", on: tool === "pad" }, { id: "land", label: "Start landing ▸", primary: true, off: !chosen });
      if (step === "descent") A.push({ id: "speed", label: speed === 1 ? "Speed ×1" : "Speed ×4", on: speed > 1 });
      if (step === "camp" && camp) for (const m of camp.modules) A.push({ id: "tool:" + m.id, label: m.name, on: tool === m.id, group: "mod" });
      A.push({ id: "tool:move", label: "Move", on: tool === "move" });
      if (step === "camp") A.push({ id: "undo", label: "Undo" });
      for (const k of Object.keys(WORLDS)) A.push({ id: "world:" + k, label: WORLDS[k].label, on: world === k, group: "world" });
      A.push({ id: "overlay", label: "Slope map", on: overlay }, { id: "reset", label: "Restart" });
      return A;
    }
    function run(id) {
      if (loading) return;
      const [k, v] = id.split(":");
      if (k === "tool") { tool = v; camp.setTool(camp.modules.some(m => m.id === v) ? v : null); msg(v === "move" ? "Point at the ground and press to move there." : v === "pad" ? "Point at the ground to test a landing pad. Green rings are the best spots." : `Place the ${camp.modules.find(m => m.id === v).name.toLowerCase()}: green = ground OK, red = breaks a rule.`); }
      else if (k === "world") { if (v !== world) loadWorld(v); return; }
      else if (k === "overlay") { overlay = !overlay; terrain.setOverlay(overlay); msg(overlay ? "Slope map: green < 5°, amber 5–10°, red > 10°, computed from the elevation data." : "Slope map off."); }
      else if (k === "land") startLanding();
      else if (k === "speed") speed = speed === 1 ? 4 : 1;
      else if (k === "undo") { const p = camp.undo(); msg(p ? "Removed the last module." : "Nothing to undo."); showCamp(); }
      else if (k === "reset") restart();
      paint();
    }
    function paint() {
      const bar = $r("#vrBar"); if (!bar) return;
      const A = actions();
      const grp = g => A.filter(a => (a.group || "main") === g).map(a => `<button type="button" class="btn${a.primary ? " primary" : ""}" data-a="${a.id}" aria-pressed="${!!a.on}" ${a.off ? "disabled" : ""}>${esc(a.label)}</button>`).join("");
      bar.innerHTML = `<div class="vr-row">${grp("main")}</div>${step === "camp" ? `<div class="vr-row">${grp("mod")}</div>` : ""}<div class="vr-row vr-skins"><span class="eyebrow">World</span>${grp("world")}</div>`;
      root.querySelectorAll(".vr-steps li").forEach(li => li.classList.toggle("on", li.dataset.s === step));
      drawMenu();
    }
    $r("#vrBar").addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (b && !b.disabled) run(b.dataset.a); });

    /* ---------- headset console: floats in front of you, follows when you turn away or teleport ---------- */
    let menuBtns = [], menuHot = -1;
    function drawMenu() {
      if (!menu) return;
      const c = menu.ctx, W = 512, H = 520, A = actions();
      c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, W, H);
      c.fillStyle = "rgba(10,12,16,.92)"; c.beginPath(); c.roundRect(0, 0, W, H, 22); c.fill();
      c.fillStyle = "#f2c46d"; c.fillRect(0, 0, W, 6);
      c.font = "600 26px 'Space Grotesk', sans-serif"; c.fillStyle = "#e9e6df";
      c.fillText(loading ? "Loading terrain…" : { pad: "1 · Choose a pad", descent: "2 · Landing", camp: "3 · Build the camp" }[step], 24, 48);
      c.font = "500 12.5px 'IBM Plex Mono', monospace"; c.fillStyle = "#f2c46d";
      c.fillText(`${WORLDS[world].label} · ${WORLDS[world].place}`.toUpperCase(), 24, 72);
      c.font = "400 18px 'IBM Plex Sans', sans-serif"; c.fillStyle = "#c9cdd2";
      wrap(c, lastMsg, 24, 102, W - 48, 23, 3);
      menuBtns = []; let y = 176;
      const cols = 3, bw = (W - 48 - 16) / cols, bh = 50;
      A.forEach((a, i) => {
        const col = i % cols, x = 24 + col * (bw + 8); if (col === 0 && i) y += bh + 10;
        const hot = i === menuHot;
        c.fillStyle = a.off ? "rgba(255,255,255,.04)" : a.on ? "rgba(242,196,109,.25)" : a.primary ? "#e9e6df" : hot ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.08)";
        c.beginPath(); c.roundRect(x, y, bw, bh, 10); c.fill();
        if (a.on || hot) { c.strokeStyle = "#f2c46d"; c.lineWidth = 3; c.stroke(); }
        c.font = "600 15px 'Space Grotesk', sans-serif"; c.fillStyle = a.primary && !a.on ? "#0d0f12" : a.off ? "#555" : "#e9e6df";
        c.textAlign = "center"; c.fillText(a.label.toUpperCase(), x + bw / 2, y + 31); c.textAlign = "left";
        menuBtns.push({ x, y, w: bw, h: bh, id: a.id, off: a.off });
      });
      c.font = "500 12px 'IBM Plex Mono', monospace"; c.fillStyle = "#8a929c";
      c.fillText("TRIGGER = SELECT   GRIP = BRING CONSOLE HERE   RIGHT STICK = TURN", 24, H - 18);
      menu.tex.needsUpdate = true;
    }
    function wrap(c, text, x, y, w, lh, max) {
      const words = String(text).split(" "); let line = "", n = 0;
      for (const wd of words) { const t = line ? line + " " + wd : wd; if (c.measureText(t).width > w && line) { c.fillText(line, x, y); y += lh; line = wd; if (++n >= max) return; } else line = t; }
      if (line) c.fillText(line, x, y);
    }
    function menuHit(ray) {
      if (!menu || !menu.mesh.visible) return null;
      const hit = ray.intersectObject(menu.mesh, false)[0]; if (!hit) return null;
      const px = hit.uv.x * 512, py = (1 - hit.uv.y) * 520;
      const i = menuBtns.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
      return { i, d: hit.distance };
    }
    let consoleDue = 0, awayT = 0;
    const headPos = new THREE.Vector3(), headDir = new THREE.Vector3(), toCon = new THREE.Vector3();
    function headPose() {
      camera.getWorldPosition(headPos); camera.getWorldDirection(headDir); headDir.y = 0;
      if (headDir.lengthSq() < 1e-4) headDir.set(0, 0, -1); headDir.normalize();
    }
    function placeConsole() {
      if (!menu) return; headPose();
      menu.mesh.position.copy(headPos).addScaledVector(headDir, .72); menu.mesh.position.y = headPos.y - .32;
      menu.mesh.lookAt(headPos.x, headPos.y + .25, headPos.z);              // tilted up toward the eyes
      menu.mesh.visible = true; drawMenu();
    }
    function followConsole(dt) {
      if (consoleDue > 0) { consoleDue -= dt; if (consoleDue <= .7) { consoleDue = 0; placeConsole(); } return; }
      if (!menu.mesh.visible) return;
      headPose(); toCon.copy(menu.mesh.position).sub(headPos); const dy = toCon.y; toCon.y = 0; const dist = toCon.length(); toCon.normalize();
      awayT = (toCon.dot(headDir) < .35 || dist > 2.5 || Math.abs(dy) > 1.5) ? awayT + dt : 0;
      if (awayT > .9) { awayT = 0; placeConsole(); }
    }

    /* ---------- in-headset info board (touchdown report) ---------- */
    function showBoard(lines, color) {
      if (!board || !renderer.xr.isPresenting) return;
      const c = board.ctx, W = board.pw, H = board.ph;
      c.clearRect(0, 0, W, H); c.fillStyle = "rgba(8,10,14,.9)"; c.beginPath(); c.roundRect(0, 0, W, H, 24); c.fill();
      c.fillStyle = color; c.fillRect(0, 0, W, 10);
      c.font = "700 54px 'Space Grotesk', sans-serif"; c.fillStyle = color; c.fillText(lines[0], 36, 84);
      c.font = "400 30px 'IBM Plex Mono', monospace"; c.fillStyle = "#e9e6df"; lines.slice(1).forEach((l, i) => c.fillText(l, 36, 140 + i * 44));
      board.tex.needsUpdate = true;
      headPose();
      board.mesh.position.copy(headPos).addScaledVector(headDir, 1.7); board.mesh.position.y = headPos.y + .25; board.mesh.lookAt(headPos.x, board.mesh.position.y, headPos.z);
      board.mesh.visible = true; boardT = 12;
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
        const tag = label([`Pad ${"ABC"[i]}`, `${r.slope.toFixed(1)}° · ${r.roughness.toFixed(2)} m · ${LEVEL[r.level]}`], LEVEL_COL[r.level]); tag.position.y = 7;
        g.add(ring, beam, tag); g.position.set(c.x, terrain.heightAt(c.x, c.z), c.z); scene.add(g);
        pads.push({ x: c.x, z: c.z, g, r, name: `Pad ${"ABC"[i]}` });
      });
    }
    function choosePad(p, name) {
      const r = padGrade(p);
      chosen = { x: p.x, z: p.z, r, name };
      padMarker.visible = true; padMarker.position.set(p.x, terrain.heightAt(p.x, p.z) + .16, p.z); padMarker.material.color.setHex(LEVEL_HEX[r.level]);
      msg(`${name}: slope ${r.slope.toFixed(1)}°, roughness ${r.roughness.toFixed(2)} m, lander tilt ${r.tilt.toFixed(1)}° → ${LEVEL[r.level]}. Press Start landing.`);
      paint();
    }

    function startLanding() {
      if (!chosen) return;
      step = "descent"; tool = "move"; camp.setTool(null); padHover.visible = false;
      pads.forEach(p => { p.g.visible = Math.hypot(p.x - chosen.x, p.z - chosen.z) < 1; });
      camera.getWorldPosition(tmpV);
      lander.start(chosen, world, tmpV);
      msg(`Lander inbound to ${chosen.name}: powered descent under ${rules.worlds[world].gravity} m/s² gravity.`);
      $r("#vrCard").hidden = true;
    }
    function onTouchdown(r) {
      step = "camp"; tool = "move"; camp.setLander({ x: chosen.x, z: chosen.z });
      const L = rules.landing, col = LEVEL_COL[r.level];
      const row = (n, v, s, hz, g) => `<tr><td>${n}</td><td class="v">${v}</td><td class="lim">${s} / ${hz}</td><td><i class="dot" style="background:${LEVEL_COL[g]}"></i></td></tr>`;
      $r("#vrCard").innerHTML = `<div class="vr-card-head" style="--lc:${col}"><button type="button" class="vr-x" data-a="close" aria-label="Close">×</button><span class="eyebrow">Touchdown · ${esc(chosen.name)}</span><b>${LEVEL[r.level]}</b></div>
        <table class="vr-table"><thead><tr><th>Check</th><th>Value</th><th>Safe / hazard</th><th></th></tr></thead><tbody>
        ${row("Lander tilt", r.tilt.toFixed(1) + "°", L.tilt_safe_deg + "°", L.tilt_hazard_deg + "°", r.grades[0])}
        ${row("Ground slope", r.slope.toFixed(1) + "°", L.slope_safe_deg + "°", L.slope_hazard_deg + "°", r.grades[1])}
        ${row("Roughness", r.roughness.toFixed(2) + " m", L.roughness_safe_m + " m", L.roughness_hazard_m + " m", r.grades[2])}
        </tbody></table>
        <p class="note">Footpad height spread ${r.spread.toFixed(2)} m, measured on the ${L.pad_radius_m} m pad from ${esc(terrain.meta.source || "the terrain tile")}. Thresholds are team design rules.</p>
        <button type="button" class="btn" data-a="tool:habitat">Build the camp ▸</button>`;
      $r("#vrCard").hidden = false;
      showBoard([`Touchdown · ${LEVEL[r.level]}`, `tilt ${r.tilt.toFixed(1)}°   slope ${r.slope.toFixed(1)}°`, `roughness ${r.roughness.toFixed(2)} m`, `Next: build the camp from the console`], col);
      msg(`Touchdown ${LEVEL[r.level].toLowerCase()}. Now place the habitat, power and comms at least ${rules.camp.plume_keepout_m} m from the lander.`);
      paint();
    }
    $r("#vrCard").addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (!b) return; if (b.dataset.a === "close") { $r("#vrCard").hidden = true; return; } run(b.dataset.a); showCamp(); });

    function showCamp(last) {
      if (step !== "camp") return;
      const s = camp.status(), card = $r("#vrCard");
      card.innerHTML = `<div class="vr-card-head" style="--lc:${s.pct === 100 ? LEVEL_COL[0] : "var(--moho)"}"><button type="button" class="vr-x" data-a="close" aria-label="Close">×</button><span class="eyebrow">Base camp</span><b>${s.pct}% ready</b></div>
        <ul class="vr-needs">${s.needs.map(n => `<li class="${n.done ? "ok" : ""}"><i></i>${esc(n.name)}</li>`).join("")}</ul>
        ${last ? `<p class="note ${last.ok ? "" : "bad"}">${last.ok ? `Placed the ${esc(last.name.toLowerCase())}: slope ${last.s.slope.toFixed(1)}°, unevenness ${last.s.bumps.toFixed(2)} m.${last.warns.length ? " Note: " + esc(last.warns[0]) + "." : ""}` : `Cannot place the ${esc(last.name.toLowerCase())}: ${esc(last.fails.join("; "))}.`}</p>` : ""}
        <p class="note">${s.total} module${s.total === 1 ? "" : "s"} placed · rules from data/vr/rules.json</p>`;
      card.hidden = false;
      if (last && renderer.xr.isPresenting) msg(last.ok ? `Placed the ${last.name.toLowerCase()}. Camp ${s.pct}% ready.` : `Not here: ${last.fails[0]}.`);
    }

    function restart() {
      lander.reset(); camp.clear(); camp.setTool(null); camp.setLander(null);
      step = "pad"; tool = "pad"; chosen = null; padMarker.visible = false; speed = 1;
      pads.forEach(p => p.g.visible = true); $r("#vrCard").hidden = true;
      if (pads[0]) choosePad(pads[0], pads[0].name);
      msg("Choose a landing pad: point at the ground or pick a suggested ring.");
      paint();
    }

    /* ---------- select / hover ---------- */
    function onSelect(ray) {
      if (renderer.xr.isPresenting) { const m = menuHit(ray); if (m) { if (m.i >= 0 && !menuBtns[m.i].off) run(menuBtns[m.i].id); return; } }
      if (!terrain || loading) return;
      const p = rayGround(ray); if (!p) return;
      if (tool === "move") { if (terrain.inNear(p.x, p.z, 4) && Math.hypot(p.x - controls.rig.position.x, p.z - controls.rig.position.z) < 120) { controls.teleport(p.x, p.y, p.z); consoleDue = 1; } else toast("Stay inside the landing area"); return; }
      if (tool === "pad" && step === "pad") {
        if (!terrain.inNear(p.x, p.z, rules.landing.pad_radius_m + 2)) { toast("Pick a pad inside the landing area"); return; }
        const near = pads.find(q => Math.hypot(q.x - p.x, q.z - p.z) < rules.landing.pad_radius_m * 1.3);
        choosePad(near || p, near ? near.name : "Custom pad"); return;
      }
      if (step === "camp" && camp.tool) { const r = camp.place(p); if (r) { showCamp(r); if (!r.ok) toast("Not here: " + r.fails[0]); } }
    }
    function hover() {
      const ray = controls.hoverRay(); moveMarker.visible = false; padHover.visible = false;
      if (!ray) { camp?.hover(null); return; }
      if (renderer.xr.isPresenting) {
        const m = menuHit(ray); const hot = m ? m.i : -1;
        if (hot !== menuHot) { menuHot = hot; drawMenu(); }
        if (m) { controls.setPointerLength(m.d); camp?.hover(null); return; }
      }
      if (!terrain || loading) return;
      const p = rayGround(ray, 220);
      controls.setPointerLength(p ? ray.ray.origin.distanceTo(p) : 8);
      if (!p) { camp.hover(null); return; }
      if (tool === "move") { moveMarker.visible = terrain.inNear(p.x, p.z, 4); moveMarker.position.set(p.x, p.y + .06, p.z); }
      else if (tool === "pad" && step === "pad" && terrain.inNear(p.x, p.z, 8)) { const r = padGrade(p); padHover.visible = true; padHover.position.set(p.x, p.y + .12, p.z); padHover.material.color.setHex(LEVEL_HEX[r.level]); }
      if (step === "camp") camp.hover(camp.tool ? p : null);
    }

    /* ---------- XR session ---------- */
    const enterBtn = $r("#vrEnter");
    navigator.xr?.isSessionSupported?.("immersive-vr").then(ok => { if (ok && alive) enterBtn.hidden = false; }).catch(() => {});
    enterBtn.addEventListener("click", async () => {
      try {
        const s = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] });
        await renderer.xr.setSession(s);
        consoleDue = 1.2; msg("Point at a button and pull the trigger. Squeeze the grip to bring this console back in front of you.");
        s.addEventListener("end", () => { camera.position.set(0, 1.65, 0); if (board) board.mesh.visible = false; if (menu) menu.mesh.visible = false; });
      } catch (err) { toast("Could not start VR: " + err.message); }
    });

    /* ---------- worlds ---------- */
    async function loadWorld(w) {
      loading = true; world = w; drawMenu();
      const load = $r("#vrLoad"); load.hidden = false; $r("#vrLoadW").textContent = `VR · ${WORLDS[w].label} · ${WORLDS[w].place}`;
      await new Promise(r => setTimeout(r, 30));                   // let the loading card paint first
      let t;
      try { t = await loadTerrain(WORLDS[w].dirs(route.id)); }
      catch (err) { load.innerHTML = `<b>Could not load the terrain.</b><small>${esc(err.message)}</small>`; loading = false; return; }
      if (!alive) { t.dispose(); return; }
      // swap out the previous world
      if (terrain) { scene.remove(terrain.group); terrain.dispose(); }
      lander?.dispose(); camp?.dispose(); clearPads();
      terrain = t; scene.add(terrain.group);
      lander = createLander(scene, terrain, rules); lander.onTouchdown = onTouchdown;
      camp = createCamp(scene, terrain, rules);
      overlay = false; terrain.setOverlay(false);
      const sk = applySkin(w, { scene, renderer, sky, terrain });
      camp.setSky(sk.dir, w === "moon" ? sky.earth.userData.offset : null, w === "moon" ? 0x8a8884 : w === "mars" ? 0x8a4e32 : 0x7a6a58);
      buildPads();
      // viewer starts ~45 m from the best pad, on the flattest nearby spot, facing it
      const best = pads[0] || { x: 0, z: 0 };
      let start = null, bestS = Infinity;
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, x = best.x + Math.cos(a) * 45, z = best.z + Math.sin(a) * 45;
        if (!terrain.inNear(x, z, 10)) continue; const s = terrain.stats(x, z, 2).slope; if (s < bestS) { bestS = s; start = { x, z }; } }
      start = start || { x: best.x + 20, z: best.z + 20 };
      controls.teleport(start.x, terrain.heightAt(start.x, start.z), start.z); controls.face(best.x, best.z);
      const m = terrain.meta;
      $r("#vrPlace").textContent = `${WORLDS[w].label} · ${WORLDS[w].place}`;
      $r("#vrSrc").innerHTML = m.placeholder ? `Terrain: <b>placeholder</b> tile.` : `Terrain: <b>${esc(m.source)}</b>. ${esc(m.note || "")}`;
      load.hidden = true; root.querySelector(".vr-brief").hidden = false; $r("#vrBar").hidden = false;
      loading = false; consoleDue = renderer.xr.isPresenting ? 1 : 0;
      restart();
      msg(`${WORLDS[w].label}: ${WORLDS[w].place}. ${rules.worlds[w].gravity} m/s² gravity. Choose a landing pad.`);
    }

    /* ---------- start ---------- */
    (async () => {
      try { rules = await (await fetch("data/vr/rules.json")).json(); }
      catch (err) { $r("#vrLoad").innerHTML = `<b>Could not load the rules.</b><small>${esc(err.message)}</small>`; return; }
      if (!alive) return;
      controls = createControls({ renderer, camera, scene, dom: canvas, onSelect, onSqueeze: () => placeConsole() });
      const ringGeo = (a, b) => new THREE.RingGeometry(a, b, 48).rotateX(-Math.PI / 2);
      const flat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide, fog: false });
      padMarker = new THREE.Mesh(ringGeo(rules.landing.pad_radius_m - .6, rules.landing.pad_radius_m + .2), flat(0x46c37a));
      padHover = new THREE.Mesh(ringGeo(rules.landing.pad_radius_m - .15, rules.landing.pad_radius_m), flat(0xffffff)); padHover.material.opacity = .55;
      moveMarker = new THREE.Mesh(ringGeo(.35, .5), flat(0xf2c46d));
      padMarker.visible = padHover.visible = moveMarker.visible = false; scene.add(padMarker, padHover, moveMarker);
      menu = panel(.62, .63, 1024, 1040); menu.mesh.visible = false; menu.mesh.renderOrder = 5; scene.add(menu.mesh);
      board = panel(1.1, .5, 880, 400); board.mesh.visible = false; scene.add(board.mesh);
      await loadWorld("oman");
      if (new URLSearchParams(location.search).has("debug")) window.__vr = { get terrain() { return terrain; }, get lander() { return lander; }, get camp() { return camp; }, controls, run, get step() { return step; }, choosePad, get pads() { return pads; }, rules, get world() { return world; }, get loading() { return loading; }, placeConsole, menuHit, get menuBtns() { return menuBtns; }, get menu() { return menu; }, onSelect };   // QA only
    })();

    /* ---------- frame loop ---------- */
    let last = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
      if (terrain && controls && !loading) {
        const lim = terrain.near / 2 - 3, clampN = v => Math.max(-lim, Math.min(lim, v));
        controls.update(dt, (x, z) => terrain.heightAt(clampN(x), clampN(z)));
        if (!renderer.xr.isPresenting) { const rp = controls.rig.position; rp.x = clampN(rp.x); rp.z = clampN(rp.z); }
        terrain.updatePebbles(controls.rig.position.x, controls.rig.position.z);
        hover();
        lander.update(dt * (step === "descent" ? speed : 1), now / 1000);
        if (padMarker.visible) padMarker.material.opacity = .55 + .35 * Math.sin(now / 260);
        if (board?.mesh.visible && (boardT -= dt) < 0) board.mesh.visible = false;
      }
      if (renderer.xr.isPresenting && menu) followConsole(dt);
      camera.getWorldPosition(tmpV);
      sky.sky.position.copy(tmpV); sky.stars.position.copy(tmpV); sky.earth.position.copy(tmpV).add(sky.earth.userData.offset);
      renderer.render(scene, camera);
    });

    const onKey = e => { if (e.key === "Escape" && !renderer.xr.isPresenting) go(route.id ? "#site-" + route.id : "#oman"); };
    addEventListener("keydown", onKey);
    setKeys([["Drag", "Look"], ["WASD", "Walk"], ["Click", "Select"], ["Esc", "Back"]]);

    return {
      cleanup() {
        alive = false; unFx(); removeEventListener("resize", resize); removeEventListener("keydown", onKey);
        renderer.xr.getSession?.()?.end().catch(() => {});
        renderer.setAnimationLoop(null);
        controls?.dispose(); lander?.dispose(); camp?.dispose(); terrain?.dispose(); clearPads(); sky.dispose();
        scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
        renderer.dispose(); space.setActive(true);
      },
    };
  },
};
