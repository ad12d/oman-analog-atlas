"""Build the three real VR terrain tiles from open data (engine-neutral PNG + JSON).

  oman  Copernicus DEM GLO-30 (ESA, 30 m) + Sentinel-2 cloudless 2020 colour (EOX, 10 m)
        centred on the Oman Drilling Project hole CM1, crust-mantle transition, Wadi Zeeb (Wadi Tayin massif)
  moon  LOLA 5 m/pixel DEM, PGDA "Site01" = Shackleton - de Gerlache connecting ridge (NASA GSFC)
  mars  HiRISE DTM DTEEC_045994_1985_046060_1985 (1 m) + HiRISE RED orthoimage, Jezero crater
        floor near the Perseverance landing site and the delta front (USGS Astrogeology / UA HiRISE)

Output per world in web/data/vr/<world>/:
  height.png   grid x grid RGB, 16-bit height packed as R*256+G, row 0 = north/top of the source raster
  albedo.jpg   colour with baked ambient occlusion and sun shadows for that world's fixed sun
  terrain.json size, heights range, sun, detail amplitude, credits (no coordinates are written)

Needs: pip install rasterio  (numpy, Pillow). The LOLA file is read from raw/moon_site01.tif
(download https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif there first).

usage: python pipeline/make_vr_worlds.py [oman] [moon] [mars] [--raw DIR]
"""
import argparse, io, json, math, os, time, urllib.request
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "data", "vr")
UA = {"User-Agent": "oman-analog-atlas-pipeline/1.0 (Space Apps 2026)"}

WORLDS = {
    "oman": dict(label="Oman · Samail ophiolite, Wadi Tayin", size=4000, grid=1024, tex=2048, sun=(118, 40), shadow=.5, detail=.35,
                 source="Copernicus DEM GLO-30 + Sentinel-2 cloudless 2020",
                 credit="Copernicus DEM GLO-30 © DLR/Airbus, provided under COPERNICUS by the European Union and ESA; Sentinel-2 cloudless 2020 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)",
                 note="Real terrain around the Oman Drilling Project hole CM1 (crust-mantle transition). 30 m elevation; sub-30 m roughness near the landing area is synthetic until the team's drone LiDAR is processed."),
    "moon": dict(label="Moon · Shackleton connecting ridge", size=3000, grid=600, tex=2048, sun=(250, 5), shadow=.05, detail=.12,
                 source="LRO LOLA 5 m/pixel south-pole DEM (PGDA Site01)",
                 credit="NASA GSFC Planetary Geodesy Data Archive, LOLA 5 m/pixel DEM Site01 (Barker et al. 2021)",
                 note="Real LOLA terrain of the Shackleton - de Gerlache connecting ridge. Surface colour is synthetic (no imagery); sun 5° above the horizon as near the south pole."),
    "mars": dict(label="Mars · Jezero crater floor and delta", size=2400, grid=1024, tex=2048, sun=(255, 38), shadow=.45, detail=.08,
                 source="MRO HiRISE DTM DTEEC_045994_1985_046060_1985 + RED orthoimage",
                 credit="NASA/JPL/University of Arizona HiRISE; DTM and orthoimage by USGS Astrogeology (controlled DTMs)",
                 note="Real HiRISE terrain of Jezero crater floor near the Perseverance landing site. Colour is the HiRISE red-filter image tinted to Mars colours."),
}
COP = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM/Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM.tif"
HIRISE = "https://astrogeo-ard.s3-us-west-2.amazonaws.com/mars/mro/hirise/controlled/dtm/ESP_045994_1985_ESP_046060_1985/"
OMAN_CM1 = (22 + 54.433 / 60, 58 + 20.15 / 60)          # published hole CM1 position (Wadi Zeeb)
MARS_CENTRE_PX = (5300, 3100)                             # row, col in the 1 m DTM: between the landing site and the delta front
MARS_R = 3396190.0


# ---------------------------------------------------------------- helpers
def fill_nan(z):
    if np.isnan(z).any():
        m = np.isnan(z); z = z.copy(); z[m] = np.nanmedian(z)
    return z

def write_height(z, d, meta):
    z0, z1 = float(z.min()), float(z.max())
    q = np.round((z - z0) / max(z1 - z0, 1e-6) * 65535).astype(np.uint32)
    rgb = np.zeros(z.shape + (3,), np.uint8); rgb[..., 0] = q >> 8; rgb[..., 1] = q & 255
    Image.fromarray(rgb, "RGB").save(os.path.join(d, "height.png"), optimize=True)
    meta.update(z_min=0.0, z_max=round(z1 - z0, 3))

