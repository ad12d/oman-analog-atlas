// MISSION SOUND: everything is synthesised live with the Web Audio API (no sound files):
//   surroundings  Oman: gusty desert wind · Mars: thin, hissing wind · Moon: vacuum, so only your suit is heard
//   your suit     fan hum and breathing
//   spacecraft    cabin hum, sonar-style telemetry pings with echo, short data chirps
//   rockets       launch roar, engine burns, the lander's descent engine (placed in 3D) and the touchdown thud
//   on the ground hatch hiss, ladder clanks, footsteps (muffled on the Moon), construction robots, rover, drill, beacons
//   narrator      the browser's own speech voice reads what is happening; mission-control lines are framed by
//                 Quindar tones, the two short beeps (2525 Hz / 2475 Hz) heard on Apollo radio transmissions
import * as THREE from "three";

const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* storage blocked */ } } };

/** stable key of a narration line (FNV-1a), shared by the site and the recording script */
export function voiceKey(t) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0"); }
/** how a line should be read aloud: symbols spelled out */
export function spoken(t) {
  return String(t).replace(/·/g, ",").replace(/×/g, " times ").replace(/m\/s²/g, " metres per second squared").replace(/−/g, "minus ")
    .replace(/°C/g, " degrees Celsius").replace(/°/g, " degrees").replace(/km\/h/g, " kilometres per hour").replace(/(\d),(\d{3})/g, "$1$2");
}

