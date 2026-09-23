// info-panel.js
import { getMap } from './map-config.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ========================================================================
// ESTADO INTERNO DEL PANEL
// ========================================================================
let currentFilterData = null;
let currentBloqueFilterData = null;
let isFilterActive = false;
let isBloqueFilterActive = false;
let estadoSeleccionado = '';
let bloqueSeleccionado = '';

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
  if (data.isFilterActive !== undefined) isFilterActive = data.isFilterActive;
  if (data.isBloqueFilterActive !== undefined) isBloqueFilterActive = data.isBloqueFilterActive;
  if (data.estadoSeleccionado !== undefined) estadoSeleccionado = data.estadoSeleccionado;
  if (data.bloqueSeleccionado !== undefined) bloqueSeleccionado = data.bloqueSeleccionado;
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
    const response = await fetch(`/api/v1/layers/${tableName}/metadata`);
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

  let html = '';
  let bloques = [];
  if (selectedLayerMetadataHtml) bloques.push(selectedLayerMetadataHtml);
  if (filterHtml) bloques.push(filterHtml);
  if (bloqueFilterHtml) bloques.push(bloqueFilterHtml);

  if (bloques.length > 0) {
    html = bloques.join('');
  } else {
    html = `<div class="info-card"><div class="ic-label">Información</div><p class="info-card-empty">Seleccione un estado o un bloque y aplique el filtro, o haga clic en un punto/línea/polígono del mapa, para ver los metadatos de su capa.</p></div>`;
  }

  infoContent.innerHTML = html;

  // Reaplicar estado de loading si hay recálculo en curso
  if (filterLoadingCount > 0) {
    infoContent.querySelectorAll('.info-card.filter-card').forEach(card => {
      card.classList.add('is-loading');
    });
  }

  if (filterHtml) attachFilterDownloadListeners();
  if (bloqueFilterHtml) attachBloqueFilterDownloadListeners();

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
    html += `<button type="button" id="downloadPdfBtn" class="info-btn info-btn-primary">Descargar tabla en PDF</button>`;
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
    html += `<button type="button" id="downloadPdfBtnBloque" class="info-btn info-btn-primary">Descargar tabla en PDF</button>`;
    html += `<button type="button" id="downloadExcelBtnBloque" class="info-btn info-btn-success">Descargar tablas en Excel</button>`;
  }
  html += `<button type="button" id="clearFilterBloqueBtn" class="info-btn info-btn-danger" style="margin-top:8px;">✕ Quitar filtro de bloque</button>`;
  html += `<div class="info-card-loader" aria-hidden="true"><div class="info-card-spinner"></div><div class="info-card-loader-text">Recalculando…</div></div>`;
  html += `</div>`;
  return html;
}

// =========================================================================
// TABLA DE METADATOS DE LA CAPA SELECCIONADA
// =========================================================================
const METADATA_FIELD_CONFIG = [
  { key: 'title', label: 'Título' },
  { key: 'abstract', label: 'Resumen' },
  { key: 'categories', label: 'Categorías' },
  { key: 'keywords', label: 'Palabras clave' },
  { key: 'themes', label: 'Temas' },
  { key: 'spatial_level', label: 'Nivel espacial' },
  { key: 'layer_type', label: 'Tipo de capa' },
  { key: 'geometry_type', label: 'Tipo de geometría' },
  { key: 'feature_count', label: 'Cantidad de elementos' },
  { key: 'crs', label: 'Sistema de referencia (CRS)' },
  { key: 'projection_name', label: 'Proyección' },
  { key: 'projection_authid', label: 'Código EPSG' },
  { key: 'spatial_extent', label: 'Extensión espacial (minX, maxX, minY, maxY)' },
  { key: 'minimum_optimal_scale', label: 'Escala óptima mínima' },
  { key: 'maximum_optimal_scale', label: 'Escala óptima máxima' },
  { key: 'owner', label: 'Propietario' },
  { key: 'publication_date', label: 'Fecha de publicación' },
  { key: 'publication_frequency', label: 'Frecuencia de publicación' },
  { key: 'license', label: 'Licencia' },
  { key: 'license_attribution', label: 'Atribución de licencia' },
  { key: 'confidentiality', label: 'Confidencialidad' },
  { key: 'creation_date', label: 'Fecha de creación (metadatos)' },
  { key: 'update_date', label: 'Última actualización (metadatos)' },
  { key: 'update_time', label: 'Última actualización (metadatos)' },
  { key: 'data_last_update', label: 'Última actualización de los datos' },
];

