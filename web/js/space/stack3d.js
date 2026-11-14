// ASI Stack in 3D (Method page). The criterion layers float over a terrain block and press
// down into one ASI layer. Every layer is draped on the same block, so they read as maps of one place.
// The block's side shows crust over mantle with the gold Moho line between them. Layer images are the
// team's real 1 km similarity grids (setFields); the block's relief is illustrative.
import * as THREE from "three";
import { reduceMotion, hexRgb, cssVar, rampColor, esc } from "../core/ui.js";
import { noise2, fbm, normalize } from "../core/noise.js";
import { fx } from "../core/fx.js";

const RELIEF = 0.11, GAP0 = 0.15, BASE = -0.075, MOHO = -0.03;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const SCAN_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SCAN_FS = `uniform sampler2D map; uniform float opacity, scan; uniform vec3 gold; varying vec2 vUv;
  void main(){
    vec4 c = texture2D(map, vUv);
    float band = exp(-pow((vUv.x - scan) / 0.012, 2.0)), trail = smoothstep(scan, scan - 0.25, vUv.x) * step(vUv.x, scan) * step(0.0, scan) * step(scan, 1.0);
    vec3 col = c.rgb + gold * (band * 1.1 + trail * 0.10);
    gl_FragColor = vec4(col, opacity);
    #include <colorspace_fragment>
  }`;

