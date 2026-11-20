# tests/test_geodata_cache.py
# La caché de GeoJSON evita volver a pedir a GeoServer la misma capa.
import asyncio

import pytest

from app.services import geoserver_service as gs


@pytest.fixture(autouse=True)
def _reset_cache():
    gs.clear_geodata_cache()
    yield
    gs.clear_geodata_cache()


class _FakeResponse:
    status_code = 200
    headers = {"content-type": "application/json"}
    content = b'{"type":"FeatureCollection","features":[]}'

    def json(self):
        return {"type": "FeatureCollection", "features": []}


class _FakeClient:
    calls = 0

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, *args, **kwargs):
        type(self).calls += 1
        return _FakeResponse()


@pytest.fixture
def fake_geoserver(monkeypatch):
    _FakeClient.calls = 0

    async def fake_find_workspace(_table_name):
        return "ws"

    async def fake_resolve(_workspace, table_name):
        return table_name

    monkeypatch.setattr(
        gs.GeoServerService, "_find_workspace_for_layer", fake_find_workspace
    )
    monkeypatch.setattr(
        gs.GeoServerService, "_resolve_layer_name", fake_resolve
    )
    monkeypatch.setattr(gs.httpx, "AsyncClient", _FakeClient)
    return _FakeClient


def test_get_layer_geojson_reutiliza_cache(fake_geoserver):
    primero = asyncio.run(gs.GeoServerService.get_layer_geojson("capa"))
    segundo = asyncio.run(gs.GeoServerService.get_layer_geojson("capa"))

    assert fake_geoserver.calls == 1
    assert primero == segundo


def test_count_no_se_guarda_en_cache_de_capa_completa(fake_geoserver):
    asyncio.run(gs.GeoServerService.get_layer_geojson("capa", count=1))
    asyncio.run(gs.GeoServerService.get_layer_geojson("capa", count=1))

    assert fake_geoserver.calls == 2


def test_clear_geodata_cache_fuerza_recarga(fake_geoserver):
    asyncio.run(gs.GeoServerService.get_layer_geojson("capa"))
    gs.clear_geodata_cache()
    asyncio.run(gs.GeoServerService.get_layer_geojson("capa"))

    assert fake_geoserver.calls == 2
