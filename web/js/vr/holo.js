// MISSION CONTROL HOLO-TABLE: the website's atlas inside VR. Left: the live Oman analog-score map for the chosen
// mission with the top sites; right: the mission card (destination, journey, rehearsal site, strongest matches).
// Point at a site on the map and press to make it your rehearsal site.
import * as THREE from "three";
import { computeASI, render, defaultWeights } from "../core/live.js";

const W = 2048, H = 1152, MAP = { x: 48, y: 150, w: 940, h: 940 };
const wrap = (c, text, x, y, w, lh, max = 9) => {
  const words = String(text).split(" "); let line = "", n = 0;
  for (const wd of words) { const t = line ? line + " " + wd : wd; if (c.measureText(t).width > w && line) { c.fillText(line, x, y); y += lh; line = wd; if (++n >= max) return y; } else line = t; }
  if (line) c.fillText(line, x, y); return y + lh;
};

export function createHolo(scene) {
  const g = new THREE.Group(); g.visible = false; scene.add(g);
  const glow = new THREE.MeshBasicMaterial({ color: 0xf2c46d, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: .4, metalness: .8 });
  // table: a pedestal and a glowing rim
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(.35, .5, .9, 24), metal); ped.position.y = .45; ped.castShadow = true; g.add(ped);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, .06, 48), metal); top.position.y = .93; g.add(top);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, .015, 8, 64), glow); rim.rotation.x = Math.PI / 2; rim.position.y = .965; g.add(rim);
  // the screen floating above the table, tilted back toward the viewer
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.35), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, fog: false, side: THREE.DoubleSide }));
  screen.position.set(0, 1.85, 0); screen.rotation.x = -.12; g.add(screen);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, .9, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xf2c46d, transparent: true, opacity: .05, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  beam.position.y = 1.4; g.add(beam);

  const cache = new Map();
  let last = null, sitesPx = [];
  /** the base map for a mission: dim land plus the best 30 % of Oman in the mission's colours */
  function baseMap(G, mission, ramp) {
    if (cache.has(mission)) return cache.get(mission);
    const s = computeASI(G, mission, defaultWeights(G, mission));
    const land = document.createElement("canvas"); land.width = G.W; land.height = G.H;
    const lx = land.getContext("2d"), img = lx.createImageData(G.W, G.H);
    for (let i = 0; i < G.N; i++) if (Number.isFinite(s.asi[i])) { const o = i * 4; img.data[o] = 52; img.data[o + 1] = 58; img.data[o + 2] = 66; img.data[o + 3] = 255; }
    lx.putImageData(img, 0, 0);
    lx.drawImage(render(G, s, { topPct: 30, ramp, showExcluded: false }).canvas, 0, 0);
    cache.set(mission, land); return land;
  }

  /**
   * draw({ G, mission, label, ramp, sites, site, card }) — card: { dest, world, journey, why, matches: [{name, pct}] }
   */
  function draw(o) {
    last = o;
    const c = cv.getContext("2d");
    c.clearRect(0, 0, W, H);
    c.fillStyle = "rgba(6,9,13,.9)"; c.beginPath(); c.roundRect(0, 0, W, H, 36); c.fill();
    c.strokeStyle = "rgba(242,196,109,.6)"; c.lineWidth = 4; c.stroke();
    c.fillStyle = "#f2c46d"; c.font = "600 34px 'IBM Plex Mono', monospace"; c.fillText("MISSION CONTROL · OMAN ANALOG ATLAS", 48, 70);
    c.fillStyle = "#9ba3ad"; c.font = "500 26px 'IBM Plex Mono', monospace"; c.fillText(`${o.label.toUpperCase()} · BEST 30% OF OMAN FOR THIS MISSION`, 48, 116);
    // map
    sitesPx = [];
    if (o.G) {
      const m = baseMap(o.G, o.mission, o.ramp), sc = Math.min(MAP.w / o.G.W, MAP.h / o.G.H), mw = o.G.W * sc, mh = o.G.H * sc, mx = MAP.x + (MAP.w - mw) / 2, my = MAP.y + (MAP.h - mh) / 2;
      c.imageSmoothingEnabled = false; c.drawImage(m, mx, my, mw, mh); c.imageSmoothingEnabled = true;
      for (const s of o.sites.slice(0, 10)) {
        const [px, py] = o.G.toPx(s.lonlat[0], s.lonlat[1]), x = mx + px * sc, y = my + py * sc, on = s.id === o.site.id;
        sitesPx.push({ id: s.id, x, y });
        c.fillStyle = on ? "#f2c46d" : "rgba(233,230,223,.9)"; c.strokeStyle = "#0d0f12"; c.lineWidth = 4;
        c.beginPath(); c.arc(x, y, on ? 16 : 11, 0, 7); c.fill(); c.stroke();
        c.fillStyle = "#0d0f12"; c.font = "700 16px 'IBM Plex Mono', monospace"; c.textAlign = "center"; c.fillText(String(s.rank), x, y + 6); c.textAlign = "left";
        if (on) { c.strokeStyle = "#f2c46d"; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 34, 0, 7); c.stroke();
          c.fillStyle = "#f2c46d"; c.font = "600 28px 'Space Grotesk', sans-serif"; c.fillText(o.site.name, Math.min(x + 44, MAP.x + MAP.w - 380), y - 26); }
      }
      c.fillStyle = "#9ba3ad"; c.font = "400 22px 'IBM Plex Sans', sans-serif"; c.fillText("Point at a numbered site and press to choose your rehearsal site. Scores: team analysis (90 m).", MAP.x, MAP.y + MAP.h + 34);
    } else { c.fillStyle = "#9ba3ad"; c.font = "400 30px 'IBM Plex Sans', sans-serif"; c.fillText("Loading the Oman map…", MAP.x + 40, MAP.y + 80); }
    // mission card
    const X = 1040, CW = W - X - 56; let y = 190;
    const k = o.card;
    c.fillStyle = "#9ba3ad"; c.font = "500 24px 'IBM Plex Mono', monospace"; c.fillText("DESTINATION", X, y); y += 52;
    c.fillStyle = "#e9e6df"; c.font = "700 50px 'Space Grotesk', sans-serif"; y = wrap(c, k.dest, X, y, CW, 56, 2) + 4;
    c.fillStyle = k.world === "moon" ? "#7DB7FF" : "#E07250"; c.font = "600 30px 'Space Grotesk', sans-serif"; c.fillText(k.worldLine, X, y); y += 64;
    c.fillStyle = "#9ba3ad"; c.font = "500 24px 'IBM Plex Mono', monospace"; c.fillText("HOW WE GET THERE", X, y); y += 42;
    c.fillStyle = "#e9e6df"; c.font = "400 30px 'IBM Plex Sans', sans-serif"; y = wrap(c, k.journey, X, y, CW, 38, 2) + 22;
    c.fillStyle = "#9ba3ad"; c.font = "500 24px 'IBM Plex Mono', monospace"; c.fillText("REHEARSAL SITE IN OMAN", X, y); y += 46;
    c.fillStyle = "#f2c46d"; c.font = "700 40px 'Space Grotesk', sans-serif"; c.fillText(`${o.site.name}`, X, y);
    c.font = "700 64px 'IBM Plex Mono', monospace"; c.textAlign = "right"; c.fillText(String(Math.round(o.site.asi * 100)), W - 56, y + 6); c.textAlign = "left";
    c.fillStyle = "#9ba3ad"; c.font = "500 22px 'IBM Plex Mono', monospace"; c.fillText("ANALOG SCORE / 100", W - 300, y + 40); y += 70;
    for (const mt of k.matches) {
      c.fillStyle = "#e9e6df"; c.font = "500 28px 'IBM Plex Sans', sans-serif"; c.fillText(mt.name, X, y);
      c.fillStyle = "rgba(255,255,255,.12)"; c.fillRect(X + 330, y - 20, CW - 430, 18); c.fillStyle = mt.color || "#f2c46d"; c.fillRect(X + 330, y - 20, (CW - 430) * mt.pct / 100, 18);
      c.fillStyle = "#9ba3ad"; c.font = "500 24px 'IBM Plex Mono', monospace"; c.textAlign = "right"; c.fillText(mt.pct + "%", W - 56, y); c.textAlign = "left"; y += 46;
    }
    y += 14; c.fillStyle = "#c9cdd2"; c.font = "italic 400 27px 'IBM Plex Sans', sans-serif"; wrap(c, k.why, X, y, CW, 36, 4);
    tex.needsUpdate = true;
  }
  /** the site under a ray hit on the screen (uv), if any */
  function pick(uv) {
    const x = uv.x * W, y = (1 - uv.y) * H; let best = null, bd = 40;
    for (const s of sitesPx) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s.id; } }
    return best;
  }
  function place(x, y, z, faceX, faceZ) { g.position.set(x, y, z); g.rotation.set(0, Math.atan2(faceX - x, faceZ - z), 0); }
  let t = 0;
  return { group: g, screen, draw, pick, place, redraw() { if (last) draw(last); },
    update(dt) { t += dt; rim.material.opacity = .4 + .2 * Math.sin(t * 2); beam.material.opacity = .04 + .02 * Math.sin(t * 1.3); },
    dispose() { scene.remove(g); tex.dispose(); g.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); } };
}
