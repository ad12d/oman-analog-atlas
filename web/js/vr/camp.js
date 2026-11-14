// Camp builder: module models, the placement ghost, and rule checks against the terrain.
// Rules and the module catalogue come from data/vr/rules.json (engine-neutral).
import * as THREE from "three";
import { vrMaterials, strut } from "./materials.js";

// sky directions so the solar array faces the sun and the comms dish points home (Earth from the Moon)
const sky = { sun: new THREE.Vector3(.5, .5, -.5).normalize(), home: null, berm: 0x7a6a58 };

function build(id) {
  const M = vrMaterials(), g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  if (id === "habitat") {
    // inflatable shell on a rigid core, restraint straps, regolith berm, airlock
    const shell = new THREE.LatheGeometry([[0, 4.75], [1.2, 4.6], [2.6, 4.05], [3.55, 3.1], [4.0, 1.9], [4.05, .9], [3.9, .35]].map(([r, y]) => new THREE.Vector2(r, y)), 48);
    add(shell, M.fabric);
    for (const [r, y] of [[3.98, .95], [4.03, 1.9], [3.62, 3.0], [2.7, 3.95]]) { const t = add(new THREE.TorusGeometry(r, .05, 6, 64), M.strap, 0, y, 0); t.rotation.x = Math.PI / 2; }
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2;       const curve = new THREE.CatmullRomCurve3([[3.95, .4], [4.08, 1.6], [3.6, 3.1], [2.2, 4.25], [.9, 4.7]].map(([r, y]) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)));
      add(new THREE.TubeGeometry(curve, 16, .035, 5), M.strap); }
    const berm = new THREE.Mesh(new THREE.TorusGeometry(4.15, .55, 10, 48), new THREE.MeshStandardMaterial({ color: sky.berm, roughness: 1 }));
    berm.rotation.x = Math.PI / 2; berm.scale.z = .6; berm.position.y = .15; berm.receiveShadow = berm.castShadow = true; g.add(berm);
    const lock = add(new THREE.CylinderGeometry(1.05, 1.05, 2.6, 24), M.paint, 0, 1.25, 4.9); lock.rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(1.08, 1.08, .12, 24), M.titanium, 0, 1.25, 6.2).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(.85, 1.5, .06), M.paintGrey, 0, 1.15, 6.27);
    add(new THREE.BoxGeometry(1.4, .08, 1.6), M.titanium, 0, .1, 7.0);
    for (const x of [-.75, .75]) add(new THREE.SphereGeometry(.07, 8, 6), M.lampG, x, 2.1, 6.2).castShadow = false;
    add(new THREE.SphereGeometry(.1, 8, 6), M.lampW, 0, 2.35, 6.2).castShadow = false;
  } else if (id === "solar") {
    // tall vertical array (good for a low south-pole sun), turned to face the sun
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; g.add(strut(new THREE.Vector3(Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3), new THREE.Vector3(0, 1.4, 0), .05, M.titanium)); }
    add(new THREE.BoxGeometry(.7, .5, .7), M.paintGrey, 0, .3, 0);
    add(new THREE.CylinderGeometry(.1, .14, 7.5, 12), M.titanium, 0, 3.75, 0);
    const head = new THREE.Group(); head.position.y = 5.0; g.add(head);
    const az = Math.atan2(sky.sun.x, sky.sun.z), el = Math.asin(Math.min(1, Math.max(-1, sky.sun.y)));
    head.rotation.y = az; const tilt = new THREE.Group(); tilt.rotation.x = -Math.max(0, el); head.add(tilt);   // face the sun's azimuth, lean back by its elevation
    for (const x of [-1.3, 1.3]) {
      add(new THREE.BoxGeometry(2.4, 4.6, .05), M.cells, x, 0, .22, tilt);
      add(new THREE.BoxGeometry(2.5, 4.7, .03), M.titanium, x, 0, .18, tilt);
    }
    add(new THREE.BoxGeometry(.18, 4.8, .18), M.titanium, 0, 0, .1, tilt);
  } else if (id === "comms") {
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; g.add(strut(new THREE.Vector3(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0), new THREE.Vector3(0, 2.0, 0), .045, M.titanium)); }
    add(new THREE.CylinderGeometry(.08, .1, 5, 10), M.titanium, 0, 2.5, 0);
    add(new THREE.BoxGeometry(.5, .6, .4), M.paint, 0, 1.0, 0);
    const mount = new THREE.Group(); mount.position.y = 5.1; g.add(mount);
    const aim = sky.home ? sky.home.clone().normalize() : new THREE.Vector3(.4, .7, -.6).normalize();
    mount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), aim);          // dish axis points home
    const dish = add(new THREE.SphereGeometry(1.0, 32, 10, 0, Math.PI * 2, 0, Math.PI / 3.4), M.paint, 0, 0, -.45, mount); dish.rotation.x = -Math.PI / 2;
    add(new THREE.CylinderGeometry(.03, .03, 1.0, 6), M.steel, 0, 0, .1, mount).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(.07, 8, 6), M.black, 0, 0, .6, mount);
    add(new THREE.SphereGeometry(.09, 8, 6), M.lampR, 0, 5.6, 0).castShadow = false;
  } else if (id === "rover") {
    // pressurised rover: chassis, cabin with a wraparound window, six wheels, roof array, mast camera
    add(new THREE.BoxGeometry(4.2, .45, 2.1), M.titanium, 0, .95, 0);
    const cab = add(new THREE.CapsuleGeometry(1.0, 2.0, 8, 18), M.paint, -.1, 1.95, 0); cab.rotation.z = Math.PI / 2; cab.scale.set(1, 1, .95);
    const win = add(new THREE.SphereGeometry(1.02, 24, 12, -Math.PI / 2.6, Math.PI / 1.3, Math.PI / 3.2, Math.PI / 3.2), M.glass, 1.2, 1.95, 0); win.rotation.z = -Math.PI / 2;
    add(new THREE.BoxGeometry(2.2, .05, 1.7), M.cells, -.6, 3.0, 0);
    for (const x of [-1.5, 0, 1.5]) for (const z of [-1.2, 1.2]) {
      const w = add(new THREE.CylinderGeometry(.5, .5, .36, 24), M.tyre, x, .5, z); w.rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(.22, .22, .38, 12), M.steel, x, .5, z).rotation.x = Math.PI / 2;
    }
    for (const z of [-1.2, 1.2]) add(new THREE.BoxGeometry(4.3, .08, .5), M.paintGrey, 0, 1.06, z);
    add(new THREE.CylinderGeometry(.04, .04, 1.0, 6), M.steel, 1.4, 3.3, .5);
    add(new THREE.BoxGeometry(.3, .2, .45), M.black, 1.4, 3.85, .5);
    for (const z of [-.6, .6]) add(new THREE.SphereGeometry(.08, 8, 6), M.lampW, 2.15, 1.1, z).castShadow = false;
  } else {   // path marker
    add(new THREE.CylinderGeometry(.03, .03, 1.4, 6), M.titanium, 0, .7, 0);
    add(new THREE.ConeGeometry(.22, .5, 12), M.orange, 0, .25, 0);
    add(new THREE.CylinderGeometry(.06, .06, .14, 10), M.lampW, 0, 1.45, 0).castShadow = false;
  }
  return g;
}

