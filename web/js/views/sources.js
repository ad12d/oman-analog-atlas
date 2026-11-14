// SOURCES: every dataset used, as NASA requires. The first 11 rows are the challenge's listed resources.
import { h, esc, setKeys } from "../core/ui.js";

const ROWS = [
  ["NASA Earthdata Search", "NASA", "https://search.earthdata.nasa.gov/", "ASTER L1T, EMIT L2B MIN, MODIS (via AppEEARS)", "Minerals · Dryness · Thermal", true],
  ["NASA Worldview", "NASA", "https://worldview.earthdata.nasa.gov/", "Visual checks of MODIS layers over the AOIs", "Quality check", true],
  ["NASA Planetary Data System", "NASA", "https://pds.nasa.gov/", "MOLA MEGDR, CRISM MTRDR (Mars targets)", "Mars targets", true],
  ["NASA Lunar Reconnaissance Orbiter", "NASA", "https://pds-geosciences.wustl.edu/missions/lro/", "LOLA polar terrain (Moon target)", "Moon targets", true],
  ["NASA LRO Diviner Lunar Data", "NASA", "https://pds-geosciences.wustl.edu/missions/lro/diviner.htm", "Polar temperature products", "Moon targets", true],
  ["RADARSAT Constellation Mission", "CSA", "https://donnees-data.asc-csa.gc.ca/en/dataset/rcm", "SAR scenes (if Oman is covered)", "Radar", true],
  ["RADARSAT-1", "CSA", "https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1", "Open-licence SAR scene over Samail", "Radar", true],
  ["SAR Python Tutorial", "CSA", "https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial", "Reference code for SAR handling", "Pipeline", true],
  ["Copernicus Data Space Ecosystem", "ESA", "https://dataspace.copernicus.eu/", "Copernicus DEM GLO-30/90, Sentinel-2, Sentinel-1", "Terrain · Dryness · Radar", true],
  ["ESA Open Science Catalog", "ESA", "https://opensciencedata.esa.int/", "Searched for desert and mineral products", "Reviewed", true],
  ["JAXA G-Portal", "JAXA", "https://gportal.jaxa.jp/gpr/", "Reviewed for ALOS DEM cross-check", "Reviewed", true],
  ["NASA Moon Trek / Mars Trek", "NASA", "https://trek.nasa.gov/", "Mars Viking colour mosaic and MOLA shaded relief (globe textures), terrain clips", "Visuals · targets", false],
  ["NASA Scientific Visualization Studio", "NASA", "https://svs.gsfc.nasa.gov/", "Blue Marble Earth image; CGI Moon Kit colour map and LOLA elevation (globe textures)", "Visuals", false],
  ["NASA Black Marble 2016", "NASA", "https://earthobservatory.nasa.gov/features/NightLights", "City lights on the globe's night side", "Visuals", false],
  ["AppEEARS (LP DAAC)", "NASA", "https://appeears.earthdatacloud.nasa.gov/", "MODIS NDVI and LST subsets for Oman", "Dryness · Thermal", false],
  ["Sentinel-2 cloudless by EOX", "EOX / ESA data", "https://s2maps.eu/", "Basemap of Oman", "Basemap", false],
  ["OpenStreetMap", "OSM contributors", "https://www.openstreetmap.org/copyright", "Roads for the access criterion", "Access", false],
  ["three.js", "Open source (MIT licence)", "https://threejs.org/", "3D engine and bloom effect; globe cloud texture from its example files", "Visuals", false],
  ["Rajendran & Nasir (2015), Tectonophysics 657", "Sultan Qaboos University", "https://doi.org/10.1016/j.tecto.2015.06.023", "ASTER band ratios and field-verified benchmark wadis", "Minerals · Benchmarks", false],
];

export default {
  mount({ view, scene }) {
    scene.setActive(true); scene.setMode("director");
    const root = h("div", { class: "page live" });
    root.innerHTML = `<div class="page-inner">
      <div class="page-head"><p class="eyebrow">Sources</p><h1>Data and references</h1>
        <p>Rows marked "Challenge" are the resources listed on the NASA Space Apps challenge page. The others are cited separately.</p></div>
      <div class="panel ticks"><div class="src-wrap"><table class="src-table">
        <thead><tr><th>Resource</th><th>Agency</th><th>What we use</th><th>Feeds</th><th>List</th></tr></thead>
        <tbody>${ROWS.map(([n, a, u, what, feeds, ch]) => `<tr><td><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a></td><td>${esc(a)}</td><td>${esc(what)}</td><td class="use">${esc(feeds)}</td><td class="use">${ch ? "Challenge" : "Additional"}</td></tr>`).join("")}</tbody>
      </table></div></div>
    </div>`;
    view.appendChild(root);
    setKeys([["M", "Mission"]]);
    return {};
  },
};
