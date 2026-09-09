# 1. Usar una imagen ligera de Nginx para servir archivos estáticos
FROM nginx:alpine

# 2. Copiar los archivos de tu frontend a la ruta donde Nginx lee las páginas web
COPY . /usr/share/nginx/html

# 2.1 Copiar la configuración que sirve el frontend y hace proxy de /api al backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 3. Exponer el puerto 80 del contenedor
EXPOSE 80

# 4. Arrancar Nginx en primer plano
CMD ["nginx", "-g", "daemon off;"]