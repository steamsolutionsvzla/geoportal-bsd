#!/usr/bin/env python3
"""
Genera los tiles offline (PMTiles) de los fondos del geoportal, IDÉNTICOS a
lo que se ve online hoy:

    clara            -> Esri World_Terrain_Base (igual que map-config.js)
    satelite         -> Esri World_Imagery
    satelite-labels  -> Esri World_Boundaries_and_Places (PNG transparente)

Requiere internet SOLO al ejecutarlo (una vez). Produce en public/tiles/:
    clara.pmtiles  satelite.pmtiles  satelite-labels.pmtiles

Uso:
    py scripts/generate-offline-tiles.py                     # Venezuela z5-13, 3 capas
    py scripts/generate-offline-tiles.py --layers clara      # solo una capa
    py scripts/generate-offline-tiles.py --layers satelite satelite-labels \
        --bbox -64.8,8.4,-63.2,10.4 --minzoom 14 --maxzoom 16   # zoom profundo por zona
    py scripts/generate-offline-tiles.py --concurrency 24    # hilos de descarga

Es reanudable: si se interrumpe, vuelve a ejecutar el mismo comando y continúa
los tiles que faltan (usa el .mbtiles como caché).
"""
import argparse
import gzip
import os
import random
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from pmtiles.convert import mbtiles_to_pmtiles
except ImportError:
    print("Falta la librería 'pmtiles'. Instálala con:  py -m pip install pmtiles")
    sys.exit(1)

# ---------------------------------------------------------------------------
# CONFIGURACIÓN
# ---------------------------------------------------------------------------
# BBOX por defecto: Venezuela (minx, miny, maxx, maxy).
BBOX = (-75.5, 0.5, -56.0, 13.6)
MINZOOM = 5
MAXZOOM = 13   # la fuente online "clara" corta en z13 y el relieve Esri no sube más

# Mismas URLs que usa el geoportal online (map-config.js) para que el
# resultado offline sea visualmente idéntico.
# clara-deep (CARTO light_nolabels, zoom profundo real z14-20) necesita la
# clave pública de CARTO: pasarla con --carto-key o la variable CARTO_KEY.
CARTO_KEY = os.environ.get("CARTO_KEY", "")

LAYERS = {
    "clara": {
        "url": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, and NPS",
        "name": "Mapa base fisico claro (Esri World_Terrain_Base)",
        "format": "jpg",
        # Esri RETIRO este servicio por encima de z9: de z10+ devuelve un
        # placeholder gris. No pedir mas alla de z9 (el zoom fino lo da
        # clara-deep/CARTO). mbtiles_to_pmtiles descarta al convertir.
        "maxzoom_cap": 9,
    },
    "satelite": {
        "url": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Tiles &copy; Esri",
        "name": "Imagen satelital (Esri World_Imagery)",
        "format": "jpg",
    },
    "satelite-labels": {
        "url": "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Labels &copy; Esri",
        "name": "Etiquetas satelitales (Esri World_Boundaries_and_Places)",
        "format": "png",
    },
    "clara-deep": {
        "url": "https://{sub}.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}.png?key={key}",
        "attribution": "&copy; OpenStreetMap contributors &copy; CARTO",
        "name": "Zoom profundo claro (CARTO light_nolabels)",
        "format": "png",
    },
}

USER_AGENT = "geoportal-bsd-offline-tiles/1.0 (uso interno; seed unico de tiles)"
TIMEOUT = 20
RETRIES = 3

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TILES_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "public", "tiles"))
# Caché reanudable (.mbtiles) FUERA de public/ para que el build no la copie
# a dist/. Solo los .pmtiles terminados viajan al sitio estático.
CACHE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", ".tiles-cache"))


