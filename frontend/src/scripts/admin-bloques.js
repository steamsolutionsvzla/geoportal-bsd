// admin-bloques.js
// Listado real de bloques petroleros (GET /api/v1/admin/bloques):
// nombre, id, área calculada en PostGIS y centroide.
import { apiFetch } from './utils.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmtArea = (v) => (v === null || v === undefined
  ? '—'
  : `${Number(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km²`);

const fmtCoord = (lat, lng) => (lat === null || lat === undefined || lng === null || lng === undefined
  ? '—'
  : `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`);

async function cargar() {
  const tbody = document.getElementById('tabla-bloques-body');
  const contador = document.getElementById('bloques-count');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="admin-table-empty">Cargando bloques…</td></tr>';

  try {
    const res = await apiFetch('/api/v1/admin/bloques');
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const data = await res.json();
    const filas = data.bloques || [];

    if (contador) {
      contador.textContent = `${filas.length} bloque${filas.length === 1 ? '' : 's'}`;
    }

    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="admin-table-empty">No hay bloques registrados.</td></tr>';
      return;
    }

    tbody.innerHTML = filas.map((b) => `
      <tr>
        <td>${esc(b.bloque)}</td>
        <td>${b.id ?? '—'}</td>
        <td>${fmtArea(b.area_km2)}</td>
        <td>${fmtCoord(b.lat, b.lng)}</td>
      </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="admin-table-empty">No se pudieron cargar los bloques (${esc(e.message)}).</td></tr>`;
    if (contador) contador.textContent = 'Error';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', cargar);
} else {
  cargar();
}
