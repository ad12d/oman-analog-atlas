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
  const BONES = [["wrist", "thumb-metacarpal"], ["thumb-metacarpal", "thumb-phalanx-proximal"], ["thumb-phalanx-proximal", "thumb-phalanx-distal"], ["thumb-phalanx-distal", "thumb-tip"]];
  for (const f of ["index-finger", "middle-finger", "ring-finger", "pinky-finger"]) {
    BONES.push([`${f}-metacarpal`, `${f}-phalanx-proximal`], [`${f}-phalanx-proximal`, `${f}-phalanx-intermediate`], [`${f}-phalanx-intermediate`, `${f}-phalanx-distal`], [`${f}-phalanx-distal`, `${f}-tip`]);
    BONES.push(["wrist", `${f}-metacarpal`]);
  }
  const unitCap = new THREE.CapsuleGeometry(1, 1, 3, 8);       // scaled per bone
  const a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  const btn = (gp, k) => gp?.buttons?.[k] || { value: 0, touched: false, pressed: false };

  function update(visible) {
    for (const st of sides) {
      const joints = st.hand.joints, tracked = visible && st.handOn && joints && joints["index-finger-tip"];
      st.holder.visible = visible && !tracked;
      st.segs.visible = !!tracked;
      if (tracked) {
        if (!st.bones) { st.bones = BONES.map(([j0]) => { const m = new THREE.Mesh(unitCap, j0 === "wrist" ? M.palm : M.glove); st.segs.add(m); return m; }); }
        BONES.forEach(([j0, j1], k) => {
          const A = joints[j0], B = joints[j1], m = st.bones[k];
          if (!A || !B || !A.visible || !B.visible) { m.visible = false; return; }
          a.copy(A.position); b.copy(B.position); mid.addVectors(a, b).multiplyScalar(.5);
          const len = a.distanceTo(b), r = Math.max(.007, (A.jointRadius || .009) * (j0 === "wrist" ? .9 : 1.15));
          m.visible = true; m.position.copy(mid); q.setFromUnitVectors(Y, b.sub(a).normalize()); m.quaternion.copy(q);
          m.scale.set(r, Math.max(.001, len / 2 - r * .5), r);
        });
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