export function createCamp(scene, terrain, rules) {
  const C = rules.camp, MODS = Object.fromEntries(C.modules.map(m => [m.id, m]));
  const root = new THREE.Group(); scene.add(root);
  const placed = [];                         // { id, x, z, yaw, obj, check }
  let tool = null, ghost = null, ring = null, lander = null;

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x40d080, transparent: true, opacity: .65, depthWrite: false, side: THREE.DoubleSide });
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0x40d080, transparent: true, opacity: .45, emissive: 0x103020, depthWrite: false });

  function check(id, x, z) {
    const m = MODS[id], s = terrain.stats(x, z, m.radius_m), fails = [], warns = [];
    if (!terrain.inside(x, z, m.radius_m + 1)) fails.push("outside the surveyed tile");
    if (s.slope > m.max_slope_deg) fails.push(`slope ${s.slope.toFixed(1)}° > ${m.max_slope_deg}°`);
    else if (s.slope > m.max_slope_deg * .8) warns.push(`slope ${s.slope.toFixed(1)}° near the ${m.max_slope_deg}° limit`);
    if (s.bumps > m.max_relief_m) fails.push(`ground unevenness ${s.bumps.toFixed(2)} m > ${m.max_relief_m} m`);
    if (m.keepout && lander) {
      const d = Math.hypot(x - lander.x, z - lander.z);
      if (d < C.plume_keepout_m) fails.push(`${d.toFixed(0)} m from the lander (keep ${C.plume_keepout_m} m clear of the plume)`);
    }
    for (const p of placed) { if (Math.hypot(p.x - x, p.z - z) < MODS[p.id].radius_m + m.radius_m) { fails.push(`overlaps the ${MODS[p.id].name.toLowerCase()}`); break; } }
    return { ok: fails.length === 0, level: fails.length ? 2 : warns.length ? 1 : 0, fails, warns, s, name: m.name };
  }

  function makeGhost(id) {
    dropGhost();
    ghost = build(id); ghost.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; } });
    const r = MODS[id].radius_m;
    ring = new THREE.Mesh(new THREE.RingGeometry(r - .12, r, 48), ringMat); ring.rotation.x = -Math.PI / 2;
    root.add(ghost, ring); ghost.visible = ring.visible = false;
  }
  function dropGhost() { if (ghost) { root.remove(ghost, ring); ring.geometry.dispose(); ghost = ring = null; } }

  const COL = [0x40d080, 0xf0b040, 0xe04a3a];
  // modules face the lander; the solar array and comms mast keep their own sun / home pointing
  function yawAt(x, z, id = tool) { return id === "solar" || id === "comms" || !lander ? 0 : Math.atan2(lander.x - x, lander.z - z); }

  function hover(p) {
    if (!ghost || !p) { if (ghost) ghost.visible = ring.visible = false; return null; }
    const c = check(tool, p.x, p.z), y = terrain.heightAt(p.x, p.z);
    ghost.visible = ring.visible = true;
    ghost.position.set(p.x, y, p.z); ghost.rotation.y = yawAt(p.x, p.z);
    ring.position.set(p.x, y + .08, p.z);
    ringMat.color.setHex(COL[c.level]); ghostMat.color.setHex(COL[c.level]); ghostMat.emissive.setHex(COL[c.level]).multiplyScalar(.25);
    return c;
  }

  function place(p) {
    if (!tool || !p) return null;
    const c = check(tool, p.x, p.z);
    if (!c.ok) return c;
    const obj = build(tool), y = terrain.heightAt(p.x, p.z) - .05;
    obj.position.set(p.x, y, p.z); obj.rotation.y = yawAt(p.x, p.z); root.add(obj);
    placed.push({ id: tool, x: p.x, z: p.z, obj, check: c });
    return c;
  }

  function undo() { const p = placed.pop(); if (p) { root.remove(p.obj); disposeObj(p.obj); } return p; }
  function clear() { while (placed.length) undo(); }
  const disposeObj = o => o.traverse(m => m.geometry?.dispose?.());

  function status() {
    const counts = {}; placed.forEach(p => { counts[p.id] = (counts[p.id] || 0) + 1; });
    const needs = C.needs.map(id => ({ id, name: MODS[id].name, done: !!counts[id] }));
    const pct = Math.round(needs.filter(n => n.done).length / needs.length * 100);
    return { counts, needs, pct, total: placed.length };
  }

  return {
    modules: C.modules,
    setTool(id) { tool = id; if (id) makeGhost(id); else dropGhost(); },
    get tool() { return tool; },
    setLander(p) { lander = p; },
    hover, place, undo, clear, status, check,
    dispose() { clear(); dropGhost(); scene.remove(root); ringMat.dispose(); ghostMat.dispose(); },
    setSky(sun, home, berm) { sky.sun.copy(sun); sky.home = home ? home.clone() : null; if (berm != null) sky.berm = berm; },
  };
}
