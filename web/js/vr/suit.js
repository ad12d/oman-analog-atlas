// YOUR SPACE SUIT: an original pressurised suit model (white outer layers, gold visor, life-support backpack,
// chest controls, gloves, boots), the facts behind each part for the "Suit up" chapter, and the wearer's own body:
//   - screen: first person shows your torso, arms and boots when you look down; third person shows the whole suit
//   - headset: suited gloves ride on the controllers and your torso and legs sit under your head
// Facts are from NASA's spacesuit material (EMU / Artemis suits).
import * as THREE from "three";

export const SUIT_PARTS = [
  { id: "helmet", name: "Helmet and gold visor", pos: [0, 1.74, .18],
    text: "A clear pressure bubble with a visor coated in a thin layer of real gold. Gold reflects the Sun's glare, heat and ultraviolet light, yet is thin enough to see through. Lights and a camera sit on the sides." },
  { id: "backpack", name: "Life-support backpack", pos: [0, 1.32, -.42],
    text: "A small spacecraft on your back: it supplies oxygen, removes the carbon dioxide you breathe out, keeps the suit pressurised and pumps cool water through tubes in your undergarment. A spacewalk lasts up to about 8 hours." },
  { id: "controls", name: "Chest controls", pos: [0, 1.28, .3],
    text: "Switches and gauges for oxygen, cooling and radio. The labels are printed backwards so you can read them in a small mirror on your wrist, because the helmet stops you looking straight down at your chest." },
  { id: "layers", name: "Pressure suit and layers", pos: [.26, 1.1, .2],
    text: "About 14 layers: a cooling garment, an airtight pressure bladder and many thin insulating and tear-resistant layers outside. The suit holds about 0.3 atmospheres of pure oxygen, low enough that the joints can still bend." },
  { id: "gloves", name: "Gloves", pos: [-.5, 1.0, .12],
    text: "The hardest part of a suit to design. A pressurised glove pushes back against every finger movement, so tired hands often end a spacewalk. Heaters keep the fingertips warm when you work in shadow." },
  { id: "boots", name: "Boots", pos: [.13, .1, .16],
    text: "Stiff soles grip loose dust and rock. Moon dust is sharp like broken glass and wears through fabric and seals; on Mars, fine dust gets into every joint. Keeping dust out of the base is a daily job." },
];

