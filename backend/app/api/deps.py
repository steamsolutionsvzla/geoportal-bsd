from typing import Iterable, List, Optional, Set
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService
from app.services.session_service import resolve_user

SHOWROOM_WORKSPACE = "Showroom"
_bearer = HTTPBearer(auto_error=False)

def _norm(name: str) -> str:
    return (name or "").strip().casefold()

# authGuard
async def auth_guard(cred: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> CurrentUser:
    if cred is None or not cred.credentials:
        raise HTTPException(401, "No autenticado.", headers={"WWW-Authenticate": "Bearer"})
    profile = await resolve_user(cred.credentials)
    if profile is None:
        raise HTTPException(401, "Sesión inválida o expirada.", headers={"WWW-Authenticate": "Bearer"})
    try:
        return CurrentUser(**profile)
    except ValidationError:
        raise HTTPException(502, "Perfil de usuario con formato inesperado.")

# roleGuard
def role_guard(*allowed: Rol):
    async def _guard(user: CurrentUser = Depends(auth_guard)) -> CurrentUser:
        if user.rol not in allowed:
            raise HTTPException(403, "Tu rol no tiene acceso a este recurso.")
        return user
    return _guard

admin_area = role_guard(Rol.ADMIN, Rol.GERENTE)   # admin.astro + acompañantes
hub_area   = role_guard(Rol.ADMIN, Rol.ANALISTA)  # hub + acompañantes
users_area = role_guard(Rol.ADMIN)                # gestión users/roles

# workspaceGuard
def allowed_workspaces(user: CurrentUser) -> Optional[Set[str]]:
    """None = sin restricción (Administrador)."""
    return None if user.rol == Rol.ADMIN else {_norm(w) for w in user.workspaces}

def filter_layers_by_workspace(user: CurrentUser, layers: Iterable[dict]) -> List[dict]:
    allowed = allowed_workspaces(user)
    if allowed is None:
        return list(layers)
    return [l for l in layers if _norm(str(l.get("id", "")).split(":", 1)[0]) in allowed]

async def workspace_guard(table_name: str, user: CurrentUser = Depends(auth_guard)) -> CurrentUser:
    if ":" in table_name:
        ws = table_name.split(":", 1)[0]
    else:
        ws = await GeoServerService._find_workspace_for_layer(table_name)
        if ws is None:
            raise HTTPException(404, f"No se encontró la capa '{table_name}' en ningún workspace.")
    allowed = allowed_workspaces(user)
    if allowed is not None and _norm(ws) not in allowed:
        raise HTTPException(403, "No tienes acceso al workspace de esta capa.")
    return user

# showroomGuard: cualquier rol autenticado, siempre "Showroom"
async def showroom_guard(user: CurrentUser = Depends(auth_guard)) -> str:
    return SHOWROOM_WORKSPACE