from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class Rol(str, Enum):
    ADMIN = "Administrador"
    GERENTE = "Rol_gerente"
    ANALISTA = "Rol_analista"

class CurrentUser(BaseModel):
    nombre: str
    apellido: str
    rol: Rol
    cargo: str
    workspaces: List[str] = Field(default_factory=list)
    # Identificador estable del usuario (id de Odoo; con fallbacks si no viene).
    # Clave de preferencias personales (p. ej. carpetas de capas del geoportal).
    usuario_id: str = ""