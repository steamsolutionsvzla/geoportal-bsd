# app/services/download_service.py
"""Descarga de los archivos indexados + Shapefiles de las capas con hits.

Diseño (ver plan acordado con el usuario):

* El ZIP lo arma FastAPI, no Odoo, porque el lote es mixto:
  - workspace ``archivos_indexados`` -> archivos originales (LAS/LIS/DLIS/SEG-Y),
    que solo Odoo puede leer (local_path o adjunto);
  - cualquier otra capa de puntos con hits -> su Shapefile completo, que ya
    genera ``GeoServerService.get_layer_shapefile_zip``.
* Odoo solo expone ``/api/geoportal/v1/documents/<id>/content`` con el JWT del
  usuario; aquí se reenvía ese token para que se apliquen sus record rules.
* Los ZIPs se guardan en disco (``DOWNLOAD_DIR``) para que la descarga final
  sea un ``FileResponse`` con ``Range`` (reanudable) y no un blob en memoria.
* Los jobs viven en memoria del proceso: es suficiente para el despliegue
  actual (un único contenedor uvicorn) y coherente con el resto del backend.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import os
import re
import secrets
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

import httpx
from fastapi import HTTPException

from app.config import settings
from app.db.database import get_pool
from app.services.geoserver_service import GeoServerService
from app.services.layer_service import get_layer_metadata
from app.services.metadata_export import build_iso19139, build_qmd

logger = logging.getLogger("app.services.download")

INDEXED_WORKSPACE = "archivos_indexados"
_CHUNK = 1024 * 1024
_DOC_COLUMNS = (
    "documento_id", "pozo", "nombre_archivo", "archivo_principal", "tipo",
    "segy_kind", "categoria", "etiquetas", "servidor", "ruta_servidor",
    "latitud", "longitud", "tamano_bytes", "hash_archivo", "documentos",
)
_STORE_EXTS = {
    ".segy", ".sgy", ".lis", ".dlis", ".segd", ".zip", ".rar", ".7z",
    ".gz", ".tar", ".tgz", ".bz2", ".xz", ".mp4", ".jp2", ".tif", ".tiff",
}
_INVALID = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_TABLE_RE = re.compile(r'^[A-Za-z0-9_]+$')


class JobCancelled(Exception):
    pass


class SkipDocument(Exception):
    """El documento no se pudo obtener (404/403), pero el lote continúa."""


# ---------------------------------------------------------------------------
# Utilidades pequeñas
# ---------------------------------------------------------------------------
def _safe_name(value: str, fallback: str = "archivo", max_len: int = 120) -> str:
    name = _INVALID.sub("_", str(value or "")).strip(" .")
    name = re.sub(r"\s+", " ", name)
    return (name or fallback)[:max_len]


def _safe_folder(value: str, fallback: str = "capa") -> str:
    return _safe_name(value, fallback=fallback, max_len=80)


def _unique_name(name: str, used: set) -> str:
    if name.lower() not in used:
        used.add(name.lower())
        return name
    stem, ext = os.path.splitext(name)
    counter = 2
    while True:
        candidate = f"{stem}_{counter}{ext}"
        if candidate.lower() not in used:
            used.add(candidate.lower())
            return candidate
        counter += 1


def _zipinfo(arcname: str, filename: str) -> zipfile.ZipInfo:
    ext = os.path.splitext(filename)[1].lower()
    info = zipfile.ZipInfo(arcname, date_time=time.localtime()[:6])
    info.compress_type = (
        zipfile.ZIP_STORED if ext in _STORE_EXTS else zipfile.ZIP_DEFLATED)
    info.external_attr = 0o600 << 16
    return info


def _filename_from_disposition(header: str, fallback: str) -> str:
    if not header:
        return fallback
    # filename*=UTF-8''...
    match = re.search(r"filename\*\s*=\s*[^']*''([^;]+)", header, re.I)
    if match:
        try:
            return _safe_name(unquote(match.group(1).strip().strip('"')),
                              fallback=fallback)
        except Exception:  # noqa: BLE001
            pass
    match = re.search(r'filename\s*=\s*"?([^";]+)"?', header, re.I)
    if match:
        return _safe_name(match.group(1).strip(), fallback=fallback)
    return fallback


def _odoo_doc_url(doc_id: str) -> str:
    base = (settings.ODOO_URL or "").rstrip("/")
    return f"{base}/api/geoportal/v1/documents/{doc_id}/content"


def _auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Accept": "*/*"}


def _archive_dir() -> Path:
    base = Path(settings.DOWNLOAD_DIR)
    if not base.is_absolute():
        base = Path.cwd() / base
    base.mkdir(parents=True, exist_ok=True)
    return base


# ---------------------------------------------------------------------------
# Consulta PostGIS: documentos dentro del polígono
# ---------------------------------------------------------------------------
def _validate_table(table: str) -> str:
    if not _TABLE_RE.match(table or ""):
        raise HTTPException(400, f"Nombre de tabla inválido: {table}")
    return table


async def fetch_documents_in_geometry(
    pool,
    table: str,
    geometry: dict,
    mask_geometry: Optional[dict] = None,
    limit: int = 5001,
) -> List[Dict[str, Any]]:
    """Filas de una tabla ``archivos_indexados`` que intersectan la geometría."""
    table = _validate_table(table)
    async with pool.acquire() as conn:
        info = await conn.fetchrow(
            """
            SELECT f_table_schema, f_table_name, f_geometry_column, srid
            FROM geometry_columns
            WHERE f_table_name = $1
            ORDER BY (f_table_schema = $2) DESC
            LIMIT 1;
            """,
            table, INDEXED_WORKSPACE,
        )
        if info is None:
            logger.warning("Tabla no geográfica o inexistente: %s", table)
            return []

        schema = info["f_table_schema"]
        geom_col = info["f_geometry_column"]
        srid = int(info["srid"] or 4326)

        cols = await conn.fetch(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2;
            """,
            schema, table,
        )
        available = {row["column_name"] for row in cols}
        if "documento_id" not in available:
            logger.warning(
                "La tabla %s.%s no tiene documento_id; se omite.", schema, table)
            return []

        selected = [c for c in _DOC_COLUMNS if c in available]
        select_sql = ", ".join(f'"{c}"' for c in selected)

        def geom_expr(param: str) -> str:
            expr = f"ST_SetSRID(ST_GeomFromGeoJSON({param}), 4326)"
            if srid and srid != 4326:
                expr = f"ST_Transform({expr}, {srid})"
            return expr

        args: List[Any] = [json.dumps(geometry)]
        where = f'ST_Intersects("{geom_col}", {geom_expr("$1")})'
        if mask_geometry:
            args.append(json.dumps(mask_geometry))
            where += (
                f' AND ST_Intersects("{geom_col}", {geom_expr("$2")})')

        query = (
            f'SELECT {select_sql} FROM "{schema}"."{table}" '
            f'WHERE {where} LIMIT {max(1, int(limit))};'
        )
        rows = await conn.fetch(query, *args)

    result = []
    for row in rows:
        data = dict(row)
        doc_id = data.get("documento_id")
        if doc_id is None or str(doc_id).strip() == "":
            continue
        data["documento_id"] = str(doc_id)
        result.append(data)
    return result


