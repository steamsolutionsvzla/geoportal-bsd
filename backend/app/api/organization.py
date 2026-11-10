# app/api/organization.py
"""
Organización de capas en carpetas.

- Geoportal: personal por usuario (clave = usuario_id de Odoo).
- Showroom: general/compartida para todos (clave fija __showroom__).

Se guarda en Postgres (tabla user_layer_folders) y se aplica en el sidebar.
"""
import json
from datetime import datetime, timezone
from typing import List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.api.deps import allowed_workspaces, auth_guard
from app.db.database import get_pool
from app.models.user import CurrentUser
from app.services.geoserver_service import GeoServerService

router = APIRouter(prefix="/api/v1/organization", tags=["Organization"])

SHOWROOM_KEY = "__showroom__"

MAX_FOLDERS = 30
MAX_LAYERS_TOTAL = 500
MAX_NOMBRE_LEN = 60
MAX_LAYER_ID_LEN = 200


class FolderIn(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_NOMBRE_LEN)
    capas: List[str] = Field(default_factory=list)

    @field_validator("nombre")
    @classmethod
    def _nombre_no_vacio(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("El nombre de la carpeta no puede estar vacío.")
        return v


class OrganizationIn(BaseModel):
    folders: List[FolderIn] = Field(default_factory=list, max_length=MAX_FOLDERS)

    @field_validator("folders")
    @classmethod
    def _validar_conjunto(cls, v: List[FolderIn]) -> List[FolderIn]:
        total = sum(len(f.capas) for f in v)
        if total > MAX_LAYERS_TOTAL:
            raise ValueError(f"Máximo {MAX_LAYERS_TOTAL} capas asignadas en total.")
        nombres = [f.nombre.casefold() for f in v]
        if len(set(nombres)) != len(nombres):
            raise ValueError("Hay carpetas con el mismo nombre.")
        return v


def _norm_ws(ws: str) -> str:
    return (ws or "").strip().casefold()


async def validar_capas(folders: List[FolderIn], allowed: Optional[Set[str]]) -> None:
    """
    Cada capa debe ser un id único 'workspace:capa' y pertenecer a un workspace
    permitido para el usuario. allowed=None (ADMIN) sin restricción.
    """
    vistos: Set[str] = set()
    for f in folders:
        for capa in f.capas:
            capa = (capa or "").strip()
            if not capa:
                raise HTTPException(422, "Hay un identificador de capa vacío.")
            if len(capa) > MAX_LAYER_ID_LEN:
                raise HTTPException(422, f"Identificador de capa demasiado largo: '{capa[:40]}…'")
            if capa in vistos:
                raise HTTPException(422, f"La capa '{capa}' está asignada a más de una carpeta.")
            vistos.add(capa)

            if allowed is None:
                continue
            if ":" in capa:
                ws = capa.split(":", 1)[0]
            else:
                ws = await GeoServerService._find_workspace_for_layer(capa) or ""
            if _norm_ws(ws) not in allowed:
                raise HTTPException(403, f"No tienes acceso a la capa '{capa}'.")


@router.get("")
async def get_organization(user: CurrentUser = Depends(auth_guard)):
    """Carpetas guardadas del usuario; folders=None si nunca organizó."""
    if not user.usuario_id:
        return {"folders": None, "updated_at": None}
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT folders, updated_at FROM user_layer_folders WHERE usuario_id = $1;",
        user.usuario_id,
    )
    if row is None:
        return {"folders": None, "updated_at": None}
    folders = row["folders"]
    if isinstance(folders, str):
        try:
            folders = json.loads(folders)
        except json.JSONDecodeError:
            folders = []
    return {
        "folders": folders if isinstance(folders, list) else [],
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


@router.put("")
async def save_organization(payload: OrganizationIn, user: CurrentUser = Depends(auth_guard)):
    """Crea/actualiza las carpetas del usuario. folders=[] ⇒ volver a workspaces."""
    if not user.usuario_id:
        raise HTTPException(400, "Tu sesión no tiene identificador de usuario. Vuelve a iniciar sesión.")

    await validar_capas(payload.folders, allowed_workspaces(user))

    data = json.dumps([f.model_dump() for f in payload.folders], ensure_ascii=False)
    pool = get_pool()
    await pool.execute(
        """
        INSERT INTO user_layer_folders (usuario_id, folders, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (usuario_id) DO UPDATE SET
            folders    = EXCLUDED.folders,
            updated_at = NOW();
        """,
        user.usuario_id,
        data,
    )
    return {"ok": True, "folders": [f.model_dump() for f in payload.folders]}


# ---------------------------------------------------------------------------
# Showroom: organización general (compartida por todos los usuarios)
# ---------------------------------------------------------------------------
async def validar_capas_showroom(folders: List[FolderIn]) -> None:
    """Valida que las capas existan en el catálogo completo visible de GeoServer."""
    vistos: Set[str] = set()
    try:
        groups = await GeoServerService.get_workspaces_with_layers()
    except Exception as e:
        raise HTTPException(502, f"No se pudo consultar el catálogo de Showroom: {e}")

    permitidas = {
        layer.get("id")
        for group in (groups or [])
        for layer in (group.get("layers") or [])
        if layer.get("id")
    }

    for f in folders:
        for capa in f.capas:
            capa = (capa or "").strip()
            if not capa:
                raise HTTPException(422, "Hay un identificador de capa vacío.")
            if len(capa) > MAX_LAYER_ID_LEN:
                raise HTTPException(422, f"Identificador de capa demasiado largo: '{capa[:40]}…'")
            if capa in vistos:
                raise HTTPException(422, f"La capa '{capa}' está asignada a más de una carpeta.")
            vistos.add(capa)
            if capa not in permitidas:
                raise HTTPException(403, f"La capa '{capa}' no está disponible en Showroom.")


def _folders_de_fila(row) -> Optional[List[dict]]:
    if row is None:
        return None
    folders = row["folders"]
    if isinstance(folders, str):
        try:
            folders = json.loads(folders)
        except json.JSONDecodeError:
            folders = []
    return folders if isinstance(folders, list) else []


def _nombre_editor(user: CurrentUser) -> str:
    nombre = f"{user.nombre or ''} {user.apellido or ''}".strip()
    return nombre or user.usuario_id or "Usuario"


@router.get("/showroom")
async def get_organization_showroom(user: CurrentUser = Depends(auth_guard)):
    """Carpetas generales de Showroom; folders=None si nunca se organizó."""
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT folders, updated_at, updated_by FROM user_layer_folders WHERE usuario_id = $1;",
        SHOWROOM_KEY,
    )
    data = dict(row) if row is not None else {}
    return {
        "folders": _folders_de_fila(row),
        "updated_at": row["updated_at"].isoformat() if row and row["updated_at"] else None,
        "updated_by": data.get("updated_by"),
    }


@router.put("/showroom")
async def save_organization_showroom(
    payload: OrganizationIn,
    user: CurrentUser = Depends(auth_guard),
):
    """Guarda la organización general de Showroom. folders=[] ⇒ todo en Sin organización."""
    await validar_capas_showroom(payload.folders)

    editor = _nombre_editor(user)
    data = json.dumps([f.model_dump() for f in payload.folders], ensure_ascii=False)
    pool = get_pool()
    await pool.execute(
        """
        INSERT INTO user_layer_folders (usuario_id, folders, updated_at, updated_by)
        VALUES ($1, $2::jsonb, NOW(), $3)
        ON CONFLICT (usuario_id) DO UPDATE SET
            folders    = EXCLUDED.folders,
            updated_at = NOW(),
            updated_by = EXCLUDED.updated_by;
        """,
        SHOWROOM_KEY,
        data,
        editor,
    )
    return {
        "ok": True,
        "folders": [f.model_dump() for f in payload.folders],
        "updated_by": editor,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
