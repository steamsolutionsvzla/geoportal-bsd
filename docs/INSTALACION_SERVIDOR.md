# Guía de instalación en servidor — Geoportal BSD

> Rama de despliegue: **`develop-bsd`**  
> Sistema recomendado: **Ubuntu Server 22.04 / 24.04 LTS**  
> Fecha de referencia: octubre 2026

---

## 1. Arquitectura que se va a instalar

```text
Internet
  │
  └── Nginx (80/443)  ── sirve  frontend/dist  (Astro estático)
        ├── /api/       ──proxy──> 127.0.0.1:8000   (contenedor backend-geoportal · FastAPI)
        └── /geoserver/ ──proxy──> 127.0.0.1:8081   (contenedor geoserver-bsd)

backend (contenedor)
  ├── PostgreSQL/PostGIS del host ......... DB_HOST:DB_PORT
  ├── GeoServer ........................... http://geoserver-bsd:8080/geoserver
  └── Odoo (login) ........................ ODOO_URL/api/geoportal/v1/login

geoserver (contenedor)
  └── PostgreSQL/PostGIS del host ......... JNDI jdbc/PostGISDB
```

Servicios Docker:

| Servicio | Contenedor | Puerto host (por defecto) | Archivo compose |
|---|---|---|---|
| Backend FastAPI | `backend-geoportal` | `127.0.0.1:8000` | `docker-compose.yml` |
| GeoServer | `geoserver-bsd` | `127.0.0.1:8081` | `geoserver/docker-compose.yml` |
| PostgreSQL/PostGIS | fuera de Docker | `5433` | instalación del sistema |

> Los puertos 8000, 8081 y 5433 **no deben abrirse a Internet**. Nginx es el único punto público (80/443).

---

## 2. Requisitos del servidor

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8–16 GB |
| Disco | 40 GB | 80 GB (los datos de GeoServer pesan ~2,5 GB) |
| SO | Ubuntu 22.04 | Ubuntu 24.04 |
| Docker | 24+ | última estable |
| Node.js | 22.12+ | 22 LTS |
| PostgreSQL | 15 | 16 + PostGIS 3 |

Puertos públicos: **22 (SSH), 80 (HTTP), 443 (HTTPS)**.  
Dominio apuntando al servidor (ej. `geoportal.ejemplo.com`).  
Acceso al endpoint de login de Odoo.

---

## 3. Archivos y líneas exactas que se deben editar

> Las rutas son relativas a la raíz del repositorio. Los números de línea corresponden a la rama `develop-bsd`.
> Los archivos reales `docker-compose.yml`, `geoserver/docker-compose.yml` y `.env` **no se versionan**; se crean copiando los `.example`.

### 3.1 `.env` (se crea desde `.env.example`)

| Línea | Variable | Qué poner |
|---|---|---|
| 11 | `PORT` | Puerto interno del backend. Dejar `8000`. |
| 12 | `HOST` | `0.0.0.0` dentro de Docker. |
| 13 | `DEBUG` | `False` en producción. |
| 14 | `BACKEND_PORT` | Puerto del host para el backend (por defecto `8000`). |
| 17 | `BIND_ADDR` | `127.0.0.1` para que solo Nginx acceda. |
| 22 | `DB_HOST` | `host.docker.internal` si PostgreSQL está en el host. |
| 23 | `DB_PORT` | Puerto de PostgreSQL (el proyecto usa `5433`). |
| 24 | `DB_NAME` | Nombre de la base (por defecto `petroleo_db`). |
| 25 | `DB_USER` | Usuario de la base. |
| 26 | `DB_PASSWORD` | **Cambiar** por una clave fuerte. |
| 29 | `GEOSERVER_URL` | `http://geoserver-bsd:8080/geoserver` (nombre del contenedor). |
| 30 | `GEOSERVER_USER` | Usuario admin de GeoServer (por defecto `admin`). |
| 31 | `GEOSERVER_PASSWORD` | **Cambiar** por una clave fuerte. |
| 32 | `GEOSERVER_WORKSPACE` | Workspace principal (`Petróleo_y_gas`). |
| 33 | `GEOSERVER_PORT` | Puerto del host para GeoServer (`8081`). Solo aplica si se levanta GeoServer con `--env-file ../.env`. |
| 34 | `GEOSERVER_JNDI_NAME` | `jdbc/PostGISDB` (debe coincidir con el store de GeoServer). |
| 38 | `ODOO_URL` | URL base de Odoo, sin `/` final. |
| 39 | `ODOO_DB` | Nombre de la base de Odoo (`X-Odoo-Database`). |
| 41 | `AUTH_MOCK` | **`False` en producción**. |
| 44 | `MAPTILER_KEY` | Opcional; solo si se usa `GET /api/config`. |

