// Shared PBR materials for the lander and camp, with procedural detail maps (no stock assets):
// crinkled multi-layer insulation foil, woven habitat fabric, solar cells, tyre tread.
// They pick up the sky's environment map, so metal and foil reflect each world's light.
import * as THREE from "three";
import { noise2, fbm } from "../core/noise.js";

function dataTex(size, fn, { repeat = 1, srgb = false } = {}) {
  const d = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) { const o = (j * size + i) * 4, c = fn(i / size, j / size, i, j); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
  const t = new THREE.DataTexture(d, size, size); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function normalFromHeight(size, hf, strength, repeat) {
  const H = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) H[j * size + i] = hf(i / size, j / size);
  const at = (i, j) => H[((j + size) % size) * size + ((i + size) % size)];
  return dataTex(size, (u, v, i, j) => {
    let nx = -(at(i + 1, j) - at(i - 1, j)) * strength, ny = -(at(i, j + 1) - at(i, j - 1)) * strength, nz = 1; const l = Math.hypot(nx, ny, nz);
    return [(nx / l * .5 + .5) * 255, (ny / l * .5 + .5) * 255, (nz / l * .5 + .5) * 255];
  }, { repeat });
}

let cache = null;
export function vrMaterials() {
  if (cache) return cache;
  const n1 = noise2(11, 16), n2 = noise2(23, 32);
  // crinkled foil: ridged noise at two scales gives sharp folds
  const crinkle = normalFromHeight(256, (u, v) => { const r = 1 - Math.abs(2 * fbm(n1, u * 16, v * 16, 3) - 1); return r * r * .7 + .3 * (1 - Math.abs(2 * fbm(n2, u * 32 + 5, v * 32, 2) - 1)); }, 4, 5);
  // woven fabric: two crossing sine weaves
  const weave = normalFromHeight(128, (u, v) => .5 + .25 * Math.sin(u * Math.PI * 2 * 24) * Math.sign(Math.sin(v * Math.PI * 2 * 12)) + .25 * Math.sin(v * Math.PI * 2 * 24) * Math.sign(Math.sin(u * Math.PI * 2 * 12)), 2.2, 6);
  // solar cells: dark blue cells with silver gaps and bus bars
  const cells = dataTex(256, (u, v) => {
    const cu = (u * 8) % 1, cv = (v * 4) % 1, gap = cu < .04 || cv < .06, bus = Math.abs(cu - .5) < .01;
    const g = .9 + .2 * fbm(n2, u * 40, v * 40, 2);
    return gap ? [175, 180, 188] : bus ? [120, 128, 140] : [18 * g, 30 * g, 70 * g];
  }, { srgb: true });
  const tread = normalFromHeight(64, (u, v) => (Math.sin(u * Math.PI * 2 * 10) > .2 ? 1 : 0) * (Math.abs(v - .5) < .42 ? 1 : 0), 3, 1);

  const M = {
    foilGold: new THREE.MeshStandardMaterial({ color: 0xd8ad4a, metalness: 1, roughness: .3, normalMap: crinkle, normalScale: new THREE.Vector2(.5, .5) }),
    foilSilver: new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: .26, normalMap: crinkle, normalScale: new THREE.Vector2(.45, .45) }),
    paint: new THREE.MeshStandardMaterial({ color: 0xe8e6e1, metalness: 0, roughness: .55 }),
    paintGrey: new THREE.MeshStandardMaterial({ color: 0x9da2a8, metalness: .2, roughness: .5 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1d1f23, metalness: .3, roughness: .6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb4b9c0, metalness: .95, roughness: .3 }),
    titanium: new THREE.MeshStandardMaterial({ color: 0x8e9196, metalness: .9, roughness: .45 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x3b3430, metalness: .7, roughness: .55, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1420, metalness: .1, roughness: .05, emissive: 0x0a1622, emissiveIntensity: .6 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0xebe7dc, metalness: 0, roughness: .85, normalMap: weave, normalScale: new THREE.Vector2(.45, .45) }),
    strap: new THREE.MeshStandardMaterial({ color: 0xcfc6b2, metalness: 0, roughness: .8 }),
    cells: new THREE.MeshStandardMaterial({ map: cells, metalness: .5, roughness: .22 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: .6, roughness: .55, normalMap: tread }),
    orange: new THREE.MeshStandardMaterial({ color: 0xe0612a, roughness: .5 }),
    lampG: new THREE.MeshBasicMaterial({ color: 0x40ff90 }), lampR: new THREE.MeshBasicMaterial({ color: 0xff4030 }), lampW: new THREE.MeshBasicMaterial({ color: 0xfff4e0 }),
  };
  cache = M; return M;
}

/** helper: a strut (cylinder) between two points */
export function strut(a, b, r, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), mat);
  m.position.copy(a).lerp(b, .5); m.scale.y = a.distanceTo(b);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true; m.receiveShadow = true; return m;
}
