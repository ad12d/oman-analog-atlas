// Small DOM + formatting helpers shared by every view.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

export function h(tag, attrs = {}, html = "") {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("--")) el.style.setProperty(k, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  if (html) el.innerHTML = html;
  return el;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = (v, dp = 2) => (v < 0 ? "−" : "") + Math.abs(+v).toFixed(dp);
export const hexRgb = (hex) => { hex = hex.trim().replace("#", ""); return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)); };
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* tooltip */
const tip = () => document.getElementById("tip");
export function showTip(html, x, y) {
  const t = tip(); t.innerHTML = html; t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 16, top = y + 16;
  if (left + r.width > innerWidth - 8) left = x - r.width - 16;
  if (top + r.height > innerHeight - 8) top = y - r.height - 16;
  t.style.left = Math.max(8, left) + "px"; t.style.top = Math.max(8, top) + "px";
}
export const hideTip = () => { tip().hidden = true; };
export function bindTip(el, fn) {
  el.addEventListener("pointermove", e => showTip(fn(), e.clientX, e.clientY));
  el.addEventListener("pointerleave", hideTip);
  el.addEventListener("focus", () => { const r = el.getBoundingClientRect(); showTip(fn(), r.left + r.width / 2, r.bottom); });
  el.addEventListener("blur", hideTip);
}

/* toast */
let toastTimer = 0;
export function toast(text) {
  const t = document.getElementById("toast"); t.textContent = text; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 1800);
}

/* key hints in the bottom bar */
export function setKeys(list) {
  document.getElementById("keys").innerHTML = list.map(([k, label]) => `<span><kbd>${esc(k)}</kbd>${esc(label)}</span>`).join("");
}

/* ramp colour */
export function rampColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const seg = (stops.length - 1) * t, i = Math.min(stops.length - 2, Math.floor(seg)), f = seg - i;
  const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]);
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
