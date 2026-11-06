# app/api/layers.py
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.api.deps import auth_guard, workspace_guard, allowed_workspaces, filter_layers_by_workspace
from app.models.user import CurrentUser
from app.db.database import get_pool
from app.services.geoserver_service import GeoServerService
from app.services.layer_service import get_layer_metadata
from app.services.metadata_export import build_iso19139, build_qmd
import io

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

@router.get("/{table_name}/download", dependencies=[Depends(workspace_guard)])
async def download_layer_shapefile(table_name: str):
    """Descarga la capa como Shapefile comprimido (.zip) vía WFS de GeoServer.

    Si la capa tiene ficha en el esquema `metadatos` de la BD, se incluyen
    además los sidecars QGIS/ISO 19139 (<capa>.qmd y <capa>.xml) en el zip.
    Un fallo leyendo metadatos no bloquea la descarga: se sirve sin sidecars.
    """
    extras = {}
    try:
        pool = get_pool()
        meta = await get_layer_metadata(pool, table_name)
        if meta:
            extras[".qmd"] = build_qmd(meta)
            extras[".xml"] = build_iso19139(meta)
    except Exception as e:
        print(f"[download] sin sidecars de metadatos para '{table_name}': {e}")

    try:
        data = await GeoServerService.get_layer_shapefile_zip(table_name, extras=extras or None)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    short_name = table_name.split(':')[-1] if ':' in table_name else table_name
    filename = f"{short_name}.zip"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
    
@router.get("/{table_name:path}/attributes", dependencies=[Depends(workspace_guard)])
async def get_layer_attributes(table_name: str):
    """
    Devuelve los nombres de los atributos de una capa.
    Prioriza las propiedades REALES que expone el WFS (GeoServer/PostGIS),
    porque son las que el popup y las etiquetas encuentran en los features.
    Los metadatos se usan solo como fallback.
    """
    # 1. Propiedades reales del WFS (verdad para popup/etiquetas)
    try:
        data = await GeoServerService.get_layer_geojson(table_name)
        feats = (data or {}).get("features") or []
        if feats:
            props = feats[0].get("properties") or {}
            if props:
                return {"attributes": list(props.keys())}
    except Exception:
        pass

    # 2. Fallback: metadatos (esquema 'metadatos')
    try:
        pool = get_pool()
        metadata = await get_layer_metadata(pool, table_name)
        if metadata and metadata.get("campos"):
            return {"attributes": [c["nombre"] for c in metadata["campos"]]}
    except Exception:
        pass

    return {"attributes": []}