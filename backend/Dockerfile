# 1. Usar una imagen oficial y ligera de Python
FROM python:3.11-slim

# 2. Definir el directorio de trabajo dentro del contenedor
WORKDIR /app

# 3. Copiar e instalar las dependencias primero (para aprovechar el caché de Docker)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. Copiar el resto del código del proyecto al contenedor
COPY . .

# 5. Exponer el puerto en el que corre Uvicorn
EXPOSE 8000

# 6. Comando por defecto para arrancar la aplicación
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]