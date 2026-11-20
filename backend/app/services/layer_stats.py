"""Clasificación dinámica de capas pesadas.

No depende de nombres de capa: usa el mapeo de GeoServer a tabla nativa y
estadísticas de PostGIS (filas aproximadas y tamaño de la tabla). Una capa
nueva que supere los umbrales se marca como pesada automáticamente.
"""
import logging
from typing import Dict, List

from app.config import settings
from app.db.database import get_pool
from app.services.geoserver_service import GeoServerService

logger = logging.getLogger(__name__)


async def enrich_groups_with_stats(groups: List[Dict]) -> List[Dict]:
    """Agrega feature_count, size_bytes y heavy a cada capa del catálogo."""
    try:
        pool = get_pool()
    except Exception:
        # Sin pool (tests, arranque incompleto): se devuelve el catálogo tal cual.
        return groups

    # El catálogo ya trae "native" desde el mismo detalle de featuretype.
    # Solo se consulta el mapa completo si alguna capa antigua no lo incluye.
    necesita_mapa = any(
        not (layer.get("native"))
        for group in groups
        for layer in (group.get("layers") or [])
        if (layer.get("type") or "").lower() != "raster"
    )
    nativas: Dict[str, str] = {}
    if necesita_mapa:
        try:
            nativas = await GeoServerService.get_native_table_names()
        except Exception as exc:
            logger.warning("Sin mapa de tablas nativas para clasificar capas: %s", exc)
            nativas = {}

    tablas = sorted({
        (layer.get("native") or nativas.get(layer.get("id")))
        for group in groups
        for layer in (group.get("layers") or [])
        if (layer.get("type") or "").lower() != "raster"
        and (layer.get("native") or nativas.get(layer.get("id")))
    })
    if not tablas:
        return groups

    try:
        rows = await pool.fetch(
            """
            SELECT n.nspname,
                   c.relname,
                   c.reltuples::bigint AS filas,
                   pg_relation_size(c.oid) AS bytes
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = ANY($1::text[])
              AND c.relkind IN ('r', 'm', 'p', 'v')
            """,
            tablas,
        )
    except Exception as exc:
        logger.warning("No se pudieron leer tamaños de capas: %s", exc)
        return groups

    stats: Dict[str, Dict] = {}
    for row in rows:
        nombre = row["relname"]
        filas = int(row["filas"] or 0)
        size = int(row["bytes"] or 0)
        anterior = stats.get(nombre)
        preferir = (
            anterior is None
            or (row["nspname"] == "public" and anterior["schema"] != "public")
            or (row["nspname"] == anterior["schema"] and size > anterior["bytes"])
        )
        if preferir:
            stats[nombre] = {
                "schema": row["nspname"],
                "filas": max(0, filas),
                "bytes": max(0, size),
            }

    min_features = max(0, int(settings.HEAVY_LAYER_MIN_FEATURES or 0))
    min_bytes = max(1, int(settings.HEAVY_LAYER_MIN_MB or 1)) * 1024 * 1024

    for group in groups:
        for layer in group.get("layers") or []:
            if (layer.get("type") or "").lower() == "raster":
                layer["feature_count"] = None
                layer["size_bytes"] = None
                layer["heavy"] = False
                continue

            nativa = layer.get("native") or nativas.get(layer.get("id"))
            info = stats.get(nativa) if nativa else None
            if not info:
                layer["feature_count"] = None
                layer["size_bytes"] = None
                layer["heavy"] = False
                continue

            layer["feature_count"] = info["filas"]
            layer["size_bytes"] = info["bytes"]
            layer["heavy"] = (
                (min_features > 0 and info["filas"] >= min_features)
                or info["bytes"] >= min_bytes
            )

    return groups