const V = (x, y, z) => new THREE.Vector3(x, y, z);
let MAT = null;
function mats() {
  if (MAT) return MAT;
  MAT = {
    white: new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: .82 }),
    soft: new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: .9 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x8d939b, roughness: .6, metalness: .2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: .7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: .3, metalness: .9 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc23b2a, roughness: .7 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x2e63b8, roughness: .5 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd8a23a, roughness: .12, metalness: 1, envMapIntensity: 1.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .05, transmission: .9, transparent: true, opacity: .28, thickness: .01 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff6dd }),
    led: new THREE.MeshBasicMaterial({ color: 0x46c37a }),
  };
  return MAT;
}
function part(geo, mat, x, y, z, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

/** one glove: cuff ring, padded palm, four fingers and a thumb; points down -Y with the palm facing +Z */
function buildGlove(side = 1) {
  const M = mats(), g = new THREE.Group();
  part(new THREE.CylinderGeometry(.052, .056, .05, 18), M.metal, 0, .03, 0, g);                  // wrist bearing
  part(new THREE.TorusGeometry(.052, .008, 6, 20), M.blue, 0, .055, 0, g).rotation.x = Math.PI / 2;
  part(new THREE.CylinderGeometry(.06, .05, .07, 14), M.dark, 0, -.02, 0, g);                    // gauntlet
  const palm = part(new THREE.BoxGeometry(.085, .09, .04), M.grey, 0, -.1, 0, g); palm.geometry.translate(0, 0, 0);
  for (let k = 0; k < 4; k++) part(new THREE.CapsuleGeometry(.0115, .055, 3, 6), M.grey, -.03 + k * .02, -.18, .004, g);
  const th = part(new THREE.CapsuleGeometry(.012, .045, 3, 6), M.grey, side * .05, -.12, .015, g); th.rotation.z = side * .7;
  return g;
}

/** the full suit, standing at the origin and facing +Z; userData.head / arms / legs for posing and hiding */
export function buildSuit({ tint = "commander" } = {}) {
  const M = mats(), g = new THREE.Group();
  // torso: hard upper torso with a softer waist below
  const torso = new THREE.Group(); g.add(torso);
  part(new THREE.CapsuleGeometry(.26, .32, 8, 18), M.white, 0, 1.3, 0, torso).scale.set(1, 1, .82);
  part(new THREE.CylinderGeometry(.22, .24, .26, 18), M.soft, 0, .98, 0, torso);
  part(new THREE.TorusGeometry(.235, .03, 8, 24), M.metal, 0, 1.1, 0, torso).rotation.x = Math.PI / 2;   // waist bearing
  // chest controls (the display and control module)
  const dcm = new THREE.Group(); dcm.position.set(0, 1.27, .23); torso.add(dcm);
  part(new THREE.BoxGeometry(.26, .14, .08), M.grey, 0, 0, 0, dcm);
  for (const [x, c] of [[-.08, M.red], [0, M.blue], [.08, M.metal]]) part(new THREE.CylinderGeometry(.018, .018, .03, 12), c, x, .02, .05, dcm).rotation.x = Math.PI / 2;
  part(new THREE.BoxGeometry(.1, .03, .01), M.led, 0, -.035, .045, dcm);
  // life-support backpack with vents and an antenna
  const pack = new THREE.Group(); pack.position.set(0, 1.3, -.32); torso.add(pack);
  part(new THREE.BoxGeometry(.5, .62, .24), M.white, 0, 0, 0, pack);
  part(new THREE.BoxGeometry(.44, .14, .02), M.dark, 0, -.18, -.125, pack);
  for (let k = 0; k < 5; k++) part(new THREE.BoxGeometry(.36, .012, .015), M.grey, 0, .02 + k * .045, -.124, pack);
  part(new THREE.CylinderGeometry(.006, .006, .3, 6), M.metal, .2, .42, 0, pack);
  // mission patch on the shoulder
  part(new THREE.CylinderGeometry(.045, .045, .008, 20), M.gold, .24, 1.45, .05, torso).rotation.z = Math.PI / 2;
  // helmet: neck ring, bubble, gold visor, lights and camera
  const head = new THREE.Group(); head.position.set(0, 1.62, 0); g.add(head);
  part(new THREE.TorusGeometry(.17, .028, 8, 24), M.metal, 0, 0, 0, head).rotation.x = Math.PI / 2;
  part(new THREE.SphereGeometry(.2, 24, 16), M.glass, 0, .14, .02, head);
  part(new THREE.SphereGeometry(.17, 16, 12), M.dark, 0, .13, -.02, head);                          // comm cap inside
  const visor = part(new THREE.SphereGeometry(.205, 28, 16, -Math.PI * .42, Math.PI * .84, Math.PI * .22, Math.PI * .42), M.gold, 0, .14, .025, head);
  visor.rotation.y = 0;
  for (const s of [-1, 1]) { part(new THREE.BoxGeometry(.05, .05, .07), M.white, s * .2, .18, 0, head); part(new THREE.CircleGeometry(.017, 12), M.lamp, s * .2, .18, .036, head); }
  // arms: shoulder bearing, upper arm, elbow, forearm, stripe, glove
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * .33, 1.46, 0); g.add(sh);
    part(new THREE.SphereGeometry(.1, 14, 10), M.white, 0, 0, 0, sh);
    part(new THREE.CapsuleGeometry(.075, .2, 4, 12), M.white, 0, -.18, 0, sh);
    part(new THREE.TorusGeometry(.08, .014, 6, 16), M.metal, 0, -.33, 0, sh).rotation.x = Math.PI / 2;
    part(new THREE.CapsuleGeometry(.068, .2, 4, 12), M.white, 0, -.47, 0, sh);
    if (tint === "commander") part(new THREE.TorusGeometry(.072, .012, 6, 16), M.red, 0, -.4, 0, sh).rotation.x = Math.PI / 2;
    const glove = buildGlove(s); glove.position.set(0, -.6, 0); sh.add(glove);
    sh.rotation.z = s * .12; arms.push(sh);
  }
  // legs: hip, thigh, knee, shin, stripe, boot
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * .12, .9, 0); g.add(hip);
    part(new THREE.CapsuleGeometry(.1, .3, 4, 12), M.white, 0, -.22, 0, hip);
    part(new THREE.TorusGeometry(.095, .014, 6, 16), M.metal, 0, -.42, 0, hip).rotation.x = Math.PI / 2;
    part(new THREE.CapsuleGeometry(.088, .28, 4, 12), M.white, 0, -.6, 0, hip);
    if (tint === "commander") part(new THREE.TorusGeometry(.09, .013, 6, 16), M.red, 0, -.52, 0, hip).rotation.x = Math.PI / 2;
    const boot = new THREE.Group(); boot.position.set(0, -.84, .03); hip.add(boot);
    part(new THREE.BoxGeometry(.15, .1, .28), M.soft, 0, 0, .02, boot);
    part(new THREE.BoxGeometry(.16, .035, .3), M.dark, 0, -.055, .02, boot);
    legs.push(hip);
  }
  g.userData = { head, arms, legs, torso, pack, dcm };
  return g;
}

