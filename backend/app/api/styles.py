# app/api/styles.py
"""
Configuración global de estilos por capa.

Una fila por capa (unique layer_name). Los cambios se aplican
automáticamente en el Geoportal al recargar.

- Lectura: cualquier usuario autenticado (el geoportal consume).
- Escritura: ADMIN o ANALISTA, y solo sobre capas de sus workspaces.
"""

import json
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.api.deps import auth_guard, role_guard, allowed_workspaces
from app.db.database import get_pool
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService


router = APIRouter(
    prefix="/api/v1/styles",
    tags=["Styles"],
)


# ============================================================
# Schemas
# ============================================================
_HEX = r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"


class LayerStyleIn(BaseModel):
    fill_color:   Optional[str]   = Field(None, pattern=_HEX)
    stroke_color: Optional[str]   = Field(None, pattern=_HEX)
    opacity:      Optional[float] = Field(None, ge=0.0, le=1.0)
    line_width:   Optional[float] = Field(None, ge=0.0, le=50.0)
    min_zoom:     Optional[float] = Field(None, ge=0.0, le=24.0)
    max_zoom:     Optional[float] = Field(None, ge=0.0, le=24.0)
    visible_attributes: List[str] = []
    # Nombre custom por atributo: {campo_original: "Etiqueta visible"}.
    # Campo ausente o vacío ⇒ se muestra el nombre original.
    attribute_labels: Dict[str, str] = Field(default_factory=dict)
    # Etiquetas en el mapa (labels de la capa).
    show_labels: bool = False
    label_attribute: Optional[str] = Field(None, max_length=100)
    label_color: Optional[str] = Field(None, pattern=_HEX)

    @model_validator(mode="after")
    def _check_zoom_range(self):
        if self.min_zoom is not None and self.max_zoom is not None:
            if self.min_zoom > self.max_zoom:
                raise ValueError("min_zoom no puede ser mayor que max_zoom")
        return self

    @model_validator(mode="after")
    def _norm_labels(self):
        limpio: Dict[str, str] = {}
        for k, v in (self.attribute_labels or {}).items():
            campo = (k or "").strip()
            etiqueta = (v or "").strip()
            if campo and etiqueta and len(campo) <= 100 and len(etiqueta) <= 120:
                limpio[campo] = etiqueta
        self.attribute_labels = limpio
        return self

    @model_validator(mode="after")
    def _norm_label_attr(self):
        if self.label_attribute is not None:
            self.label_attribute = self.label_attribute.strip() or None
        if not self.show_labels:
            self.label_attribute = None
        return self


class LayerStyleOut(BaseModel):
    layer_name:         str
    fill_color:         Optional[str]   = None
    stroke_color:       Optional[str]   = None
    opacity:            Optional[float] = None
    line_width:         Optional[float] = None
    min_zoom:           Optional[float] = None
    max_zoom:           Optional[float] = None
    visible_attributes: List[str]       = []
    attribute_labels:   Dict[str, str]  = {}
    show_labels:        bool            = False
    label_attribute:    Optional[str]   = None
    label_color:        Optional[str]   = None
    updated_by:         Optional[str]   = None
    updated_at:         Optional[str]   = None  # ISO string


# ============================================================
# Utilidades internas
# ============================================================
def _row_to_style(row) -> dict:
    """Convierte una fila asyncpg en dict serializable."""
    d = dict(row)
    va = d.get("visible_attributes")
    if isinstance(va, str):
        try:
            d["visible_attributes"] = json.loads(va)
        except json.JSONDecodeError:
            d["visible_attributes"] = []
    elif va is None:
        d["visible_attributes"] = []
    al = d.get("attribute_labels")
    if isinstance(al, str):
        try:
            al = json.loads(al)
        except json.JSONDecodeError:
            al = {}
    d["attribute_labels"] = al if isinstance(al, dict) else {}
    if d.get("updated_at") is not None:
        d["updated_at"] = d["updated_at"].isoformat()
    return d


def _norm(s: str) -> str:
    return (s or "").strip().casefold()


_STYLE_COLS = """
        layer_name, fill_color, stroke_color, opacity, line_width,
        min_zoom, max_zoom, visible_attributes, attribute_labels,
        show_labels, label_attribute, label_color,
        updated_by, updated_at
"""


