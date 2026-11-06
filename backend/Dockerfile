# backend/Dockerfile
# ---------------------------------------------------------------
# Imagen única sobre python:3.12-slim.
# Todas las dependencias de requirements.txt tienen wheels
# (asyncpg, pydantic_core, pillow, reportlab, bcrypt…), así que no
# hacen falta gcc ni las librerías -dev de GDAL/GEOS/PROJ: la imagen
# pasa de ~1.5 GB a ~200 MB y reduce la superficie de ataque.
# ---------------------------------------------------------------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# curl solo para el HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias primero (mejor cache de capas).
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# Código de la aplicación, corriendo como usuario sin privilegios.
RUN useradd --uid 1001 --no-create-home --user-group --shell /usr/sbin/nologin appuser
COPY . .
RUN mkdir -p /app/storage/geojson /app/storage/json \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
