# tests/test_metadata_export.py
# Pruebas de los sidecars .qmd (QGIS) y .xml (ISO 19139) para la descarga SHP.
import datetime
import io
import xml.etree.ElementTree as ET
import zipfile

import pytest

from app.services.geoserver_service import _geojson_to_shapefile_zip
from app.services.metadata_export import build_iso19139, build_qmd

_GMD = "http://www.isotc211.org/2005/gmd"


@pytest.fixture
def meta():
    return {
        "identificador": "pozos_test",
        "titulo": 'Pozos <prueba> & "quotes" áéí',
        "tipo": "dataset",
        "idioma": "ES",
        "resumen": "Resumen con tildos y <tags>",
        "categorias_iso": '["biota", "location"]',
        "derechos": "BSD",
        "restricciones": "Uso interno",
        "licencias": "CC-BY",
        "cuotas": "0 USD",
        "crs_epsg": 4326,
        "crs_nombre": "WGS 84",
        "crs_wkt": "GEOGCS[...]",
        "bbox_oeste": -73.2, "bbox_sur": 0.1, "bbox_este": -59.1, "bbox_norte": 12.2,
        "historial": "Generado automáticamente",
        "esquema_capa": "public",
        "nombre_tabla_capa": "pozos",
        "archivo_origen": "PostGIS: public.pozos",
        "num_entidades": 123,
        "tipo_geometria": "Point",
        "num_campos": 2,
        "fecha_carga": datetime.datetime(2026, 11, 6, 8, 0, 0),
        "campos": [
            {"nombre": "nombre", "tipo": "text", "nulos": False, "unicos": False, "ejemplo": "X-1"},
            {"nombre": "profundidad", "tipo": "numeric", "nulos": True, "unicos": False, "ejemplo": None},
        ],
        "contactos": [{
            "nombre": "Ana", "rol": "pointOfContact", "organizacion": "BSD", "posicion": "Datos",
            "correo_electronico": "a@b.c", "voz": "123", "fax": None, "direccion": "Dir",
            "codigo_postal": "1000", "ciudad": "Caracas", "area_administrativa": "", "pais": "Venezuela",
        }],
        "enlaces": [{
            "nombre": "Metadatos ISO", "tipo": "information", "url": "https://x/y?a=1&b=2",
            "descripcion": "desc", "formato": "", "mime": "", "tamano": None,
        }],
        "palabras_clave": [
            {"concepto": "GEMET", "palabra": "pozo"},
            {"concepto": "ISO Topic Category", "palabra": "biota"},
        ],
    }


def test_qmd_es_xml_valido_y_completo(meta):
    qmd = build_qmd(meta)
    assert qmd.startswith(b"<!DOCTYPE qgis")
    root = ET.fromstring(qmd.decode())  # lanza si no es XML bien formado
    assert root.tag == "qgis"

    texts = {el.tag: (el.text or "") for el in root}
    assert texts["title"].startswith("Pozos")   # escapado -> parseado de vuelta
    assert "<prueba>" in texts["title"]          # el escape conserva el texto real
    assert texts["abstract"] == "Resumen con tildos y <tags>"
    assert texts["license"] == "CC-BY"
    assert texts["identifier"] == "pozos_test"

    # Extent
    sp = root.find("spatial/spatial")
    assert sp is not None and sp.get("CRS") == "EPSG:4326"
    assert float(sp.get("minx")) == pytest.approx(-73.2)
    assert float(sp.get("maxy")) == pytest.approx(12.2)

    # Keywords y vocabularios
    kws = [el.text for el in root.findall("keyword")]
    assert "pozo" in kws and "biota" in kws

    # Contacto y enlaces presentes
    assert root.find("contact/name").text == "Ana"
    links = root.findall("link/link")
    assert links and links[0].get("url") == "https://x/y?a=1&b=2"


def test_iso19139_es_xml_valido_y_normativo(meta):
    iso = build_iso19139(meta)
    root = ET.fromstring(iso.decode())
    assert root.tag == f"{{{_GMD}}}MD_Metadata"

    # título, abstract, licencia en otherConstraints
    all_text = " ".join(el.text or "" for el in root.iter())
    assert "Pozos <prueba> & \"quotes\" áéí" in all_text
    assert "Resumen con tildos y <tags>" in all_text
    assert "Licencia: CC-BY" in all_text
    assert "EPSG::4326" in all_text
    assert "-73.200000" in all_text

    # Campos del feature catalogue
    assert "profundidad" in all_text
    assert "tipo=numeric" in all_text

    # Enlaces onLine con xlink:href
    hrefs = [el.text for el in root.iter("{http://www.w3.org/1999/xlink}href")]
    assert "https://x/y?a=1&b=2" in hrefs


def test_sidecars_vacios_no_rompen():
    # Sin ficha completa: no debe explotar (campos None/ausentes).
    qmd = build_qmd({"titulo": "X"})
    iso = build_iso19139({"titulo": "X"})
    ET.fromstring(qmd.decode())
    ET.fromstring(iso.decode())


def _fc():
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"nombre": "Pozo A"},
             "geometry": {"type": "Point", "coordinates": [-70.0, 9.0]}},
        ],
    }


def test_zip_incluye_sidecars_con_nombre_base_del_shp():
    extras = {".qmd": b"<qgis/>", ".xml": b"<x/>"}
    data = _geojson_to_shapefile_zip(_fc(), "pozos", extras=extras)
    names = zipfile.ZipFile(io.BytesIO(data)).namelist()
    assert "pozos.shp" in names and "pozos.prj" in names
    assert "pozos.qmd" in names and "pozos.xml" in names


def test_zip_sin_extras_igual_que_antes():
    data = _geojson_to_shapefile_zip(_fc(), "pozos")
    names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
    assert names == {"pozos.shp", "pozos.shx", "pozos.dbf", "pozos.prj"}
