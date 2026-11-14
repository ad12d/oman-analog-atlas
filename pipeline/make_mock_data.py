"""Generate MOCK data files in the exact format the web app reads.

The real GIS outputs (Adil / Luqman) replace these files one-for-one:
  web/data/mock/sites.geojson   -> web/data/sites.geojson
  web/data/mock/weights.json    -> web/data/weights.json
  web/data/mock/targets.csv     -> web/data/targets.csv

Run:  python pipeline/make_mock_data.py
All numbers produced here are invented placeholders for building the interface.
"""
import csv
import json
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "mock"
OUT.mkdir(parents=True, exist_ok=True)
random.seed(2026)

PROFILES = ["moon_base", "mars_landing", "mars_science"]
CRITERIA = ["terrain", "dryness", "minerals", "thermal", "radar", "access"]

# weights.json — AHP weights per profile (each sums to 1) and consistency ratio per profile
WEIGHTS = {
    "moon_base":    {"terrain": .30, "dryness": .05, "minerals": .10, "thermal": .25, "radar": .10, "access": .20},
    "mars_landing": {"terrain": .35, "dryness": .05, "minerals": .05, "thermal": .10, "radar": .25, "access": .20},
    "mars_science": {"terrain": .10, "dryness": .15, "minerals": .40, "thermal": .10, "radar": .05, "access": .20},
}
CR = {"moon_base": 0.041, "mars_landing": 0.058, "mars_science": 0.036}

# targets.csv — target value + tolerance for the linear-ramp similarity  s = max(0, 1 - |earth - target| / tolerance)
TARGETS = [
    # criterion, profile, body, site, value, tolerance, unit, source
    ("terrain", "moon_base", "Moon", "Shackleton connecting ridge", 4.5, 10, "deg", "LRO LOLA polar DEM"),
    ("terrain", "mars_landing", "Mars", "Jezero crater floor", 3.0, 10, "deg", "MOLA MEGDR / HiRISE DTM"),
    ("terrain", "mars_science", "Mars", "Jezero delta front", 9.0, 12, "deg", "HiRISE DTM"),
    ("dryness", "moon_base", "Moon", "Shackleton connecting ridge", 0.0, 0.3, "NDVI", "No vegetation"),
    ("dryness", "mars_landing", "Mars", "Jezero crater floor", 0.0, 0.3, "NDVI", "No vegetation"),
    ("dryness", "mars_science", "Mars", "Jezero delta front", 0.0, 0.3, "NDVI", "No vegetation"),
    ("minerals", "moon_base", "Moon", "Shackleton connecting ridge", 0.10, 0.5, "index", "Anorthosite highland (M3)"),
    ("minerals", "mars_landing", "Mars", "Jezero crater floor", 0.50, 0.6, "index", "MRO CRISM MTRDR"),
    ("minerals", "mars_science", "Mars", "Jezero delta front", 0.88, 0.4, "index", "MRO CRISM olivine-carbonate"),
    ("thermal", "moon_base", "Moon", "Shackleton connecting ridge", 140, 150, "K", "LRO Diviner polar products"),
    ("thermal", "mars_landing", "Mars", "Jezero crater floor", 75, 100, "K", "Mars Odyssey THEMIS"),
    ("thermal", "mars_science", "Mars", "Jezero delta front", 75, 100, "K", "Mars Odyssey THEMIS"),
    ("radar", "moon_base", "Moon", "Shackleton connecting ridge", -16, 8, "dB", "LRO Mini-RF"),
    ("radar", "mars_landing", "Mars", "Jezero crater floor", -11, 8, "dB", "Rock abundance (HiRISE)"),
    ("radar", "mars_science", "Mars", "Jezero delta front", -12, 8, "dB", "Rock abundance (HiRISE)"),
    ("access", "moon_base", "Moon", "Shackleton connecting ridge", 0, 12, "km", "Crew traverse limit"),
    ("access", "mars_landing", "Mars", "Jezero crater floor", 0, 12, "km", "Crew traverse limit"),
    ("access", "mars_science", "Mars", "Jezero delta front", 0, 12, "km", "Crew traverse limit"),
]

