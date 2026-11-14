// The space layer: Earth, the Moon and Mars in one sky.
// Earth: day/night shader with NASA Black Marble city lights, clouds, sun glint on the oceans
// and a sun-facing atmosphere. Moon and Mars: NASA colour maps with real relief (LOLA, MOLA)
// and a marker on each target site. A procedural nebula sky, a gold transfer route in the
// Director, and bloom post-processing when graphics are set to "high".
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { reduceMotion, toast } from "../core/ui.js";
import { fx } from "../core/fx.js";

export const OMAN = { lat: 22.6, lon: 57.6 };
// The place on each world that the project is about.
export const SITES = {
  earth: { lat: OMAN.lat, lon: OMAN.lon, name: "Samail ophiolite" },
  moon:  { lat: -89.67, lon: 129.78, name: "Shackleton crater" },
  mars:  { lat: 18.38, lon: 77.58, name: "Jezero crater" },
};
const D2R = Math.PI / 180;
// Sun direction in world space. The small negative height keeps the Moon's south pole at
// grazing light (about 1.7° above the horizon), as it really is there.
const SUN = new THREE.Vector3(-0.56, -0.03, 0.83).normalize();
const TEX = "assets/textures/";
// Sharper Earth imagery over Arabia (NASA Blue Marble Next Generation, 500 m) blended into the globe for the close-ups.
const PATCH = { lon0: 40, lon1: 76, lat0: 8, lat1: 36 };
// Texture upgrades by device tier: 0 = phone / small GPU (first-load files only), 1 = desktop, 2 = desktop on high graphics with 8K support.
// The first-load files keep the page quick; sharper ones swap in once they arrive, and Moon / Mars only when the viewer heads there.
const HD = {
  earth:  [null, null, "earth_8k.jpg"],
  night:  [null, "earth_night_4k.jpg", "earth_night_4k.jpg"],
  arabia: ["earth_arabia.jpg", "earth_arabia_4k.jpg", "earth_arabia_4k.jpg"],
  moon:   ["moon_4k.jpg", "moon_4k.jpg", "moon_8k.jpg"],
  mars:   ["mars_4k.jpg", "mars_4k.jpg", "mars_8k.jpg"],
  // close-up zones: Moon south pole (LRO WAC + LOLA, polar projection) and Jezero crater (Viking colour, 182 px/deg)
  moonPole: ["moon_pole.jpg", "moon_pole.jpg", "moon_pole.jpg"],
  jezero:   ["mars_jezero.jpg", "mars_jezero.jpg", "mars_jezero.jpg"],
};
const POLE_R = 12 * Math.PI / 180;                       // the polar zone patch reaches 12° from the pole
const JEZERO = { lon0: 67.6, lon1: 87.6, lat0: 8.4, lat1: 28.4 };

// Sharp zone images blended into the standard material of the Moon (polar patch, no seam or pinch at the pole)
// and Mars (a lon/lat box around Jezero). Uniforms are shared objects so textures can be swapped in later.
function addZone(mat, kind, U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = "varying vec3 vObjPos;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vObjPos = position;");
    let f = "varying vec3 vObjPos;\nuniform sampler2D zoneMap, zoneBump; uniform float zoneOn; uniform vec4 zoneBox;\n" + sh.fragmentShader;
    f = f.replace("#include <uv_pars_fragment>", `#include <uv_pars_fragment>
      vec3 zoneUV() {
      #ifdef ZONE_POLE
        vec3 n = normalize(vObjPos); float th = acos(clamp(-n.y, -1.0, 1.0)); float rho = length(n.xz);
        vec2 d = rho > 1e-6 ? n.xz / rho : vec2(1.0, 0.0);
        return vec3(0.5 + 0.5 * d * (th / ${POLE_R.toFixed(6)}), zoneOn * (1.0 - smoothstep(${(POLE_R * .8).toFixed(6)}, ${(POLE_R * .98).toFixed(6)}, th)));
      #else
        vec2 pq = (vMapUv - zoneBox.xy) / (zoneBox.zw - zoneBox.xy); vec2 e = min(pq, 1.0 - pq);
        return vec3(pq, zoneOn * smoothstep(0.0, 0.08, min(e.x, e.y)));
      #endif
      }`);
    f = f.replace("#include <map_fragment>", `#include <map_fragment>
      { vec3 zq = zoneUV(); if (zq.z > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(zoneMap, zq.xy).rgb, zq.z); }`);
    if (kind === "pole") f = f.replace("return vec2( dBx, dBy );", `
      vec3 zq = zoneUV();
      if (zq.z > 0.0) { vec2 sx = dFdx(zq.xy), sy = dFdy(zq.xy); float h0 = texture2D(zoneBump, zq.xy).x;
        dBx = mix(dBx, bumpScale * (texture2D(zoneBump, zq.xy + sx).x - h0), zq.z);
        dBy = mix(dBy, bumpScale * (texture2D(zoneBump, zq.xy + sy).x - h0), zq.z); }
      return vec2( dBx, dBy );`);
    sh.fragmentShader = (kind === "pole" ? "#define ZONE_POLE\n" : "") + f;
  };
  mat.customProgramCacheKey = () => "zone-" + kind;
}