def shift(z, dy, dx):
    """z shifted so out[r, c] = z[r + dy, c + dx]; edges repeat (no wrap-around)"""
    p = max(abs(dy), abs(dx)); zp = np.pad(z, p, mode="edge"); n, m = z.shape
    return zp[p + dy: p + dy + n, p + dx: p + dx + m]

def shade_bake(z, res, sun, shadow_floor):
    """ambient occlusion (8-direction horizon) x sun shadow (march toward the sun), both 0..1"""
    n = z.shape[0]; ao = np.zeros_like(z)
    for k in range(8):
        a = k * math.pi / 4; dx, dy = math.cos(a), math.sin(a); mx = np.zeros_like(z)
        for s in (1, 2, 4, 7, 11, 16, 24):
            sh = shift(z, int(round(dy * s)), int(round(dx * s)))
            mx = np.maximum(mx, (sh - z) / (s * res))
        ao += np.arctan(np.maximum(mx, 0)) / (math.pi / 2)
    ao = 1 - np.clip(ao / 8 * 1.5, 0, .7)
    az, el = math.radians(sun[0]), math.radians(sun[1])
    sx, sy = math.sin(az), -math.cos(az)                  # +x east, rows grow southward
    lit = np.ones_like(z); t = math.tan(el)
    for s in np.unique(np.round(np.geomspace(1, n / 2, 48)).astype(int)):
        ox, oy = int(round(sx * s)), int(round(sy * s))
        sh = shift(z, oy, ox)
        lit = np.minimum(lit, np.clip(1 - (sh - z - s * res * t) / (2 * res), 0, 1))
    lit = shadow_floor + (1 - shadow_floor) * lit
    return ao, lit

def resize(img, n, mode=Image.BICUBIC):
    return np.asarray(Image.fromarray(img.astype(np.float32), "F").resize((n, n), mode))

def finish(name, z, colour, res_m):
    """z: grid x grid heights (m); colour: tex x tex x 3 float 0..1 (unshaded)"""
    W = WORLDS[name]; d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    z = fill_nan(z.astype(np.float64))
    meta = dict(label=W["label"], size_m=W["size"], grid=W["grid"], res_m=round(W["size"] / (W["grid"] - 1), 3),
                sun={"az": W["sun"][0], "el": W["sun"][1]}, detail_m=W["detail"], albedo="albedo.jpg",
                source=W["source"], credit=W["credit"], note=W["note"], placeholder=False)
    write_height(z, d, meta)
    ao, lit = shade_bake(resize(z, 512), W["size"] / 511, W["sun"], W["shadow"])
    T = colour.shape[0]
    shade = resize(ao, T) * resize(lit, T)
    rgb = np.clip(colour * shade[..., None], 0, 1)
    Image.fromarray((rgb * 255).astype(np.uint8), "RGB").save(os.path.join(d, "albedo.jpg"), quality=86, optimize=True)
    with open(os.path.join(d, "terrain.json"), "w", encoding="utf-8") as f: json.dump(meta, f, indent=2)
    print(f"{name}: relief {z.max() - z.min():.1f} m over {W['size']} m, grid {W['grid']} ({meta['res_m']} m), source {res_m} m")