### 3.2 `docker-compose.yml` (se crea desde `docker-compose.example.yml`)

| Línea | Parámetro | Qué poner |
|---|---|---|
| 22 | `ports` | `${BIND_ADDR}:${BACKEND_PORT}:8000`. |
| 26–30 | Variables `DB_*` | Se leen del `.env`. |
| 31 | `DATABASE_URL` | Se arma automáticamente con las variables anteriores. |
| 32–35 | Variables `GEOSERVER_*` | Se leen del `.env`. |
| 36–40 | `MAPTILER_KEY`, `ODOO_*`, `AUTH_MOCK`, `DEBUG` | Se leen del `.env`. |
| 45 | `volumes` | `./backend/storage:/app/storage`. |
| 49–52 | `networks` | Red externa `geoportal-net`. |

### 3.3 `geoserver/docker-compose.yml` (se crea desde `geoserver/docker-compose.example.yml`)

| Línea | Parámetro | Qué poner |
|---|---|---|
| 14 | `image` | Versión de GeoServer (`docker.osgeo.org/geoserver:3.0.1`). |
| 19 | `ports` | `127.0.0.1:8081:8080` (o `${BIND_ADDR}:${GEOSERVER_PORT}:8080` con `--env-file ../.env`). |
| 21–22 | Admin GeoServer | Usuario y clave del administrador. |
| 24–30 | `POSTGRES_*` | Host, puerto, base, usuario, clave y JNDI. **Deben coincidir con el `.env`**. |
| 33 | `volumes` | `./geoserver_data:/opt/geoserver_data`. |
| 39–42 | `networks` | Red externa `geoportal-net`. |

### 3.4 `frontend/nginx.conf.example` → `/etc/nginx/sites-available/geoportal-bsd`

| Línea | Parámetro | Qué poner |
|---|---|---|
| 13 | `server_name` | Dominio real (ej. `geoportal.ejemplo.com`). |
| 16 | `root` | Carpeta del build (`/var/www/geoportal-bsd` o `.../frontend/dist`). |
| 23 | `proxy_pass` (API) | `http://127.0.0.1:8000` (o el `BACKEND_PORT`). |
| 34 | `proxy_pass` (GeoServer) | `http://127.0.0.1:8081/geoserver/` (o el `GEOSERVER_PORT`). |

### 3.5 Configuración del frontend

| Archivo | Línea | Parámetro | Qué poner |
|---|---|---|---|
| `frontend/astro.config.mjs` | 5 | `site` | URL pública final (`https://geoportal.ejemplo.com`). |
| `frontend/astro.config.mjs` | 18 | proxy `/api` | Solo desarrollo (`localhost:8000`). En producción lo resuelve Nginx. |
| `frontend/astro.config.mjs` | 23 | proxy `/geoserver` | Solo desarrollo (`localhost:8081`). |
| `frontend/src/scripts/map-config.js` | 20 | `CARTO_KEY` | Clave de CARTO para el mapa base claro (o dejar vacío para usar OSM). |
| `frontend/src/scripts/map-config.js` | 31 | `USE_OFFLINE_TILES` | `false` para mapas online; `true` para tiles offline. |
| `frontend/src/scripts/map-config.js` | 37 | `INITIAL_CENTER` | Centro inicial `[lng, lat]`. |
| `frontend/src/scripts/map-config.js` | 38 | `INITIAL_ZOOM` | Zoom inicial (5 para Venezuela). |
| `frontend/src/scripts/map-config.js` | 41 | `MAP_BOUNDS` | Límites de navegación `[[oeste,sur],[este,norte]]`. |
| `frontend/src/scripts/layer-manager.js` | 76–78 | `PUBLIC_GEOSERVER_URL` | Si **no** se proxyfica `/geoserver/`, definir esta variable de build (`frontend/.env`). |

> Si `USE_OFFLINE_TILES = true`, los archivos `clara.pmtiles` y `satelite.pmtiles` deben existir en
> `frontend/public/tiles/` (no se versionan). Se generan con `frontend/scripts/generate-offline-tiles.py`.

### 3.6 Configuración del backend

