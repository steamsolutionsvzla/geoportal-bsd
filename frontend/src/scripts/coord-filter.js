// coord-filter.js
// Filtro persistente por coordenadas en la topbar del geoportal.
// - Convierte Lat/Lng + radio en una zona circular.
// - Consulta las capas con datos en esa zona y permite encenderlas.
// - Al quitar el filtro se apagan solo las capas que activó el propio filtro.
import {
  parseCoordenadas, geometriaDeZona, dibujarZona, limpiarZona,
  consultarZona, capaActiva, alternarCapaEnCatalogo,
} from './zone-scan.js';

const RADIO_DEFAULT = 15;

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function geomClassDe(geomType) {
  const g = String(geomType || '').toLowerCase();
  if (g === 'circle' || g === 'point') return 'geom-point';
  if (g === 'line') return 'geom-line';
  return 'geom-fill';
}

export function initCoordinateFilter() {
  const wrap = document.getElementById('coordFilter');
  const input = document.getElementById('coordFilterInput');
  const dropdown = document.getElementById('coordFilterDropdown');
  const results = document.getElementById('coordFilterResults');
  const hint = document.getElementById('coordFilterHint');
  const errorEl = document.getElementById('coordFilterError');
  const applyBtn = document.getElementById('coordFilterApply');
  const clearBtn = document.getElementById('coordFilterClear');
  const toggleBtn = document.getElementById('coordFilterToggle');
  if (!wrap || !input || !dropdown || !results) return;

  let activo = false;
  let lat = null;
  let lng = null;
  let radioKm = RADIO_DEFAULT;
  let geometry = null;
  let capas = [];
  let cargando = false;
  let error = null;
  let token = 0;
  const autoActivadas = new Set();

  const setOpen = (open) => {
    wrap.classList.toggle('open', open);
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) wrap.classList.remove('is-open');
  };

  const setError = (texto) => {
    error = texto || null;
    if (errorEl) {
      errorEl.textContent = error || '';
      errorEl.hidden = !error;
    }
  };

  const renderRadio = () => {
    dropdown.querySelectorAll('.coord-radius .ls-chip[data-km]').forEach((chip) => {
      chip.classList.toggle('active', Number(chip.dataset.km) === radioKm);
    });
  };

  const render = () => {
    renderRadio();
    if (hint) {
      hint.textContent = activo
        ? 'La zona permanece activa hasta que la quites con la X.'
        : 'Escribe latitud y longitud y pulsa Enter.';
    }

    if (!activo) {
      results.innerHTML = '';
      return;
    }

    if (cargando) {
      results.innerHTML = '<div class="coord-filter-empty">Buscando capas en la zona…</div>';
      return;
    }

    if (error) {
      results.innerHTML = `<div class="coord-filter-empty is-error">${escHtml(error)}</div>`;
      return;
    }

    if (!capas.length) {
      results.innerHTML = '<div class="coord-filter-empty">Sin capas con datos en esta zona.</div>';
      return;
    }

    const items = capas.map((c) => {
      const on = capaActiva(c.id);
      return `<div class="lsd-item coord-result${on ? ' is-active' : ''}" data-table="${escHtml(c.id)}" role="button" aria-pressed="${on ? 'true' : 'false'}" title="Clic para ${on ? 'apagar' : 'encender'} la capa">
        <span class="layer-icon ${geomClassDe(c.type)}"></span>
        <span class="lsd-name">${escHtml(c.name)}</span>
        <span class="lsd-count">${Number(c.count).toLocaleString('es')}</span>
        <span class="lsd-check">${on ? '✓' : '○'}</span>
      </div>`;
    }).join('');

    const todas = capas.every((c) => capaActiva(c.id));
    results.innerHTML = `
      <div class="coord-filter-actions">
        <button type="button" class="coord-filter-all" data-acc="todas">${todas ? 'Desactivar todas' : 'Activar todas'}</button>
        <button type="button" class="coord-filter-reset" data-acc="quitar">Quitar filtro</button>
      </div>
      ${items}`;
  };

  const consultar = async () => {
    if (!geometry) return;
    const myToken = ++token;
    cargando = true;
    setError(null);
    render();

    try {
      const data = await consultarZona(geometry);
      if (myToken !== token) return;
      capas = data?.layers || [];
    } catch (e) {
      if (myToken !== token) return;
      capas = [];
      setError(e?.name === 'AbortError'
        ? 'El servidor no respondió a tiempo. Inténtalo de nuevo.'
        : (e?.message || String(e)));
    } finally {
      if (myToken === token) {
        cargando = false;
        render();
      }
    }
  };

  const aplicar = () => {
    const parsed = parseCoordenadas(input.value);
    if (!parsed) {
      setError('Coordenadas no válidas. Usa, por ejemplo: 10.65, -71.62');
      setOpen(true);
      render();
      return;
    }
    lat = parsed.lat;
    lng = parsed.lng;
    activo = true;
    setError(null);
    if (clearBtn) clearBtn.hidden = false;
    wrap.classList.add('has-filter');
    input.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    // El buscador lateral deja de mostrar su zona para no competir por el mapa.
    document.dispatchEvent(new CustomEvent('zone:claim', { detail: 'coords' }));

    geometry = geometriaDeZona(lat, lng, radioKm);
    dibujarZona(geometry, [lng, lat]);
    setOpen(true);
    consultar();
  };

  const quitar = ({ limpiarMapa = true, cerrar = true } = {}) => {
    token++;
    for (const tableName of autoActivadas) {
      if (capaActiva(tableName)) alternarCapaEnCatalogo(tableName);
    }
    autoActivadas.clear();
    activo = false;
    lat = null;
    lng = null;
    geometry = null;
    capas = [];
    cargando = false;
    setError(null);
    if (input) input.value = '';
    if (clearBtn) clearBtn.hidden = true;
    wrap.classList.remove('has-filter');
    wrap.classList.remove('is-open');
    if (limpiarMapa) limpiarZona();
    if (cerrar) setOpen(false);
    render();
  };

  // Si otra herramienta reclama la zona (estado desde el buscador),
  // se descarta el estado del filtro sin borrar el dibujo que hará el otro.
  document.addEventListener('zone:claim', (e) => {
    if (e.detail === 'coords') return;
    if (activo) quitar({ limpiarMapa: false, cerrar: true });
    else setOpen(false);
  });

  input.addEventListener('focus', () => {
    setOpen(true);
    if (activo) input.select();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      aplicar();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      input.blur();
    }
  });

  applyBtn?.addEventListener('click', aplicar);
  clearBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    quitar();
  });

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.toggle('is-open');
    if (wrap.classList.contains('is-open')) {
      input.focus();
      setOpen(true);
    }
  });

  dropdown.addEventListener('click', (e) => {
    const chip = e.target.closest('.coord-radius .ls-chip[data-km]');
    if (chip) {
      const km = Number(chip.dataset.km);
      if (Number.isFinite(km)) {
        radioKm = km;
        if (activo && lat !== null && lng !== null) {
          geometry = geometriaDeZona(lat, lng, radioKm);
          dibujarZona(geometry, [lng, lat]);
          consultar();
        } else {
          render();
        }
      }
      return;
    }

    const acc = e.target.closest('[data-acc]');
    if (acc) {
      const accion = acc.getAttribute('data-acc');
      if (accion === 'quitar') quitar();
      else if (accion === 'todas') {
        const todas = capas.every((c) => capaActiva(c.id));
        capas.forEach((c) => {
          if (todas) {
            if (capaActiva(c.id)) alternarCapaEnCatalogo(c.id);
          } else if (!capaActiva(c.id)) {
            alternarCapaEnCatalogo(c.id);
            autoActivadas.add(c.id);
          }
        });
        render();
      }
      return;
    }

    const item = e.target.closest('.coord-result[data-table]');
    if (item) {
      const tableName = item.getAttribute('data-table');
      if (!tableName) return;
      const estabaActiva = capaActiva(tableName);
      alternarCapaEnCatalogo(tableName);
      if (!estabaActiva) autoActivadas.add(tableName);
      render();
    }
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });

  // Al desmontar la página no queda nada que limpiar: el overlay de zona
  // pertenece al mapa, que también se destruye.
  render();
}
