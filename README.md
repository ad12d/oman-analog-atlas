# Oman Analog Atlas

NASA Space Apps Challenge 2026 · *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*
Team: Luqman Alsaqri (lead, drone LiDAR) · Adil Alkalbani (GIS, AHP) · Mazin Albahri (code, web, VR, security)

Oman's terrain scored against Moon and Mars targets with an **Analog Similarity Index (ASI = Σ wᵢ·sᵢ)**,
presented as a space-navigation interface: **Orbit → Director → Oman destination map → Analog Passport → Twin Lens**.

## Run it locally

No build step and no Node.js needed. From this folder:

```
cd web
python -m http.server 8000
```

Then open <http://localhost:8000>. On Windows you can double-click `serve.bat` instead.
The app needs an internet connection for the fonts and the Sentinel-2 basemap tiles; everything else is local.

## Structure

```
web/
  index.html            page shell + HUD
  css/theme.css         colour + type tokens (criterion colours are colour-blind checked)
  css/hud.css           HUD chrome: top/bottom bars, glass panels, destination cards, reticle
  css/views.css         per-view styles
  js/main.js            data load, hash router, mission switch
  js/core/              data loader (contract files), store, graphics quality (fx.js), UI helpers, noise
  js/space/scene.js     three.js scene: Earth day/night shader, Moon/Mars relief + target markers,
                        nebula sky, orbit arcs, gold transfer route, camera shots incl. the dive to Oman, bloom
  js/space/stack3d.js   three.js ASI Stack on the Method page (six layers press into the ASI)
  js/views/             orbit, director, atlas (Oman map), passport, twin, method, sources, vr
  js/vr/                VR landing + camp: terrain (tile loader, slope/roughness queries, baked detail),
                        skins (Oman/Moon/Mars sky + light), lander (descent, plume, dust, touchdown check),
                        camp (modules + rule checks), controls (Quest controllers, screen fallback)
  data/vr/rules.json    landing + camp thresholds and the module catalogue (engine-neutral)
  data/vr/<ID>/         VR terrain tile per site (height.png + terrain.json); data/vr/mock/ is the placeholder
  data/mock/            MOCK contract files (placeholders)
  data/                 put the REAL files here; they override the mock ones automatically
  assets/textures/      globe textures: Earth day (SVS Blue Marble), night lights (NASA Black Marble 2016),
                        clouds (three.js examples), ocean mask (derived from the day map);
                        Moon colour + LOLA relief (SVS CGI Moon Kit); Mars colour (Trek Viking MDIM2.1) + relief (Trek MOLA)
  vendor/               three.js r160 (+ post-processing add-ons for bloom), MapLibre GL 4.7.1 (stored locally)
pipeline/
  make_mock_data.py     writes the mock files; documents the exact data contract
  make_vr_terrain.py    makes a VR terrain tile from the LiDAR DTM (.tif) or point cloud (.las/.laz), or the placeholder (--mock)
```

## Routes

| Hash | View |
|---|---|
| `#orbit` | Opening shot, Earth with Oman turned to camera |
| `#director` | Earth, Moon, Mars on orbit arcs; hover cards; target dossiers |
| `#director-moon`, `#director-mars` | Director opened straight on the Moon or Mars target dossier (handy when presenting) |
| `#oman` | Destination map: ASI overlay, Strata layers, ranked sites |
| `#site-<ID>` | Oman map with that site's Analog Passport open |
| `#twin-<ID>` | Twin Lens: Oman vs Moon/Mars terrain at one scale |
| `#vr`, `#vr-<ID>` | VR: pick a pad, watch the lander touch down, check it, build the camp (Quest: **Enter VR**) |
| `#method` | ASI Stack, similarity rules, AHP matrix, benchmark check |
| `#sources` | Every dataset cited |

Keys: `M` cycles the mission, `Enter` travels, `Esc` goes back, `G` switches graphics between High and Light.

**Graphics.** High = bloom glow and full resolution; Light = no post-processing, 1× pixels. The app guesses from the device,
drops to Light once by itself if frames are slow, and remembers the viewer's own choice. For a demo machine you can force it
with `?fx=high` or `?fx=low` in the URL, e.g. `http://localhost:8000/?fx=high#orbit`.

## VR (landing + camp)

Open `#vr` (or **Land here in VR** on a site passport). On a **Meta Quest**, open https://ubar.space/#vr in the Quest Browser and press **Enter VR**:
trigger = select, right stick = snap turn, menu on the left wrist. On a screen: drag to look, click/tap to act, WASD to walk.

1. **Choose a pad**: the three best 6 m pads (lowest slope + roughness) are suggested; point anywhere to test another.
2. **Watch the landing**: powered descent under the chosen world's gravity (Oman 9.81, Moon 1.62, Mars 3.71 m/s²). At touchdown the
   terrain under the four footpads gives lander tilt, ground slope and roughness → SAFE / MARGINAL / HAZARD.
3. **Build the camp**: habitat, solar array, comms mast, rover, path markers. Each is checked for slope, unevenness and the plume keep-out distance.

The World buttons show the same ground under Oman, Moon and Mars skies. Thresholds live in `web/data/vr/rules.json` and are **team design
rules**, not NASA requirements. The tile and rules are plain PNG + JSON so a later Unity version can read them unchanged.

**Plugging in the LiDAR** (when Luqman's survey is processed):

```
pip install rasterio "laspy[lazrs]"
python pipeline/make_vr_terrain.py --dtm dtm_10cm.tif --name S19      # or: --laz cloud.laz --name S19
```

`--name` is the site ID, so `#vr-S19` picks it up; other sites keep the placeholder. The script writes heights relative to the
tile centre only (no CRS, coordinates or EXIF). Check the output before committing.

## Data contract (what the GIS work must deliver)

Drop the real files into `web/data/` with these names; the "Mock data" flag disappears when all three are real.

**`sites.geojson`**: one feature per site *per mission profile* (Point or Polygon). Properties:
`id, name, aoi, profile (moon_base|mars_landing|mars_science), asi, rank, benchmark (calibration|test|null), tier,`
`s_terrain, s_dryness, s_minerals, s_thermal, s_radar, s_access` (0–1 similarity),
`raw_terrain` (° slope), `raw_dryness` (NDVI), `raw_minerals` (index 0–1), `raw_thermal` (K), `raw_radar` (dB), `raw_access` (km),
`matches[], gaps[], best_use`.

**`weights.json`**: `{ "weights": { "<profile>": { "<criterion>": w, ... } }, "cr": { "<profile>": value } }`. Each profile's weights sum to 1.

**`targets.csv`**: `criterion, profile, body, site, value, tolerance, unit, source`. Similarity is the linear ramp
`s = max(0, 1 − |earth − value| / tolerance)`.

Later (Lightsail): ASI and criterion rasters as Cloud-Optimized GeoTIFFs served by TiTiler replace the mock overlays in `js/views/atlas.js` (`layerImage`).

## Rules

Only open data and our civilian survey site go into this repository. No keys or tokens in the repo. Strip EXIF/GPS from photos before adding them.
