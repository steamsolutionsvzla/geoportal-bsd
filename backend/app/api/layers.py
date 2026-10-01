# app/api/layers.py
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import auth_guard, workspace_guard, allowed_workspaces, filter_layers_by_workspace
from app.models.user import CurrentUser
from app.db.database import get_pool
from app.services.geoserver_service import GeoServerService
from app.services.layer_service import get_layer_metadata

router = APIRouter(
    prefix="/api/v1/layers",
    tags=["Layers"]
)

# 1. Rutas fijas (sin parámetros)
@router.get("/list")
async def list_layers(user: CurrentUser = Depends(auth_guard)):
    layers = await GeoServerService.get_available_layers()
    return {"layers": filter_layers_by_workspace(user, layers)}

@router.get("/workspaces")
async def get_workspaces(user: CurrentUser = Depends(auth_guard)):
        return await GeoServerService.get_workspaces_with_layers(only=allowed_workspaces(user))


# 2. Rutas con parámetros (después de las fijas)
@router.get("/{table_name}/metadata", dependencies=[Depends(workspace_guard)])
async def get_layer_metadata_endpoint(table_name: str):
    try:
        pool = get_pool()
        metadata = await get_layer_metadata(pool, table_name)
        if metadata is None:
            return {"has_metadata": False, "metadata": None}
        return {"has_metadata": True, "metadata": metadata}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{table_name}", dependencies=[Depends(workspace_guard)])
async def get_layer(table_name: str, geom_col: str = "geom"):
    try:
        return await GeoServerService.get_layer_geojson(table_name)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.get("/{table_name:path}/attributes", dependencies=[Depends(workspace_guard)])
async def get_layer_attributes(table_name: str):
    """
    Devuelve los nombres de los atributos de una capa.
    Primero intenta con metadatos (esquema 'metadatos'), si no hay,
    cae al primer feature del GeoJSON.
    """
    pool = get_pool()

    # 1. Metadatos
    try:
        metadata = await get_layer_metadata(pool, table_name)
        if metadata and metadata.get("campos"):
            return {"attributes": [c["nombre"] for c in metadata["campos"]]}
    except Exception:
        pass

    # 2. Fallback: primer feature del GeoJSON
    try:
        data = await GeoServerService.get_layer_geojson(table_name)
        feats = (data or {}).get("features") or []
        if feats:
            props = feats[0].get("properties") or {}
            return {"attributes": list(props.keys())}
    except Exception:
        pass

    return {"attributes": []}