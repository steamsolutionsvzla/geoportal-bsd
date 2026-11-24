// download-files.js
// Descarga de archivos indexados (LAS/LIS/DLIS/SEG-Y) y del ZIP mixto del
// filtro poligonal. La descarga final SIEMPRE se hace por navegación normal a
// una URL firmada de corta duración: así el navegador puede reanudar (Range)
// y no se cargan GB en memoria como haría un fetch(...).blob().
import { apiFetch } from './utils.js';

function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function leerError(response) {
  try {
    const text = await response.text();
    if (!text) return `Error ${response.status}`;
    try {
      const data = JSON.parse(text);
      if (data && data.detail) {
        return typeof data.detail === 'string'
          ? data.detail
          : JSON.stringify(data.detail);
      }
    } catch (_) { /* no era JSON */ }
    return text.slice(0, 400);
  } catch (_) {
    return `Error ${response.status}`;
  }
}

/**
 * Descarga el archivo original de un punto de la capa archivos_indexados.
 */
export async function downloadDocumentFile(docId) {
  const response = await apiFetch('/api/v1/downloads/ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'document', id: String(docId) }),
  });
  if (!response.ok) {
    throw new Error(await leerError(response));
  }
  const data = await response.json();
  if (!data?.url) throw new Error('El servidor no devolvió una URL de descarga.');
  triggerDownload(data.url);
}

/**
 * Genera (o recupera) el ZIP del filtro poligonal.
 *
 * @param {object} opts
 * @param {object} opts.geometry         Polígono/área activa (GeoJSON).
 * @param {object} [opts.maskGeometry]   Segundo polígono para la intersección.
 * @param {Array}  opts.layers           [{id, name}] de las capas con hits.
 * @param {string} [opts.label]          Nombre visible del área.
 * @param {(msg:string)=>void} [onProgress]
 */
export async function downloadZoneArchive({
  geometry,
  maskGeometry = null,
  layers,
  label = 'Área',
  onProgress,
}) {
  if (!geometry) throw new Error('No hay un área activa para descargar.');
  if (!Array.isArray(layers) || !layers.length) {
    throw new Error('No hay capas con datos dentro del área.');
  }

  onProgress?.('Analizando el área…');
  const response = await apiFetch('/api/v1/downloads/zone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      geometry,
      mask_geometry: maskGeometry || null,
      layers: layers.map((l) => ({ id: l.id, name: l.name || '' })),
      label,
    }),
    // El backend responde rápido (job) salvo lotes pequeños.
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });

  if (!response.ok) {
    throw new Error(await leerError(response));
  }

  const data = await response.json();
  if (data.state === 'ready' && data.url) {
    triggerDownload(data.url);
    onProgress?.('Descarga lista.');
    return data;
  }

  const jobId = data.job_id;
  if (!jobId) throw new Error('El servidor no devolvió un identificador de descarga.');
  onProgress?.('Generando ZIP…');

  // Polling del job. El backend guarda el ZIP y expone una URL firmada.
  const deadline = Date.now() + 6 * 60 * 60 * 1000; // 6 h
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('La generación del ZIP tardó demasiado. Intenta con un área más pequeña.');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const statusResponse = await apiFetch(`/api/v1/downloads/jobs/${jobId}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!statusResponse.ok) {
      throw new Error(await leerError(statusResponse));
    }
    const job = await statusResponse.json();
    const p = job.progress || {};
    if (job.state === 'ready' && job.url) {
      triggerDownload(job.url);
      onProgress?.('Descarga lista.');
      return job;
    }
    if (job.state === 'error') {
      throw new Error(job.error || 'No se pudo generar el ZIP.');
    }
    if (job.state === 'cancelled') {
      throw new Error('La descarga fue cancelada.');
    }
    const files = `${p.files_done || 0}/${p.files_total || 0}`;
    const layersDone = `${p.layers_done || 0}/${p.layers_total || 0}`;
    onProgress?.(
      `Generando ZIP… archivos ${files} · capas ${layersDone} · `
      + `${formatBytes(p.bytes_done || 0)}`,
    );
  }
}
