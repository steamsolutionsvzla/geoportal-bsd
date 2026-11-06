# tests/test_organization.py
# Pruebas de los endpoints de organización de carpetas por usuario.
# Se hace monkeypatch de get_pool (no requiere Postgres).
import datetime

import pytest
from fastapi.testclient import TestClient

from app.api import organization
from app.api.deps import auth_guard
from app.main import app
from app.models.user import CurrentUser, Rol


class FakePool:
    def __init__(self, fetchrow_result=None):
        self.fetchrow_result = fetchrow_result
        self.executed = []

    async def fetchrow(self, query, *args):
        return self.fetchrow_result

    async def execute(self, query, *args):
        self.executed.append((query, args))


_WS = "Petróleo_y_gas"


def _user(rol=Rol.ANALISTA, workspaces=(_WS,), usuario_id="42"):
    return CurrentUser(
        nombre="Ari",
        apellido="Analista",
        rol=rol,
        cargo="Analista",
        workspaces=list(workspaces),
        usuario_id=usuario_id,
    )


@pytest.fixture
def client_pool(monkeypatch):
    prev = app.dependency_overrides.get(auth_guard)
    app.dependency_overrides[auth_guard] = _user
    pool = FakePool()
    monkeypatch.setattr(organization, "get_pool", lambda: pool)
    yield TestClient(app), pool
    app.dependency_overrides.pop(auth_guard, None)
    if prev is not None:
        app.dependency_overrides[auth_guard] = prev


def test_get_sin_config_previa(client_pool):
    client, _pool = client_pool
    resp = client.get("/api/v1/organization")
    assert resp.status_code == 200
    assert resp.json() == {"folders": None, "updated_at": None}


def test_get_con_filas(client_pool):
    client, pool = client_pool
    pool.fetchrow_result = {
        "folders": [{"nombre": "Pozos", "capas": [f"{_WS}:pozos"]}],
        "updated_at": datetime.datetime(2026, 11, 6, tzinfo=datetime.timezone.utc),
    }
    resp = client.get("/api/v1/organization")
    assert resp.status_code == 200
    data = resp.json()
    assert data["folders"][0]["nombre"] == "Pozos"
    assert data["updated_at"].startswith("2026-11-06")


def test_put_guarda_carpetas(client_pool):
    client, pool = client_pool
    payload = {"folders": [{"nombre": "Perforación", "capas": [f"{_WS}:pozos"]}]}
    resp = client.put("/api/v1/organization", json=payload)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert pool.executed, "debió ejecutarse el UPSERT"
    query, args = pool.executed[0]
    assert "user_layer_folders" in query
    assert args[0] == "42"
    import json as _json
    assert _json.loads(args[1])[0]["nombre"] == "Perforación"


def test_put_rechaza_workspace_no_permitido(client_pool):
    client, _pool = client_pool
    payload = {"folders": [{"nombre": "Otra", "capas": ["gerencia:licencias"]}]}
    resp = client.put("/api/v1/organization", json=payload)
    assert resp.status_code == 403


def test_put_rechaza_capa_duplicada(client_pool):
    client, _pool = client_pool
    capa = f"{_WS}:pozos"
    payload = {
        "folders": [
            {"nombre": "A", "capas": [capa]},
            {"nombre": "B", "capas": [capa]},
        ]
    }
    resp = client.put("/api/v1/organization", json=payload)
    assert resp.status_code == 422


def test_put_rechaza_nombres_repetidos(client_pool):
    client, _pool = client_pool
    payload = {
        "folders": [
            {"nombre": "Pozos", "capas": []},
            {"nombre": "pozos", "capas": []},
        ]
    }
    resp = client.put("/api/v1/organization", json=payload)
    assert resp.status_code == 422


def test_put_vacio_deuelve_a_workspaces(client_pool):
    client, pool = client_pool
    resp = client.put("/api/v1/organization", json={"folders": []})
    assert resp.status_code == 200
    assert pool.executed  # guarda [] = modo por defecto


def test_put_admin_puede_cualquier_workspace(client_pool, monkeypatch):
    app.dependency_overrides[auth_guard] = lambda: _user(rol=Rol.ADMIN, workspaces=())
    client, pool = client_pool
    payload = {"folders": [{"nombre": "Gerencia", "capas": ["gerencia:licencias"]}]}
    resp = client.put("/api/v1/organization", json=payload)
    assert resp.status_code == 200
    assert pool.executed


def test_put_sin_usuario_id_rechazado(client_pool, monkeypatch):
    app.dependency_overrides[auth_guard] = lambda: _user(usuario_id="")
    client, _pool = client_pool
    resp = client.put("/api/v1/organization", json={"folders": []})
    assert resp.status_code == 400
