from fastapi import APIRouter
from app.services.spatial_service import SpatialService

router = APIRouter(prefix="/api/v1/layers", tags=["Capas Geográficas"])

@router.get("/{table_name}")
async def get_layer(table_name: str, geom_col: str = "geom"):
    """
    Obtiene los registros de una tabla espacial en PostGIS en formato GeoJSON.
    """
    return await SpatialService.get_layer_geojson(table_name, geom_col)