// THE JOURNEY: how the crew gets there. A spacecraft launches from Earth, burns onto its transfer path, cruises
// along a drawn route with a mission clock, is captured into orbit around the destination, circles above the
// landing zone and finally drops toward it. Not to scale (the caption says so); distances and times are real.
//   Screen: a chase camera follows the ship.
//   Headset: the viewer sits still inside a cockpit frame and space moves around them (no forced head turns).
import * as THREE from "three";

const TEX = { earth: "earth.jpg", moon: "moon_4k.jpg", mars: "mars_4k.jpg" };
const BUMP = { moon: "moon_bump.jpg", mars: "mars_bump.jpg" };
const SITE = { moon: [-89.67, 129.78], mars: [18.38, 77.58] };     // Shackleton (approx.), Jezero
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = t => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

// what happens on each leg, in plain words; times are real
export const LEGS = {
  moon: {
    total: 3, unit: "day", dist: "384,400 km",
    launch: ["Launch", "The rocket climbs to orbit in about 8 minutes, shedding its boosters and core stage on the way."],
    burn: ["Leaving Earth", "The upper stage fires to about 39,000 km/h: fast enough to coast all the way to the Moon."],
    cruise: [
      ["Coasting", "The engines are off. The Moon is 384,400 km away, about 30 Earths lined up, and the trip takes about 3 days."],
      ["Talking to Earth", "Radio takes about 1.3 seconds each way, so the crew can still talk with mission control almost live."],
      ["Why the south pole", "Water ice hides in craters there that never see the Sun. Ice means water, air and rocket fuel made on the spot."],
    ],
    capture: ["Arrival", "The engine fires again to slow down, so the Moon's gravity captures the ship into orbit."],
    orbit: ["In orbit above the south pole", "Below: the Shackleton region, where peaks catch sunlight most of the time and crater floors stay in permanent shadow. Choose when to begin the descent."],
  },
  mars: {
    total: 7, unit: "month", dist: "about 225 million km on average",
    launch: ["Launch", "The rocket climbs to orbit in under ten minutes. A Mars ship is too big for one launch: its parts and fuel are assembled in orbit first."],
    burn: ["Leaving Earth", "Launch windows open only every 26 months, when Earth and Mars line up so the trip is shortest."],
    cruise: [
      ["A path around the Sun", "The ship does not fly straight: it coasts on a curved transfer orbit around the Sun for about 7 months."],
      ["Radiation", "Far from Earth's magnetic field, space radiation is the biggest health risk. The crew sleeps in a shielded part of the ship."],
      ["Signal delay", "Messages take 4 to 24 minutes each way, so the crew must solve most problems on their own."],
    ],
    capture: ["Arrival", "The thin Martian air and a long engine burn slow the ship until Mars captures it into orbit."],
    orbit: ["In orbit above Jezero", "Below: Jezero crater, an ancient lake bed with a river delta on its western edge, where Perseverance landed in 2021. Choose when to begin the descent."],
  },
};

// the way home (any world): lift-off, the long coast, and re-entry over Oman where the next crew rehearses
const HOME = {
  launch: ["Lift-off", "The ascent stage rises from the surface and meets the ship waiting in orbit."],
  burn: ["Heading home", "The engine fires to leave orbit and fall back toward Earth."],
  cruise: [["Coasting home", "Samples from the destination ride in sealed containers, so nothing from outside is mixed with Earth's own."],
    ["Back to the rehearsal ground", "Back on Earth, the next crew rehearses the same work in Oman, at the places our atlas ranks most alike."]],
  capture: ["Re-entry", "The capsule hits the air at tens of thousands of km/h; its heat shield glows at over 2,500 °C."],
};

