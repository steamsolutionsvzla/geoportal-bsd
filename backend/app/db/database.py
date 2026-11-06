import logging

import asyncpg

from app.config import settings

logger = logging.getLogger("app.db")

pool: asyncpg.Pool | None = None

# Las sesiones viven en la BD (sobreviven restarts y permiten >1 worker).
# Se crea de forma idempotente al conectar; DDL canónico en migrations/.
_DDL_AUTH_SESSIONS = """
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash  TEXT        PRIMARY KEY,
    profile     JSONB       NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
    ON auth_sessions (expires_at);
"""


async def connect_db():
    global pool
    if not settings.DB_PASSWORD:
        raise RuntimeError(
            "DB_PASSWORD no está definida: copia .env.example a .env y "
            "configura las credenciales antes de arrancar."
        )
    pool = await asyncpg.create_pool(
        dsn=settings.DATABASE_URL,
        min_size=1,
        max_size=10
    )
    async with pool.acquire() as conn:
        await conn.execute(_DDL_AUTH_SESSIONS)
    logger.info("Pool de base de datos listo (auth_sessions verificado).")


async def disconnect_db():
    global pool
    if pool:
        await pool.close()


def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("El pool de base de datos no ha sido inicializado.")
    return pool
