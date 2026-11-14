// Input for the VR view.
//  Quest (WebXR): two controller rays. Trigger = select (teleport / pick / place, or press a wrist-menu
//  button). Right thumbstick left/right = snap turn 30°. Grip (squeeze) = bring the console in front of you.
//  Screen (desktop / phone): drag to look, tap or click = select, WASD / arrow keys walk.
import * as THREE from "three";

export function createControls({ renderer, camera, scene, dom, onSelect, onSqueeze = () => {} }) {
  const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
  camera.position.set(0, 1.65, 0);
  const ray = new THREE.Raycaster(); ray.far = 400;
  const hands = [];                                   // { ctrl, grip, line, hand, ray }
  let yaw = 0, pitch = -0.08, turnLatch = false;

  /* ---------- XR controllers ---------- */
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  for (let i = 0; i < 2; i++) {
    const ctrl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf2c46d, transparent: true, opacity: .8 }));
    line.scale.z = 6; line.visible = false; ctrl.add(line);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf2c46d })); ctrl.add(tip);
    const h = { ctrl, grip, line, hand: "", ray: new THREE.Raycaster() };
    ctrl.addEventListener("connected", e => { h.hand = e.data.handedness; h.gamepad = e.data.gamepad; line.visible = true; });
    ctrl.addEventListener("disconnected", () => { line.visible = false; h.hand = ""; });
    ctrl.addEventListener("select", () => onSelect(rayFrom(h), h.hand || "right"));
    ctrl.addEventListener("squeezestart", () => onSqueeze(h.hand));
    rig.add(ctrl, grip); hands.push(h);
  }
  const m4 = new THREE.Matrix4();
  function rayFrom(h) {
    m4.identity().extractRotation(h.ctrl.matrixWorld);
    h.ray.ray.origin.setFromMatrixPosition(h.ctrl.matrixWorld);
    h.ray.ray.direction.set(0, 0, -1).applyMatrix4(m4); h.ray.far = 400;
    return h.ray;
  }

  /* ---------- screen input ---------- */
  const ndc = new THREE.Vector2(), keys = new Set();
  let down = null, moved = 0, last = null;
  const toNdc = e => { const r = dom.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  const pd = e => { down = { x: e.clientX, y: e.clientY }; moved = 0; dom.setPointerCapture(e.pointerId); };
  const pm = e => {
    toNdc(e); last = e;
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y; moved += Math.abs(dx) + Math.abs(dy);
    yaw -= dx * .0042; pitch = Math.max(-1.3, Math.min(1.2, pitch - dy * .0042)); down = { x: e.clientX, y: e.clientY };
  };
  const pu = e => { if (down && moved < 8) { toNdc(e); ray.setFromCamera(ndc, camera); onSelect(ray, "screen"); } down = null; };
  const kd = e => { if (!e.target.closest("input, textarea")) keys.add(e.key.toLowerCase()); };
  const ku = e => keys.delete(e.key.toLowerCase());
  dom.addEventListener("pointerdown", pd); dom.addEventListener("pointermove", pm); dom.addEventListener("pointerup", pu);
  addEventListener("keydown", kd); addEventListener("keyup", ku);

  const fwd = new THREE.Vector3(), side = new THREE.Vector3();
  function update(dt, ground) {
    const xr = renderer.xr.isPresenting;
    if (!xr) {
      rig.rotation.set(0, yaw, 0); camera.rotation.set(pitch, 0, 0, "YXZ");
      const sp = (keys.has("shift") ? 9 : 3.2) * dt;
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); side.set(Math.cos(yaw), 0, -Math.sin(yaw));
      if (keys.has("w") || keys.has("arrowup")) rig.position.addScaledVector(fwd, sp);
      if (keys.has("s") || keys.has("arrowdown")) rig.position.addScaledVector(fwd, -sp);
      if (keys.has("a") || keys.has("arrowleft")) rig.position.addScaledVector(side, -sp);
      if (keys.has("d") || keys.has("arrowright")) rig.position.addScaledVector(side, sp);
      rig.position.y = ground(rig.position.x, rig.position.z);
    } else {
      // right stick: snap turn around the viewer's head
      for (const h of hands) {
        const ax = h.gamepad?.axes?.[2] ?? 0;
        if (h.hand !== "right") continue;
        if (Math.abs(ax) > .7 && !turnLatch) {
          turnLatch = true;
          const head = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
          const a = ax > 0 ? -Math.PI / 6 : Math.PI / 6;
          rig.position.sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), a).add(head); rig.rotation.y += a;
        } else if (Math.abs(ax) < .3) turnLatch = false;
      }
    }
  }

  /** the ray used for hover feedback: right controller in XR, mouse in the browser */
  function hoverRay() {
    if (renderer.xr.isPresenting) { const h = hands.find(x => x.hand === "right") || hands.find(x => x.hand); return h ? rayFrom(h) : null; }
    if (!last) return null;
    ray.setFromCamera(ndc, camera); return ray;
  }
  function setPointerLength(len) { for (const h of hands) h.line.scale.z = len; }

  function teleport(x, y, z) {
    if (renderer.xr.isPresenting) {          // keep the head over the target, not the rig origin
      const head = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      rig.position.x += x - head.x; rig.position.z += z - head.z; rig.position.y = y;
    } else rig.position.set(x, y, z);
  }
  function face(x, z) { if (!renderer.xr.isPresenting) yaw = Math.atan2(-(x - rig.position.x), -(z - rig.position.z)); else rig.rotation.y = Math.atan2(-(x - rig.position.x), -(z - rig.position.z)); }

  function dispose() {
    dom.removeEventListener("pointerdown", pd); dom.removeEventListener("pointermove", pm); dom.removeEventListener("pointerup", pu);
    removeEventListener("keydown", kd); removeEventListener("keyup", ku); lineGeo.dispose();
  }
  return { rig, update, hoverRay, teleport, face, setPointerLength, dispose, get yaw() { return yaw; } };
}
