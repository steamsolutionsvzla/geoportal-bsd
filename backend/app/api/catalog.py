# app/api/catalog.py
# Catálogo completo de GeoServer ↔ PostGIS para el panel gerencial.
import asyncio
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import role_guard
from app.db.database import get_pool
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService
from app.services.layer_service import count_features_in_geometry

logger = logging.getLogger("app.api.catalog")

router = APIRouter(prefix="/api/v1/admin/catalog", tags=["Admin"])

STATES_TABLE = "dpt_estadal_venezuela"


def _norm(text: Any) -> str:
    return str(text or "").strip().casefold()


def _base_table_key(name: Any) -> str:
    """Clave de tabla sin sufijo de geometría (_pl/_p/_l) ni acentos."""
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = text.encode("ascii", "ignore").decode("ascii").strip().casefold()
    text = re.sub(r"[\s\-]+", "_", text)
    previous = None
    while previous != text:
        previous = text
        text = re.sub(r"_(?:pl|p|l)$", "", text).rstrip()
    return text


async def _geom_tables(pool) -> List[Dict[str, Any]]:
    return await pool.fetch(
        """
        SELECT f_table_schema, f_table_name, f_geometry_column, srid
        FROM geometry_columns;
        """
    )


def _find_table(rows: List[Dict[str, Any]], native: Optional[str]):
    if not native:
        return None
    key = _norm(native)
    matches = [r for r in rows if _norm(r["f_table_name"]) == key]
    if not matches:
        base = _base_table_key(native)
        matches = [
            r for r in rows
            if _base_table_key(r["f_table_name"]) == base
        ]
    if not matches:
        return None
    matches.sort(key=lambda r: 0 if r["f_table_schema"] == "public" else 1)
    return matches[0]


async def _catalog(pool) -> List[Dict[str, Any]]:
    """Lista plana de capas con equivalencia PostGIS, estado y registros."""
    try:
        groups = await GeoServerService.get_workspaces_with_layers(include_hidden=True)
    except Exception as exc:
        raise HTTPException(502, f"No se pudo consultar GeoServer: {exc}") from exc

    try:
        details = await GeoServerService.get_featuretype_details()
    except Exception as exc:
        logger.warning("Sin detalle de featuretypes: %s", exc)
        details = {}

    geo_rows = await _geom_tables(pool)
    semaforo = asyncio.Semaphore(6)

    async def enriquecer(ws: str, layer: Dict[str, Any]) -> Dict[str, Any]:
        layer_id = layer.get("id") or ""
        tipo = layer.get("type") or "fill"
        info = details.get(layer_id) or {}
        native = info.get("native") if tipo != "raster" else None
        tabla = _find_table(geo_rows, native) if native else None

        filas = None
        if tabla is not None:
            async with semaforo:
                try:
                    filas = int(await pool.fetchval(
                        f'SELECT COUNT(*) FROM "{tabla["f_table_schema"]}"."{tabla["f_table_name"]}";'
                    ))
                except Exception:
                    filas = None

        return {
            "id": layer_id,
            "name": layer.get("name") or layer_id.split(":", 1)[-1],
            "workspace": ws,
            "type": tipo,
            "native": native,
            "table": (
                f'{tabla["f_table_schema"]}.{tabla["f_table_name"]}' if tabla else None
            ),
            "table_present": tabla is not None,
            "rows": filas,
            "enabled": info.get("enabled") if tipo != "raster" else None,
        }

    tareas = [
        enriquecer(g.get("name") or "—", layer)
        for g in groups
        for layer in (g.get("layers") or [])
    ]
    return await asyncio.gather(*tareas)


