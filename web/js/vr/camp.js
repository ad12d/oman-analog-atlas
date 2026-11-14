// Camp engine: placement rules checked against the terrain (slope, unevenness, plume keep-out, sunlight, line of
// sight to Earth, cold-trap shadow, distance to the habitat), teacher-style explanations with a recommended spot,
// a planner for the recommended base, and construction animations (grading robot, inflating habitat, deploying
// mast and wings, the rover driving out, astronauts at work). Rules + texts: data/vr/rules.json (engine-neutral).
import * as THREE from "three";
import { buildModule, buildRover, buildDozer, buildAstronaut } from "./models.js";

const COL = [0x40d080, 0xf0b040, 0xe04a3a];
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const elastic = t => t === 0 || t === 1 ? t : Math.pow(2, -9 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI / 3)) * .6 + 1;
const clamp01 = t => Math.max(0, Math.min(1, t));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const bearing = (dx, dz) => COMPASS[Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360) / 45) % 8];

export function createCamp(scene, terrain, rules, world) {
  const C = rules.camp, keepout = typeof C.plume_keepout_m === "object" ? C.plume_keepout_m[world] : C.plume_keepout_m;
  const MODS = Object.fromEntries(C.modules.map(m => [m.id, { ...m, name: m.names?.[world] || m.name }]));
  const root = new THREE.Group(); scene.add(root);
  const placed = [];                         // { id, x, z, obj, check }
  const anims = [], walkers = [];
  let tool = null, ghost = null, ring = null, hint = null, lander = null;
  const sky = { sun: new THREE.Vector3(.5, .5, -.5).normalize(), home: null, berm: 0x7a6a58 };

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x40d080, transparent: true, opacity: .65, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0x40d080, transparent: true, opacity: .42, emissive: 0x103020, depthWrite: false });
  const hintMat = new THREE.MeshBasicMaterial({ color: 0x5fe0a0, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide, fog: false });

  /* ---------- line of sight toward a direction (Sun, Earth): march over the height field ---------- */
  function lineOfSight(x, z, h0, dir) {
    const hx = dir.x, hz = dir.z, hl = Math.hypot(hx, hz) || 1, dx = hx / hl, dz = hz / hl, tanEl = dir.y / hl;
    const y0 = terrain.heightAt(x, z) + h0;
    for (let t = 3; t < 2500; t += t < 60 ? 3 : t < 400 ? 8 : 20) {
      const px = x + dx * t, pz = z + dz * t; if (!terrain.inside(px, pz)) break;
      const ground = terrain.heightAt(px, pz), ray = y0 + t * tanEl;
      if (ground > ray) return { clear: false, dist: t, by: ground - ray };
    }
    return { clear: true };
  }
  const habitat = () => placed.find(p => p.id === "habitat");
  const elevDeg = d => Math.asin(Math.max(-1, Math.min(1, d.y / d.length()))) * 180 / Math.PI;
  let shadowExists = null;                    // is there any cold trap in the landing area at all?
  function anyShadow() {
    if (shadowExists !== null) return shadowExists;
    const lim = terrain.near / 2 - 10; shadowExists = false;
    for (let z = -lim; z <= lim && !shadowExists; z += 12) for (let x = -lim; x <= lim; x += 12) if (!lineOfSight(x, z, 1, sky.sun).clear) { shadowExists = true; break; }
    return shadowExists;
  }

  /* ---------- rules, each with a measured value, a limit and the reason ---------- */
  function check(id, x, z, opts = {}) {
    const m = MODS[id], s = terrain.stats(x, z, m.radius_m), R = [];
    const add = (key, label, ok, value, limit, why, warn = false) => R.push({ key, label, ok, warn, value, limit, why });
    if (!terrain.inNear(x, z, m.radius_m + 1)) add("inside", "Inside the surveyed landing area", false, "outside", "inside", "The detailed terrain (and the crew's walking zone) covers the landing area only.");
    add("slope", "Ground slope", s.slope <= m.max_slope_deg, `${s.slope.toFixed(1)}°`, `≤ ${m.max_slope_deg}°`, m.why?.slope || "Equipment needs gentle ground to stand and be serviced safely.", s.slope > m.max_slope_deg * .8 && s.slope <= m.max_slope_deg);
    add("relief", "Unevenness (after removing the slope)", s.bumps <= m.max_relief_m, `${s.bumps.toFixed(2)} m`, `≤ ${m.max_relief_m} m`, m.why?.relief || "Large bumps under the footprint would have to be graded flat first.");
    if (m.keepout && lander) { const d = Math.hypot(x - lander.x, z - lander.z);
      add("keepout", "Distance from the landing pad", d >= keepout, `${d.toFixed(0)} m`, `≥ ${keepout} m`, C.keepout_why?.[world] || "Landing plumes throw debris outward."); }
    if (m.max_from) for (const [ref, max] of Object.entries(m.max_from)) {
      const r = placed.find(p => p.id === ref);
      if (!r) add("distance", `Within ${max} m of the ${MODS[ref].name.toLowerCase()}`, false, "not built yet", `≤ ${max} m`, `Build the ${MODS[ref].name.toLowerCase()} first: the ${m.name.toLowerCase()} is laid out relative to it.`);
      else { const d = Math.hypot(x - r.x, z - r.z); add("distance", `Distance to the ${MODS[ref].name.toLowerCase()}`, d <= max, `${d.toFixed(0)} m`, `≤ ${max} m`, m.why?.distance); }
    }
    const over = placed.find(p => p !== opts.ignore && Math.hypot(p.x - x, p.z - z) < MODS[p.id].radius_m + m.radius_m);
    if (over) add("overlap", "Free space", false, `overlaps the ${MODS[over.id].name.toLowerCase()}`, "clear", "Each module needs its own footprint plus room to walk around it.");
    if (opts.fast && R.some(r => !r.ok && !r.warn)) return { id, name: m.name, ok: false, level: 2, rules: R, fails: R.filter(r => !r.ok), warns: [], s, x, z };   // skip the costly sight lines
    if (m.needs_sun) { const los = lineOfSight(x, z, 6, sky.sun);
      add("sun", `Sunlight (Sun ${elevDeg(sky.sun).toFixed(0)}° above the horizon)`, los.clear, los.clear ? "in sunlight" : `shaded by ground ${los.dist.toFixed(0)} m away`, "in sunlight", m.why?.sun); }
    if (m.needs_home && sky.home) { const los = lineOfSight(x, z, 5, sky.home);
      add("home", "Line of sight to Earth", los.clear, los.clear ? "clear" : `blocked ${los.dist.toFixed(0)} m away`, "clear", m.why?.home); }
    if (m.needs_shadow?.[world]) { const los = lineOfSight(x, z, 1, sky.sun), exists = anyShadow();
      add("shadow", "Permanent shadow (cold trap)", !los.clear || !exists, !los.clear ? "in shadow" : "sunlit", "in shadow",
        m.why?.shadow + (exists ? "" : " This landing area has no shadowed ground, so the drill is placed as close as possible and the real cold traps would be reached in the craters below."), !exists && los.clear); }
    const fails = R.filter(r => !r.ok && !r.warn), warns = R.filter(r => r.warn);
    return { id, name: m.name, role: m.role, ok: fails.length === 0, level: fails.length ? 2 : warns.length ? 1 : 0, rules: R, fails, warns, s, x, z };
  }

  /** nearest spot (within reach) where the module passes every rule */
  function recommend(id, x, z, maxR = 110) {
    for (let r = 4; r <= maxR; r += 4) {
      const n = Math.max(8, Math.round(r / 3));
      for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + r, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!terrain.inNear(px, pz, MODS[id].radius_m + 2)) continue;
        const c = check(id, px, pz, { fast: true }); if (c.ok) return { x: px, z: pz, dist: r, dir: bearing(px - x, pz - z), check: c }; }
    }
    return null;
  }

  /** teacher-style text for a check (and its recommendation) */
  function explain(c, rec) {
    const lead = c.ok ? `${c.name}: a good site.` : `${c.name} cannot go here.`;
    const lines = c.rules.filter(r => !r.ok || r.warn).map(r => `${r.label}: ${r.value} (rule ${r.limit}). ${r.why || ""}`);
    const tip = !c.ok && rec ? `Recommendation: about ${Math.round(rec.dist)} m ${rec.dir} the ground passes every rule.` : !c.ok ? "No spot nearby passes every rule; try another part of the landing area." : "";
    return { lead, lines, tip };
  }

  /* ---------- ghost + hint ---------- */
  function makeGhost(id) {
    dropGhost();
    ghost = id === "rover" ? buildRover() : buildModule(id, sky); ghost.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; } });
    const r = MODS[id].radius_m;
    ring = new THREE.Mesh(new THREE.RingGeometry(r - .12, r, 48), ringMat); ring.rotation.x = -Math.PI / 2;
    root.add(ghost, ring); ghost.visible = ring.visible = false;
  }
  function dropGhost() { if (ghost) { root.remove(ghost, ring); ring.geometry.dispose(); ghost = ring = null; } }
  function showHint(rec, id) {
    clearHint(); if (!rec) return;
    const r = MODS[id || tool]?.radius_m || 3;
    hint = new THREE.Mesh(new THREE.RingGeometry(r - .35, r + .1, 48), hintMat); hint.rotation.x = -Math.PI / 2;
    hint.position.set(rec.x, terrain.heightAt(rec.x, rec.z) + .12, rec.z); root.add(hint);
  }
  function clearHint() { if (hint) { root.remove(hint); hint.geometry.dispose(); hint = null; } }

  const yawFor = (id, x, z) => {
    if (id === "solar" || id === "comms") return 0;                       // keep their own Sun / Earth pointing
    const h = habitat();
    if (id === "rover" && h) return -Math.atan2(h.z - z, h.x - x) + Math.PI;  // rover's nose (+x) points away from the airlock
    return lander ? Math.atan2(lander.x - x, lander.z - z) : 0;
  };

  let lastHover = null, lastCheck = null;
  function hover(p) {
    if (!ghost || !p) { if (ghost) ghost.visible = ring.visible = false; return null; }
    if (!lastHover || Math.hypot(p.x - lastHover.x, p.z - lastHover.z) > .4) { lastCheck = check(tool, p.x, p.z); lastHover = { x: p.x, z: p.z }; }
    const c = lastCheck, y = terrain.heightAt(p.x, p.z);
    ghost.visible = ring.visible = true;
    ghost.position.set(p.x, y, p.z); ghost.rotation.y = yawFor(tool, p.x, p.z);
    ring.position.set(p.x, y + .08, p.z);
    ringMat.color.setHex(COL[c.level]); ghostMat.color.setHex(COL[c.level]); ghostMat.emissive.setHex(COL[c.level]).multiplyScalar(.25);
    return c;
  }

  /* ---------- construction ---------- */
  const dust = (() => {   // one shared dust-puff system for grading / unpacking
    const N = 500, pos = new Float32Array(N * 3).fill(-1e4), vel = new Float32Array(N * 3), life = new Float32Array(N), max = new Float32Array(N);
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sc = document.createElement("canvas"); sc.width = sc.height = 64; const sx = sc.getContext("2d"), gr = sx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.5, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)"); sx.fillStyle = gr; sx.fillRect(0, 0, 64, 64);
    const mat = new THREE.PointsMaterial({ color: 0xb8a68a, size: 1.1, map: new THREE.CanvasTexture(sc), transparent: true, opacity: .5, depthWrite: false });   // soft round puffs
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; root.add(pts); let next = 0;
    return {
      mat,
      emit(x, z, n, spread = 3) { for (let k = 0; k < n; k++) { const i = next = (next + 1) % N, a = Math.random() * 6.283, r = Math.random() * spread;
        pos[i * 3] = x + Math.cos(a) * r; pos[i * 3 + 1] = terrain.heightAt(x, z) + .2; pos[i * 3 + 2] = z + Math.sin(a) * r;
        vel[i * 3] = Math.cos(a) * (1 + Math.random() * 2); vel[i * 3 + 1] = .4 + Math.random() * 1.2; vel[i * 3 + 2] = Math.sin(a) * (1 + Math.random() * 2); life[i] = 0; max[i] = 1.2 + Math.random() * 1.6; } },
      update(dt) { for (let i = 0; i < N; i++) { if (!max[i]) continue; life[i] += dt; if (life[i] > max[i]) { max[i] = 0; pos[i * 3 + 1] = -1e4; continue; }
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt; vel[i * 3 + 1] -= dt * .8; }
        geo.attributes.position.needsUpdate = true; },
    };
  })();

  function groundAt(o, x, z) { o.position.set(x, terrain.heightAt(x, z), z); }
  function driveTo(obj, from, to, t, wheelR) {      // straight drive with wheel spin; +x is the vehicle's nose
    const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
    groundAt(obj, x, z); obj.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
    if (wheelR) obj.userData.wheels?.forEach(w => { w.rotation.z = -Math.hypot(to.x - from.x, to.z - from.z) * t / wheelR; });
  }

  /** construction timeline for one module; returns {update(t01), done()} */
  function construction(id, obj, x, z) {
    const P = obj.userData, start = lander ? { x: lander.x + 4, z: lander.z + 4 } : { x: x + 30, z: z + 30 };
    let dozer = null;
    if (id === "habitat" || id === "drill" || id === "solar") { dozer = buildDozer(); root.add(dozer); groundAt(dozer, start.x, start.z); }
    obj.visible = false;
    return {
      update(t) {
        // phase 1 (0-35 %): the construction robot drives in and grades a circle
        if (dozer) {
          if (t < .2) driveTo(dozer, start, { x: x + 6, z }, ease(t / .2));
          else if (t < .38) { const a = (t - .2) / .18 * Math.PI * 2, r = MODS[id].radius_m + 1.5, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
            groundAt(dozer, px, pz); dozer.rotation.y = -a - Math.PI / 2; if (Math.random() < .6) dust.emit(px, pz, 3, 1.2); }
          else if (t < .55) driveTo(dozer, { x: x + 6, z }, start, ease((t - .38) / .17));
          else if (dozer.parent) { root.remove(dozer); dozer = null; }
        }
        const b = id === "rover" || id === "path" || id === "comms" ? t : seg(t, .3, 1);   // phase 2: the module itself
        if (b > 0 && !obj.visible) { obj.visible = true; dust.emit(x, z, 30, MODS[id].radius_m); }
        if (id === "habitat") {
          const bm = Math.max(.001, seg(b, 0, .25)); P.berm.scale.set(bm, bm, bm * .6);
          const inf = seg(b, .25, .8); P.shell.scale.set(.85 + .15 * easeOut(inf), Math.max(.03, elastic(inf)), .85 + .15 * easeOut(inf));
          const lk = seg(b, .8, 1); P.lock.scale.setScalar(Math.max(.001, easeOut(lk)));
        } else if (id === "solar" || id === "comms") {
          const up = Math.max(.01, easeOut(seg(b, 0, .45))), mastH = id === "solar" ? 7.5 : 5;
          P.mast.scale.y = up; P.mast.position.y = mastH / 2 * up;
          (P.head || P.mount).position.y = (id === "solar" ? 5.0 : 5.1) * up;
          if (id === "solar") P.wings.forEach(w => { w.rotation.y = w.userData.sx * 1.5 * (1 - easeOut(seg(b, .5, 1))); });
          else P.mount.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)).slerp(P.mount.userData.aim, ease(seg(b, .5, 1))));
        } else if (id === "rover") {
          const from = lander ? { x: lander.x + 5, z: lander.z - 2 } : { x: x - 25, z };
          if (b < 1) driveTo(obj, from, { x, z }, ease(b), obj.userData.wheelR); else { groundAt(obj, x, z); obj.rotation.y = yawFor("rover", x, z); }
        } else {
          obj.scale.setScalar(Math.max(.001, easeOut(seg(b, 0, .7))));
        }
      },
      done() { if (dozer) root.remove(dozer); obj.visible = true; if (id !== "rover") obj.scale.setScalar(1); },
    };
  }

  /** place a module (after checking) and play its construction; returns {check, done: Promise} */
  function placeAt(id, x, z, { animate = true, duration = null, force = false } = {}) {
    const c = check(id, x, z);
    if (!c.ok && !force) return { check: c, done: Promise.resolve() };
    const obj = id === "rover" ? buildRover() : buildModule(id, sky);
    groundAt(obj, x, z); obj.position.y -= .05; obj.rotation.y = yawFor(id, x, z); root.add(obj);
    placed.push({ id, x, z, obj, check: c });
    clearHint(); lastHover = null;
    if (!animate) return { check: c, done: Promise.resolve() };
    const dur = duration ?? ({ habitat: 6, solar: 4.5, comms: 4, rover: 5, drill: 4, path: 1.2 }[id] || 3);
    const tl = construction(id, obj, x, z);
    return { check: c, done: new Promise(res => anims.push({ t: 0, dur, tl, res })) };
  }
  function place(p) { if (!tool || !p) return null; return placeAt(tool, p.x, p.z).check; }

  /** greedy plan for the recommended base, in build order; scores favour short walks and good margins */
  function plan() {
    const order = C.build_order || ["habitat", "solar", "comms", "rover", "drill", "path"], out = [], saved = placed.slice();
    const lim = terrain.near / 2 - 12, dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    for (const id of order) {
      if (id === "path" || placed.some(p => p.id === id)) continue;
      let best = null;
      for (let z = -lim; z <= lim; z += 7) for (let x = -lim; x <= lim; x += 7) {
        const c = check(id, x, z, { fast: true }); if (!c.ok) continue;
        const h = placed.find(p => p.id === "habitat"), d = lander ? dist({ x, z }, lander) : 0;
        let score = c.s.slope + c.s.bumps * 4 + c.warns.length * 3;
        if (id === "habitat") score += Math.abs(d - (keepout + 25)) / 6;                 // just outside the blast zone
        else if (id === "rover" && h) score += Math.abs(dist({ x, z }, h) - 20) / 3;     // a garage ~20 m from the airlock, not blocking it
        else if (h) score += dist({ x, z }, h) / 12;                                     // compact layout
        if (!best || score < best.score) best = { id, x, z, score, check: c };
      }
      if (best) { out.push(best); placed.push({ id, x: best.x, z: best.z, obj: null }); }   // pretend-place so later rules see it
    }
    // path markers every ~14 m from the habitat toward the lander, stopping at the blast-zone edge
    const h = placed.find(p => p.id === "habitat");
    if (h && lander) { const dx = lander.x - h.x, dz = lander.z - h.z, L = Math.hypot(dx, dz);
      for (let s = 12; s < L - keepout + 12; s += 14) { const x = h.x + dx / L * s, z = h.z + dz / L * s; if (check("path", x, z).ok) out.push({ id: "path", x, z }); } }
    placed.length = 0; placed.push(...saved);          // undo the pretend placements
    return out;
  }

  /* ---------- crew: astronauts walking between the airlock, rover, drill and array ---------- */
  function addCrew() {
    const h = habitat(); if (!h || walkers.length) return;
    const stops = [{ x: h.x + Math.sin(h.obj.rotation.y) * 7.5, z: h.z + Math.cos(h.obj.rotation.y) * 7.5 }];
    for (const id of ["rover", "drill", "solar"]) { const p = placed.find(q => q.id === id); if (p) stops.push({ x: p.x + 3, z: p.z + 3 }); }
    if (stops.length < 2) stops.push({ x: h.x + 14, z: h.z });
    [0xf2f0ea, 0xf0d6a8].forEach((tint, i) => {
      const a = buildAstronaut(tint); root.add(a);
      walkers.push({ a, stops, leg: i % stops.length, t: i * .45, speed: 1.1 + i * .15 });
    });
  }
  function updateWalkers(dt, time) {
    for (const w of walkers) {
      const A = w.stops[w.leg], B = w.stops[(w.leg + 1) % w.stops.length], L = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      w.t += dt * w.speed / L;
      if (w.t >= 1) { w.t = 0; w.leg = (w.leg + 1) % w.stops.length; continue; }
      const x = A.x + (B.x - A.x) * w.t, z = A.z + (B.z - A.z) * w.t;
      w.a.position.set(x, terrain.heightAt(x, z) + Math.abs(Math.sin(time * 6 * w.speed)) * .06, z);   // low-gravity lope
      w.a.rotation.y = Math.atan2(B.x - A.x, B.z - A.z);
      const s = Math.sin(time * 6 * w.speed) * .6, { legs, arms } = w.a.userData;
      legs[0].rotation.x = s; legs[1].rotation.x = -s; arms[0].rotation.x = -s * .7; arms[1].rotation.x = s * .7;
    }
  }

  function update(dt, time) {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i]; a.t += dt; a.tl.update(Math.min(1, a.t / a.dur), dt);
      if (a.t >= a.dur) { a.tl.done(); anims.splice(i, 1); a.res(); }
    }
    for (const p of placed) if (p.id === "drill" && p.obj?.userData.string) p.obj.userData.string.rotation.y += dt * 4;
    dust.update(dt); updateWalkers(dt, time);
    if (hint) hint.material.opacity = .55 + .35 * Math.sin(time * 5);
  }

  const disposeObj = o => o.traverse(m => m.geometry?.dispose?.());
  function undo() { const p = placed.pop(); if (p?.obj) { root.remove(p.obj); disposeObj(p.obj); } return p; }
  function clear() { while (placed.length) undo(); walkers.splice(0).forEach(w => root.remove(w.a)); anims.splice(0).forEach(a => { a.tl.done(); a.res(); }); clearHint(); }

  function status() {
    const counts = {}; placed.forEach(p => { counts[p.id] = (counts[p.id] || 0) + 1; });
    const needs = C.needs.map(id => ({ id, name: MODS[id].name, done: !!counts[id] }));
    const pct = Math.round(needs.filter(n => n.done).length / needs.length * 100);
    return { counts, needs, pct, total: placed.length, placed: placed.slice() };
  }

  return {
    modules: C.modules.map(m => MODS[m.id]), MODS, keepout, world,
    setTool(id) { tool = id; lastHover = null; if (id) makeGhost(id); else dropGhost(); },
    get tool() { return tool; },
    setLander(p) { lander = p; },
    setSky(sun, home, berm) { sky.sun.copy(sun); sky.home = home ? home.clone().normalize() : null; if (berm != null) sky.berm = berm; shadowExists = null; },
    lineOfSight: (x, z, h, which) => lineOfSight(x, z, h, which === "home" ? sky.home : sky.sun),
    hover, place, placeAt, check, recommend, explain, showHint, clearHint, plan, addCrew, update, undo, clear, status,
    get busy() { return anims.length > 0; },
    dispose() { clear(); dropGhost(); scene.remove(root); ringMat.dispose(); ghostMat.dispose(); hintMat.dispose(); dust.mat.dispose(); },
  };
}
