# app/api/admin.py
# Estadísticas reales para el dashboard de administración.
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import allowed_workspaces, filter_layers_by_workspace, role_guard
from app.db.database import get_pool
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService
from app.services.layer_service import count_table_features

logger = logging.getLogger("app.api.admin")

router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])


@router.get("/stats")
async def admin_stats(user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.GERENTE))):
    """
    Métricas reales del catálogo para el dashboard (sin datos de licencias:
    esas viven en /api/v1/manager/licenses y son solo para el rol gerente).

    - Capas publicadas (vector / ráster) y registros totales por capa/workspace.
    - Capas con ficha de metadatos.
    - Sesiones activas.
    """
    try:
        groups = await GeoServerService.get_workspaces_with_layers(only=allowed_workspaces(user))
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("No se pudo listar workspaces: %s", exc)
        raise HTTPException(502, "No se pudo consultar el catálogo de GeoServer.")

    try:
        nativas = await GeoServerService.get_native_table_names()
    except Exception as exc:
        logger.warning("Sin mapa de tablas nativas: %s", exc)
        nativas = {}

    pool = get_pool()

    # Lista plana (workspace, capa) respetando los workspaces del usuario.
    items: List[Dict[str, Any]] = []
    for group in groups:
        ws = group.get("name") or "—"
        for layer in filter_layers_by_workspace(user, group.get("layers") or []):
            items.append({
                "id": layer.get("id"),
                "name": layer.get("name") or layer.get("id"),
                "type": layer.get("type") or "fill",
                "workspace": ws,
            })

    semaforo = asyncio.Semaphore(6)

    async def contar(layer: Dict[str, Any]) -> Optional[int]:
        if layer["type"] == "raster":
            return None
        table = nativas.get(layer["id"]) or str(layer["id"]).split(":", 1)[-1]
        async with semaforo:
            try:
                return await count_table_features(pool, table)
            except Exception as exc:
                logger.debug("Fallo contando %s: %s", layer["id"], exc)
                return None

    conteos = await asyncio.gather(*(contar(it) for it in items))

    by_layer: List[Dict[str, Any]] = []
    by_ws: Dict[str, Dict[str, Any]] = {}
    for layer, total in zip(items, conteos):
        count = int(total or 0)
        by_layer.append({**layer, "count": count})

        ws = by_ws.setdefault(layer["workspace"], {
            "name": layer["workspace"], "layers": 0, "vector": 0, "raster": 0, "features": 0,
        })
        ws["layers"] += 1
        ws["features"] += count
        if layer["type"] == "raster":
            ws["raster"] += 1
        else:
            ws["vector"] += 1

    by_layer.sort(key=lambda x: x["count"], reverse=True)
    vector = sum(1 for it in items if it["type"] != "raster")
    raster = len(items) - vector

    # Metadatos y sesiones: consultas baratas y tolerantes a fallos.
    metadata_layers = None
    active_sessions = None
    try:
        metadata_layers = int(await pool.fetchval("SELECT COUNT(*) FROM metadatos.metadata_capa;"))
    except Exception as exc:
        logger.debug("Sin tabla de metadatos: %s", exc)
    try:
        active_sessions = int(await pool.fetchval(
            "SELECT COUNT(*) FROM auth_sessions WHERE expires_at > now();"
        ))
    except Exception as exc:
        logger.debug("Sin tabla de sesiones: %s", exc)

    return {
        "catalog": {
            "layers_total": len(items),
            "vector": vector,
            "raster": raster,
            "features_total": sum(int(t or 0) for t in conteos),
            "by_layer": by_layer,
            "by_workspace": sorted(by_ws.values(), key=lambda w: w["features"], reverse=True),
        },
        "metadata_layers": metadata_layers,
        "active_sessions": active_sessions,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/bloques")
async def admin_bloques(user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.GERENTE))):
    """Listado real de bloques petroleros con área (km²) y centroide.

    La tabla no tiene columnas de negocio (año/organismo/estado): solo el
    nombre del bloque y su geometría. Se devuelven las columnas disponibles
    y dos métricas calculadas en PostGIS.
    """
    pool = get_pool()
    info = await pool.fetchrow(
        """
        SELECT f_table_schema, f_table_name, f_geometry_column
        FROM geometry_columns
        WHERE lower(f_table_name) = 'bloques'
        ORDER BY (f_table_schema = 'public') DESC
        LIMIT 1;
        """
    )
    if info is None:
        raise HTTPException(404, "No se encontró la tabla de bloques.")

    schema = info["f_table_schema"]
    table = info["f_table_name"]
    geom_col = info["f_geometry_column"]

    try:
        rows = await pool.fetch(
            f"""
            SELECT to_jsonb(b) - '{geom_col}' AS props,
                   ROUND((ST_Area(ST_Transform(b."{geom_col}", 4326)::geography) / 1000000.0)::numeric, 2) AS area_km2,
                   ROUND(ST_Y(ST_Centroid(ST_Transform(b."{geom_col}", 4326)))::numeric, 5) AS lat,
                   ROUND(ST_X(ST_Centroid(ST_Transform(b."{geom_col}", 4326)))::numeric, 5) AS lng
            FROM "{schema}"."{table}" AS b
            WHERE b."{geom_col}" IS NOT NULL;
            """
        )
    except Exception as exc:
        logger.warning("No se pudo leer la tabla de bloques: %s", exc)
        raise HTTPException(500, "No se pudo consultar la tabla de bloques.")

    bloques = []
    for row in rows:
        props = row["props"] or {}
        if isinstance(props, str):
            try:
                props = json.loads(props)
            except json.JSONDecodeError:
                props = {}
        nombre = props.get("bloque") or props.get("nombre") or props.get("name")
        bloques.append({
            "id": props.get("id"),
            "objectid": props.get("objectid"),
            "bloque": nombre or (f"ID {props.get('id')}" if props.get("id") is not None else "—"),
            "area_km2": float(row["area_km2"]) if row["area_km2"] is not None else None,
            "lat": float(row["lat"]) if row["lat"] is not None else None,
            "lng": float(row["lng"]) if row["lng"] is not None else None,
        })

    bloques.sort(key=lambda b: str(b["bloque"]).casefold())
    return {"bloques": bloques, "total": len(bloques)}