# ---------------------------------------------------------------- Oman
def eox_mosaic(lat0, lat1, lon0, lon1, zoom=15):
    def tile_xy(lat, lon):
        n = 2 ** zoom; x = (lon + 180) / 360 * n
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        return x, y
    xa, ya = tile_xy(lat1, lon0); xb, yb = tile_xy(lat0, lon1)
    tx0, ty0, tx1, ty1 = int(xa), int(ya), int(xb), int(yb)
    mos = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            url = f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{zoom}/{ty}/{tx}.jpg"
            for attempt in range(3):
                try:
                    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read(); break
                except Exception:
                    time.sleep(1.5)
            mos[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
            time.sleep(.15)
    return mos, (tx0, ty0, zoom), tile_xy

def build_oman():
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds
    W = WORLDS["oman"]; lat, lon = OMAN_CM1
    dlat = W["size"] / 2 / 111320; dlon = W["size"] / 2 / (111320 * math.cos(math.radians(lat)))
    url = "/vsicurl/" + COP.format(lat=int(lat), lon=int(lon))
    with rasterio.open(url) as ds:
        win = from_bounds(lon - dlon, lat - dlat, lon + dlon, lat + dlat, ds.transform)
        z = ds.read(1, window=win, out_shape=(W["grid"], W["grid"]), resampling=Resampling.cubic)
    mos, (tx0, ty0, zoom), tile_xy = eox_mosaic(lat - dlat, lat + dlat, lon - dlon, lon + dlon)
    T = W["tex"]; ii, jj = np.meshgrid(np.arange(T), np.arange(T))
    lons = lon - dlon + (ii + .5) / T * 2 * dlon; lats = lat + dlat - (jj + .5) / T * 2 * dlat
    n = 2 ** zoom; px = ((lons + 180) / 360 * n - tx0) * 256
    py = ((1 - np.arcsinh(np.tan(np.radians(lats))) / math.pi) / 2 * n - ty0) * 256
    x0, y0 = np.clip(np.floor(px).astype(int), 0, mos.shape[1] - 2), np.clip(np.floor(py).astype(int), 0, mos.shape[0] - 2)
    fx, fy = (px - x0)[..., None], (py - y0)[..., None]; m = mos.astype(np.float32) / 255
    col = (m[y0, x0] * (1 - fx) + m[y0, x0 + 1] * fx) * (1 - fy) + (m[y0 + 1, x0] * (1 - fx) + m[y0 + 1, x0 + 1] * fx) * fy
    finish("oman", z, np.clip(col * 1.05, 0, 1), 30)


# ---------------------------------------------------------------- Moon
def build_moon(raw):
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import Window
    W = WORLDS["moon"]; path = os.path.join(raw, "moon_site01.tif")
    with rasterio.open(path) as ds:
        full = ds.read(1).astype(np.float64)
    zf = fill_nan(full); r = 5.0
    # pick the tile centre on the ridge: high ground that is also gentle (a landing zone), away from the edges
    co = zf[::4, ::4]; gy, gx = np.gradient(co, r * 4); slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    from numpy.lib.stride_tricks import sliding_window_view
    k = 9; pad = k // 2
    sm = sliding_window_view(np.pad(slope, pad, mode="edge"), (k, k)).mean((2, 3))
    hi = (co - co.min()) / (co.max() - co.min())
    score = hi - sm / 12
    half = int(W["size"] / 2 / (r * 4)) + 2
    score[:half] = score[-half:] = -9; score[:, :half] = score[:, -half:] = -9
    cr, cc = np.unravel_index(np.argmax(score), score.shape); cr, cc = cr * 4, cc * 4
    n = int(W["size"] / r); z = zf[cr - n // 2: cr + n // 2, cc - n // 2: cc + n // 2]
    z = resize(z, W["grid"], Image.BILINEAR) if z.shape[0] != W["grid"] else z
    # synthetic regolith colour: grey, slightly brighter on fresh steep slopes, fine mottling
    T = W["tex"]; zt = resize(z, T); g1, g2 = np.gradient(zt, W["size"] / T); sl = np.degrees(np.arctan(np.hypot(g1, g2)))
    rng = np.random.default_rng(4); mott = resize(rng.random((128, 128)), T) * .5 + resize(rng.random((512, 512)), T) * .5
    base = .50 + .12 * np.clip(sl / 30, 0, 1) + .08 * (mott - .5)
    col = np.dstack([base, base * .985, base * .965])
    finish("moon", z, col, 5)


# ---------------------------------------------------------------- Mars
def build_mars():
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import Window, from_bounds
    W = WORLDS["mars"]; G = W["grid"]
    with rasterio.open("/vsicurl/" + HIRISE + "DTEEC_045994_1985_046060_1985_U01.tif") as ds:
        r0, c0 = MARS_CENTRE_PX; n = int(W["size"] / ds.res[0])
        win = Window(c0 - n // 2, r0 - n // 2, n, n); bounds = ds.window_bounds(win)
        z = ds.read(1, window=win, out_shape=(G, G), resampling=Resampling.average).astype(np.float64)
        z[z < -1e30] = np.nan
    with rasterio.open("/vsicurl/" + HIRISE + "ESP_046060_1985_RED_A_01_ORTHO.tif") as ds:
        T = W["tex"]; img = ds.read(1, window=from_bounds(*bounds, ds.transform), out_shape=(T, T), resampling=Resampling.average).astype(np.float64)
    valid = img > 0
    lo, hi = np.percentile(img[valid], [1, 99.5]); t = np.clip((img - lo) / (hi - lo), 0, 1); t[~valid] = .5
    dark, light = np.array([.30, .17, .11]), np.array([.80, .58, .40])
    col = dark + (light - dark) * t[..., None] ** .9
    finish("mars", z, col, 1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("worlds", nargs="*", default=["oman", "moon", "mars"])
    ap.add_argument("--raw", default=os.path.join(HERE, "..", "raw"))
    a = ap.parse_args()
    for w in a.worlds:
        {"oman": build_oman, "moon": lambda: build_moon(a.raw), "mars": build_mars}[w]()
