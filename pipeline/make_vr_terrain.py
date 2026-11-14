"""Make the VR terrain tile (engine-neutral: a PNG heightmap + a small JSON).

Output folder (default web/data/vr/<name>/):
  height.png    512 x 512 RGB, 16-bit height packed as R*256 + G (B unused). North is the top row.
  terrain.json  {"size_m", "res_m", "z_min", "z_max", "grid", "source", "placeholder", "note"}

SECURITY: the tile is local only. The origin is the tile centre, heights are relative,
and no CRS, geotransform, lat/lon or EXIF is written. Review the output before committing.

Usage
  python pipeline/make_vr_terrain.py --mock                      # placeholder tile (no data needed)
  python pipeline/make_vr_terrain.py --dtm dtm_10cm.tif --name S19 [--size 256]
  python pipeline/make_vr_terrain.py --laz cloud.laz   --name S19 [--size 256]

--dtm needs `pip install rasterio`; --laz needs `pip install laspy[lazrs]`.
The DTM / point cloud must be in a projected CRS in metres (e.g. UTM 40N); the crop is centred on
the data's centre unless --cx/--cy (in the data's own CRS units) are given.
"""
import argparse, json, os
import numpy as np
from PIL import Image

GRID = 512
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = os.path.join(HERE, "..", "web", "data", "vr")


def write_tile(z, size_m, name, source, placeholder, note):
    """z: GRID x GRID float array of heights in metres (row 0 = north)."""
    z = np.asarray(z, dtype=np.float64)
    if np.isnan(z).any():                       # fill gaps with the nearest valid row/col mean
        z = np.where(np.isnan(z), np.nanmean(z), z)
    z0, z1 = float(z.min()), float(z.max())
    q = np.round((z - z0) / max(z1 - z0, 1e-6) * 65535).astype(np.uint32)
    rgb = np.zeros((GRID, GRID, 3), dtype=np.uint8)
    rgb[..., 0] = (q >> 8).astype(np.uint8)
    rgb[..., 1] = (q & 255).astype(np.uint8)
    out = os.path.join(OUT_ROOT, name)
    os.makedirs(out, exist_ok=True)
    Image.fromarray(rgb, "RGB").save(os.path.join(out, "height.png"), optimize=True)   # PIL writes no EXIF/geo tags
    meta = {"size_m": size_m, "res_m": round(size_m / (GRID - 1), 4), "z_min": 0.0, "z_max": round(z1 - z0, 3),
            "grid": GRID, "source": source, "placeholder": placeholder, "note": note}
    with open(os.path.join(out, "terrain.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"wrote {out}  relief {z1 - z0:.2f} m over {size_m} m")


def resample(arr, n=GRID, smooth=False):
    """Bilinear (or smoothstep, for noise lattices) resample of a 2D array to n x n."""
    h, w = arr.shape
    ys, xs = np.linspace(0, h - 1, n), np.linspace(0, w - 1, n)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    y1, x1 = np.minimum(y0 + 1, h - 1), np.minimum(x0 + 1, w - 1)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    if smooth: fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b = arr[np.ix_(y0, x0)], arr[np.ix_(y0, x1)]
    c, d = arr[np.ix_(y1, x0)], arr[np.ix_(y1, x1)]
    return a * (1 - fy) * (1 - fx) + b * (1 - fy) * fx + c * fy * (1 - fx) + d * fy * fx


def mock(size_m):
    """Placeholder: an ophiolite-like ridge, a wadi channel with gravel terraces, and flat benches to land on."""
    rng = np.random.default_rng(19)
    def fbm(n_oct, base):
        acc = np.zeros((GRID, GRID)); amp = 1.0; tot = 0
        for o in range(n_oct):
            g = base * 2 ** o
            coarse = rng.random((g + 1, g + 1))
            acc += amp * resample(coarse, smooth=True); tot += amp; amp *= .5
        return acc / tot
    u, v = np.meshgrid(np.linspace(-1, 1, GRID), np.linspace(-1, 1, GRID))
    ridge = 1 - np.abs(2 * fbm(5, 3) - 1)
    z = 10 * ridge ** 2 + 4 * fbm(5, 3)
    z += 8 * np.clip(v + .35, 0, None) ** 1.6                     # rising slope toward the north edge
    wadi = np.exp(-((u * .9 + .25 * np.sin(v * 3.2) + .05) / .09) ** 2)
    z -= 4.5 * wadi                                                    # winding wadi channel
    for cx, cy, r in [(-.25, .2, .12), (.35, .25, .1), (.1, -.35, .14)]:   # three benches (landing candidates)
        d = np.sqrt((u - cx) ** 2 + (v - cy) ** 2)
        w = np.clip((1 - d / r) * 1.8, 0, 1)
        z = z * (1 - w) + np.median(z[d < r]) * w
    z += .35 * fbm(4, 24) + .012 * rng.standard_normal((GRID, GRID))   # gravel-scale roughness
    return z


def from_dtm(path, size_m, cx, cy):
    import rasterio
    from rasterio.windows import from_bounds
    with rasterio.open(path) as ds:
        if ds.crs and ds.crs.is_geographic:
            raise SystemExit("DTM must be in a projected CRS in metres (reproject to UTM first).")
        b = ds.bounds
        cx = cx if cx is not None else (b.left + b.right) / 2
        cy = cy if cy is not None else (b.bottom + b.top) / 2
        win = from_bounds(cx - size_m / 2, cy - size_m / 2, cx + size_m / 2, cy + size_m / 2, ds.transform)
        z = ds.read(1, window=win, masked=True).astype(np.float64).filled(np.nan)
    return resample(z)


def from_laz(path, size_m, cx, cy):
    import laspy
    las = laspy.read(path)
    x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
    try:                                         # keep ground returns (class 2) when classified
        g = np.asarray(las.classification) == 2
        if g.sum() > 1000: x, y, z = x[g], y[g], z[g]
    except Exception: pass
    cx = cx if cx is not None else (x.min() + x.max()) / 2
    cy = cy if cy is not None else (y.min() + y.max()) / 2
    i = ((x - (cx - size_m / 2)) / size_m * (GRID - 1)).round().astype(int)
    j = (((cy + size_m / 2) - y) / size_m * (GRID - 1)).round().astype(int)   # row 0 = north
    k = (i >= 0) & (i < GRID) & (j >= 0) & (j < GRID)
    grid = np.full((GRID, GRID), np.inf)
    np.minimum.at(grid, (j[k], i[k]), z[k])      # lowest return per cell approximates bare ground
    grid[np.isinf(grid)] = np.nan
    return grid


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--mock", action="store_true")
    src.add_argument("--dtm"); src.add_argument("--laz")
    ap.add_argument("--name", default="mock"); ap.add_argument("--size", type=float, default=256)
    ap.add_argument("--cx", type=float); ap.add_argument("--cy", type=float)
    a = ap.parse_args()
    if a.mock:
        write_tile(mock(a.size), a.size, "mock", "Procedural placeholder", True,
                   "Placeholder terrain until the team's drone LiDAR survey is processed.")
    elif a.dtm:
        write_tile(from_dtm(a.dtm, a.size, a.cx, a.cy), a.size, a.name, "Team drone LiDAR survey (DTM)", False,
                   "Bare-earth DTM from the team's civilian survey; local coordinates only.")
    else:
        write_tile(from_laz(a.laz, a.size, a.cx, a.cy), a.size, a.name, "Team drone LiDAR survey (point cloud)", False,
                   "Gridded from ground returns of the team's civilian survey; local coordinates only.")
