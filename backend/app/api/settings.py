# app/api/settings.py
# Configuración editable del panel (tabla app_settings).
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import role_guard
from app.db.database import get_pool
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService
from app.services.settings_service import get_setting, set_setting

router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])

LICENSES_LAYER_KEY = "licenses_layer"
DEFAULT_LICENSES_LAYER = "Gerencia:licencias"


class SettingsPatch(BaseModel):
    licenses_layer: str


@router.get("/settings")
async def read_settings(user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.GERENTE))):
    pool = get_pool()
    layer = await get_setting(pool, LICENSES_LAYER_KEY, DEFAULT_LICENSES_LAYER)
    return {"licenses_layer": layer}


@router.get("/settings/licenses-candidates")
async def licenses_candidates(user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.GERENTE))):
    """Capas candidatas para el dashboard gerencial (solo workspace Gerencia)."""
    try:
        groups = await GeoServerService.get_workspaces_with_layers(
            only={"gerencia"}, include_hidden=True
        )
    except Exception as exc:
        raise HTTPException(502, f"No se pudo consultar el catálogo: {exc}") from exc

    return {
        "workspaces": [
            {
                "name": g.get("name"),
                "layers": [
                    {"id": layer.get("id"), "name": layer.get("name"),
                     "type": layer.get("type")}
                    for layer in (g.get("layers") or [])
                    if layer.get("type") != "raster"
                ],
            }
            for g in groups
        ]
    }


@router.patch("/settings")
async def update_settings(
    payload: SettingsPatch,
    user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.GERENTE)),
):
    layer_id = (payload.licenses_layer or "").strip()
    if ":" not in layer_id:
        raise HTTPException(422, "La capa debe indicarse como 'workspace:capa'.")
    if layer_id.split(":", 1)[0].strip().casefold() != "gerencia":
        raise HTTPException(422, "Solo se permiten capas del workspace Gerencia.")

    details = await GeoServerService.get_featuretype_details()
    if layer_id not in details:
        # La caché de featuretypes puede conservar el nombre anterior tras
        # renombrar una capa en GeoServer. Reintenta con datos frescos antes
        # de rechazar una capa que el selector acaba de mostrar.
        details = await GeoServerService.get_featuretype_details(force_refresh=True)
    if layer_id not in details:
        raise HTTPException(404, f"La capa '{layer_id}' no existe en GeoServer.")

    pool = get_pool()
    await set_setting(pool, LICENSES_LAYER_KEY, layer_id)
    return {"ok": True, "licenses_layer": layer_id}
