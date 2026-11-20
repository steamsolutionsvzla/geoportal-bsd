"""Exporta la división político-territorial a un GeoJSON estático para el frontend.

Uso (desde la raíz del repo):
    backend/venv/Scripts/python.exe backend/scripts/export_estados_geojson.py \
        --password 0907

El archivo generado se sirve desde frontend/public/data/estados-venezuela.geojson
y es la fuente principal del filtro de estados: así el geoportal no depende de
que la capa exista en GeoServer.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from pathlib import Path

import asyncpg

DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "public"
    / "data"
    / "estados-venezuela.geojson"
)


def _identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value or ""):
        raise argparse.ArgumentTypeError(f"Identificador inválido: {value!r}")
    return value


async def export(args: argparse.Namespace) -> None:
    conn = await asyncpg.connect(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        database=args.database,
    )
    try:
        query = f"""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', jsonb_agg(
                    jsonb_build_object(
                        'type', 'Feature',
                        'properties', jsonb_build_object(
                            'estado', "ESTADO",
                            'objectid', "OBJECTID"
                        ),
                        'geometry', ST_AsGeoJSON(
                            ST_Transform("{args.geom_column}", 4326), 6
                        )::jsonb
                    )
                    ORDER BY "ESTADO"
                )
            )::text
            FROM "{args.schema}"."{args.table}"
            WHERE "{args.geom_column}" IS NOT NULL;
        """
        payload = await conn.fetchval(query)
    finally:
        await conn.close()

    if not payload:
        raise SystemExit("La tabla no devolvió estados.")

    data = json.loads(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

    print(f"OK {len(data.get('features', []))} estados -> {args.output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("ESTADOS_DB_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("ESTADOS_DB_PORT", "5433")))
    parser.add_argument("--user", default=os.getenv("ESTADOS_DB_USER", "postgres"))
    parser.add_argument("--password", default=os.getenv("ESTADOS_DB_PASSWORD", ""))
    parser.add_argument("--database", default=os.getenv("ESTADOS_DB_NAME", "petroleo_db"))
    parser.add_argument("--schema", type=_identifier, default="gis_territorio")
    parser.add_argument("--table", type=_identifier, default="dpt_estadal_venezuela_pl")
    parser.add_argument("--geom-column", type=_identifier, default="geom")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    asyncio.run(export(parser.parse_args()))


if __name__ == "__main__":
    main()
