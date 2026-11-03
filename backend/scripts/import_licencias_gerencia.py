"""Importa LICENCIAS_2 al schema gerencial de PostGIS.

Uso dentro del contenedor del backend:

    python scripts/import_licencias_gerencia.py --src /tmp/LICENCIAS_2/LICENCIAS_2.shp

El script es idempotente: usa COD_L1 como clave y actualiza los registros
existentes en lugar de duplicarlos.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from pathlib import Path

import asyncpg
import shapefile


SCHEMA = "gis_gerencia"
TABLE = "licencias"
QUALIFIED_TABLE = f"{SCHEMA}.{TABLE}"


def parse_year(codigo: str) -> int | None:
    match = re.search(r"-(\d{4})-", codigo or "")
    return int(match.group(1)) if match else None


def parse_duration_years(duracion: str) -> int | None:
    match = re.search(r"(\d+)", duracion or "")
    return int(match.group(1)) if match else None


def ring_to_wkt(points: list[tuple[float, float]]) -> str:
    if not points:
        raise ValueError("Anillo vacío")
    ring = list(points)
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return "(" + ", ".join(f"{x:.10f} {y:.10f}" for x, y in ring) + ")"


def shape_to_wkt(shape: shapefile.Shape) -> str:
    """Convierte un Polygon de shapefile a MULTIPOLYGON WKT.

    LICENCIAS_2 tiene un solo anillo por feature. Si en el futuro llega un
    shapefile multiparte, cada parte se trata como un polígono exterior.
    """
    parts = list(shape.parts) + [len(shape.points)]
    polygons: list[str] = []
    for i in range(len(parts) - 1):
        start, end = parts[i], parts[i + 1]
        if end - start < 3:
            continue
        polygons.append("(" + ring_to_wkt(shape.points[start:end]) + ")")
    if not polygons:
        raise ValueError("Geometría sin anillos válidos")
    return "MULTIPOLYGON(" + ", ".join(polygons) + ")"


def read_features(src: Path) -> list[dict]:
    reader = shapefile.Reader(str(src), encoding="utf-8")
    rows: list[dict] = []
    for idx in range(len(reader)):
        record = reader.record(idx).as_dict()
        shape = reader.shape(idx)
        codigo = str(record.get("COD_L1") or "").strip()
        if not codigo:
            raise ValueError(f"Registro {idx} sin COD_L1")
        rows.append(
            {
                "codigo": codigo,
                "n_poligono": int(record["N_POLIGO"]) if record.get("N_POLIGO") is not None else None,
                "empresa": (record.get("EMPRESA") or "").strip(),
                "tipo": (record.get("TIPO") or "").strip(),
                "estatus": (record.get("ESTATUS") or "").strip(),
                "duracion": (record.get("DURACION") or "").strip(),
                "duracion_anios": parse_duration_years(record.get("DURACION") or ""),
                "anio": parse_year(codigo),
                "area_ha": float(record["SU_HA"]) if record.get("SU_HA") is not None else None,
                "objectid_original": int(record["OBJECTID"]) if record.get("OBJECTID") is not None else None,
                "geom_wkt": shape_to_wkt(shape),
            }
        )
    reader.close()
    if len({r["codigo"] for r in rows}) != len(rows):
        raise ValueError("COD_L1 contiene valores duplicados; se necesita una clave única.")
    return rows


DDL = f"""
CREATE SCHEMA IF NOT EXISTS {SCHEMA};

CREATE TABLE IF NOT EXISTS {QUALIFIED_TABLE} (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo            text NOT NULL UNIQUE,
    n_poligono        integer,
    empresa           text,
    tipo              text,
    estatus           text,
    duracion          text,
    duracion_anios    integer,
    anio              integer,
    area_ha           numeric(16, 3),
    area_km2          numeric(16, 3) GENERATED ALWAYS AS (area_ha / 100) STORED,
    objectid_original integer,
    geom              geometry(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS licencias_geom_gix
    ON {QUALIFIED_TABLE}
    USING GIST (geom);
"""

UPSERT = f"""
INSERT INTO {QUALIFIED_TABLE}
    (codigo, n_poligono, empresa, tipo, estatus, duracion, duracion_anios,
     anio, area_ha, objectid_original, geom)
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
     ST_Multi(ST_MakeValid(ST_GeomFromText($11, 4326))))
ON CONFLICT (codigo) DO UPDATE SET
    n_poligono = EXCLUDED.n_poligono,
    empresa = EXCLUDED.empresa,
    tipo = EXCLUDED.tipo,
    estatus = EXCLUDED.estatus,
    duracion = EXCLUDED.duracion,
    duracion_anios = EXCLUDED.duracion_anios,
    anio = EXCLUDED.anio,
    area_ha = EXCLUDED.area_ha,
    objectid_original = EXCLUDED.objectid_original,
    geom = EXCLUDED.geom;
"""


async def import_rows(rows: list[dict], dsn: str) -> None:
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(DDL)
        async with conn.transaction():
            for row in rows:
                await conn.execute(
                    UPSERT,
                    row["codigo"],
                    row["n_poligono"],
                    row["empresa"],
                    row["tipo"],
                    row["estatus"],
                    row["duracion"],
                    row["duracion_anios"],
                    row["anio"],
                    row["area_ha"],
                    row["objectid_original"],
                    row["geom_wkt"],
                )
        count = await conn.fetchval(f"SELECT count(*) FROM {QUALIFIED_TABLE}")
        invalid = await conn.fetchval(
            f"SELECT count(*) FROM {QUALIFIED_TABLE} WHERE NOT ST_IsValid(geom)"
        )
        bad_srid = await conn.fetchval(
            f"SELECT count(*) FROM {QUALIFIED_TABLE} WHERE ST_SRID(geom) <> 4326"
        )
        bbox = await conn.fetchrow(
            f"SELECT ST_Extent(geom)::text AS bbox, "
            f"round(sum(area_km2)::numeric, 2) AS area_km2 FROM {QUALIFIED_TABLE}"
        )
        print(f"Importados: {count} registros")
        print(f"Geometrías inválidas: {invalid}")
        print(f"Geometrías con SRID distinto de 4326: {bad_srid}")
        print(f"BBox: {bbox['bbox']}")
        print(f"Área total: {bbox['area_km2']} km²")
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True, help="Ruta al archivo .shp")
    parser.add_argument("--dsn", default=os.environ.get("DATABASE_URL"))
    args = parser.parse_args()

    src = Path(args.src)
    if not src.exists():
        sys.exit(f"No existe el shapefile: {src}")
    if not args.dsn:
        sys.exit("Falta DATABASE_URL o --dsn")

    rows = read_features(src)
    print(f"Leídos {len(rows)} registros de {src.name}")
    asyncio.run(import_rows(rows, args.dsn))


if __name__ == "__main__":
    main()
