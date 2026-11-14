// Procedural models for the VR base (original designs, no stock assets). Each builder returns a THREE.Group;
// moving parts are exposed on group.userData so the construction sequence can animate them.
import * as THREE from "three";
import { vrMaterials, strut } from "./materials.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function adder(g) {
  return (geo, mat, x = 0, y = 0, z = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
}
const lamp = (add, mat, x, y, z, r = .07) => { const o = add(new THREE.SphereGeometry(r, 8, 6), mat, x, y, z); o.castShadow = false; return o; };

/* ------------------------------------------------------------------ crewed lander
   Two stages: a foil-wrapped descent stage with four tanks and a deep-throttling main engine, plus four
   high-mounted thrusters used for the last metres (they fire from higher up, so they scour less regolith),
   and a crew cabin with a porch, ladder, docking port, folding solar wings and a high-gain dish.
   Footpads rest at y = 0, on a 3.2 m radius at 45° (matches lander.js). */
export const FOOT_R = 3.2;
export const PADS = [0, 1, 2, 3].map(k => { const a = Math.PI / 4 + k * Math.PI / 2; return V(Math.cos(a) * FOOT_R, 0, Math.sin(a) * FOOT_R); });

export function buildLander() {
  const g = new THREE.Group(), M = vrMaterials(), add = adder(g);
  // descent stage
  add(new THREE.CylinderGeometry(2.2, 2.2, 1.8, 8), M.foilGold, 0, 2.9, 0).rotation.y = Math.PI / 8;
  add(new THREE.CylinderGeometry(2.22, 1.95, .3, 8), M.foilSilver, 0, 1.88, 0).rotation.y = Math.PI / 8;
  add(new THREE.CylinderGeometry(2.26, 2.26, .12, 8), M.titanium, 0, 3.86, 0).rotation.y = Math.PI / 8;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, p = add(new THREE.BoxGeometry(1.25, 1.3, .05), M.black, Math.sin(a) * 2.05, 2.95, Math.cos(a) * 2.05); p.rotation.y = a;
    add(new THREE.SphereGeometry(.66, 22, 14), M.foilSilver, Math.sin(a) * 1.4, 1.85, Math.cos(a) * 1.4);
  }
  const bell = new THREE.LatheGeometry([[.32, 0], [.38, -.12], [.55, -.45], [.72, -.88], [.78, -1.0], [.76, -1.03]].map(([r, y]) => new THREE.Vector2(r, y)), 28);
  add(bell, M.nozzle, 0, 1.78, 0);
  for (let k = 0; k < 4; k++) {                                  // high-mounted terminal-descent thrusters
    const a = Math.PI / 4 + k * Math.PI / 2, x = Math.cos(a) * 2.35, z = Math.sin(a) * 2.35;
    add(new THREE.BoxGeometry(.5, .45, .5), M.titanium, x, 3.55, z);
    const b = add(new THREE.LatheGeometry([[.1, 0], [.14, -.1], [.22, -.42]].map(([r, y]) => new THREE.Vector2(r, y)), 14), M.nozzle, x, 3.32, z); b.rotation.set(Math.sin(a) * .25, 0, -Math.cos(a) * .25);
  }
  // crew cabin
  add(new THREE.CylinderGeometry(1.75, 1.9, 2.7, 16), M.paint, 0, 5.3, 0);
  add(new THREE.CylinderGeometry(1.92, 1.92, .12, 16), M.titanium, 0, 3.98, 0);
  add(new THREE.CylinderGeometry(1.78, 1.78, .1, 16), M.titanium, 0, 5.9, 0);
  add(new THREE.CylinderGeometry(.75, 1.75, .9, 16), M.paint, 0, 7.1, 0);
  add(new THREE.CylinderGeometry(.55, .6, .5, 16), M.titanium, 0, 7.8, 0);           // docking port
  add(new THREE.TorusGeometry(.55, .06, 8, 24), M.steel, 0, 8.05, 0).rotation.x = Math.PI / 2;
  for (const x of [-.55, 0, .55]) add(new THREE.BoxGeometry(.42, .5, .06), M.glass, x, 6.2, 1.72).rotation.x = -.05;
  add(new THREE.BoxGeometry(1.0, 1.5, .08), M.paintGrey, 0, 4.85, -1.84);              // hatch (-z)
  add(new THREE.BoxGeometry(1.8, .08, 1.3), M.titanium, 0, 4.0, -2.45);                 // porch
  for (const x of [-.85, .85]) g.add(strut(V(x, 4.0, -3.05), V(x, 4.9, -3.05), .03, M.steel));
  g.add(strut(V(-.85, 4.9, -3.05), V(.85, 4.9, -3.05), .03, M.steel));
  const L0 = V(-.32, 3.95, -3.05), L1 = V(-.32, .45, -3.35), R0 = V(.32, 3.95, -3.05), R1 = V(.32, .45, -3.35);
  g.add(strut(L0, L1, .03, M.steel), strut(R0, R1, .03, M.steel));
  for (let k = 1; k < 10; k++) { const t = k / 10; g.add(strut(L0.clone().lerp(L1, t), R0.clone().lerp(R1, t), .02, M.steel)); }
  for (const sx of [-1, 1]) { const r = add(new THREE.BoxGeometry(.06, 1.6, 1.3), M.paint, sx * .2, 5.4, 1.9); r.rotation.y = sx * .9; }   // radiators
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2;                                                          // RCS quads
    add(new THREE.BoxGeometry(.3, .3, .3), M.black, Math.sin(a) * 1.82, 6.55, Math.cos(a) * 1.82); }
  add(new THREE.CylinderGeometry(.05, .05, 1.4, 8), M.steel, -.9, 7.6, .6);
  const dish = add(new THREE.SphereGeometry(.6, 22, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), M.paint, -.9, 8.3, .6); dish.rotation.x = Math.PI * .7;
  // folding solar wings (deploy after touchdown)
  const wings = [];
  for (const sx of [-1, 1]) {
    const hinge = new THREE.Group(); hinge.position.set(sx * 1.78, 6.4, 0); g.add(hinge);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.6, .08, .08), M.titanium); arm.position.x = sx * .3; hinge.add(arm);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, .05, 1.5), M.cells); panel.position.x = sx * 2.3; panel.castShadow = true; hinge.add(panel);
    hinge.rotation.z = sx * 1.45; hinge.userData.sx = sx; wings.push(hinge);   // folded up against the cabin
  }
  // legs: primary strut + shock absorber, two secondaries, dish footpad
  const pad = new THREE.LatheGeometry([[0, .02], [.5, .02], [.57, .1], [.52, .17], [.12, .21]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
  for (const p of PADS) {
    const dir = p.clone().normalize(), tan = V(-dir.z, 0, dir.x);
    const foot = V(p.x, .42, p.z), top = dir.clone().multiplyScalar(1.7).setY(3.5), mid = top.clone().lerp(foot, .45);
    g.add(strut(top, mid, .14, M.titanium), strut(mid, foot, .085, M.steel));
    for (const s of [-1, 1]) g.add(strut(dir.clone().multiplyScalar(1.85).addScaledVector(tan, s * .85).setY(2.0), foot, .05, M.steel));
    add(pad, M.titanium, p.x, 0, p.z);
    add(new THREE.SphereGeometry(.11, 10, 8), M.steel, foot.x, foot.y, foot.z);
  }
  const lights = [lamp(add, M.lampR, 1.93, 6.4, .3), lamp(add, M.lampG, -1.93, 6.4, .3)];
  lamp(add, M.lampW, .6, 4.6, -1.9, .1); lamp(add, M.lampW, -.6, 4.6, -1.9, .1);
  g.userData = { wings, lights };
  return g;
}

/* ------------------------------------------------------------------ pressurised rover */
export function buildRover() {
  const g = new THREE.Group(), M = vrMaterials(), add = adder(g), wheels = [];
  add(new THREE.BoxGeometry(4.6, .32, 2.1), M.titanium, 0, 1.0, 0);
  add(new THREE.BoxGeometry(4.2, .16, 1.9), M.black, 0, .78, 0);
  // six wheels on trailing arms
  for (const x of [-1.6, 0, 1.6]) for (const z of [-1.3, 1.3]) {
    const hub = new THREE.Group(); hub.position.set(x, .58, z); g.add(hub);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(.58, .58, .42, 28), M.tyre); tyre.rotation.x = Math.PI / 2; tyre.castShadow = tyre.receiveShadow = true; hub.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .44, 14), M.steel); rim.rotation.x = Math.PI / 2; hub.add(rim);
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(.06, .5, .45), M.titanium); sp.rotation.z = k * Math.PI / 5; hub.add(sp); }
    g.add(strut(V(x + .5, .98, z * .72), V(x, .58, z * .9), .06, M.titanium));
    wheels.push(hub);
  }
  for (const z of [-1.3, 1.3]) add(new THREE.BoxGeometry(4.7, .07, .62), M.paintGrey, 0, 1.22, z);   // fenders
  // cabin: rounded hull, wrap-around windscreen, side windows, rear suit-ports
  // pressurised cab: side profile (rear wall, flat roof, raked windscreen, low nose) extruded across the width
  const prof = new THREE.Shape([[-2.05, 0], [1.75, 0], [2.25, .5], [1.75, 1.5], [-1.8, 1.62], [-2.05, 1.35]].map(([x, y]) => new THREE.Vector2(x, y)));
  const cabGeo = new THREE.ExtrudeGeometry(prof, { depth: 1.7, bevelEnabled: true, bevelThickness: .14, bevelSize: .14, bevelSegments: 4, curveSegments: 4 });
  cabGeo.translate(0, 0, -.85); add(cabGeo, M.paint, 0, 1.18, 0);
  const wsLen = Math.hypot(.5, 1.0), ws = add(new THREE.PlaneGeometry(wsLen * .92, 1.62), M.glass, 2.08, 1.18 + 1.0, 0);
  ws.rotation.set(0, Math.PI / 2, 0); ws.rotateX(-Math.atan2(.5, 1.0)); ws.position.x += .07;
  for (const z of [-1.0, 1.0]) for (const x of [.55, 1.25]) { const w = add(new THREE.PlaneGeometry(.55, .42), M.glass, x, 2.25, z * 1.0); w.rotation.y = z > 0 ? 0 : Math.PI; w.position.z += z * .005; }
  add(new THREE.BoxGeometry(4.1, .1, 1.94), M.foilGold, -.15, 1.24, 0);                     // insulated belly band
  for (const z of [-.45, .45]) { const t = add(new THREE.TorusGeometry(.36, .07, 8, 24), M.titanium, -2.2, 2.0, z); t.rotation.y = Math.PI / 2;   // suit-ports on the rear wall
    add(new THREE.CircleGeometry(.32, 20), M.paintGrey, -2.23, 2.0, z).rotation.y = -Math.PI / 2; }
  add(new THREE.BoxGeometry(2.4, .06, 1.6), M.cells, -.6, 2.95, 0);                          // roof array
  add(new THREE.BoxGeometry(.7, .4, .9), M.paintGrey, .9, 3.0, 0);                            // avionics pod
  add(new THREE.CylinderGeometry(.045, .045, 1.0, 6), M.steel, 1.2, 3.5, .6);                 // camera mast
  add(new THREE.BoxGeometry(.34, .22, .5), M.black, 1.2, 4.05, .6);
  add(new THREE.CylinderGeometry(.015, .015, 1.4, 4), M.steel, -1.6, 3.6, -.6);
  add(new THREE.BoxGeometry(.9, .5, .45), M.foilGold, -1.0, 1.42, 1.25); add(new THREE.BoxGeometry(.9, .5, .45), M.foilGold, -1.0, 1.42, -1.25);
  for (const z of [-.65, .65]) lamp(add, M.lampW, 2.33, 1.2, z, .09);
  g.userData = { wheels, wheelR: .58 };
  return g;
}

