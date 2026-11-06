# app/services/metadata_export.py
"""
Generación de archivos de metadatos "sidecar" para la descarga Shapefile:

  - <capa>.qmd  → XML de metadatos de capa de QGIS (estructura QgsLayerMetadata
    que QGIS escribe/lee como <capa>.qmd junto al shapefile).
  - <capa>.xml  → ISO 19139 (gmd:MD_Metadata), estándar de catálogos
    geoespaciales (CSW/INSPIRE).

Fuente: esquema `metadatos` de la BD (metadata_capa + hijas), vía
`layer_service.get_layer_metadata`. Solo stdlib (xml.etree): sin dependencias.
"""
import json
import xml.etree.ElementTree as ET
from typing import Any, Dict, List

QGIS_VERSION = "3.34"

_GMD = "http://www.isotc211.org/2005/gmd"
_GCO = "http://www.isotc211.org/2005/gco"
_XLINK = "http://www.w3.org/1999/xlink"
_XSI = "http://www.w3.org/2001/XMLSchema-instance"
_NSMAP = {
    "gmd": _GMD,
    "gco": _GCO,
    "xlink": _XLINK,
    "xsi": _XSI,
}

_ISO19115_CodelistPublication = (
    "http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _txt(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return str(v).strip()


def _as_list(v: Any) -> list:
    """Normaliza columnas JSONB: puede venir como list, str(json) o None."""
    if v is None:
        return []
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
            return parsed if isinstance(parsed, list) else [parsed]
        except json.JSONDecodeError:
            return [s for s in (x.strip() for x in v.split(",")) if s]
    if isinstance(v, list):
        return v
    return [v]


def _sub(parent: ET.Element, tag: str, text: Any = None, **attrs: str) -> ET.Element:
    el = ET.SubElement(parent, tag, {k.replace("_", "-"): v for k, v in attrs.items()})
    if text is not None and _txt(text) != "":
        el.text = _txt(text)
    return el


def _bbox(meta: Dict[str, Any]) -> List[float]:
    try:
        return [
            float(meta.get("bbox_oeste")),
            float(meta.get("bbox_sur")),
            float(meta.get("bbox_este")),
            float(meta.get("bbox_norte")),
        ]
    except (TypeError, ValueError):
        return []


def _date_str(meta: Dict[str, Any]) -> str:
    v = meta.get("fecha_carga")
    try:
        return v.strftime("%Y-%m-%d")
    except AttributeError:
        return _txt(v)[:10]


def _cats(meta: Dict[str, Any]) -> List[str]:
    cats = _as_list(meta.get("categorias_iso"))
    if not cats:
        cats = [k.get("palabra") for k in (meta.get("palabras_clave") or [])
                if "topic" in (k.get("concepto") or "").casefold()]
    return [_txt(c) for c in cats if _txt(c)]


# ---------------------------------------------------------------------------
# QGIS .qmd  (estructura que QgsLayerMetadata::writeXml produce)
# ---------------------------------------------------------------------------
def build_qmd(meta: Dict[str, Any]) -> bytes:
    root = ET.Element("qgis", version=QGIS_VERSION)

    purposes = _sub(root, "layer_purposes")
    _sub(purposes, "purpose", "information")

    _sub(root, "abstract", meta.get("resumen"))
    _sub(root, "accessConstraints", meta.get("restricciones"))
    _sub(root, "author", meta.get("derechos"))

    contactos = meta.get("contactos") or []
    if contactos:
        c = contactos[0]
        contact = _sub(root, "contact")
        _sub(contact, "name", c.get("nombre"))
        _sub(contact, "role", c.get("rol"))
        _sub(contact, "company", c.get("organizacion"))
        _sub(contact, "position", c.get("posicion"))
        _sub(contact, "email", c.get("correo_electronico"))
        _sub(contact, "voice", c.get("voz"))
        _sub(contact, "fax", c.get("fax"))
        _sub(contact, "address", c.get("direccion"))
        _sub(contact, "city", c.get("ciudad"))
        _sub(contact, "administrative_area", c.get("area_administrativa"))
        _sub(contact, "postal_code", c.get("codigo_postal"))
        _sub(contact, "country", c.get("pais"))
        _sub(contact, "website", "")

    _sub(root, "credit", f"Generado por el Geoportal BSD el {_date_str(meta) or '—'}.")
    _sub(root, "dataItems", meta.get("archivo_origen"))
    _sub(root, "encoding", "UTF-8")

    if meta.get("historial"):
        _sub(root, "historyItem", meta.get("historial"))

    _sub(root, "identifier", meta.get("identificador") or meta.get("nombre_tabla_capa"))
    _sub(root, "parentidentifier", meta.get("identificador"))
    _sub(root, "language", meta.get("idioma") or "ES")

    for k in (meta.get("palabras_clave") or []):
        word = _txt(k.get("palabra"))
        if not word:
            continue
        _sub(root, "keyword", word)
        vocab = _txt(k.get("concepto"))
        if vocab:
            _sub(root, "Keywordvocabulary", vocab, type=vocab)

    _sub(root, "license", meta.get("licencias"))

    for e in (meta.get("enlaces") or []):
        if not _txt(e.get("url")):
            continue
        link = _sub(root, "link")
        _sub(link, "link", "", type=_txt(e.get("tipo")) or "information",
             name=_txt(e.get("nombre")), url=_txt(e.get("url")),
             description=_txt(e.get("descripcion")))

    _sub(root, "purpose", "Difusión de datos geográficos del Banco Soberano de Datos de Petróleo y Gas.")

    bbox = _bbox(meta)
    spatial = _sub(root, "spatial")
    if bbox:
        _sub(spatial, "spatial",
             CRS=f"EPSG:{_txt(meta.get('crs_epsg')) or '4326'}",
             minx=f"{bbox[0]:.10f}", miny=f"{bbox[1]:.10f}",
             maxx=f"{bbox[2]:.10f}", maxy=f"{bbox[3]:.10f}")

    if _date_str(meta):
        temporal = _sub(root, "temporal")
        _sub(temporal, "temporal", start=f"{_date_str(meta)}T00:00:00",
             end=f"{_date_str(meta)}T23:59:59", enabled="1")

    _sub(root, "title", meta.get("titulo") or meta.get("identificador"))

    cats = _cats(meta)
    if cats:
        tc = _sub(root, "TopicCategory")
        for cat in cats:
            _sub(tc, "category", cat)

    udp = _sub(root, "UserDefinedProperty")
    if meta.get("num_entidades") is not None:
        _sub(udp, "property", "", key="num_entidades", value=_txt(meta.get("num_entidades")))
    if meta.get("tipo_geometria"):
        _sub(udp, "property", "", key="tipo_geometria", value=_txt(meta.get("tipo_geometria")))
    if meta.get("num_campos") is not None:
        _sub(udp, "property", "", key="num_campos", value=_txt(meta.get("num_campos")))
    if meta.get("esquema_capa"):
        _sub(udp, "property", "", key="esquema_postgis", value=_txt(meta.get("esquema_capa")))
    if meta.get("nombre_tabla_capa"):
        _sub(udp, "property", "", key="tabla_postgis", value=_txt(meta.get("nombre_tabla_capa")))

    ET.indent(root, space="  ")
    body = ET.tostring(root, encoding="unicode")
    header = "<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n"
    return (header + body + "\n").encode("utf-8")


# ---------------------------------------------------------------------------
# ISO 19139 .xml
# ---------------------------------------------------------------------------
def _gmd_str(parent: ET.Element, prop: str, text: Any) -> None:
    s = _txt(text)
    if not s:
        return
    p = _sub(parent, f"{{{_GMD}}}{prop}")
    _sub(p, f"{{{_GCO}}}CharacterString", s)


def _gmd_bool(parent: ET.Element, prop: str, value: bool) -> None:
    p = _sub(parent, f"{{{_GMD}}}{prop}")
    _sub(p, f"{{{_GCO}}}Boolean", "true" if value else "false")


def _gmd_date(parent: ET.Element, prop: str, value: str) -> None:
    if not value:
        return
    p = _sub(parent, f"{{{_GMD}}}{prop}")
    _sub(p, f"{{{_GCO}}}Date", value)


def _gmd_code(parent: ET.Element, prop: str, code: str, label: str = None) -> None:
    p = _sub(parent, f"{{{_GMD}}}{prop}")
    _sub(p, f"{{{_GMD}}}{prop}Code", code or label,
         codeList=_ISO19115_CodelistPublication, codeListValue=code)


def _ci_responsible(parent: ET.Element, c: Dict[str, Any]) -> None:
    party = _sub(parent, f"{{{_GMD}}}CI_ResponsibleParty")
    _gmd_str(party, "individualName", c.get("nombre"))
    _gmd_str(party, "organisationName", c.get("organizacion"))
    _gmd_str(party, "positionName", c.get("posicion"))
    ci = _sub(party, f"{{{_GMD}}}contactInfo")
    contact = _sub(ci, f"{{{_GMD}}}CI_Contact")
    address = _sub(contact, f"{{{_GMD}}}address")
    ca = _sub(address, f"{{{_GMD}}}CI_Address")
    _gmd_str(ca, "deliveryPoint", c.get("direccion"))
    _gmd_str(ca, "city", c.get("ciudad"))
    _gmd_str(ca, "administrativeArea", c.get("area_administrativa"))
    _gmd_str(ca, "postalCode", c.get("codigo_postal"))
    _gmd_str(ca, "country", c.get("pais"))
    _gmd_str(ca, "electronicMailAddress", c.get("correo_electronico"))
    if _txt(c.get("voz")) or _txt(c.get("fax")):
        phone = _sub(contact, f"{{{_GMD}}}phone")
        ct = _sub(phone, f"{{{_GMD}}}CI_Telephone")
        _gmd_str(ct, "voice", c.get("voz"))
        _gmd_str(ct, "facsimile", c.get("fax"))
    _gmd_code(party, "role", "pointOfContact")


def build_iso19139(meta: Dict[str, Any]) -> bytes:
    ident = (_txt(meta.get("identificador"))
             or _txt(meta.get("nombre_tabla_capa")) or "capa")

    root = ET.Element(f"{{{_GMD}}}MD_Metadata", nsmap=_NSMAP)

    # --- Cabecera del registro ---
    _gmd_str(root, "fileIdentifier", ident)
    _gmd_str(root, "language", meta.get("idioma") or "ES")
    _gmd_code(root, "characterSet", "utf8", "UTF-8")
    _gmd_code(root, "hierarchyLevel", _txt(meta.get("tipo")) or "dataset")
    _gmd_date(root, "dateStamp", _date_str(meta))

    contactos = meta.get("contactos") or []
    if contactos:
        wrap = _sub(root, f"{{{_GMD}}}contact")
        _ci_responsible(wrap, contactos[0])

    # --- identificationInfo ---
    ident_info = _sub(root, f"{{{_GMD}}}identificationInfo")
    data_id = _sub(ident_info, f"{{{_GMD}}}MD_DataIdentification")

    citation = _sub(data_id, f"{{{_GMD}}}citation")
    ci = _sub(citation, f"{{{_GMD}}}CI_Citation")
    _gmd_str(ci, "title", _txt(meta.get("titulo")) or ident)
    _gmd_str(ci, "alternateTitle", ident)
    if _date_str(meta):
        d = _sub(ci, f"{{{_GMD}}}date")
        cd = _sub(d, f"{{{_GMD}}}CI_Date")
        _gmd_date(cd, "date", _date_str(meta))
        _gmd_code(cd, "dateType", "publication")

    _gmd_str(data_id, "abstract", meta.get("resumen"))

    palabras = meta.get("palabras_clave") or []
    if palabras:
        wrap = _sub(data_id, f"{{{_GMD}}}descriptiveKeywords")
        md_kw = _sub(wrap, f"{{{_GMD}}}MD_Keywords")
        for k in palabras:
            _gmd_str(md_kw, "keyword", k.get("palabra"))
        _gmd_code(md_kw, "type", "theme")

    otras = []
    if meta.get("derechos"):
        otras.append(f"Derechos: {_txt(meta['derechos'])}")
    if meta.get("restricciones"):
        otras.append(f"Restricciones: {_txt(meta['restricciones'])}")
    if meta.get("licencias"):
        otras.append(f"Licencia: {_txt(meta['licencias'])}")
    if otras:
        wrap = _sub(data_id, f"{{{_GMD}}}resourceConstraints")
        legal = _sub(wrap, f"{{{_GMD}}}MD_LegalConstraints")
        _gmd_code(legal, "accessConstraints", "otherRestrictions")
        _gmd_code(legal, "useConstraints", "otherRestrictions")
        _gmd_str(legal, "otherConstraints", " | ".join(otras))

    _gmd_code(data_id, "spatialRepresentationType", "vector")

    for cat in _cats(meta):
        wrap = _sub(data_id, f"{{{_GMD}}}topicCategory")
        _sub(wrap, f"{{{_GMD}}}MD_TopicCategoryCode", cat)

    _gmd_str(data_id, "language", meta.get("idioma") or "ES")
    _gmd_code(data_id, "characterSet", "utf8", "UTF-8")

    bbox = _bbox(meta)
    if bbox:
        wrap = _sub(data_id, f"{{{_GMD}}}extent")
        ex = _sub(wrap, f"{{{_GMD}}}EX_Extent")
        geo = _sub(ex, f"{{{_GMD}}}geographicElement")
        gbb = _sub(geo, f"{{{_GMD}}}EX_GeographicBoundingBox")
        for prop, val in (("westBoundLongitude", bbox[0]), ("eastBoundLongitude", bbox[2]),
                          ("southBoundLatitude", bbox[1]), ("northBoundLatitude", bbox[3])):
            p = _sub(gbb, f"{{{_GMD}}}{prop}")
            _sub(p, f"{{{_GCO}}}Decimal", f"{val:.6f}")
    if _date_str(meta):
        wrap = _sub(data_id, f"{{{_GMD}}}extent")
        ex = _sub(wrap, f"{{{_GMD}}}EX_Extent")
        te = _sub(ex, f"{{{_GMD}}}temporalElement")
        tt = _sub(te, f"{{{_GMD}}}EX_TemporalExtent")
        extent = _sub(tt, "{http://www.opengis.net/gml/3.2}extent")
        time_period = _sub(extent, "{http://www.opengis.net/gml/3.2}TimePeriod")
        _sub(time_period, "{http://www.opengis.net/gml/3.2}beginPosition", f"{_date_str(meta)}T00:00:00")
        _sub(time_period, "{http://www.opengis.net/gml/3.2}endPosition", f"{_date_str(meta)}T23:59:59")

    # Catálogo de campos (atributos).
    campos = meta.get("campos") or []
    if campos:
        wrap = _sub(data_id, f"{{{_GMD}}}contentInfo")
        fcd = _sub(wrap, f"{{{_GMD}}}MD_FeatureCatalogueDescription")
        _gmd_bool(fcd, "includedWithDataset", True)
        for c in campos:
            cit = _sub(fcd, f"{{{_GMD}}}featureCatalogueCitation")
            ci = _sub(cit, f"{{{_GMD}}}CI_Citation")
            _gmd_str(ci, "title", c.get("nombre"))
            details = [f"tipo={_txt(c.get('tipo'))}"]
            if c.get("nulos") is not None:
                details.append(f"nulos={'sí' if c.get('nulos') else 'no'}")
            if c.get("unicos") is not None:
                details.append(f"unicos={'sí' if c.get('unicos') else 'no'}")
            if _txt(c.get("ejemplo")):
                details.append(f"ejemplo={_txt(c.get('ejemplo'))}")
            _gmd_str(ci, "otherDetails", ", ".join(details))

    supp = []
    if meta.get("num_entidades") is not None:
        supp.append(f"Entidades: {_txt(meta['num_entidades'])}")
    if meta.get("tipo_geometria"):
        supp.append(f"Geometría: {_txt(meta['tipo_geometria'])}")
    if meta.get("num_campos") is not None:
        supp.append(f"Campos: {_txt(meta['num_campos'])}")
    if meta.get("esquema_capa") and meta.get("nombre_tabla_capa"):
        supp.append(f"Origen: PostGIS {meta['esquema_capa']}.{meta['nombre_tabla_capa']}")
    if meta.get("historial"):
        supp.append(f"Historial: {meta['historial']}")
    _gmd_str(data_id, "supplementalInformation", ". ".join(supp))

    # --- referenceSystemInfo ---
    epsg = _txt(meta.get("crs_epsg"))
    if epsg:
        wrap = _sub(root, f"{{{_GMD}}}referenceSystemInfo")
        md_rs = _sub(wrap, f"{{{_GMD}}}MD_ReferenceSystem")
        ident_wrap = _sub(md_rs, f"{{{_GMD}}}referenceSystemIdentifier")
        rs_id = _sub(ident_wrap, f"{{{_GMD}}}RS_Identifier")
        _gmd_str(rs_id, "code", f"EPSG::{epsg}")
        _gmd_str(rs_id, "codeSpace", "EPSG")
        _gmd_str(rs_id, "version", meta.get("crs_nombre"))

    # --- distributionInfo ---
    dist_wrap = _sub(root, f"{{{_GMD}}}distributionInfo")
    md_dist = _sub(dist_wrap, f"{{{_GMD}}}MD_Distribution")

    fmt_wrap = _sub(md_dist, f"{{{_GMD}}}distributionFormat")
    fmt = _sub(fmt_wrap, f"{{{_GMD}}}MD_Format")
    _gmd_str(fmt, "name", "ESRI Shapefile (.zip)")
    _gmd_str(fmt, "version", "1")

    if _txt(meta.get("cuotas")) or _txt(meta.get("licencias")):
        order_wrap = _sub(md_dist, f"{{{_GMD}}}standardOrderProcess")
        so = _sub(order_wrap, f"{{{_GMD}}}CI_StandardOrderProcess")
        _gmd_str(so, "fees", meta.get("cuotas"))
        _gmd_str(so, "orderingInstructions", meta.get("licencias"))

    enlaces = meta.get("enlaces") or []
    transfer = _sub(md_dist, f"{{{_GMD}}}transferOptions")
    opts = _sub(transfer, f"{{{_GMD}}}MD_DigitalTransferOptions")
    for e in enlaces:
        if not _txt(e.get("url")):
            continue
        on_wrap = _sub(opts, f"{{{_GMD}}}onLine")
        res = _sub(on_wrap, f"{{{_GMD}}}CI_OnlineResource")
        href = _sub(res, f"{{{_GMD}}}linkage")
        url = _sub(href, f"{{{_XLINK}}}href")
        url.text = _txt(e.get("url"))
        _gmd_str(res, "name", e.get("nombre"))
        _gmd_str(res, "description", e.get("descripcion"))

    ET.indent(root, space="  ")
    body = ET.tostring(root, encoding="unicode")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n' + body + "\n").encode("utf-8")
