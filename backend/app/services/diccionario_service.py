# app/services/diccionario_service.py
"""
Diccionario de datos GIS (catálogo de campos) de todos los esquemas PostGIS
cuyo nombre empieza por `gis_`.

Características:
  - Descubrimiento dinámico: cualquier esquema nuevo `gis_*` aparece solo,
    sin cambios de código (no hay lista blanca de esquemas).
  - Una sola pasada por catálogo (information_schema / pg_class) + conteo por
    tabla, evitando N+1 de columnas.
  - Cruce con el esquema propio `metadatos` (metadata_capa / metadata_campo)
    cuando existe; si no existe, el catálogo sigue funcionando.
  - Caché en memoria con TTL corto; `refresh=True` la invalida (botón
    "Actualizar" del frontend).
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("app.services.diccionario")

GIS_PREFIX = "gis_"
COUNT_CONCURRENCY = 6

# Caché en proceso: {"at": epoch, "data": dict}
_cache: Dict[str, Any] = {"at": 0.0, "data": None}
_cache_lock = asyncio.Lock()

_CRS_NAME_RE = re.compile(r'^(?:PROJCS|GEOGCS|COMPD_CS)\["([^"]+)"')


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _norm(text: Any) -> str:
    return str(text or "").strip().casefold()


def _crs_name(srtext: Optional[str], srid: int) -> str:
    if srtext:
        match = _CRS_NAME_RE.match(srtext.strip())
        if match:
            return match.group(1)
    return f"EPSG:{srid}"


def _column_role(column: str, geometry_column: str, position: int) -> str:
    if _norm(column) == _norm(geometry_column):
        return "geometry"
    if position == 1 and _norm(column) in {"id", "gid", "fid", "objectid", "ogc_fid"}:
        return "id"
    return "attribute"


def _layer_warnings(
    layer: Dict[str, Any], meta: Optional[Dict[str, Any]]
) -> List[str]:
    warnings: List[str] = []
    if layer["features"] == 0:
        warnings.append("Capa vacía (0 objetos)")
    if meta is None:
        warnings.append("Sin metadatos")
        return warnings
    if not (meta.get("titulo") or "").strip():
        warnings.append("Sin título")
    if not (meta.get("resumen") or "").strip():
        warnings.append("Sin resumen")
    declared = meta.get("num_entidades")
    if declared is None:
        warnings.append("Sin nº de entidades declarado")
    elif int(declared) != layer["features"]:
        warnings.append(
            f"Conteo declarado {int(declared)} ≠ real {layer['features']}"
        )
    geom_meta = (meta.get("tipo_geometria") or "").strip()
    if geom_meta and "*" in geom_meta:
        warnings.append("Tipo de geometría genérico (MULTI*)")
    epsg = layer.get("epsg")
    if "EPSG:4326" in (meta.get("resumen") or "") and epsg and int(epsg) != 4326:
        warnings.append("El resumen cita EPSG:4326")
    return warnings


# ---------------------------------------------------------------------------
# Consultas
# ---------------------------------------------------------------------------
async def _fetch_optional(pool, sql: str, *args) -> List[Dict[str, Any]]:
    """Consulta tolerante: si el esquema `metadatos` no existe, devuelve []."""
    try:
        return [dict(r) for r in await pool.fetch(sql, *args)]
    except Exception as exc:  # noqa: BLE001 - catálogo no debe caerse
        logger.warning("Consulta opcional fallida (%s): %s", sql.split()[1:4], exc)
        return []


async def _schemas(pool) -> List[str]:
    rows = await pool.fetch(
        """
        SELECT nspname
        FROM pg_namespace
        WHERE starts_with(nspname, $1)
        ORDER BY 1;
        """,
        GIS_PREFIX,
    )
    return [r["nspname"] for r in rows]


async def _geometries(pool) -> Dict[str, Dict[str, Any]]:
    rows = await pool.fetch(
        """
        SELECT f_table_schema, f_table_name, f_geometry_column, type, srid
        FROM geometry_columns
        WHERE starts_with(f_table_schema, $1);
        """,
        GIS_PREFIX,
    )
    return {f"{r['f_table_schema']}.{r['f_table_name']}": dict(r) for r in rows}


async def _columns(pool) -> Dict[str, List[Dict[str, Any]]]:
    rows = await pool.fetch(
        """
        SELECT c.table_schema,
               c.table_name,
               c.column_name,
               c.data_type,
               c.character_maximum_length,
               c.numeric_precision,
               c.numeric_scale,
               c.is_nullable,
               c.column_default,
               c.ordinal_position,
               col_description(
                   format('%I.%I', c.table_schema, c.table_name)::regclass::oid,
                   c.ordinal_position
               ) AS comment
        FROM information_schema.columns AS c
        WHERE starts_with(c.table_schema, $1)
        ORDER BY c.table_schema, c.table_name, c.ordinal_position;
        """,
        GIS_PREFIX,
    )
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(f"{row['table_schema']}.{row['table_name']}", []).append(dict(row))
    return grouped


async def _relation_comments(pool) -> Dict[str, str]:
    rows = await pool.fetch(
        """
        SELECT n.nspname AS schema_name,
               c.relname  AS table_name,
               obj_description(c.oid, 'pg_class') AS comment
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE starts_with(n.nspname, $1);
        """,
        GIS_PREFIX,
    )
    return {
        f"{r['schema_name']}.{r['table_name']}": (r["comment"] or "").strip()
        for r in rows
        if (r["comment"] or "").strip()
    }


async def _srs_names(pool, srids: List[int]) -> Dict[int, Dict[str, str]]:
    if not srids:
        return {}
    rows = await pool.fetch(
        """
        SELECT srid, auth_name, srtext
        FROM spatial_ref_sys
        WHERE srid = ANY($1::int[]);
        """,
        srids,
    )
    return {
        int(r["srid"]): {
            "auth": (r["auth_name"] or "EPSG").upper(),
            "name": _crs_name(r["srtext"], int(r["srid"])),
        }
        for r in rows
    }


async def _metadata(pool) -> Dict[str, Dict[str, Any]]:
    rows = await _fetch_optional(
        pool,
        """
        SELECT id, esquema_capa, nombre_tabla_capa, titulo, resumen,
               palabras_clave, licencias, restricciones, num_entidades,
               tipo_geometria, crs_epsg, fecha_carga, fecha_creado,
               fecha_publicado, fecha_revisado, identificador, fuente
        FROM metadatos.metadata_capa;
        """,
    )
    return {
        f"{_norm(r['esquema_capa'])}.{_norm(r['nombre_tabla_capa'])}": r for r in rows
    }


async def _metadata_fields(pool) -> Dict[int, List[Dict[str, Any]]]:
    rows = await _fetch_optional(
        pool,
        """
        SELECT metadata_id, nombre, tipo, nulos, unicos, ejemplo
        FROM metadatos.metadata_campo
        ORDER BY metadata_id, id;
        """,
    )
    grouped: Dict[int, List[Dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(int(row["metadata_id"]), []).append(dict(row))
    return grouped


async def _table_stats(
    pool, schema: str, table: str, geom_column: str, semaphore: asyncio.Semaphore
) -> Dict[str, Any]:
    """Conteo exacto + extensión en el SRS nativo de la capa."""
    empty = {"features": 0, "extent": None}
    async with semaphore:
        try:
            row = await pool.fetchrow(
                f'SELECT COUNT(*)::bigint AS n, '
                f'ST_XMin(ST_Extent("{geom_column}")) AS xmin, '
                f'ST_YMin(ST_Extent("{geom_column}")) AS ymin, '
                f'ST_XMax(ST_Extent("{geom_column}")) AS xmax, '
                f'ST_YMax(ST_Extent("{geom_column}")) AS ymax '
                f'FROM "{schema}"."{table}";'
            )
        except Exception as exc:  # noqa: BLE001
            logger.info("Sin conteo para %s.%s: %s", schema, table, exc)
            return empty
    if row is None:
        return empty
    coords = [row["xmin"], row["ymin"], row["xmax"], row["ymax"]]
    extent = [round(float(c), 6) for c in coords] if all(c is not None for c in coords) else None
    return {"features": int(row["n"] or 0), "extent": extent}


# ---------------------------------------------------------------------------
# Construcción del catálogo
# ---------------------------------------------------------------------------
async def build_catalog(pool) -> Dict[str, Any]:
    schemas = await _schemas(pool)
    geoms = await _geometries(pool)
    columns = await _columns(pool)
    comments = await _relation_comments(pool)
    metadata = await _metadata(pool)
    metadata_fields = await _metadata_fields(pool)

    srids = sorted({int(g["srid"]) for g in geoms.values() if g.get("srid")})
    srs = await _srs_names(pool, srids)

    semaphore = asyncio.Semaphore(COUNT_CONCURRENCY)
    stats = await asyncio.gather(
        *(
            _table_stats(pool, g["f_table_schema"], g["f_table_name"],
                         g["f_geometry_column"], semaphore)
            for g in geoms.values()
        )
    )
    stats_by_key = {
        key: value for key, value in zip(geoms.keys(), stats)
    }

    # Metadatos de campos indexados por "esquema.tabla" y por nombre de campo
    by_schema: Dict[str, List[Dict[str, Any]]] = {name: [] for name in schemas}

    for key, geom in sorted(geoms.items(), key=lambda kv: (_norm(kv[0]))):
        schema = geom["f_table_schema"]
        table = geom["f_table_name"]
        if schema not in by_schema:
            continue

        info = stats_by_key.get(key) or {"features": 0, "extent": None}
        meta = metadata.get(f"{_norm(schema)}.{_norm(table)}")
        meta_id = int(meta["id"]) if meta and meta.get("id") is not None else None
        field_docs = {
            _norm(doc["nombre"]): doc for doc in (metadata_fields.get(meta_id, []) if meta_id else [])
        }

        raw_columns = columns.get(key, [])
        fields: List[Dict[str, Any]] = []
        for col in raw_columns:
            name = col["column_name"]
            role = _column_role(name, geom["f_geometry_column"], col["ordinal_position"])
            doc = field_docs.get(_norm(name))
            length = col["character_maximum_length"] or col["numeric_precision"]
            if length is None and col["data_type"] in ("integer", "bigint", "smallint"):
                length = None
            fields.append({
                "name": name,
                "type": col["data_type"],
                "length": length,
                "precision": col["numeric_scale"],
                "nullable": (col["is_nullable"] or "").upper() == "YES",
                "default": col["column_default"],
                "comment": col["comment"],
                "role": role,
                "position": col["ordinal_position"],
                "documented": doc is not None,
                "doc_type": (doc or {}).get("tipo"),
                "doc_nulls": (doc or {}).get("nulos"),
                "doc_uniques": (doc or {}).get("unicos"),
                "doc_example": (doc or {}).get("ejemplo"),
            })

        documented = sum(1 for f in fields if f["documented"])
        srid = int(geom["srid"]) if geom.get("srid") else None
        srs_info = srs.get(srid or 0, {})
        layer = {
            "schema": schema,
            "table": table,
            "key": key,
            "title": (meta or {}).get("titulo") or "",
            "abstract": (meta or {}).get("resumen") or "",
            "keywords": (meta or {}).get("palabras_clave") or "",
            "license": (meta or {}).get("licencias") or "",
            "identifier": (meta or {}).get("identificador") or "",
            "fuente": (meta or {}).get("fuente") or "Datos heredados",
            "geom": (geom.get("type") or "").upper(),
            "geometry_column": geom["f_geometry_column"],
            "srid": srid,
            "srs": srs_info.get("name") or (f"EPSG:{srid}" if srid else ""),
            "epsg": srid,
            "features": info["features"],
            "declared_features": (meta or {}).get("num_entidades"),
            "extent": info["extent"],
            "comment": comments.get(key) or "",
            "has_metadata": meta is not None,
            "fields_total": len(fields),
            "fields_documented": documented,
            "warnings": [],
            "fields": fields,
        }
        layer["warnings"] = _layer_warnings(layer, meta)
        by_schema[schema].append(layer)

    payload_schemas = []
    for name in schemas:
        layers = by_schema.get(name) or []
        layers.sort(key=lambda item: _norm(item["title"] or item["table"]))
        payload_schemas.append({
            "name": name,
            "layers": layers,
            "layers_count": len(layers),
            "fields_count": sum(item["fields_total"] for item in layers),
            "features_count": sum(item["features"] for item in layers),
        })

    all_layers = [layer for schema in payload_schemas for layer in schema["layers"]]
    totals = {
        "schemas": len(payload_schemas),
        "layers": len(all_layers),
        "fields": sum(layer["fields_total"] for layer in all_layers),
        "fields_documented": sum(layer["fields_documented"] for layer in all_layers),
        "features": sum(layer["features"] for layer in all_layers),
        "layers_with_metadata": sum(
            1 for layer in all_layers if layer["has_metadata"]
        ),
        "layers_empty": sum(1 for layer in all_layers if layer["features"] == 0),
    }
    totals["fields_undocumented"] = totals["fields"] - totals["fields_documented"]

    database = {}
    try:
        row = await pool.fetchrow(
            "SELECT current_database() AS name, current_setting('server_version') AS version;"
        )
        database = {"name": row["name"], "version": row["version"]} if row else {}
    except Exception:  # noqa: BLE001
        pass
    try:
        database["postgis"] = await pool.fetchval("SELECT postgis_version();")
    except Exception:  # noqa: BLE001
        pass

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "prefix": GIS_PREFIX,
        "database": database,
        "totals": totals,
        "schemas": payload_schemas,
    }


async def get_catalog(pool, refresh: bool = False, ttl: float = 60.0) -> Dict[str, Any]:
    """Devuelve el catálogo, usando caché salvo `refresh=True`."""
    now = time.monotonic()
    if not refresh and _cache["data"] is not None and (now - _cache["at"]) < ttl:
        return _cache["data"]

    async with _cache_lock:
        # Otra petición pudo refrescar mientras esperábamos el lock.
        now = time.monotonic()
        if not refresh and _cache["data"] is not None and (now - _cache["at"]) < ttl:
            return _cache["data"]
        data = await build_catalog(pool)
        _cache["data"] = data
        _cache["at"] = time.monotonic()
        return data


def invalidate_cache() -> None:
    _cache["data"] = None
    _cache["at"] = 0.0
