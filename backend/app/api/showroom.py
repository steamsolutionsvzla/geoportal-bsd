from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import auth_guard
from app.db.database import get_pool
from app.models.user import CurrentUser
from app.services.geoserver_service import GeoServerService
from app.services.layer_service import get_layer_metadata

router = APIRouter(prefix="/api/v1/showroom", tags=["Showroom"])


def _split_layer(table_name: str) -> Tuple[Optional[str], str]:
    """Separa 'workspace:capa' en (workspace, capa)."""
    if ":" in table_name:
        ws, capa = table_name.split(":", 1)
        return (ws or None), capa
    return None, table_name


async def _resolve_workspace(table_name: str) -> Tuple[Optional[str], str]:
    ws, capa = _split_layer(table_name)
    if ws:
        return ws, capa
    return await GeoServerService._find_workspace_for_layer(capa), capa


@router.get("/workspaces")
async def showroom_workspaces(user: CurrentUser = Depends(auth_guard)):
    """Catálogo completo visible de GeoServer para Showroom."""
    return await GeoServerService.get_workspaces_with_layers()


@router.get("/layers/{table_name}/metadata")
async def showroom_layer_metadata(table_name: str, user: CurrentUser = Depends(auth_guard)):
    ws, capa = await _resolve_workspace(table_name)
    if ws is None:
        raise HTTPException(404, "Capa no disponible en Showroom.")
    metadata = await get_layer_metadata(get_pool(), capa)
    return {"has_metadata": metadata is not None, "metadata": metadata}


@router.get("/layers/{table_name}")
async def showroom_layer(table_name: str, user: CurrentUser = Depends(auth_guard)):
    ws, capa = await _resolve_workspace(table_name)
    if ws is None:
        raise HTTPException(404, "Capa no disponible en Showroom.")
    return await GeoServerService.get_layer_geojson(capa, workspace=ws)
