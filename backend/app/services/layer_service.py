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