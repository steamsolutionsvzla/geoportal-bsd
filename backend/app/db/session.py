import asyncpg
from app.config import settings

async def get_db_connection():
    """
    Crea y retorna una conexión asíncrona con la base de datos PostGIS.
    """
    return await asyncpg.connect(settings.DATABASE_URL)