| Archivo | Línea | Parámetro | Qué poner |
|---|---|---|---|
| `backend/app/config/__init__.py` | 6–32 | Valores por defecto | **No hace falta editar**: el `.env` los sobrescribe. |
| `backend/app/config/__init__.py` | 40 | `env_file` | `.env` (dejar así). |
| `backend/app/api/manager.py` | 22 | `LICENSES_LAYER` | Capa de GeoServer del dashboard gerencial (`Gerencia:licencias`). |
| `backend/app/api/manager.py` | 106 | `role_guard` | Rol autorizado (`Rol.GERENTE`). |
| `backend/app/services/geoserver_service.py` | 28 | `HIDDEN_CATALOG_WORKSPACES` | Workspaces que no salen en el catálogo (`gerencia`). |
| `backend/app/services/session_service.py` | 25–31 | `_ROLE_ALIASES` | Traducción de roles de Odoo a `Administrador`, `Rol_gerente`, `Rol_analista`. |
| `backend/app/api/auth.py` | 39 | URL de login Odoo | `{ODOO_URL}/api/geoportal/v1/login`. |
| `backend/app/api/auth.py` | 45 | Cabecera Odoo | `X-Odoo-Database: {ODOO_DB}`. |
| `backend/Dockerfile` | 10 | `FROM` | Python `3.12-slim` (recomendado). |
| `backend/Dockerfile` | 62 | `EXPOSE` | `8000`. |
| `backend/Dockerfile` | 75 | `CMD` | Uvicorn en `0.0.0.0:8000`. |
| `frontend/package.json` | 6 | `engines.node` | `>=22.12.0`. |

> `backend/app/api/config.py` es un archivo antiguo que **no se usa**. La configuración real es
> `backend/app/config/__init__.py`.

### 3.7 Scripts de datos

| Archivo | Línea | Parámetro | Qué poner |
|---|---|---|---|
| `backend/scripts/import_licencias_gerencia.py` | 24 | `SCHEMA` | `gis_gerencia`. |
| `backend/scripts/import_licencias_gerencia.py` | 25 | `TABLE` | `licencias`. |
| `backend/scripts/import_licencias_gerencia.py` | 183 | `--src` | Ruta del shapefile `LICENCIAS_2.shp`. |
| `backend/scripts/import_licencias_gerencia.py` | 184 | `--dsn` / `DATABASE_URL` | Cadena de conexión. |
| `backend/scripts/generar_metadatos_postgis.py` | 28 | `GEOSERVER_URL` | `http://geoserver-bsd:8080/geoserver` dentro de Docker. |
| `backend/scripts/generar_metadatos_postgis.py` | 29–30 | `GEOSERVER_USER` / `PASSWORD` | Credenciales del `.env`. |
| `backend/scripts/generar_metadatos_postgis.py` | 33–37 | `DB_CONFIG` | Host, puerto, usuario, clave y base. |
| `backend/scripts/generar_metadatos_postgis.py` | 41 | `TARGET_WORKSPACES` | `["Petróleo_y_gas", "Showroom"]`. |

---

## 4. Preparación del servidor

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ca-certificates ufw

# Docker + Compose v2
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker   # o cerrar y volver a entrar por SSH

docker --version
docker compose version

# Red que usan ambos compose (es external: true)
docker network create geoportal-net

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

> La red `geoportal-net` debe existir **antes** de `docker compose up`, porque los compose la declaran como externa.

---

## 5. PostgreSQL + PostGIS

### 5.1 Instalación

```bash
sudo apt install -y postgresql postgresql-contrib postgresql-16-postgis-3
```

> En Ubuntu 22.04 puede instalar PostgreSQL 14; en ese caso cambie `postgresql-16-postgis-3`
> por la versión disponible o agregue el repositorio oficial de PostgreSQL (PGDG).

### 5.2 Puerto 5433 y escucha en la red de Docker

Los números de línea de `postgresql.conf` cambian según la versión. Localícelos con:

```bash
sudo grep -n "^#\?listen_addresses" /etc/postgresql/16/main/postgresql.conf
sudo grep -n "^#\?port" /etc/postgresql/16/main/postgresql.conf
```

Edite esas líneas (normalmente ~60 y ~64):

```conf
listen_addresses = '*'      # o 'localhost,172.18.0.1' si conoce la IP del puente
port = 5433
```

### 5.3 Permitir la red de Docker en `pg_hba.conf`

```bash
docker network inspect geoportal-net -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
# ejemplo: 172.18.0.0/16
```

