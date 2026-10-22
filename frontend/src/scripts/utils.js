// utils.js
export function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function getPaletteForType(type) {
  const PALETTE_POINT = ['#e41a1c','#377eb8','#4daf4a','#984ea3','#ff7f00','#ffff33','#a65628','#f781bf','#999999'];
  const PALETTE_LINE = ['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02','#a6761d','#666666'];
  const PALETTE_POLYGON = ['#a6cee3','#1f78b4','#b2df8a','#33a02c','#fb9a99','#e31a1c','#fdbf6f','#ff7f00','#cab2d6','#6a3d9a','#ffff99','#b15928'];
  if (type === 'circle' || type === 'point') return PALETTE_POINT;
  if (type === 'line') return PALETTE_LINE;
  if (type === 'fill') return PALETTE_POLYGON;
  return PALETTE_POINT;
}

export function formatearCoordenada(lng, lat) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${latDir} ${Math.abs(lng).toFixed(5)}° ${lonDir}`;
}

export function obtenerNombreEstado(properties) {
  const posiblesClaves = ['entidad', 'estado', 'nombre', 'name'];
  const keysReales = Object.keys(properties || {});
  for (const clave of posiblesClaves) {
    const encontrada = keysReales.find(k => k.toLowerCase() === clave);
    if (encontrada && properties[encontrada] !== undefined && properties[encontrada] !== null) {
      return String(properties[encontrada]).trim();
    }
  }
  return null;
}

export function obtenerNombreBloque(properties) {
  const posiblesClaves = ['bloque', 'nombre', 'name'];
  const keysReales = Object.keys(properties || {});
  for (const clave of posiblesClaves) {
    const encontrada = keysReales.find(k => k.toLowerCase() === clave);
    if (encontrada && properties[encontrada] !== undefined && properties[encontrada] !== null) {
      return String(properties[encontrada]).trim();
    }
  }
  return null;
}

export function refreshCount(elementId = 'layerCount') {
  const el = document.getElementById(elementId);
  if (!el) return;
  const active = document.querySelectorAll('.layer-row .toggle.on').length;
  el.textContent = active + (active === 1 ? ' activa' : ' activas');
}

const LEGEND_GEOM_LABELS = {
  fill: 'Polígono',
  line: 'Línea',
  circle: 'Punto',
  point: 'Punto',
  raster: 'Ráster'
};

export function updateLegendUI(availableLayers, legendListId = 'legendList') {
  const legendList = document.getElementById(legendListId) || document.querySelector('.legend-content');
  if (!legendList) return;

  legendList.innerHTML = '';

  const activeToggles = document.querySelectorAll('.toggle.on[data-table]');
  if (activeToggles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'legend-empty';
    empty.textContent = 'No hay capas activas en el mapa.';
    legendList.appendChild(empty);
    return;
  }

  const categoryTitle = document.createElement('div');
  categoryTitle.className = 'legend-category-title';
  categoryTitle.textContent = 'Capas Activas';
  legendList.appendChild(categoryTitle);

  activeToggles.forEach(toggle => {
    const tableName = toggle.getAttribute('data-table');
    const matchingLayers = availableLayers.filter(l => l.id === tableName);

    matchingLayers.forEach(layerConfig => {
      const geomType = String(layerConfig.type || 'fill').toLowerCase();
      const item = document.createElement('div');
      item.className = 'legend-item';

      const swatch = document.createElement('div');
      swatch.className = 'legend-swatch';
      swatch.style.background = layerConfig.color || '#3182ce';

      if (geomType === 'line') {
        swatch.classList.add('line');
      } else if (geomType === 'raster') {
        swatch.style.background = 'linear-gradient(135deg,#8fae7a,#d8c9a3 60%,#9fb7c9)';
      } else if (geomType === 'circle' || geomType === 'point') {
        swatch.classList.add('point');
      }

      const text = document.createElement('div');
      text.className = 'legend-text';

      const title = document.createElement('div');
      title.className = 'lt-title';
      title.textContent = layerConfig.name || tableName;

      const sub = document.createElement('div');
      sub.className = 'lt-sub';
      sub.textContent = LEGEND_GEOM_LABELS[geomType] || 'Capa';

      text.append(title, sub);
      item.append(swatch, text);
      legendList.appendChild(item);
    });
  });
}
// ============================================================
// API: Bearer + ruteo automático a /api/v1/showroom/* en Showroom
// ============================================================
const IS_SHOWROOM_PAGE = () => document.body?.dataset.showroom === 'true';

export function getAuthToken() {
  return localStorage.getItem('auth_token');
}

export function clearSession() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_session');
}

function resolveApiPath(path) {
  if (!IS_SHOWROOM_PAGE()) return path;
  // Showroom: el backend fuerza el workspace "Showroom"
  if (path.startsWith('/api/v1/layers/workspaces')) return '/api/v1/showroom/workspaces';
  if (path.startsWith('/api/v1/layers/')) return path.replace('/api/v1/layers/', '/api/v1/showroom/layers/');
  return path;
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(resolveApiPath(path), { ...options, headers });

  if (response.status === 401) {
    clearSession();
    window.location.href = '/login';
  }
  return response;
}

// Resuelve cuando el mapa termina de pintar (evento 'idle'), con un tope
// para no dejar el loader colgado si 'idle' no llega.
export function esperarMapaListo(map, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      clearTimeout(t);
      map.off('idle', fin);
      resolve();
    };
    const t = setTimeout(fin, timeoutMs);
    map.once('idle', fin);
  });
}