async def document_exists_in_indexed(pool, doc_id: str) -> bool:
    """True si el documento aparece en alguna tabla de ``archivos_indexados``.

    Evita que el endpoint individual sirva como puerta para cualquier
    ``prototype.document`` por id (IDOR).
    """
    async with pool.acquire() as conn:
        tables = await conn.fetch(
            """
            SELECT table_name
            FROM information_schema.columns
            WHERE table_schema = $1 AND column_name = 'documento_id';
            """,
            INDEXED_WORKSPACE,
        )
        for row in tables:
            table = _validate_table(row["table_name"])
            found = await conn.fetchval(
                f'SELECT 1 FROM "{INDEXED_WORKSPACE}"."{table}" '
                f'WHERE "documento_id"::text = $1 LIMIT 1;',
                str(doc_id),
            )
            if found:
                return True
    return False


# ---------------------------------------------------------------------------
# Plan del lote
# ---------------------------------------------------------------------------
async def build_plan(
    layers: List[Dict[str, str]],
    geometry: dict,
    mask_geometry: Optional[dict] = None,
) -> Dict[str, Any]:
    """Clasifica las capas del filtro y resuelve los documentos.

    ``layers`` viene del frontend: solo las capas de puntos que tuvieron
    hits en el polígono. Se valida contra el catálogo de GeoServer para no
    aceptar ids inventados.
    """
    if not layers:
        raise HTTPException(400, "No hay capas para descargar.")

    groups = await GeoServerService.get_workspaces_with_layers()
    catalog = {}
    for group in groups:
        for layer in group.get("layers") or []:
            if layer.get("id"):
                catalog[layer["id"]] = layer

    # El nombre publicado puede no coincidir con la tabla nativa (sufijos
    # _P/_L/_PL): igual que search.py, se resuelve por el catálogo.
    try:
        natives = await GeoServerService.get_native_table_names()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sin mapa de tablas nativas: %s", exc)
        natives = {}

    pool = get_pool()
    indexed: Dict[str, Dict[str, Any]] = {}
    shapefiles: List[Dict[str, str]] = []
    skipped: List[Dict[str, str]] = []
    seen_layers: set = set()
    seen_hashes: Dict[str, str] = {}

    for item in layers:
        layer_id = (item or {}).get("id") or ""
        if not layer_id or layer_id in seen_layers:
            continue
        seen_layers.add(layer_id)
        workspace, _, table = layer_id.partition(":")
        is_indexed = workspace == INDEXED_WORKSPACE and bool(table)
        catalog_layer = catalog.get(layer_id)
        # El workspace archivos_indexados se aprovisiona desde Odoo y puede
        # no estar aún en la caché del catálogo: no se bloquea por eso.
        if catalog_layer is None and not is_indexed:
            skipped.append({"layer": layer_id, "reason": "capa no visible"})
            continue
        if (catalog_layer or {}).get("type", "").lower() == "raster":
            skipped.append({"layer": layer_id, "reason": "capa ráster"})
            continue

        if is_indexed:
            native_table = natives.get(layer_id) or table
            rows = await fetch_documents_in_geometry(
                pool, native_table, geometry, mask_geometry)
            folder = _safe_folder(
                item.get("name") or (catalog_layer or {}).get("name") or table)
            for row in rows:
                doc_id = row["documento_id"]
                digest = (row.get("hash_archivo") or "").strip()
                if digest and digest in seen_hashes:
                    logger.info(
                        "Documento %s duplicado por hash de %s; se omite.",
                        doc_id, seen_hashes[digest])
                    continue
                entry = indexed.get(doc_id)
                if entry is None:
                    if digest:
                        seen_hashes[digest] = doc_id
                    indexed[doc_id] = {
                        "documento_id": doc_id,
                        "layer_id": layer_id,
                        "folder": folder,
                        "props": row,
                    }
                else:
                    # Un mismo LAS puede estar en las dos capas: se conserva
                    # la primera carpeta y se deduplica.
                    entry["props"].update({
                        k: v for k, v in row.items() if v not in (None, "")
                    })
        else:
            shapefiles.append({
                "id": layer_id,
                "name": (
                    item.get("name")
                    or (catalog_layer or {}).get("name")
                    or layer_id
                ),
            })

    return {
        "indexed": list(indexed.values()),
        "shapefiles": shapefiles,
        "skipped": skipped,
    }


