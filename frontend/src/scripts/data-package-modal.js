// data-package-modal.js
// Formulario para guardar el filtro poligonal activo como paquete de datos.
import { createDataPackage } from './data-packages.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function closeModal(overlay) {
  overlay?.remove();
}

/**
 * Abre el formulario de creación de paquete de datos.
 *
 * @param {object} data      Datos del filtro (currentAreaFilterData o
 *                           currentIntersectionFilterData).
 * @param {string} source    'area' | 'intersection'
 */
export function openDataPackageModal(data, source = 'area') {
  if (!data || !data.geometry) {
    alert('No hay un área activa para guardar.');
    return;
  }
  const layers = Array.isArray(data.capasSeleccionadas)
    ? data.capasSeleccionadas
    : [];
  const label = data.interseccionSeleccionada
    || data.areaSeleccionada
    || 'Área';
  const polygonEntity = data.areaSeleccionada || label;
  const stateEntity = data.estadoSeleccionado || '';

  const overlay = document.createElement('div');
  overlay.className = 'data-package-overlay';
  overlay.innerHTML = `
    <div class="data-package-modal" role="dialog" aria-modal="true"
         aria-labelledby="dataPackageTitle">
      <div class="data-package-header">
        <div>
          <h2 id="dataPackageTitle">Guardar paquete de datos</h2>
          <p>${escapeHtml(label)}</p>
        </div>
        <button type="button" class="data-package-close"
                aria-label="Cerrar">&times;</button>
      </div>
      <form class="data-package-form">
        <label>
          Nombre del paquete
          <input type="text" name="name" maxlength="200" required
                 placeholder="Ej. Bloque X — pozos y sísmica" autofocus>
        </label>
        <label>
          Entidad de la poligonal
          <input type="text" name="polygon_entity" maxlength="200"
                 value="${escapeHtml(polygonEntity)}" placeholder="No aplica">
        </label>
        <label class="data-package-optional">
          Estado / entidad de la intersección
          <input type="text" name="state_entity" maxlength="200"
                 value="${escapeHtml(stateEntity)}" placeholder="No aplica">
        </label>
        <div class="data-package-summary">
          <span><strong>${layers.length}</strong> capas en el filtro</span>
          <span><strong>${Number(data.totalElementos) || 0}</strong> elementos</span>
        </div>
        <p class="data-package-hint">
          Se guardarán solo los <strong>archivos indexados</strong> del área.
          Los shapefiles generados por otras capas no se incluyen.
        </p>
        <div class="data-package-status" hidden></div>
        <div class="data-package-actions">
          <button type="button" class="data-package-cancel">Cancelar</button>
          <button type="submit" class="data-package-save">Guardar paquete</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => closeModal(overlay);
  overlay.querySelector('.data-package-close')
    ?.addEventListener('click', close);
  overlay.querySelector('.data-package-cancel')
    ?.addEventListener('click', close);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      close();
    }
  };
  document.addEventListener('keydown', onKey);

  const form = overlay.querySelector('.data-package-form');
  const status = overlay.querySelector('.data-package-status');
  const submit = overlay.querySelector('.data-package-save');
  const setStatus = (msg, isError = false) => {
    status.hidden = !msg;
    status.textContent = msg || '';
    status.classList.toggle('is-error', Boolean(isError));
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    if (!name) {
      setStatus('Escribe un nombre para el paquete.', true);
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Guardando…';
    setStatus('Calculando los archivos del área…');
    try {
      const result = await createDataPackage({
        name,
        geometry: data.geometry,
        maskGeometry: data.mask_geometry || null,
        layers,
        label,
        polygonEntity: String(formData.get('polygon_entity') || '').trim()
          || 'No aplica',
        stateEntity: String(formData.get('state_entity') || '').trim()
          || 'No aplica',
      });
      const count = result.document_count || result.file_count || 0;
      setStatus(
        `Paquete ${result.code || result.name} creado con ${count} archivo(s).`,
      );
      submit.textContent = 'Guardado';
      setTimeout(close, 2200);
    } catch (error) {
      console.error('Error al crear el paquete de datos:', error);
      setStatus(error?.message || 'No se pudo crear el paquete.', true);
      submit.disabled = false;
      submit.textContent = 'Guardar paquete';
    }
  });
}
