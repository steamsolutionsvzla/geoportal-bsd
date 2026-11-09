# app/services/settings_service.py
# Lectura/escritura de la configuración persistida en app_settings.
import json
import logging
from typing import Any

logger = logging.getLogger("app.services.settings")


async def get_setting(pool, key: str, default: Any = None) -> Any:
    """Devuelve el valor de `key` (JSONB) o `default` si no existe."""
    try:
        raw = await pool.fetchval("SELECT value FROM app_settings WHERE key = $1;", key)
    except Exception as exc:
        logger.debug("app_settings no disponible (%s): %s", key, exc)
        return default
    if raw is None:
        return default
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return default
    return raw


async def set_setting(pool, key: str, value: Any) -> None:
    """Upsert de una clave de configuración."""
    await pool.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
        """,
        key,
        json.dumps(value, ensure_ascii=False),
    )