# ---------------------------------------------------------------------------
# Armado del ZIP
# ---------------------------------------------------------------------------
def _doc_filename(props: Dict[str, Any], doc_id: str) -> str:
    """Nombre lógico del documento, sin rutas absolutas del servidor."""
    raw = props.get("nombre_archivo") or props.get("archivo_principal") or ""
    base = os.path.basename(str(raw).replace("\\", "/")).strip()
    return base or f"documento_{doc_id}"


async def _add_document(
    zf: zipfile.ZipFile,
    client: httpx.AsyncClient,
    token: str,
    doc: Dict[str, Any],
    used: set,
    job: Optional["DownloadJob"],
) -> int:
    doc_id = doc["documento_id"]
    props = doc.get("props") or {}
    fallback = _doc_filename(props, doc_id)
    req = client.build_request(
        "GET", _odoo_doc_url(doc_id), headers=_auth_headers(token))
    response = await client.send(req, stream=True)
    try:
        if response.status_code != 200:
            detail = ""
            try:
                detail = (await response.aread()).decode("utf-8", "ignore")[:300]
            except Exception:  # noqa: BLE001
                pass
            raise SkipDocument(
                f"Odoo respondió {response.status_code} para el documento "
                f"{doc_id}. {detail}".strip())

        filename = _filename_from_disposition(
            response.headers.get("content-disposition", ""), fallback)
        arcname = _unique_name(
            f"archivos_indexados/{doc['folder']}/{filename}", used)
        info = _zipinfo(arcname, filename)
        written = 0
        with zf.open(info, "w") as dest:
            async for chunk in response.aiter_bytes(_CHUNK):
                if job and job.cancel.is_set():
                    raise JobCancelled()
                dest.write(chunk)
                written += len(chunk)
                if job:
                    job.add_bytes(len(chunk), file_done=0)
        return written
    finally:
        await response.aclose()


