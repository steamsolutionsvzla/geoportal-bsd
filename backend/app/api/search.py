# app/api/search.py
# Búsqueda espacial: qué capas tienen datos dentro de una zona.
import asyncio
import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import allowed_workspaces, auth_guard, filter_layers_by_workspace
from app.db.database import get_pool
from app.models.user import CurrentUser
from app.services.geoserver_service import GeoServerService
from app.services.layer_service import count_features_in_geometry

logger = logging.getLogger("app.api.search")

router = APIRouter(prefix="/api/v1/search", tags=["Search"])

# Tope defensivo del polígono de búsqueda (evita consultas absurdas).
_MAX_VERTICES = 20000


class ZoneSearchRequest(BaseModel):
    geometry: Dict = Field(..., description="Polígono/multipolígono GeoJSON en EPSG:4326")
    include_zero: bool = False


def _validar_geometria(geometry: dict) -> None:
    if not isinstance(geometry, dict):
        raise HTTPException(422, "`geometry` debe ser un objeto GeoJSON.")
    if geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise HTTPException(422, "Solo se aceptan geometrías Polygon o MultiPolygon.")
    coords = geometry.get("coordinates")
    if not coords:
        raise HTTPException(422, "La geometría no tiene coordenadas.")

    # Conteo aproximado de vértices (sin recorrer recursivamente todo si es enorme).
    total = 0
    stack = [coords]
    while stack:
        item = stack.pop()
        if isinstance(item, (list, tuple)) and item and isinstance(item[0], (int, float)):
            total += 1
        elif isinstance(item, (list, tuple)):
            stack.extend(item)
            if total > _MAX_VERTICES:
                break
    if total > _MAX_VERTICES:
        raise HTTPException(413, "La zona es demasiado compleja; reduce el número de vértices.")


@router.post("/zone")
async def search_zone(payload: ZoneSearchRequest, user: CurrentUser = Depends(auth_guard)):
    """
    Devuelve las capas vectoriales que tienen registros dentro de la zona.

    Respuesta: {"layers": [{id, name, type, count}], "scanned": N}
    Ordenado por número de registros descendente; las capas raster se omiten.
    """
    _validar_geometria(payload.geometry)

    try:
        groups = await GeoServerService.get_workspaces_with_layers(only=allowed_workspaces(user))
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("No se pudo listar workspaces para la búsqueda: %s", e)
        raise HTTPException(502, "No se pudo consultar el catálogo de capas.")

    # Aplicar el mismo filtro de workspaces que usa el catálogo.
    layers: List[Dict] = []
    for group in groups:
        layers.extend(filter_layers_by_workspace(user, group.get("layers") or []))

    candidatas = [l for l in layers if l.get("type") != "raster" and l.get("id")]
    if not candidatas:
        return {"layers": [], "scanned": 0}

    try:
        nativas = await GeoServerService.get_native_table_names()
    except Exception as e:
        logger.warning("Sin mapa de tablas nativas (se intentará por nombre): %s", e)
        nativas = {}

    pool = get_pool()
    semaforo = asyncio.Semaphore(5)

    async def contar(layer: Dict) -> Optional[Dict]:
        layer_id = layer["id"]
        tabla = nativas.get(layer_id) or layer_id.split(":", 1)[-1]
        async with semaforo:
            try:
                total = await count_features_in_geometry(pool, tabla, payload.geometry)
            except Exception as e:
                logger.debug("Fallo contando '%s' (%s): %s", layer_id, tabla, e)
                return None
        if total is None:
            return None
        return {"id": layer_id, "name": layer.get("name") or tabla,
                "type": layer.get("type") or "fill", "count": total}

    resultados = await asyncio.gather(*(contar(l) for l in candidatas))
    hits = [r for r in resultados if r and (payload.include_zero or r["count"] > 0)]
    hits.sort(key=lambda r: r["count"], reverse=True)

    return {"layers": hits, "scanned": len(candidatas)}
