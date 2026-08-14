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

    colors = ['#f44336', '#9c27b0', '#673ab7', '#3ab7ad', '#3f51b5', '#ff9800', '#4caf50', '#2196f3', '#e91e63', '#ffeb3b']

    async with pool.acquire() as connection:
        rows = await connection.fetch(query)

        layers = []
        for i, row in enumerate(rows):
            g_type = row['geom_type']
            map_type = 'circle'
            if 'polygon' in g_type:
                map_type = 'fill'
            elif 'line' in g_type:
                map_type = 'line'

            layers.append({
                "id": row['id'],
                "name": row['name'],
                "type": map_type,
                "color": colors[i % len(colors)]
            })

    return layers

async def get_layer_metadata(pool, table_name: str):
    """
    Busca los metadatos de una capa específica en la tabla qgis_layer_metadata.
    Devuelve None si la tabla de metadatos no existe o si la capa no tiene
    un registro de metadatos asociado.
    """
    async with pool.acquire() as connection:
        # 1. Verificar que la tabla de metadatos exista en el esquema public
        table_exists = await connection.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'qgis_layer_metadata'
            );
            """
        )
        if not table_exists:
            return None

        # 2. Obtener las columnas reales de la tabla (nombre y tipo) para detectar
        #    cuál identifica el nombre de la capa, y para poder excluir columnas
        #    no representables como texto simple (geometría, xml, etc.)
        columns = await connection.fetch(
            """
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'qgis_layer_metadata'
            ORDER BY ordinal_position;
            """
        )
        column_names = [c['column_name'] for c in columns]
        column_types = {c['column_name']: (c['data_type'] or '').lower() for c in columns}

        candidates = [
            'f_table_name', 'table_name', 'layer_name',
            'tabla', 'capa', 'nombre_capa', 'layer'
        ]
        name_column = next((c for c in candidates if c in column_names), None)
        if not name_column:
            return None

        # 3. Excluir columnas técnicas/identificadores internos y columnas cuyo
        #    tipo no es representable como texto simple:
        #      - 'user-defined' -> normalmente el tipo `geometry` de PostGIS
        #        (ej. columna "extent"), vendría como WKB/hex ilegible.
        #      - 'xml' -> volcado crudo (ej. columna "qmd") con toda la info
        #        de la capa mezclada en texto plano, redundante con los demás
        #        campos ya estructurados.
        technical_columns = {
            'id', 'f_table_catalog', 'f_table_schema', 'f_table_name',
            'table_name', 'schema_name', 'uid', 'qmd', 'geom',
        }
        non_text_types = {'user-defined', 'xml'}
        select_columns = [
            c for c in column_names
            if c.lower() not in technical_columns
            and column_types.get(c, '') not in non_text_types
        ]
        if not select_columns:
            return None
        columns_sql = ', '.join(f'"{c}"' for c in select_columns)

        query = f"""
            SELECT {columns_sql}
            FROM public.qgis_layer_metadata
            WHERE "{name_column}" = $1
            LIMIT 1;
        """
        row = await connection.fetchrow(query, table_name)
        if row is None:
            return None
        return dict(row)


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

        geom_column = table_info['f_geometry_column']

        # Traemos todas las columnas de la tabla + la geometría convertida a GeoJSON
        # Usamos json_build_object con ST_AsGeoJSON para armar el FeatureCollection directamente en SQL
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