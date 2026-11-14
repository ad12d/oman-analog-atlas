// VR terrain from a real tile (pipeline/make_vr_worlds.py or make_vr_terrain.py):
//   height.png (16-bit packed) + albedo.jpg (colour with baked AO / sun shadows) + terrain.json.
// Two meshes: the FAR mesh covers the whole tile (real horizon mountains), the NEAR mesh is the
// landing area around the tile centre at ~1.25 m spacing with fine roughness, rock grain and boulders.
// heightAt / stats() answer in metres and drive the landing hazard check and the camp rules.
import * as THREE from "three";
import { noise2, fbm } from "../core/noise.js";

async function decodeImage(url) {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}
async function fetchTile(dir) {
  const r = await fetch(dir + "terrain.json"); if (!r.ok) throw new Error("no tile at " + dir);
  const meta = await r.json();
  const bmp = await decodeImage(dir + "height.png");
  const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const px = cx.getImageData(0, 0, bmp.width, bmp.height).data, N = bmp.width;
  const H = new Float32Array(N * N), k = (meta.z_max - meta.z_min) / 65535;
  for (let i = 0; i < N * N; i++) H[i] = meta.z_min + (px[i * 4] * 256 + px[i * 4 + 1]) * k;
  let albedo = null;
  if (meta.albedo) { try { albedo = await createImageBitmap(await (await fetch(dir + meta.albedo)).blob(), { imageOrientation: "none" }); } catch { /* shaded grey fallback */ } }
  return { meta, H, N, albedo };
}

/** dirs: candidate folders in priority order (e.g. LiDAR tile first, then the satellite tile, then the placeholder) */
export async function loadTerrain(dirs) {
  for (const dir of dirs.filter(Boolean)) { try { return makeTerrain(await fetchTile(dir)); } catch { /* next */ } }
  throw new Error("VR terrain tile missing");
}

