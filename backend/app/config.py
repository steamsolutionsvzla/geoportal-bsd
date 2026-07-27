from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PORT: int = 8000
    HOST: str = "127.0.0.1"
    DEBUG: bool = True

    DB_HOST: str = "10.100.0.1"
    DB_PORT: int = 5432
    DB_NAME: str = "geoportal_db"
    DB_USER: str = "odoo"
    DB_PASSWORD: str = "odoo@2026_postgis"

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    model_config = SettingsConfigDict(
        env_file=None,  # Desactiva la búsqueda obligatoria de archivo físico y lee del entorno del sistema
        extra="ignore"
    )

settings = Settings()