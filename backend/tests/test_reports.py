# tests/test_reports.py
# Pruebas de los endpoints de reportes (PDF / Excel) del backend.
import io

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.api.deps import auth_guard
from app.api.reports import ReportRequest, _build_excel, _build_pdf
from app.main import app
from app.models.user import CurrentUser, Rol


def _override_auth() -> CurrentUser:
    return CurrentUser(
        nombre="Test",
        apellido="User",
        rol=Rol.ANALISTA,
        cargo="Analista",
        workspaces=["ws1"],
    )


# Salta la autenticación real (Odoo/JWT) para probar solo el render.
app.dependency_overrides[auth_guard] = _override_auth


@pytest.fixture
def client():
    # Sin `with` para no ejecutar el lifespan (evita conectar a la DB).
    return TestClient(app)


def _payload() -> dict:
    return {
        "etiqueta": "Estado",
        "nombre": "Zulia",
        "total": 3,
        "detalle": {
            "Pozos": [
                {"nombre": "Pozo A", "id": 1, "profundidad": 100},
                {"nombre": "Pozo B", "id": 2, "profundidad": 200},
                {"nombre": "Pozo C", "id": 3, "profundidad": 300},
            ],
            "Estaciones": [
                {"nombre": "Estación X", "objectid": 9, "activa": True},
            ],
        },
        "logo_base64": None,
    }


_PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


def test_build_pdf_produces_pdf():
    pdf = _build_pdf(ReportRequest(**_payload()))
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 500


def test_build_pdf_con_logo():
    payload = _payload()
    payload["logo_base64"] = _PNG_1X1
    pdf = _build_pdf(ReportRequest(**payload))
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 500


def test_build_excel_produces_xlsx():
    data = _build_excel(ReportRequest(**_payload()))
    assert data[:2] == b"PK"
    wb = load_workbook(io.BytesIO(data))
    # "Resumen General" + una hoja de detalle por capa.
    assert "Resumen General" in wb.sheetnames
    assert "Pozos" in wb.sheetnames
    assert "Estaciones" in wb.sheetnames

    # La hoja de detalle excluye columnas tipo id y añade la columna "#".
    ws = wb["Pozos"]
    headers = [cell.value for cell in ws[1]]
    assert headers == ["#", "nombre", "profundidad"]
    assert ws.max_row == 4  # encabezado + 3 pozos


def test_pdf_endpoint(client):
    resp = client.post("/api/v1/reports/pdf", json=_payload())
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.content[:5] == b"%PDF-"


def test_excel_endpoint(client):
    resp = client.post("/api/v1/reports/excel", json=_payload())
    assert resp.status_code == 200
    assert "spreadsheetml" in resp.headers["content-type"]
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.content[:2] == b"PK"


def test_pdf_endpoint_sanitiza_nombre_de_archivo(client):
    payload = _payload()
    payload["nombre"] = "Zulia: 1/2?"
    resp = client.post("/api/v1/reports/pdf", json=payload)
    assert resp.status_code == 200
    cd = resp.headers["content-disposition"]
    # Caracteres inválidos reemplazados en el filename (no rompen la cabecera).
    assert "Reporte_Datos_" in cd
