from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr
import bcrypt
from app.db.database import get_pool  # Importamos tu función get_pool existente

router = APIRouter(prefix="/api", tags=["Auth"])

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

@router.post("/login")
async def login(credentials: LoginRequest):
    # 1. Obtenemos el pool y abrimos una conexión hacia PostgreSQL
    pool = get_pool()
    
    async with pool.acquire() as connection:
        # 2. Consultamos la tabla 'usuarios' usando la columna 'correo'
        usuario_encontrado = await connection.fetchrow(
            "SELECT * FROM usuarios WHERE correo = $1", 
            credentials.email
        )

    # 3. Validar si el usuario existe en la base de datos
    if not usuario_encontrado:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos"
        )

    # 4. Verificar la contraseña encriptada usando la columna 'password'
    password_valida = bcrypt.checkpw(
        credentials.password.encode('utf-8'), 
        usuario_encontrado['password'].encode('utf-8')
    )

    if not password_valida:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos"
        )

    # 5. Si todo es correcto, retornamos la respuesta exitosa para el frontend
    return {
        "ok": True,
        "mensaje": "Inicio de sesión exitoso",
        "correo": usuario_encontrado['correo']
    }