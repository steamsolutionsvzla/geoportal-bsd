from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError

from app.models.user import CurrentUser, Rol
from app.services.session_service import resolve_user

SHOWROOM_WORKSPACE = "Showroom"
_bearer = HTTPBearer(auto_error=False)


async def bearer_token(
    cred: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    """Token JWT crudo del usuario.

    La descarga de archivos necesita reenviarlo a Odoo (server-to-server)
    para que se apliquen las record rules del usuario real.
    """
    if cred is None or not cred.credentials:
        raise HTTPException(401, "No autenticado.", headers={"WWW-Authenticate": "Bearer"})
    return cred.credentials


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

# showroomGuard: cualquier rol autenticado, siempre "Showroom"
async def showroom_guard(user: CurrentUser = Depends(auth_guard)) -> str:
    return SHOWROOM_WORKSPACE