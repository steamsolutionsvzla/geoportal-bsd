# app/api/diccionario.py
"""Catálogo de datos: diccionario de campos de los esquemas PostGIS `gis_*`.

Accesible para administrador, gerente y analista (misma vista, mismo export).
"""
from __future__ import annotations

import io
import logging

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api.deps import role_guard
from app.config import settings
from app.db.database import get_pool
from app.models.user import CurrentUser, Rol
from app.services.diccionario_export import build_workbook, filename
from app.services.diccionario_service import get_catalog

logger = logging.getLogger("app.api.diccionario")

router = APIRouter(prefix="/api/v1/diccionario", tags=["Catálogo"])

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

catalogo_area = role_guard(Rol.ADMIN, Rol.GERENTE, Rol.ANALISTA)


@router.get("")
async def diccionario(
    refresh: bool = Query(
        False, description="Ignora la caché y vuelve a leer la base de datos."
    ),
    user: CurrentUser = Depends(catalogo_area),
):
    """Inventario de esquemas `gis_*` con sus capas, campos y metadatos."""
    pool = get_pool()
    return await get_catalog(
        pool,
        refresh=refresh,
        ttl=float(getattr(settings, "DICCIONARIO_CACHE_TTL", 60.0)),
    )


@router.get("/export")
async def exportar(
    refresh: bool = Query(False, description="Recalcula antes de exportar."),
    user: CurrentUser = Depends(catalogo_area),
):
    """Excel del diccionario (Resumen · Capas · Calidad · Campos)."""
    pool = get_pool()
    data = await get_catalog(pool, refresh=refresh, ttl=0.0)
    content = build_workbook(data)
    name = filename()
    logger.info(
        "Exportando diccionario: %s capas, %s campos (%s)",
        data["totals"]["layers"],
        data["totals"]["fields"],
        name,
    )
    return StreamingResponse(
        io.BytesIO(content),
        media_type=XLSX_MEDIA,
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        },
    )
