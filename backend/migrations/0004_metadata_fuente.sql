-- Fuente/procedencia de la capa en el diccionario de metadatos.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'metadatos' AND table_name = 'metadata_capa'
    ) THEN
        ALTER TABLE metadatos.metadata_capa
            ADD COLUMN IF NOT EXISTS fuente text;

        UPDATE metadatos.metadata_capa
           SET fuente = 'Datos heredados'
         WHERE fuente IS NULL OR trim(fuente) = '';
    END IF;
END $$;
