import time
from typing import Optional

from app.config import settings
from app.models.user import Rol

# ---------------------------------------------------------------------------
# Sesiones en memoria: token (JWT de Odoo) -> (expira_en_epoch, perfil)
# Se llenan en POST /api/auth/login. Si el backend se reinicia, el usuario
# simplemente vuelve a iniciar sesión (resolve_user devuelve None -> 401).
# Nota: válido con un solo worker de uvicorn (como está en el Dockerfile).
# ---------------------------------------------------------------------------
_SESSIONS: dict[str, tuple[float, dict]] = {}
_MAX_SESSIONS = 5000

_MOCK_USERS = {  # solo dev (AUTH_MOCK=true): token -> perfil
    "mock-admin":    {"nombre": "Ana", "apellido": "Admin",    "rol": "Administrador", "cargo": "Administradora", "workspaces": []},
    "mock-gerente":  {"nombre": "Gil", "apellido": "Gerente",  "rol": "Rol_gerente",   "cargo": "Gerente",        "workspaces": ["ws1", "ws2"]},
    "mock-analista": {"nombre": "Ari", "apellido": "Analista", "rol": "Rol_analista",  "cargo": "Analista",       "workspaces": ["ws1"]},
}

# Key de Odoo (geoportal_roles[0].key, en minúsculas) -> rol interno del backend.
# Odoo devuelve "Rol_Analista" y el backend usa "Rol_analista": por eso se normaliza.
# Agrega aquí las keys reales de Odoo para Administrador y Gerente.
_ROLE_ALIASES = {
    "rol_analista": Rol.ANALISTA,
    "rol_gerente": Rol.GERENTE,
    "administrador": Rol.ADMIN,
    "rol_administrador": Rol.ADMIN,
    "rol_admin": Rol.ADMIN,
}


def build_profile(odoo: dict) -> dict:
    """Convierte la respuesta de login de Odoo en el payload de /api/me."""
    user = odoo.get("user") or {}
    roles = odoo.get("geoportal_roles") or []
    key = (roles[0].get("key") if roles else None) or ""

    rol = _ROLE_ALIASES.get(key.strip().casefold())
    if rol is None:
        raise ValueError(f"Rol de Geoportal no reconocido: '{key or 'sin rol'}'.")

    full = (user.get("name") or "").strip()
    nombre = user.get("first_name") or (full.split(" ")[0] if full else "")
    apellido = user.get("last_name") or " ".join(full.split(" ")[1:])

    profiles = odoo.get("profiles") or []
    cargo = (
        (profiles[0].get("name") if profiles else None)
        or user.get("department")
        or roles[0].get("name")
        or rol.value
    )

    workspaces = [w["name"] for w in (odoo.get("workspaces") or []) if w.get("name")]

    return {
        "nombre": nombre,
        "apellido": apellido,
        "rol": rol.value,
        "cargo": cargo,
        "workspaces": workspaces,
    }


def store_session(token: str, profile: dict, expires_in: int) -> None:
    now = time.time()
    # limpieza de sesiones vencidas (y tope de tamaño)
    for t in [t for t, (exp, _) in _SESSIONS.items() if exp <= now]:
        _SESSIONS.pop(t, None)
    if len(_SESSIONS) >= _MAX_SESSIONS:
        _SESSIONS.pop(next(iter(_SESSIONS)), None)
    _SESSIONS[token] = (now + max(int(expires_in or 0), 60), profile)


def drop_session(token: str) -> None:
    _SESSIONS.pop(token, None)


async def resolve_user(token: str) -> Optional[dict]:
    if settings.AUTH_MOCK:
        return _MOCK_USERS.get(token)
    entry = _SESSIONS.get(token)
    if entry is None:
        return None
    exp, profile = entry
    if time.time() >= exp:
        _SESSIONS.pop(token, None)
        return None
    return profile