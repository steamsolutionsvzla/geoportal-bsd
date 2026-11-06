import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.layers import router as layers_router
from app.api.manager import router as manager_router
from app.api.organization import router as organization_router
from app.api.reports import router as reports_router
from app.api.showroom import router as showroom_router
from app.api.styles import router as styles_router
from app.config import settings
from app.db.database import connect_db, disconnect_db

# ---------------------------------------------------------------------
# Logging: todo (incl. uvicorn) fluye al logger raíz.
#  - Siempre stdout (docker lo captura; rotado vía el bloque logging de compose).
#  - Si LOG_FILE está definido, además archivo rotativo 10 MB × 5.
# ---------------------------------------------------------------------
_LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"


def _configurar_logging() -> None:
    nivel = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    fmt = logging.Formatter(_LOG_FORMAT)

    root = logging.getLogger()
    root.setLevel(nivel)
    stream = logging.StreamHandler()
    stream.setFormatter(fmt)
    root.handlers = [stream]

    if settings.LOG_FILE:
        try:
            Path(settings.LOG_FILE).parent.mkdir(parents=True, exist_ok=True)
            fileh = RotatingFileHandler(
                settings.LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
            )
            fileh.setFormatter(fmt)
            root.addHandler(fileh)
        except OSError:
            root.warning("LOG_FILE=%s no es escribible; se omite el log en archivo.", settings.LOG_FILE)

    # Evita duplicados: uvicorn añade handlers propios a sus logger.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True


_configurar_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await disconnect_db()

app = FastAPI(
    title="Geoportal API Backend",
    version="1.0.0",
    debug=settings.DEBUG,
    lifespan=lifespan,
    # Swagger/ReDoc/OpenAPI solo con DEBUG=True (nunca expuestos en producción).
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # La auth via Bearer en header (no cookies): sin credenciales cross-origin.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(layers_router)
app.include_router(manager_router)
app.include_router(showroom_router)
app.include_router(auth_router)
app.include_router(styles_router)
app.include_router(reports_router)
app.include_router(organization_router)

# ============================================================
# ENDPOINT DE CONFIGURACIÓN PARA EL FRONTEND
# ============================================================
@app.get("/api/config")
async def get_config():
    """
    Devuelve la configuración pública necesaria para el frontend,
    como la clave de MapTiler. 
    La clave se lee desde el archivo .env (settings.MAPTILER_KEY).
    """
    return {
        "MAPTILER_KEY": settings.MAPTILER_KEY  # Asegúrate de tener esta variable en app/config.py
    }

@app.get("/")
def health_check():
    return {"status": "ok", "message": "Geoportal API Backend activo"}

# ============================================================
# HEALTHCHECK (lo usa el healthcheck del Dockerfile)
# ============================================================
@app.get("/health")
def health():
    return {"status": "ok"}