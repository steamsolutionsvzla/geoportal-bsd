// src/lib/mapStyles.ts
// Helpers para aplicar estilos guardados en MapLibre.
// `type` viene como "circle" | "line" | "fill" desde GeoServerService.

import type { Map as MapLibreMap } from "maplibre-gl";
import type { LayerStyle } from "../services/styles";

export type MapLayerType = "circle" | "line" | "fill" | string;

/**
 * Aplica un estilo a una capa ya añadida al mapa.
 * `maplibreLayerId` es el id que le pusiste al map.addLayer({ id: ... }).
 * Ojo: MapLibre soporta capas separadas para fill y outline, y para
 * line. Ajusta si en `main.js` usas varios ids por capa.
 */
export function applyStyle(
  map: MapLibreMap,
  maplibreLayerId: string,
  layerType: MapLayerType,
  style: Partial<LayerStyle>,
  defaultMinZoom = 0,
  defaultMaxZoom = 22,
): void {
  if (!map.getLayer(maplibreLayerId)) return;

  const t = (layerType || "").toLowerCase();

  try {
    if (t === "fill") {
      if (style.fill_color) {
        map.setPaintProperty(maplibreLayerId, "fill-color", style.fill_color);
      }
      if (style.opacity != null) {
        map.setPaintProperty(maplibreLayerId, "fill-opacity", style.opacity);
      }
      if (style.stroke_color) {
        map.setPaintProperty(maplibreLayerId, "fill-outline-color", style.stroke_color);
      }
    } else if (t === "line") {
      if (style.stroke_color) {
        map.setPaintProperty(maplibreLayerId, "line-color", style.stroke_color);
      }
      if (style.line_width != null) {
        map.setPaintProperty(maplibreLayerId, "line-width", style.line_width);
      }
    } else if (t === "circle") {
      if (style.fill_color) {
        map.setPaintProperty(maplibreLayerId, "circle-color", style.fill_color);
      }
      if (style.opacity != null) {
        map.setPaintProperty(maplibreLayerId, "circle-opacity", style.opacity);
      }
      if (style.stroke_color) {
        map.setPaintProperty(maplibreLayerId, "circle-stroke-color", style.stroke_color);
      }
      if (style.line_width != null) {
        map.setPaintProperty(maplibreLayerId, "circle-stroke-width", style.line_width);
      }
    }
  } catch {
    /* la prop puede no aplicar; se ignora */
  }

  map.setLayerZoomRange(
    maplibreLayerId,
    style.min_zoom ?? defaultMinZoom,
    style.max_zoom ?? defaultMaxZoom,
  );
}

/**
 * Construye el HTML de un popup filtrando solo los atributos visibles.
 * Si `visibleAttributes` está vacío o es null → muestra todos (default).
 */
export function buildPopupHtml(
  properties: Record<string, unknown>,
  visibleAttributes: string[] | null | undefined,
): string {
  const keys =
    visibleAttributes && visibleAttributes.length > 0
      ? visibleAttributes.filter((k) => k in properties)
      : Object.keys(properties);

  if (keys.length === 0) return "<em>Sin atributos configurados</em>";

  return keys
    .map(
      (k) =>
        `<div style="margin:2px 0"><b>${k}:</b> ${String(properties[k] ?? "")}</div>`,
    )
    .join("");
}