/** small floating markers for the "Suit up" chapter; each has userData.part for ray picking */
export function partMarkers(suit) {
  const g = new THREE.Group(), out = [];
  for (const p of SUIT_PARTS) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(.045, 14, 10), new THREE.MeshBasicMaterial({ color: 0xf2c46d, transparent: true, opacity: .9, depthTest: false, fog: false }));
    m.renderOrder = 10; m.position.set(...p.pos); m.userData.part = p.id; g.add(m); out.push(m);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.06, .072, 24), new THREE.MeshBasicMaterial({ color: 0xf2c46d, transparent: true, opacity: .6, side: THREE.DoubleSide, depthTest: false, fog: false }));
    ring.renderOrder = 10; m.add(ring);
  }
  suit.add(g);
  return { group: g, markers: out };
}

/**
 * The wearer's body. mode "first": torso, arms and boots under the eyes (helmet hidden);
 * "third": the whole suit, seen from behind. In the headset the arms are replaced by gloves on the controllers.
 */
export function createBody(scene, renderer, camera) {
  const suit = buildSuit(); suit.visible = false; scene.add(suit);
  const gloves = [], _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ");
  for (let i = 0; i < 2; i++) {
    const grip = renderer.xr.getControllerGrip(i), gl = buildGlove(i ? 1 : -1);
    gl.rotation.x = -Math.PI / 2; gl.position.set(0, -.01, .07);          // the cuff around the wrist, fingers along the controller
    gl.visible = false; grip.add(gl); gloves.push(gl);
  }
  let mode = "off", yaw = 0;
  function setMode(m) {
    mode = m; suit.visible = m !== "off";
    suit.userData.head.visible = m === "third";
  }
  function update(rig, xr) {
    if (mode === "off") { gloves.forEach(g => g.visible = false); return; }
    camera.getWorldPosition(_p); camera.getWorldQuaternion(_q); _e.setFromQuaternion(_q);
    // the body turns with the head, a little lazily, as a real body does
    const d = ((_e.y - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI; yaw += d * (Math.abs(d) > .9 ? .2 : .05);
    if (mode === "third" && !xr) { suit.position.set(rig.position.x, rig.position.y, rig.position.z); suit.rotation.set(0, rig.rotation.y + Math.PI, 0); }
    else {
      // eyes sit just in front of the helmet centre: shift the body back so the torso shows when you look down
      const back = .2, fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      suit.position.set(_p.x + fwd.x * back, _p.y - 1.74, _p.z + fwd.z * back); suit.rotation.set(0, yaw + Math.PI, 0);
    }
    suit.userData.arms.forEach(a => a.visible = !xr);
    gloves.forEach(g => g.visible = xr);
    // walking: a gentle leg swing when the body moves
    const sp = suit.userData.speed || 0, t = performance.now() / 1000;
    suit.userData.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 6 + i * Math.PI) * .35 * Math.min(1, sp); });
  }
  return { suit, gloves, setMode, update, get mode() { return mode; },
    dispose() { scene.remove(suit); gloves.forEach(g => g.parent?.remove(g)); } };
}
