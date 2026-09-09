# app/api/layers.py
from fastapi import APIRouter, HTTPException
from app.db.database import get_pool
from app.services.geoserver_service import GeoServerService
from app.services.layer_service import get_layer_metadata

router = APIRouter(
    prefix="/api/v1/layers",
    tags=["Layers"]
)

# 1. Rutas fijas (sin parámetros)
@router.get("/list")
async def list_layers():
    try:
        layers = await GeoServerService.get_available_layers()
        return {"layers": layers}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/workspaces")
async def get_workspaces():
    try:
        return await GeoServerService.get_workspaces_with_layers()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 2. Rutas con parámetros (después de las fijas)
@router.get("/{table_name}/metadata")
async def get_layer_metadata_endpoint(table_name: str):
    try:
        pool = get_pool()
        metadata = await get_layer_metadata(pool, table_name)
        if metadata is None:
            return {"has_metadata": False, "metadata": None}
        return {"has_metadata": True, "metadata": metadata}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{table_name}")
async def get_layer(table_name: str, geom_col: str = "geom"):
    try:
        return await GeoServerService.get_layer_geojson(table_name)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))