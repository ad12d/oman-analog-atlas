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
  js/views/             orbit, director, atlas (Oman map), passport, twin, method, sources
  data/mock/            MOCK contract files (placeholders)
  data/                 put the REAL files here; they override the mock ones automatically
  assets/textures/      globe textures: Earth day (SVS Blue Marble), night lights (NASA Black Marble 2016),
                        clouds (three.js examples), ocean mask (derived from the day map);
                        Moon colour + LOLA relief (SVS CGI Moon Kit); Mars colour (Trek Viking MDIM2.1) + relief (Trek MOLA)
  vendor/               three.js r160 (+ post-processing add-ons for bloom), MapLibre GL 4.7.1 (stored locally)
pipeline/
  make_mock_data.py     writes the mock files; documents the exact data contract
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
| `#method` | ASI Stack, similarity rules, AHP matrix, benchmark check |
| `#sources` | Every dataset cited |

Keys: `M` cycles the mission, `Enter` travels, `Esc` goes back, `G` switches graphics between High and Light.

**Graphics.** High = bloom glow and full resolution; Light = no post-processing, 1× pixels. The app guesses from the device,
drops to Light once by itself if frames are slow, and remembers the viewer's own choice. For a demo machine you can force it
with `?fx=high` or `?fx=low` in the URL, e.g. `http://localhost:8000/?fx=high#orbit`.

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
