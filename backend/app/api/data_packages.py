# app/api/data_packages.py
"""Paquetes de datos: guarda en Odoo los archivos indexados de un área.

El paquete no genera ZIP; solo crea una selección persistente con nombre,
entidad de la poligonal y fecha de creación. Odoo guarda una línea por archivo
con nombre, formato y ruta, y el Explorador de archivos puede filtrar por ese
paquete.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import auth_guard, bearer_token, role_guard
from app.api.search import _validar_geometria
from app.config import settings
from app.models.user import CurrentUser, Rol
from app.services import download_service as svc

logger = logging.getLogger("app.api.data_packages")

router = APIRouter(prefix="/api/v1/data-packages", tags=["Data packages"])


class LayerRef(BaseModel):
    id: str = Field(..., max_length=200)
    name: str = Field(default="", max_length=200)


class DataPackageRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    geometry: dict = Field(..., description="Polígono/multipolígono EPSG:4326")
    mask_geometry: Optional[dict] = Field(
        default=None, description="Segundo polígono de intersección")
    layers: list[LayerRef] = Field(default_factory=list)
    label: str = Field(default="Área", max_length=200)
    polygon_entity: str = Field(default="", max_length=200)
    state_entity: str = Field(default="", max_length=200)


def _odoo_url() -> str:
    base = (settings.ODOO_URL or "").rstrip("/")
    if not base:
        raise HTTPException(500, "ODOO_URL no está configurado en el backend.")
    return f"{base}/api/geoportal/v1/data-packages"


def _detail(response: httpx.Response) -> str:
    try:
        data = response.json()
        if isinstance(data, dict):
            return str(data.get("error") or data.get("detail") or data)
    except ValueError:
        pass
    return (response.text or "").strip()[:500] or f"Error {response.status_code}"


@router.get("")
async def list_data_packages(
    user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.GERENTE)),
    token: str = Depends(bearer_token),
):
    """Lista los paquetes de datos reales para la vista de gerencia."""
    timeout = httpx.Timeout(connect=15.0, read=60.0, write=30.0, pool=30.0)
    try:
        async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=True) as client:
            response = await client.get(
                _odoo_url(),
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        logger.exception("No se pudo listar los paquetes desde Odoo")
        raise HTTPException(
            502, f"No se pudo contactar a Odoo: {exc}") from exc
    if response.status_code != 200:
        raise HTTPException(
            response.status_code if response.status_code < 500 else 502,
            _detail(response),
        )
    return response.json()


@router.post("")
async def create_data_package(
    body: DataPackageRequest,
    user: CurrentUser = Depends(auth_guard),
    token: str = Depends(bearer_token),
):
    """Calcula los archivos indexados del área y crea el paquete en Odoo."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "El nombre del paquete es obligatorio.")

    _validar_geometria(body.geometry)
    if body.mask_geometry:
        _validar_geometria(body.mask_geometry)
    if not body.layers:
        raise HTTPException(400, "Selecciona al menos una capa.")

    plan = await svc.build_plan(
        [{"id": layer.id, "name": layer.name} for layer in body.layers],
        body.geometry,
        body.mask_geometry,
    )
    indexed = plan.get("indexed") or []
    document_ids = []
    for doc in indexed:
        try:
            document_ids.append(int(doc.get("documento_id")))
        except (TypeError, ValueError):
            continue
    document_ids = list(dict.fromkeys(document_ids))

    if not document_ids:
        raise HTTPException(
            404, "El área no tiene archivos indexados para guardar.")

    max_docs = int(settings.DATA_PACKAGE_MAX_DOCS or 100000)
    if len(document_ids) > max_docs:
        raise HTTPException(
            413,
            f"El área tiene {len(document_ids)} archivos y el máximo por "
            f"paquete es {max_docs}. Reduce el área.",
        )

    payload = {
        "name": name,
        "source": "geoportal",
        "document_ids": document_ids,
        "polygon_entity": body.polygon_entity or body.label,
        "state_entity": body.state_entity or "",
        "filter_label": body.label or "Área",
        "geometry": body.geometry,
        "mask_geometry": body.mask_geometry,
    }
    timeout = httpx.Timeout(
        connect=15.0,
        read=float(settings.DATA_PACKAGE_TIMEOUT_SECONDS or 900),
        write=60.0,
        pool=30.0,
    )
    try:
        async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=True) as client:
            response = await client.post(
                _odoo_url(), json=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        logger.exception("No se pudo contactar a Odoo")
        raise HTTPException(
            502, f"No se pudo contactar a Odoo: {exc}") from exc

    if response.status_code not in (200, 201):
        raise HTTPException(
            response.status_code if response.status_code < 500 else 502,
            _detail(response),
        )

    data = response.json()
    data["file_count"] = len(document_ids)
    data["user"] = user.usuario_id
    return data