async def _states(pool) -> List[str]:
    rows = await _geom_tables(pool)
    states = [
        r for r in rows
        if _base_table_key(r["f_table_name"]) == _base_table_key(STATES_TABLE)
    ]
    if not states:
        return []
    info = states[0]
    schema, table = info["f_table_schema"], info["f_table_name"]
    cols = await pool.fetch(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2;
        """,
        schema, table,
    )
    candidatos = {"estado", "entidad", "nombre", "name"}
    col = next((c["column_name"] for c in cols if _norm(c["column_name"]) in candidatos), None)
    if not col:
        return []
    values = await pool.fetch(
        f'SELECT DISTINCT "{col}" AS estado FROM "{schema}"."{table}" '
        f'WHERE "{col}" IS NOT NULL ORDER BY 1;'
    )
    return [v["estado"] for v in values if v["estado"]]


class ZoneRequest(BaseModel):
    estado: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_km: float = 15.0


class EnabledRequest(BaseModel):
    enabled: bool


@router.get("")
async def catalog(user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.GERENTE))):
    pool = get_pool()
    capas = await _catalog(pool)

    workspaces: Dict[str, Dict[str, Any]] = {}
    for capa in capas:
        ws = workspaces.setdefault(capa["workspace"], {"name": capa["workspace"], "layers": []})
        ws["layers"].append(capa)
    for ws in workspaces.values():
        ws["layers"].sort(key=lambda layer: _norm(layer["name"]))

    states = await _states(pool)
    return {
        "workspaces": sorted(workspaces.values(), key=lambda w: _norm(w["name"])),
        "states": states,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.patch("/{layer_id:path}/enabled")
async def set_enabled(
    layer_id: str,
    payload: EnabledRequest,
    user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.GERENTE)),
):
    if not layer_id or ":" not in layer_id:
        raise HTTPException(422, "Id de capa inválido.")
    await GeoServerService.set_featuretype_enabled(layer_id, payload.enabled)
    return {"ok": True, "id": layer_id, "enabled": payload.enabled}


@router.post("/zone")
async def catalog_zone(
    payload: ZoneRequest,
    user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.GERENTE)),
):
    """Cuenta, para cada capa del catálogo, cuántos registros caen en la zona."""
    pool = get_pool()
    geometry: Optional[dict] = None

    if payload.estado:
        rows = await _geom_tables(pool)
        states = [
        r for r in rows
        if _base_table_key(r["f_table_name"]) == _base_table_key(STATES_TABLE)
    ]
        if not states:
            raise HTTPException(404, "No se encontró la capa de estados.")
        info = states[0]
        schema, table, geom_col = info["f_table_schema"], info["f_table_name"], info["f_geometry_column"]

        cols = await pool.fetch(
            """SELECT column_name FROM information_schema.columns
               WHERE table_schema = $1 AND table_name = $2;""",
            schema, table,
        )
        candidatos = {"estado", "entidad", "nombre", "name"}
        name_col = next((c["column_name"] for c in cols if _norm(c["column_name"]) in candidatos), None)
        if not name_col:
            raise HTTPException(500, "La capa de estados no expone una columna de nombre.")

        geojson = await pool.fetchval(
            f'SELECT ST_AsGeoJSON(ST_Union(ST_Transform("{geom_col}", 4326))) '
            f'FROM "{schema}"."{table}" WHERE lower("{name_col}") = lower($1);',
            payload.estado,
        )
        if not geojson:
            raise HTTPException(404, f"No se encontró el estado '{payload.estado}'.")
        geometry = json.loads(geojson)

    elif payload.lat is not None and payload.lng is not None:
        if not (-90 <= payload.lat <= 90 and -180 <= payload.lng <= 180):
            raise HTTPException(422, "Coordenadas fuera de rango.")
        radius_km = max(0.05, min(float(payload.radius_km or 15), 200))
        geojson = await pool.fetchval(
            "SELECT ST_AsGeoJSON(ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)::geometry);",
            payload.lng, payload.lat, radius_km * 1000,
        )
        geometry = json.loads(geojson)
    else:
        raise HTTPException(422, "Indica un estado o unas coordenadas.")

    capas = await _catalog(pool)
    semaforo = asyncio.Semaphore(5)

    async def contar(capa: Dict[str, Any]):
        if not capa["native"] or capa["type"] == "raster":
            return capa["id"], None
        async with semaforo:
            try:
                total = await count_features_in_geometry(pool, capa["native"], geometry)
            except Exception:
                total = None
        return capa["id"], total

    pares = await asyncio.gather(*(contar(c) for c in capas))
    counts = {layer_id: total for layer_id, total in pares if total is not None}
    return {"geometry": geometry, "counts": counts, "scanned": sum(1 for _, t in pares if t is not None)}
