# tests/test_downloads.py
# Descarga de archivos indexados + Shapefiles (POST /api/v1/downloads/*).
# Se prueban las piezas que no dependen de Postgres/Odoo/GeoServer reales.
import asyncio
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.api import downloads
from app.api.deps import auth_guard, bearer_token
from app.main import app
from app.models.user import CurrentUser, Rol
from app.services import download_service as svc

POLY = {
    "type": "Polygon",
    "coordinates": [[[-72.0, 9.0], [-71.0, 9.0], [-71.0, 10.0], [-72.0, 10.0], [-72.0, 9.0]]],
}


def _user():
    return CurrentUser(
        nombre="Ari", apellido="Analista", rol=Rol.ANALISTA,
        cargo="Analista", usuario_id="42",
    )


@pytest.fixture
def client_downloads(monkeypatch):
    prev_auth = app.dependency_overrides.get(auth_guard)
    prev_token = app.dependency_overrides.get(bearer_token)
    app.dependency_overrides[auth_guard] = _user
    app.dependency_overrides[bearer_token] = lambda: "jwt-de-usuario"
    monkeypatch.setattr(downloads, "get_pool", lambda: object())

    async def exists(pool, doc_id):
        return str(doc_id) == "7"

    monkeypatch.setattr(svc, "document_exists_in_indexed", exists)
    yield TestClient(app)
    if prev_auth is None:
        app.dependency_overrides.pop(auth_guard, None)
    else:
        app.dependency_overrides[auth_guard] = prev_auth
    if prev_token is None:
        app.dependency_overrides.pop(bearer_token, None)
    else:
        app.dependency_overrides[bearer_token] = prev_token


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def test_safe_name_no_escapa_rutas():
    assert svc._safe_name(r"..\..\POZO:1?.las") == "_.._POZO_1_.las"


def test_filename_from_disposition():
    assert svc._filename_from_disposition(
        'attachment; filename="pozo.las"', "x") == "pozo.las"
    assert svc._filename_from_disposition(
        "attachment; filename*=UTF-8''pozo%20a.las", "x") == "pozo a.las"


def test_zipinfo_comprime_las_y_guarda_binarios():
    assert svc._zipinfo("a.las", "a.las").compress_type == zipfile.ZIP_DEFLATED
    assert svc._zipinfo("a.segy", "a.segy").compress_type == zipfile.ZIP_STORED


def test_ticket_valido_solo_para_su_recurso():
    ticket = svc.issue_ticket("doc", "7", "42", "jwt")
    assert svc.resolve_ticket(ticket, "doc", "7")["uid"] == "42"
    assert svc.resolve_ticket(ticket, "doc", "8") is None
    assert svc.resolve_ticket(ticket, "job", "7") is None


# ---------------------------------------------------------------------------
# ZIP vacío: manifiesto y faltantes
# ---------------------------------------------------------------------------
def test_build_archive_vacio_genera_manifiesto(tmp_path, monkeypatch):
    monkeypatch.setattr(svc.settings, "DOWNLOAD_DIR", str(tmp_path))
    job = svc.DownloadJob(
        id="job-test", user_id="42", token="jwt", label="Prueba",
        created=0, expires=9_999_999_999,
    )

    async def run():
        return await svc.build_archive(
            job, {"indexed": [], "shapefiles": []}, "jwt")

    path = asyncio.run(run())
    try:
        assert path.exists()
        with zipfile.ZipFile(path) as zf:
            assert "manifiesto.csv" in zf.namelist()
            assert "faltantes.csv" not in zf.namelist()
    finally:
        if path.exists():
            path.unlink()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
def test_ticket_documento_valido(client_downloads):
    response = client_downloads.post(
        "/api/v1/downloads/ticket", json={"kind": "document", "id": "7"})
    assert response.status_code == 200
    assert "/api/v1/downloads/document/7?ticket=" in response.json()["url"]


def test_ticket_documento_ajeno_404(client_downloads):
    response = client_downloads.post(
        "/api/v1/downloads/ticket", json={"kind": "document", "id": "8"})
    assert response.status_code == 404


def test_zone_sin_capas_400(client_downloads):
    response = client_downloads.post(
        "/api/v1/downloads/zone", json={"geometry": POLY, "layers": []})
    assert response.status_code == 400


def test_zone_geometria_invalida_422(client_downloads):
    response = client_downloads.post(
        "/api/v1/downloads/zone",
        json={
            "geometry": {"type": "Point", "coordinates": [0, 0]},
            "layers": [{"id": "Petróleo_y_gas:Pozos", "name": "Pozos"}],
        },
    )
    assert response.status_code == 422


def test_zone_sincrono_devuelve_url(client_downloads, monkeypatch, tmp_path):
    async def fake_plan(layers, geometry, mask_geometry=None):
        return {
            "indexed": [],
            "shapefiles": [{"id": "P:Po", "name": "Po"}],
            "skipped": [],
        }

    async def fake_run(job, plan):
        job.state = "ready"
        job.path = tmp_path / f"{job.id}.zip"
        job.path.write_bytes(b"PK\x05\x06" + b"\x00" * 18)

    monkeypatch.setattr(svc, "build_plan", fake_plan)
    monkeypatch.setattr(svc, "run_job", fake_run)
    response = client_downloads.post(
        "/api/v1/downloads/zone",
        json={"geometry": POLY, "layers": [{"id": "P:Po", "name": "Po"}]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["state"] == "ready"
    assert "url" in data and "ticket=" in data["url"]
    svc.JOBS.pop(data["job_id"], None)
