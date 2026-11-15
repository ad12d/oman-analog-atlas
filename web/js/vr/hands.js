// SUITED HANDS in the headset.
//  1. Controllers in your hands: a jointed glove sits on each controller grip; its fingers bend with your real
//     buttons (trigger → index finger, grip → middle, ring and little finger, thumbstick or A/B touch → thumb).
//  2. Controllers put down (Quest hand tracking): every tracked finger joint gets a glove segment, so the
//     gloves follow your real fingers exactly.
// Grip space (WebXR): origin in the centre of the closed fist, -Z along the fist from the little finger toward the
// thumb, +X out of the back of the right hand. The glove model (a left hand: fingers -Z, palm -Y, thumb +X) is
// turned into that frame with an explicit basis below; the right hand is its mirror image.
import * as THREE from "three";

// where each glove axis goes in grip space: fingers forward (-Y), thumb side along the fist (-Z), back of hand outward
const BASIS = {
  right: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],    // used with the mirrored model
  left: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
};
const HANDLE = new THREE.Vector3(0, .035, .065);                  // puts the controller handle under the palm

const M = {
  glove: new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: .62, metalness: .15 }),
  palm: new THREE.MeshStandardMaterial({ color: 0x5d636c, roughness: .8 }),
  cuff: new THREE.MeshStandardMaterial({ color: 0xc6cbd2, roughness: .3, metalness: .85 }),
  ring: new THREE.MeshStandardMaterial({ color: 0x2e63b8, roughness: .5 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: .82 }),
};
const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

/**
 * A glove built in its own "hand frame": wrist at the origin, fingers along -Z, palm facing -Y, thumb on +X
 * (a right hand; the left hand is mirrored). Each finger is a chain of three joints that curl around +X.
 */
function buildJointedGlove() {
  const g = new THREE.Group();
  // sleeve, wrist bearing and blue ring
  const sleeve = add(g, new THREE.CylinderGeometry(.05, .055, .12, 18), M.white, 0, 0, .1); sleeve.rotation.x = Math.PI / 2;
  const cuff = add(g, new THREE.CylinderGeometry(.052, .052, .025, 18), M.cuff, 0, 0, .035); cuff.rotation.x = Math.PI / 2;
  const ring = add(g, new THREE.TorusGeometry(.052, .007, 6, 20), M.ring, 0, 0, .05); ring.rotation.x = 0;
  // padded back of the hand and palm
  add(g, new THREE.BoxGeometry(.088, .032, .095), M.glove, 0, .004, -.045);
  add(g, new THREE.BoxGeometry(.08, .012, .085), M.palm, 0, -.016, -.045);
  const fingers = [];
  const L = [[.026, .022, .02], [.03, .025, .021], [.028, .023, .02], [.022, .019, .017]];   // index, middle, ring, little
  for (let f = 0; f < 4; f++) {
    let parent = new THREE.Group(); parent.position.set(.03 - f * .02, 0, -.095); g.add(parent);
    const chain = [];
    for (let s = 0; s < 3; s++) {
      const j = new THREE.Group(); if (s) j.position.z = -L[f][s - 1]; parent.add(j);
      const seg = add(j, new THREE.CapsuleGeometry(.0105 - s * .0012, L[f][s] - .012, 3, 8), M.glove, 0, 0, -L[f][s] / 2); seg.rotation.x = Math.PI / 2;
      chain.push(j); parent = j;
    }
    fingers.push(chain);
  }
  // thumb: leaves the palm toward +X and forward, curls toward the palm
  const tb = new THREE.Group(); tb.position.set(.042, -.006, -.025); tb.rotation.set(0, -.7, -.35); g.add(tb);
  const thumb = []; let tp = tb;
  for (let s = 0; s < 2; s++) {
    const j = new THREE.Group(); if (s) j.position.z = -.03; tp.add(j);
    const seg = add(j, new THREE.CapsuleGeometry(.0115, .02, 3, 8), M.glove, 0, 0, -.015); seg.rotation.x = Math.PI / 2;
    thumb.push(j); tp = j;
  }
  g.userData = { fingers, thumb };
  return g;
}
/** curl 0..1 per finger: index, middle, ring, little; thumb 0..1 */
function pose(glove, curl, thumbCurl) {
  const { fingers, thumb } = glove.userData;
  fingers.forEach((chain, f) => chain.forEach((j, s) => { j.rotation.x = -curl[f] * [1.25, 1.45, 1.1][s]; }));
  thumb.forEach((j, s) => { j.rotation.x = -thumbCurl * [.5, .9][s]; j.rotation.y = thumbCurl * .25; });
}

