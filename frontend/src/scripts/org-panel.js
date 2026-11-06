// org-panel.js
// ---------------------------------------------------------------------------
// Panel de organización de capas por usuario (geoportal).
//
// Permite crear carpetas personales y arrastrar capas entre ellas.
// La configuración se guarda en el backend (tabla user_layer_folders,
// clave = usuario_id) y sustituye la agrupación por workspaces en el
// sidebar. Showroom y analista no la usan.
// ---------------------------------------------------------------------------
import { apiFetch } from './utils.js';

const SIN_CLASIFICAR = 'Sin clasificar';

// =========================================================================
// Capa de datos
// =========================================================================
export async function obtenerOrganizacion() {
  const resp = await apiFetch('/api/v1/organization');
  if (!resp.ok) throw new Error(`Error ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data?.folders) && data.folders.length ? data.folders : null;
}

export async function guardarOrganizacion(folders) {
  const resp = await apiFetch('/api/v1/organization', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders })
  });
  if (!resp.ok) {
    let msg = `Error ${resp.status}`;
    try {
      const t = await resp.text();
      if (t) {
        try {
          const p = JSON.parse(t);
          msg = typeof p?.detail === 'string' ? p.detail : (p?.detail ? JSON.stringify(p.detail) : t);
        } catch (_) { msg = t; }
      }
    } catch (_) { /* ignorar */ }
    throw new Error(msg);
  }
  return resp.json();
}

/**
 * Convierte las carpetas guardadas en grupos aptos para renderLayerGroups.
 * Las capas desconocidas (borradas de GeoServer) se ignoran y las no
 * asignadas caen en "Sin clasificar".
 */
export function construirGruposDesdeCarpetas(folders, wsGroups) {
  const porId = new Map();
  (wsGroups || []).forEach(g => (g.layers || []).forEach(l => {
    if (!porId.has(l.id)) porId.set(l.id, l);
  }));

  const usados = new Set();
  const grupos = [];
  (folders || []).forEach((f, i) => {
    const layers = [];
    (f.capas || []).forEach(id => {
      const l = porId.get(id);
      if (l && !usados.has(id)) { usados.add(id); layers.push(l); }
    });
    if (layers.length) {
      grupos.push({ name: f.nombre || `Carpeta ${i + 1}`, title: f.nombre, layers });
    }
  });

  const resto = [...porId.values()].filter(l => !usados.has(l.id));
  if (resto.length) grupos.push({ name: SIN_CLASIFICAR, title: SIN_CLASIFICAR, layers: resto });
  return grupos;
}

// =========================================================================
// UI del modal
// =========================================================================
const SVG_CLOSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const SVG_FOLDER = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.2c0-1.1.9-2 2-2h4l2 2.4h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const SVG_MOVE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 5 3 10 8 15"/><path d="M3 10h13"/><polyline points="16 9 21 14 16 19"/><path d="M21 14H8"/></svg>';

let overlayEl = null;
let toastTimer = null;

function toast(mensaje, tipo = 'ok') {
  let t = document.querySelector('.org-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'org-toast';
    document.body.appendChild(t);
  }
  t.textContent = mensaje;
  t.className = `org-toast show ${tipo === 'error' ? 'is-error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function capasarDueltas(folders) {
  return (folders || []).map(f => ({ nombre: f.nombre, capas: [...(f.capas || [])] }));
}

/**
 * Abre el modal de organización.
 * @param {object} opts
 *   wsGroups: grupos actuales por workspace (fuente de capas con id/nombre/color/tipo)
 *   folders:  carpetas guardadas del usuario o null (primera vez: se parte de workspaces)
 *   onGuardado: callback(folders|null) tras guardar con éxito
 */
export function abrirPanelOrganizacion({ wsGroups = [], folders = null, onGuardado = null } = {}) {
  if (overlayEl) return;

  const capasPorId = new Map();
  wsGroups.forEach(g => (g.layers || []).forEach(l => {
    if (!capasPorId.has(l.id)) capasPorId.set(l.id, l);
  }));

  // Estado de trabajo: carpetas locales + pool "Sin organizar".
  const state = {
    folders: folders?.length
      ? capasarDueltas(folders)
      : wsGroups.map(g => ({ nombre: g.title || g.name, capas: (g.layers || []).map(l => l.id) })),
  };
  const baseJson = JSON.stringify(state.folders);
  const estaSucio = () => JSON.stringify(state.folders) !== baseJson;

  const capasAsignadas = () => new Set(state.folders.flatMap(f => f.capas));
  const poolIds = () => [...capasPorId.keys()].filter(id => !capasAsignadas().has(id));

  overlayEl = document.createElement('div');
  overlayEl.className = 'org-overlay';
  overlayEl.innerHTML = `
    <div class="org-modal" role="dialog" aria-modal="true" aria-labelledby="orgTitulo">
      <header class="org-header">
        <span class="org-header-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </span>
        <div class="org-header-titles">
          <h2 id="orgTitulo">Organizar capas en carpetas</h2>
          <p>Arrastra las capas entre carpetas o usa el botón «mover». Es una vista personal: no afecta a los demás usuarios.</p>
        </div>
        <button type="button" class="org-close" data-action="close" title="Cerrar" aria-label="Cerrar">${SVG_CLOSE}</button>
      </header>

      <div class="org-body">
        <div class="org-folders" id="orgFolders" aria-label="Carpetas"></div>
        <button type="button" class="org-new-folder" data-action="nueva">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nueva carpeta
        </button>
        <section class="org-pool" data-drop="__pool">
          <h3>Sin organizar</h3>
          <div class="org-pool-list" id="orgPool"></div>
        </section>
      </div>

      <footer class="org-footer">
        <button type="button" class="org-btn org-btn-ghost" data-action="reset" title="Dejar de usar carpetas personales y agrupar otra vez por workspace">Volver a workspaces</button>
        <button type="button" class="org-btn org-btn-ghost" data-action="close">Cancelar</button>
        <span class="org-footer-spacer"></span>
        <button type="button" class="org-btn org-btn-primary" data-action="save">Guardar cambios</button>
      </footer>
    </div>
  `;
  document.body.appendChild(overlayEl);
  requestAnimationFrame(() => overlayEl.classList.add('open'));

  const foldersEl = overlayEl.querySelector('#orgFolders');
  const poolEl = overlayEl.querySelector('#orgPool');

  // --------------------------------------------------------------
  // Render
  // --------------------------------------------------------------
  function chipHtml(id) {
    const l = capasPorId.get(id);
    if (!l) return '';
    const color = l.color || '#6fa3e0';
    const nombre = String(l.name || id);
    return `
      <span class="org-chip" draggable="true" data-id="${escAttr(id)}" title="${escAttr(nombre)}">
        <span class="org-chip-dot" style="--c:${escAttr(color)}"></span>
        <span class="org-chip-name">${escHtml(nombre)}</span>
        <button type="button" class="org-chip-move" data-move="${escAttr(id)}" title="Mover a otra carpeta" aria-label="Mover ${escAttr(nombre)}">${SVG_MOVE}</button>
      </span>`;
  }

  function render() {
    foldersEl.innerHTML = '';
    state.folders.forEach((f, idx) => {
      const card = document.createElement('div');
      card.className = 'org-folder';
      card.dataset.drop = String(idx);
      card.innerHTML = `
        <div class="org-folder-head">
          <span class="org-folder-icon">${SVG_FOLDER}</span>
          <input class="org-folder-name" data-rename="${idx}" value="${escAttr(f.nombre)}" maxlength="60" aria-label="Nombre de la carpeta" />
          <span class="org-folder-count">${f.capas.length}</span>
          <button type="button" class="org-folder-del" data-del="${idx}" title="Eliminar carpeta" aria-label="Eliminar carpeta ${escAttr(f.nombre)}">✕</button>
        </div>
        <div class="org-folder-body">${f.capas.map(chipHtml).join('') || '<span class="org-drop-hint">Suelta aquí capas…</span>'}</div>
      `;
      foldersEl.appendChild(card);
    });

    const pool = poolIds();
    poolEl.innerHTML = pool.length
      ? pool.map(chipHtml).join('')
      : '<span class="org-drop-hint">Todo organizado 🎉</span>';
  }

  // --------------------------------------------------------------
  // Mover capas
  // --------------------------------------------------------------
  function quitarDeTodas(id) {
    state.folders.forEach(f => {
      const i = f.capas.indexOf(id);
      if (i !== -1) f.capas.splice(i, 1);
    });
  }

  function moverA(destino, id) {
    if (!capasPorId.has(id)) return;
    quitarDeTodas(id);
    if (destino !== '__pool') {
      const f = state.folders[Number(destino)];
      if (f && !f.capas.includes(id)) f.capas.push(id);
    }
    render();
  }

  // Drag & drop nativo
  overlayEl.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.org-chip');
    if (!chip) return;
    e.dataTransfer.setData('text/plain', chip.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    chip.classList.add('dragging');
  });
  overlayEl.addEventListener('dragend', (e) => {
    e.target.closest('.org-chip')?.classList.remove('dragging');
    overlayEl.querySelectorAll('.org-over').forEach(el => el.classList.remove('org-over'));
  });
  overlayEl.addEventListener('dragover', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (!zone || !e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('org-over');
  });
  overlayEl.addEventListener('dragleave', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('org-over');
  });
  overlayEl.addEventListener('drop', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (!zone) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) moverA(zone.dataset.drop, id);
    overlayEl.querySelectorAll('.org-over').forEach(el => el.classList.remove('org-over'));
  });

  // Menú accesible "Mover a…"
  let menuEl = null;
  function cerrarMenu() { menuEl?.remove(); menuEl = null; }

  function abrirMenu(id, anchor) {
    cerrarMenu();
    const opciones = state.folders.map((f, i) => ({ etiqueta: f.nombre || `Carpeta ${i + 1}`, destino: String(i) }));
    opciones.push({ etiqueta: 'Sin organizar', destino: '__pool' });
    menuEl = document.createElement('div');
    menuEl.className = 'org-menu';
    menuEl.innerHTML = `<div class="org-menu-title">Mover a…</div>` +
      opciones.map(o => `<button type="button" data-dest="${escAttr(o.destino)}">${escHtml(o.etiqueta)}</button>`).join('');
    overlayEl.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    const mr = menuEl.getBoundingClientRect();
    // overlayEl es fixed: coordenadas relativas al viewport (sin scrollY).
    menuEl.style.top = `${Math.max(8, Math.min(r.bottom + 4, window.innerHeight - mr.height - 12))}px`;
    menuEl.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - mr.width - 12))}px`;
    menuEl.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => { moverA(b.dataset.dest, id); cerrarMenu(); });
    });
    setTimeout(() => {
      document.addEventListener('click', onDocClickMenu, { once: true });
    }, 0);
  }
  function onDocClickMenu() { cerrarMenu(); }

  // --------------------------------------------------------------
  // Eventos de la barra de herramientas
  // --------------------------------------------------------------
  async function guardar(foldersAPersistir) {
    const saveBtn = overlayEl.querySelector('[data-action="save"]');
    if (saveBtn) saveBtn.disabled = true;
    try {
      await guardarOrganizacion(foldersAPersistir);
      if (typeof onGuardado === 'function') onGuardado(foldersAPersistir?.length ? foldersAPersistir : null);
      toast('Organización guardada ✓');
      cerrar(true);
    } catch (err) {
      console.error('Error al guardar la organización:', err);
      toast(`No se pudo guardar: ${err?.message || err}`, 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) { intentarCerrar(); return; }

    const moveBtn = e.target.closest('.org-chip-move');
    if (moveBtn) { abrirMenu(moveBtn.dataset.move, moveBtn); return; }

    const del = e.target.closest('[data-del]');
    if (del) {
      // Al eliminar la carpeta, sus capas vuelven a "Sin organizar".
      state.folders.splice(Number(del.dataset.del), 1);
      render();
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'nueva') {
      state.folders.push({ nombre: `Carpeta ${state.folders.length + 1}`, capas: [] });
      render();
      const input = foldersEl.lastElementChild?.querySelector('.org-folder-name');
      if (input) { input.focus(); input.select(); }
      return;
    }
    if (action === 'save') {
      const limpias = state.folders
        .map(f => ({ nombre: (f.nombre || '').trim() || 'Carpeta', capas: [...f.capas] }));
      guardar(limpias);
      return;
    }
    if (action === 'reset') { guardar([]); return; }
    if (action === 'close') { intentarCerrar(); return; }
  });

  overlayEl.addEventListener('change', (e) => {
    const input = e.target.closest('[data-rename]');
    if (!input) return;
    const f = state.folders[Number(input.dataset.rename)];
    if (f) { f.nombre = input.value.trim() || f.nombre; render(); }
  });

  function intentarCerrar() {
    if (estaSucio() && !window.confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return;
    cerrar(true);
  }

  function cerrar(_ok) {
    document.removeEventListener('keydown', onKey, true);
    overlayEl.classList.remove('open');
    const el = overlayEl;
    overlayEl = null;
    setTimeout(() => el.remove(), 180);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (menuEl) { e.stopPropagation(); cerrarMenu(); return; }
      e.stopPropagation();
      intentarCerrar();
    }
  }
  document.addEventListener('keydown', onKey, true);

  render();
}

// =========================================================================
// Utilidades HTML
// =========================================================================
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}