async def _ensure_workspace_access(table_name: str, user: CurrentUser) -> str:
    """
    Valida que la capa exista y que el usuario tenga acceso a su workspace.
    Devuelve el workspace resuelto.
    """
    if ":" in table_name:
        ws = table_name.split(":", 1)[0]
    else:
        ws = await GeoServerService._find_workspace_for_layer(table_name)
        if ws is None:
            raise HTTPException(404, f"No se encontró la capa '{table_name}' en ningún workspace.")

    allowed = allowed_workspaces(user)  # None = admin sin restricción
    if allowed is not None and _norm(ws) not in allowed:
        raise HTTPException(403, "No tienes acceso al workspace de esta capa.")
    return ws


# ============================================================
# Endpoints
# ============================================================
@router.get("/list")
async def list_styles(user: CurrentUser = Depends(auth_guard)):
    """
    Devuelve TODOS los estilos configurados.
    El frontend los cruza con la lista de capas que ya tiene.
    """
    pool = get_pool()
    rows = await pool.fetch(
        f"""
        SELECT {_STYLE_COLS.strip()}
        FROM layer_style_configs
        ORDER BY layer_name;
        """
    )
    return {"styles": [_row_to_style(r) for r in rows]}


@router.get("/{table_name:path}")
async def get_style(
    table_name: str,
    user: CurrentUser = Depends(auth_guard),
):
    pool = get_pool()
    row = await pool.fetchrow(
        f"""
        SELECT {_STYLE_COLS.strip()}
        FROM layer_style_configs
        WHERE layer_name = $1;
        """,
        table_name,
    )
    if row is None:
        return None
    return _row_to_style(row)


@router.put("/{table_name:path}")
async def upsert_style(
    table_name: str,
    payload: LayerStyleIn,
    user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.ANALISTA)),
):
    """
    Crea o actualiza el estilo de una capa. Solo ADMIN o ANALISTA,
    y solo si la capa pertenece a un workspace del usuario.
    """
    await _ensure_workspace_access(table_name, user)

    pool = get_pool()
    await pool.execute(
        """
        INSERT INTO layer_style_configs
            (layer_name, fill_color, stroke_color, opacity, line_width,
             min_zoom, max_zoom, visible_attributes, attribute_labels,
             show_labels, label_attribute, label_color,
             updated_by, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
                $10, $11, $12, $13, NOW())
        ON CONFLICT (layer_name) DO UPDATE SET
            fill_color         = EXCLUDED.fill_color,
            stroke_color       = EXCLUDED.stroke_color,
            opacity            = EXCLUDED.opacity,
            line_width         = EXCLUDED.line_width,
            min_zoom           = EXCLUDED.min_zoom,
            max_zoom           = EXCLUDED.max_zoom,
            visible_attributes = EXCLUDED.visible_attributes,
            attribute_labels   = EXCLUDED.attribute_labels,
            show_labels        = EXCLUDED.show_labels,
            label_attribute    = EXCLUDED.label_attribute,
            label_color        = EXCLUDED.label_color,
            updated_by         = EXCLUDED.updated_by,
            updated_at         = NOW();
        """,
        table_name,
        payload.fill_color,
        payload.stroke_color,
        payload.opacity,
        payload.line_width,
        payload.min_zoom,
        payload.max_zoom,
        json.dumps(payload.visible_attributes),
        json.dumps(payload.attribute_labels),
        payload.show_labels,
        payload.label_attribute,
        payload.label_color,
        f"{user.nombre} {user.apellido}".strip(),
    )

    row = await pool.fetchrow(
        f"""
        SELECT {_STYLE_COLS.strip()}
        FROM layer_style_configs
        WHERE layer_name = $1;
        """,
        table_name,
    )
    return _row_to_style(row)


@router.delete("/{table_name:path}")
async def reset_style(
    table_name: str,
    user: CurrentUser = Depends(role_guard(Rol.ADMIN, Rol.ANALISTA)),
):
    """Elimina la configuración → el geoportal vuelve a los defaults."""
    await _ensure_workspace_access(table_name, user)
    pool = get_pool()
    await pool.execute(
        "DELETE FROM layer_style_configs WHERE layer_name = $1;",
        table_name,
    )
    return {"ok": True}