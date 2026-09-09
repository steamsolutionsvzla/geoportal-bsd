# app/config.py
import os

class Settings:
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"
    # Otras variables que ya tengas...
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "5433")
    DB_NAME = os.getenv("DB_NAME", "petroleo_db")
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "0907")
    DATABASE_URL = os.getenv("DATABASE_URL", f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}")
    
    GEOSERVER_URL = os.getenv("GEOSERVER_URL", "http://geoserver:8080/geoserver")
    GEOSERVER_WORKSPACE = os.getenv("GEOSERVER_WORKSPACE", "Petroleros")
    GEOSERVER_USER = os.getenv("GEOSERVER_USER", "admin")
    GEOSERVER_PASSWORD = os.getenv("GEOSERVER_PASSWORD", "changeme")

 