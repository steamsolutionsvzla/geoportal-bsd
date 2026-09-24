# backend/Dockerfile

# ---------------------------------------------------------------
# Imagen base: Python slim (ligera)
# Vi en tus .pyc que usas Python 3.14, pero 3.14 es MUY nuevo y
# muchas librerías geoespaciales aún no tienen wheels.
# Recomiendo 3.12 que es estable y compatible con casi todo.
# Si necesitas 3.14, cambia la línea de abajo por: python:3.14-slim
# ---------------------------------------------------------------
FROM python:3.12-slim

# ---------------------------------------------------------------
# Variables de entorno para Python
# ---------------------------------------------------------------
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ---------------------------------------------------------------
# Dependencias del sistema necesarias para:
#  - psycopg2 / asyncpg (libpq-dev, gcc)
#  - shapely / fiona / geopandas (libgeos-dev, libgdal-dev, libproj-dev)
#  - Pillow (libjpeg-dev, zlib1g-dev)
# ---------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libgeos-dev \
    libgdal-dev \
    libproj-dev \
    libjpeg-dev \
    zlib1g-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------
# Directorio de trabajo dentro del contenedor
# ---------------------------------------------------------------
WORKDIR /app

# ---------------------------------------------------------------
# Instala dependencias de Python primero (mejor cache de capas)
# ---------------------------------------------------------------
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# ---------------------------------------------------------------
# Copia el código de la aplicación
# ---------------------------------------------------------------
COPY . .

# ---------------------------------------------------------------
# Crea carpeta storage por si el backend escribe archivos
# ---------------------------------------------------------------
RUN mkdir -p /app/storage/geojson /app/storage/json

# ---------------------------------------------------------------
# Puerto que expone el backend
# ---------------------------------------------------------------
EXPOSE 8000

# ---------------------------------------------------------------
# Healthcheck (opcional pero recomendado)
# Asume que tienes un endpoint /health en FastAPI
# Si no lo tienes, comenta o elimina esta sección
# ---------------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# ---------------------------------------------------------------
# Comando de arranque con uvicorn
# ---------------------------------------------------------------
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]