export function createStack(host, { P, fields, criteria }) {
  const GAP = Math.min(GAP0, .95 / criteria.length);          // ten layers fit the same height as six
  const canvas = document.createElement("canvas"); canvas.className = "stack3d";
  canvas.setAttribute("role", "img");
  const labels = document.createElement("div"); labels.className = "stack-labels"; labels.setAttribute("aria-hidden", "true");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });   // throws without WebGL; caller falls back
  host.prepend(canvas, labels);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);

  /* placeholder terrain: ridged, ophiolite-like mountains cut by wadis */
  const nz = noise2(77, 16), H = new Float32Array(P * P);
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    const u = i / (P - 1), v = j / (P - 1), ridge = 1 - Math.abs(2 * fbm(nz, u * 3 + 1.3, v * 3 + .7, 5) - 1);
    H[j * P + i] = .6 * ridge * ridge + .4 * fbm(nz, u * 1.6 + 5, v * 1.6 + 2, 4);
  }
  normalize(H);
  const at = (i, j) => H[Math.min(P - 1, Math.max(0, j)) * P + Math.min(P - 1, Math.max(0, i))];
  // hillshade lit from the north-west, baked into every layer's texture
  const shade = new Float32Array(P * P), L = new THREE.Vector3(-.6, .9, -.5).normalize(), k = RELIEF * (P - 1) / 2 * 3;
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    const n = new THREE.Vector3(-(at(i + 1, j) - at(i - 1, j)) * k, 1, -(at(i, j + 1) - at(i, j - 1)) * k).normalize();
    shade[j * P + i] = Math.max(0, n.dot(L));
  }

  /* textures: data row 0 is the bottom (v = 0), grid row 0 is the far edge, so rows are flipped */
  function dataTex(fill) {
    const d = new Uint8Array(P * P * 4);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) fill(d, ((P - 1 - j) * P + i) * 4, j * P + i);
    const t = new THREE.DataTexture(d, P, P); t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true; return t;
  }
  const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));

  function surface() {
    const g = new THREE.PlaneGeometry(1, 1, P - 1, P - 1); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let q = 0; q < pos.count; q++) pos.setY(q, H[q] * RELIEF);
    return g;
  }
  const geo = surface();
  const disposables = [geo];
  const track = o => { disposables.push(o); return o; };

  /* the block: terrain top, crust and mantle sides, Moho line between them */
  const block = new THREE.Group(); scene.add(block);
  const baseTex = track(dataTex((d, o, p) => { const s = shade[p]; d.set([clamp255(34 + s * 120), clamp255(38 + s * 122), clamp255(46 + s * 126), 255], o); }));
  block.add(new THREE.Mesh(geo, track(new THREE.MeshBasicMaterial({ map: baseTex }))));
  {
    const pos = [], col = [], idx = [], crust = new THREE.Color(0x2A313B), crust2 = new THREE.Color(0x1D222A), mantle = new THREE.Color(0x0D0F12);
    const edges = [[0, 0, 1, 0], [P - 1, 0, 0, 1], [P - 1, P - 1, -1, 0], [0, P - 1, 0, -1]];
    for (const [i0, j0, di, dj] of edges) {
      for (let s = 0; s < P; s++) {
        const i = i0 + di * s, j = j0 + dj * s, x = i / (P - 1) - .5, z = j / (P - 1) - .5, b = pos.length / 3;
        pos.push(x, at(i, j) * RELIEF, z, x, MOHO, z, x, MOHO, z, x, BASE, z);
        col.push(crust.r, crust.g, crust.b, crust2.r, crust2.g, crust2.b, mantle.r, mantle.g, mantle.b, mantle.r * .6, mantle.g * .6, mantle.b * .6);
        if (s < P - 1) for (const [a, c] of [[0, 1], [2, 3]]) idx.push(b + a, b + c, b + 4 + a, b + c, b + 4 + c, b + 4 + a);
      }
    }
    const sg = track(new THREE.BufferGeometry());
    sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); sg.setIndex(idx);
    block.add(new THREE.Mesh(sg, track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))));
    const moho = track(new THREE.BufferGeometry().setFromPoints([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, z]) => new THREE.Vector3(x * 1.001, MOHO, z * 1.001))));
    block.add(new THREE.LineLoop(moho, track(new THREE.LineBasicMaterial({ color: 0xF2C46D }))));
  }
  const grid = new THREE.GridHelper(2.4, 24, 0x3a4350, 0x232a33);
  grid.position.y = BASE - .002; grid.material.transparent = true; grid.material.opacity = .45; track(grid.geometry); track(grid.material); scene.add(grid);

  /* the ASI layer (on the block) */
  const asiU = { map: { value: null }, opacity: { value: 0 }, scan: { value: -1 }, gold: { value: new THREE.Color(0xF2C46D) } };
  const asiMesh = new THREE.Mesh(geo, track(new THREE.ShaderMaterial({ vertexShader: SCAN_VS, fragmentShader: SCAN_FS, uniforms: asiU, transparent: true, depthWrite: false })));
  asiMesh.position.y = .002; asiMesh.renderOrder = 1; block.add(asiMesh);

  /* criterion layers with corner ticks */
  const tickGeo = track((() => {
    const t = .09, pts = [];
    for (const [x, z] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) {
      const y = at(x < 0 ? 0 : P - 1, z < 0 ? 0 : P - 1) * RELIEF;
      pts.push(x, y, z, x - Math.sign(x) * t, y, z, x, y, z, x, y, z - Math.sign(z) * t);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); return g;
  })());
  const layers = criteria.map((c, i) => {
    const color = hexRgb(cssVar(`--c-${c.k}`)), f = fields[c.k];
    const tex = track(dataTex((d, o, p) => { const s = .5 + .7 * shade[p]; d.set([clamp255(color[0] * s), clamp255(color[1] * s), clamp255(color[2] * s), clamp255(26 + f[p] * 229)], o); }));
    const g = new THREE.Group(), y0 = (i + 1) * GAP + .05;
    const mat = track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: .9 }));
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 2 + i; mesh.userData.k = c.k;
    const ticks = new THREE.LineSegments(tickGeo, track(new THREE.LineBasicMaterial({ color: new THREE.Color(`rgb(${color.join(",")})`), transparent: true })));
    g.add(mesh, ticks); g.position.y = y0; scene.add(g);
    const el = document.createElement("div"); el.className = "sl"; el.style.setProperty("--rc", `var(--c-${c.k})`);
    el.innerHTML = `<i></i><b>${esc(c.name.split(" ")[0])}</b><span></span>`; labels.appendChild(el);
    return { k: c.k, g, mesh, mat, ticks, y0, v: 0, el, tex, color };
  });
  const asiLabel = document.createElement("div"); asiLabel.className = "sl asi"; asiLabel.innerHTML = `<i></i><b>ASI</b><span></span>`; labels.appendChild(asiLabel);

  // faint vertical guides at the corners, from the block up to the top layer
  const guideGeo = track(new THREE.BufferGeometry().setFromPoints([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].flatMap(([x, z]) => [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 1, z)])));
  const guides = new THREE.LineSegments(guideGeo, track(new THREE.LineDashedMaterial({ color: 0x9BA3AD, dashSize: .03, gapSize: .03, transparent: true, opacity: .28 })));
  guides.computeLineDistances(); scene.add(guides);

  /* state */
  let combined = false, tc = 99, hl = null, hoverCb = null, scanT = -1, asiOpacity = 0;
  const view = { yaw: .78, pitch: .52, R: 3.4, ty: .5, vy: 0, vp: 0, dragging: false, idle: 0 };
  let W = 1, Hh = 1;

  function fitR() {
    const vh = THREE.MathUtils.degToRad(camera.fov / 2), hh = Math.atan(Math.tan(vh) * camera.aspect);
    return (combined ? .8 : 1.04) / Math.sin(Math.min(vh, hh));
  }
  function resize() {
    const r = host.getBoundingClientRect(); W = Math.max(1, r.width); Hh = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio, fx.level === "high" ? 2 : 1));
    renderer.setSize(W, Hh, false); camera.aspect = W / Hh; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize(); view.R = fitR();
  const offFx = fx.subscribe(resize);

  /* drag to orbit, hover to highlight */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let last = null;
  canvas.addEventListener("pointerdown", e => { view.dragging = true; last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", e => { view.dragging = false; canvas.releasePointerCapture?.(e.pointerId); });
  canvas.addEventListener("pointercancel", () => { view.dragging = false; });
  canvas.addEventListener("pointermove", e => {
    view.idle = 0;
    if (view.dragging && last) {
      const dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY];
      view.vy = -dx * .008; view.vp = dy * .006; view.yaw += view.vy; view.pitch = Math.min(1.25, Math.max(.12, view.pitch + view.vp));
      return;
    }
    const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = combined ? null : ray.intersectObjects(layers.map(l => l.mesh), false)[0];
    const k = hit ? hit.object.userData.k : null;
    if (k !== hl) { hl = k; hoverCb?.(k); }
  });
  canvas.addEventListener("pointerleave", () => { if (!view.dragging && hl) { hl = null; hoverCb?.(null); } });

  /* render loop (only while on screen) */
  let visible = true, raf = 0, prev = performance.now(), t = 0;
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; }); io.observe(host);
  const tmp = new THREE.Vector3(), target = new THREE.Vector3();

  let frames = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame); frames++;
    const dt = Math.min(.25, (now - prev) / 1000); prev = now;   // generous cap: transitions finish on time even at low frame rates
    if (!visible || document.hidden) return;
    t += dt; tc += dt; view.idle += dt;

    // layers press down (top first) or lift off (bottom first)
    const n = layers.length;
    layers.forEach((l, i) => {
      const delay = combined ? (n - 1 - i) * .09 : i * .07, goal = combined ? 1 : 0;
      if (reduceMotion) l.v = goal;
      else if (tc > delay) l.v = goal > l.v ? Math.min(1, l.v + dt / .85) : Math.max(0, l.v - dt / .85);
      const e = ease(l.v), lift = hl === l.k ? .035 : 0;
      l.g.position.y = THREE.MathUtils.lerp(l.y0, .004 + i * .0015, e) + lift;
      const dim = hl && hl !== l.k ? .38 : 1;
      l.mat.opacity = (hl === l.k ? 1 : .88) * dim * (1 - smooth(.72, 1, l.v));
      l.ticks.material.opacity = l.mat.opacity;
      l.mesh.visible = l.ticks.visible = l.mat.opacity > .01;
    });
    const landed = layers.reduce((s, l) => s + smooth(.78, 1, l.v), 0) / n;
    asiOpacity = landed; asiU.opacity.value = asiOpacity;
    if (combined && landed > .999 && scanT < 0 && !reduceMotion) scanT = 0;
    if (scanT >= 0) { scanT += dt / 1.2; asiU.scan.value = scanT * 1.3 - .1; if (scanT >= 1) { scanT = -2; asiU.scan.value = -1; } }
    const top = layers[n - 1].g.position.y + RELIEF * .5;
    guides.scale.y = Math.max(.001, top); guides.material.opacity = .28 * (1 - landed);

    // camera: slow drift when idle, inertia after a drag
    if (!view.dragging) {
      view.yaw += view.vy; view.vy *= .92; view.pitch = Math.min(1.25, Math.max(.12, view.pitch + view.vp)); view.vp *= .9;
      if (!reduceMotion && view.idle > 2.5) view.yaw += dt * .07;
    }
    const kk = reduceMotion ? 1 : 1 - Math.exp(-dt * 3);
    view.R += (fitR() - view.R) * kk; view.ty += ((combined ? .04 : .5) - view.ty) * kk;
    target.set(0, view.ty, 0);
    camera.position.set(Math.cos(view.pitch) * Math.sin(view.yaw), Math.sin(view.pitch), Math.cos(view.pitch) * Math.cos(view.yaw)).multiplyScalar(view.R).add(target);
    camera.lookAt(target);
    camera.setViewOffset(W, Hh, W * .06, 0, W, Hh);
    renderer.render(scene, camera);

    // labels at each layer's right-most corner
    const corners = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]];
    const place = (el, y, op) => {
      let r = null, l = null;
      for (const [x, z] of corners) { tmp.set(x, y, z).project(camera); if (!r || tmp.x > r.x) r = { x: tmp.x, y: tmp.y }; if (!l || tmp.x < l.x) l = { x: tmp.x, y: tmp.y }; }
      const w = el.offsetWidth, px = Math.min((r.x * .5 + .5) * W + 8, W - w - 8), py = (-r.y * .5 + .5) * Hh;
      el.style.transform = `translate(${px}px, ${py}px) translateY(-50%)`;
      el.style.opacity = op;
    };
    layers.forEach(l => { place(l.el, l.g.position.y + at(P - 1, P - 1) * RELIEF, l.mat.opacity > .05 ? Math.min(1, l.mat.opacity * 1.2) : 0); l.el.classList.toggle("hl", hl === l.k); });
    place(asiLabel, .02, combined ? asiOpacity : 0);
  }
  raf = requestAnimationFrame(frame);

  return {
    // weights: {k: w}; asi: Float32Array P*P (0..1); ramp: mission colour stops; label: mission name
    update({ weights, asi, ramp, label }) {
      const tex = dataTex((d, o, p) => { const [r, g, b] = rampColor(ramp, asi[p]), s = .55 + .62 * shade[p]; d.set([clamp255(r * s), clamp255(g * s), clamp255(b * s), 255], o); });
      asiU.map.value?.dispose(); asiU.map.value = tex;
      layers.forEach(l => { l.el.querySelector("span").textContent = `w ${weights[l.k].toFixed(2)}`; });
      asiLabel.querySelector("span").textContent = label;
      canvas.setAttribute("aria-label", combined ? `ASI map for ${label}` : `${criteria.length} criterion layers above a terrain block`);
      if (combined && !reduceMotion) scanT = 0;
    },
    debug() { return { visible, hidden: document.hidden, tc: +tc.toFixed(2), t: +t.toFixed(2), frames, v: layers.map(l => +l.v.toFixed(2)), combined }; },
    /** replace the criterion layer images (e.g. real similarity grids once they load, or a new mission's) */
    setFields(next) {
      layers.forEach(l => { const f = next[l.k]; if (!f) return; const d = l.tex.image.data, c = l.color;
        for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) { const p = j * P + i, o = ((P - 1 - j) * P + i) * 4, s = .5 + .7 * shade[p];
          d[o] = clamp255(c[0] * s); d[o + 1] = clamp255(c[1] * s); d[o + 2] = clamp255(c[2] * s); d[o + 3] = clamp255(26 + f[p] * 229); }
        l.tex.needsUpdate = true; });
    },
    setCombined(on) { if (on === combined) return; combined = on; tc = 0; scanT = -1; hl = null; },
    highlight(k) { if (!combined) hl = k; },
    onHover(fn) { hoverCb = fn; },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); offFx();
      asiU.map.value?.dispose(); disposables.forEach(d => d.dispose?.()); renderer.dispose();
      canvas.remove(); labels.remove();
    },
  };
}
