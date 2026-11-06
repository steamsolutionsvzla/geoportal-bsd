# Geoportal BSD

Geoportal del **Banco Soberano de Datos de Petróleo y Gas**: visualización de
capas geográficas con filtros (estado, bloque, área de análisis), metadatos por
capa, reportes PDF/Excel y descarga de shapefiles con metadatos (`.qmd`/`.xml`).

## Arquitectura

```
┌───────────────────┐        ┌────────────────────┐       ┌───────────────────┐
│ Frontend (Astro)  │  /api  │ Backend (FastAPI)  │ WFS/  │ GeoServer         │
│ static → nginx    │───────▶│  proxy + auth +    │──────▶│ (contenedor       │
│ /geoportal, /hub  │        │  reports, /styles  │       │  geoserver-bsd)   │
└───────────────────┘        └────────┬───────────┘       └───────────────────┘
     Login vía Odoo ◀─────────┐       │ asyncpg
                              ▼       ▼
                      ┌──────────┐ ┌─────────────────────┐
                      │ Odoo     │ │ PostGIS (puerto 5433│
                      │ (auth)   │ │  en el host)        │
                      └──────────┘ └─────────────────────┘
```

- El navegador **nunca habla con GeoServer**: el backend hace de proxy (WFS →
  GeoJSON/Shapefile) y resuelve CORS y credenciales.
- **Autenticación**: el backend valida el login contra Odoo (`/api/geoportal/v1/login`)
  y guarda la sesión en la tabla `auth_sessions` (hash del token). El frontend
  envía el token como `Authorization: Bearer` en cada petición.
- El **workspace visible por cada usuario** viene de Odoo; el backend lo aplica
  como filtro (`workspace_guard`) en capas, estilos, reportes y descargas.

## Requisitos

- Docker + Docker Compose, Python 3.12+, Node 22.12+ y pnpm 12+.
- PostGIS con la BD de capas corriendo en el host (puerto 5433 por defecto).
- GeoServer desplegado **aparte** en la red Docker `geoportal-net`, accesible
  como `http://geoserver-bsd:8080/geoserver` (sus datos y configuración viven
  fuera de este repo).

## Puesta en marcha (desarrollo)

```bash
# 0) Red Docker compartida (solo la primera vez)
docker network create geoportal-net

# 1) Variables de entorno
cp .env.example .env        # ¡rellena los valores! sobre todo DB_PASSWORD,
                            # GEOSERVER_* y ODOO_URL

# 2) Backend (FastAPI en :8000, http://localhost:8000/docs con DEBUG=True)
cd backend
python -m venv venv && venv/Scripts/activate      # Windows
pip install -r requirements-dev.txt
python scripts/migrate.py                          # crea el esquema si falta
uvicorn app.main:app --reload

# 3) Frontend (Astro en :4321, proxy /api → :8000)
cd ../frontend
pnpm install
pnpm dev
```

> Truco para desarrollo sin Odoo: `AUTH_MOCK=True` en `.env` autentica con los
> tokens fijos `mock-admin` / `mock-gerente` / `mock-analista`. **Nunca** activar
> en producción.

## Pruebas

```bash
cd backend
pip install -r requirements-dev.txt
pytest            # 20+ tests (reportes, organización, sidecars, validaciones)
```

El frontend no tiene batería de tests todavía; se valida con `pnpm build` (CI).

## Despliegue (producción)

```bash
git pull
# 1) Backend: imagen nueva + contenedor
docker compose build backend
docker compose up -d backend

# 2) Migraciones (idempotentes, con control de versiones)
docker compose exec backend python scripts/migrate.py

# 3) Frontend estático
cd frontend && pnpm install --frozen-lockfile && pnpm build
#   → servir dist/ desde nginx (proxy inverso /api → backend:8000)
```

Checklist de seguridad para producción (revisar `docker compose exec backend printenv`):

- [ ] `DEBUG=False` (oculta `/docs` y tracebacks)
- [ ] `AUTH_MOCK=False`
- [ ] `CORS_ORIGINS=https://<dominio-del-geoportal>` (sin `*`)
- [ ] `DB_PASSWORD`/`GEOSERVER_PASSWORD` fuertes y **distintos** de los de dev
- [ ] `.env` solo en el servidor (el repo únicamente publica `.env.example`)

## Estructura del repo

```
backend/
  app/
    api/         # routers: auth, layers, styles, reports, organization, showroom, manager
    services/    # geoserver (WFS→GeoJSON/SHP+sidecars), layer_service, session_service,
                 # metadata_export (.qmd/.xml), reports (ReportLab/openpyxl)
    db/          # pool asyncpg (auth_sessions se asegura al arrancar)
    config/      # Settings desde env/.env (sin credenciales hardcodeadas)
  migrations/    # *.sql idempotentes + schema_migrations
  scripts/       # migrate.py, generar_metadatos_postgis.py, import_licencias_gerencia.py
  tests/         # pytest (mockeando BD y auth)
frontend/
  src/pages/     # geoportal, showroom, admin, analista, hub, login
  src/scripts/   # main.js (mapa+buscador+carpetas), org-panel.js, filters.js,
                 # draw-tools.js, area-temporal.js, info-panel.js, layer-manager.js…
  src/styles/    # geoportal.css (tokens), org-panel.css, etc.
```

