# scripts/_run_create_user_layer_folders.py
# Ejecuta create_user_layer_folders.sql en la BD configurada en .env.
# Uso (desde backend/):  python scripts/_run_create_user_layer_folders.py
import asyncio
import os
import pathlib
import sys

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

import asyncpg  # noqa: E402

from app.config import settings  # noqa: E402


async def main():
    sql = (_ROOT / "scripts" / "create_user_layer_folders.sql").read_text(encoding="utf-8")
    # Si el .env apunta a host.docker.internal (Docker), desde el host usar localhost.
    dsn = settings.DATABASE_URL
    if os.environ.get("DB_HOST_LOCAL", "") == "1" or "host.docker.internal" in dsn:
        dsn = dsn.replace("host.docker.internal", "localhost")
    conn = await asyncpg.connect(dsn=dsn)
    try:
        await conn.execute(sql)
        ok = await conn.fetchval("SELECT to_regclass('user_layer_folders')::text")
        print("TABLA:", ok)
    finally:
        await conn.close()


asyncio.run(main())
