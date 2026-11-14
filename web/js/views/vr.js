// VR: watch a lander touch down on the site terrain, check the touchdown against the ground,
// then lay out a base camp where the ground allows it. Runs in a Meta Quest (WebXR "Enter VR")
// or on screen (drag to look, tap to act). Terrain: data/vr/<site>/ (drone LiDAR) or the placeholder tile.
import * as THREE from "three";
import { h, esc, setKeys, toast } from "../core/ui.js";
import { MISSIONS } from "../core/data.js";
import { fx } from "../core/fx.js";
import { loadTerrain } from "../vr/terrain.js";
import { createSky, applySkin, SKINS } from "../vr/skins.js";
import { createLander } from "../vr/lander.js";
import { createCamp } from "../vr/camp.js";
import { createControls } from "../vr/controls.js";

const LEVEL = ["SAFE", "MARGINAL", "HAZARD"], LEVEL_COL = ["#46c37a", "#f0b040", "#e04a3a"], LEVEL_HEX = [0x46c37a, 0xf0b040, 0xe04a3a];
const worldOf = m => MISSIONS[m].world === "moon" ? "moon" : "mars";

/* canvas-texture panel used for the wrist menu and the in-headset info board */
function panel(wm, hm, pw, ph) {
  const cv = document.createElement("canvas"); cv.width = pw; cv.height = ph;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthTest: true }));
  return { cv, ctx: cv.getContext("2d"), tex, mesh, pw, ph };
}
function label(text, color) {
  const p = panel(9, 2.25, 512, 128), c = p.ctx;
  c.fillStyle = "rgba(6,8,12,.72)"; c.beginPath(); c.roundRect(4, 4, 504, 120, 18); c.fill();
  c.fillStyle = color; c.fillRect(4, 4, 10, 120);
  c.font = "600 40px 'Space Grotesk', sans-serif"; c.fillStyle = "#e9e6df"; c.fillText(text[0], 34, 56);
  c.font = "500 30px 'IBM Plex Mono', monospace"; c.fillStyle = color; c.fillText(text[1], 34, 102);
  p.tex.needsUpdate = true;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: p.tex, depthWrite: false, toneMapped: false })); s.scale.set(9, 2.25, 1);
  return s;
}

