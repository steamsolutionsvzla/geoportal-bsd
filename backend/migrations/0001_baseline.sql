-- =====================================================================
-- 0001_baseline.sql — Esquema base del backend del Geoportal BSD
-- Idempotente (IF NOT EXISTS): seguro de ejecutar en BD existentes.
-- Incluye: capas de estilo, ficha de metadatos, carpetas por usuario y
-- sesiones de autenticación.
-- =====================================================================

-- ---------- Estilos de capa (globales, una fila por capa) ----------
CREATE TABLE IF NOT EXISTS layer_style_configs (
    layer_name         TEXT PRIMARY KEY,
    fill_color         TEXT,
    stroke_color       TEXT,
    opacity            DOUBLE PRECISION,
    line_width         DOUBLE PRECISION,
    has_fill           BOOLEAN NOT NULL DEFAULT TRUE,
    min_zoom           DOUBLE PRECISION,
    max_zoom           DOUBLE PRECISION,
    visible_attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
    attribute_labels   JSONB NOT NULL DEFAULT '{}'::jsonb,
    show_labels        BOOLEAN NOT NULL DEFAULT FALSE,
    label_attribute    TEXT,
    label_color        TEXT,
    updated_by         TEXT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Metadatos por capa (esquema `metadatos`) ----------
CREATE SCHEMA IF NOT EXISTS metadatos;

CREATE TABLE IF NOT EXISTS metadatos.metadata_capa (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    identificador      TEXT UNIQUE NOT NULL,
    titulo             TEXT,
    tipo               TEXT DEFAULT 'dataset',
    idioma             TEXT DEFAULT 'ES',
    resumen            TEXT,
    categorias_iso     JSONB DEFAULT '[]'::jsonb,
    palabras_clave     JSONB DEFAULT '[]'::jsonb,
    cuotas             TEXT,
    licencias          TEXT,
    derechos           TEXT,
    restricciones      TEXT,
    crs_epsg           INTEGER,
    crs_nombre         TEXT,
    crs_wkt            TEXT,
    bbox_norte         DOUBLE PRECISION,
    bbox_sur           DOUBLE PRECISION,
    bbox_este          DOUBLE PRECISION,
    bbox_oeste         DOUBLE PRECISION,
    z_maxima           DOUBLE PRECISION,
    z_minima           DOUBLE PRECISION,
    historial          TEXT,
    esquema_capa       TEXT,
    nombre_tabla_capa  TEXT,
    archivo_origen     TEXT,
    num_entidades      INTEGER,
    tipo_geometria     TEXT,
    num_campos         INTEGER,
    fecha_carga        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metadatos.metadata_campo (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    metadata_id  BIGINT NOT NULL REFERENCES metadatos.metadata_capa(id) ON DELETE CASCADE,
    nombre       TEXT,
    tipo         TEXT,
    nulos        BOOLEAN,
    unicos       BOOLEAN,
    ejemplo      TEXT
);

CREATE TABLE IF NOT EXISTS metadatos.metadata_contacto (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    metadata_id         BIGINT NOT NULL REFERENCES metadatos.metadata_capa(id) ON DELETE CASCADE,
    nombre              TEXT,
    rol                 TEXT,
    organizacion        TEXT,
    posicion            TEXT,
    correo_electronico  TEXT,
    voz                 TEXT,
    fax                 TEXT,
    direccion           TEXT,
    tipo                TEXT,
    codigo_postal       TEXT,
    ciudad              TEXT,
    area_administrativa TEXT,
    pais                TEXT
);

CREATE TABLE IF NOT EXISTS metadatos.metadata_enlace (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    metadata_id  BIGINT NOT NULL REFERENCES metadatos.metadata_capa(id) ON DELETE CASCADE,
    nombre       TEXT,
    tipo         TEXT,
    url          TEXT,
    descripcion  TEXT,
    formato      TEXT,
    mime         TEXT,
    tamano       TEXT
);

CREATE TABLE IF NOT EXISTS metadatos.metadata_palabra_clave (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    metadata_id  BIGINT NOT NULL REFERENCES metadatos.metadata_capa(id) ON DELETE CASCADE,
    concepto     TEXT,
    palabra      TEXT
);

-- ---------- Carpetas de capas personales (geoportal) ----------
CREATE TABLE IF NOT EXISTS user_layer_folders (
    usuario_id  TEXT        PRIMARY KEY,
    folders     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Sesiones de autenticación (backend → Postgres) ----------
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash  TEXT        PRIMARY KEY,
    profile     JSONB       NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
    ON auth_sessions (expires_at);
