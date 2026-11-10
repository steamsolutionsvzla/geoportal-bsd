# tests/test_catalog.py
# Catálogo completo, encendido/apagado de capas y config de la capa gerencial.
import json

import pytest
from fastapi.testclient import TestClient

from app.api import catalog as catalog_mod
from app.api import settings as settings_mod
from app.api.deps import auth_guard
from app.main import app
from app.models.user import CurrentUser, Rol
from app.services.geoserver_service import GeoServerService

_WS = "Petróleo_y_gas"
GEOM_ROWS = [
    {"f_table_schema": "gis_petroleo", "f_table_name": "BLOQUES", "f_geometry_column": "geom", "srid": 4189},
    {"f_table_schema": "gis_territorio", "f_table_name": "dpt_estadal_venezuela", "f_geometry_column": "geom", "srid": 4189},
]


class FakeConn:
    def __init__(self, pool):
        self.pool = pool
        self.current = None

    async def fetchrow(self, query, *args):
        table = args[0] if args else None
        if table:
            self.current = table
            return {"f_table_schema": "gis_petroleo", "f_table_name": table,
                    "f_geometry_column": "geom", "srid": 4189}
        return None

    async def fetchval(self, query, *args):
        return 7


class _Acquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *exc):
        return False


class FakePool:
    def __init__(self):
        self.executed = []
        self.setting_value = '"Gerencia:licencias"'

    def acquire(self):
        return _Acquire(FakeConn(self))

    async def fetch(self, query, *args):
        q = query.lower()
        if "geometry_columns" in q:
            return GEOM_ROWS
        if "information_schema.columns" in q:
            return [{"column_name": "ESTADO"}]
        if "distinct" in q:
            return [{"estado": "Zulia"}, {"estado": "Anzoátegui"}]
        return []

    async def fetchrow(self, query, *args):
        return None

    async def fetchval(self, query, *args):
        q = query.lower()
        if "count(*)" in q:
            return 32
        if "st_asgeojson" in q:
            return json.dumps({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]})
        if "from app_settings" in q:
            return self.setting_value
        return 0

    async def execute(self, query, *args):
        self.executed.append((query, args))


def _user(rol=Rol.GERENTE):
    return CurrentUser(nombre="Gil", apellido="Gerente", rol=rol, cargo="Gerente",
                       workspaces=[], usuario_id="9")


@pytest.fixture
def client_catalog(monkeypatch):
    prev = app.dependency_overrides.get(auth_guard)
    app.dependency_overrides[auth_guard] = _user

    pool = FakePool()
    monkeypatch.setattr(catalog_mod, "get_pool", lambda: pool)
    monkeypatch.setattr(settings_mod, "get_pool", lambda: pool)

    async def fake_workspaces(only=None, include_hidden=False):
        return [{"name": _WS, "layers": [
            {"id": f"{_WS}:Bloques petroleros", "name": "Bloques petroleros", "type": "fill"},
            {"id": f"{_WS}:Ortofoto", "name": "Ortofoto", "type": "raster"},
        ]}]

    async def fake_details(force_refresh=False, ttl=300.0):
        return {
            f"{_WS}:Bloques petroleros": {"native": "BLOQUES", "datastore": "pg_petroleo", "enabled": True},
            "Gerencia:licencias": {"native": "licencias", "datastore": "pg_gerencia", "enabled": True},
        }

    calls = []

    async def fake_set_enabled(layer_id, enabled):
        calls.append((layer_id, enabled))

    monkeypatch.setattr(GeoServerService, "get_workspaces_with_layers", fake_workspaces)
    monkeypatch.setattr(GeoServerService, "get_featuretype_details", fake_details)
    monkeypatch.setattr(GeoServerService, "set_featuretype_enabled", fake_set_enabled)

    yield TestClient(app), pool, calls
    app.dependency_overrides.pop(auth_guard, None)
    if prev is not None:
        app.dependency_overrides[auth_guard] = prev


def test_catalog_mapea_postgis_y_estado(client_catalog):
    client, _pool, _calls = client_catalog
    resp = client.get("/api/v1/admin/catalog")
    assert resp.status_code == 200
    data = resp.json()
    ws = data["workspaces"][0]
    capas = {c["name"]: c for c in ws["layers"]}

    capa = capas["Bloques petroleros"]
    assert capa["native"] == "BLOQUES"
    assert capa["table"] == "gis_petroleo.BLOQUES"
    assert capa["table_present"] is True
    assert capa["rows"] == 32
    assert capa["enabled"] is True

    raster = capas["Ortofoto"]
    assert raster["type"] == "raster"
    assert raster["native"] is None
    assert data["states"] == ["Zulia", "Anzoátegui"]


def test_catalog_apaga_capa(client_catalog):
    client, _pool, calls = client_catalog
    resp = client.patch(
        "/api/v1/admin/catalog/Petr%C3%B3leo_y_gas:Bloques%20petroleros/enabled",
        json={"enabled": False},
    )
    assert resp.status_code == 200
    assert calls == [("Petróleo_y_gas:Bloques petroleros", False)]


def test_catalog_zona_por_coordenadas(client_catalog):
    client, _pool, _calls = client_catalog
    resp = client.post("/api/v1/admin/catalog/zone", json={"lat": 10.6, "lng": -71.6, "radius_km": 15})
    assert resp.status_code == 200
    data = resp.json()
    assert data["geometry"]["type"] == "Polygon"
    assert data["counts"][f"{_WS}:Bloques petroleros"] == 7


def test_catalog_zona_por_estado(client_catalog):
    client, _pool, _calls = client_catalog
    resp = client.post("/api/v1/admin/catalog/zone", json={"estado": "Zulia"})
    assert resp.status_code == 200
    assert f"{_WS}:Bloques petroleros" in resp.json()["counts"]


def test_settings_lee_y_guarda_capa(client_catalog):
    client, pool, _calls = client_catalog
    assert client.get("/api/v1/admin/settings").json()["licenses_layer"] == "Gerencia:licencias"

    resp = client.patch("/api/v1/admin/settings",
                        json={"licenses_layer": "Gerencia:licencias"})
    assert resp.status_code == 200
    assert pool.executed, "debió guardar la configuración"

    resp = client.patch("/api/v1/admin/settings", json={"licenses_layer": "Otro:NoExiste"})
    assert resp.status_code == 422

    resp = client.patch("/api/v1/admin/settings", json={"licenses_layer": "Gerencia:no-existe"})
    assert resp.status_code == 404


def test_catalog_rechaza_rol_sin_acceso(client_catalog):
    app.dependency_overrides[auth_guard] = lambda: _user(rol=Rol.ANALISTA)
    client, _pool, _calls = client_catalog
    assert client.get("/api/v1/admin/catalog").status_code == 403
    assert client.patch("/api/v1/admin/catalog/a:b/enabled", json={"enabled": False}).status_code == 403
