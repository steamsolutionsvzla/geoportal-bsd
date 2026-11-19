# tests/test_layers_catalog.py
# El catálogo de capas es el mismo para todos los usuarios autenticados:
# no se filtra por los workspaces que Odoo asigne al perfil.
import pytest
from fastapi.testclient import TestClient

from app.api.deps import auth_guard
from app.main import app
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService

CATALOGO = [
    {"name": "Petróleo_y_gas", "layers": [
        {"id": "Petróleo_y_gas:Bloques petroleros", "name": "Bloques petroleros", "type": "fill"},
    ]},
    {"name": "Gerencia", "layers": [
        {"id": "Gerencia:licencias", "name": "licencias", "type": "fill"},
    ]},
    {"name": "rasters", "layers": [
        {"id": "rasters:ortofoto", "name": "ortofoto", "type": "raster"},
    ]},
]


def _user(rol=Rol.ANALISTA):
    return CurrentUser(
        nombre="Ari", apellido="Analista", rol=rol, cargo="Analista",
        usuario_id="42",
    )


@pytest.fixture
def client_layers(monkeypatch):
    prev = app.dependency_overrides.get(auth_guard)
    app.dependency_overrides[auth_guard] = _user

    async def fake_workspaces(only=None):
        return CATALOGO

    async def fake_layers():
        return [layer for group in CATALOGO for layer in group["layers"]]

    monkeypatch.setattr(GeoServerService, "get_workspaces_with_layers", fake_workspaces)
    monkeypatch.setattr(GeoServerService, "get_available_layers", fake_layers)

    yield TestClient(app)
    app.dependency_overrides.pop(auth_guard, None)
    if prev is not None:
        app.dependency_overrides[auth_guard] = prev


def test_analista_ve_todo_el_catalogo_de_workspaces(client_layers):
    resp = client_layers.get("/api/v1/layers/workspaces")
    assert resp.status_code == 200
    assert [g["name"] for g in resp.json()] == ["Petróleo_y_gas", "Gerencia", "rasters"]


def test_analista_ve_todas_las_capas(client_layers):
    resp = client_layers.get("/api/v1/layers/list")
    assert resp.status_code == 200
    assert [c["id"] for c in resp.json()["layers"]] == [
        "Petróleo_y_gas:Bloques petroleros",
        "Gerencia:licencias",
        "rasters:ortofoto",
    ]
