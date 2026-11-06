// info-panel.js
import { getMap } from './map-config.js';
import { apiFetch } from './utils.js';
import { buildQgisMetadataHtml, initQgisMetadataWidgets } from './metadata-qgis.js';

// ========================================================================
// ESTADO INTERNO DEL PANEL
// ========================================================================
let currentFilterData = null;
let currentBloqueFilterData = null;
let currentAreaFilterData = null;
let currentIntersectionFilterData = null;
let isFilterActive = false;
let isBloqueFilterActive = false;
let isAreaFilterActive = false;
let isIntersectionFilterActive = false;
let estadoSeleccionado = '';
let bloqueSeleccionado = '';
let areaSeleccionada = '';

let selectedLayerTableName = null;
let selectedLayerDisplayName = null;

const layerMetadataCache = {};

// ========================================================================
// LOADER DE TARJETAS DE FILTRO
// ========================================================================
let filterLoadingCount = 0;

function ensureFilterLoaderStyles() {
  if (document.getElementById('filter-loader-styles')) return;
  const style = document.createElement('style');
  style.id = 'filter-loader-styles';
  style.textContent = `
    .info-card.filter-card { position: relative; }
    .info-card-loader {
      position: absolute;
      inset: 0;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: rgba(255, 255, 255, 0.78);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      border-radius: inherit;
      z-index: 10;
      pointer-events: all;
    }
    .info-card.filter-card.is-loading .info-card-loader { display: flex; }
    .info-card-spinner {
      width: 26px;
      height: 26px;
      border: 2.5px solid #3182ce;
      border-top-color: transparent;
      border-radius: 50%;
      animation: info-spin 0.7s linear infinite;
    }
    .info-card-loader-text {
      font-size: 0.78rem;
      font-weight: 600;
      color: #1a365d;
      letter-spacing: 0.02em;
      animation: info-pulse 1.4s ease-in-out infinite;
    }
    @keyframes info-spin { to { transform: rotate(360deg); } }
    @keyframes info-pulse {
      0%, 100% { opacity: 0.55; }
      50%      { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}
ensureFilterLoaderStyles();

export function pushFilterLoading() {
  filterLoadingCount++;
  applyFilterLoadingState(true);
}

export function popFilterLoading() {
  filterLoadingCount = Math.max(0, filterLoadingCount - 1);
  applyFilterLoadingState(filterLoadingCount > 0);
}

function applyFilterLoadingState(loading) {
  const infoContent = document.getElementById('infoPanelContent');
  if (!infoContent) return;
  infoContent.querySelectorAll('.info-card.filter-card').forEach(card => {
    card.classList.toggle('is-loading', loading);
  });
}

// ========================================================================
// CARGA DEL LOGO (cacheado en Base64)
// ========================================================================
let logoBase64Cache = null;

async function getLogoBase64() {
  if (logoBase64Cache) return logoBase64Cache;

  try {
    const response = await fetch('/img/logo.png');
    if (!response.ok) throw new Error('No se pudo cargar el logo');
    const blob = await response.blob();
    logoBase64Cache = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('Logo no disponible:', error);
    logoBase64Cache = null;
  }
  return logoBase64Cache;
}

// ========================================================================
// EXPORTACIÓN DE FUNCIONES PARA ACTUALIZAR EL ESTADO DEL PANEL
// ========================================================================
export function setInfoPanelData(data) {
  if (data.currentFilterData !== undefined) currentFilterData = data.currentFilterData;
  if (data.currentBloqueFilterData !== undefined) currentBloqueFilterData = data.currentBloqueFilterData;
  if (data.currentAreaFilterData !== undefined) currentAreaFilterData = data.currentAreaFilterData;
  if (data.currentIntersectionFilterData !== undefined) currentIntersectionFilterData = data.currentIntersectionFilterData;
  if (data.isFilterActive !== undefined) isFilterActive = data.isFilterActive;
  if (data.isBloqueFilterActive !== undefined) isBloqueFilterActive = data.isBloqueFilterActive;
  if (data.isAreaFilterActive !== undefined) isAreaFilterActive = data.isAreaFilterActive;
  if (data.isIntersectionFilterActive !== undefined) isIntersectionFilterActive = data.isIntersectionFilterActive;
  if (data.estadoSeleccionado !== undefined) estadoSeleccionado = data.estadoSeleccionado;
  if (data.bloqueSeleccionado !== undefined) bloqueSeleccionado = data.bloqueSeleccionado;
  if (data.areaSeleccionada !== undefined) areaSeleccionada = data.areaSeleccionada;
}

export function showLayerMetadataInPanel(tableName, displayName) {
  selectedLayerTableName = tableName;
  selectedLayerDisplayName = displayName || tableName;
  renderInfoPanel();
  loadLayerMetadataForPanel(tableName);
}

export function clearSelectedLayerMetadataIfMatches(tableName) {
  if (selectedLayerTableName === tableName) {
    selectedLayerTableName = null;
    selectedLayerDisplayName = null;
  }
}

async function loadLayerMetadataForPanel(tableName) {
  const cached = layerMetadataCache[tableName];
  if (cached && cached.status !== 'error') {
    if (selectedLayerTableName === tableName) renderInfoPanel();
    return;
  }

  layerMetadataCache[tableName] = { status: 'loading' };
  if (selectedLayerTableName === tableName) renderInfoPanel();

  try {
    const response = await apiFetch(`/api/v1/layers/${tableName}/metadata`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (!data.has_metadata || !data.metadata) {
      layerMetadataCache[tableName] = { status: 'empty' };
    } else {
      layerMetadataCache[tableName] = { status: 'ready', metadata: data.metadata };
    }
  } catch (error) {
    console.error('Error al obtener los metadatos de la capa:', error);
    layerMetadataCache[tableName] = { status: 'error' };
  }

  if (selectedLayerTableName === tableName) renderInfoPanel();
}

// ========================================================================
// RENDERIZADO PRINCIPAL DEL PANEL
// ========================================================================
export function renderInfoPanel() {
  const infoContent = document.getElementById('infoPanelContent');
  if (!infoContent) return;

  const selectedLayerMetadataHtml = buildSelectedLayerMetadataHtml();
  const filterHtml = (isFilterActive && currentFilterData) ? buildFilterSummaryHtml() : '';
  const bloqueFilterHtml = (isBloqueFilterActive && currentBloqueFilterData) ? buildBloqueFilterSummaryHtml() : '';
  const areaFilterHtml = (isAreaFilterActive && currentAreaFilterData) ? buildAreaFilterSummaryHtml() : '';
  const intersectionFilterHtml = (isIntersectionFilterActive && currentIntersectionFilterData) ? buildIntersectionFilterSummaryHtml() : '';

  let html = '';
  let bloques = [];
  if (selectedLayerMetadataHtml) bloques.push(selectedLayerMetadataHtml);
  if (filterHtml) bloques.push(filterHtml);
  if (bloqueFilterHtml) bloques.push(bloqueFilterHtml);
  if (areaFilterHtml) bloques.push(areaFilterHtml);
  if (intersectionFilterHtml) bloques.push(intersectionFilterHtml);

  if (bloques.length > 0) {
    html = bloques.join('');
  } else {
    html = `<div class="info-card"><div class="ic-label">Información</div><p class="info-card-empty">Seleccione un estado, un bloque o un área y aplique el filtro, o haga clic en un punto/línea/polígono del mapa, para ver los metadatos de su capa.</p></div>`;
  }

  infoContent.innerHTML = html;
  initQgisMetadataWidgets(infoContent);

  // Reaplicar estado de loading si hay recálculo en curso
  if (filterLoadingCount > 0) {
    infoContent.querySelectorAll('.info-card.filter-card').forEach(card => {
      card.classList.add('is-loading');
    });
  }

  if (filterHtml) attachFilterDownloadListeners();
  if (bloqueFilterHtml) attachBloqueFilterDownloadListeners();
  if (areaFilterHtml) attachAreaFilterDownloadListeners();
  if (intersectionFilterHtml) attachIntersectionFilterDownloadListeners();

  const infoPanel = document.getElementById('infoPanel');
  if (infoPanel && infoPanel.classList.contains('collapsed')) {
    infoPanel.classList.remove('collapsed');
    document.querySelector('.app')?.classList.remove('has-collapsed-info');
    setTimeout(() => getMap().resize(), 300);
  }
}

// =========================================================================
// CONSTRUCCIÓN DE TARJETAS DE INFORMACIÓN
// =========================================================================
function buildFilterSummaryHtml() {
  if (!currentFilterData) return '';
  const { estadoSeleccionado: estadoNombre, totalPuntosGeneral, capasContadas, rowsHtml } = currentFilterData;
  let html = `<div class="info-card filter-card" data-filter="estado"><div class="ic-label">Estado: ${estadoNombre}</div><hr class="info-divider">`;
  html += `<div class="info-table-wrap"><table id="tablaPuntosEstado" class="info-table">`;
  html += `<thead><tr><th>Capa / Elemento</th><th>Cantidad</th></tr></thead><tbody>`;
  html += rowsHtml;
  if (capasContadas === 0) {
    html += `<tr><td colspan="2" class="info-table-empty">No hay capas de puntos activas.</td></tr>`;
  }
  html += `</tbody></table></div>`;
  if (capasContadas > 0) {
    html += `<div class="info-total"><span>Total de puntos en el estado</span><b>${totalPuntosGeneral}</b></div>`;
    html += `<button type="button" id="downloadPdfBtn" class="info-btn info-btn-primary">Descargar datos en PDF</button>`;
    html += `<button type="button" id="downloadExcelBtn" class="info-btn info-btn-success">Descargar tablas en Excel</button>`;
  }
  html += `<button type="button" id="clearFilterEstadoBtn" class="info-btn info-btn-danger" style="margin-top:8px;">✕ Quitar filtro de estado</button>`;
  html += `<div class="info-card-loader" aria-hidden="true"><div class="info-card-spinner"></div><div class="info-card-loader-text">Recalculando…</div></div>`;
  html += `</div>`;
  return html;
}

function buildBloqueFilterSummaryHtml() {
  if (!currentBloqueFilterData) return '';
  const { bloqueSeleccionado: bloqueNombre, totalPuntosGeneral, capasContadas, rowsHtml } = currentBloqueFilterData;
  let html = `<div class="info-card filter-card" data-filter="bloque"><div class="ic-label">Bloque: ${bloqueNombre}</div><hr class="info-divider">`;
  html += `<div class="info-table-wrap"><table id="tablaPuntosBloque" class="info-table">`;
  html += `<thead><tr><th>Capa / Elemento</th><th>Cantidad</th></tr></thead><tbody>`;
  html += rowsHtml;
  if (capasContadas === 0) {
    html += `<tr><td colspan="2" class="info-table-empty">No hay capas de puntos activas.</td></tr>`;
  }
  html += `</tbody></table></div>`;
  if (capasContadas > 0) {
    html += `<div class="info-total"><span>Total de puntos en el bloque</span><b>${totalPuntosGeneral}</b></div>`;
    html += `<button type="button" id="downloadPdfBtnBloque" class="info-btn info-btn-primary">Descargar datos en PDF</button>`;
    html += `<button type="button" id="downloadExcelBtnBloque" class="info-btn info-btn-success">Descargar tablas en Excel</button>`;
  }
  html += `<button type="button" id="clearFilterBloqueBtn" class="info-btn info-btn-danger" style="margin-top:8px;">✕ Quitar filtro de bloque</button>`;
  html += `<div class="info-card-loader" aria-hidden="true"><div class="info-card-spinner"></div><div class="info-card-loader-text">Recalculando…</div></div>`;
  html += `</div>`;
  return html;
}

function buildAreaFilterSummaryHtml() {
  if (!currentAreaFilterData) return '';
  const { areaSeleccionada: areaNombre, totalElementos, capasContadas, rowsHtml } = currentAreaFilterData;
  let html = `<div class="info-card filter-card" data-filter="area"><div class="ic-label">Área: ${areaNombre}</div><hr class="info-divider">`;
  html += `<div class="info-table-wrap"><table id="tablaElementosArea" class="info-table">`;
  html += `<thead><tr><th>Capa / Elemento</th><th>Cantidad</th></tr></thead><tbody>`;
  html += rowsHtml;
  if (capasContadas === 0) {
    html += `<tr><td colspan="2" class="info-table-empty">No hay capas de puntos activas dentro del área.</td></tr>`;
  }
  html += `</tbody></table></div>`;
  if (capasContadas > 0) {
    html += `<div class="info-total"><span>Total de puntos en el área</span><b>${totalElementos}</b></div>`;
    html += `<button type="button" id="downloadPdfBtnArea" class="info-btn info-btn-primary">Descargar datos en PDF</button>`;
    html += `<button type="button" id="downloadExcelBtnArea" class="info-btn info-btn-success">Descargar tablas en Excel</button>`;
  }
  html += `<button type="button" id="clearFilterAreaBtn" class="info-btn info-btn-danger" style="margin-top:8px;">✕ Quitar filtro de área</button>`;
  html += `<div class="info-card-loader" aria-hidden="true"><div class="info-card-spinner"></div><div class="info-card-loader-text">Recalculando…</div></div>`;
  html += `</div>`;
  return html;
}

function buildIntersectionFilterSummaryHtml() {
  if (!currentIntersectionFilterData) return '';
  const {
    interseccionSeleccionada,
    totalElementos,
    capasContadas,
    rowsHtml
  } = currentIntersectionFilterData;
  let html = `<div class="info-card filter-card" data-filter="interseccion"><div class="ic-label">Intersección: ${interseccionSeleccionada}</div><hr class="info-divider">`;
  html += `<div class="info-table-wrap"><table id="tablaElementosInterseccion" class="info-table">`;
  html += `<thead><tr><th>Capa / Elemento</th><th>Cantidad</th></tr></thead><tbody>`;
  html += rowsHtml;
  if (capasContadas === 0) {
    html += `<tr><td colspan="2" class="info-table-empty">No hay puntos dentro del estado y del área seleccionados.</td></tr>`;
  }
  html += `</tbody></table></div>`;
  if (capasContadas > 0) {
    html += `<div class="info-total"><span>Total en la intersección</span><b>${totalElementos}</b></div>`;
    html += `<button type="button" id="downloadPdfBtnInterseccion" class="info-btn info-btn-primary">Descargar datos en PDF</button>`;
    html += `<button type="button" id="downloadExcelBtnInterseccion" class="info-btn info-btn-success">Descargar tablas en Excel</button>`;
  }
  html += `<button type="button" id="clearFilterInterseccionBtn" class="info-btn info-btn-danger" style="margin-top:8px;">✕ Quitar ambos filtros</button>`;
  html += `<div class="info-card-loader" aria-hidden="true"><div class="info-card-spinner"></div><div class="info-card-loader-text">Recalculando…</div></div>`;
  html += `</div>`;
  return html;
}

// =========================================================================
// METADATOS DE LA CAPA SELECCIONADA (estilo QGIS)
// =========================================================================

function buildSelectedLayerMetadataHtml() {
  if (!selectedLayerTableName) return '';

  const cacheEntry = layerMetadataCache[selectedLayerTableName];
  let bodyHtml;

  if (!cacheEntry || cacheEntry.status === 'loading') {
    bodyHtml = `<p class="info-card-empty">Cargando metadatos...</p>`;
  } else if (cacheEntry.status === 'error') {
    bodyHtml = `<p class="info-card-empty">No se pudieron cargar los metadatos. Verifique la conexión con el backend.</p>`;
  } else if (cacheEntry.status === 'empty') {
    bodyHtml = `<p class="info-card-empty">Sin metadatos disponibles.</p>`;
  } else {
    bodyHtml = buildQgisMetadataHtml(cacheEntry.metadata, { variant: 'panel' }) || `<p class="info-card-empty">Sin metadatos disponibles.</p>`;
  }

  return `
    <div class="info-card">
      <div class="ic-label">Metadatos de la capa: ${selectedLayerDisplayName || selectedLayerTableName}</div>
      <hr class="info-divider">
      ${bodyHtml}
    </div>
  `;
}

// =========================================================================
// ASIGNACIÓN DE EVENTOS DE DESCARGA (PDF / EXCEL) Y BOTONES DE LIMPIAR
// =========================================================================
function attachFilterDownloadListeners() {
  if (!currentFilterData) return;
  const { estadoSeleccionado: estadoNombre, totalPuntosGeneral, capasDetalleMap } = currentFilterData;
  const downloadPdfBtn = document.getElementById('downloadPdfBtn');
  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', async () => {
      await generarReportePDF('Estado', estadoNombre, totalPuntosGeneral, capasDetalleMap, document.getElementById('tablaPuntosEstado'));
    });
  }
  const downloadExcelBtn = document.getElementById('downloadExcelBtn');
  if (downloadExcelBtn) {
    downloadExcelBtn.addEventListener('click', () => {
      generarReporteExcel(estadoNombre, capasDetalleMap, document.getElementById('tablaPuntosEstado'));
    });
  }
  const clearEstadoBtn = document.getElementById('clearFilterEstadoBtn');
  if (clearEstadoBtn) {
    clearEstadoBtn.addEventListener('click', () => {
      if (typeof window.limpiarFiltroEstado === 'function') window.limpiarFiltroEstado();
    });
  }
}

function attachBloqueFilterDownloadListeners() {
  if (!currentBloqueFilterData) return;
  const { bloqueSeleccionado: bloqueNombre, totalPuntosGeneral, capasDetalleMap } = currentBloqueFilterData;
  const downloadPdfBtnBloque = document.getElementById('downloadPdfBtnBloque');
  if (downloadPdfBtnBloque) {
    downloadPdfBtnBloque.addEventListener('click', async () => {
      await generarReportePDF('Bloque', bloqueNombre, totalPuntosGeneral, capasDetalleMap, document.getElementById('tablaPuntosBloque'));
    });
  }
  const downloadExcelBtnBloque = document.getElementById('downloadExcelBtnBloque');
  if (downloadExcelBtnBloque) {
    downloadExcelBtnBloque.addEventListener('click', () => {
      generarReporteExcel(bloqueNombre, capasDetalleMap, document.getElementById('tablaPuntosBloque'));
    });
  }
  const clearBloqueBtn = document.getElementById('clearFilterBloqueBtn');
  if (clearBloqueBtn) {
    clearBloqueBtn.addEventListener('click', () => {
      if (typeof window.limpiarFiltroBloque === 'function') window.limpiarFiltroBloque();
    });
  }
}

function attachAreaFilterDownloadListeners() {
  if (!currentAreaFilterData) return;
  const { areaSeleccionada: areaNombre, totalElementos, capasDetalleMap } = currentAreaFilterData;
  const downloadPdfBtnArea = document.getElementById('downloadPdfBtnArea');
  if (downloadPdfBtnArea) {
    downloadPdfBtnArea.addEventListener('click', async () => {
      await generarReportePDF('Área', areaNombre, totalElementos, capasDetalleMap, document.getElementById('tablaElementosArea'));
    });
  }
  const downloadExcelBtnArea = document.getElementById('downloadExcelBtnArea');
  if (downloadExcelBtnArea) {
    downloadExcelBtnArea.addEventListener('click', () => {
      generarReporteExcel(areaNombre, capasDetalleMap, document.getElementById('tablaElementosArea'));
    });
  }
  const clearAreaBtn = document.getElementById('clearFilterAreaBtn');
  if (clearAreaBtn) {
    clearAreaBtn.addEventListener('click', () => {
      if (typeof window.limpiarFiltroArea === 'function') window.limpiarFiltroArea();
    });
  }
}

function attachIntersectionFilterDownloadListeners() {
  if (!currentIntersectionFilterData) return;
  const { interseccionSeleccionada, totalElementos, capasDetalleMap } = currentIntersectionFilterData;
  const downloadPdfBtnInterseccion = document.getElementById('downloadPdfBtnInterseccion');
  if (downloadPdfBtnInterseccion) {
    downloadPdfBtnInterseccion.addEventListener('click', async () => {
      await generarReportePDF('Intersección', interseccionSeleccionada, totalElementos, capasDetalleMap, document.getElementById('tablaElementosInterseccion'));
    });
  }
  const downloadExcelBtnInterseccion = document.getElementById('downloadExcelBtnInterseccion');
  if (downloadExcelBtnInterseccion) {
    downloadExcelBtnInterseccion.addEventListener('click', () => {
      generarReporteExcel(interseccionSeleccionada, capasDetalleMap, document.getElementById('tablaElementosInterseccion'));
    });
  }
  const clearInterseccionBtn = document.getElementById('clearFilterInterseccionBtn');
  if (clearInterseccionBtn) {
    clearInterseccionBtn.addEventListener('click', () => {
      if (typeof window.limpiarFiltroEstado === 'function') window.limpiarFiltroEstado();
      if (typeof window.limpiarFiltroArea === 'function') window.limpiarFiltroArea();
    });
  }
}

// =========================================================================
// GENERACIÓN DE REPORTES (PDF y EXCEL) — vía backend
// El backend renderiza el archivo (ReportLab / openpyxl) para evitar los
// falsos positivos de antivirus que provocaba jsPDF en el navegador.
// =========================================================================
async function generarReportePDF(etiqueta, nombreSeleccionado, totalPuntosGeneral, capasDetalleMap, tablaResumenEl) {
  try {
    const logoData = await getLogoBase64();
    const payload = {
      etiqueta,
      nombre: nombreSeleccionado,
      total: totalPuntosGeneral,
      detalle: capasDetalleMap || {},
      logo_base64: logoData || null
    };
    const response = await apiFetch('/api/v1/reports/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await leerErrorReporte(response));
    }
    const blob = await response.blob();
    descargarBlobReporte(blob, `Reporte_Datos_${nombreSeleccionado.replace(/\s+/g, '_')}.pdf`);
  } catch (e) {
    console.error('Error al generar el PDF:', e);
    alert(`No se pudo generar el PDF: ${e?.message || e}`);
  }
}

async function generarReporteExcel(nombreSeleccionado, capasDetalleMap, tablaResumenEl) {
  try {
    const payload = {
      etiqueta: 'Estado',
      nombre: nombreSeleccionado,
      total: 0,
      detalle: capasDetalleMap || {}
    };
    const response = await apiFetch('/api/v1/reports/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await leerErrorReporte(response));
    }
    const blob = await response.blob();
    descargarBlobReporte(blob, `Reporte_Puntos_${nombreSeleccionado.replace(/\s+/g, '_')}.xlsx`);
  } catch (e) {
    console.error('Error al generar el Excel:', e);
    alert(`No se pudo generar el Excel: ${e?.message || e}`);
  }
}

async function leerErrorReporte(response) {
  try {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.detail) {
          return typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
        }
      } catch (_) { /* no es JSON */ }
      return text;
    }
  } catch (_) { /* ignorar */ }
  return `Error ${response.status}`;
}

function descargarBlobReporte(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}