const WORLDS = {
  earth: { pos: new THREE.Vector3(0, 0, 0),         r: 1.00, spin: 0.03,  glow: 0x5aa6ff, glowAmt: .7, glowScale: 1.065, mark: 0xF2C46D, markSize: 0.034 },
  moon:  { pos: new THREE.Vector3(2.6, 0.5, -1.1),  r: 0.27, spin: 0.02,  tex: "moon.jpg", bump: "moon_bump.jpg", bumpScale: 3.0, mark: 0x7DB7FF, markSize: 0.026 },
  mars:  { pos: new THREE.Vector3(8.2, -0.55, -6.4), r: 0.53, spin: 0.025, tex: "mars.jpg", bump: "mars_bump.jpg", bumpScale: 2.2,
           glow: 0xff8a5c, glowAmt: .42, glowScale: 1.06, rim: 0xffa07a, mark: 0xE07250, markSize: 0.042 },
};

/* ---------------- shaders ---------------- */
const WORLD_VS = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main(){
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const EARTH_FS = /* glsl */`
  uniform sampler2D dayMap, nightMap, cloudMap, waterMap, patchMap, patchWater;
  uniform vec3 sunDir, atmo; uniform float cloudOffset, nightGain, patchOn;
  uniform vec4 patchBox;   // sharper Arabia patch: u0, v0, u1, v1 in globe texture space
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main(){
    vec3 N = normalize(vN), V = normalize(cameraPosition - vP), L = sunDir;
    float ndl = dot(N, L);
    float lit = smoothstep(-0.10, 0.20, ndl);
    vec3 day = texture2D(dayMap, vUv).rgb;
    float water = texture2D(waterMap, vUv).r;
    vec2 pq = (vUv - patchBox.xy) / (patchBox.zw - patchBox.xy);
    if (patchOn > 0.5 && pq.x > 0.0 && pq.x < 1.0 && pq.y > 0.0 && pq.y < 1.0) {
      vec2 e = min(pq, 1.0 - pq);
      float f = smoothstep(0.0, 0.05, min(e.x, e.y * 1.3));   // feathered edge
      day = mix(day, texture2D(patchMap, pq).rgb, f);
      water = mix(water, texture2D(patchWater, pq).r, f);
    }
    float cloud = texture2D(cloudMap, vec2(vUv.x + cloudOffset, vUv.y)).r;
    float shade = texture2D(cloudMap, vec2(vUv.x + cloudOffset + 0.0018, vUv.y + 0.0012)).r;

    vec3 col = day * (max(ndl, 0.0) * 1.45 + 0.012) * (1.0 - 0.35 * shade * lit);
    // sun glint on open water
    vec3 H = normalize(L + V);
    float glint = pow(max(dot(N, H), 0.0), 90.0) * water * (1.0 - cloud) * smoothstep(0.0, 0.15, ndl);
    col += vec3(1.0, 0.88, 0.70) * glint * 2.2;
    // clouds
    vec3 cloudCol = vec3(0.96, 0.97, 1.0) * (max(ndl, 0.0) * 1.35 + 0.006);
    col = mix(col, cloudCol, cloud * 0.85);
    // city lights on the night side, dimmed by cloud
    vec3 night = texture2D(nightMap, vUv).rgb * nightGain * (1.0 - cloud * 0.8);
    col += night * (1.0 - lit);
    // atmosphere: blue haze toward the lit limb, warm band along the terminator
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    col = mix(col, atmo * 1.2, fres * smoothstep(-0.25, 0.55, ndl) * 0.45);
    col += vec3(1.0, 0.45, 0.18) * exp(-pow(ndl * 5.0, 2.0)) * fres * 0.35;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// outer halo, drawn on the back faces of a slightly larger sphere; brighter on the sunlit side
const GLOW_FS = /* glsl */`
  uniform vec3 c, sunDir; uniform float a, edge;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main(){
    vec3 N = normalize(vN), V = normalize(cameraPosition - vP);
    float t = clamp(-dot(N, V) / edge, 0.0, 1.0);
    float s = 0.10 + 0.90 * smoothstep(-0.35, 0.55, dot(N, sunDir));
    gl_FragColor = vec4(c * pow(t, 2.4) * s * a, 1.0);
    #include <colorspace_fragment>
  }`;

// thin limb glow on the surface itself (Mars)
const RIM_FS = /* glsl */`
  uniform vec3 c, sunDir; uniform float a;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main(){
    vec3 N = normalize(vN), V = normalize(cameraPosition - vP);
    float f = pow(1.0 - max(0.0, dot(N, V)), 3.2) * smoothstep(-0.2, 0.5, dot(N, sunDir));
    gl_FragColor = vec4(c * f * a, 1.0);
    #include <colorspace_fragment>
  }`;

// procedural sky: faint galactic band with dust lanes and nebulae in the palette's hues
const SKY_VS = /* glsl */`
  varying vec3 vD;
  void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = /* glsl */`
  varying vec3 vD;
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < OCT; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
  void main(){
    vec3 d = normalize(vD);
    vec3 col = vec3(0.0012, 0.0018, 0.0030);
    float b = dot(d, normalize(vec3(0.32, 0.86, -0.40)));
    float band = exp(-b * b / 0.05);
    float n1 = fbm(d * 2.6 + 3.1), dust = smoothstep(0.42, 0.72, fbm(d * 6.5 - 1.7));
    col += vec3(0.010, 0.012, 0.017) * band * (0.4 + n1) * (1.0 - 0.7 * dust);
    float c1 = smoothstep(0.48, 0.85, fbm(d * 1.6 + vec3(7.0, 1.0, 3.0)));
    float c2 = smoothstep(0.50, 0.88, fbm(d * 1.9 + vec3(-4.0, 6.0, 2.0)));
    float c3 = smoothstep(0.54, 0.90, fbm(d * 2.2 + vec3(2.0, -5.0, 8.0)));
    col += vec3(0.004, 0.016, 0.011) * c1 + vec3(0.004, 0.009, 0.022) * c2 + vec3(0.018, 0.006, 0.003) * c3;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const STAR_VS = /* glsl */`
  attribute vec3 starColor; attribute float phase;
  uniform float uTime, size, pr; varying vec3 vC;
  void main(){
    vC = starColor * (0.7 + 0.3 * sin(uTime * (0.5 + phase) + phase * 6.2831));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pr;
  }`;
const STAR_FS = /* glsl */`
  varying vec3 vC;
  void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vC * a, a);
    #include <colorspace_fragment>
  }`;

// gold transfer route: moving dashes and a bright head travelling toward the target
const ROUTE_VS = /* glsl */`
  attribute float along; varying float vA;
  void main(){ vA = along; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ROUTE_FS = /* glsl */`
  uniform float uTime, alpha; uniform vec3 c; varying float vA;
  void main(){
    float dash = step(0.45, fract(vA * 34.0 - uTime * 0.8));
    float head = exp(-pow((vA - fract(uTime * 0.16)) * 22.0, 2.0));
    float ends = smoothstep(0.0, 0.06, vA) * smoothstep(1.0, 0.92, vA);
    gl_FragColor = vec4(c * (0.35 * dash + 2.4 * head) * ends * alpha, 1.0);
    #include <colorspace_fragment>
  }`;

function latLonLocal(lat, lon) { const p = lat * D2R, l = lon * D2R; return new THREE.Vector3(Math.cos(l) * Math.cos(p), Math.sin(p), -Math.sin(l) * Math.cos(p)); }
// yaw that turns a surface point toward a view direction
function faceYawFor(site, dir) { const v = latLonLocal(site.lat, site.lon); return Math.atan2(dir.x, dir.z) - Math.atan2(v.x, v.z); }
const wrapAngle = d => ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

export function createSpace(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x04060A, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  const manager = new THREE.LoadingManager();
  const loader = new THREE.TextureLoader(manager);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (file, color = true) => { const t = loader.load(TEX + file); if (color) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
  canvas.style.opacity = "0";

  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.copy(SUN).multiplyScalar(10);
  scene.add(sun, new THREE.AmbientLight(0x9fb2c8, 0.05));

  /* sky + stars */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), new THREE.ShaderMaterial({
    vertexShader: SKY_VS, fragmentShader: SKY_FS, defines: { OCT: 5 }, side: THREE.BackSide, depthWrite: false }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  const starMats = [];
  function stars(count, size, rMin, rMax, seed) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), ph = new Float32Array(count);
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin), q = Math.sqrt(1 - u * u);
      pos.set([r * q * Math.cos(th), r * u, r * q * Math.sin(th)], i * 3);
      const b = 0.25 + rnd() * 0.75, warm = rnd();
      col.set(warm > .85 ? [b, b * .84, b * .66] : warm < .18 ? [b * .74, b * .86, b] : [b, b, b], i * 3);
      ph[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("starColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("phase", new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, size: { value: size }, pr: { value: 1 } } });
    starMats.push(m);
    const p = new THREE.Points(g, m); p.frustumCulled = false; return p;
  }
  scene.add(stars(5200, 1.6, 180, 260, 7), stars(320, 3.0, 160, 240, 99));

  /* worlds */
  const meshes = {}, markers = {}, zoneU = {};
  const earthU = {
    dayMap: { value: tex("earth.jpg") }, nightMap: { value: tex("earth_night.jpg") },
    cloudMap: { value: tex("earth_clouds.jpg", false) }, waterMap: { value: tex("earth_water.jpg", false) },
    sunDir: { value: SUN }, atmo: { value: new THREE.Color(0x4f97ff) }, cloudOffset: { value: 0 }, nightGain: { value: 2.6 },
    patchMap: { value: null }, patchWater: { value: null }, patchOn: { value: 0 },
    patchBox: { value: new THREE.Vector4((PATCH.lon0 + 180) / 360, (PATCH.lat0 + 90) / 180, (PATCH.lon1 + 180) / 360, (PATCH.lat1 + 90) / 180) },
  };
  earthU.cloudMap.value.wrapS = THREE.RepeatWrapping;

  for (const [name, w] of Object.entries(WORLDS)) {
    const group = new THREE.Group(); group.position.copy(w.pos); scene.add(group);
    const mat = name === "earth"
      ? new THREE.ShaderMaterial({ vertexShader: WORLD_VS, fragmentShader: EARTH_FS, uniforms: earthU })
      : new THREE.MeshStandardMaterial({ map: tex(w.tex), bumpMap: tex(w.bump, false), bumpScale: w.bumpScale, roughness: 1, metalness: 0 });
    if (name !== "earth") {
      zoneU[name] = { zoneMap: { value: null }, zoneBump: { value: null }, zoneOn: { value: 0 },
        zoneBox: { value: new THREE.Vector4((JEZERO.lon0 + 180) / 360, (JEZERO.lat0 + 90) / 180, (JEZERO.lon1 + 180) / 360, (JEZERO.lat1 + 90) / 180) } };
      addZone(mat, name === "moon" ? "pole" : "box", zoneU[name]);
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(w.r, 192, 144), mat);
    mesh.name = name; group.add(mesh); meshes[name] = mesh;
    if (w.rim) group.add(new THREE.Mesh(new THREE.SphereGeometry(w.r * 1.003, 96, 64), new THREE.ShaderMaterial({
      vertexShader: WORLD_VS, fragmentShader: RIM_FS, uniforms: { c: { value: new THREE.Color(w.rim) }, a: { value: .55 * w.glowAmt }, sunDir: { value: SUN } },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })));
    if (w.glow) group.add(new THREE.Mesh(new THREE.SphereGeometry(w.r * w.glowScale, 96, 64), new THREE.ShaderMaterial({
      vertexShader: WORLD_VS, fragmentShader: GLOW_FS,
      uniforms: { c: { value: new THREE.Color(w.glow) }, a: { value: w.glowAmt }, edge: { value: Math.sqrt(1 - 1 / (w.glowScale * w.glowScale)) }, sunDir: { value: SUN } },
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })));
    markers[name] = siteMarker(mesh, w, SITES[name]);
  }

  /* sharper textures, swapped in after the first frame */
  const maxTex = renderer.capabilities.maxTextureSize;
  const small = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820;
  const tierNow = () => small || maxTex < 4096 ? 0 : fx.level === "high" && maxTex >= 8192 ? 2 : 1;
  const hdLoader = new THREE.TextureLoader(), have = {}, hdState = {};
  let firstPaint = false;
  function upgrade(key) {
    const file = HD[key][tierNow()];
    if (!firstPaint || !file || have[key] === file) return;
    have[key] = file;
    hdLoader.load(TEX + file, t => {
      if (have[key] !== file) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
      const swap = (holder, prop) => { const old = holder[prop]; holder[prop] = t; if (old && old !== t) old.dispose(); };
      if (key === "earth") swap(earthU.dayMap, "value");
      else if (key === "night") swap(earthU.nightMap, "value");
      else if (key === "arabia") {
        const ready = () => { swap(earthU.patchMap, "value"); earthU.patchOn.value = 1; };
        if (earthU.patchWater.value) ready();
        else hdLoader.load(TEX + "earth_arabia_water.jpg", w => { w.anisotropy = aniso; earthU.patchWater.value = w; ready(); });
      } else if (key === "moonPole") {
        const ready = () => { swap(zoneU.moon.zoneMap, "value"); zoneU.moon.zoneOn.value = 1; };
        hdLoader.load(TEX + "moon_pole_bump.jpg", bt => { zoneU.moon.zoneBump.value = bt; ready(); }, undefined, ready);
      } else if (key === "jezero") { swap(zoneU.mars.zoneMap, "value"); zoneU.mars.zoneOn.value = 1; }
      else swap(meshes[key].material, "map");
      hdState[key] = file;
    }, undefined, () => { if (have[key] === file) delete have[key]; });
  }
  // Earth first; Moon and Mars when the viewer is about to look at them
  function upgradeFor(m) {
    upgrade("arabia"); upgrade("earth"); upgrade("night");
    if (m === "director" || m === "focus-moon") { upgrade("moon"); upgrade("moonPole"); }
    if (m === "director" || m === "focus-mars") { upgrade("mars"); upgrade("jezero"); }
  }
  manager.onLoad = () => { canvas.style.opacity = ""; setTimeout(() => { firstPaint = true; upgradeFor(mode); }, 400); };

  // ring + pulse + dot sitting on the surface at a site, rotating with the world
  function siteMarker(mesh, w, site) {
    const n = latLonLocal(site.lat, site.lon), s = w.markSize;
    const g = new THREE.Group(); g.position.copy(n).multiplyScalar(w.r * 1.004);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const mk = (geo) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: w.mark, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const ring = mk(new THREE.RingGeometry(s * 0.78, s, 56)), pulse = mk(new THREE.RingGeometry(s * 0.93, s, 56)), dot = mk(new THREE.CircleGeometry(s * 0.2, 24));
    g.add(ring, pulse, dot); mesh.add(g);
    return { ring, pulse, dot, alpha: 0, goal: 0, g, size: 1 };
  }

  /* orbit arcs (Director) */
  const arcs = new THREE.Group(); scene.add(arcs);
  const sunPos = new THREE.Vector3(-15, 0, 11);
  function arc(center, through, normal, span, color, full = false) {
    const R = through.clone().sub(center).length(), u = through.clone().sub(center).normalize();
    const w = new THREE.Vector3().crossVectors(normal, u).normalize();
    const N = 220, pts = [], cols = [], c = new THREE.Color(color);
    for (let i = 0; i <= N; i++) {
      const a = full ? (i / N) * Math.PI * 2 : -span + (2 * span) * i / N;
      pts.push(center.clone().add(u.clone().multiplyScalar(R * Math.cos(a))).add(w.clone().multiplyScalar(R * Math.sin(a))));
      const fade = full ? .3 : Math.pow(Math.sin(Math.PI * i / N), 1.6) * .8;
      cols.push(c.r * fade, c.g * fade, c.b * fade);
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts); g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  }
  const ecl = new THREE.Vector3().crossVectors(WORLDS.earth.pos.clone().sub(sunPos), WORLDS.mars.pos.clone().sub(sunPos)).normalize();
  if (ecl.y < 0) ecl.negate();
  arcs.add(arc(sunPos, WORLDS.earth.pos, ecl, 0.45, 0x9fb2c8));
  arcs.add(arc(sunPos, WORLDS.mars.pos, ecl, 0.38, 0x9fb2c8));
  arcs.add(arc(WORLDS.earth.pos, WORLDS.moon.pos, new THREE.Vector3(0.12, 1, 0.2).normalize(), 0, 0x9fb2c8, true));
  let arcAlpha = 0, arcGoal = 0;

  /* gold transfer route Earth -> target world (Director) */
  const routeU = { uTime: { value: 0 }, alpha: { value: 0 }, c: { value: new THREE.Color(0xF2C46D) } };
  const route = new THREE.Line(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ vertexShader: ROUTE_VS, fragmentShader: ROUTE_FS, uniforms: routeU,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  route.frustumCulled = false; scene.add(route);
  let target = "mars";
  function buildRoute() {
    const A = WORLDS.earth.pos, B = WORLDS[target].pos, d = B.clone().sub(A), len = d.length(), dir = d.clone().normalize();
    const start = A.clone().addScaledVector(dir, WORLDS.earth.r * 1.15), end = B.clone().addScaledVector(dir, -WORLDS[target].r * 1.35);
    const lift = new THREE.Vector3().crossVectors(dir, ecl).cross(dir).negate().normalize();
    const ctrl = start.clone().lerp(end, .5).addScaledVector(ecl, len * .16).addScaledVector(lift, len * .05);
    const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end), N = 240, pts = curve.getPoints(N), along = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) along[i] = i / N;
    route.geometry.dispose(); route.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    route.geometry.setAttribute("along", new THREE.BufferAttribute(along, 1));
  }
  buildRoute();
  let routeAlpha = 0;

  /* yaw of each world */
  const viewDir = new THREE.Vector3(Math.sin(.42) * Math.cos(.34), Math.sin(.34), Math.cos(.42) * Math.cos(.34)).normalize();
  const faceYaw = faceYawFor(SITES.earth, viewDir);
  const marsView = new THREE.Vector3(-.2, .15, 1).normalize();
  const marsFace = faceYawFor(SITES.mars, marsView);
  let earthYaw = faceYaw - 1.2, marsYaw = 0.6;

  /* camera state */
  const cam = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), shift: 0 };
  const goal = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), shift: 0 };
  let mode = "orbit", prevMode = "orbit", settle = null, settleT = 0;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };

  function goalFor(m) {
    const narrow = innerWidth / innerHeight < 1.05;
    const tall = innerWidth / innerHeight < 0.75;   // phone held upright
    const E = WORLDS.earth.pos, M = WORLDS.moon.pos, R = WORLDS.mars.pos;
    switch (m) {
      // phone: whole Earth in the upper half, the title copy sits below it
      case "orbit": return tall ? { pos: E.clone().addScaledVector(viewDir, 6.4), tgt: E.clone().add(new THREE.Vector3(0, -0.95, 0)), shift: 0 }
                                : { pos: E.clone().addScaledVector(viewDir, narrow ? 3.9 : 2.7), tgt: E.clone(), shift: narrow ? 0 : 0.2 };
      // phone: the three worlds run corner to corner (Earth low left, Mars high right) above the brief panel
      case "director": return tall ? { pos: new THREE.Vector3(-6, 10, 10), tgt: new THREE.Vector3(1.5, -0.5, -0.5), shift: 0 }
                                   : { pos: new THREE.Vector3(3.4, 2.9, narrow ? 18 : 12.8), tgt: new THREE.Vector3(4.7, -0.3, -3.0), shift: 0 };
      case "focus-earth": return { pos: E.clone().addScaledVector(viewDir, 1.32), tgt: E.clone(), shift: 0 };
      // phone close-ups: the world sits in the upper half, above the dossier card
      // close-ups: down onto the target zone at a slant, so its horizon and the black sky show above it
      case "focus-moon": {
        const S = siteWorld("moon"), v = new THREE.Vector3(.3, -.62, 1).normalize();
        if (tall) return { pos: S.clone().addScaledVector(v, 0.30), tgt: S.clone().add(new THREE.Vector3(0, -0.075, 0)), shift: 0 };
        return { pos: S.clone().addScaledVector(v, narrow ? 0.24 : 0.17), tgt: S.clone().add(new THREE.Vector3(0, 0.012, 0)), shift: narrow ? 0 : 0.16 };
      }
      case "focus-mars": {
        // Jezero's real position once Mars has turned it toward the camera (the turn matches longitude, not latitude)
        const n = latLonLocal(SITES.mars.lat, SITES.mars.lon).applyAxisAngle(Y, marsFace), S = R.clone().addScaledVector(n, WORLDS.mars.r);
        const v = n.clone().add(new THREE.Vector3(0.08, 0.5, 0)).normalize();
        if (tall) return { pos: S.clone().addScaledVector(v, 0.52), tgt: S.clone().add(new THREE.Vector3(0, -0.13, 0)), shift: 0 };
        return { pos: S.clone().addScaledVector(v, narrow ? 0.42 : 0.30), tgt: S.clone().add(new THREE.Vector3(0, 0.02, 0)), shift: narrow ? 0 : 0.16 };
      }
      case "dive": {
        // straight down onto Oman, at about the height where the Oman map takes over
        const d = latLonLocal(OMAN.lat, OMAN.lon).applyAxisAngle(new THREE.Vector3(0, 1, 0), faceYaw);
        return { pos: E.clone().addScaledVector(d, 1.22), tgt: E.clone().addScaledVector(d, 0.9), shift: 0 };
      }
    }
  }
  function siteWorld(name) {
    const w = WORLDS[name], s = SITES[name];
    return latLonLocal(s.lat, s.lon).multiplyScalar(w.r).applyAxisAngle(Y, meshes[name].rotation.y).add(w.pos);
  }

  /* flights between places: pull back into space, cross, then close in (a cubic curve) */
  let flight = null;
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  function startFlight() {
    const from = cam.pos.clone(), L = from.distanceTo(goal.pos);
    if (reduceMotion || L < 1.0) { flight = null; return; }
    const back0 = from.clone().sub(cam.tgt).normalize(), back1 = goal.pos.clone().sub(goal.tgt).normalize();
    flight = {
      p0: from, p1: from.clone().addScaledVector(back0, Math.min(6, L * .45 + .6)),
      p2: goal.pos.clone().addScaledVector(back1, Math.min(6, L * .45 + .6)), p3: goal.pos.clone(),
      t0: cam.tgt.clone(), t1: goal.tgt.clone(), s0: cam.shift, s1: goal.shift,
      dur: Math.min(4.6, 2.3 + L * .14), t: 0,
    };
  }
  function flightStep(dt) {
    const f = flight; f.t = Math.min(1, f.t + dt / f.dur); const e = ease(f.t), u = 1 - e;
    cam.pos.set(0, 0, 0).addScaledVector(f.p0, u * u * u).addScaledVector(f.p1, 3 * u * u * e).addScaledVector(f.p2, 3 * u * e * e).addScaledVector(f.p3, e * e * e);
    const a = THREE.MathUtils.smootherstep(f.t, 0.12, 0.72);
    cam.tgt.copy(f.t0).lerp(f.t1, a); cam.shift = f.s0 + (f.s1 - f.s0) * e;
    camera.fov = 38 + 12 * Math.sin(Math.PI * f.t) ** 2; camera.updateProjectionMatrix();
    if (f.t >= 1) { flight = null; camera.fov = 38; camera.updateProjectionMatrix(); cam.pos.copy(goal.pos); cam.tgt.copy(goal.tgt); }
  }

  function setMode(m, instant = false) {
    mode = m; const g = goalFor(m); goal.pos.copy(g.pos); goal.tgt.copy(g.tgt); goal.shift = g.shift;
    upgradeFor(m);
    if (!instant && !reduceMotion && m !== prevMode) startFlight(); else flight = null;
    prevMode = m;
    arcGoal = m === "director" || m.startsWith("focus-m") ? 1 : 0;
    markers.earth.goal = m === "director" ? 1 : 0;
    markers.moon.goal = m === "focus-moon" ? 1 : m === "director" ? .75 : 0;
    markers.mars.goal = m === "focus-mars" ? 1 : m === "director" ? .75 : 0;
    if (instant || reduceMotion) {
      cam.pos.copy(goal.pos); cam.tgt.copy(goal.tgt); cam.shift = goal.shift; arcAlpha = arcGoal;
      if (m !== "director") earthYaw = faceYaw;
      if (m === "focus-mars") marsYaw = marsFace;
    }
    return new Promise(res => { settle = res; settleT = 0; });
  }

  /* post-processing (high graphics) */
  let composer = null, useComposer = false;
  function applyFx(level) {
    const high = level === "high";
    renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 2 : 1));
    if (high && !composer) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.6, 0.8));
      composer.addPass(new OutputPass());
    }
    useComposer = high;
    sky.material.defines.OCT = high ? 5 : 3; sky.material.needsUpdate = true;
    resize();
  }

  /* frame hooks */
  const frameFns = new Set();
  const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  let active = true, last = performance.now(), t = 0, raf = 0;

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
    starMats.forEach(m => { m.uniforms.pr.value = renderer.getPixelRatio(); });
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const g = goalFor(mode); goal.pos.copy(g.pos); goal.tgt.copy(g.tgt); goal.shift = g.shift;
  }
  addEventListener("resize", resize);
  addEventListener("pointermove", e => { pointer.x = e.clientX / innerWidth * 2 - 1; pointer.y = e.clientY / innerHeight * 2 - 1; });

  // frame-time watch: if "high" is too slow and the viewer never chose, drop to "low" once
  const watch = { n: 0, sum: 0, done: fx.chosen };
  function watchFrame(ms) {
    if (watch.done || document.hidden || fx.level !== "high" || canvas.style.opacity === "0") return;
    if (++watch.n <= 45) return;                       // let shaders compile and textures upload
    watch.sum += ms;
    if (watch.n >= 165) {
      watch.done = true;
      if (watch.sum / 120 > 34) { fx.set("low", false); toast("Switched to light graphics for smooth motion. Press G for full effects."); }
    }
  }

  const tmp = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!active) return;
    const ms = now - last, dt = Math.min(0.1, ms / 1000); last = now; t += dt;
    watchFrame(ms);
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * (mode === "dive" ? 2.9 : 2.3));
    if (flight) flightStep(dt);
    else { cam.pos.lerp(goal.pos, k); cam.tgt.lerp(goal.tgt, k); cam.shift += (goal.shift - cam.shift) * k; }
    arcAlpha += (arcGoal - arcAlpha) * k; arcs.children.forEach(l => { l.material.opacity = arcAlpha; });
    routeAlpha += ((mode === "director" ? 1 : 0) - routeAlpha) * k; routeU.alpha.value = routeAlpha; routeU.uTime.value = t;
    pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt * 3)); pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt * 3));

    // Earth: free spin in Director, Oman toward the camera elsewhere
    if (mode === "director") earthYaw += WORLDS.earth.spin * dt * 2;
    else { const want = faceYaw + (reduceMotion || mode === "dive" ? 0 : Math.sin(t * 0.12) * 0.10); earthYaw += wrapAngle(want - earthYaw) * k; }
    meshes.earth.rotation.y = earthYaw;
    if (!reduceMotion) earthU.cloudOffset.value = (earthU.cloudOffset.value + dt * 0.0022) % 1;
    // Mars: Jezero toward the camera when focused
    if (mode === "focus-mars") marsYaw += wrapAngle(marsFace - marsYaw) * k; else marsYaw += WORLDS.mars.spin * dt;
    meshes.mars.rotation.y = marsYaw;
    if (mode !== "focus-moon") meshes.moon.rotation.y += WORLDS.moon.spin * dt;   // hold still while we look at the pole

    // site markers fade in and pulse
    const pulse = reduceMotion ? 0.4 : (t * 0.42) % 1;
    for (const m of Object.values(markers)) {
      m.alpha += (m.goal - m.alpha) * k;
      m.ring.material.opacity = m.alpha * 0.95; m.dot.material.opacity = m.alpha;
      m.pulse.scale.setScalar(1 + pulse * 1.6); m.pulse.material.opacity = m.alpha * (1 - pulse) * 0.8;
      const near = (mode === "focus-moon" && m === markers.moon) || (mode === "focus-mars" && m === markers.mars);
      m.size += ((near ? 0.42 : 1) - m.size) * k; m.g.scale.setScalar(m.size);
    }
    starMats.forEach(m => { m.uniforms.uTime.value = reduceMotion ? 0 : t; });

    // camera with pointer parallax
    camera.position.copy(cam.pos);
    camera.lookAt(cam.tgt);
    if (!reduceMotion && !flight) {
      const dist = cam.pos.distanceTo(cam.tgt), amt = mode === "director" ? 0.35 : (mode.startsWith("focus-m") ? 0.02 : 0.06) * dist;
      right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
      camera.position.addScaledVector(right, pointer.sx * amt).addScaledVector(up, -pointer.sy * amt * 0.6);
      camera.lookAt(cam.tgt);
    }
    const w = innerWidth, h = innerHeight;
    if (Math.abs(cam.shift) > 0.001) camera.setViewOffset(w, h, -cam.shift * w, 0, w, h); else camera.clearViewOffset();
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);

    if (settle && !flight) { settleT += dt; if (cam.pos.distanceTo(goal.pos) < 0.02 * Math.max(1, goal.pos.distanceTo(goal.tgt)) || settleT > 3) { const s = settle; settle = null; s(); } }
    frameFns.forEach(fn => fn());
    if (useComposer) composer.render(dt); else renderer.render(scene, camera);
  }

  function project(v) {
    tmp.copy(v).project(camera);
    return { x: (tmp.x * .5 + .5) * innerWidth, y: (-tmp.y * .5 + .5) * innerHeight, front: tmp.z < 1 };
  }
  function surfacePoint(name, lat, lon) {
    const w = WORLDS[name], p = latLonLocal(lat, lon).multiplyScalar(w.r).applyAxisAngle(Y, meshes[name].rotation.y).add(w.pos);
    const facing = p.clone().sub(w.pos).dot(camera.position.clone().sub(p)) > 0;
    return { ...project(p), facing };
  }

  applyFx(fx.level);
  fx.subscribe(applyFx);
  fx.subscribe(() => upgradeFor(mode));   // switching to high graphics fetches the 8K set
  setMode("orbit", true); raf = requestAnimationFrame(tick);

  return {
    get mode() { return mode; },
    get flying() { return !!flight; },
    setMode,
    setActive(on) { active = on; last = performance.now(); },
    // which world the gold route points at ("moon" or "mars")
    setTarget(name) { if (name !== target && WORLDS[name]) { target = name; buildRoute(); } },
    onFrame(fn) { frameFns.add(fn); return () => frameFns.delete(fn); },
    pick(clientX, clientY) {
      ndc.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(Object.values(meshes), false)[0];
      return hit ? hit.object.name : null;
    },
    // screen position + on-screen radius of a world
    world(name) {
      const w = WORLDS[name], c = project(w.pos);
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      const e = project(tmp.copy(w.pos).addScaledVector(right, w.r));
      return { ...c, r: Math.hypot(e.x - c.x, e.y - c.y) };
    },
    // screen position of a world's target site, and whether it faces the camera
    sitePoint(name) { const s = SITES[name]; return surfacePoint(name, s.lat, s.lon); },
    earthPoint(lat, lon) { return surfacePoint("earth", lat, lon); },
    // which sharper textures are in use (for the debug hooks)
    get textures() { return { tier: tierNow(), maxTex, ...hdState }; },
  };
}