# Mock candidate sites. Benchmark wadis follow the team plan (calibration: Al Abyad, Nidab; test: Abda, Tayin, Fizh).
# Coordinates are approximate and rounded; cells are invented placeholders.
SITES = [
    ("WAB", "Wadi Al Abyad", "AOI-1 Samail", 23.43, 57.78, "calibration", "samail"),
    ("WND", "Wadi Nidab", "AOI-1 Samail", 23.05, 58.05, "calibration", "samail"),
    ("WAD", "Wadi Abda", "AOI-1 Samail", 23.20, 58.25, "test", "samail"),
    ("WTY", "Wadi Tayin", "AOI-1 Samail", 22.95, 58.40, "test", "samail"),
    ("WFZ", "Wadi Fizh", "AOI-1 Samail", 24.35, 56.50, "test", "samail"),
    ("S07", "Samail cell 07", "AOI-1 Samail", 23.62, 57.30, None, "samail"),
    ("S12", "Samail cell 12", "AOI-1 Samail", 22.78, 58.72, None, "samail"),
    ("S19", "Samail cell 19", "AOI-1 Samail", 24.02, 56.88, None, "samail"),
    ("D02", "Dhofar plateau cell 02", "AOI-2 Dhofar", 18.92, 54.95, None, "dhofar"),
    ("D05", "Dhofar gravel plain cell 05", "AOI-2 Dhofar", 18.55, 55.40, None, "dhofar"),
    ("D09", "Dhofar plateau cell 09", "AOI-2 Dhofar", 19.20, 55.70, None, "dhofar"),
    ("H01", "Huqf cell 01", "AOI-3 Wildcard", 19.95, 57.55, None, "huqf"),
]
BASE = {  # mean raw values per terrain family
    "samail": {"terrain": 8.0, "dryness": 0.10, "minerals": 0.80, "thermal": 30, "radar": -13.0, "access": 4.0},
    "dhofar": {"terrain": 3.0, "dryness": 0.05, "minerals": 0.25, "thermal": 38, "radar": -11.5, "access": 9.0},
    "huqf":   {"terrain": 4.5, "dryness": 0.04, "minerals": 0.45, "thermal": 36, "radar": -12.0, "access": 12.0},
}
JITTER = {"terrain": 2.5, "dryness": 0.03, "minerals": 0.08, "thermal": 5, "radar": 1.5, "access": 3.0}
LIMITS = {"terrain": (0, 30), "dryness": (0, 0.6), "minerals": (0, 1), "thermal": (0, 300), "radar": (-25, 0), "access": (0, 30)}
NAMES = {"terrain": "slope", "dryness": "dryness", "minerals": "mineral match", "thermal": "temperature range", "radar": "radar roughness", "access": "access"}
FIXED_GAPS = {
    "moon_base": ["1 g gravity vs 0.17 g", "1 bar atmosphere vs vacuum", "Shielded from space radiation"],
    "mars_landing": ["1 g gravity vs 0.38 g", "Air ~170x denser than Mars", "Shielded from space radiation"],
    "mars_science": ["1 g gravity vs 0.38 g", "Air ~170x denser than Mars", "Active groundwater today"],
}
BEST_USE = {
    "moon_base": "Surface mobility and site-survey drills on low-slope ground.",
    "mars_landing": "Rover traverse planning and hazard-detection tests on rock-strewn ground.",
    "mars_science": "Sample selection and in-situ spectroscopy on altered ultramafic rock.",
}

target = {(c, p): (v, tol) for c, p, _b, _s, v, tol, _u, _src in TARGETS}


def sim(c, p, x):
    t, tol = target[(c, p)]
    return max(0.0, 1 - abs(x - t) / tol)


raw = {}
for sid, *_rest, family in SITES:
    raw[sid] = {}
    for c in CRITERIA:
        lo, hi = LIMITS[c]
        v = random.gauss(BASE[family][c], JITTER[c])
        raw[sid][c] = round(min(hi, max(lo, v)), 3)
raw["WAB"].update({"terrain": 6.8, "dryness": 0.09, "minerals": 0.84, "thermal": 31, "radar": -13.5, "access": 3.4})

features = []
for p in PROFILES:
    scored = []
    for sid, name, aoi, lat, lon, bench, family in SITES:
        s = {c: round(sim(c, p, raw[sid][c]), 3) for c in CRITERIA}
        asi = round(sum(WEIGHTS[p][c] * s[c] for c in CRITERIA), 3)
        scored.append((asi, sid, name, aoi, lat, lon, bench, s))
    scored.sort(reverse=True)
    for rank, (asi, sid, name, aoi, lat, lon, bench, s) in enumerate(scored, 1):
        strong = [NAMES[c] for c in CRITERIA if s[c] >= 0.7]
        weak = [f"Weak {NAMES[c]} match (s {s[c]:.2f})" for c in CRITERIA if s[c] < 0.4]
        props = {
            "id": sid, "name": name, "aoi": aoi, "profile": p, "asi": asi, "rank": rank,
            "benchmark": bench, "tier": 2,
            **{f"s_{c}": s[c] for c in CRITERIA},
            **{f"raw_{c}": raw[sid][c] for c in CRITERIA},
            "matches": [f"Strong {m} match" for m in strong] or ["No criterion above 0.7"],
            "gaps": FIXED_GAPS[p] + weak,
            "best_use": BEST_USE[p],
        }
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})

(OUT / "sites.geojson").write_text(json.dumps({"type": "FeatureCollection", "mock": True, "features": features}, indent=1), encoding="utf-8")
(OUT / "weights.json").write_text(json.dumps({"mock": True, "weights": WEIGHTS, "cr": CR}, indent=2), encoding="utf-8")
with open(OUT / "targets.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["criterion", "profile", "body", "site", "value", "tolerance", "unit", "source"])
    w.writerows(TARGETS)
print(f"wrote {len(features)} features, weights, targets to {OUT}")
