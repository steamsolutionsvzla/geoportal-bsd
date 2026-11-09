# app/api/admin.py
# Estadísticas reales para el dashboard de administración.
import asyncio
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