Añada al final de `/etc/postgresql/16/main/pg_hba.conf` (la línea exacta depende del archivo):

```conf
host    all             all             172.18.0.0/16           scram-sha-256
host    all             all             172.17.0.0/16           scram-sha-256
```

Reinicie:

```bash
sudo systemctl restart postgresql
sudo systemctl status postgresql
```

### 5.4 Crear base, usuario y PostGIS

```bash
sudo -u postgres psql -p 5433 <<'SQL'
CREATE USER geoportal WITH PASSWORD 'CAMBIA_ESTA_CLAVE';
CREATE DATABASE petroleo_db OWNER geoportal;
\c petroleo_db
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS gis_petroleo AUTHORIZATION geoportal;
CREATE SCHEMA IF NOT EXISTS gis_showroom AUTHORIZATION geoportal;
CREATE SCHEMA IF NOT EXISTS gis_gerencia AUTHORIZATION geoportal;
CREATE SCHEMA IF NOT EXISTS metadatos AUTHORIZATION geoportal;
SQL
```

> Si va a restaurar un respaldo existente, use el mismo rol dueño del respaldo original
> (`postgres` normalmente) o `pg_restore --no-owner`. En ese caso ajuste `DB_USER` en `.env`.

### 5.5 Probar la conexión

```bash
psql "postgresql://geoportal:CAMBIA_ESTA_CLAVE@127.0.0.1:5433/petroleo_db" -c "SELECT PostGIS_Version();"
```

---

## 6. Descargar el proyecto y crear los archivos de configuración

```bash
sudo mkdir -p /opt/geoportal-bsd
sudo chown "$USER":"$USER" /opt/geoportal-bsd
git clone -b develop-bsd https://github.com/steamsolutionsvzla/geoportal-bsd.git /opt/geoportal-bsd
cd /opt/geoportal-bsd

cp .env.example .env
chmod 600 .env

cp docker-compose.example.yml docker-compose.yml
cp geoserver/docker-compose.example.yml geoserver/docker-compose.yml
```

Edite `.env` con las líneas de la sección 3.1. Ejemplo mínimo:

> Use una contraseña sin caracteres `@ : / ? #`, porque se inserta en la URL
> `DATABASE_URL` (línea 31 del compose). Si necesita esos caracteres, codifíquela
> con URL-encoding.

```env
DB_HOST=host.docker.internal
DB_PORT=5433
DB_NAME=petroleo_db
DB_USER=geoportal
DB_PASSWORD=CAMBIA_ESTA_CLAVE

GEOSERVER_URL=http://geoserver-bsd:8080/geoserver
GEOSERVER_USER=admin
GEOSERVER_PASSWORD=CAMBIA_ESTA_CLAVE
GEOSERVER_WORKSPACE=Petróleo_y_gas
GEOSERVER_PORT=8081
GEOSERVER_JNDI_NAME=jdbc/PostGISDB

ODOO_URL=https://odoo.ejemplo.com
ODOO_DB=odoo_db
AUTH_MOCK=False
```

> `.env` y los `docker-compose.yml` están en `.gitignore`: nunca se suben al repositorio.

---

## 7. GeoServer

### 7.1 Datos de GeoServer

El repositorio **no** incluye `geoserver/geoserver_data` (≈2,5 GB, ignorado por Git). Tiene dos opciones:

**A. Restaurar los datos existentes** (recomendado: conserva workspaces, stores, estilos y capas):

```bash
rsync -av --info=progress2 /ruta/origen/geoserver_data/ \
  /opt/geoportal-bsd/geoserver/geoserver_data/
sudo chown -R 1000:1000 /opt/geoportal-bsd/geoserver/geoserver_data
```

**B. Configurar desde cero** en la consola de GeoServer:

1. Crear workspaces: `Petróleo_y_gas`, `Showroom`, `Gerencia`.
2. Crear un store PostGIS por workspace, con:
   - JNDI: `java:comp/env/jdbc/PostGISDB`
   - Esquemas: `gis_petroleo`, `gis_showroom`, `gis_gerencia`
3. Publicar las tablas como capas.
4. Para el dashboard gerencial, la capa debe llamarse `licencias` dentro del workspace `Gerencia`.
   Si usa otro nombre, edite `backend/app/api/manager.py` línea 22.

### 7.2 Levantar GeoServer

```bash
cd /opt/geoportal-bsd/geoserver
docker compose up -d
docker compose logs -f geoserver
```

