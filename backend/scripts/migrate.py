# scripts/migrate.py — Aplica backend/migrations/*.sql en orden.
#
# Uso (con el .env/config del backend disponible):
#   python scripts/migrate.py
#
# Cada archivo se ejecuta una sola vez (tabla `schema_migrations`). Aun así,
# las migraciones se escriben idempotentes (IF NOT EXISTS) por seguridad.
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import asyncpg  # noqa: E402

from app.config import settings  # noqa: E402

MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parents[1] / "migrations"

_CONTROL_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


async def main() -> None:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("No hay migraciones en", MIGRATIONS_DIR)
        return

    conn = await asyncpg.connect(settings.DATABASE_URL)
    try:
        await conn.execute(_CONTROL_DDL)
        applied = {r["name"] for r in await conn.fetch("SELECT name FROM schema_migrations")}
        for f in files:
            if f.name in applied:
                print(f"[skip]  {f.name} (ya aplicada)")
                continue
            async with conn.transaction():
                sql = f.read_text(encoding="utf-8")
                await conn.execute(sql)
                await conn.execute("INSERT INTO schema_migrations (name) VALUES ($1);", f.name)
            print(f"[ok]    {f.name}")
        print("Migraciones al día.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
