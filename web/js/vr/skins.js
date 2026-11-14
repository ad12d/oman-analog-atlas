// Sky, light and ground tint for the three worlds. The terrain never changes between skins:
// the same Oman ground is shown under Earth, Moon and Mars conditions (the analog idea).
import * as THREE from "three";

export const SKINS = {
  oman: {
    label: "Oman", top: 0x3d74b8, horizon: 0xd9c9ac, ground: 0x9a7a58, rock: 0x6f5f52,
    sunEl: 38, sunAz: 120, sun: 0xfff1dc, sunI: 3.2, hemiSky: 0xbcd4f0, hemiGround: 0x6b5238, hemiI: .9,
    fog: 0xd8c9ae, fogD: .0016, exposure: 1.0, stars: false, earth: false, dust: 0xc9a77c, drag: 2.2,
  },
  moon: {
    label: "Moon", top: 0x000000, horizon: 0x020203, ground: 0x8d8b88, rock: 0x6c6a68,
    sunEl: 7, sunAz: 250, sun: 0xffffff, sunI: 5.0, hemiSky: 0x4a5058, hemiGround: 0x2a2a2e, hemiI: .7,
    fog: 0x000000, fogD: 0, exposure: 1.05, stars: true, earth: true, dust: 0xa9a7a3, drag: 0,
  },
  mars: {
    label: "Mars", top: 0x8f6a4e, horizon: 0xd7a777, ground: 0xa65c38, rock: 0x6e3c27,
    sunEl: 24, sunAz: 200, sun: 0xfff0dd, sunI: 2.6, hemiSky: 0xd8a882, hemiGround: 0x5a2c18, hemiI: .75,
    fog: 0xc29068, fogD: .0028, exposure: 1.0, stars: false, earth: false, dust: 0xb07048, drag: 1.2,
  },
};

const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const SKY_FS = `uniform vec3 top, horizon, sunDir, sunCol; uniform float glow; varying vec3 vDir;
  void main(){
    vec3 d = normalize(vDir); float h = clamp(d.y, -0.2, 1.0);
    vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
    float s = max(dot(d, sunDir), 0.0);
    c += sunCol * (pow(s, 900.0) * 4.0 + pow(s, 12.0) * 0.25 * glow);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createSky(scene) {
  const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) }, glow: { value: 1 } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat); sky.frustumCulled = false; sky.renderOrder = -10;

  // stars (Moon sky)
  const N = 2400, sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    sp[i * 3] = r * Math.cos(a) * 900; sp[i * 3 + 1] = Math.abs(u) * 900 - 40; sp[i * 3 + 2] = r * Math.sin(a) * 900; }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false }));

  // Earth hanging low over the lunar horizon (reuses the globe texture)
  const earthTex = new THREE.TextureLoader().load("assets/textures/earth.jpg"); earthTex.colorSpace = THREE.SRGBColorSpace;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(14, 48, 24), new THREE.MeshStandardMaterial({ map: earthTex, roughness: 1, fog: false }));
  earth.userData.offset = new THREE.Vector3(715, 75, 260);   // opposite the Moon-skin sun, so the lit side faces the viewer

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 1; sc.far = 700;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(sky, stars, earth, sun, sun.target, hemi);
  return { sky, skyMat, stars, earth, sun, hemi };
}

export function applySkin(name, { scene, renderer, sky, terrain }) {
  const k = SKINS[name];
  const el = THREE.MathUtils.degToRad(k.sunEl), az = THREE.MathUtils.degToRad(k.sunAz);
  const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
  sky.skyMat.uniforms.top.value.set(k.top); sky.skyMat.uniforms.horizon.value.set(k.horizon);
  sky.skyMat.uniforms.sunDir.value.copy(dir); sky.skyMat.uniforms.sunCol.value.set(k.sun).multiplyScalar(name === "moon" ? .6 : 1);
  sky.skyMat.uniforms.glow.value = name === "moon" ? 0 : 1;
  sky.sun.position.copy(dir).multiplyScalar(400); sky.sun.target.position.set(0, 0, 0);
  sky.sun.color.set(k.sun); sky.sun.intensity = k.sunI;
  sky.hemi.color.set(k.hemiSky); sky.hemi.groundColor.set(k.hemiGround); sky.hemi.intensity = k.hemiI;
  scene.fog = k.fogD ? new THREE.FogExp2(k.fog, k.fogD) : null;
  renderer.toneMappingExposure = k.exposure;
  sky.stars.visible = k.stars; sky.earth.visible = k.earth;
  terrain.material.color.set(k.ground); terrain.rockMat.color.set(k.rock);
  return { ...k, dir };
}
