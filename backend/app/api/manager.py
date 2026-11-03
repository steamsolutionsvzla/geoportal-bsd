"""Endpoints exclusivos del dashboard gerencial.

La capa vive en GeoServer (workspace ``Gerencia``) y solo se expone por
este router, protegido por rol. No forma parte del catálogo general ni de
los workspaces de Odoo del usuario.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import role_guard
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService

router = APIRouter(prefix="/api/v1/manager", tags=["Manager"])

LICENSES_LAYER = "Gerencia:licencias"


def _find_key(properties: dict[str, Any], *names: str) -> str | None:
    by_lower = {str(k).strip().lower(): k for k in properties}
    for name in names:
        key = by_lower.get(name.strip().lower())
        if key is not None:
            return key
    return None


def _value(properties: dict[str, Any], *names: str) -> Any:
    key = _find_key(properties, *names)
    return properties.get(key) if key is not None else None


def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _year_from_code(codigo: str) -> int | None:
    match = re.search(r"-(\d{4})-", codigo or "")
    return int(match.group(1)) if match else None


def _years_from_duration(duracion: str) -> int | None:
    match = re.search(r"(\d+)", duracion or "")
    return int(match.group(1)) if match else None


def _normalize_feature(feature: dict[str, Any]) -> dict[str, Any]:
    props = feature.get("properties") or {}

    codigo = str(_value(props, "codigo", "cod_l1", "codigo_l1") or "").strip()
    bloque = _to_int(_value(props, "n_poligono", "n_poligo", "bloque"))
    empresa = str(_value(props, "empresa") or "").strip()
    tipo = str(_value(props, "tipo") or "").strip()
    estatus = str(_value(props, "estatus") or "").strip()
    duracion = str(_value(props, "duracion") or "").strip()
    anio = _to_int(_value(props, "anio", "año")) or _year_from_code(codigo)
    duracion_anios = _to_int(_value(props, "duracion_anios")) or _years_from_duration(duracion)
    area_ha = _to_float(_value(props, "area_ha"))
    area_km2 = _to_float(_value(props, "area_km2"))
    if area_km2 is None and area_ha is not None:
        area_km2 = area_ha / 100

    return {
        **feature,
        "properties": {
            "codigo": codigo,
            "bloque": bloque,
            "empresa": empresa,
            "tipo": tipo,
            "estatus": estatus,
            "anio": anio,
            "duracion": duracion,
            "duracion_anios": duracion_anios,
            "area_ha": area_ha,
            "area_km2": round(area_km2, 3) if area_km2 is not None else None,
        },
    }


def _counter(values) -> dict[str, int]:
    return dict(sorted(Counter(str(v) for v in values if v not in (None, "")).items()))


@router.get("/licenses")
async def get_manager_licenses(
    user: CurrentUser = Depends(role_guard(Rol.GERENTE)),
):
    """Devuelve las licencias normalizadas y los totales del dashboard.

    El backend consulta GeoServer por WFS usando sus credenciales de
    servicio. El navegador nunca recibe credenciales de GeoServer.
    """

    try:
        data = await GeoServerService.get_layer_geojson(LICENSES_LAYER)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"No se pudo leer la capa gerencial: {exc}") from exc

    features = [_normalize_feature(f) for f in (data.get("features") or [])]
    features.sort(
        key=lambda f: (
            f["properties"].get("bloque") is None,
            f["properties"].get("bloque") or 0,
            f["properties"].get("codigo") or "",
        )
    )

    props = [f["properties"] for f in features]
    area_total = round(
        sum(p["area_km2"] or 0 for p in props),
        2,
    )

    return {
        "type": "FeatureCollection",
        "features": features,
        "summary": {
            "total": len(features),
            "by_tipo": _counter(p["tipo"] for p in props),
            "by_estatus": _counter(p["estatus"] for p in props),
            "by_empresa": _counter(p["empresa"] for p in props),
            "by_anio": _counter(p["anio"] for p in props),
            "area_total_km2": area_total,
        },
    }
