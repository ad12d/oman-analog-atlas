// Shared loader for the team's 1 km grids (data/grid/*.png + grid.json): loaded once (~6 MB),
// used by the live map (atlas.js) and the real-data ASI Stack (method.js).
import { loadGrid } from "./live.js";
let p = null;
export function getGrid() { return (p ??= loadGrid("data/").catch(err => { p = null; throw err; })); }