/* ------------------------------------------------------------------ construction robot (grades the ground) */
export function buildDozer() {
  const g = new THREE.Group(), M = vrMaterials(), add = adder(g);
  add(new THREE.BoxGeometry(2.2, .7, 1.4), M.paint, 0, .85, 0);
  add(new THREE.BoxGeometry(1.2, .45, 1.1), M.foilGold, -.3, 1.4, 0);
  for (const z of [-.8, .8]) add(new THREE.BoxGeometry(2.6, .55, .38), M.tyre, 0, .32, z);
  const blade = add(new THREE.BoxGeometry(.12, .6, 2.2), M.titanium, 1.55, .38, 0);
  g.add(strut(V(.9, .7, .5), V(1.5, .45, .5), .05, M.steel), strut(V(.9, .7, -.5), V(1.5, .45, -.5), .05, M.steel));
  add(new THREE.CylinderGeometry(.035, .035, .8, 6), M.steel, -.6, 2.0, .3); add(new THREE.BoxGeometry(.25, .15, .3), M.black, -.6, 2.45, .3);
  lamp(add, M.lampW, 1.12, 1.1, .45); lamp(add, M.lampW, 1.12, 1.1, -.45); lamp(add, M.orangeLamp || M.lampR, -.6, 2.62, .3, .06);
  g.userData = { blade };
  return g;
}