# ---------------------------------------------------------------------------
# UTILIDADES DE TILE / BBOX
# ---------------------------------------------------------------------------
def deg2num(lat_deg, lon_deg, zoom):
    """Convierte lat/lon a tiles XYZ (slippy map)."""
    import math

    lat_rad = math.radians(lat_deg)
    n = 2.0**zoom
    x = int((lon_deg + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def tiles_for_bbox(bbox, z):
    minx, miny, maxx, maxy = bbox
    x1, y1 = deg2num(maxy, minx, z)  # esquina NO
    x2, y2 = deg2num(miny, maxx, z)  # esquina SE
    x1 = max(0, min(x1, (1 << z) - 1))
    x2 = max(0, min(x2, (1 << z) - 1))
    y1 = max(0, min(y1, (1 << z) - 1))
    y2 = max(0, min(y2, (1 << z) - 1))
    return [(z, x, y) for x in range(min(x1, x2), max(x1, x2) + 1) for y in range(min(y1, y2), max(y1, y2) + 1)]


def all_tiles(bbox, minzoom, maxzoom):
    tiles = []
    for z in range(minzoom, maxzoom + 1):
        tiles.extend(tiles_for_bbox(bbox, z))
    return tiles


# ---------------------------------------------------------------------------
# DESCARGA
# ---------------------------------------------------------------------------
def fetch_tile(layer_cfg, z, x, y, attempt=0):
    url = layer_cfg["url"].format(z=z, x=x, y=y, sub=random.choice("abc"), key=CARTO_KEY)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            if resp.status == 200:
                return resp.read()
            if resp.status in (204, 404):
                return None  # sin dato (océano), se omite
            raise urllib.error.HTTPError(url, resp.status, "HTTP %s" % resp.status, resp.headers, None)
    except urllib.error.HTTPError as e:
        if e.code in (204, 404):
            return None
        if attempt < RETRIES:
            time.sleep(0.8 * (attempt + 1) + random.random())
            return fetch_tile(layer_cfg, z, x, y, attempt + 1)
        print("  HTTP %s descartando tile z%d/%d/%d" % (e.code, z, x, y))
        return None
    except Exception:
        if attempt < RETRIES:
            time.sleep(0.8 * (attempt + 1) + random.random())
            return fetch_tile(layer_cfg, z, x, y, attempt + 1)
        print("  Error descargando tile z%d/%d/%d" % (z, x, y))
        return None


# ---------------------------------------------------------------------------
# MBTILES (caché reanudable)
# ---------------------------------------------------------------------------
def open_mbtiles(path):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS metadata (name text, value text)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (zoom_level, tile_column, tile_row)"
    )
    return conn


def load_existing(conn):
    return set(conn.execute("SELECT zoom_level, tile_column, tile_row FROM tiles"))


def write_metadata(conn, layer_cfg, bbox, minzoom, maxzoom):
    minx, miny, maxx, maxy = bbox
    meta = {
        "name": layer_cfg["name"],
        "format": layer_cfg.get("format", "png"),
        "bounds": "%f,%f,%f,%f" % (minx, miny, maxx, maxy),
        "center": "%f,%f,%d" % ((minx + maxx) / 2, (miny + maxy) / 2, minzoom + 3),
        "minzoom": str(minzoom),
        "maxzoom": str(maxzoom),
        "attribution": layer_cfg["attribution"],
        "type": "baselayer",
        "version": "1.1.0",
    }
    for k, v in meta.items():
        conn.execute("DELETE FROM metadata WHERE name = ?", (k,))
        conn.execute("INSERT INTO metadata (name, value) VALUES (?, ?)", (k, v))
    conn.commit()


def download_layer(layer_name, layer_cfg, bbox, minzoom, maxzoom, concurrency, resume):
    os.makedirs(TILES_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    mbtiles_path = os.path.join(CACHE_DIR, "%s.mbtiles" % layer_name)
    pmtiles_path = os.path.join(TILES_DIR, "%s.pmtiles" % layer_name)

    # Migración: si aún existe la caché vieja dentro de public/tiles, se traslada.
    old_cache = os.path.join(TILES_DIR, "%s.mbtiles" % layer_name)
    if os.path.exists(old_cache) and not os.path.exists(mbtiles_path):
        os.replace(old_cache, mbtiles_path)
        print("[%s] caché migrada a %s" % (layer_name, CACHE_DIR))

    tiles = all_tiles(bbox, minzoom, maxzoom)
    conn = open_mbtiles(mbtiles_path)
    write_metadata(conn, layer_cfg, bbox, minzoom, maxzoom)

    existing = load_existing(conn) if resume else set()
    if not resume:
        conn.execute("DELETE FROM tiles")
        conn.commit()
        existing = set()

    pending = [t for t in tiles if (t[0], t[1], (1 << t[0]) - 1 - t[2]) not in existing]
    print("[%s] tiles totales=%d, ya existentes=%d, por descargar=%d" % (layer_name, len(tiles), len(existing), len(pending)))
    if not pending:
        print("[%s] nada que descargar" % layer_name)
    else:
        done = 0
        t0 = time.time()
        batch = []
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = {pool.submit(fetch_tile, layer_cfg, z, x, y): (z, x, y) for (z, x, y) in pending}
            for fut in as_completed(futures):
                z, x, y = futures[fut]
                data = fut.result()
                done += 1
                if data:
                    # MBTiles usa y en sistema TMS (invertido)
                    row = (1 << z) - 1 - y
                    batch.append((z, x, row, data))
                if len(batch) >= 500:
                    conn.executemany("INSERT OR REPLACE INTO tiles VALUES (?,?,?,?)", batch)
                    conn.commit()
                    batch = []
                if done % 2000 == 0 or done == len(pending):
                    rate = done / max(time.time() - t0, 0.001)
                    pct = 100.0 * done / len(pending)
                    rest = (len(pending) - done) / max(rate, 0.001)
                    print("[%s] %d/%d (%.1f%%) — %.1f tiles/s — faltan ~%.0f min" % (layer_name, done, len(pending), pct, rate, rest / 60))
        if batch:
            conn.executemany("INSERT OR REPLACE INTO tiles VALUES (?,?,?,?)", batch)
            conn.commit()

    total = conn.execute("SELECT COUNT(*) FROM tiles").fetchone()[0]
    conn.close()
    print("[%s] convirtiendo %d tiles a PMTiles..." % (layer_name, total))
    mbtiles_to_pmtiles(mbtiles_path, pmtiles_path, maxzoom)
    size_mb = os.path.getsize(pmtiles_path) / (1024 * 1024)
    print("[%s] listo: %s (%.1f MB)" % (layer_name, pmtiles_path, size_mb))


def parse_bbox(texto):
    """'-75.5,0.5,-56.0,13.6' -> (minx, miny, maxx, maxy)."""
    partes = [p.strip() for p in texto.split(",")]
    if len(partes) != 4:
        raise argparse.ArgumentTypeError("--bbox necesita 4 valores: minx,miny,maxx,maxy")
    try:
        vals = tuple(float(p) for p in partes)
    except ValueError:
        raise argparse.ArgumentTypeError("--bbox necesita números")
    minx, miny, maxx, maxy = vals
    if minx >= maxx or miny >= maxy:
        raise argparse.ArgumentTypeError("--bbox: minx<maxx y miny<maxy requeridos")
    return vals


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Genera PMTiles offline de los fondos del geoportal")
    parser.add_argument("--layers", nargs="+", choices=list(LAYERS.keys()), default=list(LAYERS.keys()))
    parser.add_argument("--bbox", type=parse_bbox, default=BBOX,
                        help="'minx,miny,maxx,maxy' (default: Venezuela -75.5,0.5,-56.0,13.6)")
    parser.add_argument("--minzoom", type=int, default=MINZOOM)
    parser.add_argument("--maxzoom", type=int, default=MAXZOOM)
    parser.add_argument("--concurrency", type=int, default=16)
    parser.add_argument("--carto-key", default=None,
                        help="Clave publica CARTO para la capa clara-deep (o variable de env CARTO_KEY)")
    parser.add_argument("--no-resume", action="store_true", help="Ignora tiles ya descargados y empieza de cero")
    args = parser.parse_args()

    global CARTO_KEY
    if args.carto_key:
        CARTO_KEY = args.carto_key
    if "clara-deep" in args.layers and not CARTO_KEY:
        print("Falta la clave de CARTO para clara-deep: use --carto-key KEY o defina CARTO_KEY (ver PUBLIC_CARTO_KEY en frontend/.env)")
        sys.exit(1)

    print("BBOX=%s  zoom=%d-%d  capas=%s" % (args.bbox, args.minzoom, args.maxzoom, ",".join(args.layers)))
    for name in args.layers:
        cap = LAYERS[name].get("maxzoom_cap")
        zm = min(args.maxzoom, cap) if cap else args.maxzoom
        if cap and args.maxzoom > cap:
            print("[%s] maxzoom limitado a %d (tope real del servicio)" % (name, zm))
        download_layer(name, LAYERS[name], args.bbox, args.minzoom, zm, args.concurrency, resume=not args.no_resume)
    print("Terminado.")


if __name__ == "__main__":
    main()
