import asyncpg
from app.config import settings

pool: asyncpg.Pool | None = None

async def connect_db():
    global pool
    pool = await asyncpg.create_pool(
        dsn=settings.DATABASE_URL,
        min_size=1,
        max_size=10
    )

async def disconnect_db():
    global pool
    if pool:
        await pool.close()

def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("El pool de base de datos no ha sido inicializado.")
    return pool