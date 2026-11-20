# tests/test_gzip_size.py
# Gzip por tamaño: comprime JSON pequeño/mediano y deja pasar las capas grandes.
from fastapi import FastAPI
from fastapi.responses import Response, StreamingResponse
from fastapi.testclient import TestClient

from app.gzip_middleware import SizeLimitedGZipMiddleware


def _client() -> TestClient:
    app = FastAPI()
    app.add_middleware(
        SizeLimitedGZipMiddleware,
        minimum_size=100,
        max_size_bytes=1000,
        compresslevel=6,
    )

    @app.get("/small")
    def small():
        return Response("x" * 500, media_type="application/json")

    @app.get("/large")
    def large():
        return Response("x" * 2000, media_type="application/json")

    @app.get("/stream")
    def stream():
        def chunks():
            yield b"x" * 500

        return StreamingResponse(chunks(), media_type="application/json")

    return TestClient(app)


def test_comprime_respuesta_pequena():
    client = _client()
    resp = client.get("/small", headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") == "gzip"
    assert resp.text == "x" * 500


def test_no_comprime_respuesta_grande():
    client = _client()
    resp = client.get("/large", headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert "content-encoding" not in resp.headers
    assert resp.text == "x" * 2000


def test_no_comprime_streaming_sin_tamano():
    client = _client()
    resp = client.get("/stream", headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert "content-encoding" not in resp.headers
    assert resp.text == "x" * 500


def test_sin_accept_encoding_no_comprime():
    client = _client()
    resp = client.get("/small", headers={"Accept-Encoding": "identity"})
    assert resp.status_code == 200
    assert "content-encoding" not in resp.headers
