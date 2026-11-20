# tests/test_layer_stats.py
# La clasificación de capas pesadas se calcula por filas/tamaño, no por nombre.
import asyncio

from app.services import layer_stats


class _FakePool:
    async def fetch(self, _query, _tables):
        return [
            {
                "nspname": "gis_petroleo",
                "relname": "tabla_pesada",
                "filas": 30000,
                "bytes": 100 * 1024 * 1024,
            },
            {
                "nspname": "gis_petroleo",
                "relname": "tabla_liviana",
                "filas": 10,
                "bytes": 1 * 1024 * 1024,
            },
        ]


def test_clasifica_pesada_por_filas_o_tamano(monkeypatch):
    async def fake_native():
        return {
            "ws:Hidrografía": "tabla_pesada",
            "ws:Pequena": "tabla_liviana",
        }

    monkeypatch.setattr(layer_stats, "get_pool", lambda: _FakePool())
    monkeypatch.setattr(
        layer_stats.GeoServerService, "get_native_table_names", fake_native
    )

    groups = [
        {
            "name": "ws",
            "layers": [
                {"id": "ws:Hidrografía", "name": "Hidrografía", "type": "line"},
                {"id": "ws:Pequena", "name": "Pequena", "type": "fill"},
                {"id": "ws:Raster", "name": "Raster", "type": "raster"},
            ],
        }
    ]

    enriched = asyncio.run(layer_stats.enrich_groups_with_stats(groups))
    layers = enriched[0]["layers"]

    assert layers[0]["heavy"] is True
    assert layers[0]["feature_count"] == 30000
    assert layers[1]["heavy"] is False
    assert layers[2]["heavy"] is False