export default {
  mount({ view, scene: space, data, store, go }, route) {
    space.setActive(false);
    const list = data.sites[store.mission];
    const site = (route.id && data.site(route.id, store.mission)) || list[0];
    let alive = true, skin = worldOf(store.mission);

    const root = h("section", { class: "vr live", "aria-label": "VR landing and camp" });
    root.innerHTML = `
      <canvas class="vr-canvas" aria-label="3D view of the site terrain"></canvas>
      <div class="vr-load" id="vrLoad"><span class="eyebrow">VR · ${esc(site.name)}</span><b>Building the terrain…</b><small>Slope, roughness and shading are computed from the height grid.</small></div>
      <aside class="vr-brief panel ticks" hidden>
        <div class="panel-head"><span class="panel-title">Landing &amp; camp</span><span class="eyebrow">${esc(site.name)}</span></div>
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
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 1, .05, 2500);
    const sky = createSky(scene);
    function resize() { renderer.setPixelRatio(Math.min(devicePixelRatio, fx.level === "high" ? 2 : 1.25)); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
    resize(); addEventListener("resize", resize);
    const unFx = fx.subscribe(resize);

    let terrain, lander, camp, controls, rules, menu, board, pads = [], padMarker, moveMarker, chosen = null;
    let step = "pad", tool = "pad", overlay = false, speed = 1, lastMsg = "", boardT = 0;
    const tmpV = new THREE.Vector3();

    function msg(t) { lastMsg = t; const m = $r("#vrMsg"); if (m) m.textContent = t; drawMenu(); }

    /* ---------- ground picking: march along the ray against the height grid (cheap on Quest) ---------- */
    function rayGround(ray, max = 300) {
      const o = ray.ray.origin, d = ray.ray.direction; let prev = 0;
      for (let t = .5; t < max; t += t < 40 ? .5 : 1.5) {
        const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
        if (!terrain.inside(x, z)) return null;
        if (y <= terrain.heightAt(x, z)) {
          let a = prev, b = t;
          for (let k = 0; k < 10; k++) { const m = (a + b) / 2; (o.y + d.y * m <= terrain.heightAt(o.x + d.x * m, o.z + d.z * m)) ? b = m : a = m; }
          return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
        }
        prev = t;
      }
      return null;
    }

    /* ---------- actions (shared by the HTML bar and the wrist menu) ---------- */
    function actions() {
      const A = [];
      if (step === "pad") A.push({ id: "tool:pad", label: "Pick pad", on: tool === "pad" }, { id: "land", label: "Start landing ▸", primary: true, off: !chosen });
      if (step === "descent") A.push({ id: "speed", label: speed === 1 ? "Speed ×1" : "Speed ×4", on: speed > 1 });
      if (step === "camp") for (const m of camp.modules) A.push({ id: "tool:" + m.id, label: m.name, on: tool === m.id, group: "mod" });
      A.push({ id: "tool:move", label: "Move", on: tool === "move" });
      if (step === "camp") A.push({ id: "undo", label: "Undo" });
      for (const k of Object.keys(SKINS)) A.push({ id: "skin:" + k, label: SKINS[k].label, on: skin === k, group: "skin" });
      A.push({ id: "overlay", label: "Slope map", on: overlay }, { id: "reset", label: "Restart" });
      return A;
    }
    function run(id) {
      const [k, v] = id.split(":");
      if (k === "tool") { tool = v; camp.setTool(camp.modules.some(m => m.id === v) ? v : null); msg(v === "move" ? "Point at the ground and press to move there." : v === "pad" ? "Point at the ground to test a landing pad. Green rings are the best spots." : `Place the ${camp.modules.find(m => m.id === v).name.toLowerCase()}: green = ground OK, red = breaks a rule.`); }
      else if (k === "skin") setSkin(v);
      else if (k === "overlay") { overlay = !overlay; terrain.setOverlay(overlay); msg(overlay ? "Slope map: green < 5°, amber 5–10°, red > 10° (from the height grid)." : "Slope map off."); }
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
      bar.innerHTML = `<div class="vr-row">${grp("main")}</div>${step === "camp" ? `<div class="vr-row">${grp("mod")}</div>` : ""}<div class="vr-row vr-skins"><span class="eyebrow">World</span>${grp("skin")}</div>`;
      root.querySelectorAll(".vr-steps li").forEach(li => li.classList.toggle("on", li.dataset.s === step));
      drawMenu();
    }
    $r("#vrBar").addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (b && !b.disabled) run(b.dataset.a); });

    /* ---------- wrist menu (headset) ---------- */
    let menuBtns = [], menuHot = -1;
    function drawMenu() {
      if (!menu) return;
      const c = menu.ctx, W = menu.pw, H = menu.ph, A = actions();
      c.clearRect(0, 0, W, H);
      c.fillStyle = "rgba(10,12,16,.9)"; c.beginPath(); c.roundRect(0, 0, W, H, 22); c.fill();
      c.fillStyle = "#f2c46d"; c.fillRect(0, 0, W, 6);
      c.font = "600 30px 'Space Grotesk', sans-serif"; c.fillStyle = "#e9e6df"; c.fillText({ pad: "1 · Choose a pad", descent: "2 · Landing", camp: "3 · Build the camp" }[step], 24, 52);
      c.font = "400 21px 'IBM Plex Sans', sans-serif"; c.fillStyle = "#9ba3ad";
      wrap(c, lastMsg, 24, 86, W - 48, 26, 3);
      menuBtns = []; let y = 176;
      const cols = 2, bw = (W - 48 - 12) / cols, bh = 54;
      A.forEach((a, i) => {
        const col = i % cols, x = 24 + col * (bw + 12); if (col === 0 && i) y += bh + 10;
        const hot = i === menuHot;
        c.fillStyle = a.off ? "rgba(255,255,255,.04)" : a.on ? "rgba(242,196,109,.25)" : a.primary ? "#e9e6df" : hot ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.08)";
        c.beginPath(); c.roundRect(x, y, bw, bh, 10); c.fill();
        if (a.on || hot) { c.strokeStyle = "#f2c46d"; c.lineWidth = 3; c.stroke(); }
        c.font = "600 22px 'Space Grotesk', sans-serif"; c.fillStyle = a.primary && !a.on ? "#0d0f12" : a.off ? "#555" : "#e9e6df";
        c.fillText(a.label.toUpperCase(), x + 16, y + 35);
        menuBtns.push({ x, y, w: bw, h: bh, id: a.id, off: a.off });
      });
      menu.tex.needsUpdate = true;
    }
    function wrap(c, text, x, y, w, lh, max) {
      const words = String(text).split(" "); let line = "", n = 0;
      for (const wd of words) { const t = line ? line + " " + wd : wd; if (c.measureText(t).width > w && line) { c.fillText(line, x, y); y += lh; line = wd; if (++n >= max) return; } else line = t; }
      if (line) c.fillText(line, x, y);
    }
    function menuHit(ray) {
      if (!menu || !menu.mesh.parent) return null;
      const hit = ray.intersectObject(menu.mesh, false)[0]; if (!hit) return null;
      const px = hit.uv.x * menu.pw, py = (1 - hit.uv.y) * menu.ph;
      const i = menuBtns.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
      return { i, d: hit.distance };
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
      camera.getWorldPosition(tmpV); const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())); dir.y = 0; dir.normalize();
      board.mesh.position.copy(tmpV).addScaledVector(dir, 1.6); board.mesh.position.y = tmpV.y - .15; board.mesh.lookAt(tmpV.x, board.mesh.position.y, tmpV.z);
      board.mesh.visible = true; boardT = 12;
    }

    /* ---------- skins ---------- */
    let skinInfo = null;
    function setSkin(k) {
      skin = k; skinInfo = applySkin(k, { scene, renderer, sky, terrain });
      msg(`${SKINS[k].label}: same ground, ${k === "moon" ? "black sky, grazing south-pole sunlight, 1.62 m/s² gravity" : k === "mars" ? "dusty sky, 3.71 m/s² gravity" : "Oman daylight, 9.81 m/s² gravity"}.`);
    }

    /* ---------- pads ---------- */
    function padGrade(p) { return lander.report(p); }
    function buildPads() {
      const L = rules.landing;
      pads.forEach(p => scene.remove(p.g)); pads = [];
      terrain.suggestPads(L.pad_radius_m, 3).forEach((c, i) => {
        const r = padGrade(c), g = new THREE.Group(), col = LEVEL_HEX[r.level];
        const ring = new THREE.Mesh(new THREE.RingGeometry(L.pad_radius_m - .3, L.pad_radius_m, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = .12;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, 26, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false }));
        beam.position.y = 13;
        const tag = label([`Pad ${"ABC"[i]}`, `${r.slope.toFixed(1)}° · ${r.roughness.toFixed(2)} m · ${LEVEL[r.level]}`], LEVEL_COL[r.level]); tag.position.y = 7;
        g.add(ring, beam, tag); g.position.set(c.x, terrain.heightAt(c.x, c.z), c.z); scene.add(g);
        pads.push({ x: c.x, z: c.z, g, r, name: `Pad ${"ABC"[i]}` });
      });
    }
    function choosePad(p, name) {
      const r = padGrade(p);
      chosen = { x: p.x, z: p.z, r, name };
      padMarker.visible = true; padMarker.position.set(p.x, terrain.heightAt(p.x, p.z) + .14, p.z); padMarker.material.color.setHex(LEVEL_HEX[r.level]);
      msg(`${name}: slope ${r.slope.toFixed(1)}°, roughness ${r.roughness.toFixed(2)} m, lander tilt ${r.tilt.toFixed(1)}° → ${LEVEL[r.level]}. Press Start landing.`);
      paint();
    }

    function startLanding() {
      if (!chosen) return;
      step = "descent"; tool = "move"; camp.setTool(null); padHover.visible = false;
      pads.forEach(p => { p.g.visible = Math.hypot(p.x - chosen.x, p.z - chosen.z) < 1; });
      camera.getWorldPosition(tmpV);
      lander.start(chosen, skin, tmpV);
      msg(`Lander inbound to ${chosen.name}: powered descent under ${rules.worlds[skin].gravity} m/s² gravity.`);
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
        <p class="note">Footpad height spread ${r.spread.toFixed(2)} m. Measured on the ${L.pad_radius_m} m pad from the ${terrain.meta.placeholder ? "placeholder" : "LiDAR"} terrain; thresholds are team design rules.</p>
        <button type="button" class="btn" data-a="tool:habitat">Build the camp ▸</button>`;
      $r("#vrCard").hidden = false;
      showBoard([`Touchdown · ${LEVEL[r.level]}`, `tilt ${r.tilt.toFixed(1)}°   slope ${r.slope.toFixed(1)}°`, `roughness ${r.roughness.toFixed(2)} m`, `Next: open the wrist menu, build the camp`], col);
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
    }

    function restart() {
      lander.reset(); camp.clear(); camp.setTool(null); camp.setLander(null);
      step = "pad"; tool = "pad"; chosen = null; padMarker.visible = false; speed = 1;
      pads.forEach(p => p.g.visible = true); $r("#vrCard").hidden = true;
      if (pads[0]) choosePad(pads[0], pads[0].name);
      msg("Choose a landing pad: point at the ground or pick a suggested ring.");
    }

    /* ---------- select / hover ---------- */
    let padHover;
    function onSelect(ray) {
      if (!terrain) return;
      if (renderer.xr.isPresenting) { const m = menuHit(ray); if (m) { if (m.i >= 0 && !menuBtns[m.i].off) run(menuBtns[m.i].id); return; } }
      const p = rayGround(ray); if (!p) return;
      if (tool === "move") { if (Math.hypot(p.x - controls.rig.position.x, p.z - controls.rig.position.z) < 80) controls.teleport(p.x, p.y, p.z); return; }
      if (tool === "pad" && step === "pad") {
        const near = pads.find(q => Math.hypot(q.x - p.x, q.z - p.z) < rules.landing.pad_radius_m * 1.3);
        choosePad(near || p, near ? near.name : "Custom pad"); return;
      }
      if (step === "camp" && camp.tool) { const r = camp.place(p); if (r) { showCamp(r); if (!r.ok) toast("Not here: " + r.fails[0]); } }
    }
    function hover() {
      const ray = controls.hoverRay(); moveMarker.visible = false; padHover.visible = false;
      if (!ray) { camp.hover(null); return; }
      if (renderer.xr.isPresenting) {
        const m = menuHit(ray); const hot = m ? m.i : -1;
        if (hot !== menuHot) { menuHot = hot; drawMenu(); }
        if (m) { controls.setPointerLength(m.d); camp.hover(null); return; }
      }
      const p = rayGround(ray, 160);
      controls.setPointerLength(p ? ray.ray.origin.distanceTo(p) : 8);
      if (!p) { camp.hover(null); return; }
      if (tool === "move") { moveMarker.visible = true; moveMarker.position.set(p.x, p.y + .06, p.z); }
      else if (tool === "pad" && step === "pad") { const r = padGrade(p); padHover.visible = true; padHover.position.set(p.x, p.y + .1, p.z); padHover.material.color.setHex(LEVEL_HEX[r.level]); }
      if (step === "camp") camp.hover(camp.tool ? p : null);
    }

    /* ---------- XR session ---------- */
    const enterBtn = $r("#vrEnter");
    navigator.xr?.isSessionSupported?.("immersive-vr").then(ok => { if (ok && alive) enterBtn.hidden = false; }).catch(() => {});
    enterBtn.addEventListener("click", async () => {
      try {
        const s = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] });
        await renderer.xr.setSession(s);
        s.addEventListener("end", () => { camera.position.set(0, 1.65, 0); if (board) board.mesh.visible = false; });
        msg("In VR: trigger = select, right stick = turn. The menu is on your left wrist.");
      } catch (err) { toast("Could not start VR: " + err.message); }
    });

    /* ---------- load ---------- */
    (async () => {
      try {
        rules = await (await fetch("data/vr/rules.json")).json();
        await new Promise(r => setTimeout(r, 30));            // let the loading card paint first
        terrain = await loadTerrain(site.id);
      } catch (err) { $r("#vrLoad").innerHTML = `<b>Could not load the terrain.</b><small>${esc(err.message)}</small>`; return; }
      if (!alive) { terrain.dispose(); return; }
      scene.add(terrain.group);
      lander = createLander(scene, terrain, rules); lander.onTouchdown = onTouchdown;
      camp = createCamp(scene, terrain, rules);
      controls = createControls({ renderer, camera, scene, dom: canvas, onSelect });

      const ringGeo = (a, b) => new THREE.RingGeometry(a, b, 48).rotateX(-Math.PI / 2);
      padMarker = new THREE.Mesh(ringGeo(rules.landing.pad_radius_m - .6, rules.landing.pad_radius_m + .2), new THREE.MeshBasicMaterial({ color: 0x46c37a, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide }));
      padHover = new THREE.Mesh(ringGeo(rules.landing.pad_radius_m - .15, rules.landing.pad_radius_m), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide }));
      moveMarker = new THREE.Mesh(ringGeo(.35, .5), new THREE.MeshBasicMaterial({ color: 0xf2c46d, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide }));
      padMarker.visible = padHover.visible = moveMarker.visible = false; scene.add(padMarker, padHover, moveMarker);

      menu = panel(.19, .26, 512, 700); menu.mesh.position.set(0, .06, .02); menu.mesh.rotation.set(-Math.PI / 2.6, 0, 0);
      controls.attachMenu(menu.mesh);
      board = panel(1.1, .5, 880, 400); board.mesh.visible = false; scene.add(board.mesh);

      setSkin(skin);
      buildPads();
      // viewer starts ~45 m from the best pad, on the flattest nearby spot, facing it
      const best = pads[0] || { x: 0, z: 0 };
      let start = null, bestS = Infinity;
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, x = best.x + Math.cos(a) * 45, z = best.z + Math.sin(a) * 45;
        if (!terrain.inside(x, z, 8)) continue; const s = terrain.stats(x, z, 2).slope; if (s < bestS) { bestS = s; start = { x, z }; } }
      start = start || { x: 0, z: 0 };
      controls.teleport(start.x, terrain.heightAt(start.x, start.z), start.z); controls.face(best.x, best.z);

      $r("#vrSrc").innerHTML = terrain.meta.placeholder
        ? `Terrain: <b>placeholder</b> ${terrain.meta.size_m} m tile until the drone LiDAR survey is processed.`
        : `Terrain: <b>${esc(terrain.meta.source)}</b>, ${terrain.meta.size_m} m tile at ${terrain.meta.res_m} m.`;
      $r("#vrLoad").hidden = true; root.querySelector(".vr-brief").hidden = false; $r("#vrBar").hidden = false;
      restart();
      if (new URLSearchParams(location.search).has("debug")) window.__vr = { terrain, lander, camp, controls, run, get step() { return step; }, choosePad, pads, rules };   // QA only
    })();

    /* ---------- frame loop ---------- */
    let last = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
      if (terrain && controls) {
        controls.update(dt, (x, z) => terrain.heightAt(Math.max(-terrain.half + 2, Math.min(terrain.half - 2, x)), Math.max(-terrain.half + 2, Math.min(terrain.half - 2, z))));
        const rp = controls.rig.position; rp.x = Math.max(-terrain.half + 2, Math.min(terrain.half - 2, rp.x)); rp.z = Math.max(-terrain.half + 2, Math.min(terrain.half - 2, rp.z));
        hover();
        lander.update(dt * (step === "descent" ? speed : 1), now / 1000);
        if (padMarker.visible) padMarker.material.opacity = .55 + .35 * Math.sin(now / 260);
        if (board?.mesh.visible && (boardT -= dt) < 0) board.mesh.visible = false;
      }
      camera.getWorldPosition(tmpV);
      sky.sky.position.copy(tmpV); sky.stars.position.copy(tmpV); sky.earth.position.copy(tmpV).add(sky.earth.userData.offset);
      renderer.render(scene, camera);
    });

    const onKey = e => { if (e.key === "Escape" && !renderer.xr.isPresenting) go(route.id ? "#site-" + route.id : "#oman"); };
    addEventListener("keydown", onKey);
    setKeys([["Drag", "Look"], ["WASD", "Walk"], ["Click", "Select"], ["Esc", "Back"]]);
    const unsub = store.subscribe(() => { if (terrain) { setSkin(worldOf(store.mission)); paint(); } });

    return {
      cleanup() {
        alive = false; unsub(); unFx(); removeEventListener("resize", resize); removeEventListener("keydown", onKey);
        renderer.xr.getSession?.()?.end().catch(() => {});
        renderer.setAnimationLoop(null);
        controls?.dispose(); lander?.dispose(); camp?.dispose(); terrain?.dispose();
        scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
        renderer.dispose(); space.setActive(true);
      },
    };
  },
};
