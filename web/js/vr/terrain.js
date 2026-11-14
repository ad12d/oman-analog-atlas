// VR terrain: loads the engine-neutral tile (data/vr/<site>/height.png + terrain.json, made by
// pipeline/make_vr_terrain.py), answers height / slope / roughness queries in metres, and builds
// the mesh with baked detail (object-space normal map, ambient occlusion, tiling grain).
// The same queries drive the landing hazard check and the camp rules, so the result is backed
// by the terrain data itself (the drone LiDAR once it is flown; a placeholder until then).
import * as THREE from "three";
import { noise2, fbm } from "../core/noise.js";

async function fetchTile(dir) {
  const r = await fetch(dir + "terrain.json"); if (!r.ok) throw new Error("no tile");
  const meta = await r.json();
  const blob = await (await fetch(dir + "height.png")).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const px = cx.getImageData(0, 0, bmp.width, bmp.height).data, N = bmp.width;
  const H = new Float32Array(N * N), k = (meta.z_max - meta.z_min) / 65535;
  for (let i = 0; i < N * N; i++) H[i] = meta.z_min + (px[i * 4] * 256 + px[i * 4 + 1]) * k;
  return { meta, H, N };
}

export async function loadTerrain(siteId) {
  let tile = null;
  for (const dir of [siteId && `data/vr/${siteId}/`, "data/vr/mock/"].filter(Boolean)) {
    try { tile = await fetchTile(dir); break; } catch { /* try the next one */ }
  }
  if (!tile) throw new Error("VR terrain tile missing (run pipeline/make_vr_terrain.py --mock)");
  return makeTerrain(tile);
}

/* plane fit (least squares z = a x + b y + c) over a disc: slope, roughness, relief */
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