const ATM_VS = `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const ATM_FS = `uniform vec3 color; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.5); gl_FragColor = vec4(color * f, f * .85); }`;

function latLonDir(lat, lon) { const p = lat * Math.PI / 180, l = lon * Math.PI / 180; return new THREE.Vector3(Math.cos(l) * Math.cos(p), Math.sin(p), -Math.sin(l) * Math.cos(p)); }

/** an original crew spacecraft: capsule, service module with solar wings, engine bell and a plume */
function buildShip() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: .6, metalness: .1 });
  const foil = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: .35, metalness: .9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: .6, metalness: .3 });
  const cell = new THREE.MeshStandardMaterial({ color: 0x2a4688, roughness: .25, metalness: .5, emissive: 0x0a1630 });
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  add(new THREE.ConeGeometry(.5, .55, 32, 1, true), white, 0, .55, 0);                       // crew capsule
  add(new THREE.CylinderGeometry(.5, .5, .06, 32), dark, 0, .26, 0);                          // heat shield
  add(new THREE.CylinderGeometry(.48, .48, .7, 32), foil, 0, -.12, 0);                        // service module
  add(new THREE.CylinderGeometry(.18, .32, .3, 24, 1, true), dark, 0, -.62, 0);              // engine bell
  for (let k = 0; k < 4; k++) {                                                                // four solar wings
    const a = k * Math.PI / 2 + Math.PI / 4, w = new THREE.Group(); w.rotation.y = a; g.add(w);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.9, .02, .02), dark); arm.position.x = .9; w.add(arm);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, .015, .5), cell); panel.position.x = 2.0; w.add(panel);
  }
  const plume = new THREE.Mesh(new THREE.ConeGeometry(.28, 1.8, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: .0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  plume.rotation.x = Math.PI; plume.position.y = -1.6; g.add(plume);
  g.userData.plume = plume;
  return g;
}

export function createJourney() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1, .005, 900);
  const universe = new THREE.Group(); scene.add(universe);
  // a soft fill light riding with the screen camera, so the ship reads even when the Sun is behind it
  const fill = new THREE.DirectionalLight(0xc4d0e4, 1.4); fill.position.set(.4, .6, .5); fill.target.position.set(0, 0, -1); camera.add(fill, fill.target); scene.add(camera);
  universe.add(new THREE.AmbientLight(0x30384a, .55));
  const sun = new THREE.DirectionalLight(0xffffff, 3.4); sun.position.set(40, 14, 30); universe.add(sun);
  // stars + a bright Sun sprite far away
  const N = 4200, sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u); sp.set([r * Math.cos(a) * 400, u * 400, r * Math.sin(a) * 400], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false })); universe.add(stars);
  const sunSpr = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,250,235,1)"); gr.addColorStop(.25, "rgba(255,230,180,.6)"); gr.addColorStop(1, "rgba(255,200,120,0)"); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(60, 60, 1); s.position.copy(sun.position).normalize().multiplyScalar(380); return s; })();
  universe.add(sunSpr);
  // a few hundred bright stars with a hint of colour, over the faint field
  { const n = 420, pp = new Float32Array(n * 3), cc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u); pp.set([r * Math.cos(a) * 390, u * 390, r * Math.sin(a) * 390], i * 3);
      const w = Math.random(), b = .7 + Math.random() * .3; cc.set(w > .8 ? [b, b * .85, b * .65] : w < .25 ? [b * .75, b * .85, b] : [b, b, b], i * 3); }
    const g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.BufferAttribute(pp, 3)); g2.setAttribute("color", new THREE.BufferAttribute(cc, 3));
    universe.add(new THREE.Points(g2, new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, vertexColors: true }))); }

  const loader = new THREE.TextureLoader(), bodies = {};
  function body(w, r, glow) {
    if (bodies[w]) return bodies[w];
    const g = new THREE.Group(), map = loader.load("assets/textures/" + TEX[w]); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    if (BUMP[w]) { mat.bumpMap = loader.load("assets/textures/" + BUMP[w]); mat.bumpScale = 2; }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 128, 64), mat); g.add(mesh);
    if (glow) g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.03, 64, 32), new THREE.ShaderMaterial({ vertexShader: ATM_VS, fragmentShader: ATM_FS, uniforms: { color: { value: new THREE.Color(glow) } }, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false })));
    g.userData = { r, mesh }; universe.add(g); bodies[w] = g; return g;
  }
  const earth = body("earth", 1, 0x6aa8ff);
  // drifting clouds over Earth
  const cloudTex = loader.load("assets/textures/earth_clouds.jpg");
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: cloudTex, transparent: true, depthWrite: false, roughness: 1 }));
  earth.add(clouds);
  const ship = buildShip(); ship.scale.setScalar(.08); universe.add(ship);
  // route line, revealed as the ship flies it
  const routeGeo = new THREE.BufferGeometry(), RN = 400;
  routeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((RN + 1) * 3), 3));
  const route = new THREE.Line(routeGeo, new THREE.LineDashedMaterial({ color: 0xf2c46d, dashSize: .25, gapSize: .15, transparent: true, opacity: .9 }));
  universe.add(route);
  const ghostRoute = new THREE.Line(routeGeo.clone(), new THREE.LineDashedMaterial({ color: 0xf2c46d, dashSize: .1, gapSize: .3, transparent: true, opacity: .25 }));
  universe.add(ghostRoute);
  // landing-zone marker on the destination
  const zone = new THREE.Group();
  const zr = new THREE.Mesh(new THREE.RingGeometry(.05, .065, 48), new THREE.MeshBasicMaterial({ color: 0xf2c46d, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  const zb = new THREE.Mesh(new THREE.CylinderGeometry(.0012, .0012, .18, 6), new THREE.MeshBasicMaterial({ color: 0xf2c46d, transparent: true, opacity: .7, blending: THREE.AdditiveBlending }));
  zb.rotation.x = Math.PI / 2; zb.position.z = .09; zone.add(zr, zb); universe.add(zone);

  // headset cockpit: a window frame and a dashboard that stay still around the viewer
  const cockpit = new THREE.Group(); scene.add(cockpit); cockpit.visible = false;
  {
    const frameM = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: .7, metalness: .3 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, .07, 10, 64), frameM); ring.position.set(0, 1.55, -1.6); cockpit.add(ring);
    for (const a of [Math.PI / 4, 3 * Math.PI / 4]) { const s = new THREE.Mesh(new THREE.BoxGeometry(.05, 2.4, .05), frameM); s.position.set(0, 1.55, -1.6); s.rotation.z = a; s.scale.y = .02; cockpit.add(s); }
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.6, .08, .55), frameM); dash.position.set(0, .7, -.85); dash.rotation.x = -.22; cockpit.add(dash);   // a low deck, below the console
    cockpit.add(new THREE.HemisphereLight(0xb8c4d8, 0x202428, .9));
  }
  // the mission screen stands on its own bezel at the back of the deck, clear of every other surface
  const dashCv = document.createElement("canvas"); dashCv.width = 1024; dashCv.height = 348;
  const dashTex = new THREE.CanvasTexture(dashCv); dashTex.colorSpace = THREE.SRGBColorSpace; dashTex.anisotropy = 8;
  const screenG = new THREE.Group(); screenG.position.set(0, .98, -1.12); screenG.rotation.x = -.16; cockpit.add(screenG);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.32, .5, .03), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: .5, metalness: .5 })); screenG.add(bezel);
  const dashPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.24, .42), new THREE.MeshBasicMaterial({ map: dashTex, toneMapped: false }));
  dashPanel.position.z = .017; screenG.add(dashPanel);

  const curve = { p: [], at: t => curve.p[0] };
  let st = null;
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3(), tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), mtx = new THREE.Matrix4();

  /**
   * start(dest, { from: "earth" | "moon" | "mars", onCaption(kind, title, text) }) → { orbit: Promise, done: Promise }
   * dest "earth" flies home (no orbit stop).
   */
  function start(dest, { from = "earth", onCaption = () => {} } = {}) {
    Object.values(bodies).forEach(b => b.visible = false);
    const home = from === "earth" ? earth : body(from, from === "moon" ? .6 : .8, from === "mars" ? 0xe39a6a : null);
    const goal = dest === "earth" ? earth : body(dest, dest === "moon" ? .6 : .8, dest === "mars" ? 0xe39a6a : null);
    home.visible = goal.visible = true;
    // layout: home at the origin, destination ahead (compressed distances; the caption says "not to scale")
    home.position.set(0, 0, 0); goal.position.set(dest === "mars" || from === "mars" ? 18 : 6, dest === "mars" || from === "mars" ? 2 : 1, dest === "mars" || from === "mars" ? -70 : -38);
    earth.userData.mesh.rotation.y = 2.4;
    const leg = dest === "earth" ? { ...LEGS[from], ...HOME } : LEGS[dest];
    // the route: leave from parking orbit, bow out sideways (a transfer arc), arrive at the destination's orbit
    const R0 = home.userData.r * 1.25, R1 = goal.userData.r * 1.6;
    const dir = goal.position.clone().sub(home.position).normalize(), side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const p0 = home.position.clone().addScaledVector(side, R0), p3 = goal.position.clone().addScaledVector(side, -R1);
    const L = goal.position.distanceTo(home.position), bow = dest === "mars" || from === "mars" ? .42 : .22;
    const p1 = p0.clone().addScaledVector(dir, L * .3).addScaledVector(side, L * bow), p2 = p3.clone().addScaledVector(dir, -L * .3).addScaledVector(side, L * bow * .8);
    const bez = new THREE.CubicBezierCurve3(p0, p1, p2, p3); curve.p = bez.getPoints(RN); curve.at = t => bez.getPoint(clamp01(t));
    const pos = routeGeo.attributes.position; curve.p.forEach((v, i) => pos.setXYZ(i, v.x, v.y, v.z)); pos.needsUpdate = true;
    route.computeLineDistances(); ghostRoute.geometry.copy(routeGeo); ghostRoute.computeLineDistances(); routeGeo.setDrawRange(0, 0);
    // landing zone on the destination
    const site = SITE[dest];
    if (site) {
      const sd = sun.position.clone().normalize(), n0 = latLonDir(site[0], site[1]);
      const yaw = Math.atan2(sd.x, sd.z) - Math.atan2(n0.x, n0.z) - .5;              // a little before local noon: long, readable shadows
      goal.userData.mesh.rotation.set(0, yaw, 0); const n = n0.clone().applyAxisAngle(up, yaw);
      zone.visible = true; zone.position.copy(goal.position).addScaledVector(n, goal.userData.r * 1.003); zone.lookAt(zone.position.clone().add(n));
      zone.scale.setScalar(goal.userData.r * 1.4); zone.userData.n = n;
    } else zone.visible = false;
    st = { dest, from, leg, home, goal, t: 0, phase: "launch", speed: 1, cap: "", onCaption, orbitA: 0, res: {}, cruiseIdx: -1, snap: true };
    const orbit = new Promise(r => st.res.orbit = r), done = new Promise(r => st.res.done = r);
    onCaption("launch", ...leg.launch);
    return { orbit, done };
  }
  const DUR = { launch: 4.5, burn: 2.5, cruise: 12, capture: 3, descend: 3.2 };

  function shipAt(p, ahead) { ship.position.copy(p); mtx.lookAt(p, ahead, up); ship.quaternion.setFromRotationMatrix(mtx); ship.rotateX(-Math.PI / 2); }

  function update(dt) {
    if (!st) return;
    const s = st, k = dt * s.speed; s.t += k;
    const plume = ship.userData.plume.material;
    let burning = false;
    if (s.phase === "launch") {                                // rise from the surface to parking orbit
      const e = ease(clamp01(s.t / DUR.launch)), p0 = curve.p[0], from = s.home.position.clone().addScaledVector(p0.clone().sub(s.home.position).normalize(), s.home.userData.r * 1.01);
      const p = from.lerp(p0, e); shipAt(p, p.clone().addScaledVector(p0.clone().sub(s.home.position).normalize(), 1).lerp(curve.p[4], e));
      burning = true;
      camTgt.copy(p); camPos.copy(s.home.position).addScaledVector(p.clone().sub(s.home.position).normalize(), s.home.userData.r * 1.9).add(tmp.set(0, .35, 0));
      if (s.t >= DUR.launch) { s.phase = "burn"; s.t = 0; s.onCaption("burn", ...s.leg.burn); }
    } else if (s.phase === "burn" || s.phase === "cruise") {
      const u = s.phase === "burn" ? .04 * clamp01(s.t / DUR.burn) : .04 + .92 * ease(clamp01(s.t / DUR.cruise));
      const p = curve.at(u), a = curve.at(u + .01); shipAt(p, a);
      routeGeo.setDrawRange(0, Math.round(u * RN));
      burning = s.phase === "burn";
      // chase camera: behind, above and a little to the side of the ship, looking past it toward the destination
      const back = p.clone().sub(a).normalize();
      camPos.copy(p).addScaledVector(back, .75).add(tmp.set(0, .38, 0)).addScaledVector(new THREE.Vector3().crossVectors(back, up).normalize(), .5);
      camTgt.copy(curve.at(u + .06));                         // look along the path just ahead of the ship
      if (s.phase === "burn" && s.t >= DUR.burn) { s.phase = "cruise"; s.t = 0; }
      if (s.phase === "cruise") {
        const i = Math.min(s.leg.cruise.length - 1, Math.floor(s.t / DUR.cruise * s.leg.cruise.length));
        if (i !== s.cruiseIdx) { s.cruiseIdx = i; s.onCaption("cruise", ...s.leg.cruise[i]); }
        if (s.t >= DUR.cruise) { s.phase = "capture"; s.t = 0; s.onCaption("capture", ...s.leg.capture); }
      }
    } else if (s.phase === "capture") {                        // slow down and swing into orbit
      const e = ease(clamp01(s.t / DUR.capture)), g = s.goal.position, R1 = s.goal.userData.r * 1.6;
      const a0 = Math.atan2(curve.p[RN].z - g.z, curve.p[RN].x - g.x), a = a0 + e * .9;
      const p = new THREE.Vector3(g.x + Math.cos(a) * R1, g.y + (1 - e) * (curve.p[RN].y - g.y), g.z + Math.sin(a) * R1);
      shipAt(p, new THREE.Vector3(g.x + Math.cos(a + .1) * R1, p.y, g.z + Math.sin(a + .1) * R1));
      burning = true; routeGeo.setDrawRange(0, RN);
      camPos.copy(g).add(tmp.set(Math.cos(a - .5) * R1 * 1.9, R1 * .55, Math.sin(a - .5) * R1 * 1.9)); camTgt.copy(g);
      if (s.t >= DUR.capture) {
        if (s.dest === "earth") { s.phase = "end"; finish(); return; }
        s.phase = "orbit"; s.t = 0; s.orbitA = a; s.onCaption("orbit", ...s.leg.orbit); s.res.orbit();
      }
    } else if (s.phase === "orbit" || s.phase === "descend") {
      // circle over the landing zone, slowly; the zone stays in view under the ship
      const g = s.goal.position, r = s.goal.userData.r, n = zone.userData.n || new THREE.Vector3(0, 1, 0);
      s.orbitA += k * .12;
      const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > .9 ? new THREE.Vector3(1, 0, 0) : up).normalize(), t2 = new THREE.Vector3().crossVectors(n, t1);
      const alt = s.phase === "descend" ? lerp(.5, .02, ease(clamp01(s.t / DUR.descend))) : .5;
      const off = t1.clone().multiplyScalar(Math.cos(s.orbitA) * .35).addScaledVector(t2, Math.sin(s.orbitA) * .35).multiplyScalar(s.phase === "descend" ? 1 - ease(clamp01(s.t / DUR.descend)) : 1);
      const p = g.clone().addScaledVector(n, r * (1 + alt)).addScaledVector(off, r);
      shipAt(p, p.clone().add(t2.clone().multiplyScalar(-Math.sin(s.orbitA)).addScaledVector(t1, Math.cos(s.orbitA))));
      burning = s.phase === "descend";
      const zoneP = g.clone().addScaledVector(n, r);
      camPos.copy(p).addScaledVector(n, r * (s.phase === "descend" ? .18 : .45)).addScaledVector(off, -.6 * r);
      camTgt.copy(zoneP).lerp(p, .25);
      if (s.phase === "descend") { s.t += 0; if (s.t >= DUR.descend) { s.phase = "end"; finish(); return; } }
    }
    plume.opacity = burning ? .55 + .25 * Math.sin(performance.now() / 40) : Math.max(0, plume.opacity - dt * 2);
    ship.userData.plume.scale.y = burning ? 1 + .3 * Math.sin(performance.now() / 55) : 1;
    zr.material.opacity = .6 + .4 * Math.sin(performance.now() / 300);
    if (s.home && s.home !== s.goal) s.home.userData.mesh.rotation.y += dt * .01;
    clouds.rotation.y += dt * .004;
    // the camera eases toward its target pose (smooth for the screen; gentle for the cockpit)
    // follow tightly while the ship flies a smooth path; ease more gently through the phase changes
    const rate = s.phase === "cruise" || s.phase === "orbit" ? 18 : s.phase === "burn" ? 6 : 5;
    const kf = s.snap ? 1 : 1 - Math.exp(-dt * rate); s.snap = false;
    camera.position.lerp(camPos, kf);
    const look = camera.userData.look || (camera.userData.look = camTgt.clone()); look.lerp(camTgt, kf);
    mtx.lookAt(camera.position, look, up); camera.quaternion.setFromRotationMatrix(mtx);
    paintDash();
  }
  /** reflections for metal, foil and gold: a soft starfield environment with a bright Sun */
  function setRenderer(renderer) {
    const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x0b1018, side: THREE.BackSide })));
    const s = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfff4e0 })); s.position.copy(sun.position).normalize().multiplyScalar(40); es.add(s);
    const e = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color: 0x2a4a78 })); e.position.set(0, -38, 0); es.add(e);
    scene.environment = pm.fromScene(es, .04).texture; pm.dispose();
  }
  function finish() { const r = st.res.done; st = null; cockpit.visible = false; r?.(); }

  /** mission clock: share of the trip done, as days / months */
  function clock() {
    if (!st) return null;
    const s = st, L = s.leg, tot = L.total;
    const f = s.phase === "launch" ? 0 : s.phase === "burn" ? .01 : s.phase === "cruise" ? .02 + .93 * clamp01(s.t / DUR.cruise) : 1;
    const v = f * tot;
    return { f, text: `${L.unit === "day" ? "Day" : "Month"} ${v.toFixed(1)} of ${tot}`, dist: L.dist, phase: s.phase };
  }
  let dashLast = "";
  function paintDash() {
    if (!cockpit.visible) return;
    const c = clock(), key = (c?.text || "") + st?.phase + (st?.cap || "") + (st?.capTitle || "");
    if (key === dashLast) return; dashLast = key;
    const x = dashCv.getContext("2d"), W = dashCv.width, H = dashCv.height, P = 34;
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#161b23"); g.addColorStop(1, "#090b0f");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(242,196,109,.5)"; x.lineWidth = 3; x.strokeRect(1.5, 1.5, W - 3, H - 3);
    x.fillStyle = "#f2c46d"; x.font = "600 40px 'Space Grotesk', sans-serif"; x.fillText(c ? c.text : "", P, 58);
    x.fillStyle = "#9ba3ad"; x.font = "500 22px 'IBM Plex Mono', monospace"; x.textAlign = "right"; x.fillText(c ? c.dist.toUpperCase() : "", W - P, 56); x.textAlign = "left";
    x.fillStyle = "rgba(255,255,255,.12)"; x.fillRect(P, 78, W - 2 * P, 10); x.fillStyle = "#f2c46d"; x.fillRect(P, 78, (W - 2 * P) * (c ? c.f : 0), 10);
    x.fillStyle = "#f3f1ec"; x.font = "700 30px 'Space Grotesk', sans-serif"; x.fillText(st?.capTitle || "", P, 134);
    // caption: wrapped to the screen width, at most five lines, an ellipsis if it runs longer
    x.fillStyle = "#d9dde2"; x.font = "400 25px 'IBM Plex Sans', sans-serif";
    const words = (st?.cap || "").split(" "), lines = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (x.measureText(t).width > W - 2 * P && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    const shown = lines.slice(0, 5); if (lines.length > 5) shown[4] = shown[4].replace(/\s*\S*$/, "") + "…";
    shown.forEach((l, k) => x.fillText(l, P, 174 + k * 33));
    dashTex.needsUpdate = true;
  }

  /** headset: keep the viewer still and move space so the chase camera's view lands on their eyes */
  const headM = new THREE.Matrix4(), camM = new THREE.Matrix4(), inv = new THREE.Matrix4();
  function placeForXR(rig) {
    rig.updateMatrixWorld(true);
    headM.copy(rig.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(0, 1.55, 0));
    camM.compose(camera.position, camera.quaternion, new THREE.Vector3(1, 1, 1));
    inv.copy(camM).invert();
    universe.matrixAutoUpdate = false; universe.matrix.copy(headM).multiply(inv); universe.matrixWorldNeedsUpdate = true;
    cockpit.visible = true; cockpit.matrixAutoUpdate = false; cockpit.matrix.copy(rig.matrixWorld); cockpit.matrixWorldNeedsUpdate = true;
  }
  /** shiftX / shiftY: fraction of the view to move the picture right / up, so panels do not cover the planet */
  function placeForScreen(aspect, w = 1, h = 1, shiftX = 0, shiftY = 0) {
    universe.matrixAutoUpdate = true; universe.position.set(0, 0, 0); universe.quaternion.identity(); cockpit.visible = false;
    camera.aspect = aspect;
    if (shiftX || shiftY) camera.setViewOffset(w, h, -shiftX * w, shiftY * h, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  return {
    scene, camera, cockpit, ship, setRenderer, start, update, clock, placeForXR, placeForScreen,
    descend() { if (st && st.phase === "orbit") { st.phase = "descend"; st.t = 0; } },
    skip() { if (st && (st.phase === "launch" || st.phase === "burn" || st.phase === "cruise")) { st.phase = "capture"; st.t = 0; st.onCaption("capture", ...st.leg.capture); } },
    setSpeed(v) { if (st) st.speed = v; }, get speed() { return st?.speed || 1; },
    setCaption(t, title = "") { if (st) { st.cap = t; st.capTitle = title; } },
    get active() { return !!st; }, get phase() { return st?.phase || null; },
    dispose() { sg.dispose(); routeGeo.dispose(); dashTex.dispose(); scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); }); },
  };
}
