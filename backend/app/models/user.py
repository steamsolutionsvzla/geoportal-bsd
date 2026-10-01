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