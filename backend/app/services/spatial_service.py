import json
from fastapi import HTTPException
from app.db.session import get_db_connection

class SpatialService:

    @staticmethod
    async def get_layer_geojson(table_name: str = "Limite_FPO_2012", geom_column: str = "geom"):
        conn = await get_db_connection()
        try:
            if "." in table_name:
                schema, table = table_name.split(".", 1)
                table_identifier = f'"{schema}"."{table}"'
            else:
                table_identifier = f'"{table_name}"'

            query = f"""
                SELECT jsonb_build_object(
                    'type',    'FeatureCollection',
                    'features', coalesce(jsonb_agg(features.feature), '[]'::jsonb)
                )
                FROM (
                SELECT jsonb_build_object(
                    'type',      'Feature',
                 'geometry', ST_AsGeoJSON(ST_Transform(geom, 4326), 6, 0)::jsonb,
                    'properties', to_jsonb(inputs) - '{geom_column}'
                ) AS feature
                FROM (SELECT * FROM {table_identifier}) AS inputs
                ) AS features;
            """
            
            result = await conn.fetchval(query)
            
            if not result:
                return {"type": "FeatureCollection", "features": []}
                
            # Retornar siempre como un diccionario limpio de Python
            return result if isinstance(result, dict) else json.loads(result)

        except Exception as e:
            print(f"ERROR EN POSTGIS: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Error al consultar la capa: {str(e)}")
        finally:
            await conn.close()