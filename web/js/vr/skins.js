// Sky, sun, haze and image-based lighting per world. The sun direction comes from the terrain tile
// (terrain.json "sun"), so real-time light matches the shadows baked into the tile's colour image.
import * as THREE from "three";

export const SKINS = {
  oman: { label: "Oman", top: 0x2f6db5, horizon: 0xcfd9e0, ground: 0x6b5a48, sun: 0xfff3e2, sunI: 3.0, hemiSky: 0xbcd4f0, hemiGround: 0x6b5238, hemiI: .35,
          fog: 0xc9d3da, fogD: .00032, exposure: .95, stars: false, earth: false, env: .9, sunAz: 118, sunEl: 40 },
  moon: { label: "Moon", top: 0x000000, horizon: 0x020203, ground: 0x2a2a2a, sun: 0xffffff, sunI: 5.5, hemiSky: 0x3a4048, hemiGround: 0x1b1b1e, hemiI: .45,
          fog: 0x000000, fogD: 0, exposure: 1.0, stars: true, earth: true, env: .35, sunAz: 250, sunEl: 5 },
  mars: { label: "Mars", top: 0x7d5b45, horizon: 0xd2a477, ground: 0x6e3c27, sun: 0xfff0dc, sunI: 2.7, hemiSky: 0xd8a882, hemiGround: 0x5a2c18, hemiI: .35,
          fog: 0xc19069, fogD: .00055, exposure: 1.0, stars: false, earth: false, env: .8, sunAz: 255, sunEl: 38 },
};

const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const SKY_FS = `uniform vec3 top, horizon, ground, sunDir, sunCol; uniform float glow, disc; varying vec3 vDir;
  void main(){
    vec3 d = normalize(vDir);
    vec3 c = mix(horizon, top, pow(max(d.y, 0.0), 0.5));
    c = mix(c, ground, smoothstep(0.0, -0.08, d.y));
    float s = max(dot(d, sunDir), 0.0);
    c += sunCol * (smoothstep(0.99985, 0.99993, s) * disc + pow(s, 14.0) * 0.28 * glow + pow(s, 400.0) * 0.6 * glow);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function skyMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunCol: { value: new THREE.Color(1, 1, 1) }, glow: { value: 1 }, disc: { value: 6 } } });
}

export function createSky(scene, renderer) {
  const skyMat = skyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat); sky.frustumCulled = false; sky.renderOrder = -10;

  const N = 2600, sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    sp[i * 3] = r * Math.cos(a) * 1800; sp[i * 3 + 1] = Math.abs(u) * 1800 - 60; sp[i * 3 + 2] = r * Math.sin(a) * 1800; }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, fog: false }));

  const earthTex = new THREE.TextureLoader().load("assets/textures/earth.jpg"); earthTex.colorSpace = THREE.SRGBColorSpace;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(30, 48, 24), new THREE.MeshStandardMaterial({ map: earthTex, roughness: 1, fog: false, envMapIntensity: 0 }));
  earth.userData.offset = new THREE.Vector3();

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -175; sc.right = 175; sc.top = 175; sc.bottom = -175; sc.near = 10; sc.far = 1600;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.5;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(sky, stars, earth, sun, sun.target, hemi);

  // image-based lighting: render a copy of the sky into a pre-filtered environment map
  const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), envMat = skyMaterial();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat); envScene.add(envSky);
  let envRT = null;
  function bakeEnv() {
    for (const k of Object.keys(skyMat.uniforms)) { const v = skyMat.uniforms[k].value; envMat.uniforms[k].value = v.clone ? v.clone() : v; }
    envMat.uniforms.disc.value = 30;                       // a bright sun spot gives metals their highlight
    envRT?.dispose(); envRT = pmrem.fromScene(envScene, 0.02); scene.environment = envRT.texture;
  }
  function dispose() { envRT?.dispose(); pmrem.dispose(); envMat.dispose(); envSky.geometry.dispose(); earthTex.dispose(); starGeo.dispose(); }
  return { sky, skyMat, stars, earth, sun, hemi, bakeEnv, dispose };
}

export function applySkin(name, { scene, renderer, sky, terrain }) {
  const k = SKINS[name], s = terrain?.meta?.sun || { az: k.sunAz, el: k.sunEl };
  const el = THREE.MathUtils.degToRad(s.el), az = THREE.MathUtils.degToRad(s.az);
  // azimuth clockwise from north (-z, top of the tile), east = +x
  const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
  const U = sky.skyMat.uniforms;
  U.top.value.set(k.top); U.horizon.value.set(k.horizon); U.ground.value.set(k.ground);
  U.sunDir.value.copy(dir); U.sunCol.value.set(k.sun); U.glow.value = name === "moon" ? 0 : 1; U.disc.value = name === "moon" ? 10 : 6;
  sky.sun.position.copy(dir).multiplyScalar(700); sky.sun.target.position.set(0, 0, 0);
  sky.sun.color.set(k.sun); sky.sun.intensity = k.sunI;
  sky.hemi.color.set(k.hemiSky); sky.hemi.groundColor.set(k.hemiGround); sky.hemi.intensity = k.hemiI;
  scene.fog = k.fogD ? new THREE.FogExp2(k.fog, k.fogD) : null;
  renderer.toneMappingExposure = k.exposure;
  sky.stars.visible = k.stars; sky.earth.visible = k.earth;
  // Earth hangs low in the lunar sky on the side opposite the sun, so we see its lit face
  sky.earth.userData.offset.set(-dir.x, 0, -dir.z).normalize().multiplyScalar(1500).setY(150);
  sky.bakeEnv();
  if (terrain) {
    for (const m of [terrain.material, terrain.far.material]) m.envMapIntensity = k.env * .5;
    terrain.material.normalScale.setScalar(name === "moon" ? .14 : .5);              // grazing lunar light exaggerates relief
    terrain.rockMat.color.set(name === "moon" ? 0x9a9894 : name === "mars" ? 0x8a5a40 : 0x6e6258); terrain.rockMat.envMapIntensity = k.env * .5;
  }
  return { ...k, dir };
}