> Las credenciales de PostgreSQL están escritas en `geoserver/docker-compose.yml` (líneas 24–30)
> y deben coincidir con el `.env`. Si cambia `BIND_ADDR` o `GEOSERVER_PORT` en `.env`, ejecute
> `docker compose --env-file ../.env up -d`; de lo contrario se usan los valores por defecto
> `127.0.0.1:8081`.

Compruebe:

```bash
curl -I http://127.0.0.1:8081/geoserver/web/
```

La consola queda escuchando solo en `127.0.0.1:8081`. Para abrirla desde su equipo:

```bash
ssh -L 8081:127.0.0.1:8081 usuario@servidor
# luego abra http://localhost:8081/geoserver/web/
```

Usuario/clave: los definidos en `.env` (`GEOSERVER_USER` / `GEOSERVER_PASSWORD`).

> **Importante si restaura `geoserver_data`:** las credenciales de GeoServer son las que ya
> tenía esa carpeta. `GEOSERVER_ADMIN_USER` / `GEOSERVER_ADMIN_PASSWORD` solo se aplican cuando
> GeoServer inicializa un directorio de datos vacío.

---

## 8. Backend

```bash
cd /opt/geoportal-bsd
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

Verificación:

```bash
curl http://127.0.0.1:8000/health
# {"status":"ok"}

curl http://127.0.0.1:8000/
# {"status":"ok","message":"Geoportal API Backend activo"}
```

> El backend conecta a PostgreSQL al arrancar (`app/db/database.py`). Si la base no está
> accesible, el contenedor entra en bucle de reinicio. Revise `DB_*` y `pg_hba.conf`.

---

## 9. Frontend y Nginx

### 9.1 Node.js y pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm@10

node -v    # >= 22.12
pnpm -v
```

### 9.2 Compilar

```bash
cd /opt/geoportal-bsd/frontend
pnpm install --frozen-lockfile
pnpm build
ls dist
```

> Si el frontend y GeoServer están en hosts distintos, cree `frontend/.env` antes del build:
> `PUBLIC_GEOSERVER_URL=https://geoserver.ejemplo.com/geoserver`
> (se lee en `frontend/src/scripts/layer-manager.js` líneas 76–78). Si usa el proxy `/geoserver/`
> de Nginx, no hace falta.

### 9.3 Publicar los archivos

```bash
sudo mkdir -p /var/www/geoportal-bsd
sudo rsync -a --delete /opt/geoportal-bsd/frontend/dist/ /var/www/geoportal-bsd/
sudo chown -R www-data:www-data /var/www/geoportal-bsd
```

### 9.4 Nginx

```bash
sudo apt install -y nginx
sudo cp /opt/geoportal-bsd/frontend/nginx.conf.example /etc/nginx/sites-available/geoportal-bsd
sudo ln -s /etc/nginx/sites-available/geoportal-bsd /etc/nginx/sites-enabled/geoportal-bsd
sudo rm -f /etc/nginx/sites-enabled/default

sudo nano /etc/nginx/sites-available/geoportal-bsd
# editar server_name (línea 13), root (16), proxy_pass (23 y 34)

sudo nginx -t
sudo systemctl reload nginx
```

### 9.5 HTTPS (recomendado)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d geoportal.ejemplo.com
```

Certbot agrega el bloque 443 y el redirect desde 80. No modifique el resto del archivo.

---

## 10. Carga de datos

### 10.1 Licencias del dashboard gerencial

El shapefile **no** se versiona. Cópielo al contenedor:

```bash
cd /opt/geoportal-bsd
docker compose cp /ruta/LICENCIAS_2 backend:/tmp/LICENCIAS_2

docker compose exec backend python scripts/import_licencias_gerencia.py \
  --src /tmp/LICENCIAS_2/LICENCIAS_2.shp
```

Variables tomadas del `.env` del contenedor (`DATABASE_URL`, `DB_*`). Debe terminar con
`Importados: N registros` y `Geometrías inválidas: 0`.

### 10.2 Metadatos de capas

```bash
docker compose exec \
  -e GEOSERVER_URL=http://geoserver-bsd:8080/geoserver \
  backend python scripts/generar_metadatos_postgis.py
