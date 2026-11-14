// Graphics quality: "high" (bloom, full resolution) or "low" (no post-processing, 1x pixels).
// Order of precedence: ?fx=high|low in the URL > the viewer's saved choice > a device guess.
// The scene may drop to "low" on its own if frames are slow and the viewer never chose.
const KEY = "oaa.fx";
const subs = new Set();

function saved() { try { return localStorage.getItem(KEY); } catch { return null; } }
function guess() {
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
  const small = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820;
  return small || (cores <= 4 && mem <= 4) ? "low" : "high";
}

const urlFx = new URLSearchParams(location.search).get("fx");
let level = urlFx === "high" || urlFx === "low" ? urlFx : (saved() === "high" || saved() === "low" ? saved() : guess());
let chosen = !!urlFx || saved() === "high" || saved() === "low";

export const fx = {
  get level() { return level; },
  get chosen() { return chosen; },
  set(next, byViewer = true) {
    if (next === level) return;
    level = next;
    if (byViewer) { chosen = true; try { localStorage.setItem(KEY, next); } catch { /* storage blocked */ } }
    subs.forEach(fn => fn(level));
  },
  toggle() { this.set(level === "high" ? "low" : "high"); },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};
