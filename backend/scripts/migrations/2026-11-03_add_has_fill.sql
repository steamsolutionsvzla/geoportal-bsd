-- 2026-11-03
-- Agrega el control de relleno para capas de polígonos.
-- Ejecutar en petroleo_db y geoportal_db.

BEGIN;

ALTER TABLE public.layer_style_configs
  ADD COLUMN IF NOT EXISTS has_fill boolean NOT NULL DEFAULT true;

-- Nombres normalizados que usa petroleo_db.
UPDATE public.layer_style_configs
SET has_fill = false
WHERE layer_name IN (
  'Petróleo_y_gas:Bloques petroleros',
  'Territorio:División Político Territorial'
);

-- Nombre original que conserva geoportal_db para la capa de bloques.
UPDATE public.layer_style_configs
SET has_fill = false
WHERE layer_name = 'Petróleo_y_Gas:Bloques petroleros';

COMMIT;
