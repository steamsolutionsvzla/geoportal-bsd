from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.layers import router as layers_router

app = FastAPI(
    title="Geoportal API Backend",
    version="1.0.0",
    debug=settings.DEBUG
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(layers_router)

@app.get("/")
def health_check():
    return {"status": "ok", "message": "Geoportal API Backend activo"}