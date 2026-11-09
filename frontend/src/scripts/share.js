// share.js
// Enlace permanente de la vista actual: centro, zoom, mapa base, capas
// activas y filtros de estado/bloque. El botón copia la URL al portapapeles
// y deja el estado reflejado en la barra de direcciones.
// applySharedView() restaura esa vista al arrancar (si la URL la trae).

function estadoActualDeDropdown(dropdownId) {
  const dropdown = document.getElementById(dropdownId);
  const sel = dropdown?.querySelector('.loc-option.selected');
  const val = sel?.getAttribute('data-value') ?? '';
  return val && val !== 'Todos los estados' && val !== 'Todos los bloques' ? val : '';
}

function capasyaActivas() {
  return Array.from(
    document.querySelectorAll('#layersGroupsContainer .toggle.on[data-table]'),
  ).map((t) => t.getAttribute('data-table'));
}

function mapaBaseActivo() {
  return document.querySelector('.basemap-option.active')?.getAttribute('data-basemap') || '';
}

function clickOptionLoc(dropdownId, nombre) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const opt = Array.from(dropdown.querySelectorAll('.loc-option'))
    .find((o) => norm(o.getAttribute('data-value') || o.textContent) === norm(nombre));
  if (opt) opt.click();
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (_) {
    // Fallback sin Clipboard API (http en LAN, navegadores viejos).
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* ignorar */ }
    ta.remove();
    return ok;
  }
}

function mostrarToast(mensaje) {
  let toast = document.querySelector('.share-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'share-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = mensaje;
  toast.classList.add('show');
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => toast.classList.remove('show'), 2400);
}

// ------------------------------------------------------------------
// Botón de compartir (solo si la página trae #shareViewBtn)
// ------------------------------------------------------------------
export function initShareView(map) {
  const btn = document.getElementById('shareViewBtn');
  if (!btn || !map) return;

  btn.addEventListener('click', async () => {
    const c = map.getCenter();
    const url = new URL(window.location.href);

    url.searchParams.set('c', `${c.lng.toFixed(5)},${c.lat.toFixed(5)}`);
    url.searchParams.set('z', map.getZoom().toFixed(2));
    const bm = mapaBaseActivo();
    if (bm) url.searchParams.set('bm', bm);

    const capas = capasyaActivas();
    if (capas.length) url.searchParams.set('capas', capas.join(','));
    const estado = estadoActualDeDropdown('dropdownEstado');
    if (estado) url.searchParams.set('estado', estado);
    const bloque = estadoActualDeDropdown('dropdownBloque');
    if (bloque) url.searchParams.set('bloque', bloque);

    history.replaceState(null, '', url.toString());
    const ok = await copiarTexto(url.toString());
    mostrarToast(ok ? 'Enlace de la vista copiado' : 'No se pudo copiar; la URL está en la barra');
  });
}

// ------------------------------------------------------------------
// Restauración al arrancar (después de cargar capas y filtros)
// ------------------------------------------------------------------
export function applySharedView(map) {
  const params = new URLSearchParams(window.location.search);
  if (![...params.keys()].some((k) => ['c', 'z', 'bm', 'capas', 'estado', 'bloque'].includes(k))) return;

  // Mapa base.
  const bm = params.get('bm');
  if (bm) {
    const opt = document.querySelector(`.basemap-option[data-basemap="${CSS.escape(bm)}"]`);
    if (opt && !opt.classList.contains('active')) opt.click();
  }

  // Capas activas: mismo clic programado que el usuario haría.
  (params.get('capas') || '').split(',').filter(Boolean).forEach((table) => {
    const toggle = document.querySelector(
      `#layersGroupsContainer .toggle[data-table="${CSS.escape(table)}"]`,
    );
    if (toggle && !toggle.classList.contains('on')) toggle.click();
  });

  // Filtros de ubicación (los dropdowns ya están poblados). Se aplican
  // antes que el centro porque el filtro lanza su propio fitBounds: el
  // centro/zoom explícito de la URL manda al final.
  const estado = params.get('estado');
  if (estado) clickOptionLoc('dropdownEstado', estado);
  const bloque = params.get('bloque');
  if (bloque) clickOptionLoc('dropdownBloque', bloque);

  // Vista: centro/zoom sin animación (estamos en la carga inicial).
  const c = params.get('c')?.split(',').map(Number);
  const z = Number(params.get('z'));
  if (c && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
    map.jumpTo({
      center: [c[0], c[1]],
      zoom: Number.isFinite(z) ? Math.min(Math.max(z, 5), 18) : undefined,
    });
  }
}