export function createHands(renderer) {
  const sides = [];
  for (let i = 0; i < 2; i++) {
    const grip = renderer.xr.getControllerGrip(i), ctrl = renderer.xr.getController(i), hand = renderer.xr.getHand(i);
    // controller glove: hand frame → grip frame
    const holder = new THREE.Group(), glove = buildJointedGlove(); holder.add(glove); holder.visible = false; grip.add(holder);
    const st = { holder, glove, gamepad: null, right: true, curl: [0, 0, 0, 0], thumb: 0, hand, joints: null, handOn: false };
    const frame = () => {
      const [bx, by, bz] = BASIS[st.right ? "right" : "left"];
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, by, bz));
      glove.scale.x = st.right ? -1 : 1;                                // the model is a left hand; mirror it for the right
      glove.position.copy(HANDLE);
    };
    ctrl.addEventListener("connected", e => { st.gamepad = e.data.gamepad || null; st.right = e.data.handedness !== "left"; st.handOn = !!e.data.hand; frame(); });
    ctrl.addEventListener("disconnected", () => { st.gamepad = null; st.handOn = false; });
    frame();
    // tracked-hand glove: one segment per finger bone, built when the hand appears
    const segs = new THREE.Group(); hand.add(segs);
    st.segs = segs;
    sides.push(st);
  }
  // tracked-hand suit glove: rounded finger segments with knuckle joints, a solid padded palm, rubber fingertips, a cuff
  const FINGERS = ["index-finger", "middle-finger", "ring-finger", "pinky-finger"];
  const CHAINS = [["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
    ...FINGERS.map(f => [`${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`])];
  const MAT = {
    fabric: new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: .78 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x6d737c, roughness: .9 }),
    tip: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: .95 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc6cbd2, roughness: .28, metalness: .9 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x2e63b8, roughness: .45 }),
  };
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), SPH = new THREE.SphereGeometry(1, 16, 12);
  const PALM = new THREE.BoxGeometry(1, 1, 1, 2, 1, 2); { const pos = PALM.attributes.position;           // soften the box into a padded pillow
    for (let k = 0; k < pos.count; k++) { const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k); pos.setY(k, y * (1 - .35 * (x * x * 4 + z * z * 4) / 2)); } PALM.computeVertexNormals(); }
  const CUFF = new THREE.CylinderGeometry(1, 1.12, 1, 20, 1, false), RING = new THREE.TorusGeometry(1, .14, 8, 24);
  const mk = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };
  function buildTracked(st) {
    const g = st.segs, parts = { chains: [], palm: null, back: null, cuff: null, ring: null, band: null };
    for (const ch of CHAINS) {
      const links = [];
      for (let k = 0; k < ch.length - 1; k++) links.push({ cyl: mk(CYL, MAT.fabric, g), knuckle: mk(SPH, k === 0 ? MAT.pad : MAT.fabric, g) });
      links.tip = mk(SPH, MAT.tip, g); parts.chains.push(links);
    }
    parts.palm = mk(PALM, MAT.pad, g); parts.back = mk(PALM, MAT.fabric, g);
    parts.cuff = mk(CUFF, MAT.fabric, g); parts.ring = mk(RING, MAT.metal, g); parts.band = mk(RING, MAT.blue, g);
    st.parts = parts;
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const fx = new THREE.Vector3(), fy = new THREE.Vector3(), fz = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const jp = (J, n) => J[n] && J[n].visible ? J[n].position : null;
  function segment(mesh, p0, p1, r) {          // a cylinder from p0 to p1
    d.subVectors(p1, p0); const len = d.length(); if (len < 1e-4) { mesh.visible = false; return; }
    mesh.visible = true; mesh.position.addVectors(p0, p1).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(Y, d.normalize()); mesh.scale.set(r, len, r);
  }
  function ball(mesh, p, r) { if (!p) { mesh.visible = false; return; } mesh.visible = true; mesh.position.copy(p); mesh.scale.setScalar(r); }
  function updateTracked(st) {
    const J = st.hand.joints, P = st.parts, R = n => (J[n]?.jointRadius || .009);
    CHAINS.forEach((ch, c) => {
      const links = P.chains[c];
      for (let k = 0; k < ch.length - 1; k++) {
        const p0 = jp(J, ch[k]), p1 = jp(J, ch[k + 1]), r = Math.max(.0075, R(ch[k]) * 1.18);
        if (!p0 || !p1) { links[k].cyl.visible = links[k].knuckle.visible = false; continue; }
        segment(links[k].cyl, p0, p1, r); ball(links[k].knuckle, p0, r * (k === 0 ? 1.18 : 1.08));
      }
      ball(links.tip, jp(J, ch[ch.length - 1]), Math.max(.0075, R(ch[ch.length - 2]) * 1.15));
    });
    // palm: a padded block spanning the wrist and the knuckles, oriented by the hand's own frame
    const w = jp(J, "wrist"), ip = jp(J, "index-finger-phalanx-proximal"), mp = jp(J, "middle-finger-phalanx-proximal"), pp = jp(J, "pinky-finger-phalanx-proximal");
    if (!w || !ip || !mp || !pp) { P.palm.visible = P.back.visible = P.cuff.visible = P.ring.visible = P.band.visible = false; return; }
    fz.subVectors(w, mp); const len = fz.length(); fz.normalize();                 // +z toward the wrist
    fx.subVectors(ip, pp); const wid = fx.length(); fx.addScaledVector(fz, -fx.dot(fz)).normalize();
    fy.crossVectors(fz, fx).normalize();                                            // palm normal (sign depends on hand)
    if (!st.right) fy.negate();
    m4.makeBasis(fx, fy, fz); q.setFromRotationMatrix(m4);
    a.addVectors(w, mp).multiplyScalar(.5).lerp(b.addVectors(ip, pp).multiplyScalar(.5), .25);
    const th = .028;
    P.back.visible = P.palm.visible = true;
    P.back.position.copy(a).addScaledVector(fy, th * .2); P.back.quaternion.copy(q); P.back.scale.set(wid * 1.25, th, len * 1.02);
    P.palm.position.copy(a).addScaledVector(fy, -th * .45); P.palm.quaternion.copy(q); P.palm.scale.set(wid * 1.12, th * .55, len * .92);
    // gauntlet cuff behind the wrist, with the metal bearing and the blue identification band
    const cr = wid * .62, cuffLen = .085;
    P.cuff.visible = P.ring.visible = P.band.visible = true;
    q.setFromUnitVectors(Y, fz);
    P.cuff.position.copy(w).addScaledVector(fz, cuffLen * .55); P.cuff.quaternion.copy(q); P.cuff.scale.set(cr, cuffLen, cr * .82);
    const rq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fz);
    P.ring.position.copy(w).addScaledVector(fz, .006); P.ring.quaternion.copy(rq); P.ring.scale.set(cr * 1.02, cr * .84, cr);
    P.band.position.copy(w).addScaledVector(fz, .03); P.band.quaternion.copy(rq); P.band.scale.set(cr * 1.03, cr * .86, cr * .6);
  }

  const btn = (gp, k) => gp?.buttons?.[k] || { value: 0, touched: false, pressed: false };

  function update(visible) {
    for (const st of sides) {
      const joints = st.hand.joints, tracked = visible && st.handOn && joints && joints["index-finger-tip"];
      st.holder.visible = visible && !tracked;
      st.segs.visible = !!tracked;
      if (tracked) {
        if (!st.parts) buildTracked(st);
        updateTracked(st);
        continue;
      }
      // controller glove: fingers follow the buttons, eased so they move like fingers rather than snap
      const gp = st.gamepad, trig = btn(gp, 0), squeeze = btn(gp, 1), stick = btn(gp, 3), a4 = btn(gp, 4), b5 = btn(gp, 5);
      const want = [Math.max(trig.value, trig.touched ? .25 : 0), squeeze.value, squeeze.value, squeeze.value];
      const wantT = stick.touched || a4.touched || b5.touched || stick.pressed || a4.pressed || b5.pressed ? .75 : .1;
      for (let f = 0; f < 4; f++) st.curl[f] += (Math.max(.15, want[f]) - st.curl[f]) * .35;
      st.thumb += (wantT - st.thumb) * .35;
      pose(st.glove, st.curl, st.thumb);
    }
  }
  return { update, sides };
}