export function createAudio() {
  let ctx = null, master, amb, sfx, voiceGain, noiseW, noiseB, echo;
  let soundOn = store.get("oaa.vr.sound", true), voiceOn = store.get("oaa.vr.voice", true);
  const layers = {}, timers = new Set();
  let ambKind = null, suitOn = false;

  /* ---------- set-up (needs a click or Enter VR first: browsers block sound until then) ---------- */
  function start() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = soundOn ? .9 : 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    amb = ctx.createGain(); amb.connect(master); sfx = ctx.createGain(); sfx.connect(master);
    voiceGain = ctx.createGain(); voiceGain.connect(master);
    noiseW = buffer(2, () => Math.random() * 2 - 1);
    let last = 0; noiseB = buffer(4, () => (last = (last + .02 * (Math.random() * 2 - 1)) / 1.02) * 3.5);   // brown noise
    // a short echo for the telemetry pings
    echo = ctx.createDelay(1); echo.delayTime.value = .32; const fb = ctx.createGain(); fb.gain.value = .38; const wet = ctx.createGain(); wet.gain.value = .45;
    echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(sfx);
    const k = ambKind; ambKind = null; if (k) ambience(k);
    if (suitOn) { suitOn = false; suit(true); }
  }
  function buffer(sec, fn) { const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = fn(i); return b; }
  function loopNoise(brown = false) { const s = ctx.createBufferSource(); s.buffer = brown ? noiseB : noiseW; s.loop = true; s.start(); return s; }
  function filt(type, f, q = .7) { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; }
  function gainNode(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function lfo(freq, depth, target) { const o = ctx.createOscillator(), g = gainNode(depth); o.frequency.value = freq; o.connect(g); g.connect(target); o.start(); return o; }
  const now = () => ctx.currentTime;
  function every(ms, fn) { const id = setInterval(() => { if (ctx && soundOn) fn(); }, ms); timers.add(id); return id; }

  /* ---------- background layers, cross-faded ---------- */
  function fadeOut(layer, sec = 1.5) {
    if (!layer) return; layer.out.gain.setTargetAtTime(0, now(), sec / 3);
    setTimeout(() => { layer.nodes.forEach(n => { try { n.stop?.(); } catch { /* already stopped */ } n.disconnect?.(); }); layer.ids?.forEach(id => { clearInterval(id); timers.delete(id); }); }, sec * 1000 + 300);
  }
  function build(kind) {
    const out = gainNode(0), nodes = [], ids = []; out.connect(amb);
    if (kind === "oman" || kind === "mars") {                       // wind: brown noise through a moving band-pass, with gusts
      const mars = kind === "mars", src = loopNoise(true), bp = filt("bandpass", mars ? 950 : 420, mars ? 1.3 : .6), g = gainNode(mars ? .12 : .32);
      src.connect(bp); bp.connect(g); g.connect(out);
      nodes.push(src, lfo(.07, mars ? 260 : 180, bp.frequency), lfo(.13, mars ? .06 : .16, g.gain));
      if (mars) { const hiss = loopNoise(), hp = filt("highpass", 3200), hg = gainNode(.025); hiss.connect(hp); hp.connect(hg); hg.connect(out); nodes.push(hiss, lfo(.21, .015, hg.gain)); }
    } else if (kind === "moon") {                                    // vacuum: almost nothing, a faint electrical hum from the suit radio
      const o = ctx.createOscillator(); o.frequency.value = 120; const g = gainNode(.006); o.connect(g); g.connect(out); o.start(); nodes.push(o);
    } else if (kind === "cabin") {                                   // spacecraft: low drone, air, telemetry pings and data chirps
      for (const [f, v] of [[55, .05], [110.4, .03], [220.7, .008]]) { const o = ctx.createOscillator(); o.frequency.value = f; const g = gainNode(v); o.connect(g); g.connect(out); o.start(); nodes.push(o); }
      const air = loopNoise(true), lp = filt("lowpass", 260), ag = gainNode(.1); air.connect(lp); lp.connect(ag); ag.connect(out); nodes.push(air);
      ids.push(every(5200, () => ping(1150 + Math.random() * 300)), every(2300, () => { if (Math.random() < .55) chirp(); }));
    }
    return { out, nodes, ids };
  }
  /** "oman" | "mars" | "moon" | "cabin" | null */
  function ambience(kind) {
    if (kind === ambKind) return; ambKind = kind; if (!ctx) return;
    fadeOut(layers.amb); layers.amb = kind ? build(kind) : null;
    if (layers.amb) layers.amb.out.gain.setTargetAtTime(1, now(), .8);
  }
  /** suit sounds: fan hum, air flow and slow breathing */
  function suit(on) {
    if (on === suitOn) return; suitOn = on; if (!ctx) return;
    if (!on) { fadeOut(layers.suit); layers.suit = null; return; }
    const out = gainNode(0), nodes = []; out.connect(amb);
    const fan = ctx.createOscillator(); fan.type = "sawtooth"; fan.frequency.value = 118; const fl = filt("lowpass", 260), fg = gainNode(.018); fan.connect(fl); fl.connect(fg); fg.connect(out); fan.start(); nodes.push(fan);
    const air = loopNoise(), bp = filt("bandpass", 1800, .6), ag = gainNode(.012); air.connect(bp); bp.connect(ag); ag.connect(out); nodes.push(air);
    const br = loopNoise(), bb = filt("bandpass", 900, .9), bg = gainNode(0); br.connect(bb); bb.connect(bg); bg.connect(out); nodes.push(br);
    const breathe = () => { const t = now(); bg.gain.cancelScheduledValues(t); bg.gain.setValueAtTime(0, t);
      bg.gain.linearRampToValueAtTime(.05, t + .9); bg.gain.linearRampToValueAtTime(.0, t + 1.7);           // in
      bg.gain.linearRampToValueAtTime(.035, t + 2.4); bg.gain.linearRampToValueAtTime(0, t + 3.6); };        // out
    breathe(); const ids = [every(4300, breathe)];
    layers.suit = { out, nodes, ids }; out.gain.setTargetAtTime(1, now(), .6);
  }

  /* ---------- one-shot effects ---------- */
  function env(g, t0, a, peak, d) { g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(.0001, t0 + a + d); }
  function tone(f, dur, { type = "sine", vol = .12, to = null, dest = sfx, at = 0 } = {}) {
    if (!ctx || !soundOn) return; const t = now() + at, o = ctx.createOscillator(), g = gainNode(0);
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    o.connect(g); g.connect(dest); env(g, t, .01, vol, dur); o.start(t); o.stop(t + dur + .05);
  }
  function burst(dur, { type = "bandpass", f = 2000, q = 1, vol = .2, brown = false, at = 0, dest = sfx, sweep = null } = {}) {
    if (!ctx || !soundOn) return; const t = now() + at, s = ctx.createBufferSource(); s.buffer = brown ? noiseB : noiseW;
    const fl = filt(type, f, q), g = gainNode(0); if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest); env(g, t, .02, vol, dur); s.start(t, Math.random()); s.stop(t + dur + .1);
  }
  function ping(f = 1200) { if (!ctx) return; tone(f, .5, { vol: .07, dest: sfx }); tone(f, .5, { vol: .05, dest: echo }); }
  function chirp() { const n = 3 + (Math.random() * 4 | 0); for (let i = 0; i < n; i++) tone(1800 + Math.random() * 1800, .045, { type: "square", vol: .018, at: i * .07 }); }
  function quindar(intro = true) { tone(intro ? 2525 : 2475, .25, { vol: .06 }); }
  function click() { tone(1400, .04, { type: "triangle", vol: .04 }); }

  /** a rocket or thruster for `sec` seconds; level 1 = launch, .5 = in-space burn, .35 = small thrusters */
  function engine(sec, level = .5) {
    if (!ctx || !soundOn) return; const t = now(), out = gainNode(0); out.connect(sfx);
    const rum = loopNoise(true), lp = filt("lowpass", 160 + level * 500), rg = gainNode(.9 * level); rum.connect(lp); lp.connect(rg); rg.connect(out);
    const crack = loopNoise(), hp = filt("highpass", 1800), cg = gainNode(.12 * level); crack.connect(hp); hp.connect(cg); cg.connect(out);
    const sub = ctx.createOscillator(); sub.frequency.value = 38; const sg = gainNode(.3 * level); sub.connect(sg); sg.connect(out); sub.start();
    lfo(9, .05 * level, cg.gain);
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(1, t + Math.min(1.2, sec * .25)); out.gain.setValueAtTime(1, t + sec * .8); out.gain.linearRampToValueAtTime(0, t + sec);
    setTimeout(() => [rum, crack, sub].forEach(n => { try { n.stop(); } catch { /* stopped */ } }), sec * 1000 + 200);
  }
  /** a positioned, continuous engine (the lander): returns { set(level), move(v3), stop() } */
  function positional(level = .7) {
    if (!ctx || !soundOn) return { set() {}, move() {}, stop() {} };
    const p = ctx.createPanner(); p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 12; p.rolloffFactor = 1.2; p.connect(sfx);
    const out = gainNode(0); out.connect(p);
    const rum = loopNoise(true), lp = filt("lowpass", 520), rg = gainNode(1.4); rum.connect(lp); lp.connect(rg); rg.connect(out);
    const hiss = loopNoise(), hp = filt("bandpass", 2600, .7), hg = gainNode(.2); hiss.connect(hp); hp.connect(hg); hg.connect(out);
    out.gain.setTargetAtTime(level, now(), .3);
    return { set(v) { out.gain.setTargetAtTime(v, now(), .15); }, move(v) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; },
      stop() { out.gain.setTargetAtTime(0, now(), .25); setTimeout(() => { try { rum.stop(); hiss.stop(); } catch { /* stopped */ } }, 1200); } };
  }
  function thump() { tone(70, .9, { vol: .5, to: 28 }); burst(.6, { f: 400, q: .6, vol: .25, brown: true }); }
  function hatch() { burst(1.4, { type: "highpass", f: 2500, vol: .14, sweep: 900 }); tone(180, .15, { type: "square", vol: .05, at: .05 }); tone(90, .2, { vol: .2, at: 1.3 }); }
  function clank() { tone(620 + Math.random() * 120, .18, { type: "triangle", vol: .06 }); tone(1240, .08, { vol: .02 }); }
  function step(world) {
    if (world === "moon") { tone(55, .16, { vol: .14, to: 40 }); return; }                       // vacuum: felt through the suit
    burst(.12, { f: world === "mars" ? 2600 : 1900, q: 1.4, vol: world === "mars" ? .07 : .12 });
  }
  /** construction sounds, by module */
  function build1(id) {
    if (!ctx || !soundOn) return;
    if (id === "habitat") { servo(3, 140, 260); burst(3.6, { type: "highpass", f: 1500, vol: .06, at: 2.4, sweep: 600 }); }
    else if (id === "solar") { servo(2.2, 300, 520); tone(880, .1, { vol: .04, at: 2.3 }); }
    else if (id === "comms") { servo(1.6, 380, 640); [0, .25, .5].forEach(a => tone(1600, .08, { vol: .04, at: 2 + a })); }
    else if (id === "rover") { const t = now(), o = ctx.createOscillator(), g = gainNode(0); o.type = "sawtooth"; o.frequency.setValueAtTime(180, t); o.frequency.linearRampToValueAtTime(420, t + 1.5); o.frequency.linearRampToValueAtTime(260, t + 3);
      const lp = filt("lowpass", 900); o.connect(lp); lp.connect(g); g.connect(sfx); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + .4); g.gain.linearRampToValueAtTime(0, t + 3.2); o.start(t); o.stop(t + 3.3); }
    else if (id === "drill") { const t = now(), o = ctx.createOscillator(), g = gainNode(0); o.type = "square"; o.frequency.value = 92; const lp = filt("lowpass", 700);
      o.connect(lp); lp.connect(g); g.connect(sfx); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + .3); g.gain.setValueAtTime(.05, t + 2.6); g.gain.linearRampToValueAtTime(0, t + 3); o.start(t); o.stop(t + 3.1);
      burst(3, { f: 3000, q: .8, vol: .04 }); }
    else if (id === "path") tone(1320, .12, { vol: .05 });
  }
  function servo(sec, f0, f1) { const t = now(), o = ctx.createOscillator(), g = gainNode(0), lp = filt("lowpass", 1200); o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + sec * .5); o.frequency.linearRampToValueAtTime(f0, t + sec);
    o.connect(lp); lp.connect(g); g.connect(sfx); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.04, t + .2); g.gain.setValueAtTime(.04, t + sec - .2); g.gain.linearRampToValueAtTime(0, t + sec); o.start(t); o.stop(t + sec + .05); }

  /* ---------- narrator: recorded human-sounding lines (Piper, open source) with the browser's voice as a fallback ---------- */
  const synth = window.speechSynthesis; let voice = null, voiceIndex = null, cur = null, chain = Promise.resolve();
  fetch("data/voice/index.json").then(r => r.ok ? r.json() : null).then(j => { voiceIndex = j?.lines || null; }).catch(() => {});
  function stopVoice() { synth?.cancel(); if (cur) { cur.pause(); cur = null; } }
  function pickVoice() {
    if (!synth) return; const vs = synth.getVoices().filter(v => /^en/i.test(v.lang)); if (!vs.length) return;
    const pref = [/Google UK English Male/i, /Microsoft (Guy|Ryan|Davis|Andrew)/i, /Daniel/i, /Google US English/i, /Natural/i, /en-GB/i];
    voice = pref.map(r => vs.find(v => r.test(v.name) || r.test(v.lang))).find(Boolean) || vs[0];
  }
  if (synth) { pickVoice(); synth.addEventListener?.("voiceschanged", pickVoice); }
  /** speak a line; { tone: true } frames it like a mission-control radio call; { queue: true } waits for the previous line */
  function say(text, { tone: radio = false, queue: q = false } = {}) {
    if (!voiceOn || !text) return;
    const file = voiceIndex?.[voiceKey(text)];
    if (file) {                                                     // a recorded line: play it, framed by Quindar tones on radio calls
      const play = () => new Promise(res => {
        const a = new Audio("data/voice/" + file); a.volume = soundOn ? 1 : 0; cur = a;
        a.onended = () => { if (radio && soundOn) quindar(false); res(); }; a.onerror = () => res();
        const begin = () => a.play().catch(() => res());
        if (radio && soundOn) { quindar(true); setTimeout(begin, 280); } else begin();
      });
      if (!q) { stopVoice(); chain = play(); } else chain = chain.then(play);
      return;
    }
    if (!synth) return;
    if (!q) stopVoice();
    const u = new SpeechSynthesisUtterance(spoken(text));
    if (voice) u.voice = voice; u.rate = 1.02; u.pitch = .95; u.volume = soundOn ? 1 : 0;
    if (radio && soundOn) { quindar(true); u.onend = () => quindar(false); }
    const go = () => synth.speak(u); if (radio && soundOn) setTimeout(go, 280); else go();
  }

  /* ---------- 3D listener follows the head ---------- */
  const p = new THREE.Vector3(), f = new THREE.Vector3(), u = new THREE.Vector3();
  function update(camera) {
    if (!ctx) return; const L = ctx.listener; camera.getWorldPosition(p); camera.getWorldDirection(f); u.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z; }
    else { L.setPosition?.(p.x, p.y, p.z); L.setOrientation?.(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  return {
    start, ambience, suit, engine, positional, thump, hatch, clank, step, build: build1, ping, chirp, quindar, click, say, update,
    get soundOn() { return soundOn; }, get voiceOn() { return voiceOn; },
    setSound(v) { soundOn = v; store.set("oaa.vr.sound", v); if (master) master.gain.setTargetAtTime(v ? .9 : 0, now(), .1); if (!v) synth?.cancel(); },
    setVoice(v) { voiceOn = v; store.set("oaa.vr.voice", v); if (!v) stopVoice(); },
    dispose() { stopVoice(); timers.forEach(clearInterval); timers.clear(); ctx?.close(); ctx = null; },
  };
}