async def _add_shapefile_layer(
    zf: zipfile.ZipFile,
    pool,
    layer: Dict[str, str],
    used: set,
) -> int:
    extras: Dict[str, bytes] = {}
    try:
        meta = await get_layer_metadata(pool, layer["id"])
        if meta:
            extras[".qmd"] = build_qmd(meta)
            extras[".xml"] = build_iso19139(meta)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sin sidecars de metadatos para %s: %s", layer["id"], exc)

    data = await GeoServerService.get_layer_shapefile_zip(
        layer["id"], extras=extras or None)
    folder = _safe_folder(layer.get("name") or layer["id"])
    written = 0
    with zipfile.ZipFile(io.BytesIO(data)) as inner:
        for member in inner.infolist():
            if member.is_dir():
                continue
            base = os.path.basename(member.filename.replace("\\", "/"))
            if not base or base.startswith("."):
                continue
            arcname = _unique_name(f"capas_shp/{folder}/{base}", used)
            info = _zipinfo(arcname, base)
            with inner.open(member) as src, zf.open(info, "w") as dest:
                while True:
                    chunk = src.read(_CHUNK)
                    if not chunk:
                        break
                    dest.write(chunk)
                    written += len(chunk)
    return written


async def build_archive(
    job: "DownloadJob",
    plan: Dict[str, Any],
    token: str,
) -> Path:
    """Arma el ZIP del job y devuelve su ruta. Lanza si algo irrecuperable falla."""
    target = _archive_dir() / f"{job.id}.zip"
    used: set = set()
    manifest: List[List[Any]] = []
    failures: List[List[Any]] = []
    stats = {"files": 0, "shapefiles": 0, "bytes": 0, "failed": 0}

    indexed = plan.get("indexed") or []
    shapefiles = plan.get("shapefiles") or []
    job.progress["files_total"] = len(indexed)
    job.progress["layers_total"] = len(shapefiles)

    timeout = httpx.Timeout(connect=15.0, read=None, write=None, pool=None)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        with zipfile.ZipFile(target, "w", allowZip64=True) as zf:
            # 1) Archivos originales del workspace archivos_indexados.
            for doc in indexed:
                if job.cancel.is_set():
                    raise JobCancelled()
                props = doc.get("props") or {}
                try:
                    size = await _add_document(
                        zf, client, token, doc, used, job)
                    stats["files"] += 1
                    stats["bytes"] += size
                    manifest.append([
                        "archivo_indexado", doc["layer_id"],
                        doc["documento_id"],
                        _doc_filename(props, doc["documento_id"]),
                        size, "ok", "",
                    ])
                except JobCancelled:
                    raise
                except SkipDocument as exc:
                    stats["failed"] += 1
                    logger.warning(
                        "No se pudo agregar el documento %s: %s",
                        doc["documento_id"], exc)
                    failures.append([
                        doc["layer_id"], doc["documento_id"],
                        _doc_filename(props, doc["documento_id"]),
                        str(exc)[:400],
                    ])
                finally:
                    job.progress["files_done"] += 1

            # 2) Shapefile completo de las demás capas de puntos.
            for layer in shapefiles:
                if job.cancel.is_set():
                    raise JobCancelled()
                try:
                    size = await _add_shapefile_layer(
                        zf, get_pool(), layer, used)
                    stats["shapefiles"] += 1
                    stats["bytes"] += size
                    manifest.append([
                        "shapefile", layer["id"], "", layer.get("name") or "",
                        size, "ok", "",
                    ])
                except Exception as exc:  # noqa: BLE001
                    stats["failed"] += 1
                    logger.warning(
                        "No se pudo agregar el shapefile %s: %s",
                        layer.get("id"), exc)
                    failures.append([
                        layer.get("id"), "", layer.get("name") or "",
                        str(exc)[:400],
                    ])
                finally:
                    job.progress["layers_done"] += 1

            # 3) Manifiesto y faltantes.
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow([
                "tipo", "capa", "documento_id", "archivo", "bytes",
                "estado", "motivo"])
            writer.writerows(manifest)
            zf.writestr(
                _zipinfo("manifiesto.csv", "manifiesto.csv"),
                buf.getvalue().encode("utf-8"))

            if failures:
                buf = io.StringIO()
                writer = csv.writer(buf)
                writer.writerow(["capa", "documento_id", "archivo", "motivo"])
                writer.writerows(failures)
                zf.writestr(
                    _zipinfo("faltantes.csv", "faltantes.csv"),
                    buf.getvalue().encode("utf-8"))

    return target


