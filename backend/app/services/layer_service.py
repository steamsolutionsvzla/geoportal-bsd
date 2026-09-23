# app/services/layer_service.py
"""
Servicio de capas y metadatos.

- get_db_layers: lista las tablas geográficas de PostGIS (schema public)
                 y las tipifica para MapLibre.
- get_layer_metadata: obtiene los metadatos de una capa desde el esquema
                      'metadatos' (tablas metadata_capa + hijas).
- get_table_geojson: devuelve una tabla geográfica como FeatureCollection.
"""


# ---------------------------------------------------------------------------
# 1. LISTADO DE CAPAS GEOGRÁFICAS (para MapLibre)
# ---------------------------------------------------------------------------
async def get_db_layers(pool):
    """Consulta las tablas geográficas de la BD y las tipifica para MapLibre."""
    query = """
        SELECT
            f_table_name AS id,
            initcap(replace(f_table_name, '_', ' ')) AS name,
            lower(type) AS geom_type
        FROM geometry_columns
        WHERE f_table_schema = 'public'
        ORDER BY name ASC;
    """

    async with pool.acquire() as connection:
        rows = await connection.fetch(query)

        layers = []
        for row in rows:
            g_type = row["geom_type"]
            map_type = "circle"
            if "polygon" in g_type:
                map_type = "fill"
            elif "line" in g_type:
                map_type = "line"

            layers.append({
                "id": row["id"],
                "name": row["name"],
                "type": map_type,
            })

    return layers


# ---------------------------------------------------------------------------
# 2. METADATOS DE UNA CAPA (esquema 'metadatos')
# ---------------------------------------------------------------------------
async def get_layer_metadata(pool, table_name: str):
    """
    Busca los metadatos de una capa en el esquema 'metadatos'.

    Estructura esperada:
        metadatos.metadata_capa          (1 registro por capa)
        metadatos.metadata_campo         (1:N)
        metadatos.metadata_contacto      (1:N)
        metadatos.metadata_enlace        (1:N)
        metadatos.metadata_palabra_clave (1:N)

    El parámetro `table_name` se compara contra:
        - metadata_capa.identificador
        - metadata_capa.nombre_tabla_capa

    Devuelve un dict con la cabecera + listas anidadas, o None si:
        - el esquema/tabla principal no existe
        - no hay registro para esa capa
    """
    async with pool.acquire() as connection:

        # 2.1 ¿Existe el esquema/tabla principal?
        table_exists = await connection.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'metadatos'
                  AND table_name   = 'metadata_capa'
            );
            """
        )
        if not table_exists:
            return None

        # 2.2 Cabecera: buscamos por identificador o por nombre de tabla
        capa = await connection.fetchrow(
            """
            SELECT *
            FROM metadatos.metadata_capa
            WHERE identificador     = $1
               OR nombre_tabla_capa = $1
            LIMIT 1;
            """,
            table_name,
        )
        if capa is None:
            return None

        metadata_id = capa["id"]

        # 2.3 Tablas hijas (1:N)
        campos = await connection.fetch(
            """
            SELECT nombre, tipo, nulos, unicos, ejemplo
            FROM metadatos.metadata_campo
            WHERE metadata_id = $1
            ORDER BY id;
            """,
            metadata_id,
        )

        contactos = await connection.fetch(
            """
            SELECT nombre, rol, organizacion, posicion, correo_electronico,
                   voz, fax, direccion, tipo, codigo_postal, ciudad,
                   area_administrativa, pais
            FROM metadatos.metadata_contacto
            WHERE metadata_id = $1
            ORDER BY id;
            """,
            metadata_id,
        )

        enlaces = await connection.fetch(
            """
            SELECT nombre, tipo, url, descripcion, formato, mime, tamano
            FROM metadatos.metadata_enlace
            WHERE metadata_id = $1
            ORDER BY id;
            """,
            metadata_id,
        )

        palabras_clave = await connection.fetch(
            """
            SELECT concepto, palabra
            FROM metadatos.metadata_palabra_clave
            WHERE metadata_id = $1
            ORDER BY id;
            """,
            metadata_id,
        )

        # 2.4 Ensamblamos el resultado final
        result = dict(capa)
        result["campos"]         = [dict(r) for r in campos]
        result["contactos"]      = [dict(r) for r in contactos]
        result["enlaces"]        = [dict(r) for r in enlaces]
        result["palabras_clave"] = [dict(r) for r in palabras_clave]

        return result


# ---------------------------------------------------------------------------
# 3. GEOJSON DE UNA TABLA GEOGRÁFICA
# ---------------------------------------------------------------------------
async def get_table_geojson(pool, table_name: str):
    """Devuelve todos los registros de una tabla geográfica como GeoJSON FeatureCollection."""

    # Validamos que la tabla exista en geometry_columns para evitar inyección SQL
    check_query = """
        SELECT f_geometry_column, f_table_name
        FROM geometry_columns
        WHERE f_table_schema = 'public' AND f_table_name = $1;
    """

    async with pool.acquire() as connection:
        table_info = await connection.fetchrow(check_query, table_name)

        if table_info is None:
            return None  # tabla no existe o no es geográfica

        geom_column = table_info["f_geometry_column"]

        # Traemos todas las columnas de la tabla + la geometría convertida a GeoJSON
        # Usamos json_build_object con ST_AsGeoJSON para armar el FeatureCollection
        # directamente en SQL.
        data_query = f"""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            )
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON({geom_column})::jsonb,
                    'properties', to_jsonb(t) - '{geom_column}'
                ) AS feature
                FROM "{table_name}" AS t
            ) AS features;
        """

        row = await connection.fetchval(data_query)
        return row