// ORBIT: the opening shot. Earth fills the right side with Oman turned to camera.
import { h, setKeys, fmt } from "../core/ui.js";
import { MISSIONS, MISSION_KEYS, CRITERIA } from "../core/data.js";
import { OMAN } from "../space/scene.js";

export default {
  mount({ view, scene, data, store, go }) {
    scene.setActive(true); scene.setMode("orbit");
    const nSites = data.sites[store.mission].length;
    const nBench = data.sites[store.mission].filter(s => s.benchmark).length;

    const root = h("section", { class: "orbit", "aria-labelledby": "orbit-h" });
    root.innerHTML = `
      <div class="orbit-copy live">
        <p class="eyebrow">NASA Space Apps 2026 · Earth analogs for the Moon and Mars</p>
        <h1 id="orbit-h"><span>Oman</span><span>Analog</span><span>Atlas</span></h1>
        <p class="orbit-tag">Where Earth rehearses <b id="oWorld"></b>.</p>
        <p class="orbit-lede">Before crews go to the Moon or Mars they rehearse on Earth. Using satellite data, we find the places in Oman that are most like their destination, and show why.</p>
        <ol class="how3">
          <li><a href="#director"><b>1</b> Choose where astronauts are going</a></li>
          <li><a href="#destinations"><b>2</b> See the place</a></li>
          <li><a href="#destinations"><b>3</b> Meet its Oman twin, and why</a></li>
        </ol>
        <hr class="moho">
        <dl class="stats">
          <div><dt>${nSites}</dt><dd>Sites scored</dd></div>
          <div><dt>${CRITERIA.length}</dt><dd>Things compared</dd></div>
          <div><dt>${MISSION_KEYS.length}</dt><dd>Missions</dd></div>
          <div><dt>${nBench}</dt><dd>Known analog sites</dd></div>
        </dl>
        <div class="cta">
          <a class="btn primary" href="#director">Choose a mission <kbd>Enter</kbd></a>
          <a class="btn" href="#oman">Go to Oman</a>
          <a class="btn" href="#method">How the score works</a>
        </div>
      </div>
      <div class="pin" id="pin" aria-hidden="true">
        <div class="ring"></div><div class="lead"></div>
        <div class="lbl"><b>Oman</b><span>Samail ophiolite · ${fmt(OMAN.lat, 1)}° N ${fmt(OMAN.lon, 1)}° E</span></div>
      </div>`;
    view.appendChild(root);

    const world = root.querySelector("#oWorld");
    const paint = () => { world.textContent = MISSIONS[store.mission].worldName; };
    paint();
    const unsub = store.subscribe(paint);

    const pin = root.querySelector("#pin");
    const off = scene.onFrame(() => {
      const p = scene.earthPoint(OMAN.lat, OMAN.lon);
      pin.style.transform = `translate(${p.x}px, ${p.y}px)`;
      pin.style.opacity = p.facing ? 1 : 0;
    });

    const onKey = e => { if (e.key === "Enter" && !e.target.closest("a, button, input")) go("#director"); };
    addEventListener("keydown", onKey);
    setKeys([["Enter", "Choose a mission"], ["M", "Mission"]]);

    return { cleanup() { off(); unsub(); removeEventListener("keydown", onKey); } };
  },
};