# ---------------------------------------------------------------------------
# Jobs en memoria
# ---------------------------------------------------------------------------
@dataclass
class DownloadJob:
    id: str
    user_id: str
    token: str
    label: str
    created: float
    expires: float
    state: str = "queued"
    path: Optional[Path] = None
    error: str = ""
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    progress: Dict[str, int] = field(default_factory=lambda: {
        "files_done": 0, "files_total": 0,
        "layers_done": 0, "layers_total": 0,
        "bytes_done": 0, "bytes_total": 0,
    })
    items: List[Dict[str, Any]] = field(default_factory=list)

    def add_bytes(self, n: int, file_done: int = 0) -> None:
        self.progress["bytes_done"] += n

    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.id,
            "state": self.state,
            "label": self.label,
            "progress": dict(self.progress),
            "items": list(self.items),
            "error": self.error,
            "expires_at": self.expires,
        }


JOBS: Dict[str, DownloadJob] = {}
_TICKETS: Dict[str, Dict[str, Any]] = {}
_JOBS_LOCK = asyncio.Lock()
_SEMAPHORE: Optional[asyncio.Semaphore] = None


def _semaphore() -> asyncio.Semaphore:
    global _SEMAPHORE
    if _SEMAPHORE is None:
        _SEMAPHORE = asyncio.Semaphore(
            max(1, int(settings.DOWNLOAD_MAX_CONCURRENT_JOBS or 1)))
    return _SEMAPHORE