```

Recorre los workspaces `Petróleo_y_gas` y `Showroom`, calcula bbox/campos y hace UPSERT en
`metadatos.metadata_capa`.

> El script **no crea** el esquema `metadatos` ni sus tablas: debe existir previamente
> (normalmente viene en el respaldo de la base). Si la base es nueva, restaure el dump
> antes de ejecutar este paso.

### 10.3 Roles de Odoo

El backend acepta los roles `Administrador`, `Rol_gerente` y `Rol_analista`
(`backend/app/models/user.py` líneas 5–8). Odoo debe devolver uno de esos valores en
`geoportal_roles[0].key`; los alias se traducen en `backend/app/services/session_service.py`
líneas 25–31.

---

## 11. Verificación final

| Comprobación | Comando / URL | Resultado esperado |
|---|---|---|
| Backend vivo | `curl http://127.0.0.1:8000/health` | `{"status":"ok"}` |
| Frontend | `https://geoportal.ejemplo.com/` | Landing del geoportal |
| Login | `/login` | Redirección a Odoo y vuelta |
| API a través de Nginx | `https://.../api/me` sin token | `401` (la ruta existe) |
| GeoServer | `https://.../geoserver/web/` | Consola (o 404 si se restringió) |
| Dashboard gerente | `/admin` con usuario `Rol_gerente` | Mapa, KPIs y gráficos |
| Capa gerencial | `/api/v1/manager/licenses` con token de gerente | `FeatureCollection` |

```bash
docker compose ps
docker compose logs --tail=100 backend
docker compose -f geoserver/docker-compose.yml logs --tail=100
sudo tail -f /var/log/nginx/error.log
```

---

## 12. Errores comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| Backend reiniciándose | PostgreSQL no accesible | Revisar `DB_*`, `listen_addresses`, `pg_hba.conf` y firewall. |
| `network geoportal-net not found` | Red externa no creada | `docker network create geoportal-net`. |
| Login 502 | Backend no alcanza Odoo | Probar `docker compose exec backend curl -I $ODOO_URL`. |
| Login 403 “Rol no reconocido” | Rol de Odoo distinto | Ajustar `_ROLE_ALIASES` (session_service.py 25–31). |
| Mapa sin capas | GeoServer no conecta a PostGIS | Revisar JNDI `jdbc/PostGISDB` y credenciales. |
| Dashboard gerente 403 | Usuario sin rol `Rol_gerente` | Asignar rol en Odoo. |
| `/geoserver` 404 | Nginx sin proxy o GeoServer caído | Revisar líneas 33–40 de nginx y `docker compose ps`. |
| Frontend sin estilos | Build no copiado a `root` | Repetir `pnpm build` y `rsync` a `/var/www/geoportal-bsd`. |
| `docker compose` no expande variables | `.env` ausente o mal ubicado | Debe estar en la raíz, junto al compose. |

---

## 13. Operación, actualización y respaldo

### Actualizar

```bash
cd /opt/geoportal-bsd
git pull origin develop-bsd

docker compose up -d --build
cd frontend && pnpm install --frozen-lockfile && pnpm build
sudo rsync -a --delete dist/ /var/www/geoportal-bsd/
cd .. && cd geoserver && docker compose up -d
cd ..
```

### Respaldo

```bash
# Base de datos
pg_dump -p 5433 -U geoportal -Fc petroleo_db > /backup/petroleo_db_$(date +%F).dump

# GeoServer (config + estilos)
tar czf /backup/geoserver_data_$(date +%F).tar.gz -C /opt/geoportal-bsd/geoserver geoserver_data

# Configuración
cp /opt/geoportal-bsd/.env /backup/env_$(date +%F).bak
```

### Seguridad mínima

- `DEBUG=False` y `AUTH_MOCK=False` en producción.
- Cambiar `DB_PASSWORD`, `GEOSERVER_PASSWORD` y la clave de `admin`.
- No abrir 8000, 8081 ni 5433 a Internet.
- HTTPS obligatorio.
- `chmod 600 .env`.
- Mantener `geoserver_data` y los respaldos fuera del repositorio.

---

## Anexo A. Árbol mínimo de archivos en el servidor

```text
/opt/geoportal-bsd/
├── .env                         (creado desde .env.example, NO versionado)
├── docker-compose.yml           (creado desde docker-compose.example.yml)
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   └── storage/
├── frontend/
│   ├── dist/                    (generado con pnpm build)
│   ├── src/
│   └── nginx.conf.example
└── geoserver/
    ├── docker-compose.yml       (creado desde docker-compose.example.yml)
    └── geoserver_data/          (≈2,5 GB, NO versionado)
```
