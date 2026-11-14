// Tiny app state: the mission profile drives every view.
const listeners = new Set();
const state = { mission: "mars_science" };

try { const m = localStorage.getItem("oaa.mission"); if (m) state.mission = m; } catch { /* storage unavailable */ }

export const store = {
  get mission() { return state.mission; },
  setMission(m) {
    if (m === state.mission) return;
    state.mission = m;
    try { localStorage.setItem("oaa.mission", m); } catch { /* ignore */ }
    document.documentElement.dataset.mission = m;
    listeners.forEach(fn => fn(state));
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
document.documentElement.dataset.mission = state.mission;