def sweep_expired() -> None:
    now = time.time()
    for job_id, job in list(JOBS.items()):
        if job.expires > now:
            continue
        if job.path and job.path.exists():
            try:
                job.path.unlink()
            except OSError:
                pass
        JOBS.pop(job_id, None)
    for tid, info in list(_TICKETS.items()):
        if info["exp"] <= now:
            _TICKETS.pop(tid, None)
    # Huérfanos de un reinicio anterior.
    try:
        cutoff = now - float(settings.DOWNLOAD_TTL_HOURS or 48) * 3600
        for path in _archive_dir().glob("*.zip"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
            except OSError:
                pass
    except Exception:  # noqa: BLE001
        pass


def issue_ticket(kind: str, resource: str, user_id: str, token: str) -> str:
    sweep_expired()
    ticket = secrets.token_urlsafe(24)
    _TICKETS[ticket] = {
        "kind": kind,
        "resource": str(resource),
        "uid": str(user_id),
        "token": token,
        "exp": time.time() + max(1, int(settings.DOWNLOAD_TICKET_MINUTES)) * 60,
    }
    return ticket


def resolve_ticket(ticket: str, kind: str, resource: str) -> Optional[Dict[str, Any]]:
    info = _TICKETS.get(ticket or "")
    if not info:
        return None
    if info["exp"] <= time.time():
        _TICKETS.pop(ticket, None)
        return None
    if info["kind"] != kind or info["resource"] != str(resource):
        return None
    return info


async def create_job(
    user_id: str,
    token: str,
    label: str,
    plan: Dict[str, Any],
) -> DownloadJob:
    sweep_expired()
    async with _JOBS_LOCK:
        active = sum(
            1 for j in JOBS.values()
            if j.user_id == user_id and j.state in ("queued", "running"))
        if active >= 1:
            raise HTTPException(
                409, "Ya tienes una descarga en proceso. Espera a que termine.")
        job = DownloadJob(
            id=uuid.uuid4().hex,
            user_id=user_id,
            token=token,
            label=label,
            created=time.time(),
            expires=time.time() + float(settings.DOWNLOAD_TTL_HOURS or 48) * 3600,
        )
        job.items = _plan_items(plan)
        JOBS[job.id] = job
    return job


def _plan_items(plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Resumen legible por capa para el monitor de progreso."""
    items: Dict[str, Dict[str, Any]] = {}
    for doc in plan.get("indexed") or []:
        key = doc["layer_id"]
        entry = items.setdefault(key, {
            "kind": "files", "layer": key, "name": doc["folder"], "count": 0,
        })
        entry["count"] += 1
    for layer in plan.get("shapefiles") or []:
        key = layer["id"]
        items.setdefault(key, {
            "kind": "shapefile", "layer": key,
            "name": layer.get("name") or key, "count": 1,
        })
    return list(items.values())


async def run_job(job: DownloadJob, plan: Dict[str, Any]) -> None:
    async with _semaphore():
        if job.state != "queued":
            return
        job.state = "running"
        try:
            job.path = await build_archive(job, plan, job.token)
            job.state = "ready"
            job.progress["bytes_total"] = job.progress["bytes_done"]
        except JobCancelled:
            job.state = "cancelled"
            job.error = "Descarga cancelada por el usuario."
            if job.path and job.path.exists():
                try:
                    job.path.unlink()
                except OSError:
                    pass
        except asyncio.CancelledError:
            job.state = "cancelled"
            job.error = "Descarga interrumpida."
            if job.path and job.path.exists():
                try:
                    job.path.unlink()
                except OSError:
                    pass
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("Job de descarga %s falló", job.id)
            job.state = "error"
            job.error = str(exc)[:2000]
            if job.path and job.path.exists():
                try:
                    job.path.unlink()
                except OSError:
                    pass


def get_job(job_id: str) -> Optional[DownloadJob]:
    return JOBS.get(job_id)


_TASKS: set = set()


def start_job(job: DownloadJob, plan: Dict[str, Any]) -> asyncio.Task:
    """Lanza el job en segundo plano manteniendo una referencia a la task."""
    task = asyncio.create_task(run_job(job, plan))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return task


def ticket_url_for_job(job: DownloadJob) -> str:
    ticket = issue_ticket("job", job.id, job.user_id, job.token)
    return f"/api/v1/downloads/jobs/{job.id}/file?ticket={ticket}"


def ticket_url_for_document(doc_id: str, user_id: str, token: str) -> str:
    ticket = issue_ticket("doc", doc_id, user_id, token)
    return f"/api/v1/downloads/document/{doc_id}?ticket={ticket}"
