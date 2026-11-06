from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.api.deps import auth_guard
from app.config import settings
from app.models.user import CurrentUser
from app.services.session_service import build_profile, drop_session, store_session

router = APIRouter(prefix="/api", tags=["Auth"])
_bearer = HTTPBearer(auto_error=False)


class LoginIn(BaseModel):
    login: str
    password: str


def _msg(data, default: str) -> str:
    if isinstance(data, dict):
        for k in ("message", "detail", "error_description", "error"):
            v = data.get(k)
            if isinstance(v, str) and v:
                return v
            if isinstance(v, dict) and isinstance(v.get("message"), str):
                return v["message"]
    return default


@router.post("/auth/login")
async def login(body: LoginIn):
    """
    Proxy de login hacia Odoo (server-to-server, sin CORS).
    Devuelve la misma respuesta de Odoo y guarda el perfil asociado al token
    para que GET /api/me pueda resolverlo.
    """
    if not settings.ODOO_URL:
        raise HTTPException(500, "ODOO_URL no está configurado en el backend.")

    url = f"{settings.ODOO_URL.rstrip('/')}/api/geoportal/v1/login"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                url,
                json={"login": body.login, "password": body.password},
                headers={"X-Odoo-Database": settings.ODOO_DB, "Accept": "application/json"},
            )
    except httpx.TimeoutException:
        raise HTTPException(504, "El servidor de autenticación no respondió a tiempo.")
    except httpx.HTTPError:
        raise HTTPException(502, "No se pudo contactar con el servidor de autenticación.")

    data = None
    if "application/json" in r.headers.get("content-type", ""):
        try:
            data = r.json()
        except ValueError:
            data = None

    if r.status_code in (400, 401, 403):
        raise HTTPException(401, _msg(data, "Usuario o contraseña incorrectos."))
    if r.status_code != 200 or not isinstance(data, dict) or not data.get("access_token"):
        raise HTTPException(502, _msg(data, f"Respuesta inesperada de Odoo (HTTP {r.status_code})."))

    try:
        profile = build_profile(data)
    except ValueError as e:
        raise HTTPException(403, str(e))

    await store_session(data["access_token"], profile, data.get("expires_in") or 28800)
    return data


@router.post("/auth/logout")
async def logout(cred: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)):
    """Invalida la sesión del lado servidor (si el token existe)."""
    if cred and cred.credentials:
        await drop_session(cred.credentials)
    return {"ok": True}


@router.get("/me", response_model=CurrentUser)
async def me(user: CurrentUser = Depends(auth_guard)):
    return user