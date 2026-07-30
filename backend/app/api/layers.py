from fastapi import APIRouter, HTTPException
from app.services.layer_service import get_db_layers
from app.db.database import get_pool
from app.services.spatial_service import SpatialService

router = APIRouter(
    prefix="/api/v1/layers",
    tags=["Layers"]
)

@router.get("/list")
async def list_layers():
    try:
        pool = get_pool()
        layers = await get_db_layers(pool)
        return {"layers": layers}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{table_name}")   
async def get_layer(table_name: str, geom_col: str = "geom"):
    """
    Obtiene los registros de una tabla espacial en PostGIS en formato GeoJSON.
    """
    return await SpatialService.get_layer_geojson(table_name, geom_col)