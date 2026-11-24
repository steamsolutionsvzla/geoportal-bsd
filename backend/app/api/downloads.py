# app/api/downloads.py
"""Descarga de archivos indexados (LAS/LIS/DLIS/SEG-Y) y Shapefiles.

El ZIP es mixto: para el workspace ``archivos_indexados`` incluye los archivos
originales (los pide a Odoo con el JWT del usuario) y para el resto de capas de
puntos con hits incluye su Shapefile completo (GeoServer).

La descarga final se entrega por URL firmada (ticket de corta duración) para
que el navegador la haga de forma nativa, con ``Range`` y sin cargar GB en
memoria.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.api.deps import auth_guard, bearer_token
from app.api.search import _validar_geometria
from app.config import settings
from app.db.database import get_pool
from app.models.user import CurrentUser
from app.services import download_service as svc
from app.services.session_service import resolve_user

logger = logging.getLogger("app.api.downloads")

router = APIRouter(prefix="/api/v1/downloads", tags=["Downloads"])

_bearer = HTTPBearer(auto_error=False)
_CHUNK = 1024 * 1024
_PASS_HEADERS = {
    "content-type", "content-disposition", "content-length",
    "accept-ranges", "content-range", "etag", "last-modified",
}


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
class LayerRef(BaseModel):
    id: str = Field(..., max_length=200)
    name: str = Field(default="", max_length=200)


class ZoneRequest(BaseModel):
    geometry: dict = Field(..., description="Polígono/multipolígono EPSG:4326")
    mask_geometry: Optional[dict] = Field(
        default=None, description="Segundo polígono (intersección estado/área)")
    layers: list[LayerRef] = Field(default_factory=list)
    label: str = Field(default="Área", max_length=120)


class TicketRequest(BaseModel):
    kind: Literal["job", "document"]
    id: str = Field(..., max_length=120)


# ---------------------------------------------------------------------------
# Autorización (Bearer para la API, ticket para la descarga nativa)
# ---------------------------------------------------------------------------
async def _access(
    cred: Optional[HTTPAuthorizationCredentials],
    ticket: Optional[str],
    kind: str,
    resource: str,
) -> dict:
    if ticket:
        info = svc.resolve_ticket(ticket, kind, resource)
        if not info:
            raise HTTPException(403, "Enlace de descarga inválido o expirado.")
        return {
            "mode": "ticket",
            "uid": info["uid"],
            "token": info["token"],
            "user": None,
        }
    if cred is None or not cred.credentials:
        raise HTTPException(401, "No autenticado.")
    profile = await resolve_user(cred.credentials)
    if profile is None:
        raise HTTPException(401, "Sesión inválida o expirada.")
    return {
        "mode": "bearer",
        "uid": str(profile.get("usuario_id") or ""),
        "token": cred.credentials,
        "user": CurrentUser(**profile),
    }


def _filename(label: str) -> str:
    base = svc._safe_name(label or "Archivos", fallback="Archivos", max_len=60)
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    return f"{base}_{stamp}.zip"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/ticket")
async def create_ticket(
    body: TicketRequest,
    user: CurrentUser = Depends(auth_guard),
    token: str = Depends(bearer_token),
):
    """URL firmada para que el navegador descargue sin cabecera Authorization."""
    if body.kind == "job":
        job = svc.get_job(body.id)
        if not job or job.user_id != user.usuario_id:
            raise HTTPException(404, "Descarga no encontrada.")
        if job.state != "ready":
            raise HTTPException(409, "La descarga todavía no está lista.")
        return {"url": svc.ticket_url_for_job(job)}

    exists = await svc.document_exists_in_indexed(get_pool(), body.id)
    if not exists:
        raise HTTPException(404, "El documento no pertenece a archivos indexados.")
    return {"url": svc.ticket_url_for_document(body.id, user.usuario_id, token)}


@router.post("/zone")
async def download_zone(
    body: ZoneRequest,
    user: CurrentUser = Depends(auth_guard),
    token: str = Depends(bearer_token),
):
    """Crea (y si es pequeño ejecuta) el ZIP del filtro poligonal."""
    svc.sweep_expired()
    _validar_geometria(body.geometry)
    if body.mask_geometry:
        _validar_geometria(body.mask_geometry)
    if not body.layers:
        raise HTTPException(400, "Selecciona al menos una capa.")
    max_layers = int(settings.DOWNLOAD_MAX_LAYERS or 50)
    if len(body.layers) > max_layers * 4:
        raise HTTPException(413, "Demasiadas capas en la solicitud.")

    plan = await svc.build_plan(
        [{"id": layer.id, "name": layer.name} for layer in body.layers],
        body.geometry,
        body.mask_geometry,
    )
    total_files = len(plan["indexed"])
    total_layers = len(plan["shapefiles"])
    if total_files + total_layers == 0:
        raise HTTPException(
            404, "No hay archivos ni capas que descargar en esta área.")
    if total_files and not settings.ODOO_URL:
        raise HTTPException(
            500, "ODOO_URL no está configurado en el backend.")

    max_files = int(settings.DOWNLOAD_MAX_FILES or 500)
    if total_files > max_files or total_layers > max_layers:
        raise HTTPException(
            413,
            f"El lote es demasiado grande ({total_files} archivos y "
            f"{total_layers} capas). Reduce el área o descarga por capa.")

    estimated = 0
    for doc in plan["indexed"]:
        props = doc.get("props") or {}
        try:
            estimated += int(float(props.get("tamano_bytes") or 0))
        except (TypeError, ValueError):
            pass
    max_bytes = float(settings.DOWNLOAD_MAX_GB or 20) * 1024 ** 3
    if estimated and estimated > max_bytes:
        raise HTTPException(
            413,
            "El lote supera el tamaño máximo permitido "
            f"({settings.DOWNLOAD_MAX_GB} GB). Reduce el área.")

    job = await svc.create_job(
        user_id=user.usuario_id,
        token=token,
        label=body.label or "Área",
        plan=plan,
    )

    sync_max_files = int(settings.DOWNLOAD_SYNC_MAX_FILES or 20)
    sync_max_layers = int(settings.DOWNLOAD_SYNC_MAX_LAYERS or 3)
    sync_max_bytes = int(settings.DOWNLOAD_SYNC_MAX_MB or 500) * 1024 ** 2
    sync = (
        total_files <= sync_max_files
        and total_layers <= sync_max_layers
        and estimated <= sync_max_bytes
        # Si hay archivos y no se conoce su tamaño, no se bloquea la petición:
        # un SEG-Y puede ser de varios GB.
        and (estimated > 0 or total_files == 0)
    )

    if sync:
        await svc.run_job(job, plan)
        if job.state != "ready":
            raise HTTPException(
                500, job.error or "No se pudo generar el ZIP.")
        return {
            "state": "ready",
            "job_id": job.id,
            "label": job.label,
            "file_count": total_files,
            "layer_count": total_layers,
            "skipped": plan["skipped"],
            "url": svc.ticket_url_for_job(job),
        }

    svc.start_job(job, plan)
    return {
        "state": "running",
        "job_id": job.id,
        "label": job.label,
        "file_count": total_files,
        "layer_count": total_layers,
        "skipped": plan["skipped"],
        "status_url": f"/api/v1/downloads/jobs/{job.id}",
    }


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, user: CurrentUser = Depends(auth_guard)):
    job = svc.get_job(job_id)
    if not job or job.user_id != user.usuario_id:
        raise HTTPException(404, "Descarga no encontrada.")
    data = job.to_dict()
    if job.state == "ready":
        data["url"] = svc.ticket_url_for_job(job)
        data["size_bytes"] = job.path.stat().st_size if job.path else 0
    return data


@router.get("/jobs/{job_id}/file")
async def job_file(
    job_id: str,
    request: Request,
    ticket: Optional[str] = Query(default=None),
    cred: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
):
    access = await _access(cred, ticket, "job", job_id)
    job = svc.get_job(job_id)
    if not job or job.user_id != access["uid"]:
        raise HTTPException(404, "Descarga no encontrada.")
    if job.state != "ready" or not job.path or not job.path.exists():
        raise HTTPException(409, "La descarga todavía no está lista.")
    return FileResponse(
        path=job.path,
        media_type="application/zip",
        filename=_filename(job.label),
    )


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, user: CurrentUser = Depends(auth_guard)):
    job = svc.get_job(job_id)
    if not job or job.user_id != user.usuario_id:
        raise HTTPException(404, "Descarga no encontrada.")
    job.cancel.set()
    if job.state in ("queued", "running"):
        job.state = "cancelled"
    if job.path and job.path.exists():
        try:
            job.path.unlink()
        except OSError:
            pass
    return {"ok": True, "state": job.state}


@router.get("/document/{doc_id}")
async def download_document(
    doc_id: str,
    request: Request,
    ticket: Optional[str] = Query(default=None),
    cred: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
):
    """Proxy de un archivo original (LAS/LIS/DLIS/SEG-Y) con soporte Range."""
    access = await _access(cred, ticket, "doc", doc_id)
    if not settings.ODOO_URL:
        raise HTTPException(500, "ODOO_URL no está configurado.")

    pool = get_pool()
    if not await svc.document_exists_in_indexed(pool, doc_id):
        raise HTTPException(404, "El documento no pertenece a archivos indexados.")

    url = svc._odoo_doc_url(doc_id)
    headers = svc._auth_headers(access["token"])
    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header

    timeout = httpx.Timeout(connect=15.0, read=None, write=None, pool=None)
    client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
    try:
        upstream = await client.send(
            client.build_request("GET", url, headers=headers), stream=True)
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(502, f"No se pudo contactar con Odoo: {exc}") from exc

    if upstream.status_code not in (200, 206):
        body = b""
        try:
            body = await upstream.aread()
        except Exception:  # noqa: BLE001
            pass
        await upstream.aclose()
        await client.aclose()
        detail = body.decode("utf-8", "ignore")[:300]
        if upstream.status_code in (401, 403):
            raise HTTPException(403, "Sin permiso para descargar el archivo.")
        if upstream.status_code == 404:
            raise HTTPException(404, "El archivo original no está disponible.")
        raise HTTPException(
            502, f"Odoo respondió {upstream.status_code}. {detail}".strip())

    passthrough = {
        k: v for k, v in upstream.headers.items() if k.lower() in _PASS_HEADERS
    }

    async def stream():
        try:
            async for chunk in upstream.aiter_raw(_CHUNK):
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        stream(),
        status_code=upstream.status_code,
        headers=passthrough,
        media_type=passthrough.get("content-type", "application/octet-stream"),
    )
