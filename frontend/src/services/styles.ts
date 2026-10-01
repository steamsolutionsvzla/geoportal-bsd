// src/services/styles.ts
// Cliente para /api/v1/styles

declare const Auth: { getToken: () => string | null };

const API = "/api/v1";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = Auth?.getToken?.() ?? localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export interface LayerStyle {
  layer_name: string;
  fill_color?: string | null;
  stroke_color?: string | null;
  opacity?: number | null;
  line_width?: number | null;
  min_zoom?: number | null;
  max_zoom?: number | null;
  visible_attributes: string[];
  updated_by?: string | null;
  updated_at?: string | null;
}

export async function fetchStyles(): Promise<LayerStyle[]> {
  const r = await fetch(`${API}/styles/list`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`No se pudieron cargar estilos (${r.status})`);
  const data = await r.json();
  return data.styles ?? [];
}

export async function saveStyle(
  layerName: string,
  style: Partial<LayerStyle>,
): Promise<LayerStyle> {
  const r = await fetch(`${API}/styles/${encodeURIComponent(layerName)}`, {
    method: "PUT",
    headers: authHeaders(),
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
    const detail = await r.text().catch(() => "");
    throw new Error(`No se pudo guardar (${r.status}): ${detail}`);
  }
  return r.json();
}

export async function resetStyle(layerName: string): Promise<void> {
  const r = await fetch(`${API}/styles/${encodeURIComponent(layerName)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`No se pudo restablecer (${r.status})`);
}

export async function fetchLayerAttributes(layerName: string): Promise<string[]> {
  const r = await fetch(
    `${API}/layers/${encodeURIComponent(layerName)}/attributes`,
    { headers: authHeaders() },
  );
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  return data.attributes ?? [];
}