// src/services/styles.js
// Cliente para /api/v1/styles
import { apiFetch } from '../scripts/utils.js';

export async function fetchStyles() {
  const r = await apiFetch('/api/v1/styles/list');
  if (!r.ok) throw new Error(`No se pudieron cargar estilos (${r.status})`);
  const data = await r.json();
  return data.styles ?? [];
}

export async function saveStyle(layerName, style) {
  const r = await apiFetch(`/api/v1/styles/${encodeURIComponent(layerName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fill_color: style.fill_color ?? null,
      stroke_color: style.stroke_color ?? null,
      opacity: style.opacity ?? null,
      line_width: style.line_width ?? null,
      min_zoom: style.min_zoom ?? null,
      max_zoom: style.max_zoom ?? null,
      visible_attributes: style.visible_attributes ?? [],
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`No se pudo guardar (${r.status}): ${detail}`);
  }
  return r.json();
}

export async function resetStyle(layerName) {
  const r = await apiFetch(`/api/v1/styles/${encodeURIComponent(layerName)}`, {
    method: 'DELETE',
  });
  if (!r.ok) throw new Error(`No se pudo restablecer (${r.status})`);
}

export async function fetchLayerAttributes(layerName) {
  const r = await apiFetch(`/api/v1/layers/${encodeURIComponent(layerName)}/attributes`);
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  return data.attributes ?? [];
}