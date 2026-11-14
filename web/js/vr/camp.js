// Camp builder: module models, the placement ghost, and rule checks against the terrain.
// Rules and the module catalogue come from data/vr/rules.json (engine-neutral).
import * as THREE from "three";

function mats() {
  return {
    fabric: new THREE.MeshStandardMaterial({ color: 0xece8de, roughness: .8 }),
    white: new THREE.MeshStandardMaterial({ color: 0xdedbd3, roughness: .5, metalness: .1 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: .35, metalness: .85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: .5, metalness: .5 }),
    cell: new THREE.MeshStandardMaterial({ color: 0x1b2a55, roughness: .25, metalness: .6, emissive: 0x060b18 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd2a643, roughness: .35, metalness: .85 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xe0612a, roughness: .5 }),
    lampG: new THREE.MeshBasicMaterial({ color: 0x40ff90 }),
  };
}

function build(id, M) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  if (id === "habitat") {
    const d = add(new THREE.SphereGeometry(4.1, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), M.fabric, 0, .35, 0); d.scale.y = .72;
    add(new THREE.CylinderGeometry(4.25, 4.35, .4, 40), M.white, 0, .2, 0);
    for (let k = 1; k <= 3; k++) { const r = add(new THREE.TorusGeometry(4.1 * Math.cos(k * .38), .06, 6, 48), M.white, 0, .35 + 2.95 * Math.sin(k * .38), 0); r.rotation.x = Math.PI / 2; }
    add(new THREE.BoxGeometry(1.8, 2.1, 2.2), M.white, 0, 1.05, 4.6);
    add(new THREE.BoxGeometry(.9, 1.7, .05), M.dark, 0, .95, 5.72);
    add(new THREE.SphereGeometry(.08, 8, 6), M.lampG, .6, 2.0, 5.72).castShadow = false;
  } else if (id === "solar") {
    add(new THREE.CylinderGeometry(.12, .16, 2.4, 10), M.steel, 0, 1.2, 0);
    const arm = new THREE.Group(); arm.position.y = 2.4; arm.rotation.x = -.85; g.add(arm);
    for (const x of [-1.6, 1.6]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(3.0, .06, 2.4), M.cell); p.position.x = x; p.castShadow = p.receiveShadow = true; arm.add(p);
      const f = new THREE.Mesh(new THREE.BoxGeometry(3.1, .04, 2.5), M.steel); f.position.set(x, -.04, 0); arm.add(f);
    }
    add(new THREE.BoxGeometry(.7, .5, .5), M.white, 0, .25, .6);
  } else if (id === "comms") {
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3, l = add(new THREE.CylinderGeometry(.05, .05, 2.2, 6), M.steel, Math.cos(a) * .6, 1.0, Math.sin(a) * .6); l.rotation.set(Math.sin(a) * .28, 0, -Math.cos(a) * .28); }
    add(new THREE.CylinderGeometry(.07, .09, 5.5, 8), M.steel, 0, 2.75, 0);
    const dish = add(new THREE.SphereGeometry(1.0, 24, 10, 0, Math.PI * 2, 0, Math.PI / 3.2), M.white, 0, 4.6, .35); dish.rotation.x = -Math.PI * .62;
    add(new THREE.CylinderGeometry(.02, .02, .9, 4), M.steel, 0, 4.75, .85).rotation.x = Math.PI / 2.6;
    add(new THREE.SphereGeometry(.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4030 }), 0, 5.55, 0).castShadow = false;
  } else if (id === "rover") {
    add(new THREE.BoxGeometry(3.0, .5, 1.8), M.white, 0, .95, 0);
    add(new THREE.BoxGeometry(1.2, .45, 1.5), M.gold, -.6, 1.4, 0);
    for (const x of [-1.15, 0, 1.15]) for (const z of [-1.05, 1.05]) { const w = add(new THREE.CylinderGeometry(.42, .42, .32, 18), M.dark, x, .42, z); w.rotation.x = Math.PI / 2; }
    add(new THREE.CylinderGeometry(.05, .05, 1.1, 6), M.steel, 1.1, 1.75, 0);
    add(new THREE.BoxGeometry(.35, .22, .3), M.dark, 1.1, 2.35, 0);
    const p = add(new THREE.BoxGeometry(1.6, .04, 1.2), M.cell, -.2, 1.68, 0); p.rotation.z = .1;
  } else {   // path marker
    add(new THREE.ConeGeometry(.28, .9, 12), M.orange, 0, .45, 0);
    add(new THREE.CylinderGeometry(.2, .2, .1, 12), M.white, 0, .5, 0);
  }
  return g;
}

export function createCamp(scene, terrain, rules) {
  const M = mats(), C = rules.camp, MODS = Object.fromEntries(C.modules.map(m => [m.id, m]));
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
    ghost = build(id, M); ghost.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; } });
    const r = MODS[id].radius_m;
    ring = new THREE.Mesh(new THREE.RingGeometry(r - .12, r, 48), ringMat); ring.rotation.x = -Math.PI / 2;
    root.add(ghost, ring); ghost.visible = ring.visible = false;
  }
  function dropGhost() { if (ghost) { root.remove(ghost, ring); ring.geometry.dispose(); ghost = ring = null; } }

  const COL = [0x40d080, 0xf0b040, 0xe04a3a];
  function yawAt(x, z) { return lander ? Math.atan2(lander.x - x, lander.z - z) : 0; }

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
    const obj = build(tool, M), y = terrain.heightAt(p.x, p.z) - .05;
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
    dispose() { clear(); dropGhost(); scene.remove(root); ringMat.dispose(); ghostMat.dispose(); Object.values(M).forEach(m => m.dispose()); },
  };
}
