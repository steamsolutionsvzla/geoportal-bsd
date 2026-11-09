# tests/test_admin_stats.py
# Estadísticas del dashboard admin (GET /api/v1/admin/stats).
# Se mockean el pool (sin Postgres) y las llamadas a GeoServer.
import pytest
from fastapi.testclient import TestClient

from app.api import admin
from app.api.deps import auth_guard
from app.main import app
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService

_WS = "Petróleo_y_gas"

COUNTS = {"bloques": 4, "campos": 9}


class FakeConn:
    async def fetchrow(self, query, *args):
        table = args[0]
        if table in COUNTS:
            return {"f_table_schema": "public", "f_table_name": table}
        return None

    async def fetchval(self, query, *args):
        for t, c in COUNTS.items():
            if f'"{t}"' in query:
                return c
        return 0


class _Acquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *exc):
        return False


class FakePool:
    # asyncpg devuelve jsonb como str: se replica en un caso real.
    bloques_rows = [
        {"props": '{"id": 2, "objectid": 455, "bloque": "B-1"}', "area_km2": 210.5, "lat": 9.1, "lng": -64.2},
        {"props": {"id": 1, "objectid": 454, "bloque": "A-1"}, "area_km2": 120.25, "lat": 10.4, "lng": -71.3},
    ]

    def acquire(self):
        return _Acquire(FakeConn())

    async def fetchrow(self, query, *args):
        return {"f_table_schema": "gis_petroleo", "f_table_name": "BLOQUES", "f_geometry_column": "geom"}

    async def fetch(self, query, *args):
        return self.bloques_rows

    async def fetchval(self, query, *args):
        if "metadata_capa" in query:
            return 18
        if "auth_sessions" in query:
            return 2
        return 0


def _user(rol=Rol.ADMIN, workspaces=()):
    return CurrentUser(
        nombre="Ana", apellido="Admin", rol=rol, cargo="Administradora",
        workspaces=list(workspaces), usuario_id="1",
    )


@pytest.fixture
def client_stats(monkeypatch):
    prev = app.dependency_overrides.get(auth_guard)
    app.dependency_overrides[auth_guard] = _user
    monkeypatch.setattr(admin, "get_pool", lambda: FakePool())

    async def fake_workspaces(only=None):
        return [
            {"name": _WS, "layers": [
                {"id": f"{_WS}:Bloques petroleros", "name": "Bloques petroleros", "type": "fill"},
                {"id": f"{_WS}:Campos", "name": "Campos", "type": "circle"},
                {"id": f"{_WS}:Ortofoto", "name": "Ortofoto", "type": "raster"},
            ]},
            {"name": "Territorio", "layers": [
                {"id": "Territorio:Inexistente", "name": "Inexistente", "type": "fill"},
            ]},
        ]

    async def fake_natives(force_refresh=False, ttl=300.0):
        return {
            f"{_WS}:Bloques petroleros": "bloques",
            f"{_WS}:Campos": "campos",
        }

    monkeypatch.setattr(GeoServerService, "get_workspaces_with_layers", fake_workspaces)
    monkeypatch.setattr(GeoServerService, "get_native_table_names", fake_natives)

    yield TestClient(app)
    app.dependency_overrides.pop(auth_guard, None)
    if prev is not None:
        app.dependency_overrides[auth_guard] = prev


def test_stats_devuelve_totales_reales(client_stats):
    resp = client_stats.get("/api/v1/admin/stats")
    assert resp.status_code == 200
    data = resp.json()

    cat = data["catalog"]
    assert cat["layers_total"] == 4
    assert cat["vector"] == 3
    assert cat["raster"] == 1
    assert cat["features_total"] == 13          # 4 + 9 (+0 inexistente, ráster)
    assert [l["id"] for l in cat["by_layer"]][:2] == [
        f"{_WS}:Campos", f"{_WS}:Bloques petroleros",
    ]
    assert data["metadata_layers"] == 18
    assert data["active_sessions"] == 2


def test_stats_agrupa_por_workspace(client_stats):
    cat = client_stats.get("/api/v1/admin/stats").json()["catalog"]
    ws = {w["name"]: w for w in cat["by_workspace"]}
    assert ws[_WS]["layers"] == 3
    assert ws[_WS]["vector"] == 2
    assert ws[_WS]["raster"] == 1
    assert ws[_WS]["features"] == 13
    assert ws["Territorio"]["features"] == 0


def test_stats_rechaza_rol_sin_acceso(client_stats):
    app.dependency_overrides[auth_guard] = lambda: _user(rol=Rol.ANALISTA, workspaces=(_WS,))
    resp = client_stats.get("/api/v1/admin/stats")
    assert resp.status_code == 403


def test_bloques_devuelve_filas_reales_ordenadas(client_stats):
    resp = client_stats.get("/api/v1/admin/bloques")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert [b["bloque"] for b in data["bloques"]] == ["A-1", "B-1"]
    assert data["bloques"][0]["area_km2"] == 120.25
    assert data["bloques"][1]["lat"] == 9.1


def test_bloques_rechaza_rol_sin_acceso(client_stats):
    app.dependency_overrides[auth_guard] = lambda: _user(rol=Rol.ANALISTA, workspaces=(_WS,))
    resp = client_stats.get("/api/v1/admin/bloques")
    assert resp.status_code == 403