export function makeTerrain({ meta, H, N }) {
  const S = meta.size_m, res = S / (N - 1), half = S / 2;

  function heightAt(x, z) {
    let fi = (x + half) / res, fj = (z + half) / res;
    fi = Math.min(N - 1.001, Math.max(0, fi)); fj = Math.min(N - 1.001, Math.max(0, fj));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, o = j * N + i;
    return (H[o] * (1 - u) + H[o + 1] * u) * (1 - v) + (H[o + N] * (1 - u) + H[o + N + 1] * u) * v;
  }
  /** slope (deg), roughness (m RMS about the best plane), relief (m) over a disc of radius r */
  function stats(x, z, r) {
    const step = Math.max(res, r / 8), out = [];
    for (let dz = -r; dz <= r + 1e-6; dz += step) for (let dx = -r; dx <= r + 1e-6; dx += step)
      if (dx * dx + dz * dz <= r * r) out.push([dx, dz, heightAt(x + dx, z + dz)]);
    return planeStats(out);
  }
  const inside = (x, z, m = 0) => Math.abs(x) < half - m && Math.abs(z) < half - m;

  /* ---------- mesh ---------- */
  const SEG = 255;
  const geo = new THREE.PlaneGeometry(S, S, SEG, SEG); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, heightAt(pos.getX(k), pos.getZ(k)));
  geo.computeVertexNormals(); geo.computeBoundingSphere();

  /* ---------- baked textures (T x T over the whole tile) ---------- */
  const T = 1024, tr = S / T, micro = noise2(91, 64), grainN = noise2(17, 32);
  const fine = new Float32Array((T + 2) * (T + 2));            // heights + sub-metre rock relief
  for (let j = -1; j <= T; j++) for (let i = -1; i <= T; i++) {
    const x = -half + (i + .5) * tr, z = -half + (j + .5) * tr;
    fine[(j + 1) * (T + 2) + (i + 1)] = heightAt(x, z) + 0.09 * (fbm(micro, x * .35, z * .35, 4) - .5);
  }
  const F = (i, j) => fine[(j + 1) * (T + 2) + (i + 1)];
  const nrm = new Uint8Array(T * T * 4), alb = new Uint8Array(T * T * 4), slopeImg = new Uint8Array(T * T * 4);
  const slopeDeg = new Float32Array(T * T);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const dx = (F(i + 1, j) - F(i - 1, j)) / (2 * tr), dz = (F(i, j + 1) - F(i, j - 1)) / (2 * tr);
    let nx = -dx, ny = 1, nz = -dz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (j * T + i) * 4;
    nrm[o] = (nx * .5 + .5) * 255; nrm[o + 1] = (ny * .5 + .5) * 255; nrm[o + 2] = (nz * .5 + .5) * 255; nrm[o + 3] = 255;
    slopeDeg[j * T + i] = Math.acos(ny) * 180 / Math.PI;
  }
  // ambient occlusion: horizon angle in 8 directions on a coarser grid, then sampled per texel
  const A = 256, ar = S / A, ao = new Float32Array(A * A);
  for (let j = 0; j < A; j++) for (let i = 0; i < A; i++) {
    const x = -half + (i + .5) * ar, z = -half + (j + .5) * ar, h0 = heightAt(x, z); let occ = 0;
    for (let d = 0; d < 8; d++) {
      const a = d * Math.PI / 4, cx = Math.cos(a), cz = Math.sin(a); let mx = 0;
      for (let s = 1; s <= 10; s++) { const r = s * s * .6; const t = (heightAt(x + cx * r, z + cz * r) - h0) / r; if (t > mx) mx = t; }
      occ += Math.atan(mx) / (Math.PI / 2);
    }
    ao[j * A + i] = 1 - Math.min(.75, occ / 8 * 1.6);
  }
  const aoAt = (u, v) => { const fi = Math.min(A - 1.001, u * A - .5 < 0 ? 0 : u * A - .5), fj = Math.min(A - 1.001, v * A - .5 < 0 ? 0 : v * A - .5);
    const i = Math.floor(fi), jj = Math.floor(fj), a = fi - i, b = fj - jj, o = jj * A + i;
    return (ao[o] * (1 - a) + ao[o + 1] * a) * (1 - b) + (ao[o + A] * (1 - a) + ao[o + A + 1] * a) * b; };
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const o = (j * T + i) * 4, x = -half + (i + .5) * tr, z = -half + (j + .5) * tr, sd = slopeDeg[j * T + i];
    const rock = Math.min(1, Math.max(0, (sd - 14) / 16));                 // steep = darker bedrock, flat = paler gravel
    const g = fbm(grainN, x * .9, z * .9, 3), patch = fbm(grainN, x * .04 + 9, z * .04 + 3, 3);
    let lum = (0.78 - 0.26 * rock + 0.18 * (patch - .5) + 0.10 * (g - .5)) * aoAt((i + .5) / T, (j + .5) / T);
    lum = Math.max(.08, Math.min(1, lum)) * 255;
    alb[o] = lum; alb[o + 1] = lum * (0.985 - 0.02 * rock); alb[o + 2] = lum * (0.96 - 0.04 * rock); alb[o + 3] = 255;
    // slope overlay colours (team rule bands): green < 5°, amber 5–10°, red > 10°
    const c = sd < 5 ? [70, 190, 120] : sd < 10 ? [235, 175, 60] : [215, 75, 55];
    const m = .62; slopeImg[o] = lum * (1 - m) + c[0] * m; slopeImg[o + 1] = lum * (1 - m) + c[1] * m; slopeImg[o + 2] = lum * (1 - m) + c[2] * m; slopeImg[o + 3] = 255;
  }
  const tex = (data, srgb) => { const t = new THREE.DataTexture(data, T, T); t.flipY = false; t.needsUpdate = true;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; return t; };
  // PlaneGeometry rotated -90° about X: uv v runs from +z (v=0) to -z (v=1); our rows run -z..+z, so flip v in the texture lookup
  for (const g of [geo]) { const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - uv.getY(k)); }
  const normalTex = tex(nrm, false), albedoTex = tex(alb, true), slopeTex = tex(slopeImg, true);

  // tiling grain for close-up detail (standing on the ground)
  const D = 256, det = new Uint8Array(D * D * 4), dn = noise2(5, 32);
  for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
    const v = fbm(dn, i / D * 32, j / D * 32, 5), o = (j * D + i) * 4;
    det[o] = det[o + 1] = det[o + 2] = 128 + (v - .5) * 200; det[o + 3] = 255;
  }
  const detailTex = new THREE.DataTexture(det, D, D); detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.minFilter = THREE.LinearMipmapLinearFilter; detailTex.generateMipmaps = true; detailTex.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({ map: albedoTex, normalMap: normalTex, normalMapType: THREE.ObjectSpaceNormalMap, roughness: .96, metalness: 0 });
  material.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detailTex };
    sh.fragmentShader = "uniform sampler2D detailMap;\n" + sh.fragmentShader.replace("#include <map_fragment>",
      `#include <map_fragment>
       float dA = texture2D(detailMap, vMapUv * 180.0).r, dB = texture2D(detailMap, vMapUv * 23.0).r;
       diffuseColor.rgb *= 0.62 + 0.5 * dA * 0.75 + 0.5 * dB * 0.45;`);
  };
  const mesh = new THREE.Mesh(geo, material); mesh.receiveShadow = true; mesh.castShadow = true; mesh.name = "terrain";

  /* ---------- scattered boulders (one draw call), more on steep ground ---------- */
  const rockGeo = new THREE.IcosahedronGeometry(1, 1), rp = rockGeo.attributes.position, rn = noise2(3, 8);
  for (let k = 0; k < rp.count; k++) { const x = rp.getX(k), y = rp.getY(k), z = rp.getZ(k), f = .7 + .55 * fbm(rn, x * 2 + 4, z * 2 + y * 3 + 4, 2); rp.setXYZ(k, x * f, y * f * .7, z * f); }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: .92, flatShading: true });
  const ROCKS = 1100, rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS); rocks.castShadow = true; rocks.receiveShadow = true;
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
  let placed = 0;
  for (let tries = 0; placed < ROCKS && tries < ROCKS * 12; tries++) {
    const x = (rnd() - .5) * (S - 4), z = (rnd() - .5) * (S - 4), st = stats(x, z, 1.5).slope;
    if (rnd() > (st < 4 ? .06 : Math.min(1, st / 22))) continue;      // few on the flat benches, scree on slopes
    const s = .12 + Math.pow(rnd(), 3) * (st > 15 ? 1.1 : .55);
    e.set(rnd() * 6, rnd() * 6, rnd() * 6); q.setFromEuler(e); sc.set(s * (0.8 + rnd() * .5), s, s * (0.8 + rnd() * .5));
    p3.set(x, heightAt(x, z) + s * .25, z); m4.compose(p3, q, sc); rocks.setMatrixAt(placed++, m4);
  }
  rocks.count = placed; rocks.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group(); group.add(mesh, rocks);

  function setOverlay(on) { material.map = on ? slopeTex : albedoTex; material.needsUpdate = true; }

  /** best landing spots: lowest slope + roughness over a pad radius, spread apart */
  function suggestPads(r, n = 3, near = null, within = 90) {
    const cands = [];
    for (let z = -half + r + 6; z < half - r - 6; z += 4) for (let x = -half + r + 6; x < half - r - 6; x += 4) {
      if (near && Math.hypot(x - near.x, z - near.z) > within) continue;
      const s = stats(x, z, r); cands.push({ x, z, score: s.slope / 5 + s.roughness / .15, s });
    }
    cands.sort((a, b) => a.score - b.score);
    const out = [];
    for (const c of cands) { if (out.every(o => Math.hypot(o.x - c.x, o.z - c.z) > r * 5)) out.push(c); if (out.length >= n) break; }
    return out;
  }

  function dispose() { geo.dispose(); material.dispose(); [normalTex, albedoTex, slopeTex, detailTex].forEach(t => t.dispose()); rockGeo.dispose(); rockMat.dispose(); }

  return { meta, size: S, half, heightAt, stats, inside, group, mesh, material, rocks, rockMat, setOverlay, suggestPads, dispose };
}

/* exported for the unit check */
export { planeStats };
