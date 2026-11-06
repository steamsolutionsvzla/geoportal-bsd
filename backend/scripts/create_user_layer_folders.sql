-- user_layer_folders: carpetas de capas personales por usuario (geoportal).
-- Ejecutar en PostGIS/Postgres de petroleo_db antes de usar /api/v1/organization.
CREATE TABLE IF NOT EXISTS user_layer_folders (
    usuario_id  TEXT        PRIMARY KEY,
    folders     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- [{ "nombre": "Perforación", "capas": ["ws:pozos", "ws:poz os_iny"] }, ...]
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
