from typing import List

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PORT: int = 8000
    HOST: str = "127.0.0.1"
    # Sin defaults inseguros: DEBUG y las credenciales vienen SIEMPRE del .env.
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    # Archivo de log rotativo opcional (10 MB × 5). Vacío = solo stdout
    # (capturado y rotado por Docker). Ej: /app/storage/logs/app.log
    LOG_FILE: str = ""

    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 5433
    DB_NAME: str = "petroleo_db"
    DB_USER: str = "postgres"
    DB_PASSWORD: str = ""

    # Orígenes permitidos para CORS, separados por coma. El frontend y la API
    # se sirven del mismo dominio en producción; en dev usa el dev server de
    # Astro. Los endpoints no usan cookies (Bearer en header), por lo que no
    # se combina "*" con credenciales.
    CORS_ORIGINS: str = "http://localhost:4321"

    # -------------------------------------------------------------------
    # GeoServer: FastAPI actúa como intermediario, nunca el frontend habla
    # directo con GeoServer. Usuario/contraseña se leen de variables de
    # entorno (token) y no quedan hardcodeadas en el código.
    # -------------------------------------------------------------------
    GEOSERVER_URL: str = "http://geoserver:8080/geoserver"
    GEOSERVER_WORKSPACE: str = "geoportal"
    GEOSERVER_USER: str = ""
    GEOSERVER_PASSWORD: str = ""

    # -------------------------------------------------------------------
    # Rendimiento: caché de datos geográficos y catálogo de GeoServer.
    # GEODATA_CACHE_TTL=0 desactiva la caché de GeoJSON.
    # -------------------------------------------------------------------
    GEODATA_CACHE_TTL: float = 900.0      # segundos (15 min)
    GEODATA_CACHE_MAX_MB: int = 512       # tope de memoria para GeoJSON
    CATALOG_CACHE_TTL: float = 300.0      # segundos (5 min)
    # Gzip: solo se comprimen respuestas menores o iguales a este tamaño.
    # Las capas GeoJSON grandes viajan sin comprimir para no bloquear el backend.
    GZIP_MAX_MB: int = 20
    # Clasificación dinámica de capas pesadas (no depende del nombre).
    HEAVY_LAYER_MIN_FEATURES: int = 50000
    HEAVY_LAYER_MIN_MB: int = 20

    # -------------------------------------------------------------------
    # Odoo / Geoportal: el backend hace de proxy hacia Odoo.
    # -------------------------------------------------------------------
    ODOO_URL: str = ""
    ODOO_DB: str = "bsd"          # 👈 ESTA LÍNEA ES LA QUE FALTABA
    AUTH_MOCK: bool = False       # SOLO desarrollo local. Nunca true en producción.

    # -------------------------------------------------------------------
    # Descarga de archivos indexados (LAS/LIS/DLIS/SEG-Y) + Shapefiles.
    # -------------------------------------------------------------------
    # Carpeta de ZIPs temporales (relativa al WORKDIR o absoluta).
    DOWNLOAD_DIR: str = "storage/downloads"
    # Lote que se arma antes de responder (el resto va a job asíncrono).
    DOWNLOAD_SYNC_MAX_FILES: int = 20
    DOWNLOAD_SYNC_MAX_LAYERS: int = 3
    DOWNLOAD_SYNC_MAX_MB: int = 500
    # Topes del job asíncrono.
    DOWNLOAD_MAX_FILES: int = 500
    DOWNLOAD_MAX_LAYERS: int = 50
    DOWNLOAD_MAX_GB: float = 20.0
    DOWNLOAD_MAX_CONCURRENT_JOBS: int = 3
    # Horas que se conserva un ZIP listo para descargar.
    DOWNLOAD_TTL_HOURS: int = 48
    # Minutos de validez de la URL firmada de descarga.
    DOWNLOAD_TICKET_MINUTES: int = 120

    # -------------------------------------------------------------------
    # Paquetes de datos (selecciones de archivos indexados guardadas en Odoo)
    # -------------------------------------------------------------------
    # Máximo de archivos indexados por paquete.
    DATA_PACKAGE_MAX_DOCS: int = 100000
    # A partir de este número Odoo construye el paquete en segundo plano.
    DATA_PACKAGE_SYNC_MAX_DOCS: int = 5000
    # Tiempo máximo de espera de la llamada a Odoo al crear el paquete.
    DATA_PACKAGE_TIMEOUT_SECONDS: int = 900

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @computed_field
    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in (self.CORS_ORIGINS or "").split(",") if o.strip()]

    model_config = SettingsConfigDict(
        env_file=".env",          # 👈 ahora sí lee tu .env
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()