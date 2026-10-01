from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PORT: int = 8000
    HOST: str = "127.0.0.1"
    DEBUG: bool = True

    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 5433
    DB_NAME: str = "petroleo_db"
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "0907"

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
    # Odoo / Geoportal: el backend hace de proxy hacia Odoo.
    # -------------------------------------------------------------------
    ODOO_URL: str = "https://bsd.steamsolutions.tech"
    ODOO_DB: str = "bsd"          # 👈 ESTA LÍNEA ES LA QUE FALTABA
    AUTH_MOCK: bool = False       # SOLO desarrollo local. Nunca true en producción.

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    model_config = SettingsConfigDict(
        env_file=".env",          # 👈 ahora sí lee tu .env
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()