## Notas de operación

- **Logs del backend**: siempre a stdout (`docker compose logs -f backend`, rotados
  10 MB × 5 vía el driver json-file). Opcionalmente, con `LOG_FILE=/app/storage/logs/app.log`
  en el `.env` se escribe además un archivo rotativo (10 MB × 5) dentro del volumen
  `backend/storage/`, que sobrevive a recreaciones del contenedor.
- **Sesiones**: viven en Postgres → `docker compose restart backend` ya no
  desloguea a nadie y se pueden correr varios workers si hiciera falta.
- **Carpetas de capas**: son personales por usuario (`user_layer_folders`,
  clave = `usuario_id` de Odoo). Un usuario necesita volver a iniciar sesión
  tras desplegar esta función para que su perfil traiga el `usuario_id`.
- **Metadatos de capa** (`metadatos.metadata_capa`): se generan con
  `backend/scripts/generar_metadatos_postgis.py` y alimentan la ficha del
  panel y los sidecars `.qmd`/`.xml` de las descargas.
- **Reportes PDF/Excel**: se generan en el backend (ReportLab/openpyxl). No
  usar librerías que produzcan el PDF en el navegador: los antivirus corporativos
  marcaban los binarios de jsPDF como malware.

## Mapa base sin conexión (offline) y zoom profundo de Clara

**Importante (jun 2026): Esri retiró World_Terrain_Base.** Solo sirve teselas
reales **hasta z9**; de z10+ devuelve un placeholder gris. Por eso la vista
Clara es híbrida:

- **z5–9** → Esri World_Terrain_Base (el relieve beige actual).
- **z9+** → **CARTO light_nolabels** (capa `clara-deep`): detalle real hasta
  z18-20, mismo estilo limpio sin etiquetas ni fronteras. Requiere la clave
  pública de CARTO al compilar el frontend:

```bash
cp frontend/.env.example frontend/.env   # y pon PUBLIC_CARTO_KEY=<clave>
cd frontend && pnpm build
```
Sin clave, la capa profunda no se añade (Clara queda como hoy: relieve hasta
z9 y escalado más allá).

**Fondos offline (PMTiles, mismos proveedores que online):**

El geoportal puede servir los fondos **Clara / Satélite / Etiquetas** desde
archivos PMTiles locales, visualmente idénticos a los online (mismos
proveedores Esri), para LAN o equipos sin internet:

El build offline necesita los 4 archivos: `clara.pmtiles` (z5-9),
`clara-deep.pmtiles` (z9-12 nacional + zonas a 17), `satelite.pmtiles`
(z5-13) y `satelite-labels.pmtiles` (z5-13).

```bash
# 1) Generar los tiles (requiere internet UNA vez; reanudable si se corta)
cd frontend
py -m pip install pmtiles
py scripts/generate-offline-tiles.py --layers clara satelite satelite-labels

# Zoom profundo de Clara offline (CARTO; la clave sale de frontend/.env, de
# la variable CARTO_KEY o de --carto-key):
#   z9-14 nacional (~1.5-2 GB):
py scripts/generate-offline-tiles.py --layers clara-deep --minzoom 9 --maxzoom 14
#   y detalle z15-17 solo por zonas (ej. oriente):
py scripts/generate-offline-tiles.py --layers clara-deep \
    --bbox -64.8,8.4,-63.2,10.4 --minzoom 15 --maxzoom 17

# Opcional: zoom profundo de satélite solo para una zona (ej. el oriente):
py scripts/generate-offline-tiles.py --layers satelite satelite-labels \
    --bbox -64.8,8.4,-63.2,10.4 --minzoom 14 --maxzoom 16

# 2) Activar el modo offline: en frontend/.env pone
#    PUBLIC_OFFLINE_TILES=true   (sin editar código)

# 3) Compilar y servir dist/ normalmente.
pnpm build
```

Notas:
- Los datos vectoriales (capas, metadatos, login) siguen necesitando el
  backend (PostGIS/GeoServer/Odoo) en la LAN; lo offline son solo los fondos.
- `--layers`: `clara` (tope z9 por el retiro del servicio; ~8 MB), `satelite`
  (~8-12 GB z5-13), `satelite-labels` (~2-3 GB), `clara-deep` z9-14 nacional
  ~1.5-2 GB y z15-17 solo por zonas. Usa `--concurrency` bajo (8-16) en redes
  corporativas para no bloquearte.
- `public/tiles/` está gitignoreado: los PMTiles viajan a los servidores con
  el `dist/` o por copia manual.
- Por encima del máximo descargado, MapLibre escala los tiles (igual que hace
  hoy la fuente clara online al pasar de z13).

## Licencia / contacto

Proyecto interno Steam Solutions — Banco Soberano de Datos de Petróleo y Gas.
