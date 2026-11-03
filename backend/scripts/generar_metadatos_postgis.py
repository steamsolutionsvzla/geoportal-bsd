"""
Genera/actualiza metadatos ISO 19115 para TODAS las capas vectoriales de
GeoServer (solo workspaces Petróleo_y_gas y Showroom) directamente desde
PostGIS — sin shapefiles ni GUI.

- Consulta GeoServer REST para el mapeo nombre-corto → tabla nativa.
- Calcula bbox, conteo, campos (tipo/nulos/únicos/ejemplos) y CRS desde la BD.
- UPSERT en metadatos.metadata_capa + tablas hijas (uniforma las existentes).
- identificador = nombre corto de la capa en GeoServer (lo que usa el geoportal).

Uso:
    backend/venv/Scripts/python.exe backend/scripts/generar_metadatos_postgis.py
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import asyncpg

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
GEOSERVER_URL = os.environ.get("GEOSERVER_URL", "http://127.0.0.1:8081/geoserver").rstrip("/")
GEOSERVER_USER = os.environ.get("GEOSERVER_USER", "admin")
GEOSERVER_PASSWORD = os.environ.get("GEOSERVER_PASSWORD", "changeme")

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "localhost"),
    "port": int(os.environ.get("DB_PORT", "5433")),
    "user": os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASSWORD", "0907"),
    "database": os.environ.get("DB_NAME", "petroleo_db"),
}

# Solo estos workspaces (el usuario lo pidió así; Territorio queda fuera).
TARGET_WORKSPACES = ["Petróleo_y_gas", "Showroom"]

ESQUEMA_METADATOS = "metadatos"

# ---------------------------------------------------------------------------
# VALORES INSTITUCIONALES (mismos que ETL_SCRIPTS/EtL_A_UTILIZAR/generar_metadatos.py)
# ---------------------------------------------------------------------------
DEFAULT_CONTACT = {
    "name": "Unidad de Plataforma Geotecnológica",
    "role": "custodian",
    "organization": "Banco Soberano de Datos de Hidrocarburo y Gas",
    "position": "Unidad de Plataforma Geotecnológica",
    "email": "",
    "voice": "",
    "fax": "",
    "address": "",
    "city": "",
    "postalCode": "",
    "country": "",
}

DEFAULT_ID_NOTE = (
    "Datos heredados. Los metadatos de esta capa fueron generados "
    "automáticamente a partir de la información contenida en el propio "
    "conjunto de datos (atributos, sistema de referencia y extensión). "
    "No cuentan con validación externa."
)

FEES = "Sin costo"
ACCESS_CONSTRAINT = (
    "Acceso restringido únicamente al personal autorizado del "
    "Banco Soberano de Datos de Hidrocarburo y Gas."
)
USE_CONSTRAINT = (
    "Prohibida su reproducción, distribución o comercialización "
    "fuera de los canales institucionales autorizados."
)
RIGHTS = "© Banco Soberano de Datos de Hidrocarburo y Gas"
DEFAULT_CATEGORIES = ["Información geocientífica", "Petróleo"]
DEFAULT_KEYWORDS = ["Petróleo"]

GEOM_TYPE_ES = {
    "ST_Point": "Punto",
    "ST_MultiPoint": "Multipunto",
    "ST_LineString": "Línea",
    "ST_MultiLineString": "Multilínea",
    "ST_Polygon": "Polígono",
    "ST_MultiPolygon": "Multipolígono",
    "ST_GeometryCollection": "Colección de geometrías",
    "Point": "Punto",
    "MultiPoint": "Multipunto",
    "LineString": "Línea",
    "MultiLineString": "Multilínea",
    "Polygon": "Polígono",
    "MultiPolygon": "Multipolígono",
    "GeometryCollection": "Colección de geometrías",
}

# PostGIS data_type → etiqueta tipo (estilo pandas, como las filas existentes)
PG_TYPE_MAP = {
    "integer": "int64",
    "bigint": "int64",
    "smallint": "int64",
    "int": "int64",
    "int4": "int64",
    "int8": "int64",
    "int2": "int64",
    "serial": "int64",
    "bigserial": "int64",
    "double precision": "float64",
    "real": "float64",
    "numeric": "float64",
    "decimal": "float64",
    "float8": "float64",
    "float4": "float64",
    "text": "str",
    "character varying": "str",
    "varchar": "str",
    "character": "str",
    "char": "str",
    "citext": "str",
    "boolean": "bool",
    "date": "datetime",
    "timestamp without time zone": "datetime",
    "timestamp with time zone": "datetime",
    "json": "json",
    "jsonb": "json",
    "uuid": "uuid",
}

SKIP_FIELDS = {"geom", "geometry", "the_geom", "wkb_geometry", "fid", "objectid", "gid", "id"}


def _map_pg_type(data_type: str) -> str:
    return PG_TYPE_MAP.get((data_type or "").lower(), data_type or "")


def _human_type(es_types: List[str]) -> str:
    return ", ".join(es_types) if es_types else "Desconocido"


# ---------------------------------------------------------------------------
# GEOSERVER REST
# ---------------------------------------------------------------------------
async def fetch_json(url: str) -> Optional[Any]:
    import httpx

    auth = (GEOSERVER_USER, GEOSERVER_PASSWORD)
    async with httpx.AsyncClient(auth=auth, timeout=30, verify=False) as client:
        r = await client.get(url)
        if r.status_code != 200:
            return None
        return r.json()


def _json_items(payload: dict, parent: str, child: str) -> List[dict]:
    node = payload.get(parent, {})
    items = node.get(child, [])
    if items is None:
        return []
    if isinstance(items, dict):
        return [items]
    return items


async def get_workspace_layers(workspace: str) -> List[Dict[str, str]]:
    """Devuelve [{name, native_name}] de las capas vectoriales de un workspace."""
    base = f"{GEOSERVER_URL}/rest/workspaces/{quote(workspace, safe='')}"
    ds_payload = await fetch_json(f"{base}/datastores.json")
    if not ds_payload:
        print(f"  [WARN] sin datastores en '{workspace}'")
        return []

    layers: List[Dict[str, str]] = []
    for ds in _json_items(ds_payload, "dataStores", "dataStore"):
        ds_name = ds["name"]
        ft_url = f"{base}/datastores/{quote(ds_name, safe='')}/featuretypes.json"
        ft_payload = await fetch_json(ft_url)
        if not ft_payload:
            continue
        for ft in _json_items(ft_payload, "featureTypes", "featureType"):
            ft_name = ft["name"]
            # Detalle para nativeName; si falla (500), fallback al nombre corto
            detail = await fetch_json(
                f"{base}/datastores/{quote(ds_name, safe='')}/featuretypes/{quote(ft_name, safe='')}.json"
            )
            native = None
            if detail:
                native = (detail.get("featureType") or {}).get("nativeName")
            layers.append({"name": ft_name, "native_name": native or ft_name})
    return layers


# ---------------------------------------------------------------------------
# POSTGIS: análisis de una tabla
# ---------------------------------------------------------------------------
async def analyze_table(conn: asyncpg.Connection, schema: str, table: str) -> Optional[Dict[str, Any]]:
    geom_row = await conn.fetchrow(
        """
        SELECT f_geometry_column, coord_dimension, srid
        FROM geometry_columns
        WHERE f_table_schema = $1 AND f_table_name = $2
        """,
        schema,
        table,
    )
    if not geom_row:
        return None
    geom_col = geom_row["f_geometry_column"]
    srid = geom_row["srid"] or 4326

    total = await conn.fetchval(f'SELECT count(*) FROM "{schema}"."{table}"')

    ext = await conn.fetchrow(
        f"""
        SELECT ST_XMin(e) AS xmin, ST_YMin(e) AS ymin,
               ST_XMax(e) AS xmax, ST_YMax(e) AS ymax
        FROM (SELECT ST_Extent("{geom_col}") AS e FROM "{schema}"."{table}") s
        """
    )

    geom_types = await conn.fetch(
        f'SELECT DISTINCT GeometryType("{geom_col}") AS gt FROM "{schema}"."{table}" WHERE "{geom_col}" IS NOT NULL'
    )
    geom_es = sorted({GEOM_TYPE_ES.get(r["gt"], r["gt"]) for r in geom_types})

    cols = await conn.fetch(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
          AND column_name <> $3
        ORDER BY ordinal_position
        """,
        schema,
        table,
        geom_col,
    )

    campos: List[Dict[str, Any]] = []
    for col in cols:
        cname = col["column_name"]
        ctype = _map_pg_type(col["data_type"])
        stats = await conn.fetchrow(
            f'''
            SELECT count(*) AS total,
                   count("{cname}") AS no_nulos,
                   count(DISTINCT "{cname}") AS unicos
            FROM "{schema}"."{table}"
            '''
        )
        ejemplo_row = await conn.fetchrow(
            f'''
            SELECT string_agg(DISTINCT "{cname}"::text, ', ' ORDER BY "{cname}"::text) AS ej
            FROM (SELECT "{cname}" FROM "{schema}"."{table}" WHERE "{cname}" IS NOT NULL LIMIT 20) t
            '''
        )
        ej = (ejemplo_row["ej"] if ejemplo_row else None) or "No disponible"
        if len(ej) > 255:
            ej = ej[:252] + "..."
        campos.append(
            {
                "nombre": cname,
                "tipo": ctype,
                "nulos": int((stats["total"] or 0) - (stats["no_nulos"] or 0)),
                "unicos": int(stats["unicos"] or 0),
                "ejemplo": ej,
            }
        )

    srs = await conn.fetchrow(
        "SELECT auth_name, auth_srid, srtext FROM spatial_ref_sys WHERE srid = $1",
        srid,
    )
    crs_nombre = "WGS 84" if srid == 4326 else (srs["srtext"][:80] if srs and srs["srtext"] else f"EPSG:{srid}")
    crs_wkt = srs["srtext"] if srs and srs["srtext"] else ""

    return {
        "schema": schema,
        "table": table,
        "geom_col": geom_col,
        "num_entidades": int(total or 0),
        "bbox_oeste": float(ext["xmin"]) if ext and ext["xmin"] is not None else None,
        "bbox_sur": float(ext["ymin"]) if ext and ext["ymin"] is not None else None,
        "bbox_este": float(ext["xmax"]) if ext and ext["xmax"] is not None else None,
        "bbox_norte": float(ext["ymax"]) if ext and ext["ymax"] is not None else None,
        "tipo_geometria": _human_type(geom_es),
        "crs_epsg": int(srid),
        "crs_nombre": crs_nombre,
        "crs_wkt": crs_wkt,
        "campos": campos,
    }