const METADATA_HIDDEN_FIELDS = [
  'id', 'uid', 'table_name', 'schema_name',
  'f_table_catalog', 'f_table_schema', 'f_table_name', 'f_geometry_column',
  'geom', 'extent', 'qmd', 'identifier'
];

function formatMetadataFieldLabel(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMetadataFieldValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function buildMetadataTableHtml(metadata) {
  let rowsHtml = '';
  const renderedKeys = new Set();

  METADATA_FIELD_CONFIG.forEach(({ key, label }) => {
    if (!(key in metadata)) return;
    const value = metadata[key];
    renderedKeys.add(key);
    if (value === null || value === undefined || value === '') return;
    rowsHtml += `<tr><td>${label}</td><td>${formatMetadataFieldValue(value)}</td></tr>`;
  });

  Object.keys(metadata).forEach((key) => {
    if (renderedKeys.has(key)) return;
    if (METADATA_HIDDEN_FIELDS.includes(key.toLowerCase())) return;
    const value = metadata[key];
    if (value === null || value === undefined || value === '') return;
    rowsHtml += `<tr><td>${formatMetadataFieldLabel(key)}</td><td>${formatMetadataFieldValue(value)}</td></tr>`;
  });

  if (!rowsHtml) return '';

  return `
    <div class="info-table-wrap">
      <table class="info-table metadata-table">
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

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
    bodyHtml = buildMetadataTableHtml(cacheEntry.metadata) || `<p class="info-card-empty">Sin metadatos disponibles.</p>`;
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

// =========================================================================
// GENERACIÓN DE REPORTES (PDF y EXCEL)
// =========================================================================
async function generarReportePDF(etiqueta, nombreSeleccionado, totalPuntosGeneral, capasDetalleMap, tablaResumenEl) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;

  const primaryColor = [26, 54, 93];
  const secondaryColor = [49, 130, 206];
  const lightGray = [240, 240, 240];
  const borderColor = [180, 180, 180];

  const logoData = await getLogoBase64();
  if (logoData) {
    try {
      doc.addImage(logoData, 'PNG', margin, y, 35, 12);
    } catch (e) {
      // Si falla la imagen, continuar sin logo
    }
  }
  y += 12 + 4;

  const headerHeight = 32;
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(margin, y, pageWidth - 2 * margin, headerHeight, 'F');
  doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setLineWidth(1.5);
  doc.line(margin, y + headerHeight, pageWidth - margin, y + headerHeight);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('Reporte Estratégico de Puntos', pageWidth / 2, y + 14, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`${etiqueta}: ${nombreSeleccionado}`, pageWidth / 2, y + 25, { align: 'center' });
  y += headerHeight + 8;
  doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  if (tablaResumenEl) {
    const tableData = [];
    const rows = tablaResumenEl.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      if (cells.length > 0) {
        tableData.push(Array.from(cells).map(cell => cell.textContent.trim()));
      }
    });
    autoTable(doc, {
      head: tableData.slice(0, 1),
      body: tableData.slice(1),
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 3, lineColor: borderColor, lineWidth: 0.2, halign: 'left' },
      headStyles: { fillColor: secondaryColor, textColor: [255,255,255], fontSize: 9, halign: 'left', lineColor: borderColor, lineWidth: 0.2 },
      bodyStyles: { lineColor: borderColor, lineWidth: 0.1 },
      alternateRowStyles: { fillColor: lightGray },
      columnStyles: { 1: { halign: 'right' } },
      didParseCell: function(data) {
        if (data.column.index === 1) data.cell.styles.halign = 'right';
      }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(`Total general de puntos: ${totalPuntosGeneral}`, margin, y);
  y += 8;
  doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  if (Object.keys(capasDetalleMap).length > 0) {
    const excludedKeys = new Set(['id', 'geoid', 'gid', 'objectid']);
    for (let nombreCapa in capasDetalleMap) {
      const listaProps = capasDetalleMap[nombreCapa];
      const allKeysSet = new Set();
      listaProps.forEach(props => {
        for (let key in props) {
          const lowerKey = key.toLowerCase();
          const isExcluded = excludedKeys.has(lowerKey) || lowerKey.endsWith('_id') || lowerKey.startsWith('id_');
          if (!isExcluded) allKeysSet.add(key);
        }
      });
      const columns = Array.from(allKeysSet);
      if (columns.length === 0) continue;
      const remainingSpace = doc.internal.pageSize.getHeight() - y - 20;
      if (remainingSpace < 25) {
        doc.addPage();
        y = margin;
      }
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text(`Detalle de ${nombreCapa}`, margin, y);
      y += 5;
      const head = ['#'].concat(columns);
      const body = [];
      listaProps.forEach((props, index) => {
        const row = [index + 1];
        columns.forEach(col => {
          row.push(props[col] !== undefined ? String(props[col]) : '');
        });
        body.push(row);
      });
      autoTable(doc, {
        head: [head],
        body: body,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2.5, lineColor: borderColor, lineWidth: 0.15, halign: 'left' },
        headStyles: { fillColor: secondaryColor, textColor: [255,255,255], fontSize: 8, halign: 'center', lineColor: borderColor, lineWidth: 0.15 },
        bodyStyles: { lineColor: borderColor, lineWidth: 0.1 },
        alternateRowStyles: { fillColor: lightGray },
        columnStyles: { 0: { halign: 'center', cellWidth: 12 } },
        didParseCell: function(data) {
          if (data.column.index === 0) data.cell.styles.halign = 'center';
        }
      });
      y = doc.lastAutoTable.finalY + 5;
    }
  }

  const totalPages = doc.internal.getNumberOfPages();
  const currentDate = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
    doc.text(`Generado: ${currentDate}`, margin, pageHeight - 6);
  }
  doc.save(`Reporte_Puntos_${nombreSeleccionado.replace(/\s+/g, '_')}.pdf`);
}

function generarReporteExcel(nombreSeleccionado, capasDetalleMap, tablaResumenEl) {
  const wb = XLSX.utils.book_new();
  if (tablaResumenEl) {
    const wsResumen = XLSX.utils.table_to_sheet(tablaResumenEl);
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen General");
  }
  if (Object.keys(capasDetalleMap).length > 0) {
    const excludedKeys = new Set(['id', 'geoid', 'gid', 'objectid']);
    for (let nombreCapa in capasDetalleMap) {
      const listaProps = capasDetalleMap[nombreCapa];
      const rowsForSheet = [];
      listaProps.forEach((props, index) => {
        let cleanRow = { "#": index + 1 };
        for (let key in props) {
          const lowerKey = key.toLowerCase();
          const isExcluded = excludedKeys.has(lowerKey) || lowerKey.endsWith('_id') || lowerKey.startsWith('id_');
          if (!isExcluded) {
            cleanRow[key] = props[key] !== undefined ? props[key] : '';
          }
        }
        rowsForSheet.push(cleanRow);
      });
      if (rowsForSheet.length > 0) {
        const wsDetalle = XLSX.utils.json_to_sheet(rowsForSheet);
        let sheetName = nombreCapa.substring(0, 31);
        XLSX.utils.book_append_sheet(wb, wsDetalle, sheetName);
      }
    }
  }
  XLSX.writeFile(wb, `Reporte_Puntos_${nombreSeleccionado.replace(/\s+/g, '_')}.xlsx`);
}