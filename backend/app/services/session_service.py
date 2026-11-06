import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.models.user import Rol

logger = logging.getLogger("app.services.session")

# ---------------------------------------------------------------------------
# Sesiones persistidas en Postgres (tabla auth_sessions).
# Clave: hash SHA-256 del token (el JWT de Odoo no se guarda en claro).
# Ventajas: sobreviven a restarts/deploys y permiten escalar a >1 worker.
# ---------------------------------------------------------------------------

_MOCK_USERS = {  # solo dev (AUTH_MOCK=true): token -> perfil
    "mock-admin":    {"nombre": "Ana", "apellido": "Admin",    "rol": "Administrador", "cargo": "Administradora", "workspaces": [], "usuario_id": "mock-admin"},
    "mock-gerente":  {"nombre": "Gil", "apellido": "Gerente",  "rol": "Rol_gerente",   "cargo": "Gerente",        "workspaces": ["ws1", "ws2"], "usuario_id": "mock-gerente"},
    "mock-analista": {"nombre": "Ari", "apellido": "Analista", "rol": "Rol_analista",  "cargo": "Analista",       "workspaces": ["ws1"], "usuario_id": "mock-analista"},
}

# Key de Odoo (geoportal_roles[0].key, en minúsculas) -> rol interno del backend.
# Odoo devuelve "Rol_Analista" y el backend usa "Rol_analista": por eso se normaliza.
_ROLE_ALIASES = {
    "rol_analista": Rol.ANALISTA,
    "rol_gerente": Rol.GERENTE,
    "administrador": Rol.ADMIN,
    "rol_administrador": Rol.ADMIN,
    "rol_admin": Rol.ADMIN,
}


def _usuario_id(odoo: dict) -> str:
    """Identificador estable del usuario para sus preferencias personales."""
    user = odoo.get("user") or {}
    uid = user.get("id") or user.get("uid") or user.get("user_id") or odoo.get("user_id")
    if uid not in (None, "", 0):
        return str(uid).strip()
    ident = (user.get("login") or user.get("email") or "").strip().lower()
    if ident:
        return f"u:{ident}"
    full = (user.get("name") or "").strip().lower()
    return f"n:{full}" if full else ""


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
        "usuario_id": _usuario_id(odoo),
    }


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def store_session(token: str, profile: dict, expires_in: int) -> None:
    if settings.AUTH_MOCK:
        return
    from app.db.database import get_pool

    pool = get_pool()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(int(expires_in or 0), 60))
    async with pool.acquire() as conn:
        # Purga de sesiones vencidas (barata gracias al índice) + upsert.
        await conn.execute("DELETE FROM auth_sessions WHERE expires_at < $1;", datetime.now(timezone.utc))
        await conn.execute(
            """
            INSERT INTO auth_sessions (token_hash, profile, expires_at)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (token_hash) DO UPDATE SET
                profile     = EXCLUDED.profile,
                expires_at  = EXCLUDED.expires_at;
            """,
            _token_hash(token),
            json.dumps(profile, ensure_ascii=False),
            expires_at,
        )


async def drop_session(token: str) -> None:
    if settings.AUTH_MOCK:
        return
    from app.db.database import get_pool

    pool = get_pool()
    await pool.execute(
        "DELETE FROM auth_sessions WHERE token_hash = $1;",
        _token_hash(token),
    )


async def resolve_user(token: str) -> Optional[dict]:
    if settings.AUTH_MOCK:
        return _MOCK_USERS.get(token)
    from app.db.database import get_pool

    try:
        pool = get_pool()
        row = await pool.fetchrow(
            "SELECT profile, expires_at FROM auth_sessions WHERE token_hash = $1;",
            _token_hash(token),
        )
    except Exception:
        logger.exception("No se pudo resolver la sesión desde la BD.")
        return None
    if row is None:
        return None
    if row["expires_at"] < datetime.now(timezone.utc):
        # Expirada: limpiar y tratar como inválida.
        try:
            await pool.execute("DELETE FROM auth_sessions WHERE token_hash = $1;", _token_hash(token))
        except Exception:
            logger.warning("Fallo purgando sesión expirada.", exc_info=True)
        return None
    profile = row["profile"]
    if isinstance(profile, str):
        try:
            profile = json.loads(profile)
        except json.JSONDecodeError:
            return None
    return profile if isinstance(profile, dict) else None
