// Lander: an original procedural design, a powered descent onto the chosen pad under the skin's
// gravity, engine plume + light, a dust burst near the ground, and the touchdown check that
// samples the terrain under the four footpads.
import * as THREE from "three";

import { buildLander, PADS, FOOT_R } from "./models.js";

const PLUME_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const PLUME_FS = `uniform float t, power; varying vec2 vUv;
  void main(){
    float along = vUv.y;                                   // 1 at the nozzle, 0 at the tip
    float flick = 0.85 + 0.15 * sin(t * 61.0 + along * 23.0) * sin(t * 37.0);
    float core = pow(along, 1.6) * flick;
    vec3 c = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.92, 0.75), pow(along, 3.0));
    gl_FragColor = vec4(c * core * power * 1.6, core * power);
  }`;

const DUST_VS = `attribute float alpha; attribute float size; varying float vA;
  void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(size * 260.0 / -mv.z, 70.0); gl_Position = projectionMatrix * mv; }`;
const DUST_FS = `uniform vec3 color; varying float vA;
  void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; gl_FragColor = vec4(color, vA * (1.0 - r * 4.0) * 0.3);
    #include <colorspace_fragment>
  }`;

export function createLander(scene, terrain, rules) {
  const model = buildLander(), { lights, wings } = model.userData;
  const root = new THREE.Group(); root.add(model); root.visible = false; scene.add(root);

  // plume (cone pointing down from the nozzle) + its light on the ground
  const plumeMat = new THREE.ShaderMaterial({ vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { t: { value: 0 }, power: { value: 0 } } });
  const plumeGeo = new THREE.ConeGeometry(.78, 1, 20, 1, true); plumeGeo.translate(0, -.5, 0);   // apex at the nozzle (y=0), widening downward (vacuum-style plume)
  const plume = new THREE.Mesh(plumeGeo, plumeMat); plume.position.y = .75; model.add(plume);
  const glow = new THREE.PointLight(0xffa860, 0, 45, 1.6); glow.position.y = .2; model.add(glow);

  // dust particles
  const N = 1800, dPos = new Float32Array(N * 3), dVel = new Float32Array(N * 3), dLife = new Float32Array(N), dMax = new Float32Array(N);
  const dAlpha = new Float32Array(N), dSize = new Float32Array(N);
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3)); dGeo.setAttribute("alpha", new THREE.BufferAttribute(dAlpha, 1)); dGeo.setAttribute("size", new THREE.BufferAttribute(dSize, 1));
  const dMat = new THREE.ShaderMaterial({ vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false, uniforms: { color: { value: new THREE.Color(0xc0a080) } } });
  const dust = new THREE.Points(dGeo, dMat); dust.frustumCulled = false; scene.add(dust);
  let dNext = 0;

  const L = rules.landing;
  const st = { state: "idle", t: 0, T: 30, G: 9.81, drag: 2, P0: new THREE.Vector3(), M0: new THREE.Vector3(), P1: new THREE.Vector3(), M1: new THREE.Vector3(), yaw: 0, settleQ: new THREE.Quaternion(), report: null, onDown: null, pad: null };
  const up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), acc = new THREE.Vector3(), thrust = new THREE.Vector3(), qT = new THREE.Quaternion(), qY = new THREE.Quaternion();

  function touchdownPose(pad, yaw) {
    // footpad heights on the terrain -> plane through the pads -> tilt and resting height
    qY.setFromAxisAngle(up, yaw);
    const feet = PADS.map(p => { tmp.copy(p).applyQuaternion(qY); const x = pad.x + tmp.x, z = pad.z + tmp.z; return [tmp.x, tmp.z, terrain.heightAt(x, z)]; });
    let mx = 0, mz = 0, my = 0; feet.forEach(([x, z, y]) => { mx += x / 4; mz += z / 4; my += y / 4; });
    let sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
    feet.forEach(([x, z, y]) => { x -= mx; z -= mz; y -= my; sxx += x * x; szz += z * z; sxz += x * z; sxy += x * y; szy += z * y; });
    const det = sxx * szz - sxz * sxz || 1e-9, a = (sxy * szz - szy * sxz) / det, b = (szy * sxx - sxy * sxz) / det;
    const n = new THREE.Vector3(-a, 1, -b).normalize();
    const tilt = THREE.MathUtils.radToDeg(Math.acos(n.y));
    const spread = Math.max(...feet.map(f => f[2])) - Math.min(...feet.map(f => f[2]));
    const q = new THREE.Quaternion().setFromUnitVectors(up, n).multiply(qY);
    return { y: my, q, tilt, spread };
  }

  function grade(v, safe, hazard) { return v <= safe ? 0 : v <= hazard ? 1 : 2; }

  function report(pad) {
    const pose = touchdownPose(pad, st.yaw), s = terrain.stats(pad.x, pad.z, L.pad_radius_m);
    const g = [grade(pose.tilt, L.tilt_safe_deg, L.tilt_hazard_deg), grade(s.slope, L.slope_safe_deg, L.slope_hazard_deg), grade(s.roughness, L.roughness_safe_m, L.roughness_hazard_m)];
    const worst = Math.max(...g);
    return { tilt: pose.tilt, slope: s.slope, roughness: s.roughness, relief: s.relief, spread: pose.spread, grades: g,
      status: ["SAFE", "MARGINAL", "HAZARD"][worst], level: worst, pose };
  }

  /** start the descent toward pad {x,z}; the approach crosses the viewer's line of sight */
  function start(pad, skin, viewer) {
    st.G = rules.worlds[skin].gravity; st.drag = skin === "moon" ? 0 : skin === "mars" ? 1.2 : 2.2;
    st.T = L.descent_s[skin]; st.t = 0; st.pad = { x: pad.x, z: pad.z }; st.state = "descent"; st.report = null;
    dMat.uniforms.color.value.set(skin === "moon" ? 0xa9a7a3 : skin === "mars" ? 0xb07048 : 0xc9a77c);
    const toViewer = new THREE.Vector3(viewer.x - pad.x, 0, viewer.z - pad.z).normalize();
    const side = new THREE.Vector3().crossVectors(up, toViewer).normalize();
    const from = side.multiplyScalar(-1).addScaledVector(toViewer, -.35).normalize();
    st.yaw = Math.atan2(-from.x, -from.z);
    const pose = touchdownPose(pad, st.yaw);
    // start high enough to clear the highest ground in the tile (real mountains can be several hundred metres)
    const alt = Math.max(L.start_altitude_m, (terrain.maxHeight ?? pose.y) - pose.y + 160);
    st.P0.set(pad.x + from.x * L.start_downrange_m, pose.y + alt, pad.z + from.z * L.start_downrange_m);
    st.M0.set(-from.x * 14, -9, -from.z * 14).multiplyScalar(st.T);         // entry velocity (m/s) scaled for the Hermite curve
    st.P1.set(pad.x, pose.y, pad.z); st.M1.set(0, -L.touchdown_speed_mps, 0).multiplyScalar(st.T);
    st.settleQ.copy(pose.q);
    root.visible = true; root.position.copy(st.P0);
  }

  function hermite(u, out, d2) {
    const u2 = u * u, u3 = u2 * u;
    if (!d2) return out.copy(st.P0).multiplyScalar(2 * u3 - 3 * u2 + 1).addScaledVector(st.M0, u3 - 2 * u2 + u).addScaledVector(st.P1, -2 * u3 + 3 * u2).addScaledVector(st.M1, u3 - u2);
    return out.copy(st.P0).multiplyScalar(12 * u - 6).addScaledVector(st.M0, 6 * u - 4).addScaledVector(st.P1, -12 * u + 6).addScaledVector(st.M1, 6 * u - 2).multiplyScalar(1 / (st.T * st.T));
  }

  function emitDust(n, power) {
    const base = root.position;
    for (let k = 0; k < n; k++) {
      const i = dNext = (dNext + 1) % N, a = Math.random() * Math.PI * 2, r = Math.random() * 2.2;
      const x = base.x + Math.cos(a) * r, z = base.z + Math.sin(a) * r;
      dPos[i * 3] = x; dPos[i * 3 + 1] = terrain.heightAt(x, z) + .15; dPos[i * 3 + 2] = z;
      const sp = (st.drag === 0 ? 16 : 9) + Math.random() * (st.drag === 0 ? 22 : 14) * power;
      dVel[i * 3] = Math.cos(a) * sp; dVel[i * 3 + 1] = (st.drag === 0 ? .6 : 1.5) + Math.random() * 2.5; dVel[i * 3 + 2] = Math.sin(a) * sp;
      dLife[i] = 0; dMax[i] = 2.5 + Math.random() * 3; dSize[i] = .8 + Math.random() * 1.6;
    }
  }

  function update(dt, time) {
    plumeMat.uniforms.t.value = time;
    // dust physics
    for (let i = 0; i < N; i++) {
      if (dMax[i] === 0) continue;
      dLife[i] += dt; const life = dLife[i] / dMax[i];
      if (life >= 1) { dMax[i] = 0; dAlpha[i] = 0; continue; }
      const k = Math.exp(-st.drag * dt);
      dVel[i * 3] *= k; dVel[i * 3 + 2] *= k; dVel[i * 3 + 1] = dVel[i * 3 + 1] * k - st.G * dt * (st.drag === 0 ? 1 : .08);
      dPos[i * 3] += dVel[i * 3] * dt; dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt; dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
      const gy = terrain.heightAt(dPos[i * 3], dPos[i * 3 + 2]);
      if (dPos[i * 3 + 1] < gy) { dPos[i * 3 + 1] = gy; dVel[i * 3] *= .3; dVel[i * 3 + 2] *= .3; dVel[i * 3 + 1] = 0; }
      dAlpha[i] = Math.min(1, life * 8) * (1 - life); dSize[i] = Math.min(5, dSize[i] + dt * (st.drag === 0 ? .2 : 1.1));
    }
    dGeo.attributes.position.needsUpdate = dGeo.attributes.alpha.needsUpdate = dGeo.attributes.size.needsUpdate = true;

    lights[0].visible = lights[1].visible = Math.floor(time * 1.4) % 2 === 0;
    // solar wings fold up for the descent and unfold once the lander is down
    const wingGoal = st.state === "landed" ? 0 : 1.45;
    for (const w of wings) w.rotation.z += (w.userData.sx * wingGoal - w.rotation.z) * Math.min(1, dt * (st.state === "landed" ? .9 : 6));
    if (st.state !== "descent") { plumeMat.uniforms.power.value *= Math.exp(-dt * 6); glow.intensity = plumeMat.uniforms.power.value * 60; plume.visible = plumeMat.uniforms.power.value > .01; return; }

    st.t += dt; const u = Math.min(1, st.t / st.T);
    hermite(u, root.position);
    hermite(u, acc, true);                                       // trajectory acceleration
    thrust.set(acc.x, acc.y + st.G, acc.z);                      // engine must supply a - g
    const power = Math.min(1.4, thrust.length() / Math.max(st.G, 1.6));
    qT.setFromUnitVectors(up, thrust.clone().normalize()).multiply(qY.setFromAxisAngle(up, st.yaw));
    if (u > .9) qT.slerp(st.settleQ, (u - .9) / .1);              // legs level onto the ground at the end
    root.quaternion.slerp(qT, Math.min(1, dt * 3));
    plume.visible = true; plumeMat.uniforms.power.value = .55 + .45 * Math.min(1, power);
    plume.scale.set(1, 3 + 5 * Math.min(1, power), 1); glow.intensity = 60 * plumeMat.uniforms.power.value;
    const alt = root.position.y - terrain.heightAt(root.position.x, root.position.z);
    if (alt < 30) emitDust(Math.ceil((1 - alt / 30) * 26 * dt * 60), 1 - alt / 30);
    if (u >= 1) {
      st.state = "landed"; root.quaternion.copy(st.settleQ);
      st.report = report(st.pad); emitDust(110, 1);
      st.onDown?.(st.report);
    }
  }

  function reset() { st.state = "idle"; root.visible = false; st.report = null; }

  function dispose() {
    scene.remove(root, dust); dGeo.dispose(); dMat.dispose(); plumeGeo.dispose(); plumeMat.dispose();
    root.traverse(o => o.geometry?.dispose?.());
  }

  return {
    root, start, update, reset, dispose, report, touchdownPose,
    get state() { return st.state; }, get pad() { return st.pad; }, get last() { return st.report; },
    set onTouchdown(fn) { st.onDown = fn; },
    footprint: FOOT_R,
  };
}
