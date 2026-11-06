-- =====================================================================
-- dedupe_exact_dupes.sql — elimina filas EXACTAMENTE duplicadas (gemelas
-- completas: misma geometría Y todos los atributos iguales; típico residuo
-- de cargas ETL repetidas). Descubierto al diagnosticar el filtro de área:
-- p. ej. gis_showroom."Estaciones" tenía 330 filas para 110 registros
-- únicos (cada estación x3), haciendo que el polígono contara 18 al ver 6.
--
-- NO toca filas con atributos distintos aunque la geometría coincida.
-- Es DESTRUCTIVO: 1) corre primero el DRY-RUN, 2) haz pg_dump, 3) revisa
-- los NOTICE dentro de la transaccion antes de COMMIT.
-- =====================================================================

-- ---------- DRY-RUN (solo lectura): filas gemelas por tabla ----------
DO $$
DECLARE
    r record;
    c bigint;
BEGIN
    FOR r IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname IN ('gis_petroleo', 'gis_showroom')
    LOOP
        EXECUTE format(
            'SELECT count(*) FROM %I.%I a WHERE EXISTS (
                SELECT 1 FROM %I.%I b WHERE b.ctid < a.ctid AND (a.*) = (b.*))',
            r.schemaname, r.tablename, r.schemaname, r.tablename) INTO c;
        IF c > 0 THEN
            RAISE NOTICE 'DRY-RUN %.% : % filas gemelas (se borrarían)', r.schemaname, r.tablename, c;
        END IF;
    END LOOP;
END $$;

-- ---------- ELIMINACION ----------
BEGIN;

DO $$
DECLARE
    r     record;
    c     int;
    total int := 0;
BEGIN
    FOR r IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname IN ('gis_petroleo', 'gis_showroom')
    LOOP
        EXECUTE format(
            'WITH d AS (
                DELETE FROM %I.%I a USING %I.%I b
                WHERE a.ctid < b.ctid AND (a.*) = (b.*)
                RETURNING 1)
             SELECT count(*) FROM d',
            r.schemaname, r.tablename, r.schemaname, r.tablename) INTO c;
        IF c > 0 THEN
            RAISE NOTICE '%.% : % filas gemelas eliminadas', r.schemaname, r.tablename, c;
            total := total + c;
        END IF;
    END LOOP;
    RAISE NOTICE 'TOTAL eliminado: %', total;
END $$;

-- Revisa los NOTICE; si todo cuadra:
COMMIT;
-- Si algo no cuadra, descarta con:
-- ROLLBACK;
