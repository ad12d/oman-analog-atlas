// Spectator transition between worlds: lift off into space, watch the current world shrink, cross to the next one,
// close in on a glowing landing-site marker, then hand back to the ground scene for the final descent.
// Screen mode only; in the headset the view fades instead (moving the camera there causes motion sickness).
import * as THREE from "three";

const TEX = { oman: ["earth.jpg", null], moon: ["moon.jpg", "moon_bump.jpg"], mars: ["mars.jpg", "mars_bump.jpg"] };
const GLOW = { oman: 0x6aa8ff, moon: null, mars: 0xe39a6a };
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = t => Math.max(0, Math.min(1, t));

const ATM_VS = `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const ATM_FS = `uniform vec3 color; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 4.0); gl_FragColor = vec4(color * f * 0.9, f * 0.8); }`;

export function createTravel() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .01, 500);
  scene.add(new THREE.AmbientLight(0x223040, .5));
  const sunL = new THREE.DirectionalLight(0xffffff, 3.2); sunL.position.set(6, 2.5, 4); scene.add(sunL);
  // stars
  const N = 3500, sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u); sp[i * 3] = r * Math.cos(a) * 200; sp[i * 3 + 1] = u * 200; sp[i * 3 + 2] = r * Math.sin(a) * 200; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false })));

  const loader = new THREE.TextureLoader(), cache = {};
  function planet(w) {
    if (cache[w]) return cache[w];
    const [map, bump] = TEX[w], g = new THREE.Group();
    const mt = loader.load("assets/textures/" + map); mt.colorSpace = THREE.SRGBColorSpace; mt.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: mt, roughness: 1, metalness: 0 });
    if (bump) { mat.bumpMap = loader.load("assets/textures/" + bump); mat.bumpScale = 2.5; }
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), mat));
    if (GLOW[w]) g.add(new THREE.Mesh(new THREE.SphereGeometry(1.025, 64, 32), new THREE.ShaderMaterial({ vertexShader: ATM_VS, fragmentShader: ATM_FS, uniforms: { color: { value: new THREE.Color(GLOW[w]) } }, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false })));
    g.visible = false; scene.add(g); cache[w] = g; return g;
  }
  // landing-site marker on the destination
  const marker = new THREE.Mesh(new THREE.RingGeometry(.02, .032, 48), new THREE.MeshBasicMaterial({ color: 0xf2c46d, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  scene.add(marker);

  const O = new THREE.Vector3(0, 0, 0), D = new THREE.Vector3(0, 0, -34);
  const n = new THREE.Vector3(.35, .45, 1).normalize(), m = new THREE.Vector3(-.25, .35, 1).normalize();
  const look = new THREE.Vector3(), tmp = new THREE.Vector3(), qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), mtx = new THREE.Matrix4();
  let st = null;

  function start(from, to, { duration = 6.2 } = {}) {
    Object.values(cache).forEach(p => p.visible = false);
    const A = planet(from), B = planet(to);
    A.position.copy(O); B.position.copy(D); A.visible = B.visible = true;
    A.rotation.y = Math.random() * 6; B.rotation.y = -1.4;
    marker.position.copy(D).addScaledVector(m, 1.002); marker.lookAt(D.clone().addScaledVector(m, 2));
    st = { t: 0, dur: duration, from, to, res: null };
    return new Promise(res => { st.res = res; });
  }
  function camAt(p, target, roll = 0) {
    camera.position.copy(p); mtx.lookAt(p, target, new THREE.Vector3(0, 1, 0)); camera.quaternion.setFromRotationMatrix(mtx);
    if (roll) camera.rotateZ(roll);
  }
  function update(dt, aspect) {
    if (!st) return;
    camera.aspect = aspect; camera.updateProjectionMatrix();
    st.t += dt; const u = clamp01(st.t / st.dur), T = st.dur;
    const tA = clamp01(st.t / (T * .28)), tB = clamp01((st.t - T * .28) / (T * .36)), tC = clamp01((st.t - T * .64) / (T * .36));
    if (st.t < T * .28) {                                            // A: climb away from the origin world
      const e = ease(tA), p = tmp.copy(O).addScaledVector(n, 1.03 + 2.6 * e);
      const tan = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();          // "up" along the surface
      const horizon = O.clone().addScaledVector(n, 1.03).addScaledVector(tan, 2);           // first look along the horizon...
      camAt(p, horizon.lerp(O, Math.min(1, e * 1.4)));                                      // ...then down at the shrinking world
    } else if (st.t < T * .64) {                                     // B: cruise to the destination, turning to face it
      const e = ease(tB), p0 = O.clone().addScaledVector(n, 3.63), p1 = D.clone().addScaledVector(m, 3.2);
      const p = tmp.copy(p0).lerp(p1, e); p.y += Math.sin(e * Math.PI) * 2.2;
      mtx.lookAt(p, O, new THREE.Vector3(0, 1, 0)); qA.setFromRotationMatrix(mtx);
      mtx.lookAt(p, D, new THREE.Vector3(0, 1, 0)); qB.setFromRotationMatrix(mtx);
      camera.position.copy(p); camera.quaternion.copy(qA).slerp(qB, clamp01(e * 1.6));
    } else {                                                         // C: close in on the landing site
      const e = ease(tC), p = tmp.copy(D).addScaledVector(m, 3.2 - 2.15 * e);
      const site = D.clone().addScaledVector(m, 1.0), aim = D.clone().lerp(site, e);
      camAt(p, aim, 0);
    }
    marker.material.opacity = .6 + .4 * Math.sin(st.t * 6);
    marker.scale.setScalar(1 + .3 * Math.sin(st.t * 3));
    for (const p of Object.values(cache)) if (p.visible) p.rotation.y += dt * .03;
    if (u >= 1) { const r = st.res; st = null; r?.(); }
  }
  return {
    scene, camera, start, update,
    get active() { return !!st; },
    /** 0..1 white-out level the caller can show over the canvas (end of the approach) */
    get fade() { if (!st) return 0; const t = st.t / st.dur; return t > .9 ? (t - .9) / .1 : t < .06 ? 1 - t / .06 : 0; },
    dispose() { sg.dispose(); Object.values(cache).forEach(g => g.traverse(o => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); })); },
  };
}
