/**
 * Bloqueo global mientras hay una carga en curso.
 *
 * Mientras el indicador de "Cargando…" está visible:
 *  - se cubre la pantalla con una capa que captura clic, arrastre, rueda y táctil,
 *  - el contenido de la página queda `inert` (sin foco ni clics ni teclado),
 *  - se bloquean las teclas que podrían mover la página o el mapa.
 *
 * Usa un contador para soportar cargas anidadas o consecutivas: el bloqueo
 * solo desaparece cuando termina la última.
 *
 *   beginBusy('Cargando datos…');
 *   ...
 *   endBusy();
 */
import '../styles/busy-overlay.css';

const HIDE_DELAY = 200;

let depth = 0;
let hideTimer = null;
let overlay = null;
let visible = false;
let lastFocused = null;
let inerted = [];

const BLOCKED_KEYS = new Set([
  'Tab', ' ', 'Enter',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End',
]);

function stopScroll(event) {
  if (visible) event.preventDefault();
}

function onKeydown(event) {
  if (!visible) return;
  // Deja pasar atajos del navegador (recargar, devtools, zoom, etc.).
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'F5' || event.key === 'F11' || event.key === 'F12' || event.key === 'Escape') return;
  if (BLOCKED_KEYS.has(event.key)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function ensureOverlay() {
  if (overlay?.isConnected) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'app-busy-overlay';
  overlay.className = 'app-busy-overlay';
  overlay.hidden = true;
  overlay.tabIndex = -1;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.setAttribute('aria-busy', 'true');
  overlay.innerHTML = `
    <div class="app-busy-card">
      <span class="app-busy-spinner" aria-hidden="true"></span>
      <span class="app-busy-text">Cargando datos…</span>
    </div>
  `;
  overlay.addEventListener('wheel', stopScroll, { passive: false });
  overlay.addEventListener('touchmove', stopScroll, { passive: false });
  document.body.appendChild(overlay);
  return overlay;
}

function setContentInert(on) {
  if (on) {
    inerted = [...document.body.children].filter(
      (el) => el !== overlay && !['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(el.tagName),
    );
    for (const el of inerted) el.setAttribute('inert', '');
  } else {
    for (const el of inerted) el.removeAttribute('inert');
    inerted = [];
  }
}

function show(message) {
  const el = ensureOverlay();
  if (message) {
    const text = el.querySelector('.app-busy-text');
    if (text) text.textContent = message;
  }
  if (visible) return;

  visible = true;
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setContentInert(true);
  el.hidden = false;
  document.documentElement.classList.add('is-app-busy');
  document.documentElement.dataset.busy = 'true';
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

function hide() {
  if (!visible) return;
  visible = false;
  if (overlay) overlay.hidden = true;
  document.documentElement.classList.remove('is-app-busy');
  delete document.documentElement.dataset.busy;
  setContentInert(false);

  if (lastFocused && lastFocused.isConnected) {
    try {
      lastFocused.focus({ preventScroll: true });
    } catch {
      /* el elemento ya no admite foco */
    }
  }
  lastFocused = null;
}

export function beginBusy(message = 'Cargando datos…') {
  depth += 1;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  show(message);
}

export function endBusy() {
  depth = Math.max(0, depth - 1);
  if (depth > 0) return;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (depth === 0) hide();
  }, HIDE_DELAY);
}

export function isBusy() {
  return depth > 0;
}

document.addEventListener('keydown', onKeydown, true);