/* ------------------------------------------------------------------ astronaut (walk cycle via userData.limbs) */
export function buildAstronaut(tint = 0xf2f0ea) {
  const g = new THREE.Group(), M = vrMaterials(), add = adder(g);
  const suit = new THREE.MeshStandardMaterial({ color: tint, roughness: .75 });
  add(new THREE.CapsuleGeometry(.24, .5, 6, 12), suit, 0, 1.2, 0);
  add(new THREE.BoxGeometry(.42, .55, .25), M.paintGrey, 0, 1.28, -.26);
  add(new THREE.SphereGeometry(.2, 18, 12), suit, 0, 1.68, 0);
  const visor = add(new THREE.SphereGeometry(.17, 18, 12, -Math.PI / 2, Math.PI, Math.PI / 3, Math.PI / 2.6), M.foilGold, 0, 1.69, .04); visor.rotation.y = 0;
  const limb = (x, y, len, r) => { const piv = new THREE.Group(); piv.position.set(x, y, 0); g.add(piv); add(new THREE.CapsuleGeometry(r, len, 4, 10), suit, 0, -len / 2 - r, 0, piv); return piv; };
  const legs = [limb(-.12, .92, .5, .09), limb(.12, .92, .5, .09)], arms = [limb(-.32, 1.42, .38, .07), limb(.32, 1.42, .38, .07)];
  g.userData = { legs, arms };
  return g;
}