/* plane fit (least squares z = a x + b y + c) over a disc: slope, roughness, relief, bumps */
function planeStats(samples) {
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, lo = Infinity, hi = -Infinity;
  for (const [x, y, z] of samples) {
    n++; sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z;
    if (z < lo) lo = z; if (z > hi) hi = z;
  }
  const mx = sx / n, my = sy / n, mz = sz / n;
  const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my, cxz = sxz / n - mx * mz, cyz = syz / n - my * mz;
  const det = cxx * cyy - cxy * cxy || 1e-9;
  const a = (cxz * cyy - cyz * cxy) / det, b = (cyz * cxx - cxz * cxy) / det;
  let r2 = 0, elo = Infinity, ehi = -Infinity;
  for (const [x, y, z] of samples) { const e = z - (mz + a * (x - mx) + b * (y - my)); r2 += e * e; if (e < elo) elo = e; if (e > ehi) ehi = e; }
  // relief = total height range; bumps = range left after removing the slope (unevenness)
  return { slope: Math.atan(Math.hypot(a, b)) * 180 / Math.PI, roughness: Math.sqrt(r2 / n), relief: hi - lo, bumps: ehi - elo, mean: mz, a, b };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function makeTerrain({ meta, H, N, albedo }) {
  const S = meta.size_m, half = S / 2, res = S / (N - 1);
  const NEAR = Math.min(meta.near_m || 320, S * .9), nh = NEAR / 2;
  const DET = meta.detail_m ?? .2, micro = noise2(91, 64), meso = noise2(37, 32);

  /* ---------- heights: bicubic (Catmull-Rom) over the grid + fine roughness in the near area ---------- */
  const at = (i, j) => H[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  const cr = (p0, p1, p2, p3, t) => p1 + .5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  function base(x, z) {
    const fi = Math.min(N - 1.001, Math.max(0, (x + half) / res)), fj = Math.min(N - 1.001, Math.max(0, (z + half) / res));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const r = k => cr(at(i - 1, j + k), at(i, j + k), at(i + 1, j + k), at(i + 2, j + k), u);
    return cr(r(-1), r(0), r(1), r(2), v);
  }
  const fade = (x, z) => 1 - smooth(nh - 45, nh - 5, Math.max(Math.abs(x), Math.abs(z)));
  function detail(x, z) {
    return DET * (1.6 * (fbm(meso, x * .045, z * .045, 3) - .5) + .9 * (fbm(micro, x * .3, z * .3, 3) - .5));
  }
  function heightAt(x, z) { const f = fade(x, z); return f > 0 ? base(x, z) + detail(x, z) * f : base(x, z); }
  function stats(x, z, r) {
    const step = Math.max(.6, r / 8), out = [];
    for (let dz = -r; dz <= r + 1e-6; dz += step) for (let dx = -r; dx <= r + 1e-6; dx += step)
      if (dx * dx + dz * dz <= r * r) out.push([dx, dz, heightAt(x + dx, z + dz)]);
    return planeStats(out);
  }
  const inside = (x, z, m = 0) => Math.abs(x) < half - m && Math.abs(z) < half - m;
  const inNear = (x, z, m = 0) => Math.abs(x) < nh - m && Math.abs(z) < nh - m;

  /* ---------- textures ---------- */
  let albedoTex;
  if (albedo) { albedoTex = new THREE.Texture(albedo); albedoTex.flipY = false; }
  else {   // no imagery: neutral grey
    const d = new Uint8Array([150, 148, 145, 255]); albedoTex = new THREE.DataTexture(d, 1, 1); albedoTex.flipY = false;
  }
  albedoTex.colorSpace = THREE.SRGBColorSpace; albedoTex.anisotropy = 8; albedoTex.needsUpdate = true;
  albedoTex.wrapS = albedoTex.wrapT = THREE.ClampToEdgeWrapping;

  // tiling grain (colour) + tiling detail normal map (tangent space) for the ground at your feet
  const D = 256, grain = new Uint8Array(D * D * 4), nrm = new Uint8Array(D * D * 4), gN = noise2(5, 32), hD = new Float32Array(D * D);
  for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
    const u = i / D * 32, v = j / D * 32, pebble = Math.pow(fbm(gN, u * 1.7 + 3, v * 1.7 + 9, 3), 3);
    hD[j * D + i] = fbm(gN, u, v, 5) * .6 + pebble * 1.4;
    const g = 128 + (fbm(gN, u * .5 + 7, v * .5 + 2, 4) - .5) * 150 + (pebble - .1) * 90, o = (j * D + i) * 4;
    grain[o] = grain[o + 1] = grain[o + 2] = Math.max(0, Math.min(255, g)); grain[o + 3] = 255;
  }
  for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
    const hx = hD[j * D + (i + 1) % D] - hD[j * D + (i + D - 1) % D], hy = hD[((j + 1) % D) * D + i] - hD[((j + D - 1) % D) * D + i];
    let nx = -hx * 1.5, ny = -hy * 1.5, nz = 1; const l = Math.hypot(nx, ny, nz), o = (j * D + i) * 4;
    nrm[o] = (nx / l * .5 + .5) * 255; nrm[o + 1] = (ny / l * .5 + .5) * 255; nrm[o + 2] = (nz / l * .5 + .5) * 255; nrm[o + 3] = 255;
  }
  const tiled = (data, srgb) => { const t = new THREE.DataTexture(data, D, D); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t; };
  const grainTex = tiled(grain, false), detailNormal = tiled(nrm, false);

  // shared shader patch: tile-space albedo uv, grain at two scales, slope overlay bands
  const overlay = { value: 0 };
  function patch(mat, near) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.grainMap = { value: grainTex }; sh.uniforms.uOverlay = overlay; sh.uniforms.uTile = { value: S };
      sh.vertexShader = "varying float vSlopeY; varying vec2 vTileUv;\n" + sh.vertexShader
        .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n vSlopeY = normalize(objectNormal).y;")
        .replace("#include <uv_vertex>", `#include <uv_vertex>\n vTileUv = vec2((position.x + ${half.toFixed(3)}) / ${S.toFixed(3)}, (position.z + ${half.toFixed(3)}) / ${S.toFixed(3)});`);
      sh.fragmentShader = "uniform sampler2D grainMap; uniform float uOverlay, uTile; varying float vSlopeY; varying vec2 vTileUv;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        `vec4 sampledDiffuseColor = texture2D(map, vTileUv); diffuseColor *= sampledDiffuseColor;
         ${near ? `vec2 tp = vTileUv * uTile; float gA = texture2D(grainMap, tp / 2.7).r, gB = texture2D(grainMap, mat2(0.8, -0.6, 0.6, 0.8) * tp / 9.3).r,
           gC = texture2D(grainMap, mat2(0.28, 0.96, -0.96, 0.28) * tp / 31.0).r;
         diffuseColor.rgb *= 0.66 + 0.28 * gA + 0.24 * gB + 0.2 * gC;` : ""}
         if (uOverlay > 0.5) { float sd = degrees(acos(clamp(vSlopeY, 0.0, 1.0)));
           vec3 oc = sd < 5.0 ? vec3(0.22, 0.75, 0.42) : sd < 10.0 ? vec3(0.95, 0.68, 0.2) : vec3(0.88, 0.25, 0.18);
           diffuseColor.rgb = mix(diffuseColor.rgb, oc, 0.6); }`);
    };
  }

  /* ---------- FAR mesh: whole tile, hole cut where the near mesh is ---------- */
  const SEG = 255, farGeo = new THREE.PlaneGeometry(S, S, SEG, SEG); farGeo.rotateX(-Math.PI / 2);
  const fp = farGeo.attributes.position;
  for (let k = 0; k < fp.count; k++) fp.setY(k, base(fp.getX(k), fp.getZ(k)));
  { const idx = [], V = SEG + 1, cut = nh - 14;
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      if ([a, b, c, d].every(v => Math.abs(fp.getX(v)) < cut && Math.abs(fp.getZ(v)) < cut)) continue;
      idx.push(a, c, b, b, c, d);
    }
    farGeo.setIndex(idx); }
  farGeo.computeVertexNormals();
  const farMat = new THREE.MeshStandardMaterial({ map: albedoTex, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  patch(farMat, false);
  const far = new THREE.Mesh(farGeo, farMat); far.receiveShadow = true; far.name = "terrain-far";

  /* ---------- NEAR mesh: landing area ---------- */
  const NS = 255, nearGeo = new THREE.PlaneGeometry(NEAR, NEAR, NS, NS); nearGeo.rotateX(-Math.PI / 2);
  const np = nearGeo.attributes.position, nuv = nearGeo.attributes.uv;
  for (let k = 0; k < np.count; k++) { const x = np.getX(k), z = np.getZ(k); np.setY(k, heightAt(x, z)); nuv.setXY(k, x / 3.3, z / 3.3); }
  nearGeo.computeVertexNormals(); nearGeo.computeTangents();
  const nearMat = new THREE.MeshStandardMaterial({ map: albedoTex, normalMap: detailNormal, normalScale: new THREE.Vector2(.55, .55), roughness: .97, metalness: 0 });
  patch(nearMat, true);
  const near = new THREE.Mesh(nearGeo, nearMat); near.receiveShadow = true; near.castShadow = true; near.name = "terrain";

  /* ---------- boulders in the landing area (one draw call) ---------- */
  const rockGeo = new THREE.IcosahedronGeometry(1, 2), rp = rockGeo.attributes.position, rn = noise2(3, 8);
  for (let k = 0; k < rp.count; k++) { const x = rp.getX(k), y = rp.getY(k), z = rp.getZ(k), f = .62 + .7 * fbm(rn, x * 1.6 + 4, z * 1.6 + y * 2.2 + 4, 3); rp.setXYZ(k, x * f, y * f * .62, z * f); }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: .9, map: grainTex });
  const ROCKS = 900, rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS); rocks.castShadow = true; rocks.receiveShadow = true;
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
  let placed = 0;
  for (let tries = 0; placed < ROCKS && tries < ROCKS * 10; tries++) {
    const x = (rnd() - .5) * (NEAR - 20), z = (rnd() - .5) * (NEAR - 20), st = stats(x, z, 1.5).slope;
    if (rnd() > (st < 5 ? .12 : Math.min(1, .2 + st / 25))) continue;           // fewer on flat ground, scree on slopes
    const s = .1 + Math.pow(rnd(), 3.2) * (st > 15 ? 1.3 : .6);
    e.set(rnd() * 6, rnd() * 6, rnd() * 6); q.setFromEuler(e); sc.set(s * (0.8 + rnd() * .6), s, s * (0.8 + rnd() * .6));
    p3.set(x, heightAt(x, z) + s * .18, z); m4.compose(p3, q, sc); rocks.setMatrixAt(placed++, m4);
  }
  rocks.count = placed; rocks.instanceMatrix.needsUpdate = true;

  /* ---------- pebbles around the viewer: fixed per 4 m cell, re-laid as you walk ---------- */
  const pebGeo = new THREE.IcosahedronGeometry(1, 0), PEB = 2600, peb = new THREE.InstancedMesh(pebGeo, rockMat, PEB); peb.castShadow = false; peb.receiveShadow = true;
  peb.frustumCulled = false; let pebAt = null;
  function updatePebbles(px, pz) {
    const C = 4, R = 30, ci = Math.floor(px / C), cj = Math.floor(pz / C);
    if (pebAt && pebAt[0] === ci && pebAt[1] === cj) return; pebAt = [ci, cj];
    let k = 0; const span = Math.ceil(R / C);
    for (let dj = -span; dj <= span && k < PEB; dj++) for (let di = -span; di <= span && k < PEB; di++) {
      if (di * di + dj * dj > span * span) continue;
      const I = ci + di, J = cj + dj; let h = (I * 73856093) ^ (J * 19349663); const r = () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) ^ Math.imul(h ^ (h >>> 13), 3266489917)) >>> 0) / 4294967296;
      for (let n = 0; n < 15 && k < PEB; n++) {
        const x = (I + r()) * C, z = (J + r()) * C; if (!inNear(x, z, 3)) { r(); r(); continue; }
        const s = .025 + Math.pow(r(), 2.6) * .16;
        e.set(r() * 6, r() * 6, r() * 6); q.setFromEuler(e); sc.set(s * (0.8 + r() * .7), s * .6, s * (0.8 + r() * .7));
        p3.set(x, heightAt(x, z) + s * .1, z); m4.compose(p3, q, sc); peb.setMatrixAt(k++, m4);
      }
    }
    peb.count = k; peb.instanceMatrix.needsUpdate = true;
  }
  updatePebbles(0, 0);

  const group = new THREE.Group(); group.add(far, near, rocks, peb);
  function setOverlay(on) { overlay.value = on ? 1 : 0; }

  /** best landing spots in the near area: lowest slope + roughness over a pad radius, spread apart */
  function suggestPads(r, n = 3) {
    const cands = [], lim = nh - r - 25;
    for (let z = -lim; z <= lim; z += 5) for (let x = -lim; x <= lim; x += 5) {
      const s = stats(x, z, r); cands.push({ x, z, score: s.slope / 5 + s.roughness / .15 + s.bumps / 1.2, s });
    }
    cands.sort((a, b) => a.score - b.score);
    const out = [];
    for (const c of cands) { if (out.every(o => Math.hypot(o.x - c.x, o.z - c.z) > r * 6)) out.push(c); if (out.length >= n) break; }
    return out;
  }
  let maxH = -Infinity; for (const v of H) if (v > maxH) maxH = v;

  function dispose() {
    [farGeo, nearGeo, rockGeo, pebGeo].forEach(g => g.dispose()); [farMat, nearMat, rockMat].forEach(m => m.dispose());
    [albedoTex, grainTex, detailNormal].forEach(t => t.dispose()); albedo?.close?.();
  }

  return { meta, size: S, half, near: NEAR, updatePebbles, maxHeight: maxH, heightAt, stats, inside, inNear, group, mesh: near, far, material: nearMat, rocks, rockMat, setOverlay, suggestPads, dispose };
}

/* exported for the unit check */
export { planeStats };
