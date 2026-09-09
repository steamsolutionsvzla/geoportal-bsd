import asyncio
import time
import httpx
import logging
from fastapi import HTTPException
from app.config import settings
from typing import List, Dict, Optional

# Bindings Java/JTS para geometría
_GEOM_BINDING_TO_TYPE = {
    "point": "circle",
    "multipoint": "circle",
    "linestring": "line",
    "multilinestring": "line",
    "linearring": "line",
    "polygon": "fill",
    "multipolygon": "fill",
    "surface": "fill",
    "multisurface": "fill",
}

# Caché para mapeo de capas a workspaces
_LAYER_MAPPING_CACHE = {}
_LAYER_MAPPING_CACHE_TIME = 0

# Logger (opcional, puedes descomentar para depuración)
# logger = logging.getLogger(__name__)


class GeoServerService:
    """Intermediario entre el frontend y GeoServer, con soporte para múltiples workspaces."""

    @staticmethod
    def _auth():
        if settings.GEOSERVER_USER and settings.GEOSERVER_PASSWORD:
            return (settings.GEOSERVER_USER, settings.GEOSERVER_PASSWORD)
        return None

    # --------------------------------------------------------------
    # Mapeo de todas las capas (feature types) de todos los workspaces
    # --------------------------------------------------------------
    @staticmethod
    async def _get_all_feature_types(force_refresh: bool = False) -> Dict[str, str]:
        """
        Retorna un diccionario {nombre_capa: workspace} para todas las capas
        de todos los workspaces de GeoServer. Usa caché de 60 segundos.
        """
        global _LAYER_MAPPING_CACHE, _LAYER_MAPPING_CACHE_TIME
        now = time.time()
        if not force_refresh and _LAYER_MAPPING_CACHE and (now - _LAYER_MAPPING_CACHE_TIME) < 60:
            return _LAYER_MAPPING_CACHE

        base_url = settings.GEOSERVER_URL.rstrip('/')
        auth = GeoServerService._auth()
        async with httpx.AsyncClient(timeout=30.0) as client:
            # 1. Obtener todos los workspaces
            resp = await client.get(f"{base_url}/rest/workspaces.json", auth=auth)
            if resp.status_code != 200:
                return {}
            workspaces = resp.json().get("workspaces", {}).get("workspace", [])
            mapping = {}
            for ws in workspaces:
                ws_name = ws.get("name")
                if not ws_name:
                    continue
                # 2. Obtener datastores de cada workspace
                ds_resp = await client.get(f"{base_url}/rest/workspaces/{ws_name}/datastores.json", auth=auth)
                if ds_resp.status_code != 200:
                    continue
                datastores = ds_resp.json().get("dataStores", {}).get("dataStore", [])
                for ds in datastores:
                    ds_name = ds.get("name")
                    if not ds_name:
                        continue
                    # 3. Obtener feature types de cada datastore
                    ft_resp = await client.get(
                        f"{base_url}/rest/workspaces/{ws_name}/datastores/{ds_name}/featuretypes.json",
                        auth=auth
                    )
                    if ft_resp.status_code != 200:
                        continue
                    feature_types = ft_resp.json().get("featureTypes", {}).get("featureType", [])
                    for ft in feature_types:
                        ft_name = ft.get("name")
                        if ft_name:
                            mapping[ft_name] = ws_name

        _LAYER_MAPPING_CACHE = mapping
        _LAYER_MAPPING_CACHE_TIME = now
        return mapping

    @staticmethod
    async def _find_workspace_for_layer(table_name: str) -> Optional[str]:
        """Devuelve el workspace donde se encuentra la capa, o None si no existe."""
        mapping = await GeoServerService._get_all_feature_types()
        return mapping.get(table_name)

    # --------------------------------------------------------------
    # Obtención de GeoJSON de una capa
    # --------------------------------------------------------------
    @staticmethod
    async def get_layer_geojson(
        table_name: str,
        srs: str = "EPSG:4326",
        workspace: Optional[str] = None
    ) -> dict:
        """
        Obtiene el GeoJSON de una capa.
        Si el table_name contiene ':', se extrae el workspace de ahí.
        Si no, se autodeteca el workspace.
        """
        # 1. Si el table_name contiene ':' y no se especificó workspace, extraerlo
        if ':' in table_name and workspace is None:
            parts = table_name.split(':', 1)
            workspace = parts[0]
            table_name = parts[1]  # ahora solo el nombre de la capa

        # 2. Si no se dio workspace (ni explícito ni extraído), autodetectarlo
        if workspace is None:
            workspace = await GeoServerService._find_workspace_for_layer(table_name)
            if workspace is None:
                raise HTTPException(
                    404,
                    f"No se encontró la capa '{table_name}' en ningún workspace."
                )

        type_name = f"{workspace}:{table_name}"
        url = f"{settings.GEOSERVER_URL.rstrip('/')}/wfs"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": type_name,
            "outputFormat": "application/json",
            "srsName": srs,
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, params=params, auth=GeoServerService._auth())
        except httpx.RequestError as e:
            raise HTTPException(502, f"No se pudo conectar con GeoServer ({url}): {e}")

        if response.status_code == 401:
            raise HTTPException(502, "GeoServer rechazó las credenciales configuradas.")
        if response.status_code == 404:
            raise HTTPException(404, f"La capa '{table_name}' no existe (typeName '{type_name}').")
        if response.status_code != 200:
            raise HTTPException(
                502,
                f"GeoServer respondió con error {response.status_code} al pedir la capa '{table_name}'."
            )

        content_type = response.headers.get("content-type", "")
        if "json" not in content_type:
            raise HTTPException(502, f"GeoServer no devolvió GeoJSON para la capa '{table_name}'.")

        data = response.json()
        if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
            raise HTTPException(502, f"Respuesta inesperada de GeoServer para la capa '{table_name}'.")

        return data

    # --------------------------------------------------------------
    # Detección del tipo de geometría (usado por los endpoints de workspaces)
    # --------------------------------------------------------------
    @staticmethod
    def _map_binding_to_type(binding: str) -> Optional[str]:
        if not binding:
            return None
        short_name = binding.rsplit(".", 1)[-1].lower()
        return _GEOM_BINDING_TO_TYPE.get(short_name)

    @staticmethod
    def _fallback_type_by_name(ft_name: str) -> str:
        lower_name = ft_name.lower()
        if "pozo" in lower_name or "estacion" in lower_name or "fosa" in lower_name:
            return "circle"
        elif "linea" in lower_name or "ducto" in lower_name:
            return "line"
        return "fill"

    @staticmethod
    async def _get_geometry_type(
        client: httpx.AsyncClient,
        base_url: str,
        ws_name: str,
        ds_name: str,
        ft_name: str,
        auth
    ) -> str:
        """
        Obtiene el tipo de geometría de una capa. Siempre devuelve un string.
        Si falla, usa fallback por nombre.
        """
        try:
            detail_url = f"{base_url}/rest/workspaces/{ws_name}/datastores/{ds_name}/featuretypes/{ft_name}.json"
            resp = await client.get(detail_url, auth=auth)
            if resp.status_code != 200:
                # Si falla la petición, devolver fallback
                return GeoServerService._fallback_type_by_name(ft_name)
            detail = resp.json()
            ft_detail = detail.get("featureType", {})
            attributes = ft_detail.get("attributes", {}).get("attribute", [])
            for attr in attributes:
                mapped = GeoServerService._map_binding_to_type(attr.get("binding", ""))
                if mapped:
                    return mapped
            # Si no se detectó binding, fallback por nombre
            return GeoServerService._fallback_type_by_name(ft_name)
        except Exception:
            # Cualquier error (conexión, JSON, etc.) -> fallback por nombre
            return GeoServerService._fallback_type_by_name(ft_name)

    @staticmethod
    async def _collect_layers_for_workspace(
        client: httpx.AsyncClient,
        base_url: str,
        ws_name: str,
        auth
    ) -> List[Dict]:
        """
        Recolecta todas las capas (feature types) de un workspace.
        Si falla alguna, la omite y sigue con las demás.
        """
        datastores_url = f"{base_url}/rest/workspaces/{ws_name}/datastores.json"
        ds_resp = await client.get(datastores_url, auth=auth)
        if ds_resp.status_code != 200:
            return []

        datastores = ds_resp.json().get("dataStores", {}).get("dataStore", [])
        pending = []
        for ds in datastores:
            ds_name = ds.get("name")
            if not ds_name:
                continue
            ft_url = f"{base_url}/rest/workspaces/{ws_name}/datastores/{ds_name}/featuretypes.json"
            ft_resp = await client.get(ft_url, auth=auth)
            if ft_resp.status_code != 200:
                continue
            feature_types = ft_resp.json().get("featureTypes", {}).get("featureType", [])
            for ft in feature_types:
                ft_name = ft.get("name")
                if ft_name:
                    pending.append((ds_name, ft_name, ft.get("title") or ft_name))

        if not pending:
            return []

        # Obtener tipos de geometría de manera robusta
        geom_results = await asyncio.gather(*[
            GeoServerService._get_geometry_type(client, base_url, ws_name, ds_name, ft_name, auth)
            for ds_name, ft_name, _title in pending
        ], return_exceptions=True)  # <- importante: captura excepciones

        layers = []
        for idx, (ds_name, ft_name, title) in enumerate(pending):
            geom_type = geom_results[idx]
            if isinstance(geom_type, Exception):
                # Si hubo error, usar fallback por nombre
                geom_type = GeoServerService._fallback_type_by_name(ft_name)
            layers.append({
                "id": f"{ws_name}:{ft_name}",
                "name": title,
                "type": geom_type,
            })
        return layers

    @staticmethod
    async def get_available_layers() -> List[Dict]:
        """Lista plana de capas del workspace configurado en settings (legacy)."""
        base_url = settings.GEOSERVER_URL.rstrip('/')
        workspace = settings.GEOSERVER_WORKSPACE
        auth = GeoServerService._auth()
        async with httpx.AsyncClient(timeout=30.0) as client:
            return await GeoServerService._collect_layers_for_workspace(client, base_url, workspace, auth)

    @staticmethod
    async def get_workspaces_with_layers() -> List[Dict]:
        """
        Obtiene TODOS los workspaces de GeoServer y, para cada uno,
        la lista de capas (feature types) con su tipo de geometría.
        Si un workspace falla, se omite y se continúa con los demás.
        """
        base_url = settings.GEOSERVER_URL.rstrip('/')
        auth = GeoServerService._auth()

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(f"{base_url}/rest/workspaces.json", auth=auth)
                if resp.status_code != 200:
                    raise HTTPException(502, f"Error al obtener workspaces: {resp.status_code}")

                workspaces = resp.json().get("workspaces", {}).get("workspace", [])
                names = [ws.get("name") for ws in workspaces if ws.get("name")]

                result = []
                for ws_name in names:
                    try:
                        layers = await GeoServerService._collect_layers_for_workspace(
                            client, base_url, ws_name, auth
                        )
                        if layers:
                            result.append({"name": ws_name, "layers": layers})
                    except Exception as e:
                        # Registra el error (puedes usar logging) pero continúa
                        # logger.warning(f"Error procesando workspace '{ws_name}': {e}")
                        continue

                return result

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"Error al obtener workspaces con capas: {str(e)}")