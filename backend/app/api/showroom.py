from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import _norm, showroom_guard
from app.db.database import get_pool
from app.services.geoserver_service import GeoServerService
from app.services.layer_service import get_layer_metadata

router = APIRouter(prefix="/api/v1/showroom", tags=["Showroom"])

@router.get("/workspaces")
async def showroom_workspaces(ws: str = Depends(showroom_guard)):
    return await GeoServerService.get_workspaces_with_layers(only={_norm(ws)})

@router.get("/layers/{table_name}/metadata")
async def showroom_layer_metadata(table_name: str, ws: str = Depends(showroom_guard)):
    layer = table_name.split(":", 1)[-1]
    found = await GeoServerService._find_workspace_for_layer(layer)
    if found is None or _norm(found) != _norm(ws):
        raise HTTPException(404, "Capa no disponible en Showroom.")
    metadata = await get_layer_metadata(get_pool(), layer)
    return {"has_metadata": metadata is not None, "metadata": metadata}

@router.get("/layers/{table_name}")
async def showroom_layer(table_name: str, ws: str = Depends(showroom_guard)):
    layer = table_name.split(":", 1)[-1]   # ignora el workspace que mande el cliente
    return await GeoServerService.get_layer_geojson(layer, workspace=ws)