/* ------------------------------------------------------------------ base modules */
export function buildModule(id, sky = {}) {
  const g = new THREE.Group(), M = vrMaterials(), add = adder(g), parts = {};
  if (id === "habitat") {
    const shell = new THREE.Group(); g.add(shell); parts.shell = shell;
    add(new THREE.LatheGeometry([[3.9, .35], [4.05, .9], [4.0, 1.9], [3.55, 3.1], [2.6, 4.05], [1.2, 4.6], [0, 4.75]].map(([r, y]) => new THREE.Vector2(r, y)), 48), M.fabric, 0, 0, 0, shell);   // bottom-to-top: faces point outward
    for (const [r, y] of [[3.98, .95], [4.03, 1.9], [3.62, 3.0], [2.7, 3.95]]) { const t = add(new THREE.TorusGeometry(r, .05, 6, 64), M.strap, 0, y, 0, shell); t.rotation.x = Math.PI / 2; }
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2;
      const curve = new THREE.CatmullRomCurve3([[3.95, .4], [4.08, 1.6], [3.6, 3.1], [2.2, 4.25], [.9, 4.7]].map(([r, y]) => V(Math.cos(a) * r, y, Math.sin(a) * r)));
      add(new THREE.TubeGeometry(curve, 16, .035, 5), M.strap, 0, 0, 0, shell); }
    for (const a of [.5, 2.6, 4.2]) add(new THREE.CircleGeometry(.32, 20), M.glass, Math.cos(a) * 3.95, 2.3, Math.sin(a) * 3.95).lookAt(Math.cos(a) * 9, 2.3, Math.sin(a) * 9);
    const berm = new THREE.Mesh(new THREE.TorusGeometry(4.15, .55, 10, 48), new THREE.MeshStandardMaterial({ color: sky.berm ?? 0x7a6a58, roughness: 1 }));
    berm.rotation.x = Math.PI / 2; berm.scale.z = .6; berm.position.y = .15; berm.receiveShadow = berm.castShadow = true; g.add(berm); parts.berm = berm;
    const lock = new THREE.Group(); g.add(lock); parts.lock = lock;
    add(new THREE.CylinderGeometry(1.05, 1.05, 2.6, 24), M.paint, 0, 1.25, 4.9, lock).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(1.08, 1.08, .12, 24), M.titanium, 0, 1.25, 6.2, lock).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(.85, 1.5, .06), M.paintGrey, 0, 1.15, 6.27, lock);
    add(new THREE.BoxGeometry(1.4, .08, 1.6), M.titanium, 0, .1, 7.0, lock);
    const addL = (geo, mat, x, y, z) => add(geo, mat, x, y, z, lock);
    for (const x of [-.75, .75]) lamp(addL, M.lampG, x, 2.1, 6.2, .07);
    lamp(addL, M.lampW, 0, 2.35, 6.2, .1);
  } else if (id === "solar") {
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; g.add(strut(V(Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3), V(0, 1.4, 0), .05, M.titanium)); }
    add(new THREE.BoxGeometry(.7, .5, .7), M.paintGrey, 0, .3, 0);
    const mast = add(new THREE.CylinderGeometry(.1, .14, 7.5, 12), M.titanium, 0, 3.75, 0); parts.mast = mast;
    const head = new THREE.Group(); head.position.y = 5.0; g.add(head); parts.head = head;
    const sun = sky.sun || V(.5, .5, -.5).normalize(), az = Math.atan2(sun.x, sun.z), el = Math.asin(Math.min(1, Math.max(-1, sun.y)));
    head.rotation.y = az; const tilt = new THREE.Group(); tilt.rotation.x = -Math.max(0, el); head.add(tilt);   // faces the Sun
    parts.wings = [];
    for (const sx of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.x = sx * .12; tilt.add(hinge); hinge.userData.sx = sx; parts.wings.push(hinge);
      add(new THREE.BoxGeometry(2.4, 4.6, .05), M.cells, sx * 1.25, 0, .22, hinge);
      add(new THREE.BoxGeometry(2.5, 4.7, .03), M.titanium, sx * 1.25, 0, .18, hinge);
    }
    add(new THREE.BoxGeometry(.18, 4.8, .18), M.titanium, 0, 0, .1, tilt);
  } else if (id === "comms") {
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; g.add(strut(V(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0), V(0, 2.0, 0), .045, M.titanium)); }
    const mast = add(new THREE.CylinderGeometry(.08, .1, 5, 10), M.titanium, 0, 2.5, 0); parts.mast = mast;
    add(new THREE.BoxGeometry(.5, .6, .4), M.paint, 0, 1.0, 0);
    const mount = new THREE.Group(); mount.position.y = 5.1; g.add(mount); parts.mount = mount;
    const aim = (sky.home ? sky.home.clone() : V(.4, .7, -.6)).normalize();
    mount.userData.aim = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), aim); mount.quaternion.copy(mount.userData.aim);
    add(new THREE.SphereGeometry(1.0, 32, 10, 0, Math.PI * 2, 0, Math.PI / 3.4), M.paint, 0, 0, -.45, mount).rotation.x = -Math.PI / 2;
    add(new THREE.CylinderGeometry(.03, .03, 1.0, 6), M.steel, 0, 0, .1, mount).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(.07, 8, 6), M.black, 0, 0, .6, mount);
    lamp(add, M.lampR, 0, 5.6, 0, .09);
  } else if (id === "drill") {
    add(new THREE.BoxGeometry(3.2, .3, 2.4), M.titanium, 0, .15, 0);
    const top = V(0, 6.2, 0);
    for (const [x, z] of [[-1.3, -1.0], [1.3, -1.0], [0, 1.1]]) g.add(strut(V(x, .3, z), top, .07, M.paintGrey));
    const str = add(new THREE.CylinderGeometry(.09, .09, 6.4, 10), M.steel, 0, 3.1, 0); parts.string = str;
    add(new THREE.BoxGeometry(.6, .5, .6), M.orange, 0, 5.8, 0);
    add(new THREE.BoxGeometry(1.2, 1.1, 1.0), M.paint, -1.0, .85, .6);
    add(new THREE.CylinderGeometry(.35, .35, .5, 16), M.black, 0, .55, 0);
    lamp(add, M.lampW, 0, 6.35, 0, .1);
  } else {   // path marker beacon
    add(new THREE.CylinderGeometry(.03, .03, 1.4, 6), M.titanium, 0, .7, 0);
    add(new THREE.ConeGeometry(.22, .5, 12), M.orange, 0, .25, 0);
    lamp(add, M.lampW, 0, 1.45, 0, .07);
  }
  g.userData = parts;
  return g;
}
