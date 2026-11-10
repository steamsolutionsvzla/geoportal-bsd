-- ============================================================
-- 0003_showroom_org_editor.sql
-- Registra el nombre del último usuario que editó la
-- organización general de Showroom.
-- ============================================================
ALTER TABLE user_layer_folders
    ADD COLUMN IF NOT EXISTS updated_by TEXT;
