# tests/test_search_zone.py
# Búsqueda de capas por zona (POST /api/v1/search/zone).
# Se mockean el pool (sin Postgres) y las llamadas a GeoServer.
import pytest
from fastapi.testclient import TestClient

from app.api import search
from app.api.deps import auth_guard
from app.main import app
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService

POLY = {
    "type": "Polygon",
    "coordinates": [[[-72.0, 9.0], [-71.0, 9.0], [-71.0, 10.0], [-72.0, 10.0], [-72.0, 9.0]]],
}

_WS = "Petróleo_y_gas"


class FakeConn:
    def __init__(self, pool):
        self.pool = pool
        self.current = None

    async def fetchrow(self, query, *args):
        table = args[0]
        if table in self.pool.tables:
            self.current = table
            return {
                "f_table_schema": "public",
                "f_table_name": table,
                "f_geometry_column": "geom",
                "srid": 4326,
            }
        self.current = None
        return None

    async def fetchval(self, query, *args):
        return self.pool.counts.get(self.current, 0)


class _Acquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *exc):
        return False


class FakePool:
    def __init__(self, tables, counts):
        self.tables = set(tables)
        self.counts = counts

    def acquire(self):
        return _Acquire(FakeConn(self))


def _user(rol=Rol.ANALISTA, workspaces=(_WS,)):
    return CurrentUser(
        nombre="Ari", apellido="Analista", rol=rol, cargo="Analista",
        workspaces=list(workspaces), usuario_id="42",
    )


@pytest.fixture
def client_search(monkeypatch):
    prev = app.dependency_overrides.get(auth_guard)
    app.dependency_overrides[auth_guard] = _user

    pool = FakePool(
        tables={"bloques", "campos", "pozos"},
        counts={"bloques": 4, "campos": 0, "pozos": 9},
    )
    monkeypatch.setattr(search, "get_pool", lambda: pool)

    async def fake_workspaces(only=None):
        return [
            {"name": _WS, "layers": [
                {"id": f"{_WS}:Bloques petroleros", "name": "Bloques petroleros", "type": "fill"},
                {"id": f"{_WS}:Campos", "name": "Campos", "type": "circle"},
                {"id": f"{_WS}:Pozos", "name": "Pozos", "type": "circle"},
                {"id": f"{_WS}:Ortofoto", "name": "Ortofoto", "type": "raster"},
            ]},
            {"name": "Otra", "layers": [
                {"id": "Otra:Privada", "name": "Privada", "type": "fill"},
            ]},
        ]

    async def fake_natives(force_refresh=False, ttl=300.0):
        return {
            f"{_WS}:Bloques petroleros": "bloques",
            f"{_WS}:Campos": "campos",
            f"{_WS}:Pozos": "pozos",
            "Otra:Privada": "privada",
        }

    monkeypatch.setattr(GeoServerService, "get_workspaces_with_layers", fake_workspaces)
    monkeypatch.setattr(GeoServerService, "get_native_table_names", fake_natives)

    yield TestClient(app)
    app.dependency_overrides.pop(auth_guard, None)
    if prev is not None:
        app.dependency_overrides[auth_guard] = prev


def test_devuelve_solo_capas_con_datos_ordenadas(client_search):
    resp = client_search.post("/api/v1/search/zone", json={"geometry": POLY})
    assert resp.status_code == 200
    data = resp.json()
    assert [l["id"] for l in data["layers"]] == [f"{_WS}:Pozos", f"{_WS}:Bloques petroleros"]
    assert data["layers"][0]["count"] == 9
    # Los rásteres no se consultan
    assert data["scanned"] == 3


def test_include_zero_lista_todas_las_vectoriales(client_search):
    resp = client_search.post(
        "/api/v1/search/zone", json={"geometry": POLY, "include_zero": True}
    )
    assert resp.status_code == 200
    assert len(resp.json()["layers"]) == 3


def test_filtra_por_workspace_del_usuario(client_search):
    app.dependency_overrides[auth_guard] = lambda: _user(workspaces=("otra",))
    resp = client_search.post("/api/v1/search/zone", json={"geometry": POLY})
    assert resp.status_code == 200
    ids = [l["id"] for l in resp.json()["layers"]]
    assert ids == []  # "Otra:Privada" no existe como tabla → 0/None, y no hay más


def test_rechaza_geometria_no_poligonal(client_search):
    resp = client_search.post(
        "/api/v1/search/zone", json={"geometry": {"type": "Point", "coordinates": [0, 0]}}
    )
    assert resp.status_code == 422


def test_rechaza_geometria_sin_coordenadas(client_search):
    resp = client_search.post(
        "/api/v1/search/zone", json={"geometry": {"type": "Polygon"}}
    )
    assert resp.status_code == 422
