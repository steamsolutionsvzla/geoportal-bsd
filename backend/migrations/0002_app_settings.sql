-- ============================================================
-- 0002_app_settings.sql — Configuración editable desde el panel.
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Capa que alimenta el dashboard gerencial (intercambiable sin redeploy).
INSERT INTO app_settings (key, value)
VALUES ('licenses_layer', '"Gerencia:licencias"'::jsonb)
ON CONFLICT (key) DO NOTHING;
