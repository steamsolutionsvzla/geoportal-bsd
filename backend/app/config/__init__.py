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

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    model_config = SettingsConfigDict(
        env_file=None,  # Desactiva la búsqueda obligatoria de archivo físico y lee del entorno del sistema
        extra="ignore"
    )

settings = Settings()