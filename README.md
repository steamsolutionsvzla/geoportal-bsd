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

## Licencia / contacto

Proyecto interno Steam Solutions — Banco Soberano de Datos de Petróleo y Gas.
