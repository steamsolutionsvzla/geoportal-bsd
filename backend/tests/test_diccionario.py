# tests/test_diccionario.py
# Catálogo de datos (diccionario de campos de los esquemas gis_*).
import io

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.api import diccionario as dic_mod
from app.api.deps import auth_guard
from app.main import app
from app.models.user import CurrentUser, Rol
from app.services import diccionario_service as svc


class FakePool:
    """Pool mínimo que responde a las consultas del servicio."""

    def __init__(self, counts=None):
        self.counts = counts or {"gis_alpha.uno": 3, "gis_nuevo.dos": 0}

    async def fetch(self, query, *args):
        q = " ".join(query.lower().split())

        if "from pg_namespace" in q:
            return [{"nspname": "gis_alpha"}, {"nspname": "gis_nuevo"}]

        if "from geometry_columns" in q:
            return [
                {"f_table_schema": "gis_alpha", "f_table_name": "uno",
                 "f_geometry_column": "geom", "type": "POINT", "srid": 4189},
                {"f_table_schema": "gis_nuevo", "f_table_name": "dos",
                 "f_geometry_column": "geom", "type": "MULTIPOLYGON", "srid": 4189},
            ]

        if "from information_schema.columns" in q:
            return [
                {"table_schema": "gis_alpha", "table_name": "uno", "column_name": "id",
                 "data_type": "integer", "character_maximum_length": None,
                 "numeric_precision": 32, "numeric_scale": 0, "is_nullable": "NO",
                 "column_default": None, "ordinal_position": 1, "comment": None},
                {"table_schema": "gis_alpha", "table_name": "uno", "column_name": "nombre",
                 "data_type": "character varying", "character_maximum_length": 100,
                 "numeric_precision": None, "numeric_scale": None, "is_nullable": "YES",
                 "column_default": None, "ordinal_position": 2, "comment": "Nombre"},
                {"table_schema": "gis_alpha", "table_name": "uno", "column_name": "geom",
                 "data_type": "USER-DEFINED", "character_maximum_length": None,
                 "numeric_precision": None, "numeric_scale": None, "is_nullable": "YES",
                 "column_default": None, "ordinal_position": 3, "comment": None},
                {"table_schema": "gis_nuevo", "table_name": "dos", "column_name": "gid",
                 "data_type": "bigint", "character_maximum_length": None,
                 "numeric_precision": 64, "numeric_scale": 0, "is_nullable": "NO",
                 "column_default": None, "ordinal_position": 1, "comment": None},
                {"table_schema": "gis_nuevo", "table_name": "dos", "column_name": "geom",
                 "data_type": "USER-DEFINED", "character_maximum_length": None,
                 "numeric_precision": None, "numeric_scale": None, "is_nullable": "YES",
                 "column_default": None, "ordinal_position": 2, "comment": None},
            ]

        if "from pg_class" in q:
            return [
                {"schema_name": "gis_alpha", "table_name": "uno", "comment": "Capa uno"},
            ]

        if "from spatial_ref_sys" in q:
            return [{"srid": 4189, "auth_name": "EPSG",
                     "srtext": 'GEOGCS["REGVEN",DATUM["Red_Geodesica_Venezolana"]]'}]

        if "from metadatos.metadata_capa" in q:
            return [{
                "id": 10, "esquema_capa": "gis_alpha", "nombre_tabla_capa": "uno",
                "titulo": "Capa uno", "resumen": "Resumen de la capa uno",
                "palabras_clave": "uno, prueba", "licencias": "Libre",
                "restricciones": None, "num_entidades": 3, "tipo_geometria": "POINT",
                "crs_epsg": 4189, "fecha_carga": None, "fecha_creado": None,
                "fecha_publicado": None, "fecha_revisado": None,
                "identificador": "gis_alpha.uno",
            }]

        if "from metadatos.metadata_campo" in q:
            return [{"metadata_id": 10, "nombre": "nombre", "tipo": "texto",
                     "nulos": 0, "unicos": 3, "ejemplo": "A"}]

        return []

    async def fetchrow(self, query, *args):
        q = " ".join(query.lower().split())
        if "current_database" in q:
            return {"name": "geoportal_db", "version": "18.4"}
        if "count(*)" in q:
            # schema/table interpolados en el SQL
            for key, value in self.counts.items():
                schema, table = key.split(".")
                if f'"{schema}"."{table}"' in query:
                    return {"n": value, "xmin": -1.0, "ymin": -2.0, "xmax": 1.0, "ymax": 2.0}
            return {"n": 0, "xmin": None, "ymin": None, "xmax": None, "ymax": None}
        return None

    async def fetchval(self, query, *args):
        if "postgis_version" in query.lower():
            return "3.6.4"
        return None


@pytest.fixture()
def client(monkeypatch):
    pool = FakePool()
    monkeypatch.setattr(dic_mod, "get_pool", lambda: pool)
    svc.invalidate_cache()

    # Se conserva y restaura el override previo: otros módulos de test
    # (p. ej. test_reports) registran el suyo a nivel de módulo.
    previous = app.dependency_overrides.get(auth_guard)
    app.dependency_overrides[auth_guard] = lambda: CurrentUser(
        nombre="Ari", apellido="Analista", rol=Rol.ANALISTA,
        cargo="Analista", usuario_id="t1",
    )
    try:
        yield TestClient(app), pool
    finally:
        if previous is None:
            app.dependency_overrides.pop(auth_guard, None)
        else:
            app.dependency_overrides[auth_guard] = previous
        svc.invalidate_cache()


def test_catalogo_detecta_esquemas_nuevos(client):
    http, _ = client
    res = http.get("/api/v1/diccionario")
    assert res.status_code == 200

    data = res.json()
    assert [s["name"] for s in data["schemas"]] == ["gis_alpha", "gis_nuevo"]
    assert data["totals"]["schemas"] == 2
    assert data["totals"]["layers"] == 2
    assert data["totals"]["fields"] == 5

    alpha = data["schemas"][0]["layers"][0]
    assert alpha["title"] == "Capa uno"
    assert alpha["srs"] == "REGVEN"
    assert alpha["features"] == 3
    assert alpha["fields_documented"] == 1
    roles = {f["name"]: f["role"] for f in alpha["fields"]}
    assert roles == {"id": "id", "nombre": "attribute", "geom": "geometry"}

    nuevo = data["schemas"][1]["layers"][0]
    assert nuevo["features"] == 0
    assert any("vacía" in w.lower() for w in nuevo["warnings"])


def test_export_excel(client):
    http, _ = client
    res = http.get("/api/v1/diccionario/export")
    assert res.status_code == 200
    assert "spreadsheetml" in res.headers["content-type"]
    assert ".xlsx" in res.headers["content-disposition"]

    wb = load_workbook(io.BytesIO(res.content))
    assert wb.sheetnames == ["Resumen", "Capas", "Calidad", "Campos"]
    assert wb["Capas"].max_row == 3  # cabecera + 2 capas
    assert wb["Campos"].max_row == 6  # cabecera + 5 columnas


def test_refresh_ignora_cache(client):
    http, pool = client
    assert http.get("/api/v1/diccionario").json()["totals"]["features"] == 3

    pool.counts["gis_alpha.uno"] = 9
    # Sin refresh: sigue sirviendo la caché.
    assert http.get("/api/v1/diccionario").json()["totals"]["features"] == 3
    # Con refresh: relee la base.
    assert http.get("/api/v1/diccionario?refresh=1").json()["totals"]["features"] == 9