# ---------------------------------------------------------------------------
# CONSTRUCCIÓN DE METADATOS
# ---------------------------------------------------------------------------
def auto_keywords(layer_name: str, campos: List[dict]) -> List[str]:
    kws = set()
    for token in layer_name.replace("-", " ").replace("_", " ").split():
        if len(token) > 2:
            kws.add(token.lower())
    for c in campos:
        name = c["nombre"].lower()
        if name in SKIP_FIELDS or name in ("id", "fid", "objectid", "gid", "codigo", "code"):
            continue
        if len(name) > 2:
            kws.add(name)
    fusionadas = list(sorted(kws))
    existentes = {k.lower() for k in fusionadas}
    for kw in DEFAULT_KEYWORDS:
        if kw.lower() not in existentes:
            fusionadas.insert(0, kw)
            existentes.add(kw.lower())
    return fusionadas


def build_resumen(layer_name: str, info: Dict[str, Any]) -> str:
    lines = [DEFAULT_ID_NOTE, "", "── INFORMACIÓN DE LA CAPA ──"]
    lines.append(f"  Nombre en GeoServer: {layer_name}")
    lines.append(f"  Esquema PostGIS:     {info['schema']}")
    lines.append(f"  Tabla:               {info['table']}")
    lines.append("")
    lines.append("── INFORMACIÓN GEOMÉTRICA ──")
    lines.append(f"  Tipo de geometría:   {info['tipo_geometria']}")
    lines.append(f"  Número de entidades: {info['num_entidades']}")
    lines.append(f"  Sistema de referencia: {info['crs_nombre']} (EPSG:{info['crs_epsg']})")
    if info["bbox_oeste"] is not None:
        lines.append("  Extensión espacial:")
        lines.append(f"    minx = {info['bbox_oeste']:.6f},  miny = {info['bbox_sur']:.6f}")
        lines.append(f"    maxx = {info['bbox_este']:.6f},  maxy = {info['bbox_norte']:.6f}")
    lines.append("")
    lines.append("── ESTRUCTURA DE ATRIBUTOS ──")
    lines.append(f"  Número de campos: {len(info['campos'])}")
    for i, c in enumerate(info["campos"], 1):
        lines.append(f"  [{i}] {c['nombre']}  ({c['tipo']})  únicos={c['unicos']}  nulos={c['nulos']}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# UPSERT EN BD
# ---------------------------------------------------------------------------
async def upsert_metadata(conn: asyncpg.Connection, ident: str, info: Dict[str, Any], keywords: List[str], categories: List[str]) -> int:
    resumen = build_resumen(ident, info)
    ahora = datetime.now()
    historial = f"Generado automáticamente desde PostGIS: {ahora.strftime('%Y-%m-%d %H:%M:%S')}"

    row = await conn.fetchrow(
        f"""
        INSERT INTO {ESQUEMA_METADATOS}.metadata_capa (
            identificador, titulo, tipo, idioma, resumen,
            categorias_iso, palabras_clave,
            cuotas, licencias, derechos, restricciones,
            crs_epsg, crs_nombre, crs_wkt,
            bbox_norte, bbox_sur, bbox_este, bbox_oeste,
            z_maxima, z_minima,
            historial,
            esquema_capa, nombre_tabla_capa,
            archivo_origen,
            num_entidades, tipo_geometria, num_campos,
            fecha_carga
        ) VALUES (
            $1, $1, 'dataset', 'ES', $2,
            $3, $4,
            $5, $6, $7, $8,
            $9, $10, $11,
            $12, $13, $14, $15,
            0, 0,
            $16,
            $17, $18,
            $19,
            $20, $21, $22,
            NOW()
        )
        ON CONFLICT (identificador) DO UPDATE SET
            titulo = EXCLUDED.titulo,
            resumen = EXCLUDED.resumen,
            categorias_iso = EXCLUDED.categorias_iso,
            palabras_clave = EXCLUDED.palabras_clave,
            cuotas = EXCLUDED.cuotas,
            licencias = EXCLUDED.licencias,
            derechos = EXCLUDED.derechos,
            restricciones = EXCLUDED.restricciones,
            crs_epsg = EXCLUDED.crs_epsg,
            crs_nombre = EXCLUDED.crs_nombre,
            crs_wkt = EXCLUDED.crs_wkt,
            bbox_norte = EXCLUDED.bbox_norte,
            bbox_sur = EXCLUDED.bbox_sur,
            bbox_este = EXCLUDED.bbox_este,
            bbox_oeste = EXCLUDED.bbox_oeste,
            historial = EXCLUDED.historial,
            esquema_capa = EXCLUDED.esquema_capa,
            nombre_tabla_capa = EXCLUDED.nombre_tabla_capa,
            archivo_origen = EXCLUDED.archivo_origen,
            num_entidades = EXCLUDED.num_entidades,
            tipo_geometria = EXCLUDED.tipo_geometria,
            num_campos = EXCLUDED.num_campos,
            fecha_carga = NOW()
        RETURNING id
        """,
        ident,
        resumen,
        json.dumps(categories, ensure_ascii=False),
        json.dumps(keywords, ensure_ascii=False),
        FEES,
        USE_CONSTRAINT,
        RIGHTS,
        ACCESS_CONSTRAINT,
        info["crs_epsg"],
        info["crs_nombre"],
        info["crs_wkt"],
        info["bbox_norte"],
        info["bbox_sur"],
        info["bbox_este"],
        info["bbox_oeste"],
        historial,
        info["schema"],
        info["table"],
        f"PostGIS: {info['schema']}.{info['table']}",
        info["num_entidades"],
        info["tipo_geometria"],
        len(info["campos"]),
    )
    mid = row["id"]

    # Hijas: borrar y reinsertar (uniforma)
    for tabla in ("metadata_campo", "metadata_contacto", "metadata_enlace", "metadata_palabra_clave"):
        await conn.execute(
            f"DELETE FROM {ESQUEMA_METADATOS}.{tabla} WHERE metadata_id = $1",
            mid,
        )

    for c in info["campos"]:
        await conn.execute(
            f"""
            INSERT INTO {ESQUEMA_METADATOS}.metadata_campo
                (metadata_id, nombre, tipo, nulos, unicos, ejemplo)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            mid,
            c["nombre"],
            c["tipo"],
            c["nulos"],
            c["unicos"],
            c["ejemplo"],
        )

    contact = DEFAULT_CONTACT
    await conn.execute(
        f"""
        INSERT INTO {ESQUEMA_METADATOS}.metadata_contacto
            (metadata_id, nombre, rol, organizacion, posicion,
             correo_electronico, voz, fax, direccion, tipo,
             codigo_postal, ciudad, area_administrativa, pais)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        """,
        mid,
        contact["name"],
        contact["role"],
        contact["organization"],
        contact["position"],
        contact["email"],
        contact["voice"],
        contact["fax"],
        contact["address"],
        "postal",
        contact["postalCode"],
        contact["city"],
        "",
        contact["country"],
    )

    for kw in keywords:
        await conn.execute(
            f"""
            INSERT INTO {ESQUEMA_METADATOS}.metadata_palabra_clave (metadata_id, concepto, palabra)
            VALUES ($1, 'GEMET', $2)
            """,
            mid,
            kw,
        )
    for cat in categories:
        await conn.execute(
            f"""
            INSERT INTO {ESQUEMA_METADATOS}.metadata_palabra_clave (metadata_id, concepto, palabra)
            VALUES ($1, 'ISO Topic Category', $2)
            """,
            mid,
            cat,
        )

    return mid


async def resolve_table(conn: asyncpg.Connection, schema: str, native: str) -> Optional[str]:
    """Resuelve el nombre real de la tabla en geometry_columns.

    GeoServer a veces publica un nativeName distinto al de la tabla PostGIS
    (ej. 'Lotes_petroleros_venezuela' vs '200901_Lotes_petroleros_venezuela_WGS84').
    Si no existe exacta, busca por coincidencia parcial (contención).
    """
    exact = await conn.fetchval(
        """
        SELECT f_table_name FROM geometry_columns
        WHERE f_table_schema = $1 AND f_table_name = $2
        """,
        schema,
        native,
    )
    if exact:
        return exact
    # Contención: la tabla real contiene al native, o viceversa
    row = await conn.fetchrow(
        """
        SELECT f_table_name FROM geometry_columns
        WHERE f_table_schema = $1
          AND (
            f_table_name ILIKE '%' || $2 || '%'
            OR $2 ILIKE '%' || f_table_name || '%'
          )
        ORDER BY length(f_table_name) DESC
        LIMIT 1
        """,
        schema,
        native,
    )
    return row["f_table_name"] if row else None


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
async def main() -> int:
    print(f"GeoServer: {GEOSERVER_URL}")
    print(f"Workspaces objetivo: {', '.join(TARGET_WORKSPACES)}")
    print()

    # 1) Recolectar capas de GeoServer (nombre corto + tabla nativa)
    #    Se usa un dict por nombre corto para no duplicar (Distrito_Anaco
    #    existe en Petróleo y Showroom → un solo registro de metadatos).
    capas: Dict[str, Dict[str, str]] = {}  # short_name -> {workspace, native}
    for ws in TARGET_WORKSPACES:
        print(f"[GeoServer] Leyendo '{ws}'…")
        layers = await get_workspace_layers(ws)
        print(f"  {len(layers)} capas")
        for ly in layers:
            short = ly["name"]
            # Preferir el primer workspace (Petróleo) si hay homónimo
            if short not in capas:
                capas[short] = {"workspace": ws, "native": ly["native_name"]}
    print(f"Total capas únicas a procesar: {len(capas)}")
    print()

    conn = await asyncpg.connect(**DB_CONFIG)
    ok, fail = 0, 0
    try:
        for short, meta in sorted(capas.items()):
            ws = meta["workspace"]
            native = meta["native"]
            schema = "gis_petroleo" if ws == "Petróleo_y_gas" else "gis_showroom"
            # Si el native viene qualified "schema.table", respetarlo
            if "." in native:
                schema, native = native.split(".", 1)
            print(f"[{ws}] {short}  ->  {schema}.{native}", end="  ")
            try:
                real = await resolve_table(conn, schema, native)
                if real is None:
                    print("SKIP (tabla no encontrada en geometry_columns)")
                    fail += 1
                    continue
                if real != native:
                    native = real
                    print(f"[resuelta como {schema}.{native}]", end=" ")
                info = await analyze_table(conn, schema, native)
                if info is None:
                    print("SKIP (sin geometría o tabla no encontrada)")
                    fail += 1
                    continue
                kws = auto_keywords(short, info["campos"])
                mid = await upsert_metadata(conn, short, info, kws, DEFAULT_CATEGORIES)
                print(f"OK  id={mid}  entidades={info['num_entidades']}  campos={len(info['campos'])}")
                ok += 1
            except Exception as e:
                print(f"ERROR: {e}")
                fail += 1
    finally:
        await conn.close()

    print()
    print(f"Listo. OK={ok}  